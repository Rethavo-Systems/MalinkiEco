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
import {
  createUserWithEmailAndPassword,
  getIdToken,
  signOut,
  type Auth,
} from 'firebase/auth'
import type {
  AuthFormState,
  ChatMessage,
  CommunityEvent,
  EventType,
  PollDraft,
  RegistrationRequest,
  RemoteUser,
  Role,
} from '../types'
import {
  formatPlots,
  isValidRussianPhoneInput,
  normalizeAuthEmail,
  normalizeRussianPhone,
  parsePlots,
} from '../utils'
import { INITIAL_POLL_DRAFT } from '../constants'

const DEFAULT_BACKEND_URL = 'https://malinkieco-production.up.railway.app'

function backendUrl(path: string) {
  const base = (import.meta.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  return `${base}${path}`
}

type EventDraft = {
  title: string
  message: string
  type: EventType
  amount: number
}

export async function publishBroadcastNotification(
  auth: Auth,
  payload: {
    title: string
    body: string
    destination: string
    category: string
    excludedUserIds?: string[]
  },
) {
  const currentUser = auth.currentUser
  if (!currentUser) throw new Error('Пользователь не авторизован')

  const idToken = await getIdToken(currentUser, true)
  const response = await fetch(backendUrl('/api/notifications/publish'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      audience: 'broadcast',
      title: payload.title,
      body: payload.body,
      destination: payload.destination,
      category: payload.category,
      excludedUserIds: payload.excludedUserIds ?? [],
    }),
  })

  if (!response.ok) {
    let errorText = 'Не удалось отправить уведомление'
    try {
      const payload = await response.json()
      if (payload?.error) errorText = String(payload.error)
    } catch {
      // ignore json parse error
    }
    throw new Error(errorText)
  }
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

export async function submitRegistrationRequest(auth: Auth, db: Firestore, form: AuthFormState) {
  const login = form.login.trim()
  const fullName = form.fullName.trim()
  const phoneDigits = form.phone.replace(/\D/g, '')
  const plots = parsePlots(form.plots)

  if (!login) throw new Error('Введите логин или почту')
  if (!fullName) throw new Error('Введите отображаемое имя')
  if (form.password.trim().length < 6) throw new Error('Пароль должен быть не короче 6 символов')
  if (!isValidRussianPhoneInput(phoneDigits)) throw new Error('Номер телефона должен содержать 10 цифр после 8')
  if (plots.length === 0) throw new Error('Укажите хотя бы один участок')

  const credential = await createUserWithEmailAndPassword(auth, normalizeAuthEmail(login), form.password)
  const userId = credential.user.uid

  await setDoc(doc(db, 'registration_requests', userId), {
    login,
    authEmail: normalizeAuthEmail(login),
    fullName,
    phone: normalizeRussianPhone(phoneDigits),
    plots,
    status: 'PENDING',
    reviewedByName: '',
    reviewReason: '',
    createdAt: serverTimestamp(),
    createdAtClient: Date.now(),
  })

  await signOut(auth)
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
    'Отклонена регистрация',
    normalizedReason
      ? `Заявка на регистрацию отклонена. Причина: ${normalizedReason}.`
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
  await updateDoc(doc(db, 'users', targetUser.id), { balance: newBalance })
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

export async function deleteUserRecord(
  auth: Auth,
  targetUser: RemoteUser,
) {
  const currentUser = auth.currentUser
  if (!currentUser) throw new Error('Пользователь не авторизован')

  const idToken = await getIdToken(currentUser, true)
  const response = await fetch(backendUrl(`/api/admin/users/${encodeURIComponent(targetUser.id)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  })

  if (!response.ok) {
    let errorText = 'Не удалось удалить пользователя'
    try {
      const payload = await response.json()
      if (payload?.error) errorText = String(payload.error)
    } catch {
      // ignore json parse error
    }
    throw new Error(errorText)
  }
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
      (type === 'CHARGE' || type === 'EXPENSE') ? `${title}. Сумма: ${amount} ₽.` : title,
    )
  }
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
