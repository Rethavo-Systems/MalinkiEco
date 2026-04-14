import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth, db, firebaseSetup } from './lib/firebase'
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
  sendChatMessage as sendChatMessageRequest,
  setUserBalance as setUserBalanceAction,
  updateEvent as updateEventRequest,
  updateNotificationSettings as updateNotificationSettingsAction,
  setUserRole as setUserRoleAction,
  submitPoll as submitPollRequest,
  togglePinnedChatMessage,
  voteInPoll as voteInPollRequest,
} from './lib/appApi'
import { INITIAL_POLL_DRAFT, TAB_LABELS } from './constants'
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
  'Р РµРєРѕРјРµРЅРґСѓРµРј РѕС‚РєСЂС‹С‚СЊ MalinkiEco, С‡С‚РѕР±С‹ РѕР·РЅР°РєРѕРјРёС‚СЊСЃСЏ СЃ РґРµС‚Р°Р»СЏРјРё СЃРѕР±С‹С‚РёСЏ Рё Р°РєС‚СѓР°Р»СЊРЅРѕР№ РёРЅС„РѕСЂРјР°С†РёРµР№.'

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => readRequestedTabFromUrl() ?? 'events')
  const [pollDraft, setPollDraft] = useState<PollDraft>(INITIAL_POLL_DRAFT)
  const [pollSubmitting, setPollSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingProfileChangeRequest, setSavingProfileChangeRequest] = useState(false)
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false)
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
  const { unbindBeforeLogout } = useWebPush(maintenanceLocked ? null : profile, showNotice)

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
    const lines = ['Р—РґСЂР°РІСЃС‚РІСѓР№С‚Рµ!', '', `РўРµРјР°: ${subject}`, `Р—Р°РіРѕР»РѕРІРѕРє: ${title}`]

    if (typeof amount === 'number' && amount > 0) {
      lines.push(`РЎСѓРјРјР°: ${amount} в‚Ѕ`)
    }

    if (purpose) {
      lines.push(`РќР°Р·РЅР°С‡РµРЅРёРµ: ${purpose}`)
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
    if (!db) return

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
  }: {
    subject: string
    title: string
    message: string
    amount?: number
    purpose?: string
    destination: string
    category: string
    targetUserIds: string[]
  }) => {
    if (!db) return

    const emailTargets = collectTargetedEmailTargets(targetUserIds)
    if (emailTargets.length === 0) return

    await enqueueEmailNotification(db, {
      title: subject,
      body: buildEventEmailBody({ subject, title, message, amount, purpose }),
      destination,
      category,
      emailTargets,
      sendEmail: true,
      sendPush: false,
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
      showNotice('Р—Р°РїСЂРѕСЃ РЅР° РёР·РјРµРЅРµРЅРёРµ РґР°РЅРЅС‹С… РѕС‚РїСЂР°РІР»РµРЅ. РџРѕСЃР»Рµ РѕРґРѕР±СЂРµРЅРёСЏ РґР°РЅРЅС‹Рµ РѕР±РЅРѕРІСЏС‚СЃСЏ.')
      setSettingsOpen(false)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ РЅР° РёР·РјРµРЅРµРЅРёРµ РґР°РЅРЅС‹С….')
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
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё СѓРІРµРґРѕРјР»РµРЅРёР№.')
    } finally {
      setSavingNotificationSettings(false)
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
          title: 'РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІ С‡Р°С‚Рµ',
          body: `${profile.fullName}: ${text.trim()}`,
          destination: 'chat',
          category: 'chat',
          excludedUserIds: [profile.id, ...cleanMentionedUserIds],
        })

        if (cleanMentionedUserIds.length > 0) {
          await enqueueTargetedNotification(db, {
            title: 'Р’Р°СЃ РѕС‚РјРµС‚РёР»Рё РІ С‡Р°С‚Рµ',
            body: `${profile.fullName} СѓРїРѕРјСЏРЅСѓР» РІР°СЃ: ${text.trim()}`,
            destination: 'chat',
            category: 'mention',
            targetUserIds: cleanMentionedUserIds,
          })
        }
      } catch {
        showNotice('РЎРѕРѕР±С‰РµРЅРёРµ РѕС‚РїСЂР°РІР»РµРЅРѕ, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
      }
    } catch {
      showNotice('РЎРѕРѕР±С‰РµРЅРёРµ РїРѕРєР° РЅРµ РѕС‚РїСЂР°РІРёР»РѕСЃСЊ. РџСЂРѕРІРµСЂСЊС‚Рµ РёРЅС‚РµСЂРЅРµС‚ Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.')
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
    if (!window.confirm('РЈРґР°Р»РёС‚СЊ СЌС‚Рѕ СЃРѕРѕР±С‰РµРЅРёРµ?')) return
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
      showNotice(`РЎРєРѕРїРёСЂРѕРІР°РЅРѕ: ${label}`)
    } catch {
      showNotice('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰Рµ СЂР°Р·.')
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
      showNotice('Р’СЃРµ СЂРµРєРІРёР·РёС‚С‹ СЃРєРѕРїРёСЂРѕРІР°РЅС‹')
    } catch {
      showNotice('РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ СЂРµРєРІРёР·РёС‚С‹')
    }
  }

  const submitPaymentRequest = async (amount: number, selectedEvents: CommunityEvent[], purpose: string) => {
    if (!db || !profile) return

    try {
      await createPaymentRequestRequest(db, profile, amount, selectedEvents, purpose)
      try {
        await enqueueTargetedNotification(db, {
          title: 'РќРѕРІР°СЏ Р·Р°СЏРІРєР° РЅР° РѕРїР»Р°С‚Сѓ',
          body: `${profile.fullName}: ${amount} в‚Ѕ`,
          destination: 'owners',
          category: 'payments',
          targetUserIds: staffUserIds,
        })
      } catch {
        showNotice('Р—Р°СЏРІРєР° РЅР° РѕРїР»Р°С‚Сѓ РѕС‚РїСЂР°РІР»РµРЅР°, РЅРѕ СѓРІРµРґРѕРјР»РµРЅРёРµ staff РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      showNotice('Р—Р°СЏРІРєР° РЅР° РѕРїР»Р°С‚Сѓ РѕС‚РїСЂР°РІР»РµРЅР°')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ РЅР° РѕРїР»Р°С‚Сѓ')
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
      showNotice('Р РµРєРІРёР·РёС‚С‹ СЃРѕС…СЂР°РЅРµРЅС‹')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ СЂРµРєРІРёР·РёС‚С‹')
      throw error
    }
  }

  const setBalance = async (user: RemoteUser, newBalance: number) => {
    if (!db || !profile) return
    try {
      await setUserBalanceAction(db, profile, user, newBalance)
      showNotice('Р‘Р°Р»Р°РЅСЃ РёР·РјРµРЅРµРЅ')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ Р±Р°Р»Р°РЅСЃ')
    }
  }

  const toggleModerator = async (user: RemoteUser, nextRole: Role) => {
    if (!db || !profile) return
    try {
      await setUserRoleAction(db, profile, user, nextRole)
      showNotice(nextRole === 'MODERATOR' ? 'РњРѕРґРµСЂР°С‚РѕСЂ РЅР°Р·РЅР°С‡РµРЅ' : 'Р РѕР»СЊ РјРѕРґРµСЂР°С‚РѕСЂР° СЃРЅСЏС‚Р°')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ СЂРѕР»СЊ')
    }
  }

  const deleteUser = async (user: RemoteUser) => {
    if (!db || !profile) return
    if (!window.confirm(`РЈРґР°Р»РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ ${user.fullName}?`)) return
    if (!window.confirm('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїРѕС‚РµСЂСЏРµС‚ РґРѕСЃС‚СѓРї Рє РїСЂРёР»РѕР¶РµРЅРёСЋ Рё РІРµР±-РІРµСЂСЃРёРё. РџСЂРѕРґРѕР»Р¶РёС‚СЊ?')) return
    try {
      await deleteUserRecord(db, profile, user)
      showNotice('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓРґР°Р»РµРЅ')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ')
    }
  }

  const approveRegistration = async (request: RegistrationRequest) => {
    if (!db || !profile) return
    try {
      await approveRegistrationRequestAction(db, profile, request)
      try {
        await enqueueTargetedNotification(db, {
          title: request.requestType === 'PROFILE_UPDATE' ? 'Изменение данных одобрено' : 'Регистрация одобрена',
          body:
            request.requestType === 'PROFILE_UPDATE'
              ? 'Ваши данные обновлены после проверки модератором.'
              : 'Ваша заявка одобрена. Теперь можно войти в систему.',
          destination: 'auth',
          category: 'registration',
          targetUserIds: [request.id],
        })
      } catch {
        showNotice('Заявка одобрена, но уведомление пользователю пока не поставлено в очередь.')
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
              ? `Заявка на изменение данных отклонена. Причина: ${reason.trim()}`
              : `Ваша заявка отклонена. Причина: ${reason.trim()}`
            : request.requestType === 'PROFILE_UPDATE'
              ? 'Заявка на изменение данных отклонена.'
              : 'Ваша заявка отклонена. Подробности можно уточнить у администрации.',
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
          ? 'РЎР±РѕСЂ СЃСЂРµРґСЃС‚РІ'
          : payload.type === 'EXPENSE'
            ? 'РћРїР»Р°С‚Р°'
            : 'РЈРІРµРґРѕРјР»РµРЅРёРµ'

      const notificationMessage =
        payload.message.trim() ||
        (payload.type === 'CHARGE'
          ? 'РћС‚РєСЂС‹С‚ РЅРѕРІС‹Р№ СЃР±РѕСЂ СЃСЂРµРґСЃС‚РІ.'
          : payload.type === 'EXPENSE'
            ? 'РћРїСѓР±Р»РёРєРѕРІР°РЅР° РЅРѕРІР°СЏ РѕРїР»Р°С‚Р° РёР· РѕР±С‰РµР№ РєР°СЃСЃС‹.'
            : 'РћРїСѓР±Р»РёРєРѕРІР°РЅРѕ РЅРѕРІРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ.')

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
        showNotice('РЎРѕР±С‹С‚РёРµ СЃРѕР·РґР°РЅРѕ, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РЎРѕР±С‹С‚РёРµ СЃРѕР·РґР°РЅРѕ, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РЎРѕР±С‹С‚РёРµ СЃРѕР·РґР°РЅРѕ, РЅРѕ РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice(
        payload.type === 'CHARGE'
          ? 'РЎР±РѕСЂ СЃРѕР·РґР°РЅ'
          : payload.type === 'EXPENSE'
            ? 'РћРїР»Р°С‚Р° РёР· РєР°СЃСЃС‹ СЃРѕР·РґР°РЅР°'
            : 'РЈРІРµРґРѕРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРѕ',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ СЃРѕР±С‹С‚РёРµ')
      throw error
    }
  }

  const handleEditEvent = async (event: CommunityEvent, payload: { title: string; message: string }) => {
    if (!db || !profile) return
    try {
      await updateEventRequest(db, profile, event, payload)
      showNotice('РЎРѕР±С‹С‚РёРµ РѕР±РЅРѕРІР»РµРЅРѕ')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРѕР±С‹С‚РёРµ')
    }
  }

  const handleSubmitPoll = async () => {
    if (!db || !profile || pollSubmitting) return

    setPollSubmitting(true)
    try {
      const pollTitle = pollDraft.title.trim()
      const pollMessage = pollDraft.message.trim() || 'РћРїСѓР±Р»РёРєРѕРІР°РЅ РЅРѕРІС‹Р№ РѕРїСЂРѕСЃ. РћС‚РєСЂРѕР№С‚Рµ MalinkiEco, С‡С‚РѕР±С‹ РїСЂРѕРіРѕР»РѕСЃРѕРІР°С‚СЊ.'

      setPollDraft(await submitPollRequest(db, profile, pollDraft))

      let pushQueued = true
      let emailQueued = true

      try {
        await enqueueBroadcastNotification(db, {
          title: 'РќРѕРІС‹Р№ РѕРїСЂРѕСЃ',
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
          subject: 'РќРѕРІС‹Р№ РѕРїСЂРѕСЃ',
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
        showNotice('РћРїСЂРѕСЃ СЃРѕР·РґР°РЅ, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РћРїСЂРѕСЃ СЃРѕР·РґР°РЅ, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РћРїСЂРѕСЃ СЃРѕР·РґР°РЅ, РЅРѕ РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice('РћРїСЂРѕСЃ СЃРѕР·РґР°РЅ')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РѕРїСЂРѕСЃ')
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
          title: 'РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚',
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
          subject: 'РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚',
          title: poll.title,
          message: poll.message.trim() || 'РћРїСЂРѕСЃ Р·Р°РІРµСЂС€РµРЅ. РћС‚РєСЂРѕР№С‚Рµ MalinkiEco, С‡С‚РѕР±С‹ РѕР·РЅР°РєРѕРјРёС‚СЊСЃСЏ СЃ РёС‚РѕРіР°РјРё.',
          destination: 'polls',
          category: 'polls',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚, РЅРѕ РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice('РћРїСЂРѕСЃ Р·Р°РєСЂС‹С‚')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ РѕРїСЂРѕСЃ')
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
          title: 'РЎР±РѕСЂ Р·Р°РєСЂС‹С‚',
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
          subject: 'РЎР±РѕСЂ Р·Р°РєСЂС‹С‚',
          title: event.title,
          message: event.message.trim() || 'РЎР±РѕСЂ Р·Р°РІРµСЂС€РµРЅ. РћС‚РєСЂРѕР№С‚Рµ MalinkiEco, С‡С‚РѕР±С‹ РѕР·РЅР°РєРѕРјРёС‚СЊСЃСЏ СЃ РґРµС‚Р°Р»СЏРјРё.',
          amount: event.amount,
          destination: 'events',
          category: 'events',
          excludedUserIds: [profile.id],
        })
      } catch {
        emailQueued = false
      }

      if (!pushQueued && !emailQueued) {
        showNotice('РЎР±РѕСЂ Р·Р°РєСЂС‹С‚, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РЎР±РѕСЂ Р·Р°РєСЂС‹С‚, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РЎР±РѕСЂ Р·Р°РєСЂС‹С‚, РЅРѕ РїРёСЃСЊРјРѕ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice('РЎР±РѕСЂ Р·Р°РєСЂС‹С‚')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ СЃР±РѕСЂ')
    }
  }

  const handleConfirmPayment = async (request: ManualPaymentRequest) => {
    if (!db || !profile) return

    try {
      await confirmPaymentRequestAction(db, profile, request.id)

      let pushQueued = true
      let emailQueued = true

      const paymentTitle = request.eventTitle || request.purpose || 'РџР»Р°С‚РµР¶ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ'
      const paymentPurpose = request.eventTitle || request.purpose || undefined
      const paymentMessage = paymentPurpose
        ? `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${paymentPurpose}.`
        : `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ.`

      try {
        await enqueueTargetedNotification(db, {
          title: 'РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°',
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
          subject: 'РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°',
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
        showNotice('РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°, РЅРѕ РїРёСЃСЊРјРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice('РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґС‚РІРµСЂРґРёС‚СЊ РѕРїР»Р°С‚Сѓ')
    }
  }

  const handleRejectPayment = async (request: ManualPaymentRequest, reason: string) => {
    if (!db || !profile) return

    try {
      await rejectPaymentRequestAction(db, profile, request.id, reason)

      let pushQueued = true
      let emailQueued = true

      const paymentTitle = request.eventTitle || request.purpose || 'РџР»Р°С‚РµР¶ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ'
      const paymentPurpose = request.eventTitle || request.purpose || undefined
      const paymentMessage = reason.trim()
        ? `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РџСЂРёС‡РёРЅР°: ${reason.trim()}.`
        : `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РЈС‚РѕС‡РЅРёС‚Рµ РґРµС‚Р°Р»Рё Сѓ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° РёР»Рё РјРѕРґРµСЂР°С‚РѕСЂР°.`

      try {
        await enqueueTargetedNotification(db, {
          title: 'РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°',
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
          subject: 'РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°',
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
        showNotice('РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°, РЅРѕ push Рё РїРёСЃСЊРјРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅС‹ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!pushQueued) {
        showNotice('РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°, РЅРѕ push-СѓРІРµРґРѕРјР»РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }
      if (!emailQueued) {
        showNotice('РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°, РЅРѕ РїРёСЃСЊРјРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РїРѕРєР° РЅРµ РїРѕСЃС‚Р°РІР»РµРЅРѕ РІ РѕС‡РµСЂРµРґСЊ.')
        return
      }

      showNotice('РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєР»РѕРЅРёС‚СЊ РѕРїР»Р°С‚Сѓ')
    }
  }

  if (!firebaseSetup.ready) {
    return <SetupScreen />
  }

  if (appGate.loading || authLoading || (authUser ? profileLoading : false)) {
    return <SplashScreen message="РџРѕРґРєР»СЋС‡Р°РµРј РІРµР±-РєР°Р±РёРЅРµС‚ РїРѕСЃРµР»РєР°..." />
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
            <strong>{profile.balance.toLocaleString('ru-RU')} в‚Ѕ</strong>
          </div>
          <button className="ghost-button" type="button" onClick={() => setSettingsOpen(true)}>
            Настройки
          </button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="РќР°РІРёРіР°С†РёСЏ">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <span>{TAB_LABELS[tab]}</span>
            {tab === 'owners' && isStaff && pendingOwnersItemsCount > 0 && (
              <span className="tab-badge" aria-label={`РќРѕРІС‹С… Р·Р°СЏРІРѕРє: ${pendingOwnersItemsCount}`}>
                {pendingOwnersItemsCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {pageNotice && (
        <div className="notice-bar" role="status">
          <span>{pageNotice}</span>
          <button className="notice-close" type="button" onClick={clearNotice}>
            Р—Р°РєСЂС‹С‚СЊ
          </button>
        </div>
      )}

      <AccountSettingsPanel
        profile={profile}
        open={settingsOpen}
        savingProfileRequest={savingProfileChangeRequest}
        savingNotificationSettings={savingNotificationSettings}
        onClose={() => setSettingsOpen(false)}
        onLogout={handleLogout}
        onSubmitProfileChangeRequest={handleSubmitProfileChangeRequest}
        onUpdateNotificationSettings={handleUpdateNotificationSettings}
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

