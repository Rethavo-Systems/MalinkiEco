package com.example.malinkieco.notifications

import android.content.Context

class PaymentStateStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun savePendingOrder(orderId: String) {
        preferences.edit().putString(KEY_PENDING_ORDER, orderId).apply()
    }

    fun getPendingOrder(): String? = preferences.getString(KEY_PENDING_ORDER, null)

    fun clearPendingOrder() {
        preferences.edit().remove(KEY_PENDING_ORDER).apply()
    }

    companion object {
        private const val PREFS_NAME = "payment_state_store"
        private const val KEY_PENDING_ORDER = "pending_order_id"
    }
}
