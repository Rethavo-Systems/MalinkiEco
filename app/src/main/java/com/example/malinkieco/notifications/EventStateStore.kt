package com.example.malinkieco.notifications

import android.content.Context
import com.example.malinkieco.data.CommunityEvent

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

    fun clear(userId: String) {
        preferences.edit()
            .remove(lastSeenEventKey(userId))
            .remove(lastSeenPollKey(userId))
            .remove(lastBackgroundNotificationKey(userId))
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

    private fun lastSeenEventKey(userId: String): String = "last_seen_events_$userId"

    private fun lastSeenPollKey(userId: String): String = "last_seen_polls_$userId"

    private fun lastBackgroundNotificationKey(userId: String): String = "last_background_notification_$userId"

    companion object {
        private const val PREFS_NAME = "event_state_store"
    }
}
