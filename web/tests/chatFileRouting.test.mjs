import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'

// Use the real attachment API and routing with a dummy signed-in user. All
// requests below stay in the fetch stub; no Firebase client is initialized.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './firebase' && context.parentURL?.endsWith('/src/lib/chatFilesApi.ts')) {
      return { url: 'data:text/javascript,export const auth = { currentUser: { getIdToken: async () => "offline-test-token" } }', shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(url)) return next(url.href, context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/src/lib/chatFilesApi.ts')) {
      const source = readFileSync(new URL(url), 'utf8').replaceAll('import.meta.env', '({ VITE_RU_API_BASE_URL: "https://functions.yandexcloud.net/files" })')
      return { format: 'module-typescript', source, shortCircuit: true }
    }
    return next(url, context)
  },
})

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
globalThis.window = { setTimeout, clearTimeout, addEventListener() {} }
const { downloadChatAttachment, uploadChatFile, getChatAttachmentPreviewUrl } = await import('../src/lib/chatFilesApi.ts')
const { invalidateApiEndpoint } = await import('../src/lib/resilientApi.ts')
test.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })

const attachment = size => ({ id: 'photo', name: 'photo.jpg', kind: 'image', contentType: 'image/jpeg', size, downloadPath: '/api/chat/files/photo.jpg' })

function mockEndpoints(readResponse, directResponse = () => Response.json({ error: 'Direct storage URL unavailable' }, { status: 503 })) {
  invalidateApiEndpoint('chat-files')
  invalidateApiEndpoint('chat-file-downloads')
  const reads = []
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.searchParams.get('path') || parsed.pathname
    assert.ok(['functions.yandexcloud.net', 'chat-files.rethavo.ru', 'malinkieco-chat-files.kiriklass228.workers.dev'].includes(parsed.hostname), 'no request may escape to another service')
    if (path === '/api/chat/health') return Response.json({ ok: true })
    if (path === '/api/chat/download-url') return directResponse(parsed.hostname, path, init)
    reads.push({ host: parsed.hostname, path, method: init.method, headers: new Headers(init.headers) })
    return readResponse(parsed.hostname, path, init)
  }
  return reads
}

test('a phone photo whose Base64 envelope exceeds the function limit downloads through a streaming worker', async () => {
  const reads = mockEndpoints(() => new Response('photo bytes', { headers: { 'Content-Type': 'image/jpeg' } }))
  const blob = await downloadChatAttachment(attachment(2_789_673))
  assert.equal(await blob.text(), 'photo bytes')
  assert.equal(blob.type, 'image/jpeg')
  assert.deepEqual(reads.map(({ host, method }) => [host, method]), [['chat-files.rethavo.ru', 'GET']])
  assert.equal(reads[0].headers.get('Authorization'), 'Bearer offline-test-token')
})

for (const status of [413, 502, 504]) {
  test(`a read-only download falls through a function ${status} to a streaming worker`, async () => {
    const reads = mockEndpoints(host => host === 'functions.yandexcloud.net'
      ? Response.json({ error: 'Function proxy failed' }, { status })
      : new Response('streamed photo'))
    assert.equal(await (await downloadChatAttachment(attachment(1024))).text(), 'streamed photo')
    assert.deepEqual(reads.map(({ host, method }) => [host, method]), [
      ['functions.yandexcloud.net', 'GET'], ['chat-files.rethavo.ru', 'GET'],
    ])
  })
}

test('a forbidden download remains forbidden instead of probing another server', async () => {
  const reads = mockEndpoints(() => Response.json({ error: 'Доступ запрещён' }, { status: 403 }))
  await assert.rejects(downloadChatAttachment(attachment(1024)), /Доступ запрещён/)
  assert.equal(reads.length, 1)
})

test('a rejected upload preparation is never replayed by the download fallback policy', async () => {
  const reads = mockEndpoints(() => Response.json({ error: 'Файл слишком большой' }, { status: 413 }))
  await assert.rejects(uploadChatFile(new File(['photo bytes'], 'photo.jpg', { type: 'image/jpeg' })), /Файл слишком большой/)
  assert.deepEqual(reads.map(({ host, path, method }) => [host, path, method]), [
    ['functions.yandexcloud.net', '/api/chat/files/prepare', 'POST'],
  ])
})

test('a preview obtains only an authorized short-lived URL, without fetching image bytes or requiring storage CORS', async () => {
  let requested = 0
  const signedUrl = 'https://storage.example.test/temporary-photo'
  const reads = mockEndpoints(() => assert.fail('preview must not fetch the protected binary route'), (host, path, init) => {
    requested++
    assert.equal(host, 'functions.yandexcloud.net')
    assert.equal(init.method, 'POST')
    assert.equal(new Headers(init.headers).get('X-Firebase-Authorization'), 'Bearer offline-test-token')
    assert.equal(JSON.parse(init.body).downloadPath, attachment(2_789_673).downloadPath)
    return Response.json({ ok: true, downloadUrl: signedUrl })
  })
  assert.equal(await getChatAttachmentPreviewUrl(attachment(2_789_673)), signedUrl)
  assert.equal(requested, 1)
  assert.equal(reads.length, 0)
})

test('preview URL authorization and expiry errors stay visible without a binary fallback', async () => {
  for (const status of [403, 410]) {
    const reads = mockEndpoints(() => assert.fail('no image request without authorization'), () => Response.json({ error: `Preview access ${status}` }, { status }))
    await assert.rejects(getChatAttachmentPreviewUrl(attachment(1024)), new RegExp(`Preview access ${status}`))
    assert.equal(reads.length, 0)
  }
})

test('preview rejects malformed or insecure links without exposing their contents in errors', async () => {
  for (const downloadUrl of ['http://storage.example.test/private-token', 'data:image/png,private-token', 'not a URL with private-token']) {
    mockEndpoints(() => assert.fail('invalid links must never be fetched'), () => Response.json({ ok: true, downloadUrl }))
    await assert.rejects(getChatAttachmentPreviewUrl(attachment(1024)), error => {
      assert.match(error.message, /некорректную ссылку/)
      assert.equal(error.message.includes('private-token'), false)
      return true
    })
  }
})
