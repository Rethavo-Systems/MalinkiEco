package com.example.malinkieco.data

data class PaymentOrder(
    val id: String,
    val amount: Int,
    val status: PaymentOrderStatus,
    val confirmationUrl: String? = null
)
