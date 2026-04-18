import type { AuthFormState, NotificationSettings, PaymentTransferConfig, PollDraft, TabKey } from './types'

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  events: true,
  chat: true,
  mentions: true,
  polls: true,
  payments: true,
  requests: true,
  system: true,
}

export const SUPPORT_EMAIL = 'info@rethavo.ru'

export const EMPTY_PAYMENT_CONFIG: PaymentTransferConfig = {
  recipientName: '',
  recipientPhone: '',
  bankName: '',
  accountNumber: '',
  paymentPurpose: '',
  bik: '',
  correspondentAccount: '',
  recipientInn: '',
  recipientKpp: '',
  sbpLink: '',
}

export const INITIAL_AUTH_FORM: AuthFormState = {
  login: '',
  password: '',
  fullName: '',
  phone: '',
  plots: '',
  verificationCode: '',
}

export const INITIAL_POLL_DRAFT: PollDraft = {
  title: '',
  message: '',
  options: '',
  isAnonymous: false,
}

export const TAB_LABELS: Record<TabKey, string> = {
  events: 'Объявления',
  chat: 'Чат',
  owners: 'Собственники',
  polls: 'Опросы',
  payments: 'Оплата',
  logs: 'Логи',
}
