import { useEffect, useMemo, useState } from 'react'
import { SiteFooter } from './SiteFooter'

type MaintenanceScreenVariant = 'maintenance' | 'error'

type MaintenanceScreenProps = {
  title: string
  message: string
  variant?: MaintenanceScreenVariant
  onSignIn?: () => void
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
  onSignIn,
}: MaintenanceScreenProps) {
  const [now, setNow] = useState(() => Date.now())
  const hasCountdown = endsAtClient > 0
  const remainingText = useMemo(() => formatCountdown(endsAtClient - now), [endsAtClient, now])

  useEffect(() => {
    if (!hasCountdown) return

    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [hasCountdown, endsAtClient])

  return (
    <div className="shell maintenance-shell">
      <section className={`maintenance-card maintenance-card--${variant}`} aria-live="polite">
        <div className="service-status-art" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round">
            {variant === 'error' ? <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3v.1" /></> : <><path d="M14 6a5 5 0 0 0-6 6L3 17a2.8 2.8 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4Z" /><path d="m17 3 4 4" /></>}
          </svg>
        </div>
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
                <strong>{endsAtClient > now ? remainingText : 'Ожидаем завершения'}</strong>
              </div>
            ) : null}
          </div>
        </div>
        <div className="service-actions">
          <p className="service-live"><span aria-hidden="true" />Сайт откроется автоматически после восстановления работы</p>
          <a className="ghost-button" href="mailto:info@rethavo.ru">Связаться с поддержкой</a>
          {onSignIn && <button type="button" className="service-signin" onClick={onSignIn}>Вход для администратора</button>}
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
