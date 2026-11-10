import { useCallback, useState } from 'react'

export function usePageNotice() {
  const [pageNotice, setPageNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'info' | 'error' | 'success' | 'warning'>('info')

  const showNotice = useCallback((message: string, kind: 'info' | 'error' | 'success' | 'warning' = 'info') => {
    setPageNotice(message)
    setNoticeKind(kind)
  }, [])

  const clearNotice = useCallback(() => {
    setPageNotice('')
  }, [])

  return {
    pageNotice,
    noticeKind,
    showNotice,
    clearNotice,
  }
}
