import { useState, type FormEvent } from 'react'
import type { AuthFormState, AuthMode } from '../types'
import { SiteFooter } from './SiteFooter'

type AuthScreenProps = {
  mode: AuthMode
  form: AuthFormState
  error: string
  success: string
  loading: boolean
  verificationSending: boolean
  verificationChecking: boolean
  verificationSentTo: string
  emailVerified: boolean
  onSwitchMode: (mode: AuthMode) => void
  onFieldChange: (field: keyof AuthFormState, value: string) => void
  onRequestCode: () => void
  onVerifyCode: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AuthScreen({
  mode,
  form,
  error,
  success,
  loading,
  verificationSending,
  verificationChecking,
  verificationSentTo,
  emailVerified,
  onSwitchMode,
  onFieldChange,
  onRequestCode,
  onVerifyCode,
  onSubmit,
}: AuthScreenProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <section className="hero-card auth-card">
        <div className="auth-layout">
          <div className="auth-copy">
            <div className="brand-title-group">
              <p className="eyebrow accent">MalinkiEco</p>
              <span className="brand-badge">WEB</span>
            </div>
            <h1>Веб-доступ для собственников</h1>
            <p className="hero-copy">
              Веб-версия предоставляет доступ к основным разделам системы: объявлениям, общему чату,
              опросам, оплате и списку собственников. Сервис рассчитан на работу с iPhone, iPad и
              компьютеров.
            </p>
            <ul className="feature-list">
              <li>Объявления и события поселка</li>
              <li>Общий чат собственников</li>
              <li>Опросы и голосование</li>
              <li>Баланс, оплата и реквизиты</li>
            </ul>
          </div>

          <div className="auth-box">
            <div className="auth-switch">
              <button
                className={`auth-switch__button ${mode === 'login' ? 'is-active' : ''}`}
                type="button"
                onClick={() => onSwitchMode('login')}
              >
                Вход
              </button>
              <button
                className={`auth-switch__button ${mode === 'register' ? 'is-active' : ''}`}
                type="button"
                onClick={() => onSwitchMode('register')}
              >
                Регистрация
              </button>
            </div>

            <form className="login-form" onSubmit={onSubmit}>
              {mode === 'login' ? (
                <label>
                  Логин или почта
                  <input
                    value={form.login}
                    onChange={(event) => onFieldChange('login', event.target.value)}
                    placeholder="Введите логин или почту"
                    autoComplete="username"
                  />
                </label>
              ) : (
                <>
                  <label>
                    Электронная почта
                    <input
                      value={form.login}
                      onChange={(event) => onFieldChange('login', event.target.value)}
                      placeholder="Например, owner@example.com"
                      autoComplete="email"
                    />
                    <small>На этот адрес придет код подтверждения для регистрации.</small>
                  </label>

                  <label>
                    Отображаемое имя
                    <input
                      value={form.fullName}
                      onChange={(event) => onFieldChange('fullName', event.target.value)}
                      placeholder="Иван Иванов"
                      autoComplete="name"
                    />
                  </label>

                  <label>
                    Номер телефона
                    <input
                      value={form.phone}
                      onChange={(event) => onFieldChange('phone', event.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10 цифр после 8, например 9991234567"
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                    <small>Первая цифра 8 подставится автоматически.</small>
                  </label>

                  <label>
                    Участки
                    <input
                      value={form.plots}
                      onChange={(event) => onFieldChange('plots', event.target.value)}
                      placeholder="Например: 1, 2, 7"
                    />
                    <small>Если участков несколько, перечислите их через запятую.</small>
                  </label>
                </>
              )}

              <label>
                Пароль
                <div className="password-field">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => onFieldChange('password', event.target.value)}
                    placeholder="Введите пароль"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? 'Скрыть' : 'Показать'}
                  </button>
                </div>
              </label>

              {mode === 'register' && (
                <div className="verification-box">
                  <div className="verification-box__header">
                    <strong>Подтверждение электронной почты</strong>
                    {emailVerified && <span className="verification-chip is-success">Почта подтверждена</span>}
                  </div>

                  <p className="verification-box__text">
                    Сначала запросите письмо с кодом, затем введите 6 цифр ниже и подтвердите адрес.
                    Пока код не подтвержден, отправить заявку модераторам нельзя.
                  </p>

                  <div className="verification-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={onRequestCode}
                      disabled={verificationSending}
                    >
                      {verificationSending ? 'Отправляем письмо...' : 'Отправить код'}
                    </button>
                  </div>

                  {verificationSentTo && (
                    <>
                      <small className="verification-box__hint">
                        Код отправлен на {verificationSentTo}. Если письма нет, проверьте спам и попробуйте
                        отправить код еще раз.
                      </small>

                      <label>
                        Код подтверждения
                        <input
                          value={form.verificationCode}
                          onChange={(event) =>
                            onFieldChange('verificationCode', event.target.value.replace(/\D/g, '').slice(0, 6))
                          }
                          placeholder="6 цифр из письма"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                        />
                      </label>

                      <div className="verification-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={onVerifyCode}
                          disabled={verificationChecking || emailVerified}
                        >
                          {verificationChecking
                            ? 'Проверяем код...'
                            : emailVerified
                              ? 'Почта подтверждена'
                              : 'Подтвердить код'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {success && <p className="success-note">{success}</p>}
              {error && <p className="error-note">{error}</p>}

              <button className="primary-button wide-button" type="submit" disabled={loading}>
                {mode === 'login'
                  ? loading
                    ? 'Выполняем вход...'
                    : 'Войти'
                  : loading
                    ? 'Отправляем заявку...'
                    : 'Отправить заявку'}
              </button>
            </form>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}

