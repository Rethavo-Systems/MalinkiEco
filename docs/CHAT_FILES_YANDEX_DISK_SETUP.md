# Chat files and avatars through Yandex Disk

This setup avoids Cloudflare R2 and does not require a bank card in Cloudflare.
Cloudflare Worker is only an authenticated proxy. The files are stored physically
in Yandex Disk.

## Worker variables

For `malinkieco-chat-files`:

```env
APP_ORIGIN=https://malinkieco.rethavo.ru
APP_EXTRA_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
FIREBASE_PROJECT_ID=malinkiecodb
CHAT_FILES_STORAGE_PROVIDER=yandex
YANDEX_DISK_BASE_PATH=MalinkiEco/chat
CHAT_FILES_STORAGE_LIMIT_BYTES=8589934592
CHAT_FILES_STORAGE_TARGET_BYTES=7516192768
CHAT_FILES_CLEANUP_SCAN_LIMIT=20000
```

## Worker secrets

```env
FIREBASE_CLIENT_EMAIL=client_email from Firebase service account
FIREBASE_PRIVATE_KEY=private_key from Firebase service account
YANDEX_DISK_TOKEN=OAuth token with Yandex Disk REST API read/write access
```

`FIREBASE_PRIVATE_KEY` must include the whole private key, including
`-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`.

## Yandex Disk layout

The worker creates folders automatically:

```text
MalinkiEco/chat/chat-files
MalinkiEco/chat/avatars
```

Chat files are named with expiration timestamp and are deleted after 30 days by
the worker cleanup pass. Avatars are stored separately and are deleted only when
the user replaces or removes the avatar.

## Deploy

```powershell
cd C:\Users\kirik\Documents\AndroidProject\MalinkiEco\cloudflare
npx wrangler deploy -c wrangler.chat-files.toml
```

If Wrangler asks for `CLOUDFLARE_API_TOKEN`, create a Cloudflare API token with
Workers Scripts edit permissions and run the command with that token in the
environment.
