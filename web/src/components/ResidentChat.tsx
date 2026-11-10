import { ChatReaders } from './ChatReaders'
import { canReadVisibleContent } from '../lib/readVisibility'
import { selectedOwnChatMessage, type ChatReadersSelection } from '../lib/chatReadReceipts'
import { ChatLongPress } from '../lib/chatLongPress'
import { createPortal } from 'react-dom'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHAT_FILE_MAX_COUNT,
  downloadChatAttachment,
  getChatAttachmentPreviewUrl,
  validateChatFile,
} from '../lib/chatFilesApi'
import { useAvatarObjectUrl } from '../hooks/useAvatarObjectUrl'
import type { UserAvatar } from '../types'
import { ChatFormatInput, ChatFormattedText } from './ChatFormatting'
import { ChatAttachments } from './ChatAttachments'
import './ResidentChat.css'
import './ResidentChatMessenger.css'

export type ResidentChatProfile = {
  id: string
  fullName: string
  plotName: string
  plots: string[]
  lastChatReadAt: number
  avatar: UserAvatar | null
}

export type ResidentChatUser = {
  lastChatReadAt?: number
  id: string
  fullName: string
  plotName: string
  plots: string[]
  avatar: UserAvatar | null
}

export type ResidentChatMessage = {
  reactions?: Record<string, string>
  id: string
  senderId: string
  senderName: string
  senderPlotName: string
  text: string
  attachments: ResidentChatAttachment[]
  replyToMessageId: string
  replyToSenderName: string
  replyToSenderPlotName: string
  replyToText: string
  mentionedUserIds: string[]
  isPinned: boolean
  pinnedAtClient: number
  createdAtClient: number
  updatedAtClient: number
}

export type ResidentChatAttachment = {
  id: string
  name: string
  contentType: string
  size: number
  kind: 'image' | 'video' | 'file'
  downloadPath: string
  uploadedAtClient: number
  expiresAtClient: number
}

type ResidentChatProps = {
  profile: ResidentChatProfile
  users: ResidentChatUser[]
  messages: ResidentChatMessage[]
  readerCutoff: number
  onSend: (
    text: string,
    replyTo: ResidentChatMessage | null,
    mentionedUserIds: string[],
    files: File[],
  ) => Promise<void>
  onSaveEdit: (messageId: string, text: string) => Promise<void>
  onDelete: (message: ResidentChatMessage) => Promise<void>
  onReact?: (messageId: string, emoji: string) => Promise<void>
  onTogglePin: (message: ResidentChatMessage) => Promise<void>
  onMarkRead: (latestSeen: number) => Promise<void>
  activationKey?: number
  readingBlocked?: boolean
  loadAttachment?: (attachment: ResidentChatAttachment) => Promise<Blob>
  loadPreviewUrl?: (attachment: ResidentChatAttachment) => Promise<string>
}

type ChatMenuState = {
  message: ResidentChatMessage
  x: number
  y: number
}

type SelectedChatFile = {
  id: string
  file: File
  previewUrl: string
}

function chatInitials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return 'ML'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

const MENU_WIDTH = 224
const MENU_HEIGHT = 354
const MENU_GAP = 10
const EVERYONE_LABEL = '@все'

export function ResidentChat({
  profile,
  users,
  messages,
  readerCutoff,
  onSend,
  onSaveEdit,
  onDelete,
  onTogglePin,
  onReact,
  onMarkRead,
  activationKey = 0,
  readingBlocked = false,
  loadAttachment = downloadChatAttachment,
  loadPreviewUrl = getChatAttachmentPreviewUrl,
}: ResidentChatProps) {
  const [readersSelection, setReadersSelection] = useState<ChatReadersSelection | null>(null)
  const [actionError, setActionError] = useState('')
  const [reactionBusy, setReactionBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ResidentChatMessage | null>(null)
  const [editingId, setEditingId] = useState('')
  const [editingText, setEditingText] = useState('')
  const selectedMenuText = useRef('')
  const menuReturnFocus = useRef<HTMLElement | null>(null)
  const [menu, setMenu] = useState<ChatMenuState | null>(null)
  const [pinnedCursor, setPinnedCursor] = useState(0)
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [selectedMentionedUsers, setSelectedMentionedUsers] = useState<ResidentChatUser[]>([])
  const [everyoneMentionActive, setEveryoneMentionActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<SelectedChatFile[]>([])
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const selectedFilesRef = useRef<SelectedChatFile[]>([])
  const rootRef = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previousLastMessageIdRef = useRef('')
  const stickToLatestRef = useRef(true)
  const settleScrollTimersRef = useRef<number[]>([])
  const longPressRef = useRef(new ChatLongPress())

  const readersMessage = selectedOwnChatMessage(messages, profile.id, readersSelection)
  const ownMenuMessage = menu ? selectedOwnChatMessage(messages, profile.id, { messageId: menu.message.id, viewerId: profile.id }) : null

  const openReaders = (message: ResidentChatMessage) => {
    const selection = { messageId: message.id, viewerId: profile.id }
    setReadersSelection(selectedOwnChatMessage(messages, profile.id, selection) ? selection : null)
    setMenu(null)
  }

  useEffect(() => {
    setReadersSelection(null)
    setMenu(null)
  }, [profile.id])

  const mentionCandidates = useMemo(
    () =>
      users
        .filter((user) => user.id !== profile.id)
        .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru')),
    [profile.id, users],
  )

  const avatarByUserId = useMemo(() => {
    const nextMap = new Map<string, UserAvatar | null>()
    users.forEach((user) => nextMap.set(user.id, user.avatar))
    nextMap.set(profile.id, profile.avatar)
    return nextMap
  }, [profile.avatar, profile.id, users])

  const latestForeignTimestamp = useMemo(
    () => messages.filter((message) => message.senderId !== profile.id).at(-1)?.createdAtClient ?? 0,
    [messages, profile.id],
  )

  const markLatestAsRead = () => {
    const list = listRef.current
    if (readingBlocked || !canReadVisibleContent() || !list || list.scrollHeight - list.scrollTop - list.clientHeight > 72) return
    if (latestForeignTimestamp > 0) {
      void onMarkRead(latestForeignTimestamp).catch(() => undefined)
    }
  }

  const updateScrollToLatestButton = (list = listRef.current) => {
    if (!list) return

    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    setShowScrollToLatest(distanceToBottom > 170)
    stickToLatestRef.current = distanceToBottom < 72

    if (distanceToBottom < 72) {
      markLatestAsRead()
    }
  }

  const clearSettleScrollTimers = () => {
    settleScrollTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId)
    })
    settleScrollTimersRef.current = []
  }

  const settleScrollToLatest = (list = listRef.current) => {
    if (!list) return

    clearSettleScrollTimers()
    const settleDelays = [0, 80, 180, 360]
    settleDelays.forEach((delay) => {
      const timerId = window.setTimeout(() => {
        if (!stickToLatestRef.current) return
        list.scrollTop = list.scrollHeight
        updateScrollToLatestButton(list)
      }, delay)
      settleScrollTimersRef.current.push(timerId)
    })
  }

  const scrollToLatestMessages = (behavior: ScrollBehavior = 'smooth') => {
    const list = listRef.current
    if (!list) return

    stickToLatestRef.current = true
    list.scrollTo({ top: list.scrollHeight, behavior })
    setShowScrollToLatest(false)
    markLatestAsRead()
    settleScrollToLatest(list)
  }

  useEffect(() => {
    markLatestAsRead()
  }, [latestForeignTimestamp, readingBlocked])

  useEffect(() => {
    const handleFocus = () => markLatestAsRead()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markLatestAsRead()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('close', handleFocus, true)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('close', handleFocus, true)
    }
  }, [latestForeignTimestamp, readingBlocked])

  useEffect(() => {
    const list = listRef.current
    const lastMessageId = messages.at(-1)?.id ?? ''
    if (!list || !lastMessageId) return

    const isSameLastMessage = previousLastMessageIdRef.current === lastMessageId
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    const shouldStickToBottom = distanceToBottom < 72

    const latestIsMine = messages.at(-1)?.senderId === profile.id
    if (!previousLastMessageIdRef.current || shouldStickToBottom || (!isSameLastMessage && latestIsMine)) {
      stickToLatestRef.current = true
      requestAnimationFrame(() => {
        list.scrollTo({ top: list.scrollHeight, behavior: isSameLastMessage ? 'smooth' : 'auto' })
        markLatestAsRead()
        updateScrollToLatestButton(list)
        settleScrollToLatest(list)
      })
    } else {
      updateScrollToLatestButton(list)
    }

    previousLastMessageIdRef.current = lastMessageId
  }, [messages, latestForeignTimestamp, profile.id])

  useEffect(() => {
    if (activationKey <= 0) return

    stickToLatestRef.current = true
    scrollToLatestMessages('auto')
  }, [activationKey])

  useEffect(() => {
    if (!menu) return

    const frame = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.resident-chat__menu button:not(:disabled)')?.focus({ preventScroll: true }))
    const closeMenu = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.resident-chat__menu')) return
      setMenu(null)
    }
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        menuReturnFocus.current?.focus()
        setMenu(null)
      }
    }

    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
    window.addEventListener('keydown', closeByEscape)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('contextmenu', closeMenu)
      window.removeEventListener('keydown', closeByEscape)
    }
  }, [menu])

  useEffect(
    () => () => {
      longPressRef.current.cancel()
      clearSettleScrollTimers()
    },
    [],
  )

  useEffect(() => {
    selectedFilesRef.current = selectedFiles
  }, [selectedFiles])

  useEffect(
    () => () => {
      selectedFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    },
    [],
  )

  useEffect(() => {
    let frame = 0

    const updateChatHeight = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const root = rootRef.current
        if (!root) return

        const viewportHeight = window.visualViewport?.height ?? window.innerHeight
        const isCompact = window.innerWidth <= 640
        const edgeGap = isCompact ? 8 : 16
        const chatJumpFootprint = isCompact ? 34 : 40
        const maximumHeight = Math.max(280, viewportHeight - edgeGap - chatJumpFootprint)
        const minimumHeight = Math.min(isCompact ? 380 : 460, maximumHeight)
        const nextHeight = Math.max(minimumHeight, maximumHeight)

        root.style.setProperty('--resident-chat-height', `${Math.round(nextHeight)}px`)
      })
    }

    updateChatHeight()
    window.addEventListener('resize', updateChatHeight)
    window.visualViewport?.addEventListener('resize', updateChatHeight)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateChatHeight)
      window.visualViewport?.removeEventListener('resize', updateChatHeight)
    }
  }, [])

  useEffect(() => {
    if (!input.trim()) {
      setSelectedMentionedUsers([])
      setEveryoneMentionActive(false)
      setMentionPickerOpen(false)
      return
    }

    setEveryoneMentionActive(input.includes(EVERYONE_LABEL))
    setMentionPickerOpen(input.endsWith('@'))
  }, [input])

  const pinnedMessages = useMemo(
    () => [...messages].filter((item) => item.isPinned).sort((a, b) => b.pinnedAtClient - a.pinnedAtClient),
    [messages],
  )

  const activePinnedMessage =
    pinnedMessages.length > 0 ? pinnedMessages[pinnedCursor % pinnedMessages.length] : null

  const openMenuAt = (message: ResidentChatMessage, rect: DOMRect, alignRight: boolean) => {
    const preferredX = alignRight ? rect.right - MENU_WIDTH : rect.left
    const preferredY = rect.bottom + MENU_GAP
    const nextX = Math.max(12, Math.min(preferredX, window.innerWidth - MENU_WIDTH - 12))
    const nextY = Math.max(12, Math.min(preferredY, window.innerHeight - MENU_HEIGHT - 12))
    setMenu({ message, x: nextX, y: nextY })
  }

  const openContextMenu = (event: React.MouseEvent<HTMLElement>, message: ResidentChatMessage) => {
    event.preventDefault()
    event.stopPropagation()
    menuReturnFocus.current = event.currentTarget
    selectedMenuText.current = window.getSelection()?.toString() ?? ''
    setMenu({ message, x: Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8)) })
  }

  const openTouchMenu = (element: HTMLElement, message: ResidentChatMessage) => {
    menuReturnFocus.current = element
    selectedMenuText.current = ''
    openMenuAt(message, element.getBoundingClientRect(), message.senderId === profile.id)
  }

  const startLongPress = (event: React.TouchEvent<HTMLElement>, message: ResidentChatMessage) => {
    if (event.touches.length !== 1) { longPressRef.current.cancel(); return }
    const element = event.currentTarget
    const touch = event.touches[0]
    longPressRef.current.start({ x: touch.clientX, y: touch.clientY }, () => openTouchMenu(element, message))
  }

  const finishLongPress = (event: React.TouchEvent<HTMLElement>) => {
    const wasTriggered = longPressRef.current.finish()

    if (wasTriggered) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const moveLongPress = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) { longPressRef.current.cancel(); return }
    const touch = event.touches[0]
    longPressRef.current.move({ x: touch.clientX, y: touch.clientY })
  }

  const formatUserPlots = (user: ResidentChatUser) => {
    const normalizedPlots = user.plots
      .map((plot) => plot.trim())
      .filter(Boolean)
      .map((plot) => plot.replace(/^Участок\s*/i, '').trim())

    if (normalizedPlots.length > 0) {
      return `Участок ${normalizedPlots.join(', ')}`
    }

    const singlePlot = user.plotName.trim().replace(/^Участок\s*/i, '').trim()
    if (!singlePlot) return ''
    return `Участок ${singlePlot}`
  }

  const insertMentionToken = (token: string, selectedUser?: ResidentChatUser) => {
    const atIndex = input.lastIndexOf('@')
    const updatedText = atIndex >= 0 ? `${input.slice(0, atIndex)}${token} ` : `${input}${token} `

    if (selectedUser) {
      setSelectedMentionedUsers((current) =>
        current.some((item) => item.id === selectedUser.id) ? current : [...current, selectedUser],
      )
    }
    if (token === EVERYONE_LABEL) {
      setEveryoneMentionActive(true)
    }

    setMentionPickerOpen(false)
    setInput(updatedText)

    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(updatedText.length, updatedText.length)
    })
  }

  const resolveMentionedUserIds = (text: string) => {
    const mentionedIds = new Set<string>()

    selectedMentionedUsers.forEach((user) => {
      if (text.includes(`@${user.fullName}`)) {
        mentionedIds.add(user.id)
      }
    })

    if (text.includes(EVERYONE_LABEL)) {
      mentionCandidates.forEach((user) => mentionedIds.add(user.id))
    }

    return Array.from(mentionedIds)
  }

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return

    const availableSlots = CHAT_FILE_MAX_COUNT - selectedFiles.length
    if (availableSlots <= 0) {
      window.alert(`Можно прикрепить не больше ${CHAT_FILE_MAX_COUNT} файлов.`)
      return
    }

    const nextFiles: SelectedChatFile[] = []
    for (const file of Array.from(files).slice(0, availableSlots)) {
      try {
        validateChatFile(file)
        nextFiles.push({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось добавить файл.')
      }
    }

    setSelectedFiles((current) => [...current, ...nextFiles])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeSelectedFile = (fileId: string) => {
    setSelectedFiles((current) => {
      const target = current.find((item) => item.id === fileId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== fileId)
    })
  }

  const clearSelectedFiles = () => {
    setSelectedFiles((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }

  const handleSend = async () => {
    const normalized = input.trim()
    if ((!normalized && selectedFiles.length === 0) || sending) return

    const mentionedUserIds = resolveMentionedUserIds(normalized)
    const filesToSend = selectedFiles.map((item) => item.file)

    setSending(true)
    try {
      await onSend(normalized, replyingTo, mentionedUserIds, filesToSend)
      setInput('')
      setReplyingTo(null)
      setSelectedMentionedUsers([])
      setEveryoneMentionActive(false)
      setMentionPickerOpen(false)
      clearSelectedFiles()
    } finally {
      setSending(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    const normalized = editingText.trim()
    if (!normalized) return
    await onSaveEdit(editingId, normalized)
    setEditingId('')
    setEditingText('')
  }

  const startEdit = (message: ResidentChatMessage) => {
    setEditingId(message.id)
    setEditingText(message.text)
    setMenu(null)
  }

  const startReply = (message: ResidentChatMessage) => {
    setReplyingTo(message)
    setMenu(null)
  }

  const cancelEdit = () => {
    setEditingId('')
    setEditingText('')
  }

  const scrollToMessage = (messageId: string) => {
    const list = listRef.current
    const messageElement = document.getElementById(`chat-message-${messageId}`)
    if (!list || !messageElement) return

    const targetTop =
      messageElement.offsetTop - list.offsetTop - list.clientHeight / 2 + messageElement.clientHeight / 2
    list.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }

  const reactToMessage = async (messageId: string, emoji: string) => {
    if (!onReact || reactionBusy) return
    setReactionBusy(true)
    setActionError('')
    try { await onReact(messageId, emoji); setMenu(null) }
    catch { setActionError('Не удалось сохранить реакцию. Попробуйте ещё раз.') }
    finally { setReactionBusy(false) }
  }

  const readStatusLabel = (message: ResidentChatMessage) => {
    if (message.senderId !== profile.id) return ''
    return message.createdAtClient <= readerCutoff ? '✓✓' : '✓'
  }

  return (
    <section ref={rootRef} className="panel resident-chat" onClick={() => setMenu(null)}>
      <header className="resident-chat__header">
        <div className="resident-chat__heading"><strong>Соседи · Малинки</strong><span>{users.length} {users.length % 10 === 1 && users.length % 100 !== 11 ? 'участник' : [2, 3, 4].includes(users.length % 10) && ![12, 13, 14].includes(users.length % 100) ? 'участника' : 'участников'} · общий чат</span></div>
        <button className="resident-chat__tool" aria-label="Поиск по сообщениям" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSearch('') }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
        </button>
      </header>
      {searchOpen && <div className="resident-chat__search"><input autoFocus aria-label="Найти сообщение" placeholder="Поиск по сообщениям и участникам" value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setSearchOpen(false); setSearch('') }}>Закрыть</button></div>}
      {activePinnedMessage && (
        <button
          className="resident-chat__pinned"
          onClick={(event) => {
            event.stopPropagation()
            scrollToMessage(activePinnedMessage.id)
            if (pinnedMessages.length > 1) {
              setPinnedCursor((current) => (current + 1) % pinnedMessages.length)
            }
          }}
        >
          <span className="resident-chat__pinned-count">
            Закреплено {Math.min(pinnedCursor + 1, pinnedMessages.length)}/{pinnedMessages.length}
          </span>
          <strong className="resident-chat__pinned-title">
            {activePinnedMessage.senderName}
            {activePinnedMessage.senderPlotName ? ` · ${activePinnedMessage.senderPlotName}` : ''}
          </strong>
          <span className="resident-chat__pinned-body">
            {activePinnedMessage.text || (activePinnedMessage.attachments.length > 0 ? 'Вложение' : 'Сообщение')}
          </span>
        </button>
      )}

      <div
        ref={listRef}
        className="resident-chat__list"
        onScroll={(event) => {
          updateScrollToLatestButton(event.currentTarget)
        }}
      >
        {search && !messages.some(message => `${message.text} ${message.senderName}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))) && <div className="resident-chat__empty">Ничего не найдено. Попробуйте другое слово.</div>}
        {messages.length === 0 ? (
          <div className="resident-chat__empty">Сообщений пока нет</div>
        ) : (
          messages.filter(message => !search || `${message.text} ${message.senderName}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))).map((message, index, visibleMessages) => {
            const isMine = message.senderId === profile.id
            const isEditing = editingId === message.id
            const mentionedMe = message.mentionedUserIds.includes(profile.id)
            const senderAvatar = avatarByUserId.get(message.senderId) ?? null
            const previous = visibleMessages[index - 1]
            const newDay = !previous || new Date(previous.createdAtClient).toDateString() !== new Date(message.createdAtClient).toDateString()
            const grouped = !newDay && previous.senderId === message.senderId && message.createdAtClient - previous.createdAtClient < 300_000

            return (
              <Fragment key={message.id}>
              {newDay && <div className="resident-chat__date"><span>{new Intl.DateTimeFormat('ru', {day:'numeric', month:'long'}).format(message.createdAtClient)}</span></div>}
              <div
                id={`chat-message-${message.id}`}
                key={message.id}
                className={`resident-chat__message-row ${isMine ? 'is-mine' : 'is-other'} ${grouped ? 'is-grouped' : ''}`}
              >
                {!isMine && <ChatMessageAvatar name={message.senderName} avatar={senderAvatar} />}
                <article
                  className={`resident-chat__bubble ${isMine ? 'is-mine' : 'is-other'} ${message.isPinned ? 'is-pinned' : ''} ${mentionedMe ? 'is-mentioned' : ''}`}
                  tabIndex={0}
                  onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); menuReturnFocus.current = event.currentTarget; selectedMenuText.current = ''; openMenuAt(message, event.currentTarget.getBoundingClientRect(), isMine) } }}
                  onContextMenu={(event) => openContextMenu(event, message)}
                  onTouchStart={(event) => startLongPress(event, message)}
                  onTouchEnd={finishLongPress}
                  onTouchCancel={finishLongPress}
                  onTouchMove={moveLongPress}
                  onClickCapture={event => {
                    if (longPressRef.current.consumeClick()) { event.preventDefault(); event.stopPropagation() }
                  }}
                >
                <div className="resident-chat__meta">
                  <span className="resident-chat__author">
                    {message.senderName}
                    {message.senderPlotName ? ` · ${message.senderPlotName}` : ''}
                  </span>
                </div>

                {isEditing ? (
                  <div className="resident-chat__edit">
                    <ChatFormatInput value={editingText} onValueChange={setEditingText} rows={3} aria-label="Редактировать сообщение" />
                    <div className="resident-chat__edit-actions">
                      <button className="primary-button" onClick={() => void handleSaveEdit()}>
                        Сохранить
                      </button>
                      <button className="ghost-button" onClick={cancelEdit}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {message.replyToMessageId && (
                      <button
                        className="resident-chat__reply-preview"
                        onClick={(event) => {
                          event.stopPropagation()
                          scrollToMessage(message.replyToMessageId)
                        }}
                      >
                        <strong>
                          {message.replyToSenderName}
                          {message.replyToSenderPlotName ? ` · ${message.replyToSenderPlotName}` : ''}
                        </strong>
                        <span>{message.replyToText || 'Сообщение удалено'}</span>
                      </button>
                    )}

                    {message.attachments.length > 0 && (
                      <ChatAttachments attachments={message.attachments} loadAttachment={loadAttachment} loadPreviewUrl={loadPreviewUrl} />
                    )}


                    {message.text ? <p className="resident-chat__text"><ChatFormattedText text={message.text} /></p> : null}
                    {Object.values(message.reactions ?? {}).length > 0 && <div className="chat-reactions">{[...new Set(Object.values(message.reactions ?? {}))].map(emoji => <button key={emoji} type="button" aria-label={`Реакция ${emoji}`} aria-pressed={message.reactions?.[profile.id] === emoji} disabled={reactionBusy || !onReact} onClick={() => void reactToMessage(message.id, emoji)}>{emoji}<span>{Object.values(message.reactions ?? {}).filter(value => value === emoji).length}</span></button>)}</div>}

                    <div className="resident-chat__footer">
                      <span className="resident-chat__flags">
                        {mentionedMe && <span className="resident-chat__flag is-mention">вас отметили</span>}
                        {message.updatedAtClient > 0 && <span className="resident-chat__flag">изменено</span>}
                        {message.isPinned && <span className="resident-chat__flag">закреплено сверху</span>}
                      </span>
                      <span className="resident-chat__delivery"><span className="resident-chat__time">{formatTime(message.createdAtClient)}</span>{isMine && <button type="button" className="resident-chat__ticks" onClick={() => openReaders(message)} title="Кто прочитал" aria-label={readStatusLabel(message) === '✓✓' ? 'Прочитано' : 'Отправлено'}><svg viewBox="0 0 24 16" aria-hidden="true"><path d="m2 8 4 4L16 2" />{readStatusLabel(message) === '✓✓' && <path d="m10 10 2 2L22 2" />}</svg></button>}</span>
                    </div>
                  </>
                )}
                </article>
                {isMine && <ChatMessageAvatar name={message.senderName} avatar={senderAvatar} />}
              </div>
              </Fragment>
            )
          })
        )}
      </div>

      <button
        className={`resident-chat__to-latest ${showScrollToLatest ? 'is-visible' : ''}`}
        type="button"
        onClick={() => scrollToLatestMessages()}
        aria-label="Перейти к последним сообщениям"
        title="К последним сообщениям"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className="resident-chat__compose">
        {replyingTo && (
          <div className="resident-chat__replying">
            <div className="resident-chat__replying-text">
              <strong>
                {replyingTo.senderName}
                {replyingTo.senderPlotName ? ` · ${replyingTo.senderPlotName}` : ''}
              </strong>
              <span>{replyingTo.text}</span>
            </div>
            <button className="ghost-button" onClick={() => setReplyingTo(null)}>
              Отменить
            </button>
          </div>
        )}

        <div className="resident-chat__compose-box" onClick={(event) => event.stopPropagation()}>
          {selectedFiles.length > 0 && (
            <div className="resident-chat__selected-files">
              {selectedFiles.map((item) => (
                <SelectedFilePreview key={item.id} item={item} onRemove={() => removeSelectedFile(item.id)} />
              ))}
            </div>
          )}

          <div className="resident-chat__composer-row">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
              className="resident-chat__file-input"
              onChange={(event) => addFiles(event.target.files)}
            />
            <button
              className="resident-chat__icon-button resident-chat__attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || selectedFiles.length >= CHAT_FILE_MAX_COUNT}
              aria-label="Прикрепить фото или файл"
              title="Прикрепить фото или файл"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.6-9.6a4.1 4.1 0 0 1 5.8 5.8l-9.7 9.7a2.2 2.2 0 0 1-3.1-3.1l8.6-8.6" />
              </svg>
            </button>

            <div className="resident-chat__input-wrap">
              <ChatFormatInput
                textareaRef={textareaRef}
                value={input}
                onValueChange={setInput}
                placeholder="Сообщение"
                aria-label="Сообщение"
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.innerWidth > 640) {
                    event.preventDefault()
                    void handleSend().catch(() => undefined)
                  }
                }}
                rows={1}
              />

              {mentionPickerOpen && (
                <div className="resident-chat__mention-picker">
                  {mentionCandidates.length === 0 ? (
                    <div className="resident-chat__mention-empty">Пока некого отмечать</div>
                  ) : (
                    <>
                      <button
                        className={`resident-chat__mention-option ${everyoneMentionActive ? 'is-selected' : ''}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertMentionToken(EVERYONE_LABEL)}
                      >
                        <strong>{EVERYONE_LABEL}</strong>
                        <span>Уведомить всех собственников</span>
                      </button>

                      {mentionCandidates.map((user) => {
                        const plots = formatUserPlots(user)
                        const selected = selectedMentionedUsers.some((item) => item.id === user.id)

                        return (
                          <button
                            key={user.id}
                            className={`resident-chat__mention-option ${selected ? 'is-selected' : ''}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => insertMentionToken(`@${user.fullName}`, user)}
                          >
                            <strong>@{user.fullName}</strong>
                            <span>{plots || 'Без участка'}</span>
                          </button>
                        )
                      })}
                    </>
                  )}
                </div>
              )}
            </div>

            <button className="resident-chat__emoji-button" aria-label="Добавить эмодзи" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>☺</button>
            {emojiOpen && <div className="resident-chat__emojis">{['😊','👍','❤️','👋','🌿','🎉','🙏','☀️'].map(emoji => <button key={emoji} onClick={() => {setInput(current => current + emoji); setEmojiOpen(false); textareaRef.current?.focus()}}>{emoji}</button>)}</div>}
            <button
              className="resident-chat__send-button"
              onClick={() => void handleSend().catch(() => undefined)}
              disabled={sending || (!input.trim() && selectedFiles.length === 0)}
              aria-label="Отправить сообщение"
              title="Отправить сообщение"
            >
              {sending ? (
                <span className="resident-chat__send-loader" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h13" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              )}
            </button>
          </div>

          <span className="resident-chat__hint">
            Фото, видео и файлы до 25 МБ. Упоминание начинается с @.
          </span>
        </div>
      </div>

      {readersMessage && <ChatReaders message={readersMessage} viewerId={profile.id} users={users} onClose={() => setReadersSelection(null)} />}
      {actionError && <div className="chat-action-error" role="alert">{actionError}<button onClick={() => setActionError('')}>Закрыть</button></div>}
      {menu &&
        createPortal(
          <div
            className="resident-chat__menu"
            role="menu" aria-label="Действия с сообщением"
            onKeyDown={event => {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus() }
            }}
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {onReact && <div className="chat-reaction-picker" aria-label="Добавить реакцию">{['👍','❤️','😂','🎉','🙏','👎'].map(emoji => <button key={emoji} type="button" aria-label={`Поставить ${emoji}`} disabled={reactionBusy} onClick={() => void reactToMessage(menu.message.id, emoji)}>{emoji}</button>)}</div>}
            <button role="menuitem" className="resident-chat__menu-item" onClick={async () => { try { await navigator.clipboard.writeText(selectedMenuText.current || menu.message.text); setMenu(null) } catch { setActionError('Не удалось скопировать текст.') } }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v13H8z M16 8V3H3v13h5" /></svg> Копировать текст
            </button>
            <button role="menuitem" className="resident-chat__menu-item" onClick={() => startReply(menu.message)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 18v-5a5 5 0 0 0-5-5H4 M9 3 4 8l5 5" /></svg> Ответить
            </button>
            <button
              role="menuitem" className="resident-chat__menu-item"
              onClick={() => startEdit(menu.message)}
              disabled={menu.message.senderId !== profile.id}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 11-11 4 4L8 20H4z M13 7l4 4" /></svg> Редактировать
            </button>
            {ownMenuMessage && <button role="menuitem" className="resident-chat__menu-item" onClick={() => openReaders(ownMenuMessage)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg> Кто прочитал</button>}
            {menu.message.senderId === profile.id && <button role="menuitem" className="resident-chat__menu-item" onClick={() => {
              const target = menu.message
              startEdit(target)
              requestAnimationFrame(() => {
                const input = document.querySelector<HTMLTextAreaElement>(`#chat-message-${CSS.escape(target.id)} textarea`)
                if (!input) return
                const found = selectedMenuText.current ? target.text.indexOf(selectedMenuText.current) : -1
                input.focus()
                input.setSelectionRange(found >= 0 ? found : 0, found >= 0 ? found + selectedMenuText.current.length : target.text.length)
              })
            }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h6a4 4 0 0 1 0 8H7z M7 11h7a5 5 0 0 1 0 10H7z" /></svg> Форматировать…</button>}
            <button
              role="menuitem" className="resident-chat__menu-item"
              onClick={async () => {
                await onTogglePin(menu.message)
                setMenu(null)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 0-1 6 4 4H5l4-4z M12 13v8" /></svg> {menu.message.isPinned ? 'Открепить' : 'Закрепить'}
            </button>
            <button
              role="menuitem" className="resident-chat__menu-item is-danger"
              onClick={async () => {
                await onDelete(menu.message)
                setMenu(null)
              }}
              disabled={menu.message.senderId !== profile.id}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7" /></svg> Удалить
            </button>
          </div>,
          document.body,
        )}
    </section>
  )
}

function ChatMessageAvatar({ name, avatar }: { name: string; avatar: UserAvatar | null }) {
  const avatarUrl = useAvatarObjectUrl(avatar?.downloadPath ?? '')

  return (
    <span className="resident-chat__avatar" aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : <span>{chatInitials(name)}</span>}
    </span>
  )
}

function SelectedFilePreview({ item, onRemove }: { item: SelectedChatFile; onRemove: () => void }) {
  const isImage = item.file.type.startsWith('image/')
  const isVideo = item.file.type.startsWith('video/')

  return (
    <div className="resident-chat__selected-file">
      <div className="resident-chat__selected-preview">
        {isImage ? (
          <img src={item.previewUrl} alt={item.file.name} />
        ) : (
          <span>{isVideo ? 'VID' : 'FILE'}</span>
        )}
      </div>
      <div className="resident-chat__selected-info">
        <strong>{item.file.name}</strong>
        <small>{formatFileSize(item.file.size)}</small>
      </div>
      <button type="button" onClick={onRemove} aria-label={`Убрать ${item.file.name}`}>
        Убрать
      </button>
    </div>
  )
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Б'
  if (value < 1024) return `${Math.round(value)} Б`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(value > 10 * 1024 * 1024 ? 0 : 1)} МБ`
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}
