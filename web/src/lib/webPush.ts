import { deleteDoc, doc, setDoc, type Firestore } from 'firebase/firestore'
import type { RemoteUser, TabKey } from '../types'

export const WEB_PUSH_SUBSCRIPTIONS_COLLECTION = 'web_push_subscriptions'
export const WEB_PUSH_PUBLIC_KEY =
  import.meta.env?.VITE_WEB_PUSH_PUBLIC_KEY ??
  'BFGwSO5v21t0C9G9_ho1liQlXFwhJdXSks5cIzlXUemeieeBDIhcxVNi-Bab3v5jYlqiKpcL2PsdUzjbjGakuTE'

const WEB_PUSH_SERVICE_WORKER_URL = '/sw.js'
const WEB_PUSH_SCOPE = '/'

export type WebPushSupportState =
  | 'unsupported'
  | 'install-required'
  | 'blocked'
  | 'ready'
  | 'enabled'
  | 'error'
  | 'checking'

let serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

export function isAndroidMobileDevice(): boolean {
  if (!hasWindow()) return false
  return /android/i.test(window.navigator.userAgent ?? '')
}

export function isYandexBrowser(): boolean {
  if (!hasWindow()) return false
  return /yabrowser/i.test(window.navigator.userAgent ?? '')
}

export function isAppleMobileDevice(): boolean {
  if (!hasWindow()) return false
  const platform = window.navigator.platform ?? ''
  const userAgent = window.navigator.userAgent ?? ''
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

export function isMobileDevice(): boolean {
  return isAppleMobileDevice() || isAndroidMobileDevice()
}

export function isStandaloneDisplayMode(): boolean {
  if (!hasWindow()) return false
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return navigatorWithStandalone.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function resolveWebPushSupportState(): WebPushSupportState {
  if (!hasWindow()) return 'unsupported'

  if (isAppleMobileDevice() && !isStandaloneDisplayMode()) {
    return 'install-required'
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }

  if (Notification.permission === 'denied') {
    return 'blocked'
  }

  return Notification.permission === 'granted' ? 'enabled' : 'ready'
}

export function shouldAutoEnableWebPush(): boolean {
  if (!hasWindow()) return false
  if (isStandaloneDisplayMode()) return true
  return isAndroidMobileDevice() && isYandexBrowser()
}

export async function ensureWebPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Этот браузер не поддерживает service worker.')
  }

  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker
      .register(WEB_PUSH_SERVICE_WORKER_URL, {
        scope: WEB_PUSH_SCOPE,
      })
      .then(registration => {
        if (registration.active) return registration
        return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Не удалось запустить уведомления. Повторите подключение.')), 15000)
          navigator.serviceWorker.ready.then(ready => { clearTimeout(timer); resolve(ready) }, error => { clearTimeout(timer); reject(error) })
        })
      })
      .catch((error) => {
        serviceWorkerRegistrationPromise = null
        throw error
      })
  }

  return serviceWorkerRegistrationPromise
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const encoded = atob(`${normalized}${padding}`)
  const bytes = Uint8Array.from(encoded, (character) => character.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function createEndpointHash(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  return btoa(value).replace(/[^a-zA-Z0-9]/g, '').slice(0, 64)
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await ensureWebPushServiceWorker()
  return registration.pushManager.getSubscription()
}

export async function subscribeToWebPush(): Promise<PushSubscription> {
  const registration = await ensureWebPushServiceWorker()
  const existingSubscription = await registration.pushManager.getSubscription()
  if (existingSubscription) {
    return existingSubscription
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToArrayBuffer(WEB_PUSH_PUBLIC_KEY),
  })
}

export async function createSubscriptionDocumentId(subscription: PushSubscription): Promise<string> {
  return createEndpointHash(subscription.endpoint)
}

export async function saveWebPushSubscription(
  firestore: Firestore,
  profile: Pick<RemoteUser, 'id'>,
  subscription: PushSubscription,
): Promise<string> {
  const payload = subscription.toJSON()
  if (!payload.keys?.p256dh || !payload.keys?.auth) throw new Error('Браузер вернул неполную подписку. Повторите подключение.')
  const documentId = await createSubscriptionDocumentId(subscription)
  const timestamp = Date.now()

  await setDoc(
    doc(firestore, WEB_PUSH_SUBSCRIPTIONS_COLLECTION, documentId),
    {
      userId: profile.id,
      endpoint: subscription.endpoint,
      p256dhKey: payload.keys?.p256dh ?? '',
      authKey: payload.keys?.auth ?? '',
      expirationTime: Number(payload.expirationTime ?? 0),
      platform: 'web',
      appMode: isStandaloneDisplayMode() ? 'standalone' : 'browser',
      userAgent: navigator.userAgent,
      createdAtClient: timestamp,
      updatedAtClient: timestamp,
    },
    { merge: true },
  )

  return documentId
}

export async function removeStoredWebPushSubscription(
  firestore: Firestore,
  subscription: PushSubscription | null,
): Promise<void> {
  if (!subscription) return
  const documentId = await createSubscriptionDocumentId(subscription)
  await deleteDoc(doc(firestore, WEB_PUSH_SUBSCRIPTIONS_COLLECTION, documentId))
}

export async function disableStoredWebPushSubscription(firestore: Firestore): Promise<boolean> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return true
  // Either operation stops delivery. Attempt both even when the server or browser fails.
  const results = await Promise.allSettled([
    removeStoredWebPushSubscription(firestore, subscription),
    subscription.unsubscribe(),
  ])
  if (results.every(result => result.status === 'rejected')) throw new Error('Не удалось отключить уведомления. Проверьте интернет и повторите попытку.')
  return results.every(result => result.status === 'fulfilled')
}

export function tabForNotificationDestination(destination: string): TabKey {
  switch ((destination || '').trim()) {
    case 'chat':
      return 'chat'
    case 'polls':
      return 'polls'
    case 'payments':
      return 'payments'
    case 'owners':
      return 'owners'
    case 'logs':
      return 'logs'
    default:
      return 'events'
  }
}

export function readRequestedTabFromUrl(): TabKey | null {
  if (!hasWindow()) return null

  const url = new URL(window.location.href)
  const openTab = url.searchParams.get('openTab')
  if (!openTab) return null
  return tabForNotificationDestination(openTab)
}

export function clearRequestedTabFromUrl(): void {
  if (!hasWindow()) return

  const url = new URL(window.location.href)
  if (!url.searchParams.has('openTab')) {
    return
  }

  url.searchParams.delete('openTab')
  const nextUrl = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', nextUrl || '/')
}
