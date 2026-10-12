import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { downloadWithFallback, fileDownloadCandidates } from '../src/lib/chatFileDownload.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('downloads directly without using the proxy when storage is reachable', async () => {
  globalThis.fetch = async () => new Response('photo bytes')
  const blob = await downloadWithFallback(async () => 'https://storage.example/file', async () => {
    assert.fail('proxy should not be called')
  })
  assert.equal(await blob.text(), 'photo bytes')
})

test('falls back to the protected route when a storage request fails due to CORS', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  const blob = await downloadWithFallback(
    async () => 'https://storage.example/file',
    async () => new Response('protected photo', { headers: { 'Content-Type': 'image/png' } }),
  )
  assert.equal(await blob.text(), 'protected photo')
  assert.equal(blob.type, 'image/png')
})

test('falls back when storage responds with an HTTP error', async () => {
  globalThis.fetch = async () => new Response('', { status: 403 })
  const blob = await downloadWithFallback(
    async () => 'https://storage.example/file', async () => new Response('file'),
  )
  assert.equal(await blob.text(), 'file')
})

test('falls back even if the direct URL cannot be issued', async () => {
  globalThis.fetch = async () => { assert.fail('no direct URL was issued') }
  const blob = await downloadWithFallback(
    async () => { throw new Error('Direct API unavailable') },
    async () => new Response('file'),
  )
  assert.equal(await blob.text(), 'file')
})

test('aborts a stalled response body and uses the proxy', async () => {
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    blob: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }),
  })
  const blob = await downloadWithFallback(
    async () => 'https://storage.example/file', async () => new Response('file'), 10,
  )
  assert.equal(await blob.text(), 'file')
})

test('reports expired or missing files from the protected API', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(downloadWithFallback(
    async () => 'https://storage.example/file',
    async () => Response.json({ error: 'Срок хранения файла истек.' }, { status: 410 }),
  ), /Срок хранения файла истек/)
})

test('keeps large and unknown-size files off the function proxy', () => {
  const endpoints = ['https://functions.yandexcloud.net/function', 'https://chat-files.rethavo.ru']
  assert.deepEqual(fileDownloadCandidates(endpoints, 2048), endpoints)
  for (const size of [25 * 1024 * 1024, 0, NaN]) {
    assert.deepEqual(fileDownloadCandidates(endpoints, size), [endpoints[1]])
  }
})
