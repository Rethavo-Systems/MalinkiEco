import type { ChatAttachment, UserAvatar } from '../types'
import { auth } from './firebase'
import { resilientApiFetch } from './resilientApi'

const CHAT_FILES_API_ENDPOINTS = [
  String(import.meta.env.VITE_CHAT_FILES_API_BASE_URL ?? ''),
  'https://chat-files.rethavo.ru',
  String(import.meta.env.VITE_RU_API_BASE_URL ?? ''),
  'https://malinkieco-chat-files.kiriklass228.workers.dev',
]

const CHAT_FILES_API_CONFIG = {
  cacheKey: 'chat-files',
  candidates: CHAT_FILES_API_ENDPOINTS,
  healthPath: '/api/chat/health',
}

export const CHAT_FILE_MAX_SIZE_BYTES = 25 * 1024 * 1024
export const CHAT_FILE_MAX_COUNT = 6
export const AVATAR_FILE_MAX_SIZE_BYTES = 5 * 1024 * 1024

export type ChatFileUploadResponse = {
  ok: boolean
  error?: string
  attachment?: ChatAttachment
}

export type AvatarUploadResponse = {
  ok: boolean
  error?: string
  avatar?: UserAvatar | null
}

type DirectUploadPreparation = {
  ok: boolean
  error?: string
  uploadUrl?: string
  uploadMethod?: string
  ticket?: string
}

type DirectDownloadResponse = {
  ok: boolean
  error?: string
  downloadUrl?: string
}

async function requireFirebaseToken() {
  const user = auth?.currentUser
  if (!user) {
    throw new Error('Войдите в аккаунт, чтобы работать с файлами.')
  }

  return user.getIdToken()
}

export function validateChatFile(file: File) {
  if (file.size <= 0) {
    throw new Error(`Файл «${file.name}» пустой.`)
  }
  if (file.size > CHAT_FILE_MAX_SIZE_BYTES) {
    throw new Error(`Файл «${file.name}» больше 25 МБ.`)
  }
}

export function validateAvatarFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Выберите изображение для аватарки.')
  }
  if (file.size <= 0) {
    throw new Error(`Файл «${file.name}» пустой.`)
  }
  if (file.size > AVATAR_FILE_MAX_SIZE_BYTES) {
    throw new Error(`Аватарка «${file.name}» больше 5 МБ.`)
  }
}

async function postAuthorizedJson<T>(path: string, body: unknown, timeoutMs = 30_000) {
  const token = await requireFirebaseToken()
  const response = await resilientApiFetch(
    CHAT_FILES_API_CONFIG,
    path,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { retryOnNetworkError: true, timeoutMs },
  )
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error || 'Сервер файлов временно недоступен.')
  }
  return payload
}

async function uploadToTemporaryUrl(file: File, preparation: DirectUploadPreparation) {
  const uploadUrl = String(preparation.uploadUrl || '')
  const uploadMethod = String(preparation.uploadMethod || 'PUT')
  if (!uploadUrl || !preparation.ticket) {
    throw new Error('Сервер не подготовил ссылку для загрузки.')
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: uploadMethod,
        body: file,
      })
      if (!response.ok) {
        throw new Error(`Хранилище отклонило загрузку: ${response.status}`)
      }
      return preparation.ticket
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 800))
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Не удалось передать файл в хранилище.')
}

export async function uploadChatFile(file: File): Promise<ChatAttachment> {
  validateChatFile(file)

  try {
    const preparation = await postAuthorizedJson<DirectUploadPreparation>('/api/chat/files/prepare', {
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
    })
    const ticket = await uploadToTemporaryUrl(file, preparation)
    const payload = await postAuthorizedJson<ChatFileUploadResponse>(
      '/api/chat/files/complete',
      { ticket },
      45_000,
    )
    if (!payload.ok || !payload.attachment) {
      throw new Error(payload.error || 'Не удалось подтвердить загрузку файла.')
    }
    return payload.attachment
  } catch (error) {
    if (error instanceof Error && error.message) throw error
    throw new Error('Не удалось загрузить файл через текущую сеть. Повторите отправку.')
  }
}

async function downloadProtectedFile(downloadPath: string): Promise<Blob> {
  try {
    const payload = await postAuthorizedJson<DirectDownloadResponse>(
      '/api/chat/download-url',
      { downloadPath },
      30_000,
    )
    if (!payload.ok || !payload.downloadUrl) {
      throw new Error(payload.error || 'Хранилище не выдало ссылку для скачивания.')
    }

    const response = await fetch(payload.downloadUrl, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Хранилище временно не отдало файл.')
    }
    return response.blob()
  } catch (error) {
    if (error instanceof Error && error.message) throw error
    throw new Error('Не удалось скачать файл через текущую сеть. Попробуйте ещё раз.')
  }
}

export async function uploadUserAvatar(file: File): Promise<UserAvatar> {
  validateAvatarFile(file)

  try {
    const preparation = await postAuthorizedJson<DirectUploadPreparation>('/api/chat/avatar/prepare', {
      name: file.name,
      size: file.size,
      contentType: file.type,
    })
    const ticket = await uploadToTemporaryUrl(file, preparation)
    const payload = await postAuthorizedJson<AvatarUploadResponse>(
      '/api/chat/avatar/complete',
      { ticket },
      45_000,
    )
    if (!payload.ok || !payload.avatar) {
      throw new Error(payload.error || 'Не удалось подтвердить загрузку аватарки.')
    }
    return payload.avatar
  } catch (error) {
    if (error instanceof Error && error.message) throw error
    throw new Error('Не удалось загрузить аватарку через текущую сеть. Попробуйте ещё раз.')
  }
}

export async function deleteUserAvatar(): Promise<void> {
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await resilientApiFetch(
      CHAT_FILES_API_CONFIG,
      '/api/chat/avatar',
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      { retryOnNetworkError: true, timeoutMs: 30_000 },
    )
  } catch {
    throw new Error('Не удалось удалить аватарку через текущую сеть. Попробуйте ещё раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as AvatarUploadResponse
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Не удалось удалить аватарку.')
  }
}

export async function downloadUserAvatar(downloadPath: string): Promise<Blob> {
  return downloadProtectedFile(downloadPath)
}

export async function downloadChatAttachment(attachment: ChatAttachment): Promise<Blob> {
  return downloadProtectedFile(attachment.downloadPath)
}

export async function deleteChatAttachment(attachment: ChatAttachment): Promise<void> {
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await resilientApiFetch(
      CHAT_FILES_API_CONFIG,
      attachment.downloadPath,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      { retryOnNetworkError: true, timeoutMs: 30_000 },
    )
  } catch {
    throw new Error('Не удалось удалить файл с Диска через текущую сеть. Попробуйте ещё раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Не удалось удалить файл с Диска.')
  }
}

export async function downloadChatAttachmentToDevice(attachment: ChatAttachment) {
  const blob = await downloadChatAttachment(attachment)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
