# Cloudflare Worker для ворот

Worker нужен, чтобы сайт не хранил секреты eWeLink в браузере. Сайт вызывает `/api/gate/open`, а Cloudflare Worker уже проверяет пользователя через Firebase, проверяет долг и отправляет команду в eWeLink.

## 1. Создать Worker

1. Открой Cloudflare Dashboard.
2. Перейди в `Workers & Pages`.
3. Нажми `Create application` -> `Worker` -> `Create Worker`.
4. Название можно указать `malinkieco-gate`.
5. В редактор Worker вставь код из `cloudflare/gate-worker.js`.
6. Сохрани и задеплой Worker.

## 2. Добавить переменные

В настройках Worker открой `Settings` -> `Variables and Secrets`.

Обычные переменные:

```env
APP_ORIGIN=https://malinkieco.rethavo.ru
FIREBASE_PROJECT_ID=malinkiecodb
EWELINK_REGION=eu
EWELINK_DEVICE_ID=100185ec48
EWELINK_GATE_GLOBAL_COOLDOWN_MS=10000
```

Секреты:

```env
FIREBASE_CLIENT_EMAIL=client_email из Firebase service account
FIREBASE_PRIVATE_KEY=private_key из Firebase service account
EWELINK_APP_ID=APPID из eWeLink Dev
EWELINK_APP_SECRET=секрет приложения eWeLink Dev
EWELINK_ACCESS_TOKEN=текущий access token eWeLink
EWELINK_REFRESH_TOKEN=текущий refresh token eWeLink
```

`FIREBASE_PRIVATE_KEY` нужно вставлять целиком, включая строки `-----BEGIN PRIVATE KEY-----` и `-----END PRIVATE KEY-----`. Если Cloudflare не принимает многострочное значение, вставь ключ одной строкой с `\n` вместо переносов.

## 3. Подключить маршрут к сайту

1. В Cloudflare открой сайт `rethavo.ru`.
2. Перейди в `Workers Routes`.
3. Нажми `Add route`.
4. Route: `malinkieco.rethavo.ru/api/*`
5. Worker: `malinkieco-gate`
6. Сохрани.

После этого фронтенду не нужен `VITE_APP_API_BASE_URL`: кнопка ворот будет обращаться на тот же домен, в `/api/gate/open`.

## 4. Проверка

Открой:

```text
https://malinkieco.rethavo.ru/api/gate/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"malinkieco-gate-worker"}
```

Если health работает, можно проверять кнопку `Открыть ворота` на сайте. Команды открытия пишутся в `audit_logs`, а общий таймаут на 10 секунд хранится в `app_settings/gate_status`.
