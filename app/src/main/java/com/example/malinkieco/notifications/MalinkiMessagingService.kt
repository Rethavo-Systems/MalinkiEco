package com.example.malinkieco.notifications

import com.example.malinkieco.R
import com.example.malinkieco.data.FirebaseRepository
import com.example.malinkieco.data.PushBackendClient
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MalinkiMessagingService : FirebaseMessagingService() {

    override fun onCreate() {
        super.onCreate()
        EventNotificationHelper.createNotificationChannel(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (EventNotificationHelper.isAppInForeground()) {
            return
        }
        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.push_default_title)
        val body = message.notification?.body
            ?: message.data["body"]
            ?: getString(R.string.push_default_body)
        val destination = message.data["destination"].orEmpty()
        val category = message.data["category"].orEmpty().ifBlank { destination }
        val userId = FirebaseAuth.getInstance().currentUser?.uid
        if (userId != null) {
            val store = EventStateStore(applicationContext)
            if (!store.shouldShowNotification(userId, category)) {
                return
            }
        }

        EventNotificationHelper.showEventNotification(this, title, body, destination = destination)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val store = EventStateStore(applicationContext)
        store.setCachedFcmToken(token)
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser ?: return
        val repository = FirebaseRepository(
            context = applicationContext,
            auth = auth,
            firestore = FirebaseFirestore.getInstance()
        )
        val client = PushBackendClient()

        user.getIdToken(true)
            .addOnSuccessListener { result ->
                val idToken = result.token ?: return@addOnSuccessListener
                CoroutineScope(Dispatchers.IO).launch {
                    runCatching {
                        repository.registerDeviceToken(user.uid, token)
                        if (client.isConfigured()) {
                            client.registerDeviceToken(idToken, token)
                        }
                        store.setPushRegistrationConfirmed(user.uid, true)
                    }.onFailure {
                        store.setPushRegistrationConfirmed(user.uid, false)
                    }
                }
            }
    }
}
