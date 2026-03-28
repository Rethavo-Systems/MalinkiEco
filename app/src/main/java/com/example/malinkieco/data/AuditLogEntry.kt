package com.example.malinkieco.data

data class AuditLogEntry(
    val id: String,
    val actorId: String,
    val actorName: String,
    val actorRole: Role,
    val title: String,
    val message: String,
    val targetUserId: String = "",
    val targetUserName: String = "",
    val targetPlotName: String = "",
    val createdAtClient: Long
)
