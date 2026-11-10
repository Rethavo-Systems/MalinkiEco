import { useCallback, useEffect, useState } from 'react'

export const PAGE_NOTICE_DURATION_MS = 7_000
export type NoticeKind = 'info' | 'error' | 'success' | 'warning'

export function usePageNotice() {
  const [notice, setNotice] = useState({ message: '', kind: 'info' as NoticeKind, id: 0 })

  const showNotice = useCallback((message: string, kind: NoticeKind = 'info') => {
    setNotice(current => ({ message, kind, id: current.id + 1 }))
  }, [])

  const clearNotice = useCallback(() => {
    setNotice(current => ({ ...current, message: '', id: current.id + 1 }))
  }, [])

  useEffect(() => {
    if (!notice.message) return
    const shownId = notice.id
    const timer = window.setTimeout(() => {
      // A previous timeout must never dismiss a newer notice, including identical text.
      setNotice(current => current.id === shownId ? { ...current, message: '' } : current)
    }, PAGE_NOTICE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [notice.id, notice.message])

  return {
    pageNotice: notice.message,
    noticeKind: notice.kind,
    noticeId: notice.id,
    showNotice,
    clearNotice,
  }
}
