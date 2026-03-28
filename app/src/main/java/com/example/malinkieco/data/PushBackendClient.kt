package com.example.malinkieco.data

import com.example.malinkieco.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class PushBackendClient {
    fun isConfigured(): Boolean = BuildConfig.PAYMENTS_BACKEND_URL.isNotBlank()

    fun registerDeviceToken(
        idToken: String,
        fcmToken: String
    ) {
        request(
            path = "/api/notifications/register-device",
            method = "POST",
            idToken = idToken,
            body = JSONObject()
                .put("token", fcmToken)
                .toString()
        )
    }

    fun publishBroadcast(
        idToken: String,
        title: String,
        body: String,
        destination: String,
        excludedUserIds: List<String> = emptyList()
    ) {
        request(
            path = "/api/notifications/publish",
            method = "POST",
            idToken = idToken,
            body = JSONObject()
                .put("audience", "broadcast")
                .put("title", title)
                .put("body", body)
                .put("destination", destination)
                .put("excludedUserIds", JSONArray(excludedUserIds))
                .toString()
        )
    }

    fun publishToUsers(
        idToken: String,
        userIds: List<String>,
        title: String,
        body: String,
        destination: String
    ) {
        if (userIds.isEmpty()) return
        request(
            path = "/api/notifications/publish",
            method = "POST",
            idToken = idToken,
            body = JSONObject()
                .put("audience", "users")
                .put("title", title)
                .put("body", body)
                .put("destination", destination)
                .put("targetUserIds", JSONArray(userIds.distinct()))
                .toString()
        )
    }

    private fun request(
        path: String,
        method: String,
        idToken: String,
        body: String? = null
    ): JSONObject {
        val baseUrl = BuildConfig.PAYMENTS_BACKEND_URL.trim().trimEnd('/')
        require(baseUrl.isNotBlank()) { "Backend url is not configured" }

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
            return if (content.isBlank()) JSONObject() else JSONObject(content)
        } finally {
            connection.disconnect()
        }
    }
}
