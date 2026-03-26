package com.example.malinkieco.data

data class ManualPaymentRequest(
    val id: String,
    val userId: String,
    val userName: String,
    val plotName: String = "",
    val amount: Int,
    val eventId: String = "",
    val eventTitle: String = "",
    val purpose: String = "",
    val status: ManualPaymentStatus,
    val createdAtClient: Long,
    val reviewedByName: String = "",
    val reviewReason: String = ""
)
