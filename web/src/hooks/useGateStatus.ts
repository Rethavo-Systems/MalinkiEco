import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db, firebaseSetup } from '../lib/firebase'

export type GateStatus = {
  cooldownUntilClient: number
  lastOpenedAtClient: number
  lastOpenedById: string
  lastOpenedByName: string
  status: string
}

const EMPTY_GATE_STATUS: GateStatus = {
  cooldownUntilClient: 0,
  lastOpenedAtClient: 0,
  lastOpenedById: '',
  lastOpenedByName: '',
  status: '',
}

export function useGateStatus(enabled: boolean) {
  const [gateStatus, setGateStatus] = useState<GateStatus>(EMPTY_GATE_STATUS)

  useEffect(() => {
    if (!enabled || !firebaseSetup.ready || !db) {
      setGateStatus(EMPTY_GATE_STATUS)
      return
    }

    return onSnapshot(doc(db, 'app_settings', 'gate_status'), (snapshot) => {
      if (!snapshot.exists()) {
        setGateStatus(EMPTY_GATE_STATUS)
        return
      }

      const data = snapshot.data()
      setGateStatus({
        cooldownUntilClient: Number(data.cooldownUntilClient ?? 0),
        lastOpenedAtClient: Number(data.lastOpenedAtClient ?? 0),
        lastOpenedById: String(data.lastOpenedById ?? ''),
        lastOpenedByName: String(data.lastOpenedByName ?? ''),
        status: String(data.status ?? ''),
      })
    })
  }, [enabled])

  return gateStatus
}
