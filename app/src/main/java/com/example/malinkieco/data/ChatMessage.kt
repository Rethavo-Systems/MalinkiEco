package com.example.malinkieco.data

data class ChatMessage(
    val id: String,
    val senderId: String,
    val senderName: String,
    val senderPlotName: String = "",
    val text: String,
    val replyToMessageId: String = "",
    val replyToSenderName: String = "",
    val replyToSenderPlotName: String = "",
    val replyToText: String = "",
    val mentionedUserIds: List<String> = emptyList(),
    val isPinned: Boolean = false,
    val pinnedByUserId: String = "",
    val pinnedByUserName: String = "",
    val pinnedAtClient: Long = 0L,
    val createdAtClient: Long,
    val updatedAtClient: Long = 0L
)
