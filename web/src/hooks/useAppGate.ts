import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db, firebaseSetup } from '../lib/firebase'

type AppGateState = {
  loading: boolean
  maintenanceEnabled: boolean
  maintenanceTitle: string
  maintenanceMessage: string
}

const DEFAULT_STATE: AppGateState = {
  loading: true,
  maintenanceEnabled: false,
  maintenanceTitle: 'Идут технические работы',
  maintenanceMessage: 'Сайт временно недоступен. Попробуйте зайти немного позже.',
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
        })
      },
      () => {
        setState((current) => ({ ...current, loading: false }))
      },
    )
  }, [])

  return state
}
