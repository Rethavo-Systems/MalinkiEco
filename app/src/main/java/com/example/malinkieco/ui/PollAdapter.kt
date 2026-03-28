package com.example.malinkieco.ui

import android.graphics.drawable.GradientDrawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.widget.AppCompatTextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.R
import com.example.malinkieco.data.CommunityEvent
import com.google.android.material.button.MaterialButton
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PollAdapter(
    private val currentUserIdProvider: () -> String?,
    private val canClosePollProvider: (CommunityEvent) -> Boolean,
    private val onVote: (CommunityEvent, String) -> Unit,
    private val onClosePoll: (CommunityEvent) -> Unit
) : ListAdapter<CommunityEvent, PollAdapter.PollViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PollViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_poll, parent, false)
        return PollViewHolder(view)
    }

    override fun onBindViewHolder(holder: PollViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class PollViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvPollTitle)
        private val meta: TextView = itemView.findViewById(R.id.tvPollMeta)
        private val message: TextView = itemView.findViewById(R.id.tvPollMessage)
        private val badge: TextView = itemView.findViewById(R.id.tvPollBadge)
        private val optionsContainer: LinearLayout = itemView.findViewById(R.id.pollOptionsContainer)
        private val btnClosePoll: MaterialButton = itemView.findViewById(R.id.btnClosePoll)

        fun bind(event: CommunityEvent) {
            val context = itemView.context
            val currentUserId = currentUserIdProvider()
            val hasVoted = currentUserId != null && event.voterIds.contains(currentUserId)
            val winningVotes = event.pollVotes.values.maxOrNull() ?: 0

            title.text = event.title
            message.text = event.message
            meta.text = context.getString(
                R.string.event_meta_format,
                event.createdByName,
                TIME_FORMAT.format(Date(event.createdAtClient))
            )
            badge.text = if (event.isClosed) {
                context.getString(R.string.event_type_poll_closed)
            } else {
                context.getString(R.string.event_type_poll)
            }

            optionsContainer.removeAllViews()
            if (event.pollOptions.isEmpty()) {
                optionsContainer.addView(
                    AppCompatTextView(context).apply {
                        text = context.getString(R.string.poll_options_empty)
                    }
                )
            }
            event.pollOptions.forEach { option ->
                val votes = event.pollVotes[option] ?: 0
                if (!hasVoted && !event.isClosed) {
                    val button = MaterialButton(context).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT
                        ).also { params ->
                            params.topMargin = 8.dp(context)
                        }
                        text = option
                        setOnClickListener { onVote(event, option) }
                    }
                    optionsContainer.addView(button)
                } else {
                    val row = AppCompatTextView(context).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT
                        ).also { params ->
                            params.topMargin = 8.dp(context)
                        }
                        background = GradientDrawable().apply {
                            cornerRadius = 18.dp(context).toFloat()
                            setColor(
                                when {
                                    votes > 0 && votes == winningVotes -> ContextCompat.getColor(context, R.color.primary_container_light)
                                    else -> ContextCompat.getColor(context, R.color.surface_variant_light)
                                }
                            )
                        }
                        setPadding(24, 20, 24, 20)
                        text = buildString {
                            append(option)
                            append(" - ")
                            append(
                                context.resources.getQuantityString(
                                    R.plurals.poll_votes_count,
                                    votes,
                                    votes
                                )
                            )
                            if (currentUserId != null && event.voterChoices[currentUserId] == option) {
                                append(" | ")
                                append(context.getString(R.string.poll_your_choice))
                            }
                            if (votes > 0 && votes == winningVotes) {
                                append(" | ")
                                append(context.getString(R.string.poll_leading_label))
                            }
                        }
                    }
                    optionsContainer.addView(row)
                }
            }

            btnClosePoll.visibility = if (!event.isClosed && canClosePollProvider(event)) View.VISIBLE else View.GONE
            btnClosePoll.setOnClickListener { onClosePoll(event) }
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

private fun Int.dp(viewContext: android.content.Context): Int {
    return (this * viewContext.resources.displayMetrics.density).toInt()
}
