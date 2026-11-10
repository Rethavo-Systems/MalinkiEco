import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ResidentChatAttachment } from './ResidentChat'

type Props = {
  attachments: ResidentChatAttachment[]
  loadAttachment: (attachment: ResidentChatAttachment) => Promise<Blob>
  loadPreviewUrl?: (attachment: ResidentChatAttachment) => Promise<string>
}

export function ChatAttachments({ attachments, loadAttachment, loadPreviewUrl }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [originalLinks, setOriginalLinks] = useState<Record<string, string>>({})
  const blobs = useRef(new Map<string, Blob>())
  const previewUrls = useRef(new Map<string, string>())
  const blobSources = useRef(new Map<string, string>())
  const blobFallbacks = useRef(new Set<string>())
  const previewGeneration = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const photos = attachments.filter(item => item.kind === 'image')
  // Firestore rebuilds attachment arrays when a message is edited or reacted to.
  // Its media identity stays the same: do not redownload and revoke every photo.
  const photoSources = JSON.stringify(photos)
  const files = attachments.filter(item => item.kind !== 'image')
  const activeIndex = photos.findIndex(item => item.id === selected)
  const active = photos[activeIndex]

  const storePreview = useCallback((item: ResidentChatAttachment, url: string, generation: number) => {
    if (generation !== previewGeneration.current) { revokePreview(url); return }
    const oldUrl = previewUrls.current.get(item.id)
    if (oldUrl && oldUrl !== url) revokePreview(oldUrl)
    previewUrls.current.set(item.id, url)
    blobSources.current.set(item.id, JSON.stringify(item))
    setPreviews(current => ({ ...current, [item.id]: url }))
    setFailed(current => { const next = { ...current }; delete next[item.id]; return next })
  }, [])

  const loadBlobPreview = useCallback(async (item: ResidentChatAttachment, generation: number) => {
    if (blobFallbacks.current.has(item.id)) return
    blobFallbacks.current.add(item.id)
    try {
      const blob = await loadAttachment(item)
      if (generation !== previewGeneration.current) return
      blobs.current.set(item.id, blob)
      storePreview(item, URL.createObjectURL(blob), generation)
    } catch (reason) {
      if (generation !== previewGeneration.current) return
      setFailed(current => ({ ...current, [item.id]: reason instanceof Error ? reason.message : 'Не удалось загрузить фото. Проверьте соединение и повторите попытку.' }))
    }
  }, [loadAttachment, storePreview])

  const previewError = (item: ResidentChatAttachment, url: string) => {
    if (previewUrls.current.get(item.id) !== url) return
    revokePreview(url)
    previewUrls.current.delete(item.id)
    setPreviews(current => { const next = { ...current }; delete next[item.id]; return next })
    if (!blobFallbacks.current.has(item.id)) void loadBlobPreview(item, previewGeneration.current)
    else setFailed(current => ({ ...current, [item.id]: 'Браузер не смог показать фото. Можно скачать оригинал.' }))
  }

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
    const generation = ++previewGeneration.current
    blobFallbacks.current.clear()
    const cached = blobs.current
    const items = JSON.parse(photoSources) as ResidentChatAttachment[]
    const sources = new Map(items.map(item => [item.id, JSON.stringify(item)]))
    for (const [id, source] of blobSources.current) {
      if (sources.get(id) === source) continue
      const oldUrl = previewUrls.current.get(id)
      if (oldUrl) revokePreview(oldUrl)
      previewUrls.current.delete(id)
      blobSources.current.delete(id)
      cached.delete(id)
    }
    setPreviews(Object.fromEntries(previewUrls.current))
    setFailed(current => Object.fromEntries(Object.entries(current).filter(([id]) => sources.has(id))))
    for (const item of items) {
      if (previewUrls.current.has(item.id)) continue
      setFailed(current => { const next = { ...current }; delete next[item.id]; return next })
      // <img> can display a signed storage URL without fetch-CORS. In particular,
      // a large photo must not be base64-proxied through a size-limited function.
      if (loadPreviewUrl) {
        void loadPreviewUrl(item).then(url => storePreview(item, url, generation)).catch(() => {
          if (generation === previewGeneration.current) void loadBlobPreview(item, generation)
        })
      } else void loadBlobPreview(item, generation)
    }
    return () => { previewGeneration.current++ }
  }, [photoSources, loadPreviewUrl, loadBlobPreview, storePreview, revision, requested])

  useEffect(() => {
    const urls = previewUrls.current
    const cached = blobs.current
    const sources = blobSources.current
    return () => {
      previewGeneration.current++
      urls.forEach(revokePreview)
      urls.clear(); cached.clear(); sources.clear()
    }
  }, [])

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
    setOriginalLinks(current => { const next = { ...current }; delete next[item.id]; return next })
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
    } catch (reason) {
      let canOpenOriginal = false
      if (loadPreviewUrl) {
        try {
          const url = await loadPreviewUrl(item)
          setOriginalLinks(current => ({ ...current, [item.id]: url }))
          canOpenOriginal = true
        } catch { /* Keep the real download error when no fresh signed URL is available. */ }
      }
      setError(canOpenOriginal ? 'Автоматическое скачивание недоступно в этой сети. Откройте оригинал и сохраните его средствами браузера.' : reason instanceof Error ? reason.message : 'Не удалось скачать файл. Повторите попытку.')
    }
    finally { setBusy(null) }
  }

  return <div className="chat-media" ref={rootRef}>
    {photos.length > 0 && <div className={`chat-album chat-album--${photos.length}`}>
      {photos.map((item, index) => <button key={item.id} className="chat-album__photo" aria-label={`Открыть фото ${index + 1}: ${item.name}`} onClick={() => {
        if (failed[item.id]) { setRevision(current => current + 1) }
        else if (previews[item.id]) setSelected(item.id)
      }}>
        {previews[item.id] ? <img src={previews[item.id]} alt={item.name} draggable={false} referrerPolicy="no-referrer" onError={event => previewError(item, event.currentTarget.src)} /> : <span>{failed[item.id] ? '↻ Повторить загрузку' : 'Загрузка фото…'}</span>}
        <span className="chat-album__expand" aria-hidden="true">↗</span>
      </button>)}
    </div>}
    {photos.filter(item => failed[item.id]).map(item => <div key={item.id} className="chat-media__error" role="alert"><span>{failed[item.id]}</span><button type="button" disabled={busy === item.id} onClick={() => void download(item)}>{busy === item.id ? 'Скачивание…' : 'Скачать оригинал'}</button></div>)}
    {files.map(item => <button key={item.id} className="chat-file" onClick={() => void download(item)} disabled={busy === item.id} aria-label={`Скачать ${item.name}`}>
      <span className="chat-file__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5"/></svg></span>
      <span className="chat-file__info"><strong>{item.name}</strong><small>{fileSize(item.size)} · {busy === item.id ? 'Скачивание…' : 'Скачать файл'}</small></span>
      <span className="chat-file__download" aria-hidden="true">↓</span>
    </button>)}
    {error && !active && <div className="chat-media__error" role="alert"><span>{error}</span>{attachments.filter(item => originalLinks[item.id]).map(item => <a key={item.id} href={originalLinks[item.id]} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть оригинал: {item.name}</a>)}</div>}
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
      {previews[active.id] ? <img src={previews[active.id]} alt={active.name} referrerPolicy="no-referrer" onError={event => previewError(active, event.currentTarget.src)} onClick={event => event.stopPropagation()} /> : <div className="chat-photo-viewer__pending" onClick={event => event.stopPropagation()}><p>{failed[active.id] ? 'Фото не загрузилось' : 'Фото ещё загружается'}</p>{failed[active.id] && <button type="button" onClick={() => setRevision(current => current + 1)}>Повторить загрузку</button>}</div>}
      {photos.length > 1 && <button className="chat-photo-viewer__next" aria-label="Следующее фото" onClick={event => {event.stopPropagation(); move(1)}}>›</button>}
      {error && <div className="chat-media__error" role="alert"><span>{error}</span>{originalLinks[active.id] && <a href={originalLinks[active.id]} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть оригинал</a>}</div>}
      <div className="chat-photo-viewer__thumbnails" onClick={event => event.stopPropagation()}>{photos.map((item, index) => <button key={item.id} aria-label={`Фото ${index + 1}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{previews[item.id] ? <img src={previews[item.id]} alt="" referrerPolicy="no-referrer" onError={event => previewError(item, event.currentTarget.src)} /> : index + 1}</button>)}</div>
    </div>, document.body)}
  </div>
}

function revokePreview(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

function fileSize(size: number) {
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}
