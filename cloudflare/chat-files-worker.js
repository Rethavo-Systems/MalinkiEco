const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

const CHAT_FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CHAT_FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024
const CHAT_FILES_STORAGE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024
const CHAT_FILES_STORAGE_TARGET_BYTES = 7 * 1024 * 1024 * 1024
const CHAT_FILES_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const CHAT_FILES_CLEANUP_SCAN_LIMIT = 20000
const CHAT_FILES_PREFIX = 'chat-files/'
const AVATAR_FILE_MAX_SIZE_BYTES = 5 * 1024 * 1024
const AVATAR_FILES_PREFIX = 'avatars/'
const YANDEX_DISK_API_BASE = 'https://cloud-api.yandex.net/v1/disk'
const YANDEX_DISK_DEFAULT_BASE_PATH = 'MalinkiEco/chat'

let firebaseJwksCache = null
let firebaseJwksExpiresAt = 0
let googleAccessTokenCache = null
let googleAccessTokenExpiresAt = 0
let serviceAccountPrivateKeyCache = null
let lastEmergencyCleanupStartedAt = 0
const yandexDirectoryCache = new Set()

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return jsonResponse({}, 204, request, env)
    }

    if (request.method === 'GET' && url.pathname === '/api/chat/health') {
      return jsonResponse({ ok: true, service: 'malinkieco-chat-files-worker' }, 200, request, env)
    }

    if (request.method === 'POST' && url.pathname === '/api/chat/files') {
      return uploadChatFile(request, env, ctx)
    }

    if (request.method === 'POST' && url.pathname === '/api/chat/avatar') {
      return uploadUserAvatar(request, env)
    }

    if (request.method === 'DELETE' && url.pathname === '/api/chat/avatar') {
      return deleteUserAvatar(request, env)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/chat/files/')) {
      return downloadChatFile(request, env)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/chat/avatar/')) {
      return downloadUserAvatar(request, env)
    }

    return jsonResponse({ ok: false, error: 'Маршрут не найден.' }, 404, request, env)
  },
}

async function uploadChatFile(request, env, ctx) {
  try {
    assertRequiredEnv(env)

    const { actorId, actorDoc } = await getAuthorizedActor(request, env)
    const actorRole = String(actorDoc.role || 'USER')
    const gateDoc = await getFirestoreDocument(env, 'app_settings/app_gate')
    ensureAppAvailableForActor(gateDoc, actorRole)

    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
      return jsonResponse({ ok: false, error: 'Файл не найден в запросе.' }, 400, request, env)
    }

    const originalName = String(file.name || 'file')
    const fileSize = Number(file.size || 0)
    if (fileSize <= 0) {
      return jsonResponse({ ok: false, error: 'Нельзя загрузить пустой файл.' }, 400, request, env)
    }
    if (fileSize > CHAT_FILE_MAX_SIZE_BYTES) {
      return jsonResponse({ ok: false, error: 'Файл больше 25 МБ.' }, 413, request, env)
    }

    const now = Date.now()
    const fileId = crypto.randomUUID()
    const cleanName = sanitizeFileName(originalName)
    const contentType = String(file.type || 'application/octet-stream')
    const kind = chatAttachmentKind(contentType)
    const expiresAtClient = now + CHAT_FILE_TTL_MS
    const storageFileName = chatStorageFileName(expiresAtClient, fileId, cleanName)
    const storageKey = `${CHAT_FILES_PREFIX}${storageFileName}`

    await putStoredObject(env, storageKey, await file.arrayBuffer(), {
      contentType,
      metadata: {
        fileId,
        name: cleanName,
        contentType,
        size: String(fileSize),
        kind,
        uploaderId: actorId,
        uploadedAtClient: String(now),
        expiresAtClient: String(expiresAtClient),
      },
    })

    ctx?.waitUntil(runEmergencyStorageCleanup(env).catch((error) => {
      console.error('[chat-files-worker] emergency cleanup failed', error)
    }))

    return jsonResponse(
      {
        ok: true,
        attachment: {
          id: fileId,
          name: cleanName,
          contentType,
          size: fileSize,
          kind,
          downloadPath: `/api/chat/files/${encodeURIComponent(storageFileName)}`,
          uploadedAtClient: now,
          expiresAtClient,
        },
      },
      200,
      request,
      env,
    )
  } catch (error) {
    console.error('[chat-files-worker] upload failed', error)
    return jsonResponse(
      { ok: false, error: publicWorkerFileErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

async function uploadUserAvatar(request, env) {
  let nextStorageKey = ''

  try {
    assertRequiredEnv(env)

    const { actorId, actorDoc } = await getAuthorizedActor(request, env)
    const actorRole = String(actorDoc.role || 'USER')
    const gateDoc = await getFirestoreDocument(env, 'app_settings/app_gate')
    ensureAppAvailableForActor(gateDoc, actorRole)

    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
      return jsonResponse({ ok: false, error: 'Файл аватарки не найден в запросе.' }, 400, request, env)
    }

    const originalName = String(file.name || 'avatar')
    const fileSize = Number(file.size || 0)
    const contentType = String(file.type || 'application/octet-stream')
    if (!contentType.startsWith('image/')) {
      return jsonResponse({ ok: false, error: 'Выберите изображение для аватарки.' }, 400, request, env)
    }
    if (fileSize <= 0) {
      return jsonResponse({ ok: false, error: 'Нельзя загрузить пустую аватарку.' }, 400, request, env)
    }
    if (fileSize > AVATAR_FILE_MAX_SIZE_BYTES) {
      return jsonResponse({ ok: false, error: 'Аватарка больше 5 МБ.' }, 413, request, env)
    }

    const now = Date.now()
    const avatarId = crypto.randomUUID()
    const cleanName = sanitizeFileName(originalName)
    const avatarFileName = `${avatarId}-${cleanName}`
    nextStorageKey = `${AVATAR_FILES_PREFIX}${actorId}/${avatarFileName}`
    const avatar = {
      id: avatarId,
      name: cleanName,
      contentType,
      size: fileSize,
      downloadPath: `/api/chat/avatar/${actorId}/${encodeURIComponent(avatarFileName)}`,
      storageKey: nextStorageKey,
      uploadedAtClient: now,
    }

    await putStoredObject(env, nextStorageKey, await file.arrayBuffer(), {
      contentType,
      metadata: {
        avatarId,
        name: cleanName,
        contentType,
        size: String(fileSize),
        ownerId: actorId,
        uploadedAtClient: String(now),
      },
    })

    try {
      await patchFirestoreDocument(env, `users/${actorId}`, { avatar }, ['avatar'])
    } catch (error) {
      await deleteStoredObject(env, nextStorageKey).catch(() => {})
      throw error
    }

    await deleteStoredAvatar(env, actorDoc.avatar)

    return jsonResponse({ ok: true, avatar }, 200, request, env)
  } catch (error) {
    console.error('[chat-files-worker] avatar upload failed', error)
    return jsonResponse(
      { ok: false, error: publicWorkerFileErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

async function deleteUserAvatar(request, env) {
  try {
    assertRequiredEnv(env)

    const { actorId, actorDoc } = await getAuthorizedActor(request, env)
    const actorRole = String(actorDoc.role || 'USER')
    const gateDoc = await getFirestoreDocument(env, 'app_settings/app_gate')
    ensureAppAvailableForActor(gateDoc, actorRole)

    await patchFirestoreDocument(env, `users/${actorId}`, { avatar: null }, ['avatar'])
    await deleteStoredAvatar(env, actorDoc.avatar)

    return jsonResponse({ ok: true, avatar: null }, 200, request, env)
  } catch (error) {
    console.error('[chat-files-worker] avatar delete failed', error)
    return jsonResponse(
      { ok: false, error: publicWorkerFileErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

async function downloadUserAvatar(request, env) {
  try {
    assertRequiredEnv(env)

    const { actorDoc } = await getAuthorizedActor(request, env)
    const actorRole = String(actorDoc.role || 'USER')
    const gateDoc = await getFirestoreDocument(env, 'app_settings/app_gate')
    ensureAppAvailableForActor(gateDoc, actorRole)

    const url = new URL(request.url)
    const avatarPath = decodeURIComponent(url.pathname.replace('/api/chat/avatar/', '')).trim()
    if (!avatarPath || avatarPath.includes('..')) {
      return jsonResponse({ ok: false, error: 'Аватарка не найдена.' }, 404, request, env)
    }

    const storageKey = `${AVATAR_FILES_PREFIX}${avatarPath}`
    const object = await getStoredObject(env, storageKey)
    if (!object?.body) {
      return jsonResponse({ ok: false, error: 'Аватарка не найдена или уже удалена.' }, 404, request, env)
    }

    const metadata = object.customMetadata || {}
    const headers = {
      ...corsHeaders(request, env),
      'Cache-Control': 'private, max-age=300',
      'Content-Type': String(metadata.contentType || object.httpMetadata?.contentType || 'image/jpeg'),
      'Content-Disposition': 'inline',
    }
    if (object.size) {
      headers['Content-Length'] = String(object.size)
    }

    return new Response(object.body, { status: 200, headers })
  } catch (error) {
    console.error('[chat-files-worker] avatar download failed', error)
    return jsonResponse(
      { ok: false, error: publicWorkerFileErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

async function downloadChatFile(request, env) {
  try {
    assertRequiredEnv(env)

    const { actorDoc } = await getAuthorizedActor(request, env)
    const actorRole = String(actorDoc.role || 'USER')
    const gateDoc = await getFirestoreDocument(env, 'app_settings/app_gate')
    ensureAppAvailableForActor(gateDoc, actorRole)

    const url = new URL(request.url)
    const fileId = decodeURIComponent(url.pathname.replace('/api/chat/files/', '')).trim()
    if (!fileId) {
      return jsonResponse({ ok: false, error: 'Файл не найден.' }, 404, request, env)
    }

    const object = await getStoredObject(env, `${CHAT_FILES_PREFIX}${fileId}`)
    if (!object?.body) {
      return jsonResponse({ ok: false, error: 'Файл не найден или уже удален.' }, 404, request, env)
    }

    const metadata = object.customMetadata || {}
    if (Number(metadata.expiresAtClient || 0) > 0 && Number(metadata.expiresAtClient || 0) < Date.now()) {
      return jsonResponse({ ok: false, error: 'Срок хранения файла истек.' }, 410, request, env)
    }

    const headers = {
      ...corsHeaders(request, env),
      'Cache-Control': 'private, max-age=300',
      'Content-Type': String(metadata.contentType || object.httpMetadata?.contentType || 'application/octet-stream'),
      'Content-Disposition': contentDisposition(String(metadata.name || fileId)),
    }
    if (object.size) {
      headers['Content-Length'] = String(object.size)
    }

    return new Response(object.body, { status: 200, headers })
  } catch (error) {
    console.error('[chat-files-worker] download failed', error)
    return jsonResponse(
      { ok: false, error: publicWorkerFileErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

async function runEmergencyStorageCleanup(env) {
  const now = Date.now()
  if (now - lastEmergencyCleanupStartedAt < CHAT_FILES_CLEANUP_INTERVAL_MS) {
    return
  }
  lastEmergencyCleanupStartedAt = now

  const storageLimitBytes = positiveNumber(env.CHAT_FILES_STORAGE_LIMIT_BYTES, CHAT_FILES_STORAGE_LIMIT_BYTES)
  const storageTargetBytes = Math.min(
    storageLimitBytes,
    positiveNumber(env.CHAT_FILES_STORAGE_TARGET_BYTES, CHAT_FILES_STORAGE_TARGET_BYTES),
  )
  const scanLimit = Math.max(100, Math.floor(positiveNumber(env.CHAT_FILES_CLEANUP_SCAN_LIMIT, CHAT_FILES_CLEANUP_SCAN_LIMIT)))
  const files = await listStoredChatObjects(env, scanLimit)
  let totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0)

  const expiredKeys = files
    .filter((file) => file.expiresAtClient > 0 && file.expiresAtClient <= now)
    .map((file) => file.key)

  if (expiredKeys.length > 0) {
    await deleteR2Objects(env, expiredKeys)
    const expiredSet = new Set(expiredKeys)
    for (const file of files) {
      if (expiredSet.has(file.key)) {
        totalSize -= file.size
      }
    }
  }

  if (totalSize <= storageLimitBytes) {
    return
  }

  const keysToDelete = []
  const activeFiles = files
    .filter((file) => !expiredKeys.includes(file.key))
    .sort((left, right) => left.uploadedAtClient - right.uploadedAtClient)

  for (const file of activeFiles) {
    if (totalSize <= storageTargetBytes) break
    keysToDelete.push(file.key)
    totalSize -= file.size
  }

  if (keysToDelete.length > 0) {
    await deleteR2Objects(env, keysToDelete)
    console.warn(
      `[chat-files-worker] emergency cleanup deleted ${keysToDelete.length} files, estimated remaining bytes: ${totalSize}`,
    )
  }
}

async function deleteR2Objects(env, keys) {
  if (storageProvider(env) === 'r2') {
    for (let index = 0; index < keys.length; index += 1000) {
      await env.CHAT_FILES_BUCKET.delete(keys.slice(index, index + 1000))
    }
    return
  }

  await Promise.all(keys.map((key) => deleteStoredObject(env, key)))
}

async function listStoredChatObjects(env, scanLimit) {
  if (storageProvider(env) === 'yandex') {
    return listYandexChatObjects(env, scanLimit)
  }

  const files = []
  let cursor = undefined

  do {
    const listed = await env.CHAT_FILES_BUCKET.list({
      prefix: CHAT_FILES_PREFIX,
      cursor,
      include: ['customMetadata'],
      limit: Math.min(1000, scanLimit - files.length),
    })

    for (const object of listed.objects || []) {
      const uploadedAtClient = objectUploadedAtClient(object)
      const expiresAtClient = objectExpiresAtClient(object, uploadedAtClient)
      files.push({
        key: object.key,
        size: Number(object.size || 0),
        uploadedAtClient,
        expiresAtClient,
      })
    }

    cursor = listed.truncated && files.length < scanLimit ? listed.cursor : undefined
  } while (cursor)

  return files
}

async function listYandexChatObjects(env, scanLimit) {
  const files = []
  let offset = 0
  const limit = 1000

  while (files.length < scanLimit) {
    const payload = await yandexRequest(env, 'GET', '/resources', {
      path: yandexDiskPath(env, CHAT_FILES_PREFIX.replace(/\/$/, '')),
      limit: String(Math.min(limit, scanLimit - files.length)),
      offset: String(offset),
      fields: '_embedded.items.name,_embedded.items.size,_embedded.items.created,_embedded.items.modified,_embedded.limit,_embedded.offset,_embedded.total',
    }).catch((error) => {
      if (Number(error?.httpStatus || 0) === 404) return null
      throw error
    })

    const embedded = payload?._embedded
    const items = embedded?.items || []
    for (const item of items) {
      const parsed = parseChatStorageFileName(String(item.name || ''))
      files.push({
        key: `${CHAT_FILES_PREFIX}${item.name}`,
        size: Number(item.size || 0),
        uploadedAtClient: parsed.uploadedAtClient || new Date(item.created || item.modified || 0).getTime() || 0,
        expiresAtClient: parsed.expiresAtClient,
      })
    }

    offset += items.length
    if (!items.length || offset >= Number(embedded?.total || 0)) break
  }

  return files
}

async function deleteStoredAvatar(env, avatar) {
  const storageKey = String(avatar?.storageKey || '')
  if (!storageKey || !storageKey.startsWith(AVATAR_FILES_PREFIX)) return

  try {
    await deleteStoredObject(env, storageKey)
  } catch (error) {
    console.warn(`[chat-files-worker] failed to delete old avatar ${storageKey}`, error)
  }
}

function storageProvider(env) {
  const configured = String(env.CHAT_FILES_STORAGE_PROVIDER || '').trim().toLowerCase()
  if (configured) return configured
  if (String(env.YANDEX_DISK_TOKEN || '').trim()) return 'yandex'
  return 'r2'
}

async function putStoredObject(env, storageKey, body, { contentType, metadata }) {
  if (storageProvider(env) === 'yandex') {
    await putYandexObject(env, storageKey, body)
    return
  }

  await env.CHAT_FILES_BUCKET.put(storageKey, body, {
    httpMetadata: { contentType },
    customMetadata: metadata,
  })
}

async function getStoredObject(env, storageKey) {
  if (storageProvider(env) === 'yandex') {
    return getYandexObject(env, storageKey)
  }

  return env.CHAT_FILES_BUCKET.get(storageKey)
}

async function deleteStoredObject(env, storageKey) {
  if (storageProvider(env) === 'yandex') {
    await deleteYandexObject(env, storageKey)
    return
  }

  await env.CHAT_FILES_BUCKET.delete(storageKey)
}

async function putYandexObject(env, storageKey, body) {
  await ensureYandexDirectory(env, parentStorageDirectory(storageKey))
  const payload = await yandexRequest(env, 'GET', '/resources/upload', {
    path: yandexDiskPath(env, storageKey),
    overwrite: 'true',
  })

  if (!payload?.href) {
    throw new Error('Яндекс.Диск не выдал ссылку для загрузки файла.')
  }

  const response = await fetch(payload.href, {
    method: payload.method || 'PUT',
    body,
  })

  if (!response.ok) {
    throw new Error(`Yandex upload failed: ${response.status}`)
  }
}

async function getYandexObject(env, storageKey) {
  const resource = await yandexRequest(env, 'GET', '/resources', {
    path: yandexDiskPath(env, storageKey),
    fields: 'name,size,mime_type',
  })
  const payload = await yandexRequest(env, 'GET', '/resources/download', {
    path: yandexDiskPath(env, storageKey),
  })

  if (!payload?.href) {
    return null
  }

  const response = await fetch(payload.href)
  if (!response.ok || !response.body) {
    return null
  }

  return {
    body: response.body,
    size: Number(resource?.size || response.headers.get('Content-Length') || 0),
    httpMetadata: {
      contentType: resource?.mime_type || response.headers.get('Content-Type') || 'application/octet-stream',
    },
    customMetadata: metadataFromStorageKey(storageKey, resource),
  }
}

async function deleteYandexObject(env, storageKey) {
  await yandexRequest(env, 'DELETE', '/resources', {
    path: yandexDiskPath(env, storageKey),
    permanently: 'true',
  }).catch((error) => {
    if (Number(error?.httpStatus || 0) === 404) return null
    throw error
  })
}

async function ensureYandexDirectory(env, relativeDirectory) {
  const basePath = yandexBasePath(env)
  const relativeSegments = String(relativeDirectory || '')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
  const segments = [...basePath.split('/').filter(Boolean), ...relativeSegments]
  let current = ''

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment
    if (yandexDirectoryCache.has(current)) continue

    await yandexRequest(env, 'PUT', '/resources', {
      path: `disk:/${current}`,
    }).catch((error) => {
      if (Number(error?.httpStatus || 0) === 409) return null
      throw error
    })
    yandexDirectoryCache.add(current)
  }
}

async function yandexRequest(env, method, endpoint, query = {}) {
  const url = new URL(`${YANDEX_DISK_API_BASE}${endpoint}`)
  Object.entries(query).forEach(([key, value]) => {
    if (typeof value !== 'undefined' && value !== null) url.searchParams.set(key, String(value))
  })

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `OAuth ${String(env.YANDEX_DISK_TOKEN || '').trim()}`,
      Accept: 'application/json',
    },
  })

  if (response.status === 204 || response.status === 201) return {}
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || payload.description || `Yandex Disk request failed: ${response.status}`)
    error.httpStatus = response.status
    throw error
  }

  return payload
}

function yandexBasePath(env) {
  return String(env.YANDEX_DISK_BASE_PATH || YANDEX_DISK_DEFAULT_BASE_PATH)
    .replace(/^disk:\//, '')
    .replace(/^\/+|\/+$/g, '')
}

function yandexDiskPath(env, storageKey) {
  return `disk:/${yandexBasePath(env)}/${String(storageKey).replace(/^\/+/, '')}`
}

function parentStorageDirectory(storageKey) {
  const parts = String(storageKey).split('/')
  parts.pop()
  return parts.join('/')
}

function objectUploadedAtClient(object) {
  const metadata = object.customMetadata || {}
  const uploadedAtClient = Number(metadata.uploadedAtClient || 0)
  if (uploadedAtClient > 0) return uploadedAtClient

  const uploadedAt = new Date(object.uploaded || 0).getTime()
  return Number.isFinite(uploadedAt) && uploadedAt > 0 ? uploadedAt : 0
}

function objectExpiresAtClient(object, uploadedAtClient) {
  const metadata = object.customMetadata || {}
  const expiresAtClient = Number(metadata.expiresAtClient || 0)
  if (expiresAtClient > 0) return expiresAtClient
  return uploadedAtClient > 0 ? uploadedAtClient + CHAT_FILE_TTL_MS : 0
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function assertRequiredEnv(env) {
  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(
    (key) => !String(env[key] || '').trim(),
  )

  if (storageProvider(env) === 'yandex') {
    if (!String(env.YANDEX_DISK_TOKEN || '').trim()) {
      missing.push('YANDEX_DISK_TOKEN')
    }
  } else if (!env.CHAT_FILES_BUCKET || typeof env.CHAT_FILES_BUCKET.put !== 'function') {
    missing.push('CHAT_FILES_BUCKET')
  }

  if (missing.length > 0) {
    const error = new Error(`Файловый сервер чата не настроен: ${missing.join(', ')}`)
    error.httpStatus = 503
    throw error
  }
}

async function getAuthorizedActor(request, env) {
  const authHeader = request.headers.get('Authorization') || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!idToken) {
    const error = new Error('Войдите в аккаунт, чтобы продолжить.')
    error.httpStatus = 401
    throw error
  }

  const decodedToken = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID)
  const actorId = decodedToken.sub
  const actorDoc = await getFirestoreDocument(env, `users/${actorId}`)
  if (!actorDoc) {
    const error = new Error('Профиль пользователя не найден.')
    error.httpStatus = 403
    throw error
  }

  const actorRole = String(actorDoc.role || 'USER')
  if (!['USER', 'MODERATOR', 'ADMIN', 'TESTER'].includes(actorRole)) {
    const error = new Error('Недостаточно прав для работы с файлами.')
    error.httpStatus = 403
    throw error
  }

  return { actorId, actorDoc, decodedToken }
}

function ensureAppAvailableForActor(gateDoc, actorRole) {
  const isPrivileged = actorRole === 'ADMIN' || actorRole === 'TESTER'
  if ((Boolean(gateDoc?.maintenanceEnabled) || Boolean(gateDoc?.errorEnabled)) && !isPrivileged) {
    const error = new Error('Сайт временно недоступен.')
    error.httpStatus = 503
    throw error
  }
}

function jsonResponse(payload, status, request, env) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request, env),
  }

  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers })
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigin = String(env.APP_ORIGIN || 'https://malinkieco.rethavo.ru').trim()
  const extraOrigins = String(env.APP_EXTRA_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  if (origin && (origin === allowedOrigin || extraOrigins.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }

  return headers
}

function sanitizeFileName(value) {
  return (
    String(value || 'file')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'file'
  )
}

function chatStorageFileName(expiresAtClient, fileId, cleanName) {
  return `${expiresAtClient}-${fileId}-${cleanName}`
}

function parseChatStorageFileName(fileName) {
  const match = String(fileName || '').match(/^(\d+)-([0-9a-f-]{36})-(.+)$/i)
  if (!match) return { expiresAtClient: 0, uploadedAtClient: 0, name: fileName || 'file' }
  const expiresAtClient = Number(match[1] || 0)
  return {
    expiresAtClient,
    uploadedAtClient: expiresAtClient > CHAT_FILE_TTL_MS ? expiresAtClient - CHAT_FILE_TTL_MS : 0,
    name: match[3] || 'file',
  }
}

function metadataFromStorageKey(storageKey, resource = {}) {
  const fileName = String(storageKey).split('/').pop() || String(resource?.name || 'file')
  if (String(storageKey).startsWith(CHAT_FILES_PREFIX)) {
    const parsed = parseChatStorageFileName(fileName)
    return {
      name: parsed.name,
      contentType: String(resource?.mime_type || 'application/octet-stream'),
      size: String(resource?.size || 0),
      expiresAtClient: String(parsed.expiresAtClient || 0),
      uploadedAtClient: String(parsed.uploadedAtClient || 0),
    }
  }

  const avatarName = fileName.replace(/^[0-9a-f-]{36}-/i, '') || 'avatar'
  return {
    name: avatarName,
    contentType: String(resource?.mime_type || 'image/jpeg'),
    size: String(resource?.size || 0),
  }
}

function chatAttachmentKind(contentType) {
  if (String(contentType).startsWith('image/')) return 'image'
  if (String(contentType).startsWith('video/')) return 'video'
  return 'file'
}

function contentDisposition(name) {
  const cleanName = sanitizeFileName(name)
  const fallbackName = cleanName.replace(/[^\x20-\x7E]/g, '_')
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`
}

function publicWorkerFileErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (!message) return 'Не удалось обработать файл.'
  if (/[А-Яа-яЁё]/.test(message)) return message

  const normalizedMessage = message.toLowerCase()
  if (normalizedMessage.includes('too large') || normalizedMessage.includes('413')) {
    return 'Файл слишком большой.'
  }
  if (normalizedMessage.includes('firestore') || normalizedMessage.includes('datastore')) {
    return 'Не удалось проверить доступ. Попробуйте позже.'
  }
  if (normalizedMessage.includes('r2') || normalizedMessage.includes('bucket')) {
    return 'Файловое хранилище временно недоступно.'
  }

  return 'Не удалось обработать файл.'
}

function publicFileErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (!message) return 'Не удалось обработать файл.'
  if (/[А-Яа-яЁё]/.test(message)) return message

  const normalizedMessage = message.toLowerCase()
  if (normalizedMessage.includes('too large') || normalizedMessage.includes('413')) {
    return 'Файл слишком большой.'
  }
  if (normalizedMessage.includes('firestore') || normalizedMessage.includes('datastore')) {
    return 'Не удалось проверить доступ. Попробуйте позже.'
  }
  if (normalizedMessage.includes('r2') || normalizedMessage.includes('bucket')) {
    return 'Файловое хранилище временно недоступно.'
  }

  return 'Не удалось обработать файл.'
}

async function verifyFirebaseIdToken(token, projectId) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    const error = new Error('Некорректная авторизация Firebase.')
    error.httpStatus = 401
    throw error
  }

  const header = JSON.parse(textDecode(base64UrlToBytes(encodedHeader)))
  const payload = JSON.parse(textDecode(base64UrlToBytes(encodedPayload)))
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (header.alg !== 'RS256' || !header.kid) {
    const error = new Error('Некорректная подпись Firebase.')
    error.httpStatus = 401
    throw error
  }
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    const error = new Error('Токен Firebase выпущен не для этого проекта.')
    error.httpStatus = 401
    throw error
  }
  if (!payload.sub || payload.exp <= nowSeconds || payload.iat > nowSeconds + 300) {
    const error = new Error('Сессия Firebase устарела. Войдите заново.')
    error.httpStatus = 401
    throw error
  }

  const jwk = await getFirebasePublicJwk(header.kid)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const signedData = textEncode(`${encodedHeader}.${encodedPayload}`)
  const signature = base64UrlToBytes(encodedSignature)
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedData)

  if (!verified) {
    const error = new Error('Firebase не подтвердил подпись пользователя.')
    error.httpStatus = 401
    throw error
  }

  return payload
}

async function getFirebasePublicJwk(kid) {
  if (!firebaseJwksCache || Date.now() > firebaseJwksExpiresAt) {
    const response = await fetch(FIREBASE_CERTS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })
    if (!response.ok) {
      throw new Error('Не удалось получить публичные ключи Firebase.')
    }

    const cacheControl = response.headers.get('Cache-Control') || ''
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600)
    firebaseJwksCache = await response.json()
    firebaseJwksExpiresAt = Date.now() + Math.max(300, maxAge - 60) * 1000
  }

  const jwk = firebaseJwksCache.keys?.find((item) => item.kid === kid)
  if (!jwk) {
    firebaseJwksCache = null
    firebaseJwksExpiresAt = 0
    throw new Error('Firebase обновил ключи. Повторите действие через несколько секунд.')
  }

  return jwk
}

async function getGoogleAccessToken(env) {
  if (googleAccessTokenCache && Date.now() < googleAccessTokenExpiresAt - 60_000) {
    return googleAccessTokenCache
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const assertion = await signServiceAccountJwt(env, {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FIRESTORE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.access_token) {
    throw new Error(`Не удалось получить доступ к Firestore: ${payload.error_description || response.status}`)
  }

  googleAccessTokenCache = payload.access_token
  googleAccessTokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000
  return googleAccessTokenCache
}

async function signServiceAccountJwt(env, payload) {
  const encodedHeader = base64UrlFromBytes(textEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const encodedPayload = base64UrlFromBytes(textEncode(JSON.stringify(payload)))
  const privateKey = await getServiceAccountPrivateKey(env)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    textEncode(`${encodedHeader}.${encodedPayload}`),
  )

  return `${encodedHeader}.${encodedPayload}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

async function getServiceAccountPrivateKey(env) {
  if (serviceAccountPrivateKeyCache) {
    return serviceAccountPrivateKeyCache
  }

  const pem = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  const keyData = pemToArrayBuffer(pem)
  serviceAccountPrivateKeyCache = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return serviceAccountPrivateKeyCache
}

function firestoreBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`
}

async function firestoreFetch(env, path, options = {}) {
  const token = await getGoogleAccessToken(env)
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  return fetch(path, { ...options, headers })
}

async function getFirestoreDocument(env, documentPath) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}/${documentPath}`, { method: 'GET' })
  if (response.status === 404) return null
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || `Firestore read failed: ${response.status}`)
  }

  return fromFirestoreFields(payload.fields || {})
}

async function patchFirestoreDocument(env, documentPath, data, updateMask = Object.keys(data)) {
  const maskQuery = updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')
  const response = await firestoreFetch(env, `${firestoreBase(env)}/${documentPath}?${maskQuery}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error?.message || `Firestore patch failed: ${response.status}`)
  }

  return fromFirestoreFields(payload.fields || {})
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]))
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue)
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {})
  return null
}

function toFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]))
}

function toFirestoreValue(value) {
  if (value === null || typeof value === 'undefined') return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } }
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value) } }
  }
  return { stringValue: String(value) }
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  return base64ToBytes(base64)
}

function textEncode(value) {
  return new TextEncoder().encode(value)
}

function textDecode(bytes) {
  return new TextDecoder().decode(bytes)
}

function base64UrlToBytes(value) {
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'))
}

function base64ToBytes(value) {
  const normalized = value.padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function base64FromBytes(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function base64UrlFromBytes(bytes) {
  return base64FromBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
