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
import com.example.malinkieco.data.RegistrationRequest
import com.example.malinkieco.data.RegistrationRequestStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class RegistrationRequestAdapter(
    private val onApprove: (RegistrationRequest) -> Unit,
    private val onReject: (RegistrationRequest) -> Unit
) : ListAdapter<RegistrationRequest, RegistrationRequestAdapter.RequestViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RequestViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_registration_request, parent, false)
        return RequestViewHolder(view)
    }

    override fun onBindViewHolder(holder: RequestViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class RequestViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvRegistrationTitle)
        private val meta: TextView = itemView.findViewById(R.id.tvRegistrationMeta)
        private val status: TextView = itemView.findViewById(R.id.tvRegistrationStatus)
        private val reason: TextView = itemView.findViewById(R.id.tvRegistrationReason)
        private val approveButton: Button = itemView.findViewById(R.id.btnApproveRegistration)
        private val rejectButton: Button = itemView.findViewById(R.id.btnRejectRegistration)

        fun bind(request: RegistrationRequest) {
            title.text = itemView.context.getString(
                R.string.registration_request_title,
                request.fullName,
                request.login
            )
            meta.text = itemView.context.getString(
                R.string.registration_request_meta,
                request.plots.joinToString(", "),
                TIME_FORMAT.format(Date(request.createdAtClient))
            )
            status.text = when (request.status) {
                RegistrationRequestStatus.PENDING -> itemView.context.getString(R.string.registration_request_pending)
                RegistrationRequestStatus.APPROVED -> itemView.context.getString(
                    R.string.registration_request_approved,
                    request.reviewedByName
                )
                RegistrationRequestStatus.REJECTED -> itemView.context.getString(
                    R.string.registration_request_rejected,
                    request.reviewedByName
                )
            }

            reason.visibility = if (request.reviewReason.isBlank()) View.GONE else View.VISIBLE
            reason.text = itemView.context.getString(R.string.registration_request_reason, request.reviewReason)

            val showActions = request.status == RegistrationRequestStatus.PENDING
            approveButton.visibility = if (showActions) View.VISIBLE else View.GONE
            rejectButton.visibility = if (showActions) View.VISIBLE else View.GONE
            approveButton.setOnClickListener { onApprove(request) }
            rejectButton.setOnClickListener { onReject(request) }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<RegistrationRequest>() {
        override fun areItemsTheSame(oldItem: RegistrationRequest, newItem: RegistrationRequest): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: RegistrationRequest, newItem: RegistrationRequest): Boolean = oldItem == newItem
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())
    }
}
