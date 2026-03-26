package com.example.malinkieco.data

import com.example.malinkieco.BuildConfig
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class PaymentBackendClient {
    fun isConfigured(): Boolean = BuildConfig.PAYMENTS_BACKEND_URL.isNotBlank()

    fun createPaymentSession(
        idToken: String,
        amount: Int,
        userId: String,
        userName: String
    ): PaymentCheckoutSession {
        val payload = JSONObject()
            .put("amount", amount)
            .put("userId", userId)
            .put("userName", userName)

        val response = request(
            path = "/api/payments/create",
            method = "POST",
            idToken = idToken,
            body = payload.toString()
        )

        return PaymentCheckoutSession(
            orderId = response.getString("orderId"),
            confirmationUrl = response.getString("confirmationUrl"),
            status = response.optString("status")
                .takeIf { it.isNotBlank() }
                ?.let(::parseStatus)
                ?: PaymentOrderStatus.PENDING
        )
    }

    fun getPaymentOrder(idToken: String, orderId: String): PaymentOrder {
        val response = request(
            path = "/api/payments/$orderId",
            method = "GET",
            idToken = idToken
        )

        return PaymentOrder(
            id = response.getString("id"),
            amount = response.getInt("amount"),
            status = parseStatus(response.optString("status")),
            confirmationUrl = response.optString("confirmationUrl").takeIf { it.isNotBlank() }
        )
    }

    private fun request(
        path: String,
        method: String,
        idToken: String,
        body: String? = null
    ): JSONObject {
        val baseUrl = BuildConfig.PAYMENTS_BACKEND_URL.trim().trimEnd('/')
        require(baseUrl.isNotBlank()) { "Payments backend url is not configured" }

        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            setRequestProperty("Authorization", "Bearer $idToken")
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }

        try {
            if (body != null) {
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(body)
                }
            }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val content = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(content).optString("error") }.getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "HTTP $code"
                error(message)
            }
            return JSONObject(content)
        } finally {
            connection.disconnect()
        }
    }

    private fun parseStatus(value: String): PaymentOrderStatus {
        return runCatching { PaymentOrderStatus.valueOf(value.uppercase()) }
            .getOrDefault(PaymentOrderStatus.UNKNOWN)
    }
}
