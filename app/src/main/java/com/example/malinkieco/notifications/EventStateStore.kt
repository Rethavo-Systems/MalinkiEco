package com.example.malinkieco.notifications

import android.content.Context
import com.example.malinkieco.data.CommunityEvent
import com.example.malinkieco.data.ChatMessage

class EventStateStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getLastSeenEventTimestamp(userId: String): Long {
        return preferences.getLong(lastSeenEventKey(userId), 0L)
    }

    fun setLastSeenEventTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastSeenEventKey(userId), timestamp).apply()
    }

    fun getLastSeenPollTimestamp(userId: String): Long {
        return preferences.getLong(lastSeenPollKey(userId), 0L)
    }

    fun setLastSeenPollTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastSeenPollKey(userId), timestamp).apply()
    }

    fun getLastBackgroundNotificationTimestamp(userId: String): Long {
        return preferences.getLong(lastBackgroundNotificationKey(userId), 0L)
    }

    fun setLastBackgroundNotificationTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastBackgroundNotificationKey(userId), timestamp).apply()
    }

    fun getLastSeenChatTimestamp(userId: String): Long {
        return preferences.getLong(lastSeenChatKey(userId), 0L)
    }

    fun setLastSeenChatTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastSeenChatKey(userId), timestamp).apply()
    }

    fun getLastChatNotificationTimestamp(userId: String): Long {
        return preferences.getLong(lastChatNotificationKey(userId), 0L)
    }

    fun setLastChatNotificationTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastChatNotificationKey(userId), timestamp).apply()
    }

    fun isChatNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(chatNotificationsEnabledKey(userId), true)
    }

    fun setChatNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(chatNotificationsEnabledKey(userId), enabled).apply()
    }

    fun isMentionNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(mentionNotificationsEnabledKey(userId), true)
    }

    fun setMentionNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(mentionNotificationsEnabledKey(userId), enabled).apply()
    }

    fun clear(userId: String) {
        preferences.edit()
            .remove(lastSeenEventKey(userId))
            .remove(lastSeenPollKey(userId))
            .remove(lastBackgroundNotificationKey(userId))
            .remove(lastSeenChatKey(userId))
            .remove(lastChatNotificationKey(userId))
            .remove(chatNotificationsEnabledKey(userId))
            .remove(mentionNotificationsEnabledKey(userId))
            .apply()
    }

    fun unreadEvents(userId: String, events: List<CommunityEvent>): List<CommunityEvent> {
        val lastSeenTimestamp = getLastSeenEventTimestamp(userId)
        return events.filter { it.createdAtClient > lastSeenTimestamp }
    }

    fun unreadPolls(userId: String, polls: List<CommunityEvent>): List<CommunityEvent> {
        val lastSeenTimestamp = getLastSeenPollTimestamp(userId)
        return polls.filter { !it.isClosed && it.createdAtClient > lastSeenTimestamp }
    }

    fun unreadChatMessages(userId: String, messages: List<ChatMessage>): List<ChatMessage> {
        val lastSeenTimestamp = getLastSeenChatTimestamp(userId)
        return messages.filter { it.senderId != userId && it.createdAtClient > lastSeenTimestamp }
    }

    private fun lastSeenEventKey(userId: String): String = "last_seen_events_$userId"

    private fun lastSeenPollKey(userId: String): String = "last_seen_polls_$userId"

    private fun lastBackgroundNotificationKey(userId: String): String = "last_background_notification_$userId"

    private fun lastSeenChatKey(userId: String): String = "last_seen_chat_$userId"

    private fun lastChatNotificationKey(userId: String): String = "last_chat_notification_$userId"

    private fun chatNotificationsEnabledKey(userId: String): String = "chat_notifications_enabled_$userId"

    private fun mentionNotificationsEnabledKey(userId: String): String = "mention_notifications_enabled_$userId"

    companion object {
        private const val PREFS_NAME = "event_state_store"
    }
}
