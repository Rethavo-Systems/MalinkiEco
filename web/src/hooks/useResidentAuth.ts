import type { FormEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { INITIAL_AUTH_FORM } from '../constants'
import { auth, db, firebaseSetup } from '../lib/firebase'
import {
  requestRegistrationEmailCode,
  submitVerifiedRegistration,
  verifyRegistrationEmailCode,
} from '../lib/registrationApi'
import type { AuthFormState, AuthMode } from '../types'
import { humanizeError, isValidRussianPhoneInput, normalizeAuthEmail, parsePlots } from '../utils'

const PENDING_REGISTRATION_MESSAGE =
  'Заявка уже передана модераторам. Дождитесь одобрения и попробуйте войти снова.'
const SUBMITTED_REGISTRATION_MESSAGE =
  'Заявка передана модераторам. После одобрения вы сможете войти в систему.'
const REJECTED_REGISTRATION_FALLBACK =
  'Заявка на регистрацию была отклонена. Обратитесь к модератору или администратору.'
const REGISTRATION_REQUIRED_MESSAGE =
  'Для входа сначала нужно отправить заявку на регистрацию.'
const EMAIL_CODE_REQUIRED_MESSAGE =
  'Сначала подтвердите почту кодом из письма и только потом отправляйте заявку.'
const EMAIL_CODE_SENT_MESSAGE =
  'Письмо с кодом подтверждения отправлено на указанную электронную почту. Введите его ниже и подтвердите адрес.'
const EMAIL_CODE_VERIFIED_MESSAGE =
  'Код подтверждения принят. Теперь можно отправить заявку модераторам.'

export function useResidentAuth() {
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authForm, setAuthForm] = useState<AuthFormState>(INITIAL_AUTH_FORM)
  const [authError, setAuthError] = useState('')
  const [authSuccess, setAuthSuccess] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [verificationSending, setVerificationSending] = useState(false)
  const [verificationChecking, setVerificationChecking] = useState(false)
  const [verificationSentTo, setVerificationSentTo] = useState('')
  const [verificationApprovedFor, setVerificationApprovedFor] = useState('')
  const [registerToken, setRegisterToken] = useState('')

  const clearAuthMessages = useCallback(() => {
    setAuthError('')
    setAuthSuccess('')
  }, [])

  const resetVerificationState = useCallback(() => {
    setVerificationSentTo('')
    setVerificationApprovedFor('')
    setRegisterToken('')
    setAuthForm((current) => ({ ...current, verificationCode: '' }))
  }, [])

  const updateAuthField = useCallback(
    (field: keyof AuthFormState, value: string) => {
      setAuthForm((current) => {
        const next = { ...current, [field]: value }
        if (field === 'login' || field === 'password') {
          const normalizedValue = field === 'login' ? value.trim().toLowerCase() : value
          const sentMatches =
            field === 'login' ? normalizedValue === verificationSentTo : value === current.password
          if (!sentMatches) {
            next.verificationCode = field === 'login' ? '' : next.verificationCode
            setVerificationSentTo('')
            setVerificationApprovedFor('')
            setRegisterToken('')
          }
        }
        return next
      })
    },
    [verificationSentTo],
  )

  const switchAuthMode = useCallback(
    (mode: AuthMode) => {
      setAuthMode(mode)
      clearAuthMessages()
      if (mode === 'register') {
        resetVerificationState()
      }
    },
    [clearAuthMessages, resetVerificationState],
  )

  const registrationEmail = useMemo(() => authForm.login.trim().toLowerCase(), [authForm.login])
  const isRegistrationEmailVerified =
    registrationEmail !== '' && verificationApprovedFor === registrationEmail && !!registerToken

  const handleMissingProfileAccess = useCallback(async (userId: string) => {
    if (!db || !auth) return

    const requestSnapshot = await getDoc(doc(db, 'registration_requests', userId))
    const requestData = requestSnapshot.exists() ? requestSnapshot.data() : null
    const requestStatus = String(requestData?.status ?? '')
    const reviewReason = String(requestData?.reviewReason ?? '').trim()

    setAuthMode('login')
    if (requestStatus === 'PENDING') {
      setAuthSuccess(PENDING_REGISTRATION_MESSAGE)
      setAuthError('')
    } else if (requestStatus === 'REJECTED') {
      setAuthSuccess('')
      setAuthError(
        reviewReason
          ? `Заявка отклонена. Причина: ${reviewReason}`
          : REJECTED_REGISTRATION_FALLBACK,
      )
    } else if (requestStatus === 'VERIFYING' || requestStatus === 'VERIFIED') {
      setAuthSuccess('')
      setAuthError(EMAIL_CODE_REQUIRED_MESSAGE)
    } else {
      setAuthSuccess('')
      setAuthError(REGISTRATION_REQUIRED_MESSAGE)
    }

    await signOut(auth)
  }, [])

  const validateRegistrationFormBase = useCallback((form: AuthFormState) => {
    if (!form.login.trim()) {
      return 'Укажите электронную почту.'
    }
    if (!form.login.includes('@')) {
      return 'Для регистрации в веб-версии укажите действующую электронную почту.'
    }
    if (!form.fullName.trim()) {
      return 'Введите отображаемое имя.'
    }
    if (form.password.trim().length < 6) {
      return 'Пароль должен быть не короче 6 символов.'
    }
    if (!form.phone.trim()) {
      return 'Введите номер телефона.'
    }
    if (!isValidRussianPhoneInput(form.phone)) {
      return 'Номер телефона должен содержать 10 цифр после 8.'
    }
    if (parsePlots(form.plots).length === 0) {
      return 'Укажите хотя бы один участок.'
    }
    return ''
  }, [])

  const validateRegistrationForm = useCallback(() => {
    const baseError = validateRegistrationFormBase(authForm)
    if (baseError) {
      return baseError
    }
    if (!verificationSentTo || verificationSentTo !== registrationEmail) {
      return 'Сначала отправьте письмо с кодом подтверждения.'
    }
    if (!authForm.verificationCode.trim()) {
      return 'Введите код подтверждения из письма.'
    }
    if (!isRegistrationEmailVerified) {
      return EMAIL_CODE_REQUIRED_MESSAGE
    }
    return ''
  }, [authForm, isRegistrationEmailVerified, registrationEmail, validateRegistrationFormBase, verificationSentTo])

  const requestEmailCode = useCallback(async () => {
    clearAuthMessages()
    const validationError = validateRegistrationFormBase(authForm)
    if (validationError) {
      setAuthError(validationError)
      return
    }

    setVerificationSending(true)
    try {
      await requestRegistrationEmailCode(authForm.login.trim(), authForm.password)
      setVerificationSentTo(registrationEmail)
      setVerificationApprovedFor('')
      setRegisterToken('')
      setAuthSuccess(EMAIL_CODE_SENT_MESSAGE)
    } catch (error) {
      setAuthError(humanizeError(error))
    } finally {
      setVerificationSending(false)
    }
  }, [authForm, clearAuthMessages, registrationEmail, validateRegistrationFormBase])

  const verifyEmailCode = useCallback(async () => {
    clearAuthMessages()

    if (!verificationSentTo || verificationSentTo !== registrationEmail) {
      setAuthError('Сначала отправьте письмо с кодом подтверждения.')
      return
    }

    if (!authForm.verificationCode.trim()) {
      setAuthError('Введите код подтверждения из письма.')
      return
    }

    setVerificationChecking(true)
    try {
      const result = await verifyRegistrationEmailCode(
        authForm.login.trim(),
        authForm.password,
        authForm.verificationCode,
      )
      setVerificationApprovedFor(registrationEmail)
      setRegisterToken(result.registerToken)
      setAuthSuccess(EMAIL_CODE_VERIFIED_MESSAGE)
    } catch (error) {
      setAuthError(humanizeError(error))
    } finally {
      setVerificationChecking(false)
    }
  }, [
    authForm.login,
    authForm.password,
    authForm.verificationCode,
    clearAuthMessages,
    registrationEmail,
    verificationSentTo,
  ])

  const handleAuthSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!firebaseSetup.ready || !auth || !db || authSubmitting) return

      clearAuthMessages()

      if (!authForm.login.trim()) {
        setAuthError(
          authMode === 'register' ? 'Укажите электронную почту.' : 'Введите логин или почту.',
        )
        return
      }
      if (!authForm.password.trim()) {
        setAuthError('Введите пароль.')
        return
      }

      if (authMode === 'register') {
        const validationError = validateRegistrationForm()
        if (validationError) {
          setAuthError(validationError)
          return
        }
      }

      setAuthSubmitting(true)

      try {
        if (authMode === 'login') {
          const credential = await signInWithEmailAndPassword(
            auth,
            normalizeAuthEmail(authForm.login.trim()),
            authForm.password,
          )
          const profileSnapshot = await getDoc(doc(db, 'users', credential.user.uid))
          if (!profileSnapshot.exists()) {
            await handleMissingProfileAccess(credential.user.uid)
            return
          }
          setAuthForm((current) => ({ ...current, password: '' }))
        } else {
          await submitVerifiedRegistration(authForm, registerToken)
          setAuthMode('login')
          setAuthForm({
            ...INITIAL_AUTH_FORM,
            login: authForm.login.trim(),
          })
          resetVerificationState()
          setAuthSuccess(SUBMITTED_REGISTRATION_MESSAGE)
        }
      } catch (error) {
        setAuthError(humanizeError(error))
      } finally {
        setAuthSubmitting(false)
      }
    },
    [
      authForm,
      authMode,
      authSubmitting,
      clearAuthMessages,
      handleMissingProfileAccess,
      registerToken,
      resetVerificationState,
      validateRegistrationForm,
    ],
  )

  return {
    authMode,
    authForm,
    authError,
    authSuccess,
    authSubmitting,
    verificationSending,
    verificationChecking,
    verificationSentTo,
    isRegistrationEmailVerified,
    updateAuthField,
    switchAuthMode,
    handleAuthSubmit,
    handleMissingProfileAccess,
    requestEmailCode,
    verifyEmailCode,
  }
}
