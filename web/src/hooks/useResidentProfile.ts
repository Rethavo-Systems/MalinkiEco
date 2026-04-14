import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db, firebaseSetup } from '../lib/firebase'
import type { RemoteUser } from '../types'
import { toRemoteUser } from '../utils'

type UseResidentProfileOptions = {
  authUser: User | null
  onMissingProfile: (userId: string) => void | Promise<void>
}

export function useResidentProfile({ authUser, onMissingProfile }: UseResidentProfileOptions) {
  const [profile, setProfile] = useState<RemoteUser | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    if (!firebaseSetup.ready || !db || !authUser) {
      setProfile(null)
      return
    }

    setProfileLoading(true)
    return onSnapshot(doc(db, 'users', authUser.uid), (snapshot) => {
      if (!snapshot.exists()) {
        setProfile(null)
        setProfileLoading(false)
        void onMissingProfile(authUser.uid)
        return
      }

      setProfile(toRemoteUser(snapshot.id, snapshot.data()) ?? null)
      setProfileLoading(false)
    })
  }, [authUser, onMissingProfile])

  return { profile, profileLoading, setProfile }
}
