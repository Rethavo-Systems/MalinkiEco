import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBNg8PHZkoYWi23zuHITwfN2sNxClEVFeE',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'malinkiecodb.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'malinkiecodb',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'malinkiecodb.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '370105725452',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:370105725452:web:a372c85039226fba257429',
}

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

export const firebaseSetup = {
  ready: missing.length === 0,
  missing,
}

const app = firebaseSetup.ready ? initializeApp(firebaseConfig) : null

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
