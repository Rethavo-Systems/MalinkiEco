import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import crypto from "node:crypto";
import fs from "node:fs";
import nodemailer from "nodemailer";

dotenv.config();

const {
  PORT = "8080",
  PUBLIC_BASE_URL,
  PAYMENT_PROVIDER_SHOP_ID,
  PAYMENT_PROVIDER_SECRET_KEY,
  PAYMENT_PROVIDER_PAYMENTS_URL,
  FIREBASE_SERVICE_ACCOUNT_PATH,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  RESEND_API_KEY,
  RESEND_FROM
} = process.env;

const paymentProviderShopId = String(PAYMENT_PROVIDER_SHOP_ID || "").trim();
const paymentProviderSecretKey = String(PAYMENT_PROVIDER_SECRET_KEY || "").trim();
const paymentProviderPaymentsUrl = String(PAYMENT_PROVIDER_PAYMENTS_URL || "").trim();
const isPaymentGatewayConfigured = Boolean(
  PUBLIC_BASE_URL &&
  paymentProviderShopId &&
  paymentProviderSecretKey &&
  paymentProviderPaymentsUrl
);

const serviceAccount = FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)
  : FIREBASE_SERVICE_ACCOUNT_PATH
    ? JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, "utf-8"))
    : null;

admin.initializeApp(
  serviceAccount
    ? { credential: admin.credential.cert(serviceAccount) }
    : { credential: admin.credential.applicationDefault() }
);

const firestore = admin.firestore();
const users = firestore.collection("users");
const payments = firestore.collection("payments");
const paymentOrders = firestore.collection("payment_orders");
const userDevices = firestore.collection("user_devices");
const emailVerifications = firestore.collection("email_verifications");

const resendFrom = String(RESEND_FROM || SMTP_FROM || "").trim();
const isResendConfigured = Boolean(RESEND_API_KEY && resendFrom);
const isEmailVerificationConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
const emailTransport = isEmailVerificationConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE || "false").toLowerCase() === "true",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  : null;

async function sendEmail({ to, subject, text }) {
  if (isResendConfigured) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [to],
        subject,
        text
      })
    });

    if (!response.ok) {
      throw new Error(`Resend request failed: ${response.status} ${await response.text()}`);
    }

    return;
  }

  if (!emailTransport) {
    throw new Error("Email verification is not configured");
  }

  await emailTransport.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text
  });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/email-verification/request", async (req, res) => {
  try {
    if (!isResendConfigured && !emailTransport) {
      return res.status(503).json({ error: "Email verification is not configured" });
    }

    const email = normalizeRegistrationEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "Укажите действующий адрес электронной почты" });
    }

    const docId = verificationDocId(email);
    const verificationRef = emailVerifications.doc(docId);
    const snapshot = await verificationRef.get();
    const previous = snapshot.data() || {};
    const now = Date.now();
    const lastSentAt = Number(previous.lastSentAt ?? 0);

    if (lastSentAt > 0 && now - lastSentAt < 60_000) {
      return res.status(429).json({ error: "Повторно отправить код можно через минуту" });
    }

    const code = generateVerificationCode();
    await verificationRef.set(
      {
        email,
        codeHash: hashText(code),
        attempts: 0,
        lastSentAt: now,
        expiresAt: now + 10 * 60_000,
        verifiedAt: 0,
        registerTokenHash: "",
        registerTokenExpiresAt: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    if (isResendConfigured) {
      await sendEmail({
        to: email,
        subject: "MalinkiEco verification code",
        text: [
          "Здравствуйте!",
          "",
          "Ваш код подтверждения для регистрации в MalinkiEco:",
          code,
          "",
          "Код действует 10 минут.",
          "Если вы не запрашивали регистрацию, просто проигнорируйте это письмо."
        ].join("\n")
      });

      return res.json({ ok: true, expiresInSeconds: 600 });
    }

    await emailTransport.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: "MalinkiEco verification code",
      text: [
        "Здравствуйте!",
        "",
        "Ваш код подтверждения для регистрации в MalinkiEco:",
        code,
        "",
        "Код действует 10 минут.",
        "Если вы не запрашивали регистрацию, просто проигнорируйте это письмо."
      ].join("\n")
    });

    return res.json({ ok: true, expiresInSeconds: 600 });
  } catch (error) {
    console.error("[email-verification] request failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/email-verification/verify", async (req, res) => {
  try {
    const email = normalizeRegistrationEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();

    if (!email) {
      return res.status(400).json({ error: "Укажите действующий адрес электронной почты" });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Код подтверждения должен содержать 6 цифр" });
    }

    const verificationRef = emailVerifications.doc(verificationDocId(email));
    const snapshot = await verificationRef.get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "Сначала запросите код подтверждения" });
    }

    const data = snapshot.data() || {};
    const now = Date.now();
    if (Number(data.expiresAt ?? 0) < now) {
      return res.status(400).json({ error: "Срок действия кода истек. Запросите новый код" });
    }

    const attempts = Number(data.attempts ?? 0) + 1;
    if (attempts > 10) {
      await verificationRef.set({ attempts }, { merge: true });
      return res.status(429).json({ error: "Слишком много попыток. Запросите новый код" });
    }

    if (hashText(code) !== String(data.codeHash || "")) {
      await verificationRef.set({ attempts }, { merge: true });
      return res.status(400).json({ error: "Неверный код подтверждения" });
    }

    const registerToken = crypto.randomBytes(24).toString("hex");
    await verificationRef.set(
      {
        attempts,
        verifiedAt: now,
        registerTokenHash: hashText(registerToken),
        registerTokenExpiresAt: now + 30 * 60_000,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return res.json({ ok: true, registerToken });
  } catch (error) {
    console.error("[email-verification] verify failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/email-verification/register", async (req, res) => {
  try {
    const email = normalizeRegistrationEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.fullName || "").trim();
    const phone = normalizeRussianPhone(String(req.body?.phone || ""));
    const login = String(req.body?.login || "").trim() || email;
    const plots = normalizePlots(req.body?.plots);
    const registerToken = String(req.body?.registerToken || "").trim();

    if (!email) {
      return res.status(400).json({ error: "Укажите действующий адрес электронной почты" });
    }
    if (password.trim().length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }
    if (!fullName) {
      return res.status(400).json({ error: "Введите отображаемое имя" });
    }
    if (!isValidRussianPhone(phone)) {
      return res.status(400).json({ error: "Номер телефона должен содержать 10 цифр после 8" });
    }
    if (plots.length === 0) {
      return res.status(400).json({ error: "Укажите хотя бы один участок" });
    }
    if (!registerToken) {
      return res.status(400).json({ error: "Сначала подтвердите код из письма" });
    }

    const verificationRef = emailVerifications.doc(verificationDocId(email));
    const verificationSnapshot = await verificationRef.get();
    if (!verificationSnapshot.exists) {
      return res.status(400).json({ error: "Сначала подтвердите код из письма" });
    }

    const verificationData = verificationSnapshot.data() || {};
    const now = Date.now();
    if (Number(verificationData.registerTokenExpiresAt ?? 0) < now) {
      return res.status(400).json({ error: "Подтверждение почты устарело. Запросите новый код" });
    }
    if (hashText(registerToken) !== String(verificationData.registerTokenHash || "")) {
      return res.status(400).json({ error: "Подтверждение почты недействительно. Запросите новый код" });
    }

    let existingUser = null;
    try {
      existingUser = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code !== "auth/user-not-found") {
        throw error;
      }
    }

    if (existingUser) {
      const userDoc = await users.doc(existingUser.uid).get();
      const registrationDoc = await firestore.collection("registration_requests").doc(existingUser.uid).get();

      if (userDoc.exists) {
        return res.status(409).json({ error: "Такой пользователь уже зарегистрирован" });
      }
      if (registrationDoc.exists && String(registrationDoc.data()?.status || "") === "PENDING") {
        return res.status(409).json({ error: "Заявка уже передана модераторам" });
      }
      if (registrationDoc.exists && String(registrationDoc.data()?.status || "") === "REJECTED") {
        await admin.auth().deleteUser(existingUser.uid);
      } else {
        return res.status(409).json({ error: "Такой пользователь уже существует" });
      }
    }

    const createdUser = await admin.auth().createUser({
      email,
      password,
      displayName: fullName
    });

    await firestore.collection("registration_requests").doc(createdUser.uid).set({
      login,
      authEmail: email,
      fullName,
      phone,
      plots,
      status: "PENDING",
      reviewedByName: "",
      reviewReason: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtClient: Date.now()
    });

    await verificationRef.delete();

    return res.json({ ok: true });
  } catch (error) {
    console.error("[email-verification] register failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/notifications/register-device", authenticateFirebaseUser, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "FCM token is required" });
    }

    const tokenId = crypto.createHash("sha256").update(`${req.user.uid}:${token}`).digest("hex");
    await userDevices.doc(tokenId).set(
      {
        userId: req.user.uid,
        token,
        platform: "android",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtClient: Date.now()
      },
      { merge: true }
    );

    console.log(`[push] registered device for user=${req.user.uid} token=${token.slice(0, 16)}...`);

    return res.json({ ok: true });
  } catch (error) {
    console.error("[push] register-device failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.get("/api/notifications/devices", authenticateFirebaseUser, async (req, res) => {
  try {
    const snapshot = await userDevices.where("userId", "==", req.user.uid).get();
    return res.json({
      ok: true,
      count: snapshot.size
    });
  } catch (error) {
    console.error("[push] devices query failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/notifications/publish", authenticateFirebaseUser, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const audience = String(req.body?.audience || "").trim();
    const destination = String(req.body?.destination || "events").trim() || "events";
    const category = String(req.body?.category || destination || "events").trim() || "events";
    const targetUserIds = Array.isArray(req.body?.targetUserIds)
      ? req.body.targetUserIds.map(String).map((it) => it.trim()).filter(Boolean)
      : [];
    const excludedUserIds = Array.isArray(req.body?.excludedUserIds)
      ? req.body.excludedUserIds.map(String).map((it) => it.trim()).filter(Boolean)
      : [];

    if (!title || !body) {
      return res.status(400).json({ error: "Title and body are required" });
    }
    if (!["broadcast", "users"].includes(audience)) {
      return res.status(400).json({ error: "Unsupported audience" });
    }

    const tokens = await collectTokens({
      audience,
      targetUserIds,
      excludedUserIds
    });
    let emailed = 0;
    let emailFailed = 0;

    if (shouldSendEventEmail({ audience, destination, category })) {
      const recipientEmails = await collectRecipientEmails({
        audience,
        targetUserIds,
        excludedUserIds
      });

      const emailResults = await Promise.allSettled(
        recipientEmails.map((email) =>
          sendEmail({
            to: email,
            subject: title,
            text: [
              "Здравствуйте!",
              "",
              `Тема: ${title}`,
              "",
              body,
              "",
              "Рекомендуем открыть MalinkiEco, чтобы ознакомиться с деталями события и актуальной информацией."
            ].join("\n")
          })
        )
      );

      emailed = emailResults.filter((item) => item.status === "fulfilled").length;
      emailFailed = emailResults.length - emailed;
      console.log(`[email] events mailed=${emailed} failed=${emailFailed}`);
    }

    console.log(
      `[push] publish requested by=${req.user.uid} audience=${audience} category=${category} destination=${destination} tokens=${tokens.length}`
    );

    if (tokens.length === 0) {
      console.warn("[push] publish skipped because no device tokens were found");
      return res.json({ ok: true, delivered: 0, emailed, emailFailed });
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title,
        body,
        destination,
        category
      },
      android: {
        priority: "high"
      }
    });

    await cleanupInvalidTokens(tokens, response.responses);
    if (response.failureCount > 0) {
      response.responses.forEach((item, index) => {
        if (!item.success) {
          console.error(
            `[push] token failed index=${index} code=${item.error?.code || "unknown"} message=${item.error?.message || "unknown"}`
          );
        }
      });
    }
    console.log(`[push] publish delivered=${response.successCount} failed=${response.failureCount}`);
    return res.json({
      ok: true,
      delivered: response.successCount,
      failed: response.failureCount,
      emailed,
      emailFailed
    });
  } catch (error) {
    console.error("[push] publish failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/payments/create", authenticateFirebaseUser, async (req, res) => {
  try {
    if (!isPaymentGatewayConfigured) {
      return res.status(503).json({ error: "Payments backend is not configured" });
    }
    const amount = Number(req.body?.amount || 0);
    const userId = String(req.body?.userId || "");
    const userName = String(req.body?.userName || "").trim();

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive integer" });
    }
    if (!userId || req.user.uid !== userId) {
      return res.status(403).json({ error: "User mismatch" });
    }

    const userSnapshot = await users.doc(userId).get();
    if (!userSnapshot.exists) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const orderId = crypto.randomUUID();
    const returnUrl = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/return?orderId=${orderId}`;
    const paymentResponse = await fetch(paymentProviderPaymentsUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${paymentProviderShopId}:${paymentProviderSecretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotence-Key": orderId
      },
      body: JSON.stringify({
        amount: {
          value: amount.toFixed(2),
          currency: "RUB"
        },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: returnUrl
        },
        description: `Оплата в MalinkiEco для ${userName || userId}`,
        metadata: {
          orderId,
          userId
        }
      })
    });

    const paymentData = await paymentResponse.json();
    if (!paymentResponse.ok) {
      return res.status(502).json({ error: paymentData.description || "Payment provider create payment failed" });
    }

    await paymentOrders.doc(orderId).set({
      userId,
      amount,
      status: "PENDING",
      providerPaymentId: paymentData.id,
      confirmationUrl: paymentData.confirmation?.confirmation_url || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtClient: Date.now()
    });

    return res.json({
      orderId,
      status: "PENDING",
      confirmationUrl: paymentData.confirmation?.confirmation_url || ""
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.get("/api/payments/:orderId", authenticateFirebaseUser, async (req, res) => {
  try {
    if (!isPaymentGatewayConfigured) {
      return res.status(503).json({ error: "Payments backend is not configured" });
    }
    const orderSnapshot = await paymentOrders.doc(req.params.orderId).get();
    if (!orderSnapshot.exists) {
      return res.status(404).json({ error: "Payment order not found" });
    }

    const order = orderSnapshot.data();
    if (order.userId !== req.user.uid) {
      return res.status(403).json({ error: "Access denied" });
    }

    return res.json({
      id: orderSnapshot.id,
      amount: order.amount || 0,
      status: order.status || "UNKNOWN",
      confirmationUrl: order.confirmationUrl || ""
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/payments/webhook", async (req, res) => {
  try {
    if (!isPaymentGatewayConfigured) {
      return res.status(503).json({ error: "Payments backend is not configured" });
    }
    const eventName = req.body?.event;
    const paymentObject = req.body?.object;
    const metadata = paymentObject?.metadata || {};
    const orderId = String(metadata.orderId || "");
    const userId = String(metadata.userId || "");

    if (!orderId || !userId) {
      return res.status(400).json({ error: "Missing order metadata" });
    }

    const orderRef = paymentOrders.doc(orderId);
    const userRef = users.doc(userId);

    if (eventName === "payment.succeeded") {
      await firestore.runTransaction(async (transaction) => {
        const [orderSnapshot, userSnapshot] = await Promise.all([
          transaction.get(orderRef),
          transaction.get(userRef)
        ]);

        if (!orderSnapshot.exists || !userSnapshot.exists) {
          throw new Error("Order or user not found");
        }

        const order = orderSnapshot.data();
        if (order.status === "SUCCEEDED") {
          return;
        }

        const currentBalance = Number(userSnapshot.get("balance") || 0);
        const amount = Number(order.amount || 0);
        const newBalance = currentBalance + amount;

        transaction.update(userRef, { balance: newBalance });
        transaction.update(orderRef, {
          status: "SUCCEEDED",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          providerPaymentStatus: paymentObject?.status || "succeeded"
        });
        transaction.set(payments.doc(), {
          userId,
          amount,
          note: `Online payment ${orderId}`,
          orderId,
          provider: "ONLINE",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAtClient: Date.now()
        });
      });
    } else if (eventName === "payment.canceled") {
      await orderRef.set(
        {
          status: "CANCELED",
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          providerPaymentStatus: paymentObject?.status || "canceled"
        },
        { merge: true }
      );
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.get("/return", (req, res) => {
  if (!isPaymentGatewayConfigured) {
    return res.status(503).send("Payments backend is not configured");
  }
  const orderId = String(req.query.orderId || "");
  const deepLink = `malinkieco://payments/return?orderId=${encodeURIComponent(orderId)}`;
  res.type("html").send(`
    <!doctype html>
    <html lang="ru">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Возврат в приложение</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 32px; background: #f7f3ec; color: #3d2a1f; }
        .card { max-width: 420px; margin: 0 auto; padding: 24px; background: white; border-radius: 18px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); }
        a { display: inline-block; margin-top: 16px; color: #a1063f; font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Возвращаем вас в приложение</h1>
        <p>Если приложение не открылось автоматически, нажмите на ссылку ниже.</p>
        <a href="${deepLink}">Открыть MalinkiEco</a>
      </div>
      <script>window.location.replace(${JSON.stringify(deepLink)});</script>
    </body>
    </html>
  `);
});

app.listen(Number(PORT), () => {
  console.log(`Payments backend listening on port ${PORT}`);
});

async function authenticateFirebaseUser(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch (error) {
    console.error("[auth] firebase verify failed", error);
    return res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

async function collectTokens({ audience, targetUserIds, excludedUserIds }) {
  const snapshot = await userDevices.get();
  const excludeSet = new Set(excludedUserIds);
  const targetSet = new Set(targetUserIds);

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((device) => typeof device.token === "string" && device.token.trim())
    .filter((device) => {
      if (audience === "broadcast") {
        return !excludeSet.has(device.userId);
      }
      return targetSet.has(device.userId);
    })
    .map((device) => device.token)
    .filter(Boolean);
}

async function collectRecipientEmails({ audience, targetUserIds, excludedUserIds }) {
  const snapshot = await users.get();
  const targetSet = new Set(targetUserIds);

  return [...new Set(
    snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((user) => {
        if (audience === "broadcast") {
          return true;
        }
        return targetSet.has(user.id);
      })
      .map((user) => normalizeRegistrationEmail(user.email || user.authEmail || ""))
      .filter(Boolean)
  )];
}

function shouldSendEventEmail({ audience, destination, category }) {
  return audience === "broadcast" && destination === "events" && category === "events";
}

async function cleanupInvalidTokens(tokens, responses) {
  const invalidCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered"
  ]);

  const deletePromises = responses.map((response, index) => {
    const code = response.error?.code;
    if (!invalidCodes.has(code)) return null;
    const token = tokens[index];
    if (!token) return null;
    return userDevices.where("token", "==", token).get().then((snapshot) =>
      Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    );
  }).filter(Boolean);

  await Promise.all(deletePromises);
}

function verificationDocId(email) {
  return crypto.createHash("sha256").update(email).digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeRegistrationEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return "";
  return email;
}

function normalizePlots(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map(String).map(cleanPlotValue).filter(Boolean);
  }
  return String(rawValue || "")
    .split(",")
    .map(cleanPlotValue)
    .filter(Boolean);
}

function cleanPlotValue(value) {
  return String(value || "")
    .trim()
    .replace(/^участок\s*/i, "")
    .trim();
}

function normalizeRussianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `8${digits}`;
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return `8${digits.slice(1)}`;
  }
  return digits;
}

function isValidRussianPhone(value) {
  return /^8\d{10}$/.test(String(value || ""));
}

