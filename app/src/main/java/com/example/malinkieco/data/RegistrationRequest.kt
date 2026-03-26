package com.example.malinkieco.data

data class RegistrationRequest(
    val id: String,
    val login: String,
    val authEmail: String,
    val fullName: String,
    val plots: List<String>,
    val status: RegistrationRequestStatus,
    val createdAtClient: Long,
    val reviewedByName: String = "",
    val reviewReason: String = ""
)
