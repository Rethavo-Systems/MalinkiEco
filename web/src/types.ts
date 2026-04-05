export type Role = 'USER' | 'MODERATOR' | 'ADMIN'
export type EventType = 'INFO' | 'CHARGE' | 'EXPENSE' | 'POLL'
export type TabKey = 'events' | 'chat' | 'owners' | 'polls' | 'payments' | 'logs'
export type AuthMode = 'login' | 'register'
export type ManualPaymentStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'
export type RegistrationRequestStatus = 'VERIFYING' | 'VERIFIED' | 'PENDING' | 'APPROVED' | 'REJECTED'

export type RemoteUser = {
  id: string
  email: string
  fullName: string
  plotName: string
  plots: string[]
  role: Role
  balance: number
  lastChatReadAt: number
  phone?: string
  login?: string
}

export type CommunityEvent = {
  id: string
  title: string
  message: string
  type: EventType
  amount: number
  isClosed: boolean
  pollOptions: string[]
  pollVotes: Record<string, number>
  voterIds: string[]
  voterChoices: Record<string, string>
  targetUserId: string
  createdById: string
  createdByName: string
  createdAtClient: number
}

export type ChatMessage = {
  id: string
  senderId: string
  senderName: string
  senderPlotName: string
  text: string
  replyToMessageId: string
  replyToSenderName: string
  replyToSenderPlotName: string
  replyToText: string
  isPinned: boolean
  pinnedAtClient: number
  createdAtClient: number
  updatedAtClient: number
}

export type PaymentTransferConfig = {
  recipientName: string
  recipientPhone: string
  bankName: string
  accountNumber: string
  paymentPurpose: string
  bik: string
  correspondentAccount: string
  recipientInn: string
  recipientKpp: string
  sbpLink: string
}

export type ManualPaymentRequest = {
  id: string
  userId: string
  userName: string
  plotName: string
  amount: number
  eventId: string
  eventTitle: string
  purpose: string
  status: ManualPaymentStatus
  createdAtClient: number
  reviewedByName: string
  reviewReason: string
}

export type RegistrationRequest = {
  id: string
  login: string
  authEmail: string
  fullName: string
  phone: string
  plots: string[]
  status: RegistrationRequestStatus
  createdAtClient: number
  reviewedByName: string
  reviewReason: string
}

export type AuditLogEntry = {
  id: string
  actorId: string
  actorName: string
  actorRole: Role
  title: string
  message: string
  targetUserId: string
  targetUserName: string
  targetPlotName: string
  createdAtClient: number
}

export type AuthFormState = {
  login: string
  password: string
  fullName: string
  phone: string
  plots: string
  verificationCode: string
}

export type PollDraft = {
  title: string
  message: string
  options: string
}
