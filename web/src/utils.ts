import { DEFAULT_NOTIFICATION_SETTINGS } from './constants'
import type { CommunityEvent, NotificationSettings, PaymentTransferConfig, RemoteUser, Role } from './types'

export function extractCreatedAt(createdAt: unknown, fallback: unknown): number {
  if (createdAt && typeof createdAt === 'object' && 'seconds' in createdAt) {
    return Number((createdAt as { seconds: number }).seconds) * 1000
  }
  return Number(fallback ?? 0)
}

export function normalizeNotificationSettings(data: unknown): NotificationSettings {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    events: raw.events === undefined ? DEFAULT_NOTIFICATION_SETTINGS.events : Boolean(raw.events),
    chat: raw.chat === undefined ? DEFAULT_NOTIFICATION_SETTINGS.chat : Boolean(raw.chat),
    mentions: raw.mentions === undefined ? DEFAULT_NOTIFICATION_SETTINGS.mentions : Boolean(raw.mentions),
    polls: raw.polls === undefined ? DEFAULT_NOTIFICATION_SETTINGS.polls : Boolean(raw.polls),
    payments: raw.payments === undefined ? DEFAULT_NOTIFICATION_SETTINGS.payments : Boolean(raw.payments),
    system: raw.system === undefined ? DEFAULT_NOTIFICATION_SETTINGS.system : Boolean(raw.system),
  }
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
    notificationSettings: normalizeNotificationSettings(data.notificationSettings),
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
  const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.'
  const normalizedMessage = message.toLowerCase()

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network request failed') ||
    normalizedMessage.includes('network-request-failed') ||
    normalizedMessage.includes('load failed') ||
    normalizedMessage.includes('networkerror')
  ) {
    return 'Не удалось связаться с Firebase. Проверьте интернет, блокировки Google/Firebase и настройки домена в Firebase Authentication.'
  }

  if (normalizedMessage.includes('unauthorized-domain')) {
    return 'Домен веб-версии не разрешен в Firebase Authentication. Добавьте malinkieco.rethavo.ru в список Authorized domains.'
  }

  if (normalizedMessage.includes('invalid-credential')) {
    return 'Неверный логин или пароль. Если вы еще не регистрировались, сначала отправьте заявку на регистрацию.'
  }

  if (normalizedMessage.includes('email-already-in-use')) {
    return 'Для этой почты уже создан аккаунт. Введите правильный пароль или используйте вход.'
  }

  if (normalizedMessage.includes('user-not-found')) {
    return 'Аккаунт не найден. Сначала отправьте заявку на регистрацию.'
  }

  if (normalizedMessage.includes('weak-password')) {
    return 'Пароль слишком простой.'
  }

  if (normalizedMessage.includes('too-many-requests')) {
    return 'Слишком много попыток подряд. Подождите немного и попробуйте снова.'
  }

  if (normalizedMessage.includes('invalid-api-key')) {
    return 'Ошибка настройки Firebase в веб-версии. Проверьте конфигурацию проекта.'
  }

  if (normalizedMessage.includes('operation-not-allowed')) {
    return 'Регистрация по почте пока не включена в Firebase Authentication.'
  }

  if (normalizedMessage.includes('user-disabled')) {
    return 'Этот аккаунт отключен. Обратитесь к администратору.'
  }

  if (normalizedMessage.includes('missing or insufficient permissions')) {
    return 'Недостаточно прав для выполнения действия. Проверьте правила Firestore.'
  }

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
  if (role === 'TESTER') return 'Тестер'
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

