package com.example.malinkieco.notifications

import com.example.malinkieco.R
import com.example.malinkieco.data.PushBackendClient
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MalinkiMessagingService : FirebaseMessagingService() {

    override fun onCreate() {
        super.onCreate()
        EventNotificationHelper.createNotificationChannel(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.push_default_title)
        val body = message.notification?.body
            ?: message.data["body"]
            ?: getString(R.string.push_default_body)
        val destination = message.data["destination"].orEmpty()

        EventNotificationHelper.showEventNotification(this, title, body, destination = destination)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser ?: return
        val client = PushBackendClient()
        if (!client.isConfigured()) return

        Thread {
            runCatching {
                val idToken = user.getIdToken(false).result?.token ?: return@runCatching
                client.registerDeviceToken(idToken, token)
            }
        }.start()
    }
}
