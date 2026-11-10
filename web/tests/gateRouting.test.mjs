import test from 'node:test'
import assert from 'node:assert/strict'
import { resilientApiFetch } from '../src/lib/resilientApi.ts'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
globalThis.window = { setTimeout, clearTimeout, addEventListener() {} }
test.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })

const candidates = ['https://functions.yandexcloud.net/gate', 'https://gate.example.test']
const config = key => ({ cacheKey: key, candidates, healthPath: '/api/gate/health' })
const json = (payload, status = 200) => Response.json(payload, { status })
const statusOptions = { retryOnNetworkError: true, retryOnStatuses: [404] }

function mockEndpoints(respond) {
  const requests = []
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.searchParams.get('path') || parsed.pathname
    const host = parsed.hostname
    if (path === '/api/gate/health') return json({ ok: true })
    requests.push({ host, path, init })
    return respond(host, path, init)
  }
  return requests
}

test('status falls through an older JSON 404 and caches the supporting endpoint independently of opening', async () => {
  const requests = mockEndpoints((host, path) => host === 'functions.yandexcloud.net' && path.endsWith('/status')
    ? json({ ok: false }, 404) : json({ ok: true, available: true }))
  const statusConfig = config('status-capability')
  const response = await resilientApiFetch(statusConfig, '/api/gate/status', {}, statusOptions)
  assert.equal((await response.json()).available, true)
  await resilientApiFetch(statusConfig, '/api/gate/status', {}, statusOptions)
  await resilientApiFetch(config('open-independent'), '/api/gate/open', { method: 'POST' }, { retryOnNetworkError: false })
  assert.deepEqual(requests.map(({ host, path }) => [host, path]), [
    ['functions.yandexcloud.net', '/api/gate/status'],
    ['gate.example.test', '/api/gate/status'],
    ['gate.example.test', '/api/gate/status'],
    ['functions.yandexcloud.net', '/api/gate/open'],
  ])
})

test('unsupported status on all servers returns 404 without looping', async () => {
  const requests = mockEndpoints(() => json({ ok: false }, 404))
  const response = await resilientApiFetch(config('status-unsupported'), '/api/gate/status', {}, statusOptions)
  assert.equal(response.status, 404)
  assert.equal(requests.length, 2)
})

test('an unreachable newer status route preserves the older service response', async () => {
  const requests = mockEndpoints(host => {
    if (host === 'functions.yandexcloud.net') return json({ ok: false }, 404)
    throw new TypeError('Network unavailable')
  })
  const response = await resilientApiFetch(config('status-unreachable'), '/api/gate/status', {}, statusOptions)
  assert.equal(response.status, 404)
  assert.equal(requests.length, 2)
})

test('a genuine authorization error does not fall through to another server', async () => {
  const requests = mockEndpoints(() => json({ ok: false }, 403))
  const response = await resilientApiFetch(config('status-forbidden'), '/api/gate/status', {}, statusOptions)
  assert.equal(response.status, 403)
  assert.equal(requests.length, 1)
})

test('an ambiguous failed opening is never sent to a second server', async () => {
  const requests = mockEndpoints(() => { throw new TypeError('Response lost after sending command') })
  await assert.rejects(resilientApiFetch(config('open-no-retry'), '/api/gate/open', { method: 'POST' }, { retryOnNetworkError: false }))
  assert.equal(requests.length, 1)
})
