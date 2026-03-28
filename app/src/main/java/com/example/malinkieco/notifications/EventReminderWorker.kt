package com.example.malinkieco.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.malinkieco.BuildConfig
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
            if (BuildConfig.PAYMENTS_BACKEND_URL.isNotBlank()) {
                return Result.success()
            }
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
                    EventNotificationHelper.showEventNotification(applicationContext, title, body, destination = "events")
                    store.setLastBackgroundNotificationTimestamp(profile.id, newestTimestamp)
                }
            }

            val recentChatMessages = repository.getRecentChatMessages(CHAT_CHECK_LIMIT)
            val unreadMessages = store.unreadChatMessages(profile.id, recentChatMessages)
                .filter { it.senderId != profile.id }
            if (unreadMessages.isNotEmpty()) {
                val latestChatTimestamp = unreadMessages.maxOf { it.createdAtClient }
                if (latestChatTimestamp > store.getLastChatNotificationTimestamp(profile.id)) {
                    val mentionMessage = unreadMessages.lastOrNull { it.mentionedUserIds.contains(profile.id) }
                    val shouldNotifyAboutChat = store.isChatNotificationsEnabled(profile.id)
                    val shouldNotifyAboutMentions = store.isMentionNotificationsEnabled(profile.id)
                    if ((shouldNotifyAboutChat && mentionMessage == null) || (shouldNotifyAboutMentions && mentionMessage != null) || (shouldNotifyAboutChat && mentionMessage != null)) {
                        val target = mentionMessage ?: unreadMessages.maxBy { it.createdAtClient }
                        val title = applicationContext.getString(
                            if (mentionMessage != null) R.string.chat_notification_mention_title else R.string.chat_notification_title
                        )
                        val body = applicationContext.getString(
                            if (mentionMessage != null) R.string.chat_notification_mention_body else R.string.chat_notification_body,
                            target.senderName,
                            target.text
                        )
                        EventNotificationHelper.showChatNotification(applicationContext, title, body, destination = "chat")
                    }
                    store.setLastChatNotificationTimestamp(profile.id, latestChatTimestamp)
                }
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val EVENT_CHECK_LIMIT = 10L
        private const val CHAT_CHECK_LIMIT = 20L
    }
}
