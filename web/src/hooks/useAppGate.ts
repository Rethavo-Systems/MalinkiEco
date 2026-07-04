import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db, firebaseSetup } from '../lib/firebase'

type AppGateState = {
  loading: boolean
  maintenanceEnabled: boolean
  maintenanceTitle: string
  maintenanceMessage: string
  maintenanceEndsAtClient: number
  errorEnabled: boolean
  errorTitle: string
  errorMessage: string
  errorEndsAtClient: number
}

const DEFAULT_STATE: AppGateState = {
  loading: true,
  maintenanceEnabled: false,
  maintenanceTitle: 'Идут технические работы',
  maintenanceMessage: 'Сайт временно недоступен. Попробуйте зайти немного позже.',
  maintenanceEndsAtClient: 0,
  errorEnabled: false,
  errorTitle: 'Наблюдается технический сбой',
  errorMessage: 'Сайт временно недоступен. Мы уже разбираемся и скоро восстановим работу.',
  errorEndsAtClient: 0,
}

function parseDateTimeClient(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; toMillis?: unknown }
    if (typeof timestamp.toMillis === 'function') {
      const millis = timestamp.toMillis()
      return typeof millis === 'number' && Number.isFinite(millis) ? millis : 0
    }
    if (typeof timestamp.seconds === 'number' && Number.isFinite(timestamp.seconds)) {
      return timestamp.seconds * 1000
    }
  }

  return 0
}

export function useAppGate(): AppGateState {
  const [state, setState] = useState<AppGateState>(DEFAULT_STATE)

  useEffect(() => {
    if (!firebaseSetup.ready || !db) {
      setState((current) => ({ ...current, loading: false }))
      return
    }

    return onSnapshot(
      doc(db, 'app_settings', 'app_gate'),
      (snapshot) => {
        const data = snapshot.data() ?? {}
        setState({
          loading: false,
          maintenanceEnabled: Boolean(data.maintenanceEnabled ?? false),
          maintenanceTitle: String(data.maintenanceTitle ?? '').trim() || DEFAULT_STATE.maintenanceTitle,
          maintenanceMessage: String(data.maintenanceMessage ?? '').trim() || DEFAULT_STATE.maintenanceMessage,
          maintenanceEndsAtClient: parseDateTimeClient(data.maintenanceEndsAt ?? data.maintenanceEndsAtClient),
          errorEnabled: Boolean(data.errorEnabled ?? false),
          errorTitle: String(data.errorTitle ?? '').trim() || DEFAULT_STATE.errorTitle,
          errorMessage: String(data.errorMessage ?? '').trim() || DEFAULT_STATE.errorMessage,
          errorEndsAtClient: parseDateTimeClient(data.errorEndsAt ?? data.errorEndsAtClient),
        })
      },
      () => {
        setState((current) => ({ ...current, loading: false }))
      },
    )
  }, [])

  return state
}
