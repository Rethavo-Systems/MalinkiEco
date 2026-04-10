import { useEffect, useMemo, useState } from 'react'
import { collection, doc, limitToLast, onSnapshot, orderBy, query } from 'firebase/firestore'
import { EMPTY_PAYMENT_CONFIG } from '../constants'
import { db, firebaseSetup } from '../lib/firebase'
import { ensurePlotAccounts } from '../lib/appApi'
import { PLOTS_COLLECTION, buildOwnersDirectory, normalizePlotName } from '../lib/plotAccounts'
import type {
  AuditLogEntry,
  ChatMessage,
  CommunityEvent,
  EventType,
  ManualPaymentRequest,
  ManualPaymentStatus,
  PaymentTransferConfig,
  RegistrationRequest,
  RegistrationRequestStatus,
  RemoteUser,
  Role,
  TabKey,
} from '../types'
import { extractCreatedAt, toRemoteUser } from '../utils'

export function useResidentData(profile: RemoteUser | null, activeTab: TabKey) {
  const [users, setUsers] = useState<RemoteUser[]>([])
  const [events, setEvents] = useState<CommunityEvent[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentTransferConfig>(EMPTY_PAYMENT_CONFIG)
  const [communityFunds, setCommunityFunds] = useState(0)
  const [paymentRequests, setPaymentRequests] = useState<ManualPaymentRequest[]>([])
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [plotBalances, setPlotBalances] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    if (!firebaseSetup.ready || !db || !profile) return

    const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'
    const needsEvents = activeTab === 'events' || activeTab === 'polls' || activeTab === 'payments'
    const needsChat = activeTab === 'chat'
    const needsOwners = activeTab === 'owners'
    const needsPayments = activeTab === 'payments'
    const needsLogs = activeTab === 'logs'

    if (isStaff) {
      void ensurePlotAccounts(db)
    }

    const usersQuery = query(collection(db, 'users'), orderBy('fullName', 'asc'))

    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const nextUsers = snapshot.docs
        .map((item) => toRemoteUser(item.id, item.data()))
        .filter((item): item is RemoteUser => item !== null)
      setUsers(nextUsers)
    })

    let unsubscribePlots = () => {}
    let unsubscribeEvents = () => {}
    let unsubscribeChat = () => {}
    let unsubscribePaymentConfig = () => {}
    let unsubscribeCommunityFunds = () => {}

    if (needsOwners) {
      unsubscribePlots = onSnapshot(
        query(collection(db, PLOTS_COLLECTION), orderBy('sortOrder', 'asc')),
        (snapshot) => {
          const nextBalances = new Map<string, number>()
          snapshot.docs.forEach((item) => {
            const data = item.data()
            const name = normalizePlotName(String(data.name ?? ''))
            if (!name) return
            nextBalances.set(name, Number(data.balance ?? 0))
          })
          setPlotBalances(nextBalances)
        },
      )
    } else {
      setPlotBalances(new Map())
    }

    if (needsEvents) {
      unsubscribeEvents = onSnapshot(
        query(collection(db, 'events'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          const nextEvents = snapshot.docs.map<CommunityEvent>((item) => {
            const data = item.data()
            return {
              id: item.id,
              title: String(data.title ?? ''),
              message: String(data.message ?? ''),
              type: String(data.type ?? 'INFO') as EventType,
              amount: Number(data.amount ?? 0),
              isClosed: Boolean(data.isClosed ?? false),
              pollOptions: Array.isArray(data.pollOptions) ? data.pollOptions.map(String) : [],
              pollVotes:
                typeof data.pollVotes === 'object' && data.pollVotes ? (data.pollVotes as Record<string, number>) : {},
              voterIds: Array.isArray(data.voterIds) ? data.voterIds.map(String) : [],
              voterChoices:
                typeof data.voterChoices === 'object' && data.voterChoices ? (data.voterChoices as Record<string, string>) : {},
              targetUserId: String(data.targetUserId ?? ''),
              createdById: String(data.createdById ?? ''),
              createdByName: String(data.createdByName ?? ''),
              createdAtClient: extractCreatedAt(data.createdAt, data.createdAtClient),
            }
          })
          setEvents(nextEvents)
        },
      )
    } else {
      setEvents([])
    }

    if (needsChat) {
      unsubscribeChat = onSnapshot(
        query(collection(db, 'chat_messages'), orderBy('createdAt', 'asc'), limitToLast(120)),
        (snapshot) => {
          const nextMessages = snapshot.docs.map<ChatMessage>((item) => {
            const data = item.data()
            return {
              id: item.id,
              senderId: String(data.senderId ?? ''),
              senderName: String(data.senderName ?? ''),
              senderPlotName: String(data.senderPlotName ?? ''),
              text: String(data.text ?? ''),
              replyToMessageId: String(data.replyToMessageId ?? ''),
              replyToSenderName: String(data.replyToSenderName ?? ''),
              replyToSenderPlotName: String(data.replyToSenderPlotName ?? ''),
              replyToText: String(data.replyToText ?? ''),
              mentionedUserIds: Array.isArray(data.mentionedUserIds) ? data.mentionedUserIds.map(String).filter(Boolean) : [],
              isPinned: Boolean(data.isPinned ?? false),
              pinnedAtClient: Number(data.pinnedAtClient ?? 0),
              createdAtClient: extractCreatedAt(data.createdAt, data.createdAtClient),
              updatedAtClient: Number(data.updatedAtClient ?? 0),
            }
          })
          setChatMessages(nextMessages)
        },
      )
    } else {
      setChatMessages([])
    }

    if (needsPayments) {
      unsubscribePaymentConfig = onSnapshot(doc(db, 'app_settings', 'payment_config'), (snapshot) => {
        if (!snapshot.exists()) {
          setPaymentConfig(EMPTY_PAYMENT_CONFIG)
          return
        }
        const data = snapshot.data()
        setPaymentConfig({
          recipientName: String(data.recipientName ?? ''),
          recipientPhone: String(data.recipientPhone ?? ''),
          bankName: String(data.bankName ?? ''),
          accountNumber: String(data.accountNumber ?? ''),
          paymentPurpose: String(data.paymentPurpose ?? ''),
          bik: String(data.bik ?? ''),
          correspondentAccount: String(data.correspondentAccount ?? ''),
          recipientInn: String(data.recipientInn ?? ''),
          recipientKpp: String(data.recipientKpp ?? ''),
          sbpLink: String(data.sbpLink ?? ''),
        })
      })

      unsubscribeCommunityFunds = onSnapshot(doc(db, 'app_settings', 'community_funds'), (snapshot) => {
        if (!snapshot.exists()) {
          setCommunityFunds(0)
          return
        }
        const data = snapshot.data()
        setCommunityFunds(Number(data.amount ?? 0))
      })
    } else {
      setPaymentConfig(EMPTY_PAYMENT_CONFIG)
      setCommunityFunds(0)
    }

    let unsubscribePaymentRequests = () => {}
    let unsubscribeRegistrationRequests = () => {}
    let unsubscribeAuditLogs = () => {}

    if (isStaff && (needsOwners || needsPayments)) {
      unsubscribePaymentRequests = onSnapshot(
        query(collection(db, 'payment_requests'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          const nextRequests = snapshot.docs.map<ManualPaymentRequest>((item) => {
            const data = item.data()
            return {
              id: item.id,
              userId: String(data.userId ?? ''),
              userName: String(data.userName ?? ''),
              plotName: String(data.plotName ?? ''),
              amount: Number(data.amount ?? 0),
              eventId: String(data.eventId ?? ''),
              eventTitle: String(data.eventTitle ?? ''),
              purpose: String(data.purpose ?? ''),
              status: String(data.status ?? 'PENDING') as ManualPaymentStatus,
              createdAtClient: extractCreatedAt(data.createdAt, data.createdAtClient),
              reviewedByName: String(data.reviewedByName ?? ''),
              reviewReason: String(data.reviewReason ?? ''),
            }
          })
          setPaymentRequests(nextRequests)
        },
      )
    } else {
      setPaymentRequests([])
    }

    if (isStaff && needsOwners) {
      unsubscribeRegistrationRequests = onSnapshot(
        query(collection(db, 'registration_requests'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          const nextRequests = snapshot.docs.map<RegistrationRequest>((item) => {
            const data = item.data()
            return {
              id: item.id,
              login: String(data.login ?? ''),
              authEmail: String(data.authEmail ?? ''),
              fullName: String(data.fullName ?? ''),
              phone: String(data.phone ?? ''),
              plots: Array.isArray(data.plots) ? data.plots.map(String).filter(Boolean) : [],
              status: String(data.status ?? 'PENDING') as RegistrationRequestStatus,
              createdAtClient: extractCreatedAt(data.createdAt, data.createdAtClient),
              reviewedByName: String(data.reviewedByName ?? ''),
              reviewReason: String(data.reviewReason ?? ''),
            }
          })
          setRegistrationRequests(
            nextRequests.filter((request) =>
              request.status === 'PENDING' || request.status === 'APPROVED' || request.status === 'REJECTED',
            ),
          )
        },
      )
    } else {
      setRegistrationRequests([])
    }

    if (isStaff && needsLogs) {
      unsubscribeAuditLogs = onSnapshot(
        query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limitToLast(100)),
        (snapshot) => {
          const nextLogs = snapshot.docs
            .map<AuditLogEntry>((item) => {
              const data = item.data()
              return {
                id: item.id,
                actorId: String(data.actorId ?? ''),
                actorName: String(data.actorName ?? ''),
                actorRole: String(data.actorRole ?? 'USER') as Role,
                title: String(data.title ?? ''),
                message: String(data.message ?? ''),
                targetUserId: String(data.targetUserId ?? ''),
                targetUserName: String(data.targetUserName ?? ''),
                targetPlotName: String(data.targetPlotName ?? ''),
                createdAtClient: extractCreatedAt(data.createdAt, data.createdAtClient),
              }
            })
            .sort((left, right) => right.createdAtClient - left.createdAtClient)
          setAuditLogs(nextLogs)
        },
      )
    } else {
      setAuditLogs([])
    }

    return () => {
      unsubscribeUsers()
      unsubscribePlots()
      unsubscribeEvents()
      unsubscribeChat()
      unsubscribePaymentConfig()
      unsubscribeCommunityFunds()
      unsubscribePaymentRequests()
      unsubscribeRegistrationRequests()
      unsubscribeAuditLogs()
    }
  }, [activeTab, profile])

  const owners = useMemo(() => buildOwnersDirectory(users, plotBalances), [users, plotBalances])

  return {
    users,
    owners,
    events,
    chatMessages,
    paymentConfig,
    communityFunds,
    paymentRequests,
    registrationRequests,
    auditLogs,
  }
}
