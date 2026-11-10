import { pendingRequestCount, isPersonalEventVisible } from './lib/navigationState'
import { canReadVisibleContent } from './lib/readVisibility'
import { staffRecipients, notificationEmailTargets } from './lib/notificationRecipients'
﻿import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { signOut } from 'firebase/auth'
import { createPortal } from 'react-dom'
import { auth, db, firebaseSetup, rtdb } from './lib/firebase'
import {
  approveRegistrationRequest as approveRegistrationRequestAction,
  closePoll as closePollRequest,
  closeCharge as closeChargeRequest,
  confirmPaymentRequest as confirmPaymentRequestAction,
  createEvent as createEventRequest,
  createPaymentRequest as createPaymentRequestRequest,
  deleteUserRecord,
  enqueueBroadcastNotification,
  enqueueEmailNotification,
  enqueueTargetedNotification,
  markChatRead as markChatReadRequest,
  rejectPaymentRequest as rejectPaymentRequestAction,
  rejectRegistrationRequest as rejectRegistrationRequestAction,
  removeChatMessage as removeChatMessageRequest,
  saveEditedChatMessage,
  savePaymentConfig as savePaymentConfigRequest,
  submitProfileChangeRequest as submitProfileChangeRequestAction,
  submitSupportRequest as submitSupportRequestAction,
  sendChatMessage as sendChatMessageRequest,
  setUserBalance as setUserBalanceAction,
  updateEvent as updateEventRequest,
  updateNotificationSettings as updateNotificationSettingsAction,
  setUserRole as setUserRoleAction,
  submitPoll as submitPollRequest,
  togglePinnedChatMessage,
  toggleChatReaction,
  voteInPoll as voteInPollRequest,
} from './lib/appApi'
import { INITIAL_POLL_DRAFT, SUPPORT_EMAIL } from './constants'
import { AccountSettingsPanel } from './components/AccountSettingsPanel'
import { AuthScreen } from './components/AuthScreen'
import { EventsSection } from './components/EventsSection'
import { LogsSection } from './components/LogsSection'
import { MaintenanceScreen } from './components/MaintenanceScreen'
import { OwnersSection } from './components/OwnersSection'
import { PaymentsSection } from './components/PaymentsSection'
import { PollsSection } from './components/PollsSection'
import { ResidentChat } from './components/ResidentChat'
import { SetupScreen } from './components/SetupScreen'
import { SiteFooter } from './components/SiteFooter'
import { SplashScreen } from './components/SplashScreen'
import { SupportPanel } from './components/SupportPanel'
import { useAppGate } from './hooks/useAppGate'
import { useFirebaseAuthState } from './hooks/useFirebaseAuthState'
import { useGateStatus } from './hooks/useGateStatus'
import { useGateAvailability } from './hooks/useGateAvailability'
import { usePageNotice } from './hooks/usePageNotice'
import { useResidentAuth } from './hooks/useResidentAuth'
import { useResidentData } from './hooks/useResidentData'
import { useResidentProfile } from './hooks/useResidentProfile'
import { useWebPush } from './hooks/useWebPush'
import { useAvatarObjectUrl } from './hooks/useAvatarObjectUrl'
import {
  AVATAR_FILE_MAX_SIZE_BYTES,
  deleteChatAttachment,
  deleteUserAvatar,
  uploadChatFile,
  uploadUserAvatar,
} from './lib/chatFilesApi'
import { GateServiceError, openGate as openGateRequest } from './lib/gateApi'
import { clearRequestedTabFromUrl, readRequestedTabFromUrl } from './lib/webPush'
import type {
  ChatMessage,
  ChatAttachment,
  CommunityEvent,
  EventType,
  ManualPaymentRequest,
  PollDraft,
  RegistrationRequest,
  RemoteUser,
  Role,
  TabKey,
} from './types'
import {
  balanceLabel,
  balanceTone,
  formatDateTime,
  formatPlots,
  hasAnyPaymentDetails,
  labelForEventType,
  paymentDetails,
  roleLabel,
} from './utils'
import { AppNavigation } from './components/AppNavigation'
import './App.css'
import './AppModern.css'

const EVENT_EMAIL_FOOTER =
  'Рекомендуем открыть MalinkiEco, чтобы ознакомиться с деталями события и актуальной информацией.'
const TAB_BADGE_STORAGE_PREFIX = 'malinkieco.tabSeen.v1'
const GATE_DEBT_BLOCK_THRESHOLD = -5000
const GATE_UI_COOLDOWN_MS = 10_000
const AVATAR_CROP_VIEWPORT_SIZE = 280
const AVATAR_CROP_OUTPUT_SIZE = 512
const AVATAR_CROP_MIN_ZOOM = 1
const AVATAR_CROP_MAX_ZOOM = 3

type TabSeenState = Record<TabKey, number>
type AvatarCropDraft = {
  brightness: number
  previewUrl: string
  zoom: number
  offsetX: number
  offsetY: number
  naturalWidth: number
  naturalHeight: number
}
type AvatarCropDragState = {
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
}
type AvatarCropMetrics = {
  naturalWidth: number
  naturalHeight: number
  renderedWidth: number
  renderedHeight: number
  left: number
  top: number
}

function userInitials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return 'ML'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function emptySeenState(): TabSeenState {
  return {
    events: 0,
    chat: 0,
    owners: 0,
    polls: 0,
    payments: 0,
    logs: 0,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getAvatarCropMetrics(crop: AvatarCropDraft): AvatarCropMetrics {
  const naturalWidth = crop.naturalWidth > 0 ? crop.naturalWidth : AVATAR_CROP_VIEWPORT_SIZE
  const naturalHeight = crop.naturalHeight > 0 ? crop.naturalHeight : AVATAR_CROP_VIEWPORT_SIZE
  const fitScale = Math.max(AVATAR_CROP_VIEWPORT_SIZE / naturalWidth, AVATAR_CROP_VIEWPORT_SIZE / naturalHeight)
  const zoom = clamp(crop.zoom, AVATAR_CROP_MIN_ZOOM, AVATAR_CROP_MAX_ZOOM)
  const renderedWidth = naturalWidth * fitScale * zoom
  const renderedHeight = naturalHeight * fitScale * zoom

  return {
    naturalWidth,
    naturalHeight,
    renderedWidth,
    renderedHeight,
    left: (AVATAR_CROP_VIEWPORT_SIZE - renderedWidth) / 2 + crop.offsetX,
    top: (AVATAR_CROP_VIEWPORT_SIZE - renderedHeight) / 2 + crop.offsetY,
  }
}

function clampAvatarCropOffset(crop: AvatarCropDraft, offsetX: number, offsetY: number) {
  const metrics = getAvatarCropMetrics(crop)
  const maxOffsetX = Math.max(0, (metrics.renderedWidth - AVATAR_CROP_VIEWPORT_SIZE) / 2)
  const maxOffsetY = Math.max(0, (metrics.renderedHeight - AVATAR_CROP_VIEWPORT_SIZE) / 2)

  return {
    offsetX: clamp(offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(offsetY, -maxOffsetY, maxOffsetY),
  }
}

function withClampedAvatarCropOffset(crop: AvatarCropDraft): AvatarCropDraft {
  return {
    ...crop,
    ...clampAvatarCropOffset(crop, crop.offsetX, crop.offsetY),
  }
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось подготовить изображение.'))
    image.src = src
  })
}

async function createCroppedAvatarFile(crop: AvatarCropDraft) {
  const image = await loadImageElement(crop.previewUrl)
  const preparedCrop = withClampedAvatarCropOffset({
    ...crop,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  })
  const metrics = getAvatarCropMetrics(preparedCrop)
  const sourceX = clamp((-metrics.left / metrics.renderedWidth) * metrics.naturalWidth, 0, metrics.naturalWidth)
  const sourceY = clamp((-metrics.top / metrics.renderedHeight) * metrics.naturalHeight, 0, metrics.naturalHeight)
  const sourceSize = Math.min(
    (AVATAR_CROP_VIEWPORT_SIZE / metrics.renderedWidth) * metrics.naturalWidth,
    metrics.naturalWidth - sourceX,
    metrics.naturalHeight - sourceY,
  )
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_CROP_OUTPUT_SIZE
  canvas.height = AVATAR_CROP_OUTPUT_SIZE
  const context = canvas.getContext('2d')

  if (!context || sourceSize <= 0) {
    throw new Error('Не удалось подготовить аватарку.')
  }

  context.imageSmoothingEnabled = true
  context.filter = `brightness(${crop.brightness}%)`
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CROP_OUTPUT_SIZE,
    AVATAR_CROP_OUTPUT_SIZE,
  )

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result)
      } else {
        reject(new Error('Не удалось сохранить аватарку.'))
      }
    }, 'image/jpeg', 0.9)
  })

  return new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => readRequestedTabFromUrl() ?? 'events')
  const [pollDraft, setPollDraft] = useState<PollDraft>(INITIAL_POLL_DRAFT)
  const [pollSubmitting, setPollSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const avatarButtonRef = useRef<HTMLButtonElement>(null)
  const [avatarMenuPosition, setAvatarMenuPosition] = useState({ left: 0, top: 0 })
  const [avatarInputElement, setAvatarInputElement] = useState<HTMLInputElement | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarCropDraft, setAvatarCropDraft] = useState<AvatarCropDraft | null>(null)
  const avatarCropDragRef = useRef<AvatarCropDragState | null>(null)
  const [savingProfileChangeRequest, setSavingProfileChangeRequest] = useState(false)
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false)
  const [sendingSupportRequest, setSendingSupportRequest] = useState(false)
  const [gateOpening, setGateOpening] = useState(false)
  const [localGateCooldownUntil, setLocalGateCooldownUntil] = useState(0)
  const [gateClockNow, setGateClockNow] = useState(() => Date.now())
  const [maintenanceSignIn, setMaintenanceSignIn] = useState(false)
  const appGate = useAppGate()
  const { authUser, authLoading } = useFirebaseAuthState()
  const { pageNotice, noticeKind, showNotice, clearNotice } = usePageNotice()
  const {
    authMode,
    authForm,
    authError,
    authSuccess,
    authSubmitting,
    verificationSending,
    verificationChecking,
    verificationSentTo,
    isRegistrationEmailVerified,
    updateAuthField,
    switchAuthMode,
    handleAuthSubmit,
    handleMissingProfileAccess,
    requestEmailCode,
    verifyEmailCode,
  } = useResidentAuth()

  const gateMode = appGate.errorEnabled ? 'error' : appGate.maintenanceEnabled ? 'maintenance' : 'open'

  const { profile, profileLoading, setProfile } = useResidentProfile({
    authUser,
    onMissingProfile: handleMissingProfileAccess,
  })
  const isMaintenancePrivileged = profile?.role === 'ADMIN' || profile?.role === 'TESTER'
  const maintenanceLocked = gateMode !== 'open' && !isMaintenancePrivileged
  const {
    unbindBeforeLogout,
    busy: webPushBusy,
    presentation: webPushPresentation,
    handleAction: handleWebPushAction,
  } = useWebPush(maintenanceLocked ? null : profile, showNotice)
  const gateStatus = useGateStatus(Boolean(profile?.id) && !maintenanceLocked)
  const gateAvailability = useGateAvailability(Boolean(profile?.id) && !maintenanceLocked)

  const {
    users,
    owners,
    events,
    chatMessages,
    paymentConfig,
    communityFunds,
    paymentRequests,
    registrationRequests,
    auditLogs,
  } = useResidentData(maintenanceLocked ? null : profile, activeTab)

  const profileAvatarUrl = useAvatarObjectUrl(profile?.avatar?.downloadPath ?? '')
  const isAdmin = profile?.role === 'ADMIN'
  const isStaff = isAdmin || profile?.role === 'MODERATOR'
  const gateCooldownUntilClient = Math.max(Number(gateStatus.cooldownUntilClient || 0), localGateCooldownUntil)
  const gateOpeningLockUntilClient =
    gateStatus.status === 'OPENING' ? Number(gateStatus.openingLockUntilClient || 0) : 0
  const gateCooldownRemainingSeconds = Math.max(0, Math.ceil((gateCooldownUntilClient - gateClockNow) / 1000))
  const gateCoolingDown = gateCooldownRemainingSeconds > 0
  const gateOpeningGlobally = gateOpeningLockUntilClient > gateClockNow
  const gateClockUntilClient = Math.max(gateCooldownUntilClient, gateOpeningLockUntilClient)
  const gateDebtBlocked = !isAdmin && Number(profile?.balance ?? 0) <= GATE_DEBT_BLOCK_THRESHOLD
  const gateDisabled = gateOpening || gateOpeningGlobally || gateCoolingDown || gateDebtBlocked || gateAvailability.state === 'unavailable' || gateAvailability.state === 'checking'
  const gateButtonHint = gateDebtBlocked
    ? 'Недоступно при долге от 5 000 ₽'
    : gateOpening || gateOpeningGlobally
      ? 'Активация'
    : gateCoolingDown
      ? `Подождите ${gateCooldownRemainingSeconds} сек.`
      : gateAvailability.state === 'checking' ? 'Проверяем связь…' : gateAvailability.state === 'available' ? 'Сервис доступен' : gateAvailability.reason
  const pendingPaymentRequestsCount = pendingRequestCount(paymentRequests)
  const pendingRegistrationRequestsCount =
    pendingRequestCount(registrationRequests)
  const pendingOwnersItemsCount = pendingPaymentRequestsCount + pendingRegistrationRequestsCount
  const staffUserIds = useMemo(() => staffRecipients(users), [users])

  const visibleTabs = useMemo<TabKey[]>(
    () => (isStaff ? ['events', 'chat', 'owners', 'polls', 'payments', 'logs'] : ['events', 'chat', 'owners', 'polls', 'payments']),
    [isStaff],
  )

  useEffect(() => {
    if (gateClockUntilClient <= Date.now()) return

    const timer = window.setInterval(() => {
      const nextNow = Date.now()
      setGateClockNow(nextNow)
      if (nextNow >= gateClockUntilClient) {
        window.clearInterval(timer)
      }
    }, 500)

    setGateClockNow(Date.now())
    return () => window.clearInterval(timer)
  }, [gateClockUntilClient])

  useEffect(() => {
    clearRequestedTabFromUrl()
  }, [])

  useEffect(() => {
    if (!maintenanceLocked) return

    setSettingsOpen(false)
    setSupportOpen(false)
    setGateOpening(false)
    setLocalGateCooldownUntil(0)
    clearNotice()
    setActiveTab('events')
  }, [clearNotice, maintenanceLocked])

  useEffect(() => {
    if (visibleTabs.includes(activeTab)) {
      return
    }
    setActiveTab(visibleTabs[0])
  }, [activeTab, visibleTabs])

  useEffect(() => {
    if (!avatarMenuOpen) return

    const closeAvatarMenu = () => setAvatarMenuOpen(false)
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeAvatarMenu(); avatarButtonRef.current?.focus() } }
    window.addEventListener('click', closeAvatarMenu)
    window.addEventListener('keydown', handleKey)
    window.addEventListener('resize', closeAvatarMenu)

    return () => {
      window.removeEventListener('click', closeAvatarMenu)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', closeAvatarMenu)
    }
  }, [avatarMenuOpen])

  useEffect(() => {
    const previewUrl = avatarCropDraft?.previewUrl
    if (!previewUrl) return

    return () => {
      URL.revokeObjectURL(previewUrl)
    }
  }, [avatarCropDraft?.previewUrl])

  const chatReaderCutoff = useMemo(() => {
    if (!profile) return 0
    return users
      .filter((owner) => owner.id !== profile.id)
      .reduce((maxValue, owner) => Math.max(maxValue, Number(owner.lastChatReadAt ?? 0)), 0)
  }, [users, profile])

  const visibleEvents = useMemo(
    () => events.filter((item) => item.type !== 'POLL' && isPersonalEventVisible(item.targetUserId, profile?.id ?? '')),
    [events, profile?.id],
  )

  const visiblePolls = useMemo(
    () => events.filter((item) => item.type === 'POLL' && isPersonalEventVisible(item.targetUserId, profile?.id ?? '')),
    [events, profile?.id],
  )
  const unreadChatCount = useMemo(
    () => chatMessages.filter((item) => item.senderId !== profile?.id && item.createdAtClient > Number(profile?.lastChatReadAt ?? 0)).length,
    [chatMessages, profile?.id, profile?.lastChatReadAt],
  )

  const latestByTab = useMemo<TabSeenState>(() => {
    const latestEvents = visibleEvents.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0)
    const latestPolls = visiblePolls.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0)
    const latestChat = chatMessages.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0)
    const latestPayments = visibleEvents
      .filter((item) => item.type === 'CHARGE' || item.type === 'EXPENSE')
      .reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0)
    const latestOwners = isStaff
      ? Math.max(
          paymentRequests.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0),
          registrationRequests.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0),
        )
      : 0
    const latestLogs = isStaff ? auditLogs.reduce((maxValue, item) => Math.max(maxValue, Number(item.createdAtClient ?? 0)), 0) : 0

    return {
      events: latestEvents,
      chat: latestChat,
      owners: latestOwners,
      polls: latestPolls,
      payments: latestPayments,
      logs: latestLogs,
    }
  }, [auditLogs, chatMessages, isStaff, paymentRequests, registrationRequests, visibleEvents, visiblePolls])

  const [seenTabs, setSeenTabs] = useState<TabSeenState>(emptySeenState)
  const [seenUserId, setSeenUserId] = useState('')

  useEffect(() => {
    if (!profile?.id) {
      setSeenTabs(emptySeenState())
      setSeenUserId('')
      return
    }

    const storageKey = `${TAB_BADGE_STORAGE_PREFIX}:${profile.id}`
    setSeenUserId(profile.id)
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      setSeenTabs(Object.fromEntries(Object.keys(emptySeenState()).map(key => [key, Date.now()])) as TabSeenState)
      return
    }

    try {
      const parsed = JSON.parse(raw) as Partial<TabSeenState> | null
      const now = Date.now()
      setSeenTabs(Object.fromEntries(Object.keys(emptySeenState()).map(key => {
        const value = Number(parsed?.[key as keyof TabSeenState])
        return [key, Number.isFinite(value) && value >= 0 && value <= now ? value : now]
      })) as TabSeenState)
    } catch {
      setSeenTabs(Object.fromEntries(Object.keys(emptySeenState()).map(key => [key, Date.now()])) as TabSeenState)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id || seenUserId !== profile.id) return
    const storageKey = `${TAB_BADGE_STORAGE_PREFIX}:${profile.id}`
    window.localStorage.setItem(storageKey, JSON.stringify(seenTabs))
  }, [profile?.id, seenTabs, seenUserId])

  useEffect(() => {
    if (!profile?.id || seenUserId !== profile.id) return
    const markVisible = () => {
      if (!canReadVisibleContent()) return
      const latestForActive = latestByTab[activeTab]
      setSeenTabs(current => latestForActive > Number(current[activeTab] ?? 0)
        ? { ...current, [activeTab]: latestForActive } : current)
    }
    markVisible()
    document.addEventListener('visibilitychange', markVisible)
    document.addEventListener('close', markVisible, true)
    window.addEventListener('focus', markVisible)
    return () => {
      document.removeEventListener('visibilitychange', markVisible)
      document.removeEventListener('close', markVisible, true)
      window.removeEventListener('focus', markVisible)
    }
  }, [activeTab, latestByTab, profile?.id, seenUserId, settingsOpen, supportOpen, avatarCropDraft, avatarMenuOpen])

  const tabBadgeCounts = useMemo<Record<TabKey, number>>(() => {
    const eventsCount = visibleEvents.filter((item) => Number(item.createdAtClient ?? 0) > Number(seenTabs.events ?? 0)).length
    const pollsCount = visiblePolls.filter((item) => Number(item.createdAtClient ?? 0) > Number(seenTabs.polls ?? 0)).length
    const paymentsCount = isStaff ? 0 : visibleEvents.filter(
      (item) =>
        item.type === 'CHARGE' && !item.isClosed && (!item.closesAtClient || item.closesAtClient > Date.now()) &&
        Number(item.createdAtClient ?? 0) > Number(seenTabs.payments ?? 0),
    ).length
    const ownersCount = isStaff ? pendingOwnersItemsCount : 0
    const logsCount = isStaff
      ? auditLogs.filter((item) => Number(item.createdAtClient ?? 0) > Number(seenTabs.logs ?? 0)).length
      : 0

    return {
      events: eventsCount,
      chat: unreadChatCount,
      owners: ownersCount,
      polls: pollsCount,
      payments: paymentsCount,
      logs: logsCount,
    }
  }, [auditLogs, isStaff, pendingOwnersItemsCount, seenTabs, unreadChatCount, visibleEvents, visiblePolls])

  const normalizeEmail = (value: string | undefined) => value?.trim().toLowerCase() ?? ''

  const dedupeEmailTargets = (values: string[]) =>
    Array.from(new Set(values.map((item) => normalizeEmail(item)).filter((item) => item.includes('@'))))

  const buildEventEmailBody = ({
    subject,
    title,
    message,
    amount,
    purpose,
  }: {
    subject: string
    title: string
    message: string
    amount?: number
    purpose?: string
  }) => {
    const lines = ['Здравствуйте!', '', `Тема: ${subject}`, `Заголовок: ${title}`]

    if (typeof amount === 'number' && amount > 0) {
      lines.push(`Сумма: ${amount} ₽`)
    }

    if (purpose) {
      lines.push(`Назначение: ${purpose}`)
    }

    if (message.trim()) {
      lines.push('', message.trim())
    }

    lines.push('', EVENT_EMAIL_FOOTER)
    return lines.join('\n')
  }

  const enqueueBroadcastEventEmail = async ({
    subject,
    title,
    message,
    amount,
    destination,
    category,
    excludedUserIds = [],
  }: {
    subject: string
    title: string
    message: string
    amount?: number
    destination: string
    category: string
    excludedUserIds?: string[]
  }) => {
    if (!db || !profile?.id) return

    const emailTargets = notificationEmailTargets(users, category, undefined, excludedUserIds)
    if (emailTargets.length === 0) return

    await enqueueEmailNotification(db, {
      title: subject,
      body: buildEventEmailBody({ subject, title, message, amount }),
      destination,
      category,
      emailTargets,
      sendEmail: true,
      sendPush: false,
    }, {
      signalDb: rtdb,
      creatorId: profile.id,
    })
  }

  const enqueueTargetedEventEmail = async ({
    subject,
    title,
    message,
    amount,
    purpose,
    destination,
    category,
    targetUserIds,
    emailTargets: explicitEmailTargets = [],
  }: {
    subject: string
    title: string
    message: string
    amount?: number
    purpose?: string
    destination: string
    category: string
    targetUserIds: string[]
    emailTargets?: string[]
  }) => {
    if (!db || !profile?.id) return

    const emailTargets = dedupeEmailTargets([
      ...notificationEmailTargets(users, category, targetUserIds),
      ...explicitEmailTargets,
    ])
    if (emailTargets.length === 0) return

    await enqueueEmailNotification(db, {
      title: subject,
      body: buildEventEmailBody({ subject, title, message, amount, purpose }),
      destination,
      category,
      emailTargets,
      sendEmail: true,
      sendPush: false,
    }, {
      signalDb: rtdb,
      creatorId: profile.id,
    })
  }

  const updatePollField = (field: keyof PollDraft, value: string | boolean) => {
    setPollDraft((current) => ({ ...current, [field]: value }))
  }

  const handleLogout = async () => {
    if (!auth) return
    await unbindBeforeLogout()
    await signOut(auth)
    setProfile(null)
  }

  const handleAvatarFileChange = async (event: { target: HTMLInputElement }) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || avatarBusy) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showNotice('Выберите фото JPEG, PNG или WebP.')
      return
    }

    if (file.size <= 0) {
      showNotice(`Файл «${file.name}» пустой.`)
      return
    }

    if (file.size > AVATAR_FILE_MAX_SIZE_BYTES) {
      showNotice(`Аватарка «${file.name}» больше 5 МБ.`)
      return
    }

    setAvatarMenuOpen(false)
    setAvatarCropDraft({
      brightness: 100,
      previewUrl: URL.createObjectURL(file),
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      naturalWidth: 0,
      naturalHeight: 0,
    })
  }

  const handleAvatarCropImageLoad = (event: { currentTarget: HTMLImageElement }) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    setAvatarCropDraft((current) => {
      if (!current) return current
      return withClampedAvatarCropOffset({
        ...current,
        naturalWidth,
        naturalHeight,
      })
    })
  }

  const updateAvatarCropZoom = (value: number) => {
    setAvatarCropDraft((current) => {
      if (!current) return current
      return withClampedAvatarCropOffset({
        ...current,
        zoom: clamp(value, AVATAR_CROP_MIN_ZOOM, AVATAR_CROP_MAX_ZOOM),
      })
    })
  }

  const handleAvatarCropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!avatarCropDraft || avatarBusy) return

    event.currentTarget.setPointerCapture(event.pointerId)
    avatarCropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: avatarCropDraft.offsetX,
      offsetY: avatarCropDraft.offsetY,
    }
  }

  const handleAvatarCropPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = avatarCropDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    setAvatarCropDraft((current) => {
      if (!current) return current
      const nextOffset = clampAvatarCropOffset(
        current,
        dragState.offsetX + event.clientX - dragState.startX,
        dragState.offsetY + event.clientY - dragState.startY,
      )

      return {
        ...current,
        ...nextOffset,
      }
    })
  }

  const handleAvatarCropPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (avatarCropDragRef.current?.pointerId === event.pointerId) {
      avatarCropDragRef.current = null
    }
  }

  const handleCancelAvatarCrop = () => {
    if (avatarBusy) return
    avatarCropDragRef.current = null
    setAvatarCropDraft(null)
  }

  const handleConfirmAvatarCrop = async () => {
    if (!avatarCropDraft || avatarBusy) return

    if (avatarCropDraft.naturalWidth <= 0 || avatarCropDraft.naturalHeight <= 0) {
      showNotice('Изображение еще загружается. Подождите секунду.')
      return
    }

    setAvatarBusy(true)
    try {
      const croppedFile = await createCroppedAvatarFile(avatarCropDraft)
      await uploadUserAvatar(croppedFile)
      showNotice('Аватарка обновлена.')
      avatarCropDragRef.current = null
      setAvatarCropDraft(null)
      setAvatarMenuOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось обновить аватарку.')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleDeleteAvatar = async () => {
    if (!profile?.avatar || avatarBusy) return

    setAvatarBusy(true)
    try {
      await deleteUserAvatar()
      showNotice('Аватарка удалена.')
      setAvatarMenuOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось удалить аватарку.')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSubmitProfileChangeRequest = async (payload: { fullName: string; phone: string }) => {
    if (!db || !profile || savingProfileChangeRequest) return
    setSavingProfileChangeRequest(true)
    try {
      await submitProfileChangeRequestAction(db, profile, payload)
      try {
        await enqueueTargetedNotification(db, {
          title: 'Новый запрос на изменение данных',
          body: `${profile.fullName}: ${payload.fullName.trim()}`,
          destination: 'owners',
          category: 'requests',
          targetUserIds: staffUserIds,
        })
      } catch {
        showNotice('Запрос на изменение данных отправлен, но уведомление модераторам пока не поставлено в очередь.')
        setSettingsOpen(false)
        return
      }
      showNotice('Запрос на изменение данных отправлен. После одобрения данные обновятся.')
      setSettingsOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отправить запрос на изменение данных.')
    } finally {
      setSavingProfileChangeRequest(false)
    }
  }

  const handleUpdateNotificationSettings = async (settings: RemoteUser['notificationSettings']) => {
    if (!db || !profile || savingNotificationSettings) return
    setSavingNotificationSettings(true)
    try {
      await updateNotificationSettingsAction(db, profile.id, settings)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось обновить настройки уведомлений.')
      throw error
    } finally {
      setSavingNotificationSettings(false)
    }
  }

  const handleSubmitSupportRequest = async (payload: { subject: string; message: string }) => {
    if (!db || !profile || sendingSupportRequest) return
    setSendingSupportRequest(true)
    try {
      await submitSupportRequestAction(db, profile, payload)
      showNotice('Сообщение в поддержку отправлено.')
      setSupportOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отправить сообщение в поддержку.')
    } finally {
      setSendingSupportRequest(false)
    }
  }

  const handleOpenGate = async () => {
    if (gateOpening) return
    if (gateAvailability.state === 'unavailable' || gateAvailability.state === 'checking') return
    if (gateDebtBlocked) {
      showNotice('Открытие ворот недоступно при задолженности от 5 000 ₽.')
      return
    }
    if (gateCoolingDown) {
      showNotice(`Ворота уже открывали. Подождите ${gateCooldownRemainingSeconds} сек.`)
      return
    }
    if (gateOpeningGlobally) {
      showNotice('Активация уже выполняется. Подождите несколько секунд.')
      return
    }

    setGateOpening(true)
    try {
      const response = await openGateRequest()
      const nextNow = Date.now()
      const serverCooldownUntil = Number(response.cooldownUntilClient || 0)
      setLocalGateCooldownUntil(Math.max(serverCooldownUntil, nextNow + GATE_UI_COOLDOWN_MS))
      setGateClockNow(nextNow)
      showNotice('Команда открытия отправлена.', 'success')
    } catch (error) {
      if (error instanceof GateServiceError && error.serviceUnavailable) gateAvailability.reportFailure(error.message)
      showNotice(error instanceof Error ? error.message : 'Не удалось открыть ворота.', 'error')
    } finally {
      setGateOpening(false)
    }
  }

  const markChatRead = async (latestSeen: number) => {
    if (!db || !profile || !canReadVisibleContent()) return
    await markChatReadRequest(db, profile.id, latestSeen, profile.lastChatReadAt)
  }

  const sendChatMessage = async (
    text: string,
    replyTo: ChatMessage | null,
    mentionedUserIds: string[] = [],
    files: File[] = [],
  ) => {
    if (!db || !profile) return

    const attachments: ChatAttachment[] = []
    try {
      const cleanMentionedUserIds = Array.from(new Set(mentionedUserIds.filter((item) => item && item !== profile.id)))
      for (const file of files) {
        attachments.push(await uploadChatFile(file))
      }
      const notificationText = text.trim() || (attachments.length === 1 ? 'отправил вложение' : 'отправил вложения')
      const alreadyNotifiedUserIds = new Set([profile.id, ...cleanMentionedUserIds])
      const chatPushTargetUserIds = users
        .map((user) => user.id)
        .filter((userId) => userId && !alreadyNotifiedUserIds.has(userId))

      await sendChatMessageRequest(db, profile, text, replyTo, cleanMentionedUserIds, attachments)
      try {
        if (chatPushTargetUserIds.length > 0) {
          await enqueueTargetedNotification(db, {
            title: 'Новое сообщение в чате',
            body: `${profile.fullName}: ${notificationText}`,
            destination: 'chat',
            category: 'chat',
            targetUserIds: chatPushTargetUserIds,
          })
        }

        if (cleanMentionedUserIds.length > 0) {
          await enqueueTargetedNotification(db, {
            title: 'Вас отметили в чате',
            body: `${profile.fullName} упомянул вас: ${notificationText}`,
            destination: 'chat',
            category: 'mention',
            targetUserIds: cleanMentionedUserIds,
          })
        }
      } catch {
        showNotice('Сообщение отправлено, но push-уведомление пока не поставлено в очередь.')
      }
    } catch (error) {
      const errorCode = String((error as { code?: string })?.code ?? '')
      const errorMessage = error instanceof Error ? error.message : ''
      const normalizedMessage =
        errorCode.includes('permission-denied') || errorMessage.includes('Missing or insufficient permissions')
          ? 'Не удалось сохранить сообщение. Обновите страницу и попробуйте еще раз.'
          : errorMessage || 'Сообщение пока не отправилось. Попробуйте еще раз.'

      if (attachments.length > 0) {
        await Promise.allSettled(attachments.map((attachment) => deleteChatAttachment(attachment)))
      }

      showNotice(normalizedMessage)
      throw new Error('send-failed')
    }
  }

  const saveEditedMessage = async (messageId: string, text: string) => {
    if (!db || !profile) return
    await saveEditedChatMessage(db, profile, messageId, text)
  }

  const togglePinnedMessage = async (message: ChatMessage) => {
    if (!db || !profile) return
    await togglePinnedChatMessage(db, profile, message)
  }

  const removeChatMessage = async (message: ChatMessage) => {
    if (!db) return
    if (!window.confirm('Удалить это сообщение?')) return
    await removeChatMessageRequest(db, message.id)

    if (message.attachments.length > 0) {
      const results = await Promise.allSettled(message.attachments.map((attachment) => deleteChatAttachment(attachment)))
      if (results.some((result) => result.status === 'rejected')) {
        showNotice('Сообщение удалено, но часть вложений пока не удалось удалить с Диска.')
      }
    }
  }

  const voteInPoll = async (poll: CommunityEvent, option: string) => {
    if (!db || !profile || poll.voterIds.includes(profile.id) || poll.isClosed) return
    await voteInPollRequest(db, profile, poll, option)
  }

  const openPaymentLink = () => {
    if (!paymentConfig.sbpLink) return
    window.open(paymentConfig.sbpLink, '_blank', 'noopener,noreferrer')
  }

  const copyDetail = async (value: string, label: string) => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      showNotice(`Скопировано: ${label}`)
    } catch {
      showNotice('Не удалось скопировать. Попробуйте еще раз.')
    }
  }

  const copyAllPaymentDetails = async () => {
    const payload = paymentDetails(paymentConfig)
      .filter((item) => item.value.trim())
      .map((item) => `${item.label}: ${item.value}`)
      .join('\n')

    if (!payload) return

    try {
      await navigator.clipboard.writeText(payload)
      showNotice('Все реквизиты скопированы')
    } catch {
      showNotice('Не удалось скопировать реквизиты')
    }
  }

  const submitPaymentRequest = async (amount: number, selectedEvents: CommunityEvent[], purpose: string, plots: string[]) => {
    if (!db || !profile) return

    try {
      await createPaymentRequestRequest(db, profile, amount, selectedEvents, purpose, plots)
      try {
        await enqueueTargetedNotification(db, {
          title: 'Новая заявка на оплату',
          body: `${profile.fullName}: ${amount} ₽`,
          destination: 'owners',
          category: 'requests',
          targetUserIds: staffUserIds,
        })
      } catch {
        showNotice('Заявка на оплату отправлена, но уведомление администраторам пока не поставлено в очередь.')
        return
      }
      showNotice('Заявка на оплату отправлена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отправить заявку на оплату')
      throw error
    }
  }

  const savePaymentConfig = async (config: {
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
  }) => {
    if (!db || !profile) return

    try {
      await savePaymentConfigRequest(db, config)
      showNotice('Реквизиты сохранены')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось сохранить реквизиты')
      throw error
    }
  }

  const setBalance = async (user: RemoteUser, newBalance: number) => {
    if (!db || !profile) return
    try {
      await setUserBalanceAction(db, profile, user, newBalance)
      showNotice('Баланс изменен')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось изменить баланс')
    }
  }

  const toggleModerator = async (user: RemoteUser, nextRole: Role) => {
    if (!db || !profile) return
    try {
      await setUserRoleAction(db, profile, user, nextRole)
      showNotice(nextRole === 'MODERATOR' ? 'Модератор назначен' : 'Роль модератора снята')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось изменить роль')
    }
  }

  const deleteUser = async (user: RemoteUser) => {
    if (!db || !profile) return
    if (!window.confirm(`Удалить пользователя ${user.fullName}?`)) return
    if (!window.confirm('Пользователь потеряет доступ к приложению и веб-версии. Продолжить?')) return
    try {
      await deleteUserRecord(db, profile, user)
      showNotice('Пользователь удален')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось удалить пользователя')
    }
  }

  const approveRegistration = async (request: RegistrationRequest) => {
    if (!db || !profile) return
    try {
      await approveRegistrationRequestAction(db, profile, request)
      let pushQueued = true
      let emailQueued = true

      try {
        await enqueueTargetedNotification(db, {
          title: request.requestType === 'PROFILE_UPDATE' ? 'Изменение данных одобрено' : 'Регистрация одобрена',
          body:
            request.requestType === 'PROFILE_UPDATE'
              ? 'Ваши данные обновлены после одобрения заявки.'
              : 'Ваша заявка одобрена. Теперь можно войти в систему.',
          destination: 'auth',
          category: 'registration',
          targetUserIds: [request.id],
        })
      } catch {
        pushQueued = false
      }

      if (request.requestType === 'REGISTRATION') {
        try {
          await enqueueTargetedEventEmail({
            subject: 'Регистрация одобрена',
            title: request.fullName,
            message: 'Ваша заявка на регистрацию одобрена. Теперь вы можете войти в систему MalinkiEco.',
            destination: 'auth',
            category: 'registration',
            targetUserIds: [request.id],
            emailTargets: [request.authEmail],
          })
        } catch {
          emailQueued = false
        }
      }

      if (!pushQueued && request.requestType === 'REGISTRATION' && !emailQueued) {
        showNotice('Заявка одобрена, но push и письмо пользователю пока не поставлены в очередь.')
        return
      }

      if (!pushQueued) {
        showNotice('Заявка одобрена, но уведомление пользователю пока не поставлено в очередь.')
        return
      }

      if (request.requestType === 'REGISTRATION' && !emailQueued) {
        showNotice('Заявка одобрена, но письмо пользователю пока не поставлено в очередь.')
        return
      }

      showNotice(request.requestType === 'PROFILE_UPDATE' ? 'Изменение данных одобрено' : 'Регистрация одобрена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось одобрить заявку')
    }
  }

  const rejectRegistration = async (request: RegistrationRequest, reason: string) => {
    if (!db || !profile) return
    try {
      await rejectRegistrationRequestAction(db, profile, request, reason)
      try {
        await enqueueTargetedNotification(db, {
          title: request.requestType === 'PROFILE_UPDATE' ? 'Изменение данных отклонено' : 'Регистрация отклонена',
          body: reason.trim()
            ? request.requestType === 'PROFILE_UPDATE'
              ? `Запрос на изменение данных отклонен. Причина: ${reason.trim()}`
              : `Ваша заявка отклонена. Причина: ${reason.trim()}`
            : request.requestType === 'PROFILE_UPDATE'
              ? 'Запрос на изменение данных отклонен.'
              : 'Ваша заявка отклонена. Обратитесь к модератору или администратору.',
          destination: 'auth',
          category: 'registration',
          targetUserIds: [request.id],
        })
      } catch {
        showNotice('Заявка отклонена, но уведомление пользователю пока не поставлено в очередь.')
        return
      }
      showNotice(request.requestType === 'PROFILE_UPDATE' ? 'Изменение данных отклонено' : 'Регистрация отклонена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отклонить заявку')
    }
  }

  const handleCreateEvent = async (payload: { title: string; message: string; type: EventType; amount: number; closesAtClient?: number }) => {
    if (!db || !profile) return

    try {
      await createEventRequest(db, profile, payload)

      let pushQueued = true
      let emailQueued = true

      const notificationTitle =
        payload.type === 'CHARGE'
          ? 'Сбор средств'
          : payload.type === 'EXPENSE'
            ? 'Оплата'
            : 'Уведомление'

      const notificationMessage =
        payload.message.trim() ||
        (payload.type === 'CHARGE'
          ? 'Открыт новый сбор средств.'
          : payload.type === 'EXPENSE'
            ? 'Опубликована новая оплата из общей кассы.'
            : 'Опубликовано новое уведомление.')

      try {
        await enqueueBroadcastNotification(db, {
          title: notificationTitle,
          body: payload.title.trim(),
          destination: 'events',
          category: 'events',
          excludedUserIds: [profile.id],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueBroadcastEventEmail({
          subject: notificationTitle,
          title: payload.title.trim(),
          message: notificationMessage,
          amount: payload.type === 'INFO' ? undefined : payload.amount,
          destination: 'events',
          category: 'events',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Событие создано, но push и письмо пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Событие создано, но push-уведомление пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Событие создано, но письмо пока не поставлено в очередь.')
        return
      }

      showNotice(
        payload.type === 'CHARGE'
          ? 'Сбор создан'
          : payload.type === 'EXPENSE'
            ? 'Оплата из кассы создана'
            : 'Уведомление опубликовано',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось создать событие')
      throw error
    }
  }

  const handleEditEvent = async (event: CommunityEvent, payload: { title: string; message: string }) => {
    if (!db || !profile) return
    try {
      await updateEventRequest(db, profile, event, payload)
      showNotice('Событие обновлено')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось обновить событие')
    }
  }

  const handleSubmitPoll = async () => {
    if (!db || !profile || pollSubmitting) return

    setPollSubmitting(true)
    try {
      const pollTitle = pollDraft.title.trim()
      const pollMessage = pollDraft.message.trim() || 'Опубликован новый опрос. Откройте MalinkiEco, чтобы проголосовать.'

      setPollDraft(await submitPollRequest(db, profile, pollDraft))

      let pushQueued = true
      let emailQueued = true

      try {
        await enqueueBroadcastNotification(db, {
          title: 'Новый опрос',
          body: pollTitle,
          destination: 'polls',
          category: 'polls',
          excludedUserIds: [profile.id],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueBroadcastEventEmail({
          subject: 'Новый опрос',
          title: pollTitle,
          message: pollMessage,
          destination: 'polls',
          category: 'polls',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Опрос создан, но push и письмо пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Опрос создан, но push-уведомление пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Опрос создан, но письмо пока не поставлено в очередь.')
        return
      }

      showNotice('Опрос создан')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось создать опрос')
      throw error
    } finally {
      setPollSubmitting(false)
    }
  }

  const handleClosePoll = async (poll: CommunityEvent) => {
    if (!db || !profile || poll.isClosed) return

    try {
      await closePollRequest(db, profile, poll)

      let pushQueued = true
      let emailQueued = true

      try {
        await enqueueBroadcastNotification(db, {
          title: 'Опрос закрыт',
          body: poll.title,
          destination: 'polls',
          category: 'polls',
          excludedUserIds: [profile.id],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueBroadcastEventEmail({
          subject: 'Опрос закрыт',
          title: poll.title,
          message: poll.message.trim() || 'Опрос завершен. Откройте MalinkiEco, чтобы ознакомиться с итогами.',
          destination: 'polls',
          category: 'polls',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Опрос закрыт, но push и письмо пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Опрос закрыт, но push-уведомление пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Опрос закрыт, но письмо пока не поставлено в очередь.')
        return
      }

      showNotice('Опрос закрыт')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось закрыть опрос')
      throw error
    }
  }

  const handleCloseCharge = async (event: CommunityEvent) => {
    if (!db || !profile || event.isClosed) return

    try {
      await closeChargeRequest(db, profile, event)

      let pushQueued = true
      let emailQueued = true

      try {
        await enqueueBroadcastNotification(db, {
          title: 'Сбор закрыт',
          body: event.title,
          destination: 'events',
          category: 'events',
          excludedUserIds: [profile.id],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueBroadcastEventEmail({
          subject: 'Сбор закрыт',
          title: event.title,
          message: event.message.trim() || 'Сбор завершен. Откройте MalinkiEco, чтобы ознакомиться с деталями.',
          amount: event.amount,
          destination: 'events',
          category: 'events',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Сбор закрыт, но push и письмо пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Сбор закрыт, но push-уведомление пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Сбор закрыт, но письмо пока не поставлено в очередь.')
        return
      }

      showNotice('Сбор закрыт')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось закрыть сбор')
    }
  }

  const handleConfirmPayment = async (request: ManualPaymentRequest) => {
    if (!db || !profile) return

    try {
      if (!await confirmPaymentRequestAction(db, profile, request.id)) { showNotice('Заявка уже обработана.'); return }

      let pushQueued = true
      let emailQueued = true

      const paymentTitle = request.eventTitle || request.purpose || 'Платеж пользователя'
      const paymentPurpose = request.eventTitle || request.purpose || undefined
      const paymentMessage = paymentPurpose
        ? `Ваш платеж на сумму ${request.amount} ₽ подтвержден. Назначение: ${paymentPurpose}.`
        : `Ваш платеж на сумму ${request.amount} ₽ подтвержден.`

      try {
        await enqueueTargetedNotification(db, {
          title: 'Оплата подтверждена',
          body: paymentMessage,
          destination: 'payments',
          category: 'payments',
          targetUserIds: [request.userId],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueTargetedEventEmail({
          subject: 'Оплата подтверждена',
          title: paymentTitle,
          message: paymentMessage,
          amount: request.amount,
          purpose: paymentPurpose,
          destination: 'payments',
          category: 'payments',
          targetUserIds: [request.userId],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Оплата подтверждена, но push и письмо пользователю пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Оплата подтверждена, но push-уведомление пользователю пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Оплата подтверждена, но письмо пользователю пока не поставлено в очередь.')
        return
      }

      showNotice('Оплата подтверждена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось подтвердить оплату')
    }
  }

  const handleRejectPayment = async (request: ManualPaymentRequest, reason: string) => {
    if (!db || !profile) return

    try {
      if (!await rejectPaymentRequestAction(db, profile, request.id, reason)) { showNotice('Заявка уже обработана.'); return }

      let pushQueued = true
      let emailQueued = true

      const paymentTitle = request.eventTitle || request.purpose || 'Платеж пользователя'
      const paymentPurpose = request.eventTitle || request.purpose || undefined
      const paymentMessage = reason.trim()
        ? `Ваш платеж на сумму ${request.amount} ₽ отклонен. Причина: ${reason.trim()}.`
        : `Ваш платеж на сумму ${request.amount} ₽ отклонен. Уточните детали у администратора или модератора.`

      try {
        await enqueueTargetedNotification(db, {
          title: 'Оплата отклонена',
          body: paymentMessage,
          destination: 'payments',
          category: 'payments',
          targetUserIds: [request.userId],
        })
      } catch {
        pushQueued = false
      }

      try {
        await enqueueTargetedEventEmail({
          subject: 'Оплата отклонена',
          title: paymentTitle,
          message: paymentMessage,
          amount: request.amount,
          purpose: paymentPurpose,
          destination: 'payments',
          category: 'payments',
          targetUserIds: [request.userId],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('Оплата отклонена, но push и письмо пользователю пока не поставлены в очередь.')
        return
      }
      if (!pushQueued) {
        showNotice('Оплата отклонена, но push-уведомление пользователю пока не поставлено в очередь.')
        return
      }
      if (!emailQueued) {
        showNotice('Оплата отклонена, но письмо пользователю пока не поставлено в очередь.')
        return
      }

      showNotice('Оплата отклонена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отклонить оплату')
    }
  }

  const avatarCropMetrics = avatarCropDraft ? getAvatarCropMetrics(avatarCropDraft) : null

  if (!firebaseSetup.ready) {
    return <SetupScreen />
  }

  if (appGate.loading || authLoading || (authUser ? profileLoading : false)) {
    return <SplashScreen message="Подключаем веб-кабинет поселка..." />
  }

  if (maintenanceLocked && !(maintenanceSignIn && !authUser)) {
    return (
      <MaintenanceScreen
        onSignIn={!authUser ? () => setMaintenanceSignIn(true) : undefined}
        title={gateMode === 'error' ? appGate.errorTitle : appGate.maintenanceTitle}
        message={gateMode === 'error' ? appGate.errorMessage : appGate.maintenanceMessage}
        variant={gateMode === 'error' ? 'error' : 'maintenance'}
        endsAtClient={gateMode === 'error' ? appGate.errorEndsAtClient : appGate.maintenanceEndsAtClient}
      />
    )
  }

  if (!authUser || !profile) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        error={authError}
        success={authSuccess}
        loading={authSubmitting}
        verificationSending={verificationSending}
        verificationChecking={verificationChecking}
        verificationSentTo={verificationSentTo}
        emailVerified={isRegistrationEmailVerified}
        onSwitchMode={switchAuthMode}
        onFieldChange={updateAuthField}
        onRequestCode={requestEmailCode}
        onVerifyCode={verifyEmailCode}
        onSubmit={handleAuthSubmit}
      />
    )
  }

  return (
    <div className={`shell shell--modern ${activeTab === 'chat' ? 'shell--chat' : ''}`}>
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-avatar-shell" onClick={(event) => event.stopPropagation()}>
            <input
              ref={setAvatarInputElement}
              className="brand-avatar-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void handleAvatarFileChange(event)}
            />
            <button
              className={`brand-pill brand-avatar-button ${profile.avatar ? 'has-avatar' : 'is-empty'} ${avatarBusy ? 'is-busy' : ''}`}
              ref={avatarButtonRef}
              type="button"
              onClick={() => {
                const rect = avatarButtonRef.current?.getBoundingClientRect()
                if (rect) setAvatarMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)), top: rect.bottom + 8 })
                setAvatarMenuOpen(current => !current)
              }}
              aria-expanded={avatarMenuOpen}
              aria-controls="profile-photo-menu"
              aria-label="Изменить фото профиля"
              title="Изменить фото профиля"
            >
              {profileAvatarUrl ? (
                <img src={profileAvatarUrl} alt="" />
              ) : (
                <span className="brand-avatar-initials">{userInitials(profile.fullName)}</span>
              )}
              {!profile.avatar && (
                <span className="brand-avatar-plus" aria-hidden="true">
                  <svg viewBox="0 0 16 16">
                    <path d="M8 3v10" />
                    <path d="M3 8h10" />
                  </svg>
                </span>
              )}
              {avatarBusy && <span className="brand-avatar-loader" aria-hidden="true" />}
            </button>
            {avatarMenuOpen && createPortal(
              <div id="profile-photo-menu" className="brand-avatar-menu profile-photo-menu" style={avatarMenuPosition} onClick={event => event.stopPropagation()} aria-label="Фото профиля" ref={element => { element?.querySelector('button')?.focus() }} onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
                event.preventDefault()
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
              }}>
                <button type="button" onClick={() => { setAvatarMenuOpen(false); avatarInputElement?.click() }} disabled={avatarBusy}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4Z" /><circle cx="12" cy="13" r="4" /></svg>
                  {profile.avatar ? 'Изменить аватарку' : 'Добавить аватарку'}
                </button>
                <button type="button" onClick={() => void handleDeleteAvatar()} disabled={!profile.avatar || avatarBusy}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" /></svg>
                  Удалить фото
                </button>
              </div>, document.body
            )}
          </div>
          <div>
            <div className="brand-title-row">
              <p className="eyebrow accent">MalinkiEco</p>
              <span className="brand-badge">WEB</span>
            </div>
            <h1>{profile.fullName}</h1>
            <p className="hero-copy compact">{formatPlots(profile)}</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button type="button" className={`balance-chip ${balanceTone(profile.balance)}`}
            onClick={() => { setActiveTab('payments'); window.scrollTo({ top: 0, behavior: 'instant' }) }}
            aria-label={`Перейти в оплату. ${balanceLabel(profile.balance)}. ${profile.balance.toLocaleString('ru-RU')} рублей`}
            title="Перейти в раздел оплаты">
            <span>{balanceLabel(profile.balance)}</span>
            <strong>{profile.balance.toLocaleString('ru-RU')} ₽</strong>
          </button>
          <div className="topbar-control-stack" aria-label="Быстрые действия">
            <button
              className={`gate-open-button ${gateOpening || gateOpeningGlobally ? 'is-busy' : ''} ${gateCoolingDown ? 'is-cooling' : ''} ${gateDebtBlocked ? 'is-debt-blocked' : ''}`}
              type="button"
              onClick={() => void handleOpenGate()}
              disabled={gateDisabled}
              aria-label="Открыть ворота"
              title="Открыть ворота"
            >
              <span className="gate-open-button__main">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="4" rx="1" />
                  <path d="M5 7v14h14V7M3 21h18" />
                  <path d="M5 10h14M5 13h14M5 16h14M10 19h4" />
                </svg>
                <span>Открыть ворота</span>
              </span>
              <span className="gate-open-button__hint">{gateButtonHint}</span>
            </button>
            <div className="topbar-icon-buttons">
              <button className="topbar-icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Настройки" title="Настройки">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-2.5-1.5L14.2 2h-4.4l-.4 2.5A8.2 8.2 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.2 8.2 0 0 0 2.5 1.5l.4 2.5h4.4l.4-2.5A8.2 8.2 0 0 0 17 17l2.4 1 2-3.5-2-1.5Z" />
                  <circle cx="12" cy="12" r="3.4" />
                </svg>
              </button>
              <button
                className="topbar-icon-button"
                type="button"
                onClick={() => setSupportOpen(true)}
                aria-label="Техподдержка"
                title="Техподдержка"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 11a7 7 0 0 1 14 0v4.5A3.5 3.5 0 0 1 15.5 19H14" />
                  <path d="M5 11v4h3v-5H6a1 1 0 0 0-1 1Z" />
                  <path d="M19 11v4h-3v-5h2a1 1 0 0 1 1 1Z" />
                  <path d="M10 19h4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <AppNavigation activeTab={activeTab} tabs={visibleTabs} badges={tabBadgeCounts} balance={profile.balance} onSelect={setActiveTab} />

      {pageNotice && (
        <div className={`notice-bar notice-bar--${noticeKind}`} role={noticeKind === 'error' ? 'alert' : 'status'}>
          <span className="notice-symbol" aria-hidden="true">{noticeKind === 'error' ? '!' : noticeKind === 'success' ? '✓' : 'i'}</span>
          <span>{pageNotice}</span>
          <button className="notice-close" type="button" onClick={clearNotice}>
            Закрыть
          </button>
        </div>
      )}

      <AccountSettingsPanel
        profile={profile}
        open={settingsOpen}
        savingProfileRequest={savingProfileChangeRequest}
        savingNotificationSettings={savingNotificationSettings}
        webPushTitle={webPushPresentation.title}
        webPushDescription={webPushPresentation.description}
        webPushActionLabel={webPushPresentation.actionLabel}
        webPushBusy={webPushBusy}
        onClose={() => setSettingsOpen(false)}
        onLogout={handleLogout}
        onWebPushAction={handleWebPushAction}
        onSubmitProfileChangeRequest={handleSubmitProfileChangeRequest}
        onUpdateNotificationSettings={handleUpdateNotificationSettings}
      />

      <SupportPanel
        open={supportOpen}
        sending={sendingSupportRequest}
        supportEmail={SUPPORT_EMAIL}
        onClose={() => setSupportOpen(false)}
        onSubmit={handleSubmitSupportRequest}
      />

      {avatarCropDraft && (
        <dialog className="avatar-crop-overlay" ref={element => { if (element && !element.open) element.showModal() }} aria-label="Настройка аватарки" onCancel={event => { event.preventDefault(); handleCancelAvatarCrop() }} onClick={event => { if (event.target === event.currentTarget) handleCancelAvatarCrop() }}>
          <div className="avatar-crop-panel" onClick={(event) => event.stopPropagation()}>
            <div className="avatar-crop-heading">
              <p className="eyebrow accent">Аватарка</p>
              <h2>Выберите область фото</h2>
              <p>Передвиньте изображение и настройте масштаб, чтобы лицо или нужный фрагмент попал в круг.</p>
            </div>

            <div
              className="avatar-crop-stage"
              onPointerDown={handleAvatarCropPointerDown}
              onPointerMove={handleAvatarCropPointerMove}
              onPointerUp={handleAvatarCropPointerUp}
              onPointerCancel={handleAvatarCropPointerUp}
            >
              <img
                className="avatar-crop-image"
                src={avatarCropDraft.previewUrl}
                alt=""
                draggable={false}
                onLoad={handleAvatarCropImageLoad}
                onError={() => { setAvatarCropDraft(null); showNotice('Не удалось прочитать фото. Выберите другой файл JPEG, PNG или WebP.') }}
                style={
                  avatarCropMetrics
                    ? {
                        width: `${avatarCropMetrics.renderedWidth}px`,
                        height: `${avatarCropMetrics.renderedHeight}px`,
                        filter: `brightness(${avatarCropDraft.brightness}%)`,
                        transform: `translate3d(${avatarCropMetrics.left}px, ${avatarCropMetrics.top}px, 0)`,
                      }
                    : undefined
                }
              />
              <span className="avatar-crop-ring" aria-hidden="true" />
            </div>

            <label className="avatar-crop-zoom">
              <span>Масштаб</span>
              <input
                type="range"
                min={AVATAR_CROP_MIN_ZOOM}
                max={AVATAR_CROP_MAX_ZOOM}
                step="0.01"
                value={avatarCropDraft.zoom}
                disabled={avatarBusy}
                onChange={(event) => updateAvatarCropZoom(Number(event.currentTarget.value))}
              />
            </label>

            <div className="avatar-crop-actions">
              <label className="avatar-crop-zoom">Яркость · {avatarCropDraft.brightness}%<input type="range" min="60" max="140" value={avatarCropDraft.brightness} disabled={avatarBusy} onChange={event => { const brightness = Number(event.target.value); setAvatarCropDraft(current => current ? { ...current, brightness } : null) }} /></label>
              <button className="ghost-button" type="button" disabled={avatarBusy} onClick={() => setAvatarCropDraft(current => current ? { ...current, zoom: 1, offsetX: 0, offsetY: 0, brightness: 100 } : null)}>Сбросить</button>
              <button className="ghost-button" type="button" onClick={handleCancelAvatarCrop} disabled={avatarBusy}>
                Отмена
              </button>
              <button className="primary-button" type="button" onClick={() => void handleConfirmAvatarCrop()} disabled={avatarBusy}>
                {avatarBusy ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </dialog>
      )}

      <main
        className={`content-grid ${activeTab === 'chat' ? 'content-grid--chat' : ''}`}
      >
        {activeTab === 'events' && (
          <EventsSection
            profile={profile}
            events={visibleEvents}
            formatDateTime={formatDateTime}
            labelForEventType={labelForEventType}
            onCreateEvent={handleCreateEvent}
            onEditEvent={handleEditEvent}
            onCloseCharge={handleCloseCharge}
          />
        )}

        {activeTab === 'chat' && (
          <>
            <ResidentChat
              readingBlocked={settingsOpen || supportOpen || Boolean(avatarCropDraft) || avatarMenuOpen}
              profile={profile}
              users={users}
              messages={chatMessages}
              readerCutoff={chatReaderCutoff}
              onSend={sendChatMessage}
              onSaveEdit={saveEditedMessage}
              onDelete={removeChatMessage}
              onTogglePin={togglePinnedMessage}
              onReact={async (messageId, emoji) => { if (db && profile) await toggleChatReaction(db, profile.id, messageId, emoji) }}
              onMarkRead={markChatRead}
            />
          </>
        )}

        {activeTab === 'owners' && (
          <OwnersSection
            profile={profile}
            owners={owners}
            paymentRequests={paymentRequests}
            registrationRequests={registrationRequests}
            formatPlots={formatPlots}
            balanceTone={balanceTone}
            balanceLabel={balanceLabel}
            roleLabel={roleLabel}
            formatDateTime={formatDateTime}
            pendingPaymentRequestsCount={pendingPaymentRequestsCount}
            pendingRegistrationRequestsCount={pendingRegistrationRequestsCount}
            onSetBalance={setBalance}
            onDeleteUser={deleteUser}
            onToggleModerator={toggleModerator}
            onApproveRegistration={approveRegistration}
            onRejectRegistration={rejectRegistration}
            onConfirmPayment={handleConfirmPayment}
            onRejectPayment={handleRejectPayment}
          />
        )}

        {activeTab === 'polls' && (
          <PollsSection
            profile={profile}
            users={users}
            pollDraft={pollDraft}
            pollSubmitting={pollSubmitting}
            polls={visiblePolls}
            onFieldChange={updatePollField}
            onSubmit={handleSubmitPoll}
            onVote={voteInPoll}
            onClosePoll={handleClosePoll}
            formatDateTime={formatDateTime}
          />
        )}

        {activeTab === 'payments' && (
          <PaymentsSection
            profile={profile}
            paymentConfig={paymentConfig}
            communityFunds={communityFunds}
            events={visibleEvents}
            paymentRequests={paymentRequests}
            balanceTone={balanceTone}
            balanceLabel={balanceLabel}
            hasAnyPaymentDetails={hasAnyPaymentDetails}
            paymentDetails={paymentDetails}
            onOpenPaymentLink={openPaymentLink}
            onCopyAllPaymentDetails={copyAllPaymentDetails}
            onCopyDetail={copyDetail}
            onSubmitPaymentRequest={submitPaymentRequest}
            onSavePaymentConfig={savePaymentConfig}
          />
        )}

        {activeTab === 'logs' && isStaff && <LogsSection logs={auditLogs} formatDateTime={formatDateTime} />}
      </main>

      <SiteFooter />
    </div>
  )
}

export default App


