import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import worker, { chatFileOwnershipDocumentPath } from './chat-files-worker.js'

const keys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
)
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'chat-isolated-test' }
const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
const env = {
  FIREBASE_PROJECT_ID: 'test', FIREBASE_CLIENT_EMAIL: 'test@example.test',
  FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`,
  CHAT_FILES_STORAGE_PROVIDER: 'yandex', YANDEX_DISK_TOKEN: 'isolated-test', FILE_TICKET_SECRET: 'isolated-test',
}

async function actorToken(actorId) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const signed = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ aud: 'test', iss: 'https://securetoken.google.com/test', sub: actorId, iat: now, exp: now + 600 })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signed))
  return `${signed}.${Buffer.from(signature).toString('base64url')}`
}

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value },
  ]))
}

async function withFixture(run) {
  const previousFetch = globalThis.fetch
  const previousError = console.error
  const registry = new Map()
  const fixture = { registry, deletes: [], storageCalls: 0, role: 'USER', flags: {}, failRegistry: false }
  const token = await actorToken('alice')
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    const method = init.method || 'GET'
    if (url.pathname.includes('/jwk/')) return Response.json({ keys: [jwk] })
    if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'isolated-test', expires_in: 600 })
    if (/\/users\/(alice|bob)$/.test(url.pathname)) return Response.json({ fields: fields({ role: fixture.role }) })
    if (url.pathname.endsWith('/app_settings/app_gate')) return Response.json({ fields: fields(fixture.flags) })
    if (url.hostname === 'firestore.googleapis.com' && url.pathname.endsWith('/chat_files') && method === 'POST') {
      if (fixture.failRegistry) return Response.json({ error: { message: 'Firestore temporarily unavailable' } }, { status: 503 })
      const path = `chat_files/${url.searchParams.get('documentId')}`
      if (registry.has(path)) return Response.json({ error: { message: 'Already exists' } }, { status: 409 })
      const data = JSON.parse(init.body)
      registry.set(path, data)
      return Response.json(data)
    }
    if (url.hostname === 'firestore.googleapis.com' && url.pathname.includes('/chat_files/')) {
      const path = `chat_files/${url.pathname.split('/').at(-1)}`
      return registry.has(path) ? Response.json(registry.get(path)) : Response.json({}, { status: 404 })
    }
    if (url.hostname === 'cloud-api.yandex.net') {
      fixture.storageCalls++
      if (method === 'DELETE') {
        const path = url.searchParams.get('path')
        if (fixture.deletes.includes(path)) return Response.json({}, { status: 404 })
        fixture.deletes.push(path)
        return new Response(null, { status: 204 })
      }
      if (method === 'PUT') return new Response(null, { status: 201 })
      if (url.pathname.endsWith('/resources/upload')) return Response.json({ href: 'https://upload.example.test/file', method: 'PUT' })
      if (url.pathname.endsWith('/resources')) return Response.json({ name: 'file.txt', size: 1, mime_type: 'text/plain' })
    }
    if (url.hostname === 'upload.example.test' && method === 'PUT') return new Response(null, { status: 201 })
    assert.fail(`Unexpected network request ${method} ${url.hostname}${url.pathname}`)
  }
  console.error = () => {}
  fixture.request = async (path, { actor = 'alice', method = 'POST', body } = {}) => worker.fetch(new Request(`https://chat.example.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${actor === 'alice' ? token : await actorToken(actor)}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  }), env)
  fixture.prepare = () => fixture.request('/api/chat/files/prepare', { body: { name: 'file.txt', size: 1, contentType: 'text/plain' } })
  try { await run(fixture) }
  finally { globalThis.fetch = previousFetch; console.error = previousError }
}

test('file registry key matches SHA256 of the exact UTF-8 storage key used by the legacy backfill', async () => {
  const key = 'chat-files/1799999999999-11111111-1111-1111-1111-111111111111-фото.jpg'
  assert.equal(await chatFileOwnershipDocumentPath(key), `chat_files/${createHash('sha256').update(key).digest('hex')}`)
})

test('prepare and complete retain immutable ownership for retries and reject another actor', () => withFixture(async fixture => {
  const prepared = await fixture.prepare()
  assert.equal(prepared.status, 200)
  const payload = await prepared.json()
  const ticket = JSON.parse(Buffer.from(payload.ticket.split('.')[0], 'base64url').toString())
  const path = await chatFileOwnershipDocumentPath(ticket.storageKey)
  assert.deepEqual(fixture.registry.get(path).fields, fields({ ownerId: 'alice', storageKey: ticket.storageKey, expiresAtClient: ticket.attachment.expiresAtClient }))
  for (let retry = 0; retry < 2; retry++) {
    const completed = await fixture.request('/api/chat/files/complete', { body: { ticket: payload.ticket } })
    assert.equal(completed.status, 200)
    assert.equal((await completed.json()).attachment.downloadPath, ticket.attachment.downloadPath)
  }
  const wrongActor = await fixture.request('/api/chat/files/complete', { actor: 'bob', body: { ticket: payload.ticket } })
  assert.equal(wrongActor.status, 403)
  assert.equal(fixture.registry.get(path).fields.ownerId.stringValue, 'alice')
}))

test('an in-flight signed upload from before deployment registers its owner at completion', () => withFixture(async fixture => {
  const payload = await (await fixture.prepare()).json()
  fixture.registry.clear()
  assert.equal((await fixture.request('/api/chat/files/complete', { body: { ticket: payload.ticket } })).status, 200)
  assert.equal(fixture.registry.size, 1)
}))

test('multipart upload also records the authenticated owner before writing the storage object', () => withFixture(async fixture => {
  const body = new FormData()
  body.append('file', new File(['x'], 'file.txt', { type: 'text/plain' }))
  const response = await fixture.request('/api/chat/files', { body })
  assert.equal(response.status, 200)
  const { attachment } = await response.json()
  const storageKey = `chat-files/${decodeURIComponent(attachment.downloadPath.split('/').at(-1))}`
  const stored = fixture.registry.get(await chatFileOwnershipDocumentPath(storageKey))
  assert.equal(stored.fields.ownerId.stringValue, 'alice')
}))

test('foreign, missing or inconsistent ownership denies deletion before any storage request', () => withFixture(async fixture => {
  const payload = await (await fixture.prepare()).json()
  const ticket = JSON.parse(Buffer.from(payload.ticket.split('.')[0], 'base64url').toString())
  const path = await chatFileOwnershipDocumentPath(ticket.storageKey)
  const storageCalls = fixture.storageCalls
  assert.equal((await fixture.request(ticket.attachment.downloadPath, { actor: 'bob', method: 'DELETE' })).status, 403)
  fixture.registry.get(path).fields.storageKey.stringValue = 'chat-files/different-object'
  assert.equal((await fixture.request(ticket.attachment.downloadPath, { method: 'DELETE' })).status, 403)
  fixture.registry.delete(path)
  assert.equal((await fixture.request(ticket.attachment.downloadPath, { method: 'DELETE' })).status, 403)
  assert.equal(fixture.deletes.length, 0)
  assert.equal(fixture.storageCalls, storageCalls)
}))

test('own deletion still works after its message has gone and a repeated deletion is harmless', () => withFixture(async fixture => {
  const payload = await (await fixture.prepare()).json()
  const ticket = JSON.parse(Buffer.from(payload.ticket.split('.')[0], 'base64url').toString())
  for (let retry = 0; retry < 2; retry++) assert.equal((await fixture.request(ticket.attachment.downloadPath, { method: 'DELETE' })).status, 200)
  assert.equal(fixture.deletes.length, 1)
  assert.equal(fixture.registry.size, 1)
}))

test('failed registry persistence never issues an upload URL or touches storage', () => withFixture(async fixture => {
  fixture.failRegistry = true
  assert.equal((await fixture.prepare()).status, 500)
  assert.equal(fixture.storageCalls, 0)
  assert.equal(fixture.registry.size, 0)
}))

test('both closure flags stop ordinary users while ADMIN and TESTER retain file access', () => withFixture(async fixture => {
  for (fixture.role of ['USER', 'MODERATOR']) {
    for (fixture.flags of [{ maintenanceEnabled: true }, { errorEnabled: true }]) assert.equal((await fixture.prepare()).status, 503)
  }
  assert.equal(fixture.storageCalls, 0)
  assert.equal(fixture.registry.size, 0)
  fixture.flags = { maintenanceEnabled: true, errorEnabled: true }
  for (fixture.role of ['ADMIN', 'TESTER']) assert.equal((await fixture.prepare()).status, 200)
}))
