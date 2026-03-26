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
import com.example.malinkieco.data.ManualPaymentRequest
import com.example.malinkieco.data.ManualPaymentStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PaymentRequestAdapter(
    private val canReviewProvider: () -> Boolean,
    private val onConfirm: (ManualPaymentRequest) -> Unit,
    private val onReject: (ManualPaymentRequest) -> Unit
) : ListAdapter<ManualPaymentRequest, PaymentRequestAdapter.PaymentRequestViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PaymentRequestViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_payment_request, parent, false)
        return PaymentRequestViewHolder(view)
    }

    override fun onBindViewHolder(holder: PaymentRequestViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class PaymentRequestViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvPaymentRequestTitle)
        private val meta: TextView = itemView.findViewById(R.id.tvPaymentRequestMeta)
        private val status: TextView = itemView.findViewById(R.id.tvPaymentRequestStatus)
        private val reason: TextView = itemView.findViewById(R.id.tvPaymentRequestReason)
        private val confirmButton: Button = itemView.findViewById(R.id.btnConfirmPayment)
        private val rejectButton: Button = itemView.findViewById(R.id.btnRejectPayment)

        fun bind(request: ManualPaymentRequest) {
            title.text = itemView.context.getString(
                R.string.payment_request_title,
                request.userName,
                request.amount
            )
            val time = TIME_FORMAT.format(Date(request.createdAtClient))
            meta.text = if (request.eventTitle.isBlank()) {
                if (request.purpose.isBlank()) {
                    itemView.context.getString(
                        R.string.payment_request_meta_with_plot,
                        time,
                        request.plotName
                    )
                } else {
                    itemView.context.getString(
                        R.string.payment_request_meta_with_plot_and_purpose,
                        time,
                        request.plotName,
                        request.purpose
                    )
                }
            } else {
                itemView.context.getString(
                    R.string.payment_request_meta_with_plot_and_event,
                    time,
                    request.plotName,
                    request.eventTitle
                )
            }
            status.text = when (request.status) {
                ManualPaymentStatus.PENDING -> itemView.context.getString(R.string.payment_request_pending)
                ManualPaymentStatus.CONFIRMED -> itemView.context.getString(
                    R.string.payment_request_confirmed,
                    request.reviewedByName.ifBlank { itemView.context.getString(R.string.payment_request_without_reviewer) }
                )
                ManualPaymentStatus.REJECTED -> itemView.context.getString(
                    R.string.payment_request_rejected,
                    request.reviewedByName.ifBlank { itemView.context.getString(R.string.payment_request_without_reviewer) }
                )
            }

            reason.visibility = if (request.reviewReason.isBlank()) View.GONE else View.VISIBLE
            reason.text = itemView.context.getString(R.string.payment_request_reason, request.reviewReason)

            val showActions = canReviewProvider() && request.status == ManualPaymentStatus.PENDING
            confirmButton.visibility = if (showActions) View.VISIBLE else View.GONE
            rejectButton.visibility = if (showActions) View.VISIBLE else View.GONE

            confirmButton.setOnClickListener { onConfirm(request) }
            rejectButton.setOnClickListener { onReject(request) }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<ManualPaymentRequest>() {
        override fun areItemsTheSame(oldItem: ManualPaymentRequest, newItem: ManualPaymentRequest): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: ManualPaymentRequest, newItem: ManualPaymentRequest): Boolean = oldItem == newItem
    }

    companion object {
        private val TIME_FORMAT = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault())
    }
}
