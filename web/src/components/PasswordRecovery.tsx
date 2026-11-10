import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase'

export function PasswordRecovery({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail.includes('@') ? initialEmail : '')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  return <form className="login-form" onSubmit={async event => {
    event.preventDefault()
    if (!auth || busy) return
    setBusy(true); setError('')
    try {
      auth.languageCode = 'ru'
      const localWorker = import.meta.env.DEV ? String(import.meta.env.VITE_LOCAL_NOTIFICATION_WORKER_URL ?? '').trim() : ''
      const recoveryApi = localWorker || String(import.meta.env.VITE_PASSWORD_RECOVERY_API_BASE_URL ?? '').trim().replace(/\/$/, '')
      if (recoveryApi) {
        const url = new URL(localWorker || `${recoveryApi}/api/password-recovery/request`)
        if (localWorker) url.searchParams.set('path', '/api/password-recovery/request')
        const response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }), signal: AbortSignal.timeout(20000),
        })
        if (!response.ok) throw new Error('Recovery email unavailable')
      } else {
        await sendPasswordResetEmail(auth, email.trim())
      }
      setSent(true)
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (code === 'auth/user-not-found') setSent(true)
      else setError(code === 'auth/too-many-requests' ? 'Слишком много попыток. Повторите позже.' : 'Не удалось отправить письмо. Проверьте адрес и соединение.')
    } finally { setBusy(false) }
  }}>
    <h2>Восстановление пароля</h2>
    <p className="hero-copy">Укажите почту, с которой зарегистрирован аккаунт. В письме будет ссылка для установки нового пароля.</p>
    <label>Электронная почта<input type="email" autoComplete="email" required value={email} onChange={event => { setEmail(event.target.value); setSent(false) }} disabled={busy} /></label>
    {sent && <p role="status" className="success-note">Если для этого адреса доступно восстановление, письмо отправлено. Проверьте входящие и спам.</p>}
    {error && <p role="alert" className="error-note">{error}</p>}
    <button type="submit" className="primary-button" disabled={busy || sent}>{busy ? 'Отправляем…' : 'Отправить ссылку'}</button>
    <small>Если аккаунт создан с логином без электронной почты, обратитесь к администратору.</small>
    <button type="button" className="ghost-button" onClick={onBack}>Вернуться ко входу</button>
  </form>
}
