import { useEffect, useState } from 'react'

type SupportPanelProps = {
  open: boolean
  sending: boolean
  supportEmail: string
  onClose: () => void
  onSubmit: (payload: { subject: string; message: string }) => void | Promise<void>
}

export function SupportPanel({ open, sending, supportEmail, onClose, onSubmit }: SupportPanelProps) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setSubject('')
    setMessage('')
  }, [open])

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel support-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel__header">
          <h3>Техподдержка</h3>
          <button className="ghost-button" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <section className="settings-panel__section">
          <h4>Связь с поддержкой</h4>
          <p>
            Здесь можно задать вопрос или отправить предложение по улучшению сервиса. Также можно написать напрямую на{' '}
            <strong>{supportEmail}</strong>.
          </p>
          <label>
            <span>Тема</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Например: вопрос по уведомлениям"
            />
          </label>
          <label>
            <span>Сообщение</span>
            <textarea
              rows={5}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Опишите вопрос, проблему или предложение."
            />
          </label>
          <div className="settings-panel__actions">
            <button className="primary-button" type="button" disabled={sending} onClick={() => void onSubmit({ subject, message })}>
              {sending ? 'Отправляем...' : 'Отправить в поддержку'}
            </button>
            <a className="ghost-button settings-panel__link-button" href={`mailto:${supportEmail}`}>
              Написать через почту
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
