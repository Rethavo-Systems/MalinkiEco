package com.example.malinkieco.util

object PhoneFormatUtils {
    fun normalizeRussianPhone(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        return when {
            digits.length == 10 -> "8$digits"
            digits.length == 11 && (digits.startsWith("8") || digits.startsWith("7")) -> "8${digits.drop(1)}"
            else -> digits
        }
    }

    fun isValidRussianPhoneInput(raw: String): Boolean {
        return raw.filter { it.isDigit() }.length == 10
    }

    fun formatRussianPhone(raw: String): String {
        val normalized = normalizeRussianPhone(raw)
        if (normalized.length != 11 || !normalized.startsWith("8")) {
            return raw
        }
        return buildString {
            append('8')
            append(" (")
            append(normalized.substring(1, 4))
            append(") ")
            append(normalized.substring(4, 7))
            append('-')
            append(normalized.substring(7, 9))
            append('-')
            append(normalized.substring(9, 11))
        }
    }
}
