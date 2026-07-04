const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

const EWELINK_API_HOSTS = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
}

const DEFAULT_GATE_COOLDOWN_MS = 10_000
const DEFAULT_GATE_OPENING_LOCK_MS = 30_000
const GATE_DEBT_BLOCK_THRESHOLD = -5000

let firebaseJwksCache = null
let firebaseJwksExpiresAt = 0
let googleAccessTokenCache = null
let googleAccessTokenExpiresAt = 0
let serviceAccountPrivateKeyCache = null

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return jsonResponse({}, 204, request, env)
    }

    if (request.method === 'GET' && url.pathname === '/api/gate/health') {
      return jsonResponse({ ok: true, service: 'malinkieco-gate-worker' }, 200, request, env)
    }

    if (request.method !== 'POST' || url.pathname !== '/api/gate/open') {
      return jsonResponse({ ok: false, error: 'Маршрут не найден.' }, 404, request, env)
    }

    return openGate(request, env)
  },
}

async function openGate(request, env) {
  let claimedOpeningLockUntilClient = 0

  try {
    assertRequiredEnv(env)

    const authHeader = request.headers.get('Authorization') || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!idToken) {
      return jsonResponse({ ok: false, error: 'Войдите в аккаунт, чтобы открыть ворота.' }, 401, request, env)
    }

    const decodedToken = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID)
    const actorId = decodedToken.sub
    const [actorDoc, gateDoc] = await Promise.all([
      getFirestoreDocument(env, `users/${actorId}`),
      getFirestoreDocument(env, 'app_settings/app_gate'),
    ])

    if (!actorDoc) {
      return jsonResponse({ ok: false, error: 'Профиль пользователя не найден.' }, 403, request, env)
    }

    const actorRole = String(actorDoc.role || 'USER')
    const actorName = String(actorDoc.fullName || decodedToken.name || 'Пользователь')
    const actorBalance = Number(actorDoc.balance || 0)
    const actorPlotName = Array.isArray(actorDoc.plots) && actorDoc.plots.length > 0
      ? actorDoc.plots.map(String).filter(Boolean).join(', ')
      : String(actorDoc.plotName || '')

    if (!['USER', 'MODERATOR', 'ADMIN', 'TESTER'].includes(actorRole)) {
      return jsonResponse({ ok: false, error: 'Недостаточно прав для открытия ворот.' }, 403, request, env)
    }

    if (actorRole !== 'ADMIN' && actorBalance <= GATE_DEBT_BLOCK_THRESHOLD) {
      return jsonResponse(
        { ok: false, error: 'Открытие ворот недоступно при задолженности от 5 000 ₽.' },
        403,
        request,
        env,
      )
    }

    if (Boolean(gateDoc?.maintenanceEnabled) && !['ADMIN', 'TESTER'].includes(actorRole)) {
      return jsonResponse({ ok: false, error: 'Сайт находится в режиме технических работ.' }, 503, request, env)
    }

    const now = Date.now()
    const cooldownMs = Math.max(DEFAULT_GATE_COOLDOWN_MS, Number(env.EWELINK_GATE_GLOBAL_COOLDOWN_MS || 0))
    const openingLockMs = Math.max(
      cooldownMs,
      Number(env.EWELINK_GATE_OPENING_LOCK_MS || DEFAULT_GATE_OPENING_LOCK_MS),
    )
    const transaction = await beginFirestoreTransaction(env)

    try {
      const statusDoc = await getFirestoreDocument(env, 'app_settings/gate_status', transaction)
      const cooldownUntilClient = Number(statusDoc?.cooldownUntilClient || 0)
      const openingLockUntilClient = Number(statusDoc?.openingLockUntilClient || 0)

      if (cooldownUntilClient > now) {
        await rollbackFirestoreTransaction(env, transaction)
        const waitSeconds = Math.ceil((cooldownUntilClient - now) / 1000)
        return jsonResponse(
          {
            ok: false,
            error: `Ворота уже открывали. Подождите ${waitSeconds} сек.`,
            cooldownUntilClient,
          },
          429,
          request,
          env,
        )
      }

      if (openingLockUntilClient > now) {
        await rollbackFirestoreTransaction(env, transaction)
        const waitSeconds = Math.ceil((openingLockUntilClient - now) / 1000)
        return jsonResponse(
          {
            ok: false,
            error: `Активация уже выполняется. Подождите ${waitSeconds} сек.`,
            openingLockUntilClient,
          },
          429,
          request,
          env,
        )
      }

      claimedOpeningLockUntilClient = now + openingLockMs
      await commitFirestoreTransaction(env, transaction, [
        setWrite(env, 'app_settings/gate_status', {
          status: 'OPENING',
          cooldownUntilClient,
          openingLockUntilClient: claimedOpeningLockUntilClient,
          lastOpenedAtClient: now,
          lastOpenedById: actorId,
          lastOpenedByName: actorName,
          lastOpenedByRole: actorRole,
          lastError: '',
          updatedAtClient: now,
        }),
      ])
    } catch (error) {
      if (error?.transactionRolledBack) {
        throw error.cause || error
      }
      await rollbackFirestoreTransaction(env, transaction).catch(() => undefined)
      throw error
    }

    await openEwelinkGate(env)

    const finalCooldownUntilClient = Date.now() + cooldownMs
    await Promise.all([
      setFirestoreDocument(env, 'app_settings/gate_status', {
        status: 'COOLDOWN',
        cooldownUntilClient: finalCooldownUntilClient,
        openingLockUntilClient: 0,
        lastOpenedAtClient: now,
        lastOpenedById: actorId,
        lastOpenedByName: actorName,
        lastOpenedByRole: actorRole,
        lastError: '',
        updatedAtClient: Date.now(),
      }),
      createFirestoreDocument(env, 'audit_logs', {
        actorId,
        actorName,
        actorRole,
        title: 'Активация ворот',
        message: 'Пользователь активировал кнопку открытия ворот.',
        targetUserId: actorId,
        targetUserName: actorName,
        targetPlotName: actorPlotName,
        createdAt: new Date(),
        createdAtClient: Date.now(),
      }),
    ])

    return jsonResponse({ ok: true, cooldownUntilClient: finalCooldownUntilClient }, 200, request, env)
  } catch (error) {
    if (claimedOpeningLockUntilClient > 0) {
      await setFirestoreDocument(env, 'app_settings/gate_status', {
        status: 'ERROR',
        cooldownUntilClient: 0,
        openingLockUntilClient: 0,
        lastError: publicGateErrorMessage(error),
        updatedAtClient: Date.now(),
      }).catch(() => undefined)
    }

    console.error('[gate-worker] open failed', error)
    return jsonResponse(
      { ok: false, error: publicGateErrorMessage(error) },
      Number(error?.httpStatus || 500),
      request,
      env,
    )
  }
}

function assertRequiredEnv(env) {
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'EWELINK_APP_ID',
    'EWELINK_APP_SECRET',
    'EWELINK_DEVICE_ID',
    'EWELINK_REGION',
    'EWELINK_ACCESS_TOKEN',
    'EWELINK_REFRESH_TOKEN',
  ]

  const missing = required.filter((key) => !String(env[key] || '').trim())
  if (missing.length > 0) {
    const error = new Error(`Cloudflare Worker не настроен: ${missing.join(', ')}`)
    error.httpStatus = 503
    throw error
  }
}

function jsonResponse(payload, status, request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowedOrigin = String(env.APP_ORIGIN || 'https://malinkieco.rethavo.ru').trim()
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  if (origin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }

  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers })
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

function firestoreDocName(env, documentPath) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${documentPath}`
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

async function getFirestoreDocument(env, documentPath, transaction) {
  if (transaction) {
    const response = await firestoreFetch(env, `${firestoreBase(env)}:batchGet`, {
      method: 'POST',
      body: JSON.stringify({
        documents: [firestoreDocName(env, documentPath)],
        transaction,
      }),
    })
    const [payload] = await response.json().catch(() => [{}])
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Firestore transaction read failed: ${response.status}`)
    }
    return payload?.found ? fromFirestoreFields(payload.found.fields || {}) : null
  }

  const response = await firestoreFetch(env, `${firestoreBase(env)}/${documentPath}`, { method: 'GET' })
  if (response.status === 404) return null
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || `Firestore read failed: ${response.status}`)
  }

  return fromFirestoreFields(payload.fields || {})
}

async function setFirestoreDocument(env, documentPath, data) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}/${documentPath}?currentDocument.exists=true`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  })

  if (response.status === 404) {
    const createResponse = await firestoreFetch(env, `${firestoreBase(env)}/${documentPath}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    })
    if (!createResponse.ok) {
      const payload = await createResponse.json().catch(() => ({}))
      throw new Error(payload.error?.message || `Firestore create failed: ${createResponse.status}`)
    }
    return
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error?.message || `Firestore update failed: ${response.status}`)
  }
}

async function createFirestoreDocument(env, collectionPath, data) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}/${collectionPath}`, {
    method: 'POST',
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error?.message || `Firestore create failed: ${response.status}`)
  }
}

async function beginFirestoreTransaction(env) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}:beginTransaction`, {
    method: 'POST',
    body: JSON.stringify({ options: { readWrite: {} } }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.transaction) {
    throw new Error(payload.error?.message || 'Не удалось начать Firestore transaction.')
  }
  return payload.transaction
}

async function commitFirestoreTransaction(env, transaction, writes) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}:commit`, {
    method: 'POST',
    body: JSON.stringify({ transaction, writes }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error?.message || `Firestore commit failed: ${response.status}`)
  }
}

async function rollbackFirestoreTransaction(env, transaction) {
  const response = await firestoreFetch(env, `${firestoreBase(env)}:rollback`, {
    method: 'POST',
    body: JSON.stringify({ transaction }),
  })
  if (!response.ok) {
    const error = new Error(`Firestore rollback failed: ${response.status}`)
    error.transactionRolledBack = true
    throw error
  }
}

function setWrite(env, documentPath, data) {
  return {
    update: {
      name: firestoreDocName(env, documentPath),
      fields: toFirestoreFields(data),
    },
  }
}

function toFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]))
}

function toFirestoreValue(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } }
  }
  if (value && typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value) } }
  }
  return { nullValue: null }
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

async function loadEwelinkTokens(env) {
  const savedTokens = await getFirestoreDocument(env, 'private_settings/ewelink_gate')
  if (savedTokens?.refreshToken) {
    return {
      region: String(savedTokens.region || env.EWELINK_REGION || '').trim().toLowerCase(),
      accessToken: String(savedTokens.accessToken || '').trim(),
      refreshToken: String(savedTokens.refreshToken || '').trim(),
      atExpiredTime: Number(savedTokens.atExpiredTime || 0),
      rtExpiredTime: Number(savedTokens.rtExpiredTime || 0),
    }
  }

  const envTokens = {
    region: String(env.EWELINK_REGION || '').trim().toLowerCase(),
    accessToken: String(env.EWELINK_ACCESS_TOKEN || '').trim(),
    refreshToken: String(env.EWELINK_REFRESH_TOKEN || '').trim(),
    atExpiredTime: Number(env.EWELINK_AT_EXPIRED_TIME || 0),
    rtExpiredTime: Number(env.EWELINK_RT_EXPIRED_TIME || 0),
  }

  await setFirestoreDocument(env, 'private_settings/ewelink_gate', {
    ...envTokens,
    updatedAtClient: Date.now(),
  })
  return envTokens
}

async function saveEwelinkTokens(env, tokens) {
  await setFirestoreDocument(env, 'private_settings/ewelink_gate', {
    region: tokens.region,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    atExpiredTime: Number(tokens.atExpiredTime || 0),
    rtExpiredTime: Number(tokens.rtExpiredTime || 0),
    updatedAtClient: Date.now(),
  })
}

async function getValidEwelinkTokens(env) {
  const tokens = await loadEwelinkTokens(env)
  if (!tokens.region) {
    throw new Error('Регион eWeLink не настроен.')
  }
  if (!tokens.accessToken || (tokens.atExpiredTime && tokens.atExpiredTime - Date.now() < 60_000)) {
    return refreshEwelinkTokens(env, tokens)
  }
  return tokens
}

async function refreshEwelinkTokens(env, tokens) {
  const response = await ewelinkRequest(env, {
    region: tokens.region,
    method: 'POST',
    path: '/v2/user/refresh',
    body: { rt: tokens.refreshToken },
    signed: true,
  })

  const now = Date.now()
  const refreshed = {
    region: tokens.region,
    accessToken: String(response.at || '').trim(),
    refreshToken: String(response.rt || '').trim(),
    atExpiredTime: Number(response.atExpiredTime || now + 29 * 24 * 60 * 60 * 1000),
    rtExpiredTime: Number(response.rtExpiredTime || now + 59 * 24 * 60 * 60 * 1000),
  }

  if (!refreshed.accessToken || !refreshed.refreshToken) {
    throw new Error('eWeLink не вернул обновленные токены.')
  }

  await saveEwelinkTokens(env, refreshed)
  return refreshed
}

async function openEwelinkGate(env) {
  await setEwelinkGateSwitch(env, 'on')
  await new Promise((resolve) => setTimeout(resolve, 700))

  try {
    await setEwelinkGateSwitch(env, 'off')
  } catch (error) {
    console.warn('[gate-worker] fallback switch-off failed', error?.message || error)
  }
}

async function setEwelinkGateSwitch(env, value) {
  let tokens = await getValidEwelinkTokens(env)
  try {
    await ewelinkRequest(env, {
      region: tokens.region,
      method: 'POST',
      path: '/v2/device/thing/status',
      body: {
        type: 1,
        id: env.EWELINK_DEVICE_ID,
        params: { switch: value },
      },
      accessToken: tokens.accessToken,
    })
  } catch (error) {
    if (error.errorCode !== 401 && error.errorCode !== 402) {
      throw error
    }

    tokens = await refreshEwelinkTokens(env, tokens)
    await ewelinkRequest(env, {
      region: tokens.region,
      method: 'POST',
      path: '/v2/device/thing/status',
      body: {
        type: 1,
        id: env.EWELINK_DEVICE_ID,
        params: { switch: value },
      },
      accessToken: tokens.accessToken,
    })
  }
}

async function ewelinkRequest(env, { region, method = 'GET', path, query, body, accessToken, signed = false }) {
  const host = EWELINK_API_HOSTS[String(region || '').trim().toLowerCase()]
  if (!host) {
    throw new Error('Регион eWeLink не настроен.')
  }

  const url = new URL(path, host)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const headers = { 'X-CK-Appid': env.EWELINK_APP_ID }
  const request = { method, headers }

  if (body !== undefined) {
    const bodyText = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
    request.body = bodyText
    if (signed) {
      headers.Authorization = `Sign ${await signHmacSha256(bodyText, env.EWELINK_APP_SECRET)}`
    }
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  const response = await fetch(url, request)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.error !== 0) {
    const error = new Error(translateEwelinkError(payload.error, payload.msg))
    error.errorCode = payload.error
    error.httpStatus = response.status
    throw error
  }

  return payload.data || {}
}

function translateEwelinkError(code, message) {
  if (code === 30022) return 'Модуль ворот сейчас офлайн. Попробуйте позже.'
  if (code === 4002) return 'eWeLink не принял команду. Проверьте, что устройство Door онлайн.'
  if (code === 401 || code === 402) return 'Серверу нужно обновить доступ eWeLink. Попробуйте еще раз.'
  if (code === 412) return 'eWeLink временно ограничил частые запросы. Подождите немного.'
  return message || 'eWeLink не принял команду открытия ворот.'
}

function publicGateErrorMessage(error) {
  const message = String(error?.publicMessage || error?.message || '').trim()

  if (!message) return 'Не удалось открыть ворота. Попробуйте позже.'
  if (/[А-Яа-яЁё]/.test(message)) return message

  const normalizedMessage = message.toLowerCase()
  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('fetch failed') ||
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('timeout')
  ) {
    return 'Не удалось связаться с сервером ворот. Попробуйте позже.'
  }
  if (
    normalizedMessage.includes('firestore') ||
    normalizedMessage.includes('datastore') ||
    normalizedMessage.includes('transaction') ||
    normalizedMessage.includes('commit')
  ) {
    return 'Не удалось связаться с базой данных. Попробуйте позже.'
  }
  if (normalizedMessage.includes('google') || normalizedMessage.includes('oauth')) {
    return 'Не удалось подтвердить служебный доступ. Попробуйте позже.'
  }

  return 'Не удалось открыть ворота. Попробуйте позже.'
}

async function signHmacSha256(message, secret) {
  const key = await crypto.subtle.importKey('raw', textEncode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, textEncode(message))
  return base64FromBytes(new Uint8Array(signature))
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
