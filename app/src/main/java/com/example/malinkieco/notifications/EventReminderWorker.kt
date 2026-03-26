package com.example.malinkieco.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.malinkieco.R
import com.example.malinkieco.data.FirebaseRepository
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

class EventReminderWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val auth = FirebaseAuth.getInstance()
            val profile = auth.currentUser?.uid?.let {
                FirebaseRepository(
                    context = applicationContext,
                    auth = auth,
                    firestore = FirebaseFirestore.getInstance()
                ).getCurrentUserProfile()
            } ?: return Result.success()
            val repository = FirebaseRepository(
                context = applicationContext,
                auth = auth,
                firestore = FirebaseFirestore.getInstance()
            )
            val store = EventStateStore(applicationContext)
            val unreadEvents = store.unreadEvents(profile.id, repository.getRecentEventsForUser(profile, EVENT_CHECK_LIMIT))
            if (unreadEvents.isNotEmpty()) {
                val newestTimestamp = unreadEvents.maxOf { it.createdAtClient }
                if (newestTimestamp > store.getLastBackgroundNotificationTimestamp(profile.id)) {
                    val latestEvent = unreadEvents.maxBy { it.createdAtClient }
                    val title = applicationContext.getString(
                        R.string.unread_events_notification_title,
                        unreadEvents.size
                    )
                    val body = applicationContext.getString(
                        R.string.unread_events_notification_body,
                        latestEvent.title
                    )
                    EventNotificationHelper.showEventNotification(applicationContext, title, body)
                    store.setLastBackgroundNotificationTimestamp(profile.id, newestTimestamp)
                }
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val EVENT_CHECK_LIMIT = 10L
    }
}
