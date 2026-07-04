import { useEffect, useMemo, useState } from 'react'
import { SiteFooter } from './SiteFooter'

type MaintenanceScreenVariant = 'maintenance' | 'error'

type MaintenanceScreenProps = {
  title: string
  message: string
  variant?: MaintenanceScreenVariant
  endsAtClient?: number
}

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const time = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')

  return days > 0 ? `${days} д ${time}` : time
}

export function MaintenanceScreen({
  title,
  message,
  variant = 'maintenance',
  endsAtClient = 0,
}: MaintenanceScreenProps) {
  const [now, setNow] = useState(() => Date.now())
  const hasCountdown = endsAtClient > 0
  const remainingText = useMemo(() => formatCountdown(endsAtClient - now), [endsAtClient, now])

  useEffect(() => {
    if (!hasCountdown) return

    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())

    return () => window.clearInterval(timer)
  }, [hasCountdown, endsAtClient])

  return (
    <div className="shell maintenance-shell">
      <section className={`maintenance-card maintenance-card--${variant}`} aria-live="polite">
        <div className="maintenance-card__top">
          <div className="maintenance-brand">
            <div className="maintenance-brand__text">
              <span>MalinkiEco</span>
              <strong>WEB</strong>
            </div>
          </div>
          <span className="maintenance-chip">{variant === 'error' ? 'Сбой' : 'Обслуживание'}</span>
        </div>

        <div className="maintenance-card__main">
          {variant === 'error' ? (
            <div className="maintenance-alert" aria-hidden="true">
              <span>!</span>
            </div>
          ) : (
            <div className="maintenance-spinner" aria-hidden="true">
              <span />
              <span />
              <i />
            </div>
          )}
          <div>
            <h1>{title}</h1>
            <p className="maintenance-message">{message}</p>
            {hasCountdown ? (
              <div className="maintenance-countdown">
                <span>{variant === 'error' ? 'Ориентир восстановления' : 'До окончания работ'}</span>
                <strong>{remainingText}</strong>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
