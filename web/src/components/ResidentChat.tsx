import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CHAT_FILE_MAX_COUNT,
  downloadChatAttachment,
  downloadChatAttachmentToDevice,
  validateChatFile,
} from '../lib/chatFilesApi'
import { useAvatarObjectUrl } from '../hooks/useAvatarObjectUrl'
import type { UserAvatar } from '../types'
import './ResidentChat.css'

export type ResidentChatProfile = {
  id: string
  fullName: string
  plotName: string
  plots: string[]
  lastChatReadAt: number
  avatar: UserAvatar | null
}

export type ResidentChatUser = {
  id: string
  fullName: string
  plotName: string
  plots: string[]
  avatar: UserAvatar | null
}

export type ResidentChatMessage = {
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
  onTogglePin: (message: ResidentChatMessage) => Promise<void>
  onMarkRead: (latestSeen: number) => Promise<void>
  activationKey?: number
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

const MENU_WIDTH = 196
const MENU_HEIGHT = 184
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
  onMarkRead,
  activationKey = 0,
}: ResidentChatProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ResidentChatMessage | null>(null)
  const [editingId, setEditingId] = useState('')
  const [editingText, setEditingText] = useState('')
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
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)

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
    if (latestForeignTimestamp > 0) {
      void onMarkRead(latestForeignTimestamp)
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
  }, [latestForeignTimestamp])

  useEffect(() => {
    const handleFocus = () => markLatestAsRead()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markLatestAsRead()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [latestForeignTimestamp])

  useEffect(() => {
    const list = listRef.current
    const lastMessageId = messages.at(-1)?.id ?? ''
    if (!list || !lastMessageId) return

    const isSameLastMessage = previousLastMessageIdRef.current === lastMessageId
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    const shouldStickToBottom = distanceToBottom < 72

    if (!isSameLastMessage || shouldStickToBottom) {
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
  }, [messages, latestForeignTimestamp])

  useEffect(() => {
    if (activationKey <= 0) return

    stickToLatestRef.current = true
    scrollToLatestMessages('auto')
  }, [activationKey])

  useEffect(() => {
    if (!menu) return

    const closeMenu = () => setMenu(null)
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
      }
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('contextmenu', closeMenu)
    window.addEventListener('keydown', closeByEscape)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('contextmenu', closeMenu)
      window.removeEventListener('keydown', closeByEscape)
    }
  }, [menu])

  useEffect(
    () => () => {
      clearLongPressTimer()
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
    openMenuAt(message, event.currentTarget.getBoundingClientRect(), message.senderId === profile.id)
  }

  const openTouchMenu = (element: HTMLElement, message: ResidentChatMessage) => {
    openMenuAt(message, element.getBoundingClientRect(), message.senderId === profile.id)
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const startLongPress = (event: React.TouchEvent<HTMLElement>, message: ResidentChatMessage) => {
    if (event.touches.length !== 1) return

    clearLongPressTimer()
    longPressTriggeredRef.current = false
    const element = event.currentTarget

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true
      openTouchMenu(element, message)
    }, 420)
  }

  const finishLongPress = (event: React.TouchEvent<HTMLElement>) => {
    const wasTriggered = longPressTriggeredRef.current
    clearLongPressTimer()
    longPressTriggeredRef.current = false

    if (wasTriggered) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const cancelLongPress = () => {
    clearLongPressTimer()
    longPressTriggeredRef.current = false
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

  const readStatusLabel = (message: ResidentChatMessage) => {
    if (message.senderId !== profile.id) return ''
    return message.createdAtClient <= readerCutoff ? '✓✓' : '✓'
  }

  return (
    <section ref={rootRef} className="panel resident-chat" onClick={() => setMenu(null)}>
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
        {messages.length === 0 ? (
          <div className="resident-chat__empty">Сообщений пока нет</div>
        ) : (
          messages.map((message) => {
            const isMine = message.senderId === profile.id
            const isEditing = editingId === message.id
            const mentionedMe = message.mentionedUserIds.includes(profile.id)
            const senderAvatar = avatarByUserId.get(message.senderId) ?? null

            return (
              <div
                id={`chat-message-${message.id}`}
                key={message.id}
                className={`resident-chat__message-row ${isMine ? 'is-mine' : 'is-other'}`}
              >
                {!isMine && <ChatMessageAvatar name={message.senderName} avatar={senderAvatar} />}
                <article
                  className={`resident-chat__bubble ${isMine ? 'is-mine' : 'is-other'} ${message.isPinned ? 'is-pinned' : ''} ${mentionedMe ? 'is-mentioned' : ''}`}
                  onContextMenu={(event) => openContextMenu(event, message)}
                  onTouchStart={(event) => startLongPress(event, message)}
                  onTouchEnd={finishLongPress}
                  onTouchCancel={finishLongPress}
                  onTouchMove={cancelLongPress}
                >
                <div className="resident-chat__meta">
                  <span className="resident-chat__author">
                    {message.senderName}
                    {message.senderPlotName ? ` · ${message.senderPlotName}` : ''}
                  </span>
                  <span className="resident-chat__time">{formatTime(message.createdAtClient)}</span>
                </div>

                {isEditing ? (
                  <div className="resident-chat__edit">
                    <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={3} />
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

                    {message.text ? <p className="resident-chat__text">{message.text}</p> : null}

                    {message.attachments.length > 0 && (
                      <div className="resident-chat__attachments">
                        {message.attachments.map((attachment) => (
                          <ChatAttachmentCard key={attachment.id} attachment={attachment} />
                        ))}
                      </div>
                    )}

                    <div className="resident-chat__footer">
                      <span className="resident-chat__flags">
                        {mentionedMe && <span className="resident-chat__flag is-mention">вас отметили</span>}
                        {message.updatedAtClient > 0 && <span className="resident-chat__flag">изменено</span>}
                        {message.isPinned && <span className="resident-chat__flag">закреплено сверху</span>}
                      </span>
                      {isMine && <span className="resident-chat__ticks">{readStatusLabel(message)}</span>}
                    </div>
                  </>
                )}
                </article>
                {isMine && <ChatMessageAvatar name={message.senderName} avatar={senderAvatar} />}
              </div>
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
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Сообщение"
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

            <button
              className="resident-chat__send-button"
              onClick={() => void handleSend()}
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

      {menu &&
        createPortal(
          <div
            className="resident-chat__menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="resident-chat__menu-item" onClick={() => startReply(menu.message)}>
              Ответить
            </button>
            <button
              className="resident-chat__menu-item"
              onClick={() => startEdit(menu.message)}
              disabled={menu.message.senderId !== profile.id}
            >
              Редактировать
            </button>
            <button
              className="resident-chat__menu-item"
              onClick={async () => {
                await onTogglePin(menu.message)
                setMenu(null)
              }}
            >
              {menu.message.isPinned ? 'Открепить' : 'Закрепить'}
            </button>
            <button
              className="resident-chat__menu-item is-danger"
              onClick={async () => {
                await onDelete(menu.message)
                setMenu(null)
              }}
              disabled={menu.message.senderId !== profile.id}
            >
              Удалить
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

function ChatAttachmentCard({ attachment }: { attachment: ResidentChatAttachment }) {
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewRequested, setPreviewRequested] = useState(false)
  const isImage = attachment.kind === 'image'

  useEffect(() => {
    if (!isImage) return

    const target = cardRef.current
    if (!target || typeof IntersectionObserver === 'undefined') {
      setPreviewRequested(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setPreviewRequested(true)
        observer.disconnect()
      },
      { rootMargin: '180px' },
    )
    observer.observe(target)

    return () => observer.disconnect()
  }, [isImage])

  useEffect(() => {
    if (!isImage || !previewRequested) return

    let disposed = false
    let objectUrl = ''
    downloadChatAttachment(attachment)
      .then((blob) => {
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (!disposed) setPreviewFailed(true)
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment, isImage, previewRequested])

  const handleDownload = async () => {
    try {
      await downloadChatAttachmentToDevice(attachment)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось скачать файл.')
    }
  }

  return (
    <button
      ref={cardRef}
      className={`resident-chat__attachment is-${attachment.kind}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        void handleDownload()
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {isImage ? (
        previewUrl ? (
          <img src={previewUrl} alt={attachment.name} loading="lazy" draggable={false} />
        ) : (
          <span className="resident-chat__attachment-icon">{previewFailed ? '!' : 'IMG'}</span>
        )
      ) : (
        <span className="resident-chat__attachment-icon">{attachment.kind === 'video' ? 'VID' : 'FILE'}</span>
      )}
      <span className="resident-chat__attachment-info">
        <strong>{attachment.name}</strong>
        <small>{formatFileSize(attachment.size)}</small>
      </span>
    </button>
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
