import { useEffect, useState } from 'react'
export function useCurrentTime() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  return now
}
