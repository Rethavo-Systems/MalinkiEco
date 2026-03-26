package com.example.malinkieco.data

data class RemotePayment(
    val userId: String,
    val amount: Int,
    val note: String,
    val createdAt: Long = System.currentTimeMillis()
)
