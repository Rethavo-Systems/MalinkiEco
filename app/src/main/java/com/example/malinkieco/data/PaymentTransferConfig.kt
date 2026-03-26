package com.example.malinkieco.data

data class PaymentTransferConfig(
    val recipientName: String = "",
    val recipientPhone: String = "",
    val bankName: String = "",
    val sbpLink: String = ""
) {
    fun isConfigured(): Boolean {
        return recipientPhone.isNotBlank() || sbpLink.isNotBlank()
    }
}
