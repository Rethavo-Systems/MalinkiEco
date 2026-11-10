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
