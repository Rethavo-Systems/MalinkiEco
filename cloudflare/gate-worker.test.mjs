import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { cachedGateProbe, rememberGateFailure } from './gate-worker.js'

test('gate availability coalesces callers, caches success and failures for five minutes', async () => {
  let count = 0
  const probe = async () => { count++; return { available:true, reason:'' } }
  const initial = await Promise.all(Array.from({length:50},()=>cachedGateProbe(probe,1000)))
  assert.equal(count,1)
  assert.ok(initial.every(result=>result.available))
  await cachedGateProbe(probe,300999)
  assert.equal(count,1)
  const failure = await cachedGateProbe(async()=>{count++;throw new Error('offline')},301000)
  assert.equal(failure.available,false)
  await cachedGateProbe(probe,500000)
  assert.equal(count,2)
  const recovered = await cachedGateProbe(probe,601000)
  assert.equal(recovered.available,true)
  assert.equal(count,3)
})

test('a failed gate command replaces cached availability and wins over a stale probe', async () => {
  let resolve
  const stale = cachedGateProbe(() => new Promise(done => { resolve = done }), 1_000_000)
  rememberGateFailure('Service offline', 1_000_001)
  resolve({ available:true,reason:'' })
  assert.equal((await stale).available,false)
  const cached = await cachedGateProbe(() => assert.fail('failure cache must avoid extra probes'),1_000_002)
  assert.equal(cached.reason,'Service offline')
})

test('unauthenticated status requests are rejected before probing Firebase or eWeLink', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => assert.fail('unauthenticated request must not use network')
  try {
    const response = await worker.fetch(new Request('https://gate.example.test/api/gate/status'),{FIREBASE_PROJECT_ID:'test'})
    assert.equal(response.status,401)
  } finally { globalThis.fetch = original }
})

test('both site closure flags block resident gate commands before a device request or lock write', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'isolated-test' }
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const signed = `${encoded({ alg: 'RS256', kid: jwk.kid })}.${encoded({ aud: 'test', iss: 'https://securetoken.google.com/test', sub: 'resident', iat: now, exp: now + 600 })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signed))
  const token = `${signed}.${Buffer.from(signature).toString('base64url')}`
  const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
  const env = {
    FIREBASE_PROJECT_ID: 'test', FIREBASE_CLIENT_EMAIL: 'test@example.test',
    FIREBASE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`,
    EWELINK_APP_ID: 'isolated-test', EWELINK_APP_SECRET: 'isolated-test', EWELINK_DEVICE_ID: 'isolated-test',
    EWELINK_REGION: 'eu', EWELINK_ACCESS_TOKEN: 'isolated-test', EWELINK_REFRESH_TOKEN: 'isolated-test',
  }
  const original = globalThis.fetch
  let flags
  let role
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path.includes('/jwk/')) return Response.json({ keys: [jwk] })
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'isolated-test', expires_in: 600 })
    if (path.endsWith('/users/resident')) return Response.json({ fields: { role: { stringValue: role }, balance: { integerValue: '0' } } })
    if (path.endsWith('/app_settings/app_gate')) return Response.json({ fields: Object.fromEntries(Object.entries(flags).map(([key, value]) => [key, { booleanValue: value }])) })
    assert.fail(`Blocked resident command reached unexpected API path ${path}`)
  }
  try {
    for (role of ['USER', 'MODERATOR']) {
      for (flags of [{ maintenanceEnabled: true }, { errorEnabled: true }, { maintenanceEnabled: true, errorEnabled: true }]) {
        const response = await worker.fetch(new Request('https://gate.example.test/api/gate/open', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }), env)
        assert.equal(response.status, 503)
        assert.match((await response.json()).error, flags.errorEnabled ? /технический сбой/ : /технических работ/)
      }
    }
  } finally { globalThis.fetch = original }
})
