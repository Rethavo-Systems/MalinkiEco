import { useEffect, useMemo, useState } from 'react'
import type { NotificationSettings, RemoteUser } from '../types'

type AccountSettingsPanelProps = {
  profile: RemoteUser
  open: boolean
  savingProfileRequest: boolean
  savingNotificationSettings: boolean
  webPushTitle: string
  webPushDescription: string
  webPushActionLabel: string | null
  webPushBusy: boolean
  onClose: () => void
  onLogout: () => void | Promise<void>
  onWebPushAction: () => void | Promise<void>
  onSubmitProfileChangeRequest: (payload: { fullName: string; phone: string }) => void | Promise<void>
  onUpdateNotificationSettings: (settings: NotificationSettings) => void | Promise<void>
}

const RESIDENT_TOGGLES: Array<{ key: keyof NotificationSettings; label: string; description: string }> = [
  {
    key: 'events',
    label: 'События и объявления',
    description: 'Уведомления о новых объявлениях, сборах и других событиях поселка.',
  },
  {
    key: 'polls',
    label: 'Опросы',
    description: 'Уведомления о новых опросах, завершении и публикации результатов.',
  },
  {
    key: 'payments',
    label: 'Оплаты и сборы',
    description: 'Уведомления о заявках на оплату, подтверждении и отклонении платежей.',
  },
  {
    key: 'chat',
    label: 'Чат',
    description: 'Уведомления о новых сообщениях в общем чате.',
  },
  {
    key: 'mentions',
    label: 'Упоминания',
    description: 'Отдельные уведомления, когда вас упоминают в сообщении.',
  },
]

const SERVICE_TOGGLES: Array<{ key: keyof NotificationSettings; label: string; description: string }> = [
  {
    key: 'requests',
    label: 'Заявки пользователей',
    description: 'Уведомления для staff о новых заявках на регистрацию, изменение данных и оплату.',
  },
  {
    key: 'system',
    label: 'Системные уведомления',
    description: 'Служебные уведомления, связанные с доступом и важными изменениями в системе.',
  },
]

export function AccountSettingsPanel({
  profile,
  open,
  savingProfileRequest,
  savingNotificationSettings,
  webPushTitle,
  webPushDescription,
  webPushActionLabel,
  webPushBusy,
  onClose,
  onLogout,
  onWebPushAction,
  onSubmitProfileChangeRequest,
  onUpdateNotificationSettings,
}: AccountSettingsPanelProps) {
  const [fullName, setFullName] = useState(profile.fullName)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [settings, setSettings] = useState<NotificationSettings>(profile.notificationSettings)

  const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'

  const sections = useMemo(
    () => [
      {
        title: 'Для жителей',
        toggles: RESIDENT_TOGGLES,
      },
      ...(isStaff
        ? [
            {
              title: 'Для модерации',
              toggles: SERVICE_TOGGLES,
            },
          ]
        : []),
    ],
    [isStaff],
  )

  useEffect(() => {
    if (!open) return
    setFullName(profile.fullName)
    setPhone(profile.phone ?? '')
    setSettings(profile.notificationSettings)
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
          <div className="settings-groups">
            {sections.map((section) => (
              <div key={section.title} className="settings-toggle-group">
                <div className="settings-toggle-group__header">
                  <strong>{section.title}</strong>
                </div>
                <div className="settings-toggles">
                  {section.toggles.map((toggle) => (
                    <label key={toggle.key} className="settings-toggle-card" htmlFor={`settings-toggle-${toggle.key}`}>
                      <div className="settings-toggle-card__copy">
                        <span className="settings-toggle-card__label">{toggle.label}</span>
                        <span className="settings-toggle-card__description">{toggle.description}</span>
                      </div>
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
                    </label>
                  ))}
                </div>
              </div>
            ))}
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
