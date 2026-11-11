import { useLayoutEffect, useRef, useState } from 'react'
import type { ResidentChatMessage } from './ResidentChat'
import { plainChatText } from '../lib/chatFormatting'
import { mobileMessagePermissions } from '../lib/chatMobileInteraction'
import './ChatMobileActions.css'

type MessageActions = {
  messages: readonly ResidentChatMessage[]
  viewerId: string
  canCopy: boolean
  onClose: () => void
  onCopy: () => void
  onReply: (message: ResidentChatMessage) => void
  onEdit: (message: ResidentChatMessage) => void
  onDelete: (message: ResidentChatMessage) => void
  onReaders: (message: ResidentChatMessage) => void
}

const icons = {
  close: 'm6 6 12 12M6 18 18 6',
  copy: 'M8 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  reply: 'M20 18v-5a5 5 0 0 0-5-5H4m5-5L4 8l5 5',
  edit: 'm4 16 11-11 4 4L8 20H4zm9-9 4 4',
  delete: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4zM12 13v8',
  select: 'M21 11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10m-7 8 4 4 9-10',
}

function ActionIcon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons[name]} /></svg>
}

export function ChatMobileSelectionBar({ messages, viewerId, canCopy, onClose, onCopy, onReply, onEdit, onDelete, onReaders }: MessageActions) {
  const message = messages.length === 1 ? messages[0] : null
  const permissions = mobileMessagePermissions(message, viewerId)
  return (
    <div className="chat-mobile-selection" role="toolbar" aria-label="Действия с выбранными сообщениями">
      <button type="button" aria-label="Снять выделение" onClick={onClose}>
        <ActionIcon name="close" />
      </button>
      <span className="chat-mobile-selection__count" role="status" aria-label={`Выбрано сообщений: ${messages.length}`}>{messages.length}</span>
      {message && permissions.canReply && (
        <button type="button" aria-label="Ответить на выбранное сообщение" title="Ответить" onClick={() => onReply(message)}>
          <ActionIcon name="reply" />
        </button>
      )}
      <button type="button" aria-label="Копировать текст выбранных сообщений" title="Копировать" disabled={!canCopy} onClick={onCopy}>
        <ActionIcon name="copy" />
      </button>
      {message && permissions.canViewReaders && (
        <button type="button" aria-label="Кто прочитал выбранное сообщение" title="Кто прочитал" onClick={() => onReaders(message)}>
          <ActionIcon name="eye" />
        </button>
      )}
      {message && permissions.canEdit && (
        <button type="button" aria-label="Редактировать выбранное сообщение" title="Редактировать" onClick={() => onEdit(message)}>
          <ActionIcon name="edit" />
        </button>
      )}
      {message && permissions.canDelete && (
        <button type="button" className="is-danger" aria-label="Удалить выбранное сообщение" title="Удалить" onClick={() => onDelete(message)}>
          <ActionIcon name="delete" />
        </button>
      )}
    </div>
  )
}

export function ChatMobileMessageToggle({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className="chat-mobile-selection-toggle" aria-label="Выделить сообщение" aria-pressed={selected} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        {selected && <path d="m8 12 2.6 2.6 5.4-5.4" />}
      </svg>
    </button>
  )
}

export type MobileMenuAnchor = { bubble: HTMLElement; offsetY: number }

export function ChatMobileMessageMenu({ message, anchor, viewerId, onClose, onReply, onSelect, onReaders, onEdit, onDelete, onTogglePin, onReact, reactionBusy, reactionError }: {
  message: ResidentChatMessage
  anchor: MobileMenuAnchor
  viewerId: string
  onClose: () => void
  onReply: () => void
  onSelect: () => void
  onReaders: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePin: () => Promise<void>
  onReact?: (emoji: string) => Promise<boolean>
  reactionBusy: boolean
  reactionError: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')
  const permissions = mobileMessagePermissions(message, viewerId)
  const text = plainChatText(message.text)

  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const viewport = window.visualViewport
    const placeMenu = () => {
      const margin = 8
      const left = (viewport?.offsetLeft ?? 0) + margin
      const top = (viewport?.offsetTop ?? 0) + margin
      const width = (viewport?.width ?? window.innerWidth) - 2 * margin
      const height = (viewport?.height ?? window.innerHeight) - 2 * margin
      element.style.maxWidth = `${width}px`
      element.style.maxHeight = `${height}px`
      const rect = anchor.bubble.getBoundingClientRect()
      const x = permissions.canEdit ? rect.right - element.offsetWidth : rect.left
      const y = rect.top + Math.min(anchor.offsetY, rect.height) - 24
      element.style.left = `${Math.max(left, Math.min(x, left + width - element.offsetWidth))}px`
      element.style.top = `${Math.max(top, Math.min(y, top + height - element.offsetHeight))}px`
    }

    element.showModal()
    placeMenu()
    const observer = new ResizeObserver(placeMenu)
    observer.observe(element)
    window.addEventListener('resize', placeMenu)
    viewport?.addEventListener('resize', placeMenu)
    viewport?.addEventListener('scroll', placeMenu)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', placeMenu)
      viewport?.removeEventListener('resize', placeMenu)
      viewport?.removeEventListener('scroll', placeMenu)
      if (element.open) element.close()
    }
  }, [anchor, permissions.canEdit])

  const close = () => {
    if (!dialog.current?.open) return
    dialog.current.close()
    onClose()
  }
  const choose = (action: () => void) => {
    close()
    action()
  }
  const run = async (action: () => Promise<void>, failure: string) => {
    setError('')
    setActionBusy(true)
    try {
      await action()
      close()
    } catch {
      setError(failure)
    } finally {
      setActionBusy(false)
    }
  }
  return (
    <dialog
      className="chat-mobile-menu"
      aria-label="Действия с сообщением"
      ref={dialog}
      onClose={() => { if (!dialog.current?.open) onClose() }}
      onClick={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      {onReact && (
        <div className="chat-mobile-menu__reactions" role="group" aria-label="Реакции">
          {['👍', '❤️', '😂', '🎉', '🙏', '👎'].map(emoji => (
            <button key={emoji} type="button" aria-label={`Поставить ${emoji}`}
              aria-pressed={message.reactions?.[viewerId] === emoji} disabled={actionBusy || reactionBusy}
              onClick={async () => { setError(''); if (await onReact(emoji)) close() }}
            >{emoji}</button>
          ))}
        </div>
      )}
      <div className="chat-mobile-menu__actions" data-own={permissions.canEdit}>
        <button type="button" onClick={() => choose(onReply)}><ActionIcon name="reply" />Ответить</button>
        {text.trim() && (
          <button type="button" disabled={actionBusy} onClick={() => void run(() => navigator.clipboard.writeText(text), 'Не удалось скопировать текст.')}>
            <ActionIcon name="copy" />Копировать
          </button>
        )}
        {permissions.canEdit && <button type="button" onClick={() => choose(onEdit)}><ActionIcon name="edit" />Редактировать</button>}
        <button type="button" onClick={() => choose(onSelect)}><ActionIcon name="select" />Выделить</button>
        <button type="button" disabled={actionBusy} onClick={() => void run(onTogglePin, 'Не удалось изменить закрепление.')}>
          <ActionIcon name="pin" />{message.isPinned ? 'Открепить' : 'Закрепить'}
        </button>
        {permissions.canViewReaders && <button type="button" onClick={() => choose(onReaders)}><ActionIcon name="eye" />Кто прочитал</button>}
        {permissions.canDelete && <button type="button" className="is-danger" onClick={() => choose(onDelete)}><ActionIcon name="delete" />Удалить</button>}
        {(error || reactionError) && <p className="chat-mobile-menu__error" role="alert">{error || reactionError}</p>}
      </div>
    </dialog>
  )
}
