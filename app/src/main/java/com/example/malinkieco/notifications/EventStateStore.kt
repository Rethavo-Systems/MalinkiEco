package com.example.malinkieco.notifications

import android.content.Context
import com.example.malinkieco.data.CommunityEvent
import com.example.malinkieco.data.ChatMessage

class EventStateStore(context: Context) {
    enum class ThemeMode {
        SYSTEM, LIGHT, DARK
    }

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

    fun getLastPollNotificationTimestamp(userId: String): Long {
        return preferences.getLong(lastPollNotificationKey(userId), 0L)
    }

    fun setLastPollNotificationTimestamp(userId: String, timestamp: Long) {
        preferences.edit().putLong(lastPollNotificationKey(userId), timestamp).apply()
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

    fun isEventNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(eventNotificationsEnabledKey(userId), true)
    }

    fun setEventNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(eventNotificationsEnabledKey(userId), enabled).apply()
    }

    fun isPollNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(pollNotificationsEnabledKey(userId), true)
    }

    fun setPollNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(pollNotificationsEnabledKey(userId), enabled).apply()
    }

    fun isPaymentNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(paymentNotificationsEnabledKey(userId), true)
    }

    fun setPaymentNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(paymentNotificationsEnabledKey(userId), enabled).apply()
    }

    fun isRegistrationNotificationsEnabled(userId: String): Boolean {
        return preferences.getBoolean(registrationNotificationsEnabledKey(userId), true)
    }

    fun setRegistrationNotificationsEnabled(userId: String, enabled: Boolean) {
        preferences.edit().putBoolean(registrationNotificationsEnabledKey(userId), enabled).apply()
    }

    fun isPushRegistrationConfirmed(userId: String): Boolean {
        return preferences.getBoolean(pushRegistrationConfirmedKey(userId), false)
    }

    fun setPushRegistrationConfirmed(userId: String, confirmed: Boolean) {
        preferences.edit().putBoolean(pushRegistrationConfirmedKey(userId), confirmed).apply()
    }

    fun getThemeMode(): ThemeMode {
        val raw = preferences.getString(themeModeKey(), ThemeMode.SYSTEM.name).orEmpty()
        return runCatching { ThemeMode.valueOf(raw) }.getOrDefault(ThemeMode.SYSTEM)
    }

    fun setThemeMode(mode: ThemeMode) {
        preferences.edit().putString(themeModeKey(), mode.name).apply()
    }

    fun shouldShowNotification(userId: String, category: String): Boolean {
        return when (category) {
            "chat" -> isChatNotificationsEnabled(userId)
            "mention" -> isMentionNotificationsEnabled(userId)
            "events" -> isEventNotificationsEnabled(userId)
            "polls" -> isPollNotificationsEnabled(userId)
            "payments" -> isPaymentNotificationsEnabled(userId)
            "registration" -> isRegistrationNotificationsEnabled(userId)
            else -> true
        }
    }

    fun clear(userId: String) {
        preferences.edit()
            .remove(lastSeenEventKey(userId))
            .remove(lastSeenPollKey(userId))
            .remove(lastPollNotificationKey(userId))
            .remove(lastBackgroundNotificationKey(userId))
            .remove(lastSeenChatKey(userId))
            .remove(lastChatNotificationKey(userId))
            .remove(chatNotificationsEnabledKey(userId))
            .remove(mentionNotificationsEnabledKey(userId))
            .remove(eventNotificationsEnabledKey(userId))
            .remove(pollNotificationsEnabledKey(userId))
            .remove(paymentNotificationsEnabledKey(userId))
            .remove(registrationNotificationsEnabledKey(userId))
            .remove(pushRegistrationConfirmedKey(userId))
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

    private fun lastPollNotificationKey(userId: String): String = "last_poll_notification_$userId"

    private fun lastBackgroundNotificationKey(userId: String): String = "last_background_notification_$userId"

    private fun lastSeenChatKey(userId: String): String = "last_seen_chat_$userId"

    private fun lastChatNotificationKey(userId: String): String = "last_chat_notification_$userId"

    private fun chatNotificationsEnabledKey(userId: String): String = "chat_notifications_enabled_$userId"

    private fun mentionNotificationsEnabledKey(userId: String): String = "mention_notifications_enabled_$userId"

    private fun eventNotificationsEnabledKey(userId: String): String = "event_notifications_enabled_$userId"

    private fun pollNotificationsEnabledKey(userId: String): String = "poll_notifications_enabled_$userId"

    private fun paymentNotificationsEnabledKey(userId: String): String = "payment_notifications_enabled_$userId"

    private fun registrationNotificationsEnabledKey(userId: String): String = "registration_notifications_enabled_$userId"

    private fun pushRegistrationConfirmedKey(userId: String): String = "push_registration_confirmed_$userId"

    private fun themeModeKey(): String = "theme_mode"

    companion object {
        private const val PREFS_NAME = "event_state_store"
    }
}
