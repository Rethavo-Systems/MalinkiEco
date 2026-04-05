import type { AuthFormState, PaymentTransferConfig, PollDraft, TabKey } from './types'

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
}

export const TAB_LABELS: Record<TabKey, string> = {
  events: 'Объявления',
  chat: 'Чат',
  owners: 'Собственники',
  polls: 'Опросы',
  payments: 'Оплата',
  logs: 'Логи',
}
