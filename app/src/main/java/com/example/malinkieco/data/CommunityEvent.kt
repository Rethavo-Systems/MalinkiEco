package com.example.malinkieco.data

data class CommunityEvent(
    val id: String,
    val title: String,
    val message: String,
    val type: EventType,
    val amount: Int,
    val isClosed: Boolean = false,
    val pollOptions: List<String> = emptyList(),
    val pollVotes: Map<String, Int> = emptyMap(),
    val voterIds: List<String> = emptyList(),
    val voterChoices: Map<String, String> = emptyMap(),
    val targetUserId: String = "",
    val createdById: String,
    val createdByName: String,
    val createdAtClient: Long
)
