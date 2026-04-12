import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../lib/firebase'
import {
  disableStoredWebPushSubscription,
  getCurrentPushSubscription,
  isAppleMobileDevice,
  isStandaloneDisplayMode,
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

const AUTO_PROMPT_SESSION_KEY = 'malinkieco-web-push-autoprompted'

export function useWebPush(profile: RemoteUser | null, showNotice: NoticeCallback) {
  const [status, setStatus] = useState<WebPushSupportState>('unsupported')
  const [busy, setBusy] = useState(false)

  const syncCurrentSubscription = useCallback(
    async (silent = true) => {
      if (!db || !profile) {
        setStatus('unsupported')
        return
      }

      const supportState = resolveWebPushSupportState()
      if (supportState === 'install-required' || supportState === 'unsupported' || supportState === 'blocked') {
        setStatus(supportState)
        return
      }

      try {
        const subscription = await getCurrentPushSubscription()
        if (subscription) {
          await saveWebPushSubscription(db, profile, subscription)
          setStatus('enabled')
          return
        }
        setStatus('ready')
      } catch (error) {
        setStatus('ready')
        if (!silent) {
          showNotice(humanizeError(error))
        }
      }
    },
    [profile, showNotice],
  )

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!profile) {
        setStatus('unsupported')
        return
      }

      const supportState = resolveWebPushSupportState()
      if (cancelled) return
      setStatus(supportState)

      if (supportState === 'enabled' || supportState === 'ready') {
        await syncCurrentSubscription(true)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [profile, syncCurrentSubscription])

  const enable = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true
    if (!db || !profile) return

    const supportState = resolveWebPushSupportState()
    if (supportState === 'install-required') {
      if (!silent) {
        showNotice(
          isAppleMobileDevice()
            ? 'На iPhone сначала откройте меню “Поделиться”, выберите “На экран Домой”, затем откройте сайт как приложение и включите push.'
            : 'Сначала откройте сайт как установленное приложение, затем включите push.',
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
    try {
      const permission =
        Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()

      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'ready')
        if (!silent) {
          showNotice(
            permission === 'denied'
              ? 'Push отключены в настройках браузера. Разрешите уведомления для MalinkiEco и попробуйте снова.'
              : 'Разрешение на push не выдано.',
          )
        }
        return
      }

      const subscription = await subscribeToWebPush()
      await saveWebPushSubscription(db, profile, subscription)
      setStatus('enabled')
      if (!silent) {
        showNotice('Push для веб-версии включены. На iPhone уведомления будут приходить из установленного приложения.')
      }
    } catch (error) {
      setStatus(resolveWebPushSupportState())
      if (!silent) {
        showNotice(humanizeError(error))
      }
    } finally {
      setBusy(false)
    }
  }, [profile, showNotice])

  const disable = useCallback(async () => {
    if (!db) return
    setBusy(true)
    try {
      await disableStoredWebPushSubscription(db)
      setStatus('ready')
      showNotice('Push для веб-версии отключены.')
    } catch (error) {
      showNotice(humanizeError(error))
    } finally {
      setBusy(false)
    }
  }, [showNotice])

  const unbindBeforeLogout = useCallback(async () => {
    if (!db) return

    try {
      const subscription = await getCurrentPushSubscription()
      await removeStoredWebPushSubscription(db, subscription)
    } catch {
      // We deliberately ignore logout cleanup errors so the user isn't blocked from exiting.
    }
  }, [])

  const handleAction = useCallback(async () => {
    if (busy) return

    if (status === 'enabled') {
      await disable()
      return
    }

    await enable()
  }, [busy, disable, enable, status])

  useEffect(() => {
    if (!profile || busy || status !== 'ready' || !isStandaloneDisplayMode()) {
      return
    }

    if (sessionStorage.getItem(AUTO_PROMPT_SESSION_KEY) === '1') {
      return
    }

    const handleFirstGesture = () => {
      sessionStorage.setItem(AUTO_PROMPT_SESSION_KEY, '1')
      void enable({ silent: true })
      window.removeEventListener('pointerdown', handleFirstGesture)
      window.removeEventListener('keydown', handleFirstGesture)
    }

    window.addEventListener('pointerdown', handleFirstGesture, { once: true })
    window.addEventListener('keydown', handleFirstGesture, { once: true })

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture)
      window.removeEventListener('keydown', handleFirstGesture)
    }
  }, [busy, enable, profile, status])

  const presentation = useMemo<WebPushPresentation>(() => {
    switch (status) {
      case 'enabled':
        return {
          title: 'Push включены',
          description: 'Чат, события и платежи будут приходить в установленную веб-версию как обычные push.',
          actionLabel: busy ? 'Сохраняем...' : 'Отключить',
        }
      case 'install-required':
        return {
          title: 'Добавьте на экран Домой',
          description: 'На iPhone web push работают после установки MalinkiEco на домашний экран.',
          actionLabel: 'Как включить',
        }
      case 'blocked':
        return {
          title: 'Push заблокированы',
          description: 'Разрешите уведомления в настройках Safari/браузера, и мы снова сможем их включить.',
          actionLabel: 'Подсказка',
        }
      case 'ready':
        return {
          title: 'Push готовы',
          description: 'Можно включить push для установленной веб-версии. Без установки на экран останется email.',
          actionLabel: busy ? 'Подключаем...' : 'Включить push',
        }
      default:
        return {
          title: 'Push недоступны',
          description: 'Для этого устройства останется текущая схема с email-уведомлениями.',
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
