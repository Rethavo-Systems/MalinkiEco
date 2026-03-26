package com.example.malinkieco.notifications

import com.example.malinkieco.R
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

        EventNotificationHelper.showEventNotification(this, title, body)
    }
}
