import type { CommunityEvent, PaymentTransferConfig, RemoteUser, Role } from './types'

export function extractCreatedAt(createdAt: unknown, fallback: unknown): number {
  if (createdAt && typeof createdAt === 'object' && 'seconds' in createdAt) {
    return Number((createdAt as { seconds: number }).seconds) * 1000
  }
  return Number(fallback ?? 0)
}

export function toRemoteUser(id: string, data: Record<string, unknown>): RemoteUser | null {
  const email = String(data.email ?? '')
  const fullName = String(data.fullName ?? '')
  const role = String(data.role ?? 'USER') as Role
  if (!email || !fullName) return null

  return {
    id,
    email,
    fullName,
    plotName: String(data.plotName ?? ''),
    plots: Array.isArray(data.plots) ? data.plots.map(String).filter(Boolean) : [],
    role,
    balance: Number(data.balance ?? 0),
    lastChatReadAt: Number(data.lastChatReadAt ?? 0),
    phone: String(data.phone ?? ''),
    login: String(data.login ?? ''),
  }
}

export function normalizeAuthEmail(value: string): string {
  return value.includes('@') ? value : `${value}@malinkieco.local`
}

export function parsePlots(value: string): string[] {
  return value
    .split(',')
    .map((plot) => plot.trim())
    .filter(Boolean)
    .map((plot) => plot.replace(/^участок\s*/i, '').trim())
    .filter(Boolean)
}

export function normalizeRussianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `8${digits}`
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return `8${digits.slice(1)}`
  }
  return digits
}

export function isValidRussianPhoneInput(raw: string): boolean {
  return raw.replace(/\D/g, '').length === 10
}

export function formatRussianPhone(raw: string): string {
  const normalized = normalizeRussianPhone(raw)
  if (normalized.length !== 11 || !normalized.startsWith('8')) {
    return raw
  }

  return `8 (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`
}

export function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие'

  if (message.includes('invalid-credential')) {
    return 'Неверный логин или пароль. Если вы еще не регистрировались, сначала отправьте заявку на регистрацию.'
  }
  if (message.includes('email-already-in-use')) return 'Такой логин уже зарегистрирован'
  if (message.includes('user-not-found')) return 'Аккаунт не найден. Сначала отправьте заявку на регистрацию.'
  if (message.includes('weak-password')) return 'Пароль слишком простой'

  return message
}

export function formatPlots(user: Pick<RemoteUser, 'plotName' | 'plots'>): string {
  const normalizedPlots = user.plots
    .map((plot) => plot.trim())
    .filter(Boolean)
    .map((plot) => plot.replace(/^участок\s*/i, '').trim())

  if (normalizedPlots.length > 0) {
    return `Участок ${normalizedPlots.join(', ')}`
  }

  const normalizedSingle = user.plotName.trim().replace(/^участок\s*/i, '').trim()
  return normalizedSingle ? `Участок ${normalizedSingle}` : ''
}

export function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function labelForEventType(item: CommunityEvent): string {
  if (item.type === 'CHARGE') return item.isClosed ? 'Сбор завершен' : 'Сбор средств'
  if (item.type === 'EXPENSE') return 'Оплата'
  return 'Объявление'
}

export function balanceTone(balance: number): string {
  if (balance < 0) return 'is-debt'
  if (balance > 0) return 'is-overpaid'
  return 'is-clear'
}

export function balanceLabel(balance: number): string {
  if (balance < 0) return 'Есть задолженность'
  if (balance > 0) return 'Есть переплата'
  return 'Задолженности нет'
}

export function roleLabel(role: Role): string {
  if (role === 'ADMIN') return 'Администратор'
  if (role === 'MODERATOR') return 'Модератор'
  return 'Собственник'
}

export function paymentDetails(config: PaymentTransferConfig) {
  return [
    { label: 'Получатель', value: config.recipientName },
    { label: 'Телефон получателя', value: config.recipientPhone },
    { label: 'Банк', value: config.bankName },
    { label: 'Номер счета', value: config.accountNumber },
    { label: 'Назначение платежа', value: config.paymentPurpose },
    { label: 'БИК', value: config.bik },
    { label: 'Корр. счет', value: config.correspondentAccount },
    { label: 'ИНН', value: config.recipientInn },
    { label: 'КПП', value: config.recipientKpp },
    { label: 'Ссылка на оплату', value: config.sbpLink },
  ]
}

export function hasAnyPaymentDetails(config: PaymentTransferConfig): boolean {
  return paymentDetails(config).some((item) => item.value.trim())
}
