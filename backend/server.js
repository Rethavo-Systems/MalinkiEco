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
  FIREBASE_SERVICE_ACCOUNT_PATH
} = process.env;

if (!PUBLIC_BASE_URL || !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
  throw new Error("Missing required environment variables for YooKassa backend");
}

const serviceAccount = FIREBASE_SERVICE_ACCOUNT_PATH
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/payments/create", authenticateFirebaseUser, async (req, res) => {
  try {
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
