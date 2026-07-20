# MalinkiEco Yandex Cloud fallback

This function is a small Russian-network fallback for the gate and chat-file APIs.
It forwards only `/api/gate/*` and `/api/chat/*` requests to the existing secured
Cloudflare Workers. Small avatar images can pass through the function so they work
on restricted mobile networks. Large chat files do not pass through the function:
the chat API returns a temporary Yandex Disk URL and the browser transfers them
directly, avoiding function traffic and payload limits.

Runtime settings:

- Runtime: Node.js 22
- Entry point: `index.handler`
- Memory: 128 MB
- Timeout: 12 seconds
- Public invocation: enabled

Environment variables are optional because safe upstream defaults are included:

- `UPSTREAM_GATE_URL=https://malinkieco-gate.kiriklass228.workers.dev`
- `UPSTREAM_CHAT_URL=https://malinkieco-chat-files.kiriklass228.workers.dev`
- `APP_ALLOWED_ORIGINS=https://malinkieco.rethavo.ru,http://127.0.0.1:5173,http://localhost:5173`

The public invocation URL is configured as `VITE_RU_API_BASE_URL` in the web
deployment workflow. Yandex Cloud Functions receive the requested API path in
the `path` query parameter because their public URL does not accept path suffixes.
