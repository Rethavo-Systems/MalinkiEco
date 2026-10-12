// The function proxy returns binary responses as base64 in a JSON envelope.
// Keep larger files on the streaming Worker endpoints to avoid its payload limit.
const FUNCTION_DOWNLOAD_MAX_BYTES = 3 * 1024 * 1024

export function fileDownloadCandidates(candidates: string[], size: number) {
  return candidates.filter((baseUrl) => {
    if (Number.isFinite(size) && size > 0 && size <= FUNCTION_DOWNLOAD_MAX_BYTES) return true
    try {
      return new URL(baseUrl).hostname !== 'functions.yandexcloud.net'
    } catch {
      return true
    }
  })
}

export async function downloadWithFallback(
  getDirectUrl: () => Promise<string>,
  getProxiedFile: () => Promise<Response>,
  timeoutMs = 15_000,
): Promise<Blob> {
  try {
    const url = await getDirectUrl()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(`Storage download failed: ${response.status}`)
      // Keep the timeout active until the body has finished downloading too.
      return await response.blob()
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Direct storage requests may fail due to CORS or network restrictions.
    // The existing authenticated file route supplies CORS headers itself.
    const response = await getProxiedFile()
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error || 'Не удалось скачать файл. Попробуйте ещё раз.')
    }
    return response.blob()
  }
}
