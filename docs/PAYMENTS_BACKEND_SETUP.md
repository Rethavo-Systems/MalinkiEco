# Payments Backend Setup

## Как устроен поток оплаты

1. Android отправляет запрос на backend `POST /api/payments/create`.
2. Backend создает платеж у провайдера и возвращает `confirmationUrl`.
3. Приложение открывает платежную форму в браузере.
4. После оплаты провайдер шлет webhook на backend `POST /api/payments/webhook`.
5. Backend обновляет Firestore:
   - документ `payment_orders/{orderId}`
   - документ в коллекции `payments`
   - баланс пользователя в `users/{uid}`
6. Backend возвращает пользователя на `https://your-domain/return?orderId=...`.
7. Страница `/return` переводит пользователя обратно в приложение по deep link `malinkieco://payments/return?...`.
8. Android запрашивает backend `GET /api/payments/{orderId}` и показывает итог.

## Что нужно сделать вам

1. Подключить платежного провайдера.
2. Получить:
   - `shopId`
   - `secretKey`
3. Поднять backend из папки `backend` на сервере с HTTPS.
4. Указать webhook URL у провайдера:
   - `https://your-domain.example/api/payments/webhook`
5. В Android задать адрес backend:
   - в `gradle.properties` или `~/.gradle/gradle.properties`
   - `PAYMENTS_BACKEND_URL=https://your-domain.example`

## Как запустить backend

```bash
cd backend
npm install
cp .env.example .env
```

Заполните `.env`:

```env
PORT=8080
PUBLIC_BASE_URL=https://your-domain.example
PAYMENT_PROVIDER_SHOP_ID=your_provider_shop_id
PAYMENT_PROVIDER_SECRET_KEY=your_provider_secret_key
PAYMENT_PROVIDER_PAYMENTS_URL=https://your-provider.example/payments
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
```

Положите рядом `service-account.json` из Firebase Admin SDK.

Запуск:

```bash
npm start
```

## Что появится в Firestore

- `payment_orders`
  - `userId`
  - `amount`
  - `status`
  - `providerPaymentId`
  - `confirmationUrl`
- `payments`
  - `userId`
  - `amount`
  - `note`
  - `orderId`
  - `provider=ONLINE`

## Важно

- Секретный ключ провайдера хранится только на backend.
- Баланс меняется только после webhook `payment.succeeded`.
- Android не должен сам считать платеж успешным без подтверждения backend.
