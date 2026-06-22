import { auth } from './firebase'

export type GateOpenResponse = {
  ok: boolean
  error?: string
  cooldownUntilClient?: number
}

function apiBaseUrl() {
  return String(import.meta.env.VITE_APP_API_BASE_URL ?? '').trim().replace(/\/$/, '')
}

export async function openGate() {
  const user = auth?.currentUser
  if (!user) {
    throw new Error('Войдите в аккаунт, чтобы открыть ворота.')
  }

  const baseUrl = apiBaseUrl()
  const token = await user.getIdToken()
  const response = await fetch(`${baseUrl}/api/gate/open`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  const payload = (await response.json().catch(() => ({}))) as GateOpenResponse
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Не удалось отправить команду открытия ворот.')
  }

  return payload
}
