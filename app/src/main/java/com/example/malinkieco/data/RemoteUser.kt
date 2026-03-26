package com.example.malinkieco.data

data class RemoteUser(
    val id: String,
    val login: String = "",
    val email: String,
    val fullName: String,
    val plotName: String,
    val plots: List<String> = emptyList(),
    val role: Role,
    val balance: Int = 0,
    val lastChatReadAt: Long = 0L
)
