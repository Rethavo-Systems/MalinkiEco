const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "europe-central2", maxInstances: 10 });

exports.sendEventNotification = onDocumentCreated("events/{eventId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    logger.warn("Event snapshot is missing");
    return;
  }

  const data = snapshot.data();
  const title = data.title || "Новое событие";
  const message = data.message || "В приложении опубликовано новое событие";
  const type = data.type || "INFO";
  const amount = Number(data.amount || 0);

  const body = type === "CHARGE" && amount > 0
    ? `${message}\nСумма сбора: ${amount} ₽`
    : message;

  const payload = {
    topic: "community_events",
    notification: {
      title,
      body
    },
    data: {
      eventId: snapshot.id,
      type,
      amount: String(amount)
    },
    android: {
      priority: "high",
      notification: {
        channelId: "community_events"
      }
    }
  };

  try {
    const response = await admin.messaging().send(payload);
    logger.info("Push sent", { response, eventId: snapshot.id });
  } catch (error) {
    logger.error("Push send failed", { error, eventId: snapshot.id });
  }
});
