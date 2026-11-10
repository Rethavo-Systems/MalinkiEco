import type { CSSProperties } from 'react'
import { PAGE_NOTICE_DURATION_MS, type NoticeKind } from '../hooks/usePageNotice'
import './PageNotice.css'

export function PageNotice({ message, kind, onClose }: { message: string; kind: NoticeKind; onClose: () => void }) {
  const iconPath = kind === 'success' ? 'm7 12 3 3 7-7' : kind === 'warning' ? 'M12 7v6 M12 17h.01' : kind === 'error' ? 'M12 7v6 M12 17h.01' : 'M12 11v6 M12 7h.01'
  return <aside className={`notice-bar page-notice notice-bar--${kind}`} role={kind === 'error' ? 'alert' : 'status'}
    style={{ '--notice-duration': `${PAGE_NOTICE_DURATION_MS}ms` } as CSSProperties}>
    <svg className="page-notice__symbol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d={iconPath} /></svg>
    <p className="page-notice__message">{message}</p>
    <button className="notice-close page-notice__close" type="button" onClick={onClose} aria-label="Закрыть уведомление" title="Закрыть уведомление">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
    <span className="page-notice__countdown" aria-hidden="true"><span /></span>
  </aside>
}
