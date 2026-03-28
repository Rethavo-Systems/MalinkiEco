package com.example.malinkieco.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.R
import com.example.malinkieco.data.AuditLogEntry
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AuditLogAdapter : ListAdapter<AuditLogEntry, AuditLogAdapter.LogViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LogViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_audit_log, parent, false)
        return LogViewHolder(view)
    }

    override fun onBindViewHolder(holder: LogViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class LogViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvLogTitle)
        private val meta: TextView = itemView.findViewById(R.id.tvLogMeta)
        private val message: TextView = itemView.findViewById(R.id.tvLogMessage)
        private val target: TextView = itemView.findViewById(R.id.tvLogTarget)
        private val formatter = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru"))

        fun bind(entry: AuditLogEntry) {
            title.text = entry.title
            meta.text = itemView.context.getString(
                R.string.audit_log_meta_format,
                entry.actorName,
                formatter.format(Date(entry.createdAtClient))
            )
            message.text = entry.message
            if (entry.targetUserName.isBlank()) {
                target.visibility = View.GONE
            } else {
                target.visibility = View.VISIBLE
                val targetLine = if (entry.targetPlotName.isBlank()) {
                    itemView.context.getString(R.string.audit_log_target_format, entry.targetUserName)
                } else {
                    itemView.context.getString(
                        R.string.audit_log_target_with_plot_format,
                        entry.targetUserName,
                        entry.targetPlotName
                    )
                }
                target.text = targetLine
            }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<AuditLogEntry>() {
        override fun areItemsTheSame(oldItem: AuditLogEntry, newItem: AuditLogEntry): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: AuditLogEntry, newItem: AuditLogEntry): Boolean = oldItem == newItem
    }
}
