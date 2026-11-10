import { useRef } from 'react'
import type { ResidentChatMessage, ResidentChatUser } from './ResidentChat'

export function ChatReaders({ message, viewerId, users, onClose }: { message: ResidentChatMessage; viewerId: string; users: ResidentChatUser[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  if (!viewerId || message.senderId !== viewerId) return null
  const readers = users.filter(user => user.id !== message.senderId && Number(user.lastChatReadAt ?? 0) >= message.createdAtClient).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
  return <dialog className="chat-readers" ref={element => { dialog.current = element; if (element && !element.open) element.showModal() }} onClose={onClose} aria-label="Кто прочитал сообщение" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
    <header><h3>Прочитали · {readers.length}</h3><button type="button" aria-label="Закрыть список прочитавших" onClick={() => dialog.current?.close()}>×</button></header>
    <p className="readers-explanation">По сохранённым отметкам прочтения чата. Точное время прочтения отдельного сообщения не записывается.</p>
    {readers.length ? <ul>{readers.map(user => <li key={user.id}><strong>{user.fullName}</strong><span>{user.plotName || user.plots.join(', ')}</span></li>)}</ul> : <p>Пока нет отметок прочтения.</p>}
  </dialog>
}
