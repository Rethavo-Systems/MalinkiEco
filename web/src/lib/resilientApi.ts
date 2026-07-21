type ApiEndpointConfig = {
  cacheKey: string
  candidates: string[]
  healthPath: string
}

type ResilientFetchOptions = {
  retryOnNetworkError?: boolean
  timeoutMs?: number
}

const HEALTH_CHECK_TIMEOUT_MS = 7_000
const HEALTH_CHECK_HEDGE_DELAY_MS = 600
const selectedEndpoints = new Map<string, string>()

let networkListenersInstalled = false

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function buildEndpointUrl(baseUrl: string, path: string) {
  if (baseUrl.includes('functions.yandexcloud.net/')) {
    const url = new URL(baseUrl)
    url.searchParams.set('path', path)
    return url.toString()
  }

  return `${baseUrl}${path}`
}

function buildEndpointRequestInit(baseUrl: string, init: RequestInit) {
  if (!baseUrl.includes('functions.yandexcloud.net/')) {
    return init
  }

  const headers = new Headers(init.headers)
  const authorization = headers.get('Authorization')
  if (authorization) {
    // Yandex Cloud reserves Authorization for its own IAM authentication.
    headers.delete('Authorization')
    headers.set('X-Firebase-Authorization', authorization)
  }

  return { ...init, headers }
}

function uniqueCandidates(candidates: string[]) {
  return [...new Set(candidates.map(normalizeBaseUrl).filter(Boolean))]
}

function clearSelectedEndpoints() {
  selectedEndpoints.clear()
}

function installNetworkListeners() {
  if (networkListenersInstalled || typeof window === 'undefined') {
    return
  }

  networkListenersInstalled = true
  window.addEventListener('online', clearSelectedEndpoints)
  window.addEventListener('offline', clearSelectedEndpoints)

  const connection = (navigator as Navigator & {
    connection?: EventTarget
  }).connection
  connection?.addEventListener('change', clearSelectedEndpoints)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return fetch(url, init)
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function probeEndpoint(baseUrl: string, healthPath: string) {
  const response = await fetchWithTimeout(
    buildEndpointUrl(baseUrl, healthPath),
    { method: 'GET', cache: 'no-store' },
    HEALTH_CHECK_TIMEOUT_MS,
  )

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null) as { ok?: boolean } | null
    : null

  if (!response.ok || payload?.ok !== true) {
    throw new Error(`Health check failed with status ${response.status}`)
  }

  return baseUrl
}

async function firstReachableEndpoint(candidates: string[], healthPath: string) {
  return new Promise<string>((resolve, reject) => {
    let nextIndex = 0
    let active = 0
    let settled = false
    let hedgeTimer = 0

    if (candidates.length === 0) {
      reject(new Error('API endpoints are not configured'))
      return
    }

    const launchNext = () => {
      if (settled || nextIndex >= candidates.length) {
        return
      }

      const candidate = candidates[nextIndex]
      nextIndex += 1
      active += 1

      if (nextIndex < candidates.length) {
        hedgeTimer = window.setTimeout(launchNext, HEALTH_CHECK_HEDGE_DELAY_MS)
      }

      probeEndpoint(candidate, healthPath).then(
        (baseUrl) => {
          if (!settled) {
            settled = true
            window.clearTimeout(hedgeTimer)
            resolve(baseUrl)
          }
        },
        () => {
          active -= 1
          if (settled) {
            return
          }

          if (nextIndex < candidates.length) {
            window.clearTimeout(hedgeTimer)
            launchNext()
          } else if (active === 0) {
            reject(new Error('No API endpoint is reachable'))
          }
        },
      )
    }

    launchNext()
  })
}

export async function resolveApiEndpoint(config: ApiEndpointConfig, excludedBaseUrl = '') {
  installNetworkListeners()

  const candidates = uniqueCandidates(config.candidates).filter(
    (candidate) => candidate !== normalizeBaseUrl(excludedBaseUrl),
  )
  const cached = selectedEndpoints.get(config.cacheKey)
  if (cached && candidates.includes(cached)) {
    return cached
  }

  const selected = await firstReachableEndpoint(candidates, config.healthPath)
  selectedEndpoints.set(config.cacheKey, selected)
  return selected
}

export function invalidateApiEndpoint(cacheKey: string) {
  selectedEndpoints.delete(cacheKey)
}

export async function resilientApiFetch(
  config: ApiEndpointConfig,
  path: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {},
) {
  const firstBaseUrl = await resolveApiEndpoint(config)

  try {
    const response = await fetchWithTimeout(
      buildEndpointUrl(firstBaseUrl, path),
      buildEndpointRequestInit(firstBaseUrl, init),
      options.timeoutMs ?? 0,
    )
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()

    // Mobile operators can return an HTML error page without rejecting fetch.
    // Retry those responses, but keep genuine JSON application errors intact.
    if (!response.ok && !contentType.includes('application/json')) {
      throw new Error(`Endpoint returned a non-API response: ${response.status}`)
    }

    return response
  } catch (error) {
    invalidateApiEndpoint(config.cacheKey)
    if (!options.retryOnNetworkError) {
      throw error
    }

    const fallbackBaseUrl = await resolveApiEndpoint(config, firstBaseUrl)
    return fetchWithTimeout(
      buildEndpointUrl(fallbackBaseUrl, path),
      buildEndpointRequestInit(fallbackBaseUrl, init),
      options.timeoutMs ?? 0,
    )
  }
}
