import { useMemo, useState } from 'react'
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
  markChatRead as markChatReadRequest,
  publishBroadcastNotification,
  rejectPaymentRequest as rejectPaymentRequestAction,
  rejectRegistrationRequest as rejectRegistrationRequestAction,
  removeChatMessage as removeChatMessageRequest,
  saveEditedChatMessage,
  savePaymentConfig as savePaymentConfigRequest,
  sendChatMessage as sendChatMessageRequest,
  setUserBalance as setUserBalanceAction,
  setUserRole as setUserRoleAction,
  submitPoll as submitPollRequest,
  togglePinnedChatMessage,
  voteInPoll as voteInPollRequest,
} from './lib/appApi'
import { INITIAL_POLL_DRAFT, TAB_LABELS } from './constants'
import { AuthScreen } from './components/AuthScreen'
import { EventsSection } from './components/EventsSection'
import { LogsSection } from './components/LogsSection'
import { OwnersSection } from './components/OwnersSection'
import { PaymentsSection } from './components/PaymentsSection'
import { PollsSection } from './components/PollsSection'
import { ResidentChat } from './components/ResidentChat'
import { SetupScreen } from './components/SetupScreen'
import { SplashScreen } from './components/SplashScreen'
import { useFirebaseAuthState } from './hooks/useFirebaseAuthState'
import { usePageNotice } from './hooks/usePageNotice'
import { useResidentAuth } from './hooks/useResidentAuth'
import { useResidentData } from './hooks/useResidentData'
import { useResidentProfile } from './hooks/useResidentProfile'
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

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('events')
  const [pollDraft, setPollDraft] = useState<PollDraft>(INITIAL_POLL_DRAFT)
  const [pollSubmitting, setPollSubmitting] = useState(false)
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

  const { profile, profileLoading, setProfile } = useResidentProfile({
    authUser,
    onMissingProfile: handleMissingProfileAccess,
  })

  const {
    owners,
    events,
    chatMessages,
    paymentConfig,
    communityFunds,
    paymentRequests,
    registrationRequests,
    auditLogs,
  } = useResidentData(profile)

  const isStaff = profile?.role === 'ADMIN' || profile?.role === 'MODERATOR'

  const visibleTabs = useMemo<TabKey[]>(
    () => (isStaff ? ['events', 'chat', 'owners', 'polls', 'payments', 'logs'] : ['events', 'chat', 'owners', 'polls', 'payments']),
    [isStaff],
  )

  const chatReaderCutoff = useMemo(() => {
    if (!profile) return 0
    return owners
      .filter((owner) => owner.id !== profile.id)
      .reduce((maxValue, owner) => Math.max(maxValue, Number(owner.lastChatReadAt ?? 0)), 0)
  }, [owners, profile])

  const visibleEvents = useMemo(
    () => events.filter((item) => item.type !== 'POLL' && (item.targetUserId === '' || item.targetUserId === profile?.id)),
    [events, profile?.id],
  )

  const visiblePolls = useMemo(
    () => events.filter((item) => item.type === 'POLL' && (item.targetUserId === '' || item.targetUserId === profile?.id)),
    [events, profile?.id],
  )

  const updatePollField = (field: keyof PollDraft, value: string) => {
    setPollDraft((current) => ({ ...current, [field]: value }))
  }

  const handleLogout = async () => {
    if (!auth) return
    await signOut(auth)
    setProfile(null)
  }

  const markChatRead = async (latestSeen: number) => {
    if (!db || !profile) return
    await markChatReadRequest(db, profile.id, latestSeen, profile.lastChatReadAt)
  }

  const sendChatMessage = async (text: string, replyTo: ChatMessage | null) => {
    if (!db || !profile) return

    try {
      await sendChatMessageRequest(db, profile, text, replyTo)
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

  const createEvent = async (payload: { title: string; message: string; type: EventType; amount: number }) => {
    if (!db || !profile || !auth) return

    try {
      await createEventRequest(db, profile, payload)
      await publishBroadcastNotification(auth, {
        title:
          payload.type === 'CHARGE'
            ? 'Новый сбор средств'
            : payload.type === 'EXPENSE'
              ? 'Новая оплата из общей суммы'
              : 'Новое объявление',
        body: payload.title,
        destination: 'events',
        category: 'events',
        excludedUserIds: [profile.id],
      })
      showNotice(
        payload.type === 'CHARGE'
          ? 'Сбор создан'
          : payload.type === 'EXPENSE'
            ? 'Оплата из кассы создана'
            : 'Объявление создано',
      )
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось создать событие')
      throw error
    }
  }

  const submitPoll = async () => {
    if (!db || !profile || pollSubmitting) return

    setPollSubmitting(true)
    try {
      setPollDraft(await submitPollRequest(db, profile, pollDraft))
      showNotice('Опрос создан')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось создать опрос')
    } finally {
      setPollSubmitting(false)
    }
  }

  const voteInPoll = async (poll: CommunityEvent, option: string) => {
    if (!db || !profile || poll.voterIds.includes(profile.id) || poll.isClosed) return
    await voteInPollRequest(db, profile, poll, option)
  }

  const closePoll = async (poll: CommunityEvent) => {
    if (!db || !profile || poll.isClosed) return

    try {
      await closePollRequest(db, profile, poll)
      showNotice('Опрос закрыт')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось закрыть опрос')
    }
  }

  const closeCharge = async (event: CommunityEvent) => {
    if (!db || !profile || event.isClosed) return

    try {
      await closeChargeRequest(db, profile, event)
      showNotice('Сбор закрыт')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось закрыть сбор')
    }
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
      showNotice('Регистрация одобрена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось одобрить регистрацию')
    }
  }

  const rejectRegistration = async (request: RegistrationRequest, reason: string) => {
    if (!db || !profile) return
    try {
      await rejectRegistrationRequestAction(db, profile, request, reason)
      showNotice('Регистрация отклонена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отклонить регистрацию')
    }
  }

  const confirmPayment = async (request: ManualPaymentRequest) => {
    if (!db || !profile) return
    try {
      await confirmPaymentRequestAction(db, profile, request.id)
      showNotice('Оплата подтверждена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось подтвердить оплату')
    }
  }

  const rejectPayment = async (request: ManualPaymentRequest, reason: string) => {
    if (!db || !profile) return
    try {
      await rejectPaymentRequestAction(db, profile, request.id, reason)
      showNotice('Оплата отклонена')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Не удалось отклонить оплату')
    }
  }

  if (!firebaseSetup.ready) {
    return <SetupScreen />
  }

  if (authLoading || profileLoading) {
    return <SplashScreen message="Подключаем веб-кабинет поселка..." />
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
          <button className="ghost-button" type="button" onClick={handleLogout}>
            Выйти
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
            {TAB_LABELS[tab]}
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

      <main className="content-grid">
        {activeTab === 'events' && (
          <EventsSection
            profile={profile}
            events={visibleEvents}
            formatDateTime={formatDateTime}
            labelForEventType={labelForEventType}
            onCreateEvent={createEvent}
            onCloseCharge={closeCharge}
          />
        )}

        {activeTab === 'chat' && (
          <ResidentChat
            profile={profile}
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
            onSetBalance={setBalance}
            onDeleteUser={deleteUser}
            onToggleModerator={toggleModerator}
            onApproveRegistration={approveRegistration}
            onRejectRegistration={rejectRegistration}
            onConfirmPayment={confirmPayment}
            onRejectPayment={rejectPayment}
          />
        )}

        {activeTab === 'polls' && (
          <PollsSection
            profile={profile}
            pollDraft={pollDraft}
            pollSubmitting={pollSubmitting}
            polls={visiblePolls}
            onFieldChange={updatePollField}
            onSubmit={submitPoll}
            onVote={voteInPoll}
            onClosePoll={closePoll}
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

      <footer className="site-footer">
        <div className="site-footer__inner">
          <p>Разработано Rethavo Systems</p>
          <div className="site-footer__links">
            <a href="https://rethavo.ru" target="_blank" rel="noreferrer">
              rethavo.ru
            </a>
            <a href="mailto:info@rethavo.ru">info@rethavo.ru</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
