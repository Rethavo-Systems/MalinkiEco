import { useRef, useState } from 'react'
import type { ResidentChatMessage } from './ResidentChat'
import { ChatFormattedText } from './ChatFormatting'
import { parseChatFormatting, type FormattedPart } from '../lib/chatFormatting'
import { mobileMessagePermissions } from '../lib/chatMobileInteraction'
import './ChatMobileActions.css'

type MessageActions = {
  message: ResidentChatMessage
  viewerId: string
  onClose: () => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onReaders: () => void
}

const icons = {
  close: 'm6 6 12 12M6 18 18 6',
  reply: 'M20 18v-5a5 5 0 0 0-5-5H4m5-5L4 8l5 5',
  edit: 'm4 16 11-11 4 4L8 20H4zm9-9 4 4',
  delete: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
}

function ActionIcon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons[name]} /></svg>
}

function plainText(parts: FormattedPart[]): string {
  return parts.map(part => 'text' in part ? part.text : plainText(part.children)).join('')
}

const messageDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

export function ChatMobileSelectionBar({ message, viewerId, onClose, onReply, onEdit, onDelete, onReaders }: MessageActions) {
  const permissions = mobileMessagePermissions(message, viewerId)
  return (
    <div className="chat-mobile-selection" role="toolbar" aria-label="Действия с выбранным сообщением">
      <button type="button" aria-label="Снять выделение сообщения" onClick={onClose}>
        <ActionIcon name="close" />
      </button>
      <span className="chat-mobile-selection__label">Сообщение</span>
      <button type="button" aria-label="Ответить на выбранное сообщение" title="Ответить" onClick={onReply}>
        <ActionIcon name="reply" />
      </button>
      {permissions.canViewReaders && (
        <button type="button" aria-label="Кто прочитал выбранное сообщение" title="Кто прочитал" onClick={onReaders}>
          <ActionIcon name="eye" />
        </button>
      )}
      {permissions.canEdit && (
        <button type="button" aria-label="Редактировать выбранное сообщение" title="Редактировать" onClick={onEdit}>
          <ActionIcon name="edit" />
        </button>
      )}
      {permissions.canDelete && (
        <button type="button" className="is-danger" aria-label="Удалить выбранное сообщение" title="Удалить" onClick={onDelete}>
          <ActionIcon name="delete" />
        </button>
      )}
    </div>
  )
}

export function ChatMobileMessageDetails({ message, viewerId, onClose, onReply, onSelect, onReaders, onReact, reactionBusy, error }: {
  message: ResidentChatMessage
  viewerId: string
  onClose: () => void
  onReply: () => void
  onSelect: () => void
  onReaders: () => void
  onReact?: (emoji: string) => void
  reactionBusy: boolean
  error: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const [selectText, setSelectText] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const own = mobileMessagePermissions(message, viewerId).canViewReaders
  const text = selectText ? plainText(parseChatFormatting(message.text)) : ''
  const sentAt = Number.isFinite(message.createdAtClient) && message.createdAtClient > 0
    ? messageDate.format(message.createdAtClient)
    : 'Время не указано'
  const copy = async () => {
    const field = textArea.current
    const selection = field && field.selectionStart !== field.selectionEnd
      ? text.slice(field.selectionStart, field.selectionEnd)
      : text
    try {
      await navigator.clipboard.writeText(selection)
      setCopyStatus('Текст скопирован')
    } catch {
      setCopyStatus('Не удалось скопировать. Выделите текст и используйте меню браузера.')
    }
  }
  return (
    <dialog
      className="chat-mobile-details"
      aria-label="Сообщение и реакции"
      ref={element => {
        dialog.current = element
        if (element && !element.open) element.showModal()
      }}
      onClose={onClose}
      onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <div className="chat-mobile-details__inner">
        <header>
          <div>
            <strong>{message.senderName}{message.senderPlotName ? ` · ${message.senderPlotName}` : ''}</strong>
            <span>{sentAt}{message.updatedAtClient > 0 ? ' · изменено' : ''}</span>
          </div>
          <button type="button" aria-label="Закрыть сведения о сообщении" onClick={() => dialog.current?.close()}>
            <ActionIcon name="close" />
          </button>
        </header>
        {onReact && (
          <div className="chat-mobile-details__reactions" role="group" aria-label="Реакция на сообщение">
            {['👍', '❤️', '😂', '🎉', '🙏', '👎'].map(emoji => (
              <button
                key={emoji}
                type="button"
                aria-label={`Поставить ${emoji}`}
                aria-pressed={message.reactions?.[viewerId] === emoji}
                disabled={reactionBusy}
                onClick={() => onReact(emoji)}
              >{emoji}</button>
            ))}
          </div>
        )}
        {error && <p className="chat-mobile-details__error" role="alert">{error}</p>}
        {selectText ? (
          <div className="chat-mobile-details__selection">
            <label>
              Выделите нужный фрагмент
              <textarea ref={textArea} readOnly value={text} aria-label="Текст сообщения для выделения" rows={5} />
            </label>
            <button type="button" onClick={() => void copy()}>Копировать текст</button>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </div>
        ) : message.text && <p className="chat-mobile-details__text"><ChatFormattedText text={message.text} /></p>}
        {message.attachments.length > 0 && <p className="chat-mobile-details__files">Вложений: {message.attachments.length}</p>}
        <div className="chat-mobile-details__actions">
          <button type="button" onClick={() => { dialog.current?.close(); onReply() }}>
            <ActionIcon name="reply" />Ответить
          </button>
          <button type="button" onClick={onSelect}>Выделить сообщение</button>
          {message.text && !selectText && <button type="button" onClick={() => setSelectText(true)}>Выделить текст</button>}
          {own && <button type="button" onClick={onReaders}><ActionIcon name="eye" />Кто прочитал</button>}
        </div>
      </div>
    </dialog>
  )
}
