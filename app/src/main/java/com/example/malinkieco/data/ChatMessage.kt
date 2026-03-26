package com.example.malinkieco.data

data class ChatMessage(
    val id: String,
    val senderId: String,
    val senderName: String,
    val text: String,
    val createdAtClient: Long,
    val updatedAtClient: Long = 0L
)
