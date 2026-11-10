import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ResidentChatAttachment } from './ResidentChat'

type Props = {
  attachments: ResidentChatAttachment[]
  loadAttachment: (attachment: ResidentChatAttachment) => Promise<Blob>
}

export function ChatAttachments({ attachments, loadAttachment }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<string[]>([])
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const blobs = useRef(new Map<string, Blob>())
  const dialogRef = useRef<HTMLDivElement>(null)
  const photos = attachments.filter(item => item.kind === 'image')
  const files = attachments.filter(item => item.kind !== 'image')
  const activeIndex = photos.findIndex(item => item.id === selected)
  const active = photos[activeIndex]

  useEffect(() => {
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setRequested(true); observer.disconnect() }
    }, { rootMargin: '180px' })
    observer.observe(rootRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!requested) return
    let disposed = false
    const urls: string[] = []
    const cached = blobs.current
    for (const item of attachments.filter(item => item.kind === 'image')) {
      void loadAttachment(item).then(blob => {
        if (disposed) return
        cached.set(item.id, blob)
        const url = URL.createObjectURL(blob)
        urls.push(url)
        setPreviews(current => ({ ...current, [item.id]: url }))
        setFailed(current => current.filter(id => id !== item.id))
      }).catch(() => { if (!disposed) setFailed(current => [...current, item.id]) })
    }
    return () => { disposed = true; urls.forEach(url => URL.revokeObjectURL(url)); cached.clear() }
  }, [attachments, loadAttachment, revision, requested])

  useEffect(() => {
    if (!selected) return
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [selected])

  const move = (direction: number) => setSelected(photos[(activeIndex + direction + photos.length) % photos.length].id)
  const download = async (item: ResidentChatAttachment) => {
    setBusy(item.id)
    setError('')
    try {
      const blob = blobs.current.get(item.id) ?? await loadAttachment(item)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось скачать файл. Повторите попытку.') }
    finally { setBusy(null) }
  }

  return <div className="chat-media" ref={rootRef}>
    {photos.length > 0 && <div className={`chat-album chat-album--${photos.length}`}>
      {photos.map((item, index) => <button key={item.id} className="chat-album__photo" aria-label={`Открыть фото ${index + 1}: ${item.name}`} onClick={() => {
        if (failed.includes(item.id)) { setFailed([]); setPreviews({}); setRevision(current => current + 1) }
        else if (previews[item.id]) setSelected(item.id)
      }}>
        {previews[item.id] ? <img src={previews[item.id]} alt={item.name} /> : <span>{failed.includes(item.id) ? '↻ Повторить загрузку' : 'Загрузка фото…'}</span>}
        <span className="chat-album__expand" aria-hidden="true">↗</span>
      </button>)}
    </div>}
    {files.map(item => <button key={item.id} className="chat-file" onClick={() => void download(item)} disabled={busy === item.id} aria-label={`Скачать ${item.name}`}>
      <span className="chat-file__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5"/></svg></span>
      <span className="chat-file__info"><strong>{item.name}</strong><small>{fileSize(item.size)} · {busy === item.id ? 'Скачивание…' : 'Скачать файл'}</small></span>
      <span className="chat-file__download" aria-hidden="true">↓</span>
    </button>)}
    {error && !active && <div className="chat-media__error" role="alert">{error}</div>}
    {active && createPortal(<div className="chat-photo-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фотографий" ref={dialogRef} tabIndex={-1} onClick={() => setSelected(null)} onKeyDown={event => {
      if (event.key === 'Escape') setSelected(null)
      if (event.key === 'ArrowRight') move(1)
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'Tab') {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        event.preventDefault()
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      <div className="chat-photo-viewer__bar" onClick={event => event.stopPropagation()}><div><strong>{active.name}</strong><span>{activeIndex + 1} из {photos.length} · {fileSize(active.size)}</span></div><button disabled={busy === active.id} onClick={() => void download(active)}>{busy === active.id ? 'Скачивание…' : '↓ Скачать'}</button><button aria-label="Закрыть фото" onClick={() => setSelected(null)}>✕</button></div>
      {photos.length > 1 && <button className="chat-photo-viewer__previous" aria-label="Предыдущее фото" onClick={event => {event.stopPropagation(); move(-1)}}>‹</button>}
      {previews[active.id] ? <img src={previews[active.id]} alt={active.name} onClick={event => event.stopPropagation()} /> : <p>Фото ещё загружается</p>}
      {photos.length > 1 && <button className="chat-photo-viewer__next" aria-label="Следующее фото" onClick={event => {event.stopPropagation(); move(1)}}>›</button>}
      {error && <div className="chat-media__error" role="alert">{error}</div>}
      <div className="chat-photo-viewer__thumbnails" onClick={event => event.stopPropagation()}>{photos.map((item, index) => <button key={item.id} aria-label={`Фото ${index + 1}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{previews[item.id] ? <img src={previews[item.id]} alt=""/> : index + 1}</button>)}</div>
    </div>, document.body)}
  </div>
}

function fileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}
