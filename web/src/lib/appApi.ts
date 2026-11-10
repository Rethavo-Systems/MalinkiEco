import { isChargeClosed, validateChargeDeadline } from './chargeDeadline'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Transaction,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { push, ref, set, type Database } from 'firebase/database'
import { getAuth } from 'firebase/auth'
import type {
  ChatAttachment,
  ChatMessage,
  CommunityEvent,
  EventType,
  NotificationSettings,
  PollDraft,
  RegistrationRequest,
  RemoteUser,
  Role,
} from '../types'
import { formatPlots, formatRussianPhone, normalizeNotificationSettings, normalizeRussianPhone } from '../utils'
import { DEFAULT_NOTIFICATION_SETTINGS, INITIAL_POLL_DRAFT, SUPPORT_EMAIL } from '../constants'
import {
  PLOTS_COLLECTION,
  PLOT_OPTIONS,
  deriveInitialPlotBalancesFromUsers,
  extractPlotsFromUserData,
  normalizePlots,
  plotDocumentId,
  plotSortValue,
  splitAmountAcrossPlots,
  sumBalanceForPlots,
} from './plotAccounts'
import { auth, rtdb } from './firebase'

type EventDraft = {
  closesAtClient?: number
  title: string
  message: string
  type: EventType
  amount: number
}

type EditableEventDraft = {
  title: string
  message: string
}

type NotificationJobPayload = {
  title: string
  body: string
  destination: string
  category: string
  excludedUserIds?: string[]
  targetUserIds?: string[]
  emailTargets?: string[]
  sendEmail?: boolean
  sendPush?: boolean
  authDeleteUserId?: string
  cleanupWebPushUserId?: string
}

type NotificationQueueOptions = {
  signalDb?: Database | null
  creatorId?: string
}

const NOTIFICATION_JOBS_COLLECTION = 'notification_jobs'
const NOTIFICATION_SIGNALS_PATH = 'notification_signals'

function normalizeProfileUpdatePayload(payload: { fullName: string; phone: string }) {
  return {
    fullName: payload.fullName.trim(),
    phone: normalizeRussianPhone(payload.phone),
  }
}

async function signalNotificationJob(
  signalDb: Database,
  creatorId: string,
  jobId: string,
  dueAtClient: number,
) {
  const signalRef = push(ref(signalDb, NOTIFICATION_SIGNALS_PATH))
  await set(signalRef, {
    jobId,
    creatorId,
    createdAtClient: Date.now(),
    dueAtClient,
  })
}

async function enqueueNotificationJob(
  db: Firestore,
  audience: 'broadcast' | 'users' | 'emails',
  payload: NotificationJobPayload,
  options: NotificationQueueOptions = {},
) {
  const title = payload.title.trim()
  const body = payload.body.trim()
  const destination = payload.destination.trim()
  const category = payload.category.trim()
  const targetUserIds = (payload.targetUserIds ?? []).map((item) => item.trim()).filter(Boolean)
  const excludedUserIds = (payload.excludedUserIds ?? []).map((item) => item.trim()).filter(Boolean)
  const emailTargets = (payload.emailTargets ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
  const authDeleteUserId = (payload.authDeleteUserId ?? '').trim()
  const cleanupWebPushUserId = (payload.cleanupWebPushUserId ?? '').trim()

  if (!title || !body || !destination || !category) {
    throw new Error('Не удалось подготовить уведомление для отправки.')
  }

  if (audience === 'users' && targetUserIds.length === 0) {
    return
  }
  if (audience === 'emails' && emailTargets.length === 0) {
    return
  }

  const createdAtClient = Date.now()
  const localWorker = import.meta.env?.DEV ? String(import.meta.env.VITE_LOCAL_NOTIFICATION_WORKER_URL ?? '').trim() : ''
  if (localWorker) {
    const user = getAuth(db.app).currentUser
    if (!user) throw new Error('Войдите в аккаунт для отправки уведомлений.')
    const url = new URL(localWorker)
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Небезопасный адрес обработчика.')
    url.searchParams.set('path', '/api/notifications/jobs')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Firebase-Authorization': `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ jobId: crypto.randomUUID(), job: { ...payload, audience } }),
      signal: AbortSignal.timeout(110000),
    })
    const result = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(result.error || 'Новый обработчик не принял уведомление.')
    return
  }
  const signalDb = options.signalDb ?? rtdb
  const creatorId = (options.creatorId ?? auth?.currentUser?.uid ?? '').trim()
  if (!signalDb || !creatorId) {
    throw new Error('Не удалось подготовить realtime-сигнал для отправки уведомления.')
  }

  const jobRef = doc(collection(db, NOTIFICATION_JOBS_COLLECTION))
  await setDoc(jobRef, {
    status: 'PENDING',
    title,
    body,
    audience,
    destination,
    category,
    targetUserIds,
    excludedUserIds,
    emailTargets,
    sendEmail: payload.sendEmail ?? false,
    sendPush: payload.sendPush ?? true,
    authDeleteUserId,
    cleanupWebPushUserId,
    attempts: 0,
    createdById: creatorId,
    createdAt: serverTimestamp(),
    createdAtClient,
    nextAttemptAtClient: createdAtClient,
    processingWorker: '',
    lastError: '',
  })

  try {
    await signalNotificationJob(signalDb, creatorId, jobRef.id, createdAtClient)
  } catch {
    // The durable job is already queued. The worker's bounded fallback will pick it up.
    // Deleting it here can race with processing or invite a duplicate on user retry.
    console.warn('Уведомление сохранено в очереди; realtime-сигнал временно недоступен.')
  }
}

export async function enqueueBroadcastNotification(
  db: Firestore,
  payload: NotificationJobPayload,
  options?: NotificationQueueOptions,
) {
  await enqueueNotificationJob(db, 'broadcast', payload, options)
}

export async function enqueueTargetedNotification(
  db: Firestore,
  payload: NotificationJobPayload,
  options?: NotificationQueueOptions,
) {
  await enqueueNotificationJob(db, 'users', payload, options)
}

export async function enqueueEmailNotification(
  db: Firestore,
  payload: NotificationJobPayload,
  options?: NotificationQueueOptions,
) {
  await enqueueNotificationJob(db, 'emails', payload, options)
}

async function createAuditLog(
  db: Firestore,
  actor: RemoteUser,
  title: string,
  message: string,
  targetUserId = '',
  targetUserName = '',
  targetPlotName = '',
) {
  await addDoc(collection(db, 'audit_logs'), {
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    title,
    message,
    targetUserId,
    targetUserName,
    targetPlotName,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  })
}

export async function ensurePlotAccounts(db: Firestore) {
  const plotsSnapshot = await getDocs(collection(db, PLOTS_COLLECTION))
  const existingBalances = new Map(plotsSnapshot.docs.map(item => [
    normalizePlots([String(item.data().name ?? '')])[0] ?? '', Number(item.data().balance ?? 0),
  ]))
  if (PLOT_OPTIONS.every(plot => existingBalances.has(plot))) return existingBalances

  const usersSnapshot = await getDocs(collection(db, 'users'))
  return runTransaction(db, async transaction => {
    // Migration can race with another reviewer. Re-read before writing any balances.
    const plots = await Promise.all(PLOT_OPTIONS.map(plot => transaction.get(doc(db, PLOTS_COLLECTION, plotDocumentId(plot)))))
    const users = await Promise.all(usersSnapshot.docs.map(user => transaction.get(user.ref)))
    const initial = deriveInitialPlotBalancesFromUsers(users.filter(user => user.exists()).map(user => user.data()!))
    const balances = new Map(PLOT_OPTIONS.map((plot, index) => [plot,
      plots[index].exists() ? Number(plots[index].data()?.balance ?? 0) : initial.get(plot) ?? 0,
    ]))
    PLOT_OPTIONS.forEach((plot, index) => {
      if (!plots[index].exists()) transaction.set(plots[index].ref, {
        name: plot, balance: balances.get(plot) ?? 0, sortOrder: plotSortValue(plot),
        updatedAt: serverTimestamp(), updatedAtClient: Date.now(),
      })
    })
    users.filter(user => user.exists()).forEach(user => {
      const data = user.data()!
      const balance = sumBalanceForPlots(balances, extractPlotsFromUserData(data), Number(data.balance ?? 0))
      if (balance !== Number(data.balance ?? 0)) transaction.update(user.ref, { balance })
    })
    return balances
  })
}

export async function updateNotificationSettings(
  db: Firestore,
  userId: string,
  settings: Partial<NotificationSettings>,
) {
  const nextSettings = normalizeNotificationSettings({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...settings,
  })

  await updateDoc(doc(db, 'users', userId), {
    notificationSettings: nextSettings,
  })

  return nextSettings
}

export async function submitProfileChangeRequest(
  db: Firestore,
  profile: RemoteUser,
  payload: { fullName: string; phone: string },
) {
  const normalized = normalizeProfileUpdatePayload(payload)
  if (!normalized.fullName) {
    throw new Error('Укажите имя пользователя.')
  }
  if (normalized.phone.length !== 11) {
    throw new Error('Укажите корректный номер телефона.')
  }
  if (normalized.fullName === profile.fullName.trim() && normalized.phone === normalizeRussianPhone(profile.phone ?? '')) {
    throw new Error('Изменений пока нет. Исправьте имя или телефон.')
  }

  await setDoc(
    doc(db, 'registration_requests', profile.id),
    {
      login: profile.login ?? '',
      authEmail: profile.email,
      fullName: normalized.fullName,
      phone: normalized.phone,
      plots: profile.plots,
      status: 'PENDING',
      requestType: 'PROFILE_UPDATE',
      currentFullName: profile.fullName,
      currentPhone: normalizeRussianPhone(profile.phone ?? ''),
      proposedFullName: normalized.fullName,
      proposedPhone: normalized.phone,
      reviewedById: '',
      reviewedByName: '',
      reviewReason: '',
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    },
    { merge: true },
  )
}

export async function submitSupportRequest(
  db: Firestore,
  profile: RemoteUser,
  payload: { subject: string; message: string },
) {
  const subject = payload.subject.trim()
  const message = payload.message.trim()

  if (!subject) {
    throw new Error('Укажите тему обращения.')
  }

  if (!message) {
    throw new Error('Опишите вопрос или предложение.')
  }

  const formattedPhone = profile.phone ? formatRussianPhone(profile.phone) : 'не указан'
  const formattedPlots = formatPlots(profile) || 'не указаны'

  await enqueueEmailNotification(
    db,
    {
      title: `Поддержка: ${subject}`,
      body: [
        'Новое обращение из веб-версии MalinkiEco.',
        '',
        `Имя: ${profile.fullName}`,
        `Почта аккаунта: ${profile.email}`,
        `Телефон: ${formattedPhone}`,
        `Участки: ${formattedPlots}`,
        '',
        'Сообщение:',
        message,
      ].join('\n'),
      destination: 'auth',
      category: 'verification',
      emailTargets: [SUPPORT_EMAIL],
      sendEmail: true,
      sendPush: false,
    },
    {
      creatorId: profile.id,
    },
  )
}

function setPlotBalancesInBatch(
  db: Firestore,
  batch: Pick<Transaction, 'set' | 'update'>,
  plotBalances: Map<string, number>,
  targetPlots: string[],
) {
  const updatedAtClient = Date.now()
  normalizePlots(targetPlots).forEach((plot) => {
    batch.set(
      doc(db, PLOTS_COLLECTION, plotDocumentId(plot)),
      {
        name: plot,
        balance: plotBalances.get(plot) ?? 0,
        sortOrder: plotSortValue(plot),
        updatedAt: serverTimestamp(),
        updatedAtClient,
      },
      { merge: true },
    )
  })
}

function syncUserBalancesInBatch(
  db: Firestore,
  batch: Pick<Transaction, 'set' | 'update'>,
  userDocs: Pick<DocumentSnapshot, 'id' | 'data'>[],
  plotBalances: Map<string, number>,
) {
  userDocs.forEach((item) => {
    const data = item.data() as Record<string, unknown>
    const currentBalance = Number(data.balance ?? 0)
    const nextBalance = sumBalanceForPlots(plotBalances, extractPlotsFromUserData(data), currentBalance)
    if (currentBalance === nextBalance) return
    batch.update(doc(db, 'users', item.id), { balance: nextBalance })
  })
}

export async function approveRegistrationRequest(
  db: Firestore,
  reviewer: RemoteUser,
  request: RegistrationRequest,
) {
  if (request.requestType === 'PROFILE_UPDATE') {
    const requestRef = doc(db, 'registration_requests', request.id)
    const userRef = doc(db, 'users', request.id)
    const nextFullName = (request.proposedFullName || request.fullName).trim()
    const nextPhone = normalizeRussianPhone(request.proposedPhone || request.phone)

    await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef)
      const status = String(requestSnapshot.data()?.status ?? '')
      if (status !== 'PENDING') return

      transaction.update(userRef, {
        fullName: nextFullName,
        phone: nextPhone,
      })
      transaction.update(requestRef, {
        status: 'APPROVED',
        reviewedById: reviewer.id,
        reviewedByName: reviewer.fullName,
        reviewReason: '',
        reviewedAt: serverTimestamp(),
      })
    })

    await createAuditLog(
      db,
      reviewer,
      'Одобрено изменение профиля',
      'Заявка на изменение имени и телефона одобрена.',
      request.id,
      request.currentFullName || request.fullName,
      request.plots.join(', '),
    )
    return
  }

  const plotBalances = await ensurePlotAccounts(db)
  const requestRef = doc(db, 'registration_requests', request.id)
  const userRef = doc(db, 'users', request.id)
  const initialBalance = sumBalanceForPlots(plotBalances, request.plots, 0)

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(requestRef)
    const status = String(snapshot.data()?.status ?? '')
    if (status !== 'PENDING') return

    transaction.set(userRef, {
      email: request.authEmail,
      login: request.login,
      fullName: request.fullName,
      phone: request.phone,
      plotName: request.plots.join(', '),
      plots: request.plots,
      role: 'USER',
      balance: initialBalance,
      lastChatReadAt: 0,
      notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
    })
    transaction.update(requestRef, {
      status: 'APPROVED',
      reviewedById: reviewer.id,
      reviewedByName: reviewer.fullName,
      reviewReason: '',
      reviewedAt: serverTimestamp(),
    })
  })

  await createAuditLog(
    db,
    reviewer,
    'Одобрена регистрация',
    'Заявка на регистрацию одобрена.',
    request.id,
    request.fullName,
    request.plots.join(', '),
  )
}

export async function rejectRegistrationRequest(
  db: Firestore,
  reviewer: RemoteUser,
  request: RegistrationRequest,
  reason: string,
) {
  const normalizedReason = reason.trim()

  await updateDoc(doc(db, 'registration_requests', request.id), {
    status: 'REJECTED',
    reviewedById: reviewer.id,
    reviewedByName: reviewer.fullName,
    reviewReason: normalizedReason,
    reviewedAt: serverTimestamp(),
  })

  await createAuditLog(
    db,
    reviewer,
    request.requestType === 'PROFILE_UPDATE' ? 'Отклонено изменение профиля' : 'Отклонена регистрация',
    normalizedReason
      ? request.requestType === 'PROFILE_UPDATE'
        ? `Заявка на изменение данных отклонена. Причина: ${normalizedReason}.`
        : `Заявка на регистрацию отклонена. Причина: ${normalizedReason}.`
      : request.requestType === 'PROFILE_UPDATE'
        ? 'Заявка на изменение данных отклонена.'
        : 'Заявка на регистрацию отклонена.',
    request.id,
    request.fullName,
    request.plots.join(', '),
  )

  if (request.requestType === 'REGISTRATION') {
    await enqueueTargetedNotification(
      db,
      {
        title: 'Auth cleanup',
        body: `Delete auth account for rejected registration ${request.fullName}`,
        destination: 'auth',
        category: 'system',
        targetUserIds: [request.id],
        sendEmail: false,
        sendPush: false,
        authDeleteUserId: request.id,
        cleanupWebPushUserId: request.id,
      },
      {
        creatorId: reviewer.id,
      },
    )
  }
}

export async function setUserBalance(
  db: Firestore, actor: RemoteUser, targetUser: RemoteUser, newBalance: number,
) {
  if (!Number.isSafeInteger(newBalance)) throw new Error('Укажите баланс в целых рублях.')
  await ensurePlotAccounts(db)
  const allUsers = await getDocs(collection(db, 'users'))
  const auditRef = doc(collection(db, 'audit_logs'))
  await runTransaction(db, async transaction => {
    const users = await Promise.all(allUsers.docs.map(user => transaction.get(user.ref)))
    const target = users.find(user => user.id === targetUser.id && user.exists())
    if (!target) throw new Error('Аккаунт больше не существует.')
    const data = target.data()!
    const currentBalance = Number(data.balance ?? 0)
    if (currentBalance !== targetUser.balance) throw new Error('Баланс уже изменился. Обновите карточку перед корректировкой.')
    const targetPlots = extractPlotsFromUserData(data)
    const plots = await Promise.all(PLOT_OPTIONS.map(plot => transaction.get(doc(db, PLOTS_COLLECTION, plotDocumentId(plot)))))
    const balances = new Map(PLOT_OPTIONS.map((plot, index) => [plot, Number(plots[index].data()?.balance ?? 0)]))
    if (!targetPlots.length) transaction.update(target.ref, { balance: newBalance })
    else {
      const deltas = splitAmountAcrossPlots(targetPlots, newBalance - sumBalanceForPlots(balances, targetPlots, currentBalance))
      deltas.forEach((delta, plot) => balances.set(plot, (balances.get(plot) ?? 0) + delta))
      setPlotBalancesInBatch(db, transaction, balances, targetPlots)
      syncUserBalancesInBatch(db, transaction, users.filter(user => user.exists()), balances)
    }
    transaction.set(auditRef, {
      actorId: actor.id, actorName: actor.fullName, actorRole: actor.role,
      title: 'Изменен баланс участника', message: `Баланс изменен с ${currentBalance} ₽ на ${newBalance} ₽.`,
      targetUserId: targetUser.id, targetUserName: String(data.fullName ?? ''), targetPlotName: targetPlots.join(', '),
      createdAt: serverTimestamp(), createdAtClient: Date.now(),
    })
  })
}

export async function setUserRole(
  db: Firestore,
  actor: RemoteUser,
  targetUser: RemoteUser,
  role: Role,
) {
  await updateDoc(doc(db, 'users', targetUser.id), { role })
  await createAuditLog(
    db,
    actor,
    role === 'MODERATOR' ? 'Назначен модератор' : 'Снята роль модератора',
    role === 'MODERATOR'
      ? 'Пользователю назначена роль модератора.'
      : 'Пользователь переведен в обычные участники.',
    targetUser.id,
    targetUser.fullName,
    formatPlots(targetUser),
  )
}

export async function deleteUserRecord(db: Firestore, actor: RemoteUser, targetUser: RemoteUser) {
  await enqueueTargetedNotification(
    db,
    {
      title: 'Auth cleanup',
      body: `Delete auth account for ${targetUser.fullName}`,
      destination: 'auth',
      category: 'system',
      targetUserIds: [targetUser.id],
      sendEmail: false,
      sendPush: false,
      authDeleteUserId: targetUser.id,
      cleanupWebPushUserId: targetUser.id,
    },
    {
      creatorId: actor.id,
    },
  )
  await Promise.all([
    deleteDoc(doc(db, 'users', targetUser.id)),
    deleteDoc(doc(db, 'registration_requests', targetUser.id)),
  ])

  await createAuditLog(
    db,
    actor,
    'Удален пользователь',
    'Пользователь лишен доступа к приложению и веб-версии.',
    targetUser.id,
    targetUser.fullName,
    formatPlots(targetUser),
  )
}
export async function markChatRead(db: Firestore, userId: string, latestSeen: number, currentLastReadAt: number) {
  if (latestSeen <= 0 || latestSeen <= currentLastReadAt) return
  const reference = doc(db, 'users', userId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference)
    if (snapshot.exists() && latestSeen > Number(snapshot.data().lastChatReadAt ?? 0)) {
      transaction.update(reference, { lastChatReadAt: latestSeen })
    }
  })
}

export async function sendChatMessage(
  db: Firestore,
  profile: RemoteUser,
  text: string,
  replyTo: ChatMessage | null,
  mentionedUserIds: string[] = [],
  attachments: ChatAttachment[] = [],
) {
  const normalizedText = text.trim()
  if (!normalizedText && attachments.length === 0) return

  await addDoc(collection(db, 'chat_messages'), {
    senderId: profile.id,
    senderName: profile.fullName,
    senderPlotName: formatPlots(profile),
    text: normalizedText,
    attachments,
    replyToMessageId: replyTo?.id ?? '',
    replyToSenderName: replyTo?.senderName ?? '',
    replyToSenderPlotName: replyTo?.senderPlotName ?? '',
    replyToText: replyTo?.text || (replyTo?.attachments.length ? 'Вложение' : ''),
    mentionedUserIds: Array.from(new Set(mentionedUserIds.map((item) => item.trim()).filter(Boolean))),
    isPinned: false,
    pinnedByUserId: '',
    pinnedByUserName: '',
    pinnedAtClient: 0,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
    updatedAtClient: 0,
  })
}

export async function saveEditedChatMessage(db: Firestore, profile: RemoteUser, messageId: string, text: string) {
  const normalizedText = text.trim()
  if (!normalizedText) return

  await updateDoc(doc(db, 'chat_messages', messageId), {
    text: normalizedText,
    senderName: profile.fullName,
    senderPlotName: formatPlots(profile),
    updatedAtClient: Date.now(),
  })
}

export async function togglePinnedChatMessage(db: Firestore, profile: RemoteUser, message: ChatMessage) {
  await updateDoc(doc(db, 'chat_messages', message.id), {
    isPinned: !message.isPinned,
    pinnedByUserId: !message.isPinned ? profile.id : '',
    pinnedByUserName: !message.isPinned ? profile.fullName : '',
    pinnedAtClient: !message.isPinned ? Date.now() : 0,
  })
}

export async function removeChatMessage(db: Firestore, messageId: string) {
  await deleteDoc(doc(db, 'chat_messages', messageId))
}

export async function createEvent(db: Firestore, creator: RemoteUser, draft: EventDraft) {
  const title = draft.title.trim()
  const message = draft.message.trim()
  const amount = draft.type === 'INFO' ? 0 : draft.amount
  const type = draft.type
  const closesAtClient = type === 'CHARGE' ? validateChargeDeadline(draft.closesAtClient ?? 0) : 0

  if (!title) throw new Error('Укажите заголовок')
  if ((type === 'CHARGE' || type === 'EXPENSE') && (!Number.isSafeInteger(amount) || amount <= 0)) {
    throw new Error('Укажите сумму в целых рублях больше нуля.')
  }

  const eventPayload = {
    closesAtClient,
    title,
    message,
    type,
    amount,
    isClosed: false,
    isAnonymous: false,
    pollOptions: [],
    pollVotes: {},
    voterIds: [],
    voterChoices: {},
    targetUserId: '',
    createdById: creator.id,
    createdByName: creator.fullName,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  }

  const eventRef = doc(collection(db, 'events'))
  const auditRef = doc(collection(db, 'audit_logs'))
  if (type === 'CHARGE') await ensurePlotAccounts(db)
  const userDocs = type === 'CHARGE' ? (await getDocs(collection(db, 'users'))).docs : []
  await runTransaction(db, async transaction => {
    if (type === 'CHARGE') {
      const users = await Promise.all(userDocs.map(user => transaction.get(user.ref)))
      const plots = await Promise.all(PLOT_OPTIONS.map(plot => transaction.get(doc(db, PLOTS_COLLECTION, plotDocumentId(plot)))))
      const balances = new Map(PLOT_OPTIONS.map((plot, index) => [plot, Number(plots[index].data()?.balance ?? 0) - amount]))
      setPlotBalancesInBatch(db, transaction, balances, PLOT_OPTIONS)
      syncUserBalancesInBatch(db, transaction, users.filter(user => user.exists()), balances)
      users.filter(user => user.exists()).forEach(user => {
        const totalCharge = amount * extractPlotsFromUserData(user.data()!).length
        if (!totalCharge) return
        transaction.set(doc(collection(db, 'payments')), {
          userId: user.id, amount: -totalCharge, note: `Charge event: ${title}`,
          createdAt: serverTimestamp(), createdAtClient: Date.now(),
        })
      })
    } else if (type === 'EXPENSE') {
      const fundsRef = doc(db, 'app_settings', 'community_funds')
      const funds = await transaction.get(fundsRef)
      const currentFunds = Number(funds.data()?.amount ?? 0)
      if (currentFunds < amount) throw new Error('Недостаточно средств в общей кассе')
      transaction.set(fundsRef, { amount: currentFunds - amount })
    }
    transaction.set(eventRef, eventPayload)
    if (creator.role === 'ADMIN' || creator.role === 'MODERATOR') transaction.set(auditRef, {
      actorId: creator.id, actorName: creator.fullName, actorRole: creator.role,
      title: type === 'CHARGE' ? 'Создан сбор' : type === 'EXPENSE' ? 'Создана оплата' : 'Создано объявление',
      message: type === 'CHARGE' || type === 'EXPENSE' ? `${title}. Сумма: ${amount} ₽.` : title,
      targetUserId: '', targetUserName: '', targetPlotName: '', createdAt: serverTimestamp(), createdAtClient: Date.now(),
    })
  })
}

export async function updateEvent(
  db: Firestore,
  editor: RemoteUser,
  event: CommunityEvent,
  payload: EditableEventDraft,
) {
  if (editor.role !== 'ADMIN' && editor.role !== 'MODERATOR') {
    throw new Error('Редактировать событие может только модератор или администратор.')
  }

  const nextTitle = payload.title.trim()
  const nextMessage = payload.message.trim()
  if (!nextTitle) {
    throw new Error('Укажите заголовок события.')
  }

  await updateDoc(doc(db, 'events', event.id), {
    title: nextTitle,
    message: nextMessage,
    editedById: editor.id,
    editedByName: editor.fullName,
    editedAtClient: Date.now(),
  })

  await createAuditLog(
    db,
    editor,
    'Изменено событие',
    `Событие "${event.title}" отредактировано.`,
    '',
    '',
    '',
  )
}

export async function closeCharge(db: Firestore, reviewer: RemoteUser, event: CommunityEvent) {
  if (event.type !== 'CHARGE' || event.isClosed) return
  if (reviewer.role !== 'ADMIN' && reviewer.role !== 'MODERATOR') {
    throw new Error('Закрыть сбор может только модератор или администратор')
  }

  await updateDoc(doc(db, 'events', event.id), {
    isClosed: true,
    closedById: reviewer.id,
    closedByName: reviewer.fullName,
    closedAtClient: Date.now(),
    message: event.message.trim()
      ? `${event.message.trim()}\n\nСбор завершен.`
      : 'Сбор завершен.',
  })

  await createAuditLog(db, reviewer, 'Закрыт сбор', event.title)
}

export async function submitPoll(db: Firestore, profile: RemoteUser, pollDraft: PollDraft) {
  const title = pollDraft.title.trim()
  const message = pollDraft.message.trim()
  const options = pollDraft.options
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  if (!title) throw new Error('Укажите заголовок опроса')
  if (options.length < 2 || options.length > 8 || new Set(options.map(option => option.toLowerCase())).size !== options.length) throw new Error('Нужно от 2 до 8 разных вариантов ответа')

  await addDoc(collection(db, 'events'), {
    title,
    message,
    type: 'POLL',
    amount: 0,
    isClosed: false,
    isAnonymous: Boolean(pollDraft.isAnonymous),
    pollOptions: options,
    pollVotes: options.reduce<Record<string, number>>((accumulator, option) => {
      accumulator[option] = 0
      return accumulator
    }, {}),
    voterIds: [],
    voterChoices: {},
    targetUserId: '',
    createdById: profile.id,
    createdByName: profile.fullName,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  })

  if (profile.role === 'ADMIN' || profile.role === 'MODERATOR') {
    await createAuditLog(db, profile, 'Создан опрос', title)
  }

  return INITIAL_POLL_DRAFT
}

export async function closePoll(db: Firestore, profile: RemoteUser, poll: CommunityEvent) {
  if (poll.isClosed) return
  if (poll.createdById !== profile.id && profile.role !== 'MODERATOR' && profile.role !== 'ADMIN') {
    throw new Error('Закрыть опрос может только создатель, модератор или администратор')
  }

  await updateDoc(doc(db, 'events', poll.id), {
    isClosed: true,
    closedById: profile.id,
    closedByName: profile.fullName,
    closedAtClient: Date.now(),
    message: poll.message,
  })

  if (profile.role === 'ADMIN' || profile.role === 'MODERATOR') {
    await createAuditLog(db, profile, 'Закрыт опрос', poll.title)
  }
}

export async function createPaymentRequest(
  db: Firestore,
  profile: RemoteUser,
  amount: number,
  events: CommunityEvent[],
  purpose: string,
  selectedPlots?: string[],
) {
  const normalizedAmount = amount
  const cleanPurpose = purpose.trim()
  const cleanEvents = events.filter((item) => item.type === 'CHARGE').filter((item, index, array) => {
    return array.findIndex((candidate) => candidate.id === item.id) === index
  })
  const eventIds = cleanEvents.map((item) => item.id)
  const ownedPlots = normalizePlots(profile.plots.length ? profile.plots : [profile.plotName])
  const plotIds = normalizePlots(selectedPlots ?? ownedPlots)
  if (!plotIds.length || plotIds.some(plot => !ownedPlots.includes(plot))) throw new Error('Выберите свои участки для оплаты')

  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('Укажите сумму в целых рублях больше нуля')
  if (!cleanPurpose) throw new Error('Укажите назначение платежа')

  const requestRef = doc(collection(db, 'payment_requests'))
  await runTransaction(db, async transaction => {
    const owner = await transaction.get(doc(db, 'users', profile.id))
    const currentPlots = owner.exists() ? extractPlotsFromUserData(owner.data()) : []
    if (plotIds.some(plot => !currentPlots.includes(plot))) throw new Error('Список ваших участков изменился. Обновите страницу.')
    for (const event of cleanEvents) {
      const snapshot = await transaction.get(doc(db, 'events', event.id))
      if (!snapshot.exists() || snapshot.data().type !== 'CHARGE' || isChargeClosed({ type: 'CHARGE', isClosed: Boolean(snapshot.data().isClosed), closesAtClient: Number(snapshot.data().closesAtClient ?? 0) })) {
        throw new Error('Один из выбранных сборов уже закрыт. Обновите список сборов.')
      }
    }
    transaction.set(requestRef, {
      userId: profile.id,
      userName: profile.fullName,
      plotName: plotIds.join(', '),
      amount: normalizedAmount,
      eventId: eventIds.join(','),
      eventIds,
      plotIds,
      eventTitle: cleanEvents.map((item) => item.title).join(', '),
      purpose: cleanPurpose,
      status: 'PENDING',
      reviewedByName: '',
      reviewReason: '',
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
    })
  })
}

export async function savePaymentConfig(
  db: Firestore,
  config: {
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
  },
) {
  await setDoc(doc(db, 'app_settings', 'payment_config'), {
    recipientName: config.recipientName.trim(),
    recipientPhone: config.recipientPhone.trim(),
    bankName: config.bankName.trim(),
    accountNumber: config.accountNumber.trim(),
    paymentPurpose: config.paymentPurpose.trim(),
    bik: config.bik.trim(),
    correspondentAccount: config.correspondentAccount.trim(),
    recipientInn: config.recipientInn.trim(),
    recipientKpp: config.recipientKpp.trim(),
    sbpLink: config.sbpLink.trim(),
  })
}

function recordPaymentReview(
  db: Firestore, transaction: Transaction, reviewer: RemoteUser, requestId: string,
  request: Record<string, unknown>, status: 'CONFIRMED' | 'REJECTED', reason = '',
) {
  const confirmed = status === 'CONFIRMED'
  const title = confirmed ? 'Оплата подтверждена' : 'Оплата отклонена'
  const purpose = String(request.eventTitle || request.purpose || '').trim()
  const amount = Number(request.amount ?? 0)
  const message = confirmed
    ? `Ваш платеж на сумму ${amount} ₽ подтвержден.${purpose ? ` Назначение: ${purpose}.` : ''}`
    : `Ваш платеж на сумму ${amount} ₽ отклонен.${reason ? ` Причина: ${reason}.` : ' Уточните детали у администратора или модератора.'}`
  const createdAtClient = Date.now()
  transaction.set(doc(db, 'events', `payment-review-${requestId}`), {
    title, message, type: 'INFO', amount: 0, isClosed: false, targetUserId: String(request.userId),
    createdById: reviewer.id, createdByName: reviewer.fullName, createdAt: serverTimestamp(), createdAtClient,
  })
  transaction.set(doc(db, 'audit_logs', `payment-review-${requestId}`), {
    actorId: reviewer.id, actorName: reviewer.fullName, actorRole: reviewer.role,
    title, message, targetUserId: String(request.userId), targetUserName: String(request.userName ?? ''),
    targetPlotName: String(request.plotName ?? ''), createdAt: serverTimestamp(), createdAtClient,
  })
}

export async function confirmPaymentRequest(
  db: Firestore,
  reviewer: RemoteUser,
  requestId: string,
) {
  await ensurePlotAccounts(db)
  const allUsersSnapshot = await getDocs(collection(db, 'users'))
  const requestRef = doc(db, 'payment_requests', requestId)
  const fundsRef = doc(db, 'app_settings', 'community_funds')

  const confirmedRequest = await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef)
    const requestData = requestSnapshot.data()
    if (!requestData) return null

    const userId = String(requestData.userId ?? '')
    const amount = Number(requestData.amount ?? 0)
    const status = String(requestData.status ?? '')
    if (status !== 'PENDING') return null
    if (!userId || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('В заявке указана некорректная сумма или плательщик.')

    const currentFundsSnapshot = await transaction.get(fundsRef)

    const requestPlotIds = Array.isArray(requestData.plotIds)
      ? normalizePlots(requestData.plotIds.map(String))
      : []
    const payerPlots =
      requestPlotIds.length > 0 ? requestPlotIds : normalizePlots(String(requestData.plotName ?? '').split(','))
    if (!payerPlots.length) throw new Error('В заявке не указаны участки. Уточните данные перед подтверждением.')
    const plotShares = splitAmountAcrossPlots(payerPlots, amount)
    const currentFunds = Number(currentFundsSnapshot.data()?.amount ?? 0)

    // Read current balances in the transaction: concurrent approvals must not overwrite one another.
    const currentUsers = await Promise.all(allUsersSnapshot.docs.map(item => transaction.get(item.ref)))
    const affectedUsers = currentUsers.filter(item => item.exists() &&
      (item.id === userId || extractPlotsFromUserData(item.data()!).some(plot => payerPlots.includes(plot))))
    const relatedPlots = normalizePlots([...payerPlots, ...affectedUsers.flatMap(item => extractPlotsFromUserData(item.data() ?? {}))])
    const currentPlots = await Promise.all(relatedPlots.map(plot => transaction.get(doc(db, PLOTS_COLLECTION, plotDocumentId(plot)))))
    const nextPlotBalances = new Map(relatedPlots.map((plot, index) => [plot, Number(currentPlots[index].data()?.balance ?? 0)]))
    plotShares.forEach((increment, plot) => {
      nextPlotBalances.set(plot, (nextPlotBalances.get(plot) ?? 0) + increment)
      transaction.set(
        doc(db, PLOTS_COLLECTION, plotDocumentId(plot)),
        {
          name: plot,
          balance: nextPlotBalances.get(plot) ?? 0,
          sortOrder: plotSortValue(plot),
          updatedAt: serverTimestamp(),
          updatedAtClient: Date.now(),
        },
        { merge: true },
      )
    })

    affectedUsers.filter(item => item.exists()).forEach((item) => {
      const data = item.data() as Record<string, unknown>
      const currentBalance = Number(data.balance ?? 0)
      const nextBalance = sumBalanceForPlots(nextPlotBalances, extractPlotsFromUserData(data), currentBalance)
      if (currentBalance === nextBalance) return
      transaction.update(doc(db, 'users', item.id), {
        balance: nextBalance,
      })
    })

    transaction.update(requestRef, {
      status: 'CONFIRMED',
      reviewedById: reviewer.id,
      reviewedByName: reviewer.fullName,
      reviewReason: '',
      reviewedAt: serverTimestamp(),
    })
    transaction.set(fundsRef, { amount: currentFunds + amount })

    recordPaymentReview(db, transaction, reviewer, requestId, requestData, 'CONFIRMED')
    return true
  })
  return Boolean(confirmedRequest)
}

export async function rejectPaymentRequest(
  db: Firestore,
  reviewer: RemoteUser,
  requestId: string,
  reason: string,
) {
  const requestRef = doc(db, 'payment_requests', requestId)
  const normalizedReason = reason.trim()
  const requestData = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(requestRef)
    const data = snapshot.data()
    if (!data || data.status !== 'PENDING') return null
    transaction.update(requestRef, {
      status: 'REJECTED', reviewedById: reviewer.id, reviewedByName: reviewer.fullName,
      reviewReason: normalizedReason, reviewedAt: serverTimestamp(),
    })
    recordPaymentReview(db, transaction, reviewer, requestId, data, 'REJECTED', normalizedReason)
    return true
  })
  return Boolean(requestData)
}

export async function voteInPoll(db: Firestore, profile: RemoteUser, poll: CommunityEvent, option: string) {
  const reference = doc(db, 'events', poll.id)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.data()
    if (!current || current.type !== 'POLL') throw new Error('Голосование удалено.')
    if (current.isClosed) throw new Error('Голосование уже завершено.')
    if (!current.pollOptions?.includes(option)) throw new Error('Вариант ответа больше недоступен.')
    const voterIds: string[] = current.voterIds ?? []
    if (voterIds.includes(profile.id)) return
    transaction.update(reference, {
      pollVotes: { ...current.pollVotes, [option]: Number(current.pollVotes?.[option] ?? 0) + 1 },
      voterIds: [...voterIds, profile.id],
      voterChoices: { ...current.voterChoices, [profile.id]: option },
    })
  })
}

export async function toggleChatReaction(db: Firestore, userId: string, messageId: string, emoji: string) {
  if (!['👍', '❤️', '😂', '🎉', '🙏', '👎'].includes(emoji)) return
  const reference = doc(db, 'chat_messages', messageId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Сообщение удалено')
    const reactions: Record<string, string> = { ...(snapshot.data().reactions ?? {}) }
    if (reactions[userId] === emoji) delete reactions[userId]
    else reactions[userId] = emoji
    transaction.update(reference, { reactions })
  })
}
