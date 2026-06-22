# Gate opening backend setup

The web app must not call eWeLink directly because `EWELINK_APP_SECRET` must stay server-side.

## Backend environment

Add these values to the backend runtime secrets:

```env
EWELINK_APP_ID=...
EWELINK_APP_SECRET=...
EWELINK_DEVICE_ID=100185ec48
EWELINK_REGION=eu
EWELINK_ACCESS_TOKEN=...
EWELINK_REFRESH_TOKEN=...
EWELINK_AT_EXPIRED_TIME=...
EWELINK_RT_EXPIRED_TIME=...
EWELINK_GATE_OPEN_COOLDOWN_MS=10000
EWELINK_GATE_GLOBAL_COOLDOWN_MS=10000
```

On the first successful run, the backend stores refreshed tokens in Firestore under
`private_settings/ewelink_gate`. Client Firestore rules do not expose this collection.

## Web build variable

Set this GitHub repository variable before publishing the web app:

```env
VITE_APP_API_BASE_URL=https://your-backend.example
```

The frontend calls:

```text
POST /api/gate/open
```

with the current Firebase ID token. The backend accepts approved `USER`, `MODERATOR`, `ADMIN`, and `TESTER`
accounts. While maintenance mode is enabled, only `ADMIN` and `TESTER` can use the endpoint.
