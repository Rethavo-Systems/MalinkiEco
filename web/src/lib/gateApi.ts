import { auth } from './firebase'
import { resilientApiFetch } from './resilientApi'

const GATE_API_ENDPOINTS = [
  String(import.meta.env.VITE_RU_API_BASE_URL ?? ''),
  String(import.meta.env.VITE_APP_API_BASE_URL ?? ''),
  'https://gate.rethavo.ru',
  'https://malinkieco-gate.kiriklass228.workers.dev',
]

const GATE_API_CONFIG = {
  cacheKey: 'gate',
  candidates: GATE_API_ENDPOINTS,
  healthPath: '/api/gate/health',
}

export type GateOpenResponse = {
  ok: boolean
  error?: string
  cooldownUntilClient?: number
}

export async function openGate() {
  const user = auth?.currentUser
  if (!user) {
    throw new Error('Войдите в аккаунт, чтобы открыть ворота.')
  }

  const token = await user.getIdToken()
  let response: Response

  try {
    response = await resilientApiFetch(
      GATE_API_CONFIG,
      '/api/gate/open',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      { retryOnNetworkError: true, timeoutMs: 20_000 },
    )
  } catch {
    throw new Error('Сервер ворот недоступен в этой сети. Переключите интернет и попробуйте еще раз.')
  }

  const payload = (await response.json().catch(() => ({}))) as GateOpenResponse
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Не удалось отправить команду открытия ворот.')
  }

  return payload
}
