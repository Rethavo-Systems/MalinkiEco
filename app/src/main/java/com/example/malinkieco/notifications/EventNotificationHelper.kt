package com.example.malinkieco.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.example.malinkieco.MainActivity
import com.example.malinkieco.R

object EventNotificationHelper {
    fun showEventNotification(
        context: Context,
        title: String,
        body: String,
        notificationId: Int = System.currentTimeMillis().toInt(),
        destination: String = ""
    ) {
        createNotificationChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (destination.isNotBlank()) {
                putExtra(EXTRA_DESTINATION, destination)
            }
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        NotificationManagerCompat.from(context).notify(notificationId, notification)
    }

    fun showChatNotification(
        context: Context,
        title: String,
        body: String,
        notificationId: Int = System.currentTimeMillis().toInt(),
        destination: String = "chat"
    ) {
        showEventNotification(context, title, body, notificationId, destination)
    }

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.push_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = context.getString(R.string.push_channel_description)
            }
            manager.createNotificationChannel(channel)
        }
    }

    const val CHANNEL_ID = "community_events"
    const val EXTRA_DESTINATION = "notification_destination"
}
