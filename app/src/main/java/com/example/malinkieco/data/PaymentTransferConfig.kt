package com.example.malinkieco.data

data class PaymentTransferConfig(
    val recipientName: String = "",
    val recipientPhone: String = "",
    val bankName: String = "",
    val accountNumber: String = "",
    val paymentPurpose: String = "",
    val bik: String = "",
    val correspondentAccount: String = "",
    val recipientInn: String = "",
    val recipientKpp: String = "",
    val sbpLink: String = ""
) {
    fun isConfigured(): Boolean {
        return recipientName.isNotBlank() ||
            recipientPhone.isNotBlank() ||
            bankName.isNotBlank() ||
            accountNumber.isNotBlank() ||
            paymentPurpose.isNotBlank() ||
            bik.isNotBlank() ||
            correspondentAccount.isNotBlank() ||
            recipientInn.isNotBlank() ||
            recipientKpp.isNotBlank() ||
            sbpLink.isNotBlank()
    }
}
