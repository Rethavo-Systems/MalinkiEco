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

// Availability may be deployed separately from opening; do not share endpoint selection.
const GATE_STATUS_API_CONFIG = { ...GATE_API_CONFIG, cacheKey: 'gate-status' }

export type GateOpenResponse = {
  ok: boolean
  error?: string
  cooldownUntilClient?: number
}

export class GateServiceError extends Error {
  readonly serviceUnavailable: boolean
  constructor(message: string, serviceUnavailable: boolean) {
    super(message)
    this.name = 'GateServiceError'
    this.serviceUnavailable = serviceUnavailable
  }
}

export async function checkGateAvailability(): Promise<{ available: boolean; reason: string } | null> {
  const token = await auth?.currentUser?.getIdToken()
  if (!token) throw new Error('Требуется вход')
  const response = await resilientApiFetch(GATE_STATUS_API_CONFIG, '/api/gate/status', {
    headers: { Authorization: `Bearer ${token}` },
  }, { retryOnNetworkError: true, retryOnStatuses: [404], timeoutMs: 15_000 })
  if (response.status === 404) return null
  const data = await response.json()
  if (!response.ok || typeof data.available !== 'boolean') throw new Error('Статус недоступен')
  return { available: data.available, reason: String(data.reason || '') }
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
      { retryOnNetworkError: false, timeoutMs: 20_000 },
    )
  } catch {
    throw new GateServiceError('Сервер ворот недоступен в этой сети. Попробуйте позже.', true)
  }

  const payload = (await response.json().catch(() => ({}))) as GateOpenResponse
  if (!response.ok || !payload.ok) {
    throw new GateServiceError(payload.error || 'Не удалось отправить команду открытия ворот.', response.status >= 500 || response.status === 200)
  }

  return payload
}
