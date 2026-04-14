import { useEffect, useState } from 'react'
import type { NotificationSettings, RemoteUser } from '../types'

type AccountSettingsPanelProps = {
  profile: RemoteUser
  open: boolean
  savingProfileRequest: boolean
  savingNotificationSettings: boolean
  onClose: () => void
  onLogout: () => void | Promise<void>
  onSubmitProfileChangeRequest: (payload: { fullName: string; phone: string }) => void | Promise<void>
  onUpdateNotificationSettings: (settings: NotificationSettings) => void | Promise<void>
}

export function AccountSettingsPanel({
  profile,
  open,
  savingProfileRequest,
  savingNotificationSettings,
  onClose,
  onLogout,
  onSubmitProfileChangeRequest,
  onUpdateNotificationSettings,
}: AccountSettingsPanelProps) {
  const [fullName, setFullName] = useState(profile.fullName)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [settings, setSettings] = useState<NotificationSettings>(profile.notificationSettings)

  useEffect(() => {
    if (!open) return
    setFullName(profile.fullName)
    setPhone(profile.phone ?? '')
    setSettings(profile.notificationSettings)
  }, [open, profile.fullName, profile.phone, profile.notificationSettings])

  if (!open) return null

  const updateToggle = (key: keyof NotificationSettings, checked: boolean) => {
    const next = { ...settings, [key]: checked }
    setSettings(next)
    void onUpdateNotificationSettings(next)
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
          <h4>Уведомления</h4>
          <div className="settings-toggles">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.events}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('events', event.target.checked)}
              />
              <span>События и объявления</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.chat}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('chat', event.target.checked)}
              />
              <span>Чат</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.mentions}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('mentions', event.target.checked)}
              />
              <span>Упоминания</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.polls}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('polls', event.target.checked)}
              />
              <span>Опросы</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.payments}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('payments', event.target.checked)}
              />
              <span>Оплаты и сборы</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.system}
                disabled={savingNotificationSettings}
                onChange={(event) => updateToggle('system', event.target.checked)}
              />
              <span>Системные уведомления</span>
            </label>
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
