package com.example.malinkieco.data

data class PaymentCheckoutSession(
    val orderId: String,
    val confirmationUrl: String,
    val status: PaymentOrderStatus
)
