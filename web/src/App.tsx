import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
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
  voteInPoll as voteInPollRequest,
} from './lib/appApi'
import { INITIAL_POLL_DRAFT, SUPPORT_EMAIL, TAB_LABELS } from './constants'
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
import { useAppGate } from './hooks/useAppGate'
import { useFirebaseAuthState } from './hooks/useFirebaseAuthState'
import { usePageNotice } from './hooks/usePageNotice'
import { useResidentAuth } from './hooks/useResidentAuth'
import { useResidentData } from './hooks/useResidentData'
import { useResidentProfile } from './hooks/useResidentProfile'
import { useWebPush } from './hooks/useWebPush'
import { clearRequestedTabFromUrl, readRequestedTabFromUrl } from './lib/webPush'
import type {
  ChatMessage,
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
import './App.css'

const EVENT_EMAIL_FOOTER =
  'Рекомендуем открыть MalinkiEco, чтобы ознакомиться с деталями события и актуальной информацией.'
const TAB_BADGE_STORAGE_PREFIX = 'malinkieco.tabSeen.v1'

type TabSeenState = Record<TabKey, number>

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

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => readRequestedTabFromUrl() ?? 'events')
  const [pollDraft, setPollDraft] = useState<PollDraft>(INITIAL_POLL_DRAFT)
  const [pollSubmitting, setPollSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingProfileChangeRequest, setSavingProfileChangeRequest] = useState(false)
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false)
  const [sendingSupportRequest, setSendingSupportRequest] = useState(false)
  const appGate = useAppGate()
  const { authUser, authLoading } = useFirebaseAuthState()
  const { pageNotice, showNotice, clearNotice } = usePageNotice()
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

  const maintenanceEnabled = appGate.maintenanceEnabled

  const { profile, profileLoading, setProfile } = useResidentProfile({
    authUser,
    onMissingProfile: handleMissingProfileAccess,
  })
  const isMaintenancePrivileged = profile?.role === 'ADMIN' || profile?.role === 'TESTER'
  const maintenanceLocked = maintenanceEnabled && !isMaintenancePrivileged
  const {
    unbindBeforeLogout,
    busy: webPushBusy,
    presentation: webPushPresentation,
    handleAction: handleWebPushAction,
  } = useWebPush(maintenanceLocked ? null : profile, showNotice)

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

  const isStaff = profile?.role === 'ADMIN' || profile?.role === 'MODERATOR'
  const pendingPaymentRequestsCount = paymentRequests.filter((request) => request.status === 'PENDING').length
  const pendingRegistrationRequestsCount =
    registrationRequests.filter((request) => request.status === 'PENDING').length
  const pendingOwnersItemsCount = pendingPaymentRequestsCount + pendingRegistrationRequestsCount
  const staffUserIds = useMemo(
    () =>
      users
        .filter((owner) => owner.role === 'ADMIN' || owner.role === 'MODERATOR')
        .map((owner) => owner.id)
        .filter(Boolean),
    [users],
  )

  const visibleTabs = useMemo<TabKey[]>(
    () => (isStaff ? ['events', 'chat', 'owners', 'polls', 'payments', 'logs'] : ['events', 'chat', 'owners', 'polls', 'payments']),
    [isStaff],
  )

  useEffect(() => {
    clearRequestedTabFromUrl()
  }, [])

  useEffect(() => {
    if (visibleTabs.includes(activeTab)) {
      return
    }
    setActiveTab(visibleTabs[0])
  }, [activeTab, visibleTabs])

  const chatReaderCutoff = useMemo(() => {
    if (!profile) return 0
    return users
      .filter((owner) => owner.id !== profile.id)
      .reduce((maxValue, owner) => Math.max(maxValue, Number(owner.lastChatReadAt ?? 0)), 0)
  }, [users, profile])

  const visibleEvents = useMemo(
    () => events.filter((item) => item.type !== 'POLL' && (item.targetUserId === '' || item.targetUserId === profile?.id)),
    [events, profile?.id],
  )

  const visiblePolls = useMemo(
    () => events.filter((item) => item.type === 'POLL' && (item.targetUserId === '' || item.targetUserId === profile?.id)),
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

  useEffect(() => {
    if (!profile?.id) {
      setSeenTabs(emptySeenState())
      return
    }

    const storageKey = `${TAB_BADGE_STORAGE_PREFIX}:${profile.id}`
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      setSeenTabs(latestByTab)
      return
    }

    try {
      const parsed = JSON.parse(raw) as Partial<TabSeenState>
      setSeenTabs({
        ...emptySeenState(),
        ...parsed,
      })
    } catch {
      setSeenTabs(latestByTab)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    const storageKey = `${TAB_BADGE_STORAGE_PREFIX}:${profile.id}`
    window.localStorage.setItem(storageKey, JSON.stringify(seenTabs))
  }, [profile?.id, seenTabs])

  useEffect(() => {
    if (!profile?.id) return
    const latestForActive = latestByTab[activeTab]
    setSeenTabs((current) => {
      if (latestForActive <= Number(current[activeTab] ?? 0)) return current
      return {
        ...current,
        [activeTab]: latestForActive,
      }
    })
  }, [activeTab, latestByTab, profile?.id])

  const tabBadgeCounts = useMemo<Record<TabKey, number>>(() => {
    const eventsCount = visibleEvents.filter((item) => Number(item.createdAtClient ?? 0) > Number(seenTabs.events ?? 0)).length
    const pollsCount = visiblePolls.filter((item) => Number(item.createdAtClient ?? 0) > Number(seenTabs.polls ?? 0)).length
    const paymentsCount = visibleEvents.filter(
      (item) =>
        (item.type === 'CHARGE' || item.type === 'EXPENSE') &&
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

  const collectBroadcastEmailTargets = (excludedUserIds: string[] = []) => {
    const excluded = new Set(excludedUserIds)
    return dedupeEmailTargets(
      users.filter((owner) => owner.id && !excluded.has(owner.id)).map((owner) => owner.email),
    )
  }

  const collectTargetedEmailTargets = (targetUserIds: string[]) => {
    const targets = new Set(targetUserIds)
    return dedupeEmailTargets(
      users.filter((owner) => owner.id && targets.has(owner.id)).map((owner) => owner.email),
    )
  }

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

    const emailTargets = collectBroadcastEmailTargets(excludedUserIds)
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
      ...collectTargetedEmailTargets(targetUserIds),
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
      setSettingsOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отправить сообщение в поддержку.')
    } finally {
      setSendingSupportRequest(false)
    }
  }

  const markChatRead = async (latestSeen: number) => {
    if (!db || !profile) return
    await markChatReadRequest(db, profile.id, latestSeen, profile.lastChatReadAt)
  }

  const sendChatMessage = async (text: string, replyTo: ChatMessage | null, mentionedUserIds: string[] = []) => {
    if (!db || !profile) return

    try {
      const cleanMentionedUserIds = Array.from(new Set(mentionedUserIds.filter((item) => item && item !== profile.id)))

      await sendChatMessageRequest(db, profile, text, replyTo, cleanMentionedUserIds)
      try {
        await enqueueBroadcastNotification(db, {
          title: 'Новое сообщение в чате',
          body: `${profile.fullName}: ${text.trim()}`,
          destination: 'chat',
          category: 'chat',
          excludedUserIds: [profile.id, ...cleanMentionedUserIds],
        })

        if (cleanMentionedUserIds.length > 0) {
          await enqueueTargetedNotification(db, {
            title: 'Вас отметили в чате',
            body: `${profile.fullName} упомянул вас: ${text.trim()}`,
            destination: 'chat',
            category: 'mention',
            targetUserIds: cleanMentionedUserIds,
          })
        }
      } catch {
        showNotice('Сообщение отправлено, но push-уведомление пока не поставлено в очередь.')
      }
    } catch {
      showNotice('Сообщение пока не отправилось. Проверьте интернет и попробуйте еще раз.')
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

  const submitPaymentRequest = async (amount: number, selectedEvents: CommunityEvent[], purpose: string) => {
    if (!db || !profile) return

    try {
      await createPaymentRequestRequest(db, profile, amount, selectedEvents, purpose)
      try {
        await enqueueTargetedNotification(db, {
          title: 'Новая заявка на оплату',
          body: `${profile.fullName}: ${amount} ₽`,
          destination: 'owners',
          category: 'requests',
          targetUserIds: staffUserIds,
        })
      } catch {
        showNotice('Заявка на оплату отправлена, но уведомление staff пока не поставлено в очередь.')
        return
      }
      showNotice('Заявка на оплату отправлена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отправить заявку на оплату')
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

  const handleCreateEvent = async (payload: { title: string; message: string; type: EventType; amount: number }) => {
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
      await confirmPaymentRequestAction(db, profile, request.id)

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
      await rejectPaymentRequestAction(db, profile, request.id, reason)

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

  if (!firebaseSetup.ready) {
    return <SetupScreen />
  }

  if (appGate.loading || authLoading || (authUser ? profileLoading : false)) {
    return <SplashScreen message="Подключаем веб-кабинет поселка..." />
  }

  if (maintenanceLocked) {
    return <MaintenanceScreen title={appGate.maintenanceTitle} message={appGate.maintenanceMessage} />
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
    <div className="shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-pill">ML</div>
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
          <div className={`balance-chip ${balanceTone(profile.balance)}`}>
            <span>{balanceLabel(profile.balance)}</span>
            <strong>{profile.balance.toLocaleString('ru-RU')} ₽</strong>
          </div>
          <button className="ghost-button" type="button" onClick={() => setSettingsOpen(true)}>
            Настройки
          </button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="Навигация">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <span>{TAB_LABELS[tab]}</span>
            {tabBadgeCounts[tab] > 0 && (
              <span className="tab-badge" aria-label={`Новых элементов: ${tabBadgeCounts[tab]}`}>
                {tabBadgeCounts[tab]}
              </span>
            )}
          </button>
        ))}
      </nav>

      {pageNotice && (
        <div className="notice-bar" role="status">
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
        sendingSupportRequest={sendingSupportRequest}
        supportEmail={SUPPORT_EMAIL}
        webPushTitle={webPushPresentation.title}
        webPushDescription={webPushPresentation.description}
        webPushActionLabel={webPushPresentation.actionLabel}
        webPushBusy={webPushBusy}
        onClose={() => setSettingsOpen(false)}
        onLogout={handleLogout}
        onWebPushAction={handleWebPushAction}
        onSubmitProfileChangeRequest={handleSubmitProfileChangeRequest}
        onUpdateNotificationSettings={handleUpdateNotificationSettings}
        onSubmitSupportRequest={handleSubmitSupportRequest}
      />

      <main className="content-grid">
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
          <ResidentChat
            profile={profile}
            users={users}
            messages={chatMessages}
            readerCutoff={chatReaderCutoff}
            onSend={sendChatMessage}
            onSaveEdit={saveEditedMessage}
            onDelete={removeChatMessage}
            onTogglePin={togglePinnedMessage}
            onMarkRead={markChatRead}
          />
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


