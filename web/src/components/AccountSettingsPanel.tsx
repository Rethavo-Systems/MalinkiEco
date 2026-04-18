import { useEffect, useMemo, useState } from 'react'
import type { NotificationSettings, RemoteUser } from '../types'

type AccountSettingsPanelProps = {
  profile: RemoteUser
  open: boolean
  savingProfileRequest: boolean
  savingNotificationSettings: boolean
  sendingSupportRequest: boolean
  supportEmail: string
  webPushTitle: string
  webPushDescription: string
  webPushActionLabel: string | null
  webPushBusy: boolean
  onClose: () => void
  onLogout: () => void | Promise<void>
  onWebPushAction: () => void | Promise<void>
  onSubmitProfileChangeRequest: (payload: { fullName: string; phone: string }) => void | Promise<void>
  onUpdateNotificationSettings: (settings: NotificationSettings) => void | Promise<void>
  onSubmitSupportRequest: (payload: { subject: string; message: string }) => void | Promise<void>
}

type ToggleCard = {
  key: keyof NotificationSettings
  label: string
  description: string
}

const BASE_TOGGLES: ToggleCard[] = [
  {
    key: 'events',
    label: 'События и объявления',
    description: 'Уведомления о новых объявлениях, событиях и важных публикациях поселка.',
  },
  {
    key: 'polls',
    label: 'Опросы',
    description: 'Уведомления о новых опросах, завершении голосования и публикации результатов.',
  },
  {
    key: 'payments',
    label: 'Оплаты и сборы',
    description: 'Уведомления о платежах, начислениях, подтверждении и отклонении оплаты.',
  },
  {
    key: 'chat',
    label: 'Чат',
    description: 'Уведомления о новых сообщениях в общем чате.',
  },
  {
    key: 'mentions',
    label: 'Упоминания',
    description: 'Отдельные уведомления, когда вас упоминают в сообщениях.',
  },
  {
    key: 'system',
    label: 'Системные уведомления',
    description: 'Служебные уведомления о доступе, подтверждении регистрации и других важных изменениях.',
  },
]

const STAFF_TOGGLE: ToggleCard = {
  key: 'requests',
  label: 'Заявки пользователей',
  description: 'Уведомления о новых заявках на регистрацию, изменении данных и оплату.',
}

export function AccountSettingsPanel({
  profile,
  open,
  savingProfileRequest,
  savingNotificationSettings,
  sendingSupportRequest,
  supportEmail,
  webPushTitle,
  webPushDescription,
  webPushActionLabel,
  webPushBusy,
  onClose,
  onLogout,
  onWebPushAction,
  onSubmitProfileChangeRequest,
  onUpdateNotificationSettings,
  onSubmitSupportRequest,
}: AccountSettingsPanelProps) {
  const [fullName, setFullName] = useState(profile.fullName)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [settings, setSettings] = useState<NotificationSettings>(profile.notificationSettings)
  const [supportSubject, setSupportSubject] = useState('')
  const [supportMessage, setSupportMessage] = useState('')

  const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'
  const toggles = useMemo(() => (isStaff ? [...BASE_TOGGLES, STAFF_TOGGLE] : BASE_TOGGLES), [isStaff])

  useEffect(() => {
    if (!open) return
    setFullName(profile.fullName)
    setPhone(profile.phone ?? '')
    setSettings(profile.notificationSettings)
    setSupportSubject('')
    setSupportMessage('')
  }, [open, profile.fullName, profile.phone, profile.notificationSettings])

  if (!open) return null

  const updateToggle = (key: keyof NotificationSettings, checked: boolean) => {
    const nextSettings = { ...settings, [key]: checked }
    setSettings(nextSettings)
    void onUpdateNotificationSettings(nextSettings)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-panel__header">
          <h3>Настройки</h3>
          <button className="ghost-button" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <section className="settings-panel__section">
          <h4>Изменение данных</h4>
          <p>Имя и телефон обновятся после одобрения модератором или администратором.</p>
          <label>
            <span>Имя</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
          <label>
            <span>Телефон</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={savingProfileRequest}
            onClick={() => void onSubmitProfileChangeRequest({ fullName, phone })}
          >
            {savingProfileRequest ? 'Отправляем...' : 'Отправить запрос на изменение'}
          </button>
        </section>

        <section className="settings-panel__section">
          <h4>Push для веб-версии</h4>
          <div className="settings-push-card">
            <div className="settings-push-card__copy">
              <strong>{webPushTitle}</strong>
              <p>{webPushDescription}</p>
            </div>
            {webPushActionLabel ? (
              <button className="ghost-button" type="button" disabled={webPushBusy} onClick={() => void onWebPushAction()}>
                {webPushActionLabel}
              </button>
            ) : null}
          </div>
        </section>

        <section className="settings-panel__section">
          <h4>Уведомления</h4>
          <div className="settings-toggles">
            {toggles.map((toggle) => (
              <label key={toggle.key} className="settings-toggle-card" htmlFor={`settings-toggle-${toggle.key}`}>
                <span className="settings-toggle-card__control">
                  <input
                    id={`settings-toggle-${toggle.key}`}
                    type="checkbox"
                    checked={settings[toggle.key]}
                    disabled={savingNotificationSettings}
                    onChange={(event) => updateToggle(toggle.key, event.target.checked)}
                  />
                  <span className="poll-anonymous-toggle__track" aria-hidden="true">
                    <span className="poll-anonymous-toggle__thumb" />
                  </span>
                </span>
                <div className="settings-toggle-card__copy">
                  <span className="settings-toggle-card__label">{toggle.label}</span>
                  <span className="settings-toggle-card__description">{toggle.description}</span>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-panel__section">
          <h4>Связь с поддержкой</h4>
          <p>
            Здесь можно задать вопрос или отправить предложение по улучшению сервиса. Также можно написать напрямую на{' '}
            <strong>{supportEmail}</strong>.
          </p>
          <label>
            <span>Тема</span>
            <input
              value={supportSubject}
              onChange={(event) => setSupportSubject(event.target.value)}
              placeholder="Например: Вопрос по уведомлениям"
            />
          </label>
          <label>
            <span>Сообщение</span>
            <textarea
              rows={5}
              value={supportMessage}
              onChange={(event) => setSupportMessage(event.target.value)}
              placeholder="Опишите вопрос, проблему или предложение."
            />
          </label>
          <div className="settings-panel__actions">
            <button
              className="primary-button"
              type="button"
              disabled={sendingSupportRequest}
              onClick={() => void onSubmitSupportRequest({ subject: supportSubject, message: supportMessage })}
            >
              {sendingSupportRequest ? 'Отправляем...' : 'Отправить в поддержку'}
            </button>
            <a className="ghost-button settings-panel__link-button" href={`mailto:${supportEmail}`}>
              Написать через почту
            </a>
          </div>
        </section>

        <section className="settings-panel__section">
          <button className="danger-button" type="button" onClick={() => void onLogout()}>
            Выйти
          </button>
        </section>
      </div>
    </div>
  )
}
