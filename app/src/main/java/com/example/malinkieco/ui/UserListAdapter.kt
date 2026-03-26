package com.example.malinkieco.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.R
import com.example.malinkieco.data.RemoteUser
import com.example.malinkieco.data.Role

class UserListAdapter(
    private val currentUserIdProvider: () -> String?,
    private val canManageUsers: Boolean,
    private val canManageModerators: Boolean,
    private val onEditBalance: (RemoteUser) -> Unit,
    private val onDelete: (RemoteUser) -> Unit,
    private val onPromoteModerator: (RemoteUser) -> Unit,
    private val onDemoteModerator: (RemoteUser) -> Unit
) : ListAdapter<RemoteUser, UserListAdapter.UserViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): UserViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_user, parent, false)
        return UserViewHolder(view)
    }

    override fun onBindViewHolder(holder: UserViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class UserViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val title: TextView = itemView.findViewById(R.id.tvUserTitle)
        private val email: TextView = itemView.findViewById(R.id.tvUserEmail)
        private val role: TextView = itemView.findViewById(R.id.tvUserRole)
        private val balance: TextView = itemView.findViewById(R.id.tvUserBalance)
        private val status: TextView = itemView.findViewById(R.id.tvUserStatus)
        private val editBalanceButton: ImageButton = itemView.findViewById(R.id.btnEditBalance)
        private val deleteButton: Button = itemView.findViewById(R.id.btnDeleteUser)
        private val moderatorRow: LinearLayout = itemView.findViewById(R.id.moderatorButtonsRow)
        private val promoteButton: Button = itemView.findViewById(R.id.btnPromoteModerator)
        private val demoteButton: Button = itemView.findViewById(R.id.btnDemoteModerator)

        fun bind(user: RemoteUser) {
            title.text = "${user.plotName}  ${user.fullName}"
            email.text = user.email
            role.text = roleLabel(user.role)
            balance.text = itemView.context.getString(R.string.balance_format, user.balance)
            status.text = balanceStatus(user.balance)

            val adminVisibility = if (canManageUsers) View.VISIBLE else View.GONE
            editBalanceButton.visibility = adminVisibility
            deleteButton.visibility = adminVisibility

            val canManageModerator = canManageModerators &&
                user.id != currentUserIdProvider() &&
                user.role != Role.ADMIN
            moderatorRow.visibility = if (canManageModerator) View.VISIBLE else View.GONE
            promoteButton.visibility = if (canManageModerator && user.role == Role.USER) View.VISIBLE else View.GONE
            demoteButton.visibility = if (canManageModerator && user.role == Role.MODERATOR) View.VISIBLE else View.GONE

            editBalanceButton.setOnClickListener { onEditBalance(user) }
            deleteButton.setOnClickListener { onDelete(user) }
            promoteButton.setOnClickListener { onPromoteModerator(user) }
            demoteButton.setOnClickListener { onDemoteModerator(user) }
        }

        private fun balanceStatus(balance: Int): String {
            return when {
                balance > 0 -> itemView.context.getString(R.string.status_overpaid)
                balance < 0 -> itemView.context.getString(R.string.status_debt)
                else -> itemView.context.getString(R.string.status_clear)
            }
        }

        private fun roleLabel(role: Role): String {
            return when (role) {
                Role.ADMIN -> itemView.context.getString(R.string.role_admin)
                Role.MODERATOR -> itemView.context.getString(R.string.role_moderator)
                Role.USER -> itemView.context.getString(R.string.role_user)
            }
        }
    }

    private object DiffCallback : DiffUtil.ItemCallback<RemoteUser>() {
        override fun areItemsTheSame(oldItem: RemoteUser, newItem: RemoteUser): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: RemoteUser, newItem: RemoteUser): Boolean = oldItem == newItem
    }
}
