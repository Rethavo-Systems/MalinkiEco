import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { auth, db } from '../lib/firebase'
import {
  disableStoredWebPushSubscription,
  getCurrentPushSubscription,
  isAppleMobileDevice,
  removeStoredWebPushSubscription,
  resolveWebPushSupportState,
  saveWebPushSubscription,
  subscribeToWebPush,
  type WebPushSupportState,
} from '../lib/webPush'
import type { RemoteUser } from '../types'
import { humanizeError } from '../utils'

type NoticeCallback = (message: string) => void

type WebPushPresentation = {
  title: string
  description: string
  actionLabel: string | null
}

export function useWebPush(profile: RemoteUser | null, showNotice: NoticeCallback) {
  const profileId = profile?.id ?? null
  const [status, setStatus] = useState<WebPushSupportState>('checking')
  const [busy, setBusy] = useState(false)
  const operation = useRef(0)

  const syncCurrentSubscription = useCallback(
    async (silent = true) => {
      const version = ++operation.current
      if (!db || !profileId) {
        setStatus('unsupported')
        return
      }

      const supportState = resolveWebPushSupportState()
      if (supportState === 'install-required' || supportState === 'unsupported' || supportState === 'blocked') {
        setStatus(supportState)
        return
      }

      try {
        setStatus('checking')
        const subscription = await getCurrentPushSubscription()
        if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
        if (subscription) {
          await saveWebPushSubscription(db, { id: profileId }, subscription)
          if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
          setStatus('enabled')
          return
        }
        setStatus('ready')
      } catch (error) {
        if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
        setStatus('error')
        if (!silent) {
          showNotice(humanizeError(error))
        }
      }
    },
    [profileId, showNotice],
  )

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!profileId) {
        setStatus('unsupported')
        return
      }

      const supportState = resolveWebPushSupportState()
      if (cancelled) return
      setStatus(supportState === 'enabled' || supportState === 'ready' ? 'checking' : supportState)

      if (supportState === 'enabled' || supportState === 'ready') {
        await syncCurrentSubscription(true)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      operation.current++
    }
  }, [profileId, syncCurrentSubscription])

  const enable = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const silent = options.silent === true
      if (!db || !profileId) return

      const supportState = resolveWebPushSupportState()
      if (supportState === 'install-required') {
        if (!silent) {
          showNotice(
            isAppleMobileDevice()
              ? 'На iPhone сначала откройте меню «Поделиться», выберите «На экран Домой», затем откройте сайт как приложение и включите push-уведомления.'
              : 'Сначала откройте сайт как установленное приложение, затем включите push-уведомления.',
          )
        }
        setStatus('install-required')
        return
      }

      if (supportState === 'unsupported') {
        if (!silent) {
          showNotice('В этом браузере web push пока не поддерживается.')
        }
        setStatus('unsupported')
        return
      }

      setBusy(true)
      const version = ++operation.current
      try {
        const permission =
          Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()

        if (permission !== 'granted') {
          setStatus(permission === 'denied' ? 'blocked' : 'ready')
          if (!silent) {
            showNotice(
              permission === 'denied'
                ? 'Push-уведомления отключены в настройках браузера. Разрешите уведомления для MalinkiEco и повторите попытку.'
                : 'Разрешение на push-уведомления не было предоставлено.',
            )
          }
          return
        }

        const subscription = await subscribeToWebPush()
        if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
        await saveWebPushSubscription(db, { id: profileId }, subscription)
        if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
        setStatus('enabled')
        if (!silent) {
          showNotice(
            'Push-уведомления для веб-версии включены. На iPhone уведомления будут поступать из установленной веб-версии приложения.',
          )
        }
      } catch (error) {
        if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
        setStatus('error')
        if (!silent) {
          showNotice(humanizeError(error))
        }
      } finally {
        setBusy(false)
      }
    },
    [profileId, showNotice],
  )

  const disable = useCallback(async () => {
    if (!db) return
    const version = ++operation.current
    setBusy(true)
    try {
      const fullyCleaned = await disableStoredWebPushSubscription(db)
      if (auth?.currentUser?.uid !== profileId || version !== operation.current) return
      setStatus('ready')
      showNotice(fullyCleaned ? 'Push-уведомления для веб-версии отключены.' : 'Доставка уведомлений остановлена. Очистку подписки не удалось завершить; при следующем подключении она будет проверена заново.')
    } catch (error) {
      showNotice(humanizeError(error))
    } finally {
      setBusy(false)
    }
  }, [profileId, showNotice])

  const unbindBeforeLogout = useCallback(async () => {
    if (!db) return
    operation.current++

    try {
      const subscription = await getCurrentPushSubscription()
      try { await removeStoredWebPushSubscription(db, subscription) }
      finally { await subscription?.unsubscribe() }
    } catch {
      // Browser unsubscribe also invalidates delivery if deleting the server record failed.
    }
  }, [])

  const handleAction = useCallback(async () => {
    if (busy || status === 'checking') return

    if (status === 'enabled') {
      await disable()
      return
    }

    await enable()
  }, [busy, disable, enable, status])

  const presentation = useMemo<WebPushPresentation>(() => {
    switch (status) {
      case 'checking':
        return { title: 'Проверяем подключение', description: 'Проверяем подписку этого браузера.', actionLabel: null }
      case 'error':
        return { title: 'Подключение не подтверждено', description: 'Не удалось сохранить подписку. Проверьте интернет и повторите подключение.', actionLabel: busy ? 'Подключаем…' : 'Повторить подключение' }
      case 'enabled':
        return {
          title: 'Push-уведомления включены',
          description: 'Уведомления о сообщениях, событиях и платежах будут доставляться в веб-версию через push.',
          actionLabel: busy ? 'Сохраняем...' : 'Отключить',
        }
      case 'install-required':
        return {
          title: 'Требуется установка на экран Домой',
          description:
            'На iPhone push-уведомления работают только в установленной веб-версии MalinkiEco, добавленной на экран Домой через Safari.',
          actionLabel: 'Инструкция',
        }
      case 'blocked':
        return {
          title: 'Push-уведомления заблокированы',
          description:
            'Разрешите уведомления в настройках браузера, после чего подключение push-уведомлений можно будет повторить.',
          actionLabel: 'Повторить',
        }
      case 'ready':
        return {
          title: 'Push-уведомления доступны',
          description:
            'Получайте уведомления на этом устройстве. Браузер попросит разрешение после нажатия кнопки. Настройки категорий — ниже.',
          actionLabel: busy ? 'Подключаем...' : 'Включить push',
        }
      default:
        return {
          title: 'Push-уведомления недоступны',
          description: 'Браузер не поддерживает push. Попробуйте актуальный браузер. Письма отправляются только для событий, для которых настроена почтовая доставка.',
          actionLabel: null,
        }
    }
  }, [busy, status])

  return {
    status,
    busy,
    presentation,
    handleAction,
    unbindBeforeLogout,
  }
}
