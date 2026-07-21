'use strict'

const DEFAULT_GATE_UPSTREAM = 'https://malinkieco-gate.kiriklass228.workers.dev'
const DEFAULT_CHAT_UPSTREAM = 'https://malinkieco-chat-files.kiriklass228.workers.dev'
const DEFAULT_ALLOWED_ORIGINS = [
  'https://malinkieco.rethavo.ru',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]
const MAX_PROXY_BODY_BYTES = 1_048_576
const UPSTREAM_TIMEOUT_MS = 10_000

module.exports.handler = async function handler(event) {
  const method = String(event?.httpMethod || event?.requestContext?.http?.method || 'GET').toUpperCase()
  const path = requestPath(event)
  const origin = requestHeader(event, 'origin')

  if (!isAllowedPath(path)) {
    return jsonResponse(404, { ok: false, error: 'Маршрут не найден.' }, origin)
  }

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: '',
    }
  }

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(403, { ok: false, error: 'Источник запроса не разрешен.' }, origin)
  }

  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return jsonResponse(405, { ok: false, error: 'Метод запроса не разрешен.' }, origin)
  }

  const body = method === 'GET' ? undefined : requestBody(event)
  if (body && Buffer.byteLength(body) > MAX_PROXY_BODY_BYTES) {
    return jsonResponse(413, { ok: false, error: 'Запрос слишком большой.' }, origin)
  }

  const upstreamBase = path.startsWith('/api/gate/')
    ? process.env.UPSTREAM_GATE_URL || DEFAULT_GATE_UPSTREAM
    : process.env.UPSTREAM_CHAT_URL || DEFAULT_CHAT_UPSTREAM
  const upstreamUrl = `${String(upstreamBase).replace(/\/$/, '')}${path}${requestQuery(event)}`

  try {
    const headers = new Headers()
    copyRequestHeader(event, headers, 'x-firebase-authorization', 'authorization')
    if (!headers.has('authorization')) {
      copyRequestHeader(event, headers, 'authorization')
    }
    copyRequestHeader(event, headers, 'content-type')
    copyRequestHeader(event, headers, 'origin')
    headers.set('X-Malinki-Proxy', 'yandex-cloud')

    const response = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    const responseHeaders = Object.fromEntries(response.headers.entries())
    ;[
      'content-length',
      'content-encoding',
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-max-age',
      'vary',
    ].forEach((header) => delete responseHeaders[header])
    Object.assign(responseHeaders, corsHeaders(origin))

    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    const isTextResponse = contentType.includes('application/json') || contentType.startsWith('text/')
    const responseBody = Buffer.from(await response.arrayBuffer())

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: isTextResponse ? responseBody.toString('utf8') : responseBody.toString('base64'),
      isBase64Encoded: !isTextResponse,
    }
  } catch (error) {
    console.error('[malinkieco-yandex-proxy] upstream failed', error)
    return jsonResponse(
      502,
      { ok: false, error: 'Резервный сервер временно не получил ответ. Повторите попытку.' },
      origin,
    )
  }
}

function isAllowedPath(path) {
  return path.startsWith('/api/gate/') || path.startsWith('/api/chat/')
}

function requestPath(event) {
  const queryPath = event?.queryStringParameters?.path
  if (typeof queryPath === 'string' && queryPath.startsWith('/')) {
    return queryPath
  }

  const rawPath = String(event?.path || event?.rawPath || '')
  if (rawPath.startsWith('/')) return rawPath

  const rawUrl = String(event?.url || '')
  if (rawUrl) {
    try {
      return new URL(rawUrl, 'https://function.local').pathname
    } catch {
      return '/'
    }
  }
  return '/'
}

function requestQuery(event) {
  const rawQuery = String(event?.rawQueryString || '')
  if (rawQuery) return `?${rawQuery}`

  const params = event?.queryStringParameters
  if (!params || typeof params !== 'object') return ''
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (key === 'path') return
    if (value !== null && typeof value !== 'undefined') query.set(key, String(value))
  })
  const value = query.toString()
  return value ? `?${value}` : ''
}

function requestBody(event) {
  const body = String(event?.body || '')
  return event?.isBase64Encoded ? Buffer.from(body, 'base64') : body
}

function requestHeaders(event) {
  return event?.headers && typeof event.headers === 'object' ? event.headers : {}
}

function requestHeader(event, name) {
  const headers = requestHeaders(event)
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  return found ? String(headers[found] || '') : ''
}

function copyRequestHeader(event, target, name, targetName = name) {
  const value = requestHeader(event, name)
  if (value) target.set(targetName, value)
}

function allowedOrigins() {
  return String(process.env.APP_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function isAllowedOrigin(origin) {
  return allowedOrigins().includes(origin)
}

function corsHeaders(origin) {
  const allowed = allowedOrigins()
  const selectedOrigin = allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': selectedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(statusCode, payload, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  }
}
