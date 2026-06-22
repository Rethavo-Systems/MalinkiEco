# Cloudflare Worker для ворот

Worker нужен, чтобы сайт не хранил секреты eWeLink в браузере. В production сайт открывается напрямую с GitHub Pages, а кнопка ворот обращается к отдельному Cloudflare Worker:

```text
https://malinkieco-gate.kiriklass228.workers.dev/api/gate/open
```

Так основной сайт не зависит от Cloudflare-прокси на домене `malinkieco.rethavo.ru`.

## 1. DNS для сайта

Для записи `malinkieco.rethavo.ru` в Cloudflare DNS должен быть режим `DNS only`:

```text
malinkieco CNAME rethavo-systems.github.io DNS only
```

Не включай `Proxied` для этой записи, иначе весь сайт снова пойдет через Cloudflare и может не открываться без VPN у части пользователей.

## 2. Worker

1. Открой Cloudflare Dashboard.
2. Перейди в `Workers & Pages`.
3. Создай Worker с именем `malinkieco-gate`.
4. В редактор Worker вставь код из `cloudflare/gate-worker.js`.
5. Сохрани и задеплой Worker.

## 3. Переменные Worker

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

## 4. Проверка

Открой:

```text
https://malinkieco-gate.kiriklass228.workers.dev/api/gate/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"malinkieco-gate-worker"}
```

После этого можно проверять кнопку `Открыть ворота` на сайте. Команды открытия пишутся в `audit_logs`, а общий таймаут на 10 секунд хранится в `app_settings/gate_status`.
