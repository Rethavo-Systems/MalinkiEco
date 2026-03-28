import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import crypto from "node:crypto";
import fs from "node:fs";

dotenv.config();

const {
  PORT = "8080",
  PUBLIC_BASE_URL,
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,
  FIREBASE_SERVICE_ACCOUNT_PATH,
  FIREBASE_SERVICE_ACCOUNT_JSON
} = process.env;

const isYooKassaConfigured = Boolean(PUBLIC_BASE_URL && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);

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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

    console.log(
      `[push] publish requested by=${req.user.uid} audience=${audience} category=${category} destination=${destination} tokens=${tokens.length}`
    );

    if (tokens.length === 0) {
      console.warn("[push] publish skipped because no device tokens were found");
      return res.json({ ok: true, delivered: 0 });
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
      failed: response.failureCount
    });
  } catch (error) {
    console.error("[push] publish failed", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

app.post("/api/payments/create", authenticateFirebaseUser, async (req, res) => {
  try {
    if (!isYooKassaConfigured) {
      return res.status(503).json({ error: "YooKassa backend is not configured" });
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
    const paymentResponse = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`,
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
      return res.status(502).json({ error: paymentData.description || "YooKassa create payment failed" });
    }

    await paymentOrders.doc(orderId).set({
      userId,
      amount,
      status: "PENDING",
      yookassaPaymentId: paymentData.id,
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
    if (!isYooKassaConfigured) {
      return res.status(503).json({ error: "YooKassa backend is not configured" });
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

app.post("/api/yookassa/webhook", async (req, res) => {
  try {
    if (!isYooKassaConfigured) {
      return res.status(503).json({ error: "YooKassa backend is not configured" });
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
          yookassaPaymentStatus: paymentObject?.status || "succeeded"
        });
        transaction.set(payments.doc(), {
          userId,
          amount,
          note: `YooKassa payment ${orderId}`,
          orderId,
          provider: "YOOKASSA",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAtClient: Date.now()
        });
      });
    } else if (eventName === "payment.canceled") {
      await orderRef.set(
        {
          status: "CANCELED",
          canceledAt: admin.firestore.FieldValue.serverTimestamp(),
          yookassaPaymentStatus: paymentObject?.status || "canceled"
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
  if (!isYooKassaConfigured) {
    return res.status(503).send("YooKassa backend is not configured");
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
  console.log(`YooKassa backend listening on port ${PORT}`);
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
