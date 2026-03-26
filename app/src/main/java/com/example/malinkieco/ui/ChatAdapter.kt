package com.example.malinkieco.ui

import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.R
import com.example.malinkieco.data.ChatMessage
import com.google.android.material.card.MaterialCardView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ChatAdapter(
    private val currentUserIdProvider: () -> String?,
    private val readerCutoffProvider: () -> Long,
    private val onEditMessage: (ChatMessage) -> Unit,
    private val onDeleteMessage: (ChatMessage) -> Unit
) : ListAdapter<ChatMessage, ChatAdapter.ChatViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_chat_message, parent, false)
        return ChatViewHolder(view)
    }

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ChatViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val card: MaterialCardView = itemView.findViewById(R.id.cardMessage)
        private val sender: TextView = itemView.findViewById(R.id.tvSenderName)
        private val message: TextView = itemView.findViewById(R.id.tvMessageText)
        private val time: TextView = itemView.findViewById(R.id.tvMessageTime)
        private val status: TextView = itemView.findViewById(R.id.tvMessageStatus)

        fun bind(item: ChatMessage) {
            sender.text = item.senderName
            message.text = item.text
            val editedSuffix = if (item.updatedAtClient > item.createdAtClient) {
                itemView.context.getString(R.string.chat_message_edited_suffix)
            } else {
                ""
            }
            time.text = TIME_FORMAT.format(Date(item.createdAtClient)) + editedSuffix

            val isMine = item.senderId == currentUserIdProvider()
            val lp = card.layoutParams as FrameLayout.LayoutParams
            if (isMine) {
                lp.marginStart = itemView.resources.getDimensionPixelSize(R.dimen.chat_margin_large)
                lp.marginEnd = 0
                lp.gravity = Gravity.END
                card.setCardBackgroundColor(ContextCompat.getColor(itemView.context, R.color.chat_mine))
            } else {
                lp.marginStart = 0
                lp.marginEnd = itemView.resources.getDimensionPixelSize(R.dimen.chat_margin_large)
                lp.gravity = Gravity.START
                card.setCardBackgroundColor(ContextCompat.getColor(itemView.context, R.color.chat_other))
            }
            card.layoutParams = lp

            status.visibility = if (isMine) View.VISIBLE else View.GONE
            if (isMine) {
                status.text = if (readerCutoffProvider() >= item.createdAtClient) {
                    itemView.context.getString(R.string.chat_status_read)
                } else {
                    itemView.context.getString(R.string.chat_status_sent)
                }
                card.setOnLongClickListener {
                    showMessageActions(item)
                    true
                }
            } else {
                card.setOnLongClickListener(null)
            }
        }

        private fun showMessageActions(item: ChatMessage) {
            androidx.appcompat.widget.PopupMenu(itemView.context, card).apply {
                menu.add(0, 1, 0, R.string.chat_action_edit)
                menu.add(0, 2, 1, R.string.chat_action_delete)
                setOnMenuItemClickListener { menuItem ->
                    when (menuItem.itemId) {
                        1 -> onEditMessage(item)
                        2 -> onDeleteMessage(item)
                    }
                    true
                }
            }.show()
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<ChatMessage>() {
        override fun areItemsTheSame(oldItem: ChatMessage, newItem: ChatMessage): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: ChatMessage, newItem: ChatMessage): Boolean = oldItem == newItem
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("HH:mm", Locale.getDefault())
    }
}
