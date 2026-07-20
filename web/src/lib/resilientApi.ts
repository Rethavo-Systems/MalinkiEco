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
const selectedEndpoints = new Map<string, string>()

let networkListenersInstalled = false

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/$/, '')
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
    `${baseUrl}${healthPath}`,
    { method: 'GET', cache: 'no-store' },
    HEALTH_CHECK_TIMEOUT_MS,
  )

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`)
  }

  return baseUrl
}

async function firstReachableEndpoint(candidates: string[], healthPath: string) {
  return new Promise<string>((resolve, reject) => {
    let pending = candidates.length
    let settled = false

    if (pending === 0) {
      reject(new Error('API endpoints are not configured'))
      return
    }

    for (const candidate of candidates) {
      probeEndpoint(candidate, healthPath).then(
        (baseUrl) => {
          if (!settled) {
            settled = true
            resolve(baseUrl)
          }
        },
        () => {
          pending -= 1
          if (!settled && pending === 0) {
            reject(new Error('No API endpoint is reachable'))
          }
        },
      )
    }
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
    return await fetchWithTimeout(`${firstBaseUrl}${path}`, init, options.timeoutMs ?? 0)
  } catch (error) {
    invalidateApiEndpoint(config.cacheKey)
    if (!options.retryOnNetworkError) {
      throw error
    }

    const fallbackBaseUrl = await resolveApiEndpoint(config, firstBaseUrl)
    return fetchWithTimeout(`${fallbackBaseUrl}${path}`, init, options.timeoutMs ?? 0)
  }
}
