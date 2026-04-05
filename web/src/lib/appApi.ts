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
import type {
  ChatMessage,
  CommunityEvent,
  EventType,
  PollDraft,
  RegistrationRequest,
  RemoteUser,
  Role,
} from '../types'
import { formatPlots } from '../utils'
import { INITIAL_POLL_DRAFT } from '../constants'

type EventDraft = {
  title: string
  message: string
  type: EventType
  amount: number
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
}

async function enqueueNotificationJob(
  db: Firestore,
  audience: 'broadcast' | 'users' | 'emails',
  payload: NotificationJobPayload,
) {
  const title = payload.title.trim()
  const body = payload.body.trim()
  const destination = payload.destination.trim()
  const category = payload.category.trim()
  const targetUserIds = (payload.targetUserIds ?? []).map((item) => item.trim()).filter(Boolean)
  const excludedUserIds = (payload.excludedUserIds ?? []).map((item) => item.trim()).filter(Boolean)
  const emailTargets = (payload.emailTargets ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)

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
  await addDoc(collection(db, 'notification_jobs'), {
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
    attempts: 0,
    createdAt: serverTimestamp(),
    createdAtClient,
    nextAttemptAtClient: createdAtClient,
    processingWorker: '',
    lastError: '',
  })
}

export async function enqueueBroadcastNotification(db: Firestore, payload: NotificationJobPayload) {
  await enqueueNotificationJob(db, 'broadcast', payload)
}

export async function enqueueTargetedNotification(db: Firestore, payload: NotificationJobPayload) {
  await enqueueNotificationJob(db, 'users', payload)
}

export async function enqueueEmailNotification(db: Firestore, payload: NotificationJobPayload) {
  await enqueueNotificationJob(db, 'emails', payload)
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

function extractPlotsFromUserData(data: Record<string, unknown>) {
  const plots = Array.isArray(data.plots) ? data.plots.map(String).filter(Boolean) : []
  const plotName = String(data.plotName ?? '')
  return plots.length > 0 ? plots : [plotName].filter(Boolean)
}

function splitAmountAcrossPlots(plots: string[], amount: number) {
  const normalizedPlots = plots.filter(Boolean)
  if (normalizedPlots.length === 0) return {}

  const baseShare = Math.floor(amount / normalizedPlots.length)
  let remainder = amount % normalizedPlots.length
  const shares: Record<string, number> = {}

  normalizedPlots.forEach((plot) => {
    const extra = remainder > 0 ? 1 : 0
    shares[plot] = (shares[plot] ?? 0) + baseShare + extra
    remainder -= extra
  })

  return shares
}

export async function approveRegistrationRequest(
  db: Firestore,
  reviewer: RemoteUser,
  request: RegistrationRequest,
) {
  const requestRef = doc(db, 'registration_requests', request.id)
  const userRef = doc(db, 'users', request.id)

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
      balance: 0,
      lastChatReadAt: 0,
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
    'РћРґРѕР±СЂРµРЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЏ',
    'Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕРґРѕР±СЂРµРЅР°.',
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
    'РћС‚РєР»РѕРЅРµРЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЏ',
    normalizedReason
      ? `Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕС‚РєР»РѕРЅРµРЅР°. РџСЂРёС‡РёРЅР°: ${normalizedReason}.`
      : 'Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕС‚РєР»РѕРЅРµРЅР°.',
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
  await updateDoc(doc(db, 'users', targetUser.id), { balance: newBalance })
  await createAuditLog(
    db,
    actor,
    'РР·РјРµРЅРµРЅ Р±Р°Р»Р°РЅСЃ СѓС‡Р°СЃС‚РЅРёРєР°',
    `Р‘Р°Р»Р°РЅСЃ РёР·РјРµРЅРµРЅ СЃ ${targetUser.balance} в‚Ѕ РЅР° ${newBalance} в‚Ѕ.`,
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
    role === 'MODERATOR' ? 'РќР°Р·РЅР°С‡РµРЅ РјРѕРґРµСЂР°С‚РѕСЂ' : 'РЎРЅСЏС‚Р° СЂРѕР»СЊ РјРѕРґРµСЂР°С‚РѕСЂР°',
    role === 'MODERATOR'
      ? 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЋ РЅР°Р·РЅР°С‡РµРЅР° СЂРѕР»СЊ РјРѕРґРµСЂР°С‚РѕСЂР°.'
      : 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїРµСЂРµРІРµРґРµРЅ РІ РѕР±С‹С‡РЅС‹Рµ СѓС‡Р°СЃС‚РЅРёРєРё.',
    targetUser.id,
    targetUser.fullName,
    formatPlots(targetUser),
  )
}

export async function deleteUserRecord(db: Firestore, actor: RemoteUser, targetUser: RemoteUser) {
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

export async function sendChatMessage(db: Firestore, profile: RemoteUser, text: string, replyTo: ChatMessage | null) {
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
    mentionedUserIds: [],
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

  if (!title) throw new Error('РЈРєР°Р¶РёС‚Рµ Р·Р°РіРѕР»РѕРІРѕРє')
  if ((type === 'CHARGE' || type === 'EXPENSE') && amount <= 0) {
    throw new Error('РЎСѓРјРјР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ Р±РѕР»СЊС€Рµ РЅСѓР»СЏ')
  }

  const eventPayload = {
    title,
    message,
    type,
    amount,
    isClosed: false,
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
    const usersSnapshot = await getDocs(collection(db, 'users'))
    const batch = writeBatch(db)
    usersSnapshot.docs.forEach((snapshot) => {
      const data = snapshot.data()
      const role = String(data.role ?? 'USER')
      if (role === 'ADMIN') return

      const plots = extractPlotsFromUserData(data)
      const plotCount = Math.max(plots.length, 1)
      const totalCharge = amount * plotCount
      const currentBalance = Number(data.balance ?? 0)

      batch.update(doc(db, 'users', snapshot.id), {
        balance: currentBalance - totalCharge,
      })
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
        throw new Error('РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РІ РѕР±С‰РµР№ РєР°СЃСЃРµ')
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
      type === 'CHARGE' ? 'РЎРѕР·РґР°РЅ СЃР±РѕСЂ' : type === 'EXPENSE' ? 'РЎРѕР·РґР°РЅР° РѕРїР»Р°С‚Р°' : 'РЎРѕР·РґР°РЅРѕ РѕР±СЉСЏРІР»РµРЅРёРµ',
      (type === 'CHARGE' || type === 'EXPENSE') ? `${title}. РЎСѓРјРјР°: ${amount} в‚Ѕ.` : title,
    )
  }
}

export async function closeCharge(db: Firestore, reviewer: RemoteUser, event: CommunityEvent) {
  if (event.type !== 'CHARGE' || event.isClosed) return
  if (reviewer.role !== 'ADMIN' && reviewer.role !== 'MODERATOR') {
    throw new Error('Р—Р°РєСЂС‹С‚СЊ СЃР±РѕСЂ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ РјРѕРґРµСЂР°С‚РѕСЂ РёР»Рё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ')
  }

  await updateDoc(doc(db, 'events', event.id), {
    isClosed: true,
    closedById: reviewer.id,
    closedByName: reviewer.fullName,
    closedAtClient: Date.now(),
    message: event.message.trim()
      ? `${event.message.trim()}\n\nРЎР±РѕСЂ Р·Р°РІРµСЂС€РµРЅ.`
      : 'РЎР±РѕСЂ Р·Р°РІРµСЂС€РµРЅ.',
  })

  await createAuditLog(db, reviewer, 'Р—Р°РєСЂС‹С‚ СЃР±РѕСЂ', event.title)
}

export async function submitPoll(db: Firestore, profile: RemoteUser, pollDraft: PollDraft) {
  const title = pollDraft.title.trim()
  const message = pollDraft.message.trim()
  const options = pollDraft.options
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)

  if (!title) throw new Error('РЈРєР°Р¶РёС‚Рµ Р·Р°РіРѕР»РѕРІРѕРє РѕРїСЂРѕСЃР°')
  if (options.length < 2) throw new Error('Р”Р»СЏ РѕРїСЂРѕСЃР° РЅСѓР¶РЅРѕ РјРёРЅРёРјСѓРј РґРІР° РІР°СЂРёР°РЅС‚Р° РѕС‚РІРµС‚Р°')

  await addDoc(collection(db, 'events'), {
    title,
    message,
    type: 'POLL',
    amount: 0,
    isClosed: false,
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
    await createAuditLog(db, profile, 'РЎРѕР·РґР°РЅ РѕРїСЂРѕСЃ', title)
  }

  return INITIAL_POLL_DRAFT
}

export async function closePoll(db: Firestore, profile: RemoteUser, poll: CommunityEvent) {
  if (poll.isClosed) return
  if (poll.createdById !== profile.id && profile.role !== 'MODERATOR' && profile.role !== 'ADMIN') {
    throw new Error('Р—Р°РєСЂС‹С‚СЊ РѕРїСЂРѕСЃ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ СЃРѕР·РґР°С‚РµР»СЊ, РјРѕРґРµСЂР°С‚РѕСЂ РёР»Рё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ')
  }

  await updateDoc(doc(db, 'events', poll.id), {
    isClosed: true,
    closedById: profile.id,
    closedByName: profile.fullName,
    closedAtClient: Date.now(),
    message: poll.message,
  })

  if (profile.role === 'ADMIN' || profile.role === 'MODERATOR') {
    await createAuditLog(db, profile, 'Р—Р°РєСЂС‹С‚ РѕРїСЂРѕСЃ', poll.title)
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

  if (normalizedAmount <= 0) throw new Error('РЈРєР°Р¶РёС‚Рµ СЃСѓРјРјСѓ Р±РѕР»СЊС€Рµ РЅСѓР»СЏ')

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

    const affectedUsers = allUsersSnapshot.docs
      .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() as Record<string, unknown> }))
      .map((item) => {
        const plots = extractPlotsFromUserData(item.data)
        const role = String(item.data.role ?? 'USER')
        const increment = plots.reduce((sum, plot) => sum + (plotShares[plot] ?? 0), 0)
        return { ...item, role, increment }
      })
      .filter((item) => item.role !== 'ADMIN' && item.increment !== 0)

    affectedUsers.forEach((item) => {
      const currentBalance = Number(item.data.balance ?? 0)
      transaction.update(doc(db, 'users', item.id), {
        balance: currentBalance + item.increment,
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
    'РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°',
    confirmedRequest.eventTitle
      ? `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.eventTitle}.`
      : confirmedRequest.purpose
        ? `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.purpose}.`
        : `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ.`,
  )
  await createAuditLog(
    db,
    reviewer,
    'РџРѕРґС‚РІРµСЂР¶РґРµРЅР° РѕРїР»Р°С‚Р°',
    confirmedRequest.eventTitle
      ? `РџРѕРґС‚РІРµСЂР¶РґРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${confirmedRequest.amount} в‚Ѕ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.eventTitle}.`
      : confirmedRequest.purpose
        ? `РџРѕРґС‚РІРµСЂР¶РґРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${confirmedRequest.amount} в‚Ѕ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.purpose}.`
        : `РџРѕРґС‚РІРµСЂР¶РґРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${confirmedRequest.amount} в‚Ѕ.`,
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
    'РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°',
    normalizedReason
      ? `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РџСЂРёС‡РёРЅР°: ${normalizedReason}.`
      : `Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РЈС‚РѕС‡РЅРёС‚Рµ РґРµС‚Р°Р»Рё Сѓ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° РёР»Рё РјРѕРґРµСЂР°С‚РѕСЂР°.`,
  )
  await createAuditLog(
    db,
    reviewer,
    'РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р°',
    normalizedReason
      ? `РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${amount} в‚Ѕ. РџСЂРёС‡РёРЅР°: ${normalizedReason}.`
      : `РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${amount} в‚Ѕ.`,
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
