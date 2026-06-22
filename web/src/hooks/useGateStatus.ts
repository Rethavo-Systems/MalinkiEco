import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db, firebaseSetup } from '../lib/firebase'

export type GateStatus = {
  status: string
  cooldownUntilClient: number
  openingLockUntilClient: number
  lastOpenedAtClient: number
  lastOpenedById: string
  lastOpenedByName: string
}

const EMPTY_GATE_STATUS: GateStatus = {
  status: '',
  cooldownUntilClient: 0,
  openingLockUntilClient: 0,
  lastOpenedAtClient: 0,
  lastOpenedById: '',
  lastOpenedByName: '',
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
        status: String(data.status ?? ''),
        cooldownUntilClient: Number(data.cooldownUntilClient ?? 0),
        openingLockUntilClient: Number(data.openingLockUntilClient ?? 0),
        lastOpenedAtClient: Number(data.lastOpenedAtClient ?? 0),
        lastOpenedById: String(data.lastOpenedById ?? ''),
        lastOpenedByName: String(data.lastOpenedByName ?? ''),
      })
    })
  }, [enabled])

  return gateStatus
}
