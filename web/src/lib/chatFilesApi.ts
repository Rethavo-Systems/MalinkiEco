import type { ChatAttachment, UserAvatar } from '../types'
import { auth } from './firebase'

const PRODUCTION_CHAT_FILES_API_BASE_URL = 'https://chat-files.rethavo.ru'

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

function apiBaseUrl() {
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'malinkieco.rethavo.ru' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost')
  ) {
    return PRODUCTION_CHAT_FILES_API_BASE_URL
  }

  return String(import.meta.env.VITE_CHAT_FILES_API_BASE_URL ?? '').trim().replace(/\/$/, '')
}

function requireApiBaseUrl() {
  const baseUrl = apiBaseUrl()
  if (!baseUrl && typeof window !== 'undefined' && window.location.hostname !== 'malinkieco.rethavo.ru') {
    throw new Error('Файловый сервер чата пока не настроен для локальной версии.')
  }
  return baseUrl
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

  const baseUrl = requireApiBaseUrl()
  const token = await requireFirebaseToken()
  const formData = new FormData()
  formData.set('file', file)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/chat/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  } catch {
    throw new Error('Не удалось загрузить файл. Проверьте интернет и попробуйте еще раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as ChatFileUploadResponse
  if (!response.ok || !payload.ok || !payload.attachment) {
    throw new Error(payload.error || 'Не удалось загрузить файл.')
  }

  return payload.attachment
}

async function downloadProtectedFile(downloadPath: string): Promise<Blob> {
  const baseUrl = requireApiBaseUrl()
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await fetch(`${baseUrl}${downloadPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('Не удалось скачать файл. Проверьте интернет и попробуйте еще раз.')
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Не удалось скачать файл.')
  }

  return response.blob()
}

export async function uploadUserAvatar(file: File): Promise<UserAvatar> {
  validateAvatarFile(file)

  const baseUrl = requireApiBaseUrl()
  const token = await requireFirebaseToken()
  const formData = new FormData()
  formData.set('file', file)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/chat/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  } catch {
    throw new Error('Не удалось загрузить аватарку. Проверьте интернет и попробуйте еще раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as AvatarUploadResponse
  if (!response.ok || !payload.ok || !payload.avatar) {
    throw new Error(payload.error || 'Не удалось загрузить аватарку.')
  }

  return payload.avatar
}

export async function deleteUserAvatar(): Promise<void> {
  const baseUrl = requireApiBaseUrl()
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/chat/avatar`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('Не удалось удалить аватарку. Проверьте интернет и попробуйте еще раз.')
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
  const baseUrl = requireApiBaseUrl()
  const token = await requireFirebaseToken()

  let response: Response
  try {
    response = await fetch(`${baseUrl}${attachment.downloadPath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('Не удалось удалить файл с Диска. Проверьте интернет и попробуйте еще раз.')
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
