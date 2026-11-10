import { useCallback, useEffect, useRef, useState } from 'react'
import { auth } from '../lib/firebase'
import { checkGateAvailability } from '../lib/gateApi'

type Availability = { state: 'checking' | 'available' | 'unavailable' | 'unknown'; reason: string }
export function useGateAvailability(enabled: boolean) {
  const [availability, setAvailability] = useState<Availability>({ state: 'checking', reason: '' })
  const nextCheck = useRef(0)
  const reportFailure = useCallback((reason: string) => {
    nextCheck.current = Date.now() + 300_000
    setAvailability({ state: 'unavailable', reason })
  }, [])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    nextCheck.current = 0
    let pending = false
    const check = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setAvailability({ state: 'unavailable', reason: 'Нет подключения к интернету' })
        return
      }
      if (cancelled || pending || document.hidden || Date.now() < nextCheck.current || !auth?.currentUser) return
      pending = true
      nextCheck.current = Date.now() + 300_000
      setAvailability({ state: 'checking', reason: '' })
      try {
        const result = await checkGateAvailability()
        if (cancelled) return
        if (!navigator.onLine) { setAvailability({ state: 'unavailable', reason: 'Нет подключения к интернету' }); return }
        if (!result) {
          // Older deployed backend has no device probe. Never call that "available".
          nextCheck.current = Date.now() + 3_600_000
          setAvailability({ state: 'unknown', reason: 'Проверка при открытии' })
        } else setAvailability({ state: result.available ? 'available' : 'unavailable', reason: result.reason })
      } catch {
        if (!cancelled) setAvailability({ state: 'unavailable', reason: 'Нет связи с сервисом ворот' })
      } finally { pending = false }
    }
    void check()
    const timer = window.setInterval(() => void check(), 300_000)
    const reconnect = () => { nextCheck.current = 0; void check() }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('offline', check)
    window.addEventListener('online', reconnect)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('offline', check)
      window.removeEventListener('online', reconnect)
    }
  }, [enabled])
  return { ...availability, reportFailure }
}
