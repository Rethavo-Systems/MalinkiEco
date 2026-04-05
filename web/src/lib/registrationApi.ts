import { getApps, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type UserCredential,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import type { AuthFormState } from '../types'
import { enqueueEmailNotification } from './appApi'
import { auth, db, firebaseConfig, firebaseSetup } from './firebase'
import { isValidRussianPhoneInput, normalizeAuthEmail, normalizeRussianPhone, parsePlots } from '../utils'

const REGISTRATION_AUTH_APP_NAME = 'malinkieco-registration'
const VERIFICATION_TTL_MS = 10 * 60 * 1000

const registrationApp =
  firebaseSetup.ready
    ? getApps().find((item) => item.name === REGISTRATION_AUTH_APP_NAME) ??
      initializeApp(firebaseConfig, REGISTRATION_AUTH_APP_NAME)
    : null

const registrationAuth = registrationApp ? getAuth(registrationApp) : null

function ensureFirebaseReady() {
  if (!firebaseSetup.ready || !db || !registrationAuth || !auth) {
    throw new Error('Firebase еще не готов. Обновите страницу и попробуйте снова.')
  }

  return { db, registrationAuth }
}

function extractFirebaseErrorCode(error: unknown) {
  const value = error as { code?: string; message?: string }
  return String(value?.code ?? value?.message ?? '')
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function readRegistrationState(userId: string) {
  const { db } = ensureFirebaseReady()
  const [profileSnapshot, requestSnapshot] = await Promise.all([
    getDoc(doc(db, 'users', userId)),
    getDoc(doc(db, 'registration_requests', userId)),
  ])

  const requestData = requestSnapshot.exists() ? requestSnapshot.data() : null

  return {
    hasProfile: profileSnapshot.exists(),
    requestExists: requestSnapshot.exists(),
    requestStatus: String(requestData?.status ?? ''),
    requestData,
  }
}

async function ensureRegistrationUser(email: string, password: string): Promise<UserCredential> {
  const { registrationAuth } = ensureFirebaseReady()
  const normalizedEmail = normalizeAuthEmail(email)

  try {
    return await signInWithEmailAndPassword(registrationAuth, normalizedEmail, password)
  } catch (signInError) {
    const signInCode = extractFirebaseErrorCode(signInError)
    const canCreateNewUser =
      signInCode.includes('auth/invalid-credential') ||
      signInCode.includes('auth/invalid-login-credentials') ||
      signInCode.includes('auth/user-not-found')

    if (!canCreateNewUser) {
      throw signInError
    }

    try {
      return await createUserWithEmailAndPassword(registrationAuth, normalizedEmail, password)
    } catch (createError) {
      const createCode = extractFirebaseErrorCode(createError)
      if (createCode.includes('auth/email-already-in-use')) {
        throw new Error('Для этой почты уже создан аккаунт. Введите правильный пароль или используйте вход.')
      }
      throw createError
    }
  }
}

export async function requestRegistrationEmailCode(email: string, password: string) {
  const { db, registrationAuth } = ensureFirebaseReady()

  if (password.trim().length < 6) {
    throw new Error('Пароль должен быть не короче 6 символов.')
  }

  const credential = await ensureRegistrationUser(email, password)

  try {
    const state = await readRegistrationState(credential.user.uid)
    if (state.hasProfile) {
      throw new Error('Аккаунт уже одобрен. Используйте вход.')
    }
    if (state.requestStatus === 'PENDING') {
      throw new Error('Заявка уже передана модераторам. Дождитесь одобрения.')
    }

    const verificationCode = createVerificationCode()
    const verificationCodeHash = await sha256Hex(verificationCode)
    const createdAtClient = Date.now()

    await setDoc(
      doc(db, 'registration_requests', credential.user.uid),
      {
        login: normalizeAuthEmail(email),
        authEmail: normalizeAuthEmail(email),
        fullName: '',
        phone: '',
        plots: [],
        status: 'VERIFYING',
        verificationCodeHash,
        verificationExpiresAtClient: createdAtClient + VERIFICATION_TTL_MS,
        verificationVerifiedAtClient: 0,
        reviewedById: '',
        reviewedByName: '',
        reviewReason: '',
        createdAt: serverTimestamp(),
        createdAtClient,
      },
      { merge: true },
    )

    await enqueueEmailNotification(db, {
      title: 'Код подтверждения MalinkiEco',
      body: [
        'Здравствуйте!',
        '',
        `Ваш код подтверждения: ${verificationCode}`,
        '',
        'Введите этот код в окне регистрации MalinkiEco.',
        'Код действует 10 минут.',
      ].join('\n'),
      destination: 'auth',
      category: 'verification',
      emailTargets: [normalizeAuthEmail(email)],
      sendEmail: true,
      sendPush: false,
    })
  } finally {
    await signOut(registrationAuth)
  }

  return { ok: true as const }
}

export async function verifyRegistrationEmailCode(email: string, password: string, verificationCode: string) {
  const { db, registrationAuth } = ensureFirebaseReady()
  const normalizedCode = verificationCode.trim()
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error('Введите 6 цифр из письма.')
  }

  const credential = await signInWithEmailAndPassword(registrationAuth, normalizeAuthEmail(email), password)

  try {
    const state = await readRegistrationState(credential.user.uid)
    if (state.hasProfile) {
      throw new Error('Аккаунт уже одобрен. Используйте вход.')
    }
    if (!state.requestExists || state.requestStatus !== 'VERIFYING') {
      throw new Error('Сначала запросите код подтверждения на электронную почту.')
    }

    const expiresAtClient = Number(state.requestData?.verificationExpiresAtClient ?? 0)
    if (!expiresAtClient || expiresAtClient < Date.now()) {
      throw new Error('Срок действия кода истек. Запросите новый код.')
    }

    const expectedHash = String(state.requestData?.verificationCodeHash ?? '')
    const actualHash = await sha256Hex(normalizedCode)
    if (!expectedHash || expectedHash !== actualHash) {
      throw new Error('Неверный код подтверждения. Проверьте письмо и попробуйте снова.')
    }

    await updateDoc(doc(db, 'registration_requests', credential.user.uid), {
      status: 'VERIFIED',
      verificationCodeHash: '',
      verificationVerifiedAtClient: Date.now(),
    })

    return { ok: true as const, registerToken: credential.user.uid }
  } finally {
    await signOut(registrationAuth)
  }
}

export async function submitVerifiedRegistration(form: AuthFormState, registerToken: string) {
  const { db, registrationAuth } = ensureFirebaseReady()
  const email = normalizeAuthEmail(form.login.trim())
  const fullName = form.fullName.trim()
  const phone = normalizeRussianPhone(form.phone)
  const plots = parsePlots(form.plots)

  if (!fullName) {
    throw new Error('Введите отображаемое имя.')
  }
  if (!isValidRussianPhoneInput(form.phone)) {
    throw new Error('Номер телефона должен содержать 10 цифр после 8.')
  }
  if (plots.length === 0) {
    throw new Error('Укажите хотя бы один участок.')
  }

  const credential = await signInWithEmailAndPassword(registrationAuth, email, form.password)

  try {
    if (registerToken && registerToken !== credential.user.uid) {
      throw new Error('Подтвердите электронную почту заново и попробуйте еще раз.')
    }

    const state = await readRegistrationState(credential.user.uid)
    if (state.hasProfile) {
      throw new Error('Аккаунт уже одобрен. Используйте вход.')
    }
    if (state.requestStatus === 'PENDING') {
      throw new Error('Заявка уже передана модераторам. Дождитесь одобрения.')
    }
    if (state.requestStatus !== 'VERIFIED') {
      throw new Error('Сначала подтвердите электронную почту кодом из письма.')
    }

    await setDoc(
      doc(db, 'registration_requests', credential.user.uid),
      {
        login: form.login.trim(),
        authEmail: email,
        fullName,
        phone,
        plots,
        status: 'PENDING',
        reviewedById: '',
        reviewedByName: '',
        reviewReason: '',
        verificationCodeHash: '',
        verificationExpiresAtClient: 0,
        createdAt: serverTimestamp(),
        createdAtClient: Date.now(),
      },
      { merge: true },
    )
  } finally {
    await signOut(registrationAuth)
  }

  return { ok: true as const }
}
