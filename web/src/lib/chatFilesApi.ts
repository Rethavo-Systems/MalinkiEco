import type { ChatAttachment, UserAvatar } from '../types'
import { auth } from './firebase'
import { resilientApiFetch } from './resilientApi'

const CHAT_FILES_API_ENDPOINTS = [
  String(import.meta.env.VITE_CHAT_FILES_API_BASE_URL ?? ''),
  'https://chat-files.rethavo.ru',
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

export async function uploadChatFile(file: File): Promise<ChatAttachment> {
  validateChatFile(file)

  const token = await requireFirebaseToken()
  const formData = new FormData()
  formData.set('file', file)

  let response: Response
  try {
    response = await resilientApiFetch(
      CHAT_FILES_API_CONFIG,
      '/api/chat/files',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      },
      // Uploads are not retried automatically: the first request may have reached storage.
      { retryOnNetworkError: false },
    )
  } catch {
    throw new Error('Не удалось загрузить файл через текущую сеть. Переключите интернет и повторите отправку.')
  }

  const payload = (await response.json().catch(() => ({}))) as ChatFileUploadResponse
  if (!response.ok || !payload.ok || !payload.attachment) {
    throw new Error(payload.error || 'Не удалось загрузить файл.')
  }

  return payload.attachment
}

async function downloadProtectedFile(downloadPath: string): Promise<Blob> {
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await resilientApiFetch(
      CHAT_FILES_API_CONFIG,
      downloadPath,
      { headers: { Authorization: `Bearer ${token}` } },
      { retryOnNetworkError: true, timeoutMs: 60_000 },
    )
  } catch {
    throw new Error('Не удалось скачать файл через текущую сеть. Попробуйте еще раз.')
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Не удалось скачать файл.')
  }

  return response.blob()
}

export async function uploadUserAvatar(file: File): Promise<UserAvatar> {
  validateAvatarFile(file)

  const token = await requireFirebaseToken()
  const formData = new FormData()
  formData.set('file', file)

  let response: Response
  try {
    response = await resilientApiFetch(
      CHAT_FILES_API_CONFIG,
      '/api/chat/avatar',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      },
      { retryOnNetworkError: false },
    )
  } catch {
    throw new Error('Не удалось загрузить аватарку через текущую сеть. Переключите интернет и попробуйте еще раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as AvatarUploadResponse
  if (!response.ok || !payload.ok || !payload.avatar) {
    throw new Error(payload.error || 'Не удалось загрузить аватарку.')
  }

  return payload.avatar
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
    throw new Error('Не удалось удалить аватарку через текущую сеть. Попробуйте еще раз.')
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
    throw new Error('Не удалось удалить файл с Диска через текущую сеть. Попробуйте еще раз.')
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
