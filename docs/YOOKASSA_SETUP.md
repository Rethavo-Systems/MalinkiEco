# YooKassa Setup

## Как устроен поток оплаты

1. Android отправляет запрос на backend `POST /api/payments/create`.
2. Backend создает платеж в YooKassa и возвращает `confirmationUrl`.
3. Приложение открывает платежную форму YooKassa в браузере.
4. После оплаты YooKassa шлет webhook на backend `POST /api/yookassa/webhook`.
5. Backend обновляет Firestore:
   - документ `payment_orders/{orderId}`
   - документ в коллекции `payments`
   - баланс пользователя в `users/{uid}`
6. Backend возвращает пользователя на `https://your-domain/return?orderId=...`.
7. Страница `/return` переводит пользователя обратно в приложение по deep link `malinkieco://payments/return?...`.
8. Android запрашивает backend `GET /api/payments/{orderId}` и показывает итог.

## Что нужно сделать вам

1. Зарегистрировать магазин в YooKassa.
2. Получить:
   - `shopId`
   - `secretKey`
3. Поднять backend из папки `backend` на сервере с HTTPS.
4. В YooKassa указать webhook URL:
   - `https://your-domain.example/api/yookassa/webhook`
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
YOOKASSA_SHOP_ID=ваш_shop_id
YOOKASSA_SECRET_KEY=ваш_secret_key
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
  - `yookassaPaymentId`
  - `confirmationUrl`
- `payments`
  - `userId`
  - `amount`
  - `note`
  - `orderId`
  - `provider=YOOKASSA`

## Важно

- Секретный ключ YooKassa хранится только на backend.
- Баланс меняется только после webhook `payment.succeeded`.
- Android не должен сам считать платеж успешным без подтверждения backend.
