package com.example.malinkieco.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.R
import com.example.malinkieco.data.CommunityEvent
import com.example.malinkieco.data.EventType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class EventAdapter(
    private val lastSeenTimestampProvider: () -> Long,
    private val canCloseChargesProvider: () -> Boolean,
    private val onCloseCharge: (CommunityEvent) -> Unit
) : ListAdapter<CommunityEvent, EventAdapter.EventViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): EventViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_event, parent, false)
        return EventViewHolder(view)
    }

    override fun onBindViewHolder(holder: EventViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class EventViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvEventTitle)
        private val meta: TextView = itemView.findViewById(R.id.tvEventMeta)
        private val message: TextView = itemView.findViewById(R.id.tvEventMessage)
        private val badge: TextView = itemView.findViewById(R.id.tvEventBadge)
        private val unreadMarker: TextView = itemView.findViewById(R.id.tvUnreadMarker)
        private val closeChargeButton: Button = itemView.findViewById(R.id.btnCloseCharge)

        fun bind(event: CommunityEvent) {
            title.text = event.title
            message.text = event.message
            meta.text = itemView.context.getString(
                R.string.event_meta_format,
                event.createdByName,
                TIME_FORMAT.format(Date(event.createdAtClient))
            )
            badge.text = when (event.type) {
                EventType.INFO -> itemView.context.getString(R.string.event_type_info)
                EventType.CHARGE -> if (event.isClosed) {
                    itemView.context.getString(R.string.event_type_charge_closed_with_amount, event.amount)
                } else {
                    itemView.context.getString(R.string.event_type_charge_with_amount, event.amount)
                }
                EventType.EXPENSE -> itemView.context.getString(R.string.event_type_expense_with_amount, event.amount)
                EventType.POLL -> if (event.isClosed) {
                    itemView.context.getString(R.string.event_type_poll_closed)
                } else {
                    itemView.context.getString(R.string.event_type_poll)
                }
            }

            val isUnread = event.createdAtClient > lastSeenTimestampProvider()
            unreadMarker.visibility = if (isUnread) View.VISIBLE else View.GONE
            itemView.alpha = if (isUnread) 1f else 0.84f

            closeChargeButton.text = if (event.type == EventType.POLL) {
                itemView.context.getString(R.string.close_poll_button)
            } else {
                itemView.context.getString(R.string.close_charge_button)
            }
            val canClose = (event.type == EventType.CHARGE || event.type == EventType.POLL) && !event.isClosed && canCloseChargesProvider()
            closeChargeButton.visibility = if (canClose) View.VISIBLE else View.GONE
            closeChargeButton.setOnClickListener { onCloseCharge(event) }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<CommunityEvent>() {
        override fun areItemsTheSame(oldItem: CommunityEvent, newItem: CommunityEvent): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: CommunityEvent, newItem: CommunityEvent): Boolean = oldItem == newItem
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())
    }
}
