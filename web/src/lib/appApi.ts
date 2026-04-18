import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { push, ref, set, type Database } from 'firebase/database'
import type {
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
  } catch (error) {
    await deleteDoc(jobRef).catch(() => undefined)
    throw error
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

async function createTargetedEvent(
  db: Firestore,
  creator: RemoteUser,
  userId: string,
  title: string,
  message: string,
) {
  await addDoc(collection(db, 'events'), {
    title: title.trim(),
    message: message.trim(),
    type: 'INFO',
    amount: 0,
    isClosed: false,
    targetUserId: userId,
    createdById: creator.id,
    createdByName: creator.fullName,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  })
}

export async function ensurePlotAccounts(db: Firestore) {
  const [plotsSnapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, PLOTS_COLLECTION)),
    getDocs(collection(db, 'users')),
  ])

  const initialBalances = deriveInitialPlotBalancesFromUsers(
    usersSnapshot.docs.map((item) => item.data() as Record<string, unknown>),
  )
  const plotBalances = new Map<string, number>(PLOT_OPTIONS.map((plot) => [plot, initialBalances.get(plot) ?? 0]))
  const existingPlots = new Set<string>()

  plotsSnapshot.docs.forEach((item) => {
    const data = item.data() as Record<string, unknown>
    const name = normalizePlots([String(data.name ?? '')])[0] ?? ''
    if (!name) return
    existingPlots.add(name)
    plotBalances.set(name, Number(data.balance ?? 0))
  })

  const batch = writeBatch(db)
  let hasWrites = false
  const updatedAtClient = Date.now()

  PLOT_OPTIONS.forEach((plot) => {
    if (existingPlots.has(plot)) return
    batch.set(doc(db, PLOTS_COLLECTION, plotDocumentId(plot)), {
      name: plot,
      balance: plotBalances.get(plot) ?? 0,
      sortOrder: plotSortValue(plot),
      updatedAt: serverTimestamp(),
      updatedAtClient,
    })
    hasWrites = true
  })

  usersSnapshot.docs.forEach((item) => {
    const data = item.data() as Record<string, unknown>
    const currentBalance = Number(data.balance ?? 0)
    const nextBalance = sumBalanceForPlots(plotBalances, extractPlotsFromUserData(data), currentBalance)
    if (currentBalance === nextBalance) return
    batch.update(doc(db, 'users', item.id), { balance: nextBalance })
    hasWrites = true
  })

  if (hasWrites) {
    await batch.commit()
  }

  return plotBalances
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
  batch: ReturnType<typeof writeBatch>,
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
  batch: ReturnType<typeof writeBatch>,
  userDocs: Awaited<ReturnType<typeof getDocs>>['docs'],
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
}

export async function setUserBalance(
  db: Firestore,
  actor: RemoteUser,
  targetUser: RemoteUser,
  newBalance: number,
) {
  const targetPlots = normalizePlots(targetUser.plots.length > 0 ? targetUser.plots : [targetUser.plotName])
  if (targetPlots.length === 0) {
    await updateDoc(doc(db, 'users', targetUser.id), { balance: newBalance })
  } else {
    const plotBalances = await ensurePlotAccounts(db)
    const currentBalance = sumBalanceForPlots(plotBalances, targetPlots, targetUser.balance)
    const nextPlotBalances = new Map(plotBalances)
    const deltaByPlot = splitAmountAcrossPlots(targetPlots, newBalance - currentBalance)
    deltaByPlot.forEach((delta, plot) => {
      nextPlotBalances.set(plot, (nextPlotBalances.get(plot) ?? 0) + delta)
    })

    const usersSnapshot = await getDocs(collection(db, 'users'))
    const batch = writeBatch(db)
    setPlotBalancesInBatch(db, batch, nextPlotBalances, [...deltaByPlot.keys()])
    syncUserBalancesInBatch(db, batch, usersSnapshot.docs, nextPlotBalances)
    await batch.commit()
  }

  await createAuditLog(
    db,
    actor,
    'Изменен баланс участника',
    `Баланс изменен с ${targetUser.balance} ₽ на ${newBalance} ₽.`,
    targetUser.id,
    targetUser.fullName,
    formatPlots(targetUser),
  )
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
  await updateDoc(doc(db, 'users', userId), { lastChatReadAt: latestSeen })
}

export async function sendChatMessage(
  db: Firestore,
  profile: RemoteUser,
  text: string,
  replyTo: ChatMessage | null,
  mentionedUserIds: string[] = [],
) {
  const normalizedText = text.trim()
  if (!normalizedText) return

  await addDoc(collection(db, 'chat_messages'), {
    senderId: profile.id,
    senderName: profile.fullName,
    senderPlotName: formatPlots(profile),
    text: normalizedText,
    replyToMessageId: replyTo?.id ?? '',
    replyToSenderName: replyTo?.senderName ?? '',
    replyToSenderPlotName: replyTo?.senderPlotName ?? '',
    replyToText: replyTo?.text ?? '',
    mentionedUserIds: Array.from(new Set(mentionedUserIds.map((item) => item.trim()).filter(Boolean))),
    isPinned: false,
    pinnedByUserId: '',
    pinnedByUserName: '',
    pinnedAtClient: 0,
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
    updatedAtClient: 0,
    clientNonce: '',
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
  const amount = Math.max(0, Math.round(draft.amount))
  const type = draft.type

  if (!title) throw new Error('Укажите заголовок')
  if ((type === 'CHARGE' || type === 'EXPENSE') && amount <= 0) {
    throw new Error('Сумма должна быть больше нуля')
  }

  const eventPayload = {
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

  if (type === 'CHARGE') {
    const plotBalances = await ensurePlotAccounts(db)
    const usersSnapshot = await getDocs(collection(db, 'users'))
    const batch = writeBatch(db)
    const nextPlotBalances = new Map(plotBalances)
    PLOT_OPTIONS.forEach((plot) => {
      nextPlotBalances.set(plot, (nextPlotBalances.get(plot) ?? 0) - amount)
    })

    setPlotBalancesInBatch(db, batch, nextPlotBalances, PLOT_OPTIONS)
    syncUserBalancesInBatch(db, batch, usersSnapshot.docs, nextPlotBalances)

    usersSnapshot.docs.forEach((snapshot) => {
      const data = snapshot.data()
      const plots = extractPlotsFromUserData(data)
      const plotCount = Math.max(plots.length, 1)
      const totalCharge = amount * plotCount
      if (totalCharge <= 0) return
      batch.set(doc(collection(db, 'payments')), {
        userId: snapshot.id,
        amount: -totalCharge,
        note: `Charge event: ${title}`,
        createdAt: serverTimestamp(),
        createdAtClient: Date.now(),
      })
    })
    batch.set(doc(collection(db, 'events')), eventPayload)
    await batch.commit()
  } else if (type === 'EXPENSE') {
    const fundsRef = doc(db, 'app_settings', 'community_funds')
    const eventRef = doc(collection(db, 'events'))

    await runTransaction(db, async (transaction) => {
      const fundsSnapshot = await transaction.get(fundsRef)
      const currentFunds = Number(fundsSnapshot.data()?.amount ?? 0)
      if (currentFunds < amount) {
        throw new Error('Недостаточно средств в общей кассе')
      }

      transaction.set(fundsRef, { amount: currentFunds - amount })
      transaction.set(eventRef, eventPayload)
    })
  } else {
    await addDoc(collection(db, 'events'), eventPayload)
  }

  if (creator.role === 'ADMIN' || creator.role === 'MODERATOR') {
    await createAuditLog(
      db,
      creator,
      type === 'CHARGE' ? 'Создан сбор' : type === 'EXPENSE' ? 'Создана оплата' : 'Создано объявление',
      type === 'CHARGE' || type === 'EXPENSE' ? `${title}. Сумма: ${amount} ₽.` : title,
    )
  }
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
    .slice(0, 8)

  if (!title) throw new Error('Укажите заголовок опроса')
  if (options.length < 2) throw new Error('Для опроса нужно минимум два варианта ответа')

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
) {
  const normalizedAmount = Math.round(amount)
  const cleanPurpose = purpose.trim()
  const cleanEvents = events.filter((item) => item.type === 'CHARGE').filter((item, index, array) => {
    return array.findIndex((candidate) => candidate.id === item.id) === index
  })

  if (normalizedAmount <= 0) throw new Error('Укажите сумму больше нуля')

  await addDoc(collection(db, 'payment_requests'), {
    userId: profile.id,
    userName: profile.fullName,
    plotName: formatPlots(profile),
    amount: normalizedAmount,
    eventId: cleanEvents.map((item) => item.id).join(','),
    eventTitle: cleanEvents.map((item) => item.title).join(', '),
    purpose: cleanPurpose,
    status: 'PENDING',
    reviewedByName: '',
    reviewReason: '',
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
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

export async function confirmPaymentRequest(
  db: Firestore,
  reviewer: RemoteUser,
  requestId: string,
) {
  const plotBalances = await ensurePlotAccounts(db)
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
    if (!userId || amount <= 0 || status !== 'PENDING') return null

    const userRef = doc(db, 'users', userId)
    const userSnapshot = await transaction.get(userRef)
    const currentFundsSnapshot = await transaction.get(fundsRef)

    const payerPlots = extractPlotsFromUserData((userSnapshot.data() ?? {}) as Record<string, unknown>)
    const plotShares = splitAmountAcrossPlots(payerPlots, amount)
    const currentFunds = Number(currentFundsSnapshot.data()?.amount ?? 0)

    const nextPlotBalances = new Map(plotBalances)
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

    allUsersSnapshot.docs.forEach((item) => {
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

    return {
      userId,
      amount,
      userName: String(requestData.userName ?? ''),
      plotName: String(requestData.plotName ?? ''),
      eventTitle: String(requestData.eventTitle ?? ''),
      purpose: String(requestData.purpose ?? ''),
    }
  })

  if (!confirmedRequest) return

  await createTargetedEvent(
    db,
    reviewer,
    confirmedRequest.userId,
    'Оплата подтверждена',
    confirmedRequest.eventTitle
      ? `Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден. Назначение: ${confirmedRequest.eventTitle}.`
      : confirmedRequest.purpose
        ? `Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден. Назначение: ${confirmedRequest.purpose}.`
        : `Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден.`,
  )
  await createAuditLog(
    db,
    reviewer,
    'Подтверждена оплата',
    confirmedRequest.eventTitle
      ? `Подтверждена оплата на ${confirmedRequest.amount} ₽. Назначение: ${confirmedRequest.eventTitle}.`
      : confirmedRequest.purpose
        ? `Подтверждена оплата на ${confirmedRequest.amount} ₽. Назначение: ${confirmedRequest.purpose}.`
        : `Подтверждена оплата на ${confirmedRequest.amount} ₽.`,
    confirmedRequest.userId,
    confirmedRequest.userName,
    confirmedRequest.plotName,
  )
}

export async function rejectPaymentRequest(
  db: Firestore,
  reviewer: RemoteUser,
  requestId: string,
  reason: string,
) {
  const requestRef = doc(db, 'payment_requests', requestId)
  const snapshot = await getDoc(requestRef)
  const requestData = snapshot.data()
  if (!requestData) return

  const normalizedReason = reason.trim()

  await updateDoc(requestRef, {
    status: 'REJECTED',
    reviewedById: reviewer.id,
    reviewedByName: reviewer.fullName,
    reviewReason: normalizedReason,
    reviewedAt: serverTimestamp(),
  })

  const userId = String(requestData.userId ?? '')
  const amount = Number(requestData.amount ?? 0)
  const userName = String(requestData.userName ?? '')
  const plotName = String(requestData.plotName ?? '')

  await createTargetedEvent(
    db,
    reviewer,
    userId,
    'Оплата отклонена',
    normalizedReason
      ? `Ваш платеж на сумму ${amount} ₽ отклонен. Причина: ${normalizedReason}.`
      : `Ваш платеж на сумму ${amount} ₽ отклонен. Уточните детали у администратора или модератора.`,
  )
  await createAuditLog(
    db,
    reviewer,
    'Отклонена оплата',
    normalizedReason
      ? `Отклонена оплата на ${amount} ₽. Причина: ${normalizedReason}.`
      : `Отклонена оплата на ${amount} ₽.`,
    userId,
    userName,
    plotName,
  )
}

export async function voteInPoll(db: Firestore, profile: RemoteUser, poll: CommunityEvent, option: string) {
  if (poll.voterIds.includes(profile.id) || poll.isClosed) return

  await updateDoc(doc(db, 'events', poll.id), {
    pollVotes: {
      ...poll.pollVotes,
      [option]: Number(poll.pollVotes[option] ?? 0) + 1,
    },
    voterIds: arrayUnion(profile.id),
    voterChoices: {
      ...poll.voterChoices,
      [profile.id]: option,
    },
  })
}
