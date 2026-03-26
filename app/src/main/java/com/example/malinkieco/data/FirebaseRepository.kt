package com.example.malinkieco.data

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class FirebaseRepository(
    private val context: Context,
    private val auth: FirebaseAuth,
    private val firestore: FirebaseFirestore
) {
    private val users = firestore.collection(USERS_COLLECTION)
    private val payments = firestore.collection(PAYMENTS_COLLECTION)
    private val paymentRequests = firestore.collection(PAYMENT_REQUESTS_COLLECTION)
    private val registrationRequests = firestore.collection(REGISTRATION_REQUESTS_COLLECTION)
    private val appSettings = firestore.collection(APP_SETTINGS_COLLECTION)
    private val chat = firestore.collection(CHAT_COLLECTION)
    private val events = firestore.collection(EVENTS_COLLECTION)

    fun currentAuthUser(): FirebaseUser? = auth.currentUser

    suspend fun login(email: String, password: String): RemoteUser? {
        auth.signInWithEmailAndPassword(normalizeAuthEmail(email), password).await()
        val userId = auth.currentUser?.uid ?: return null
        return getUserById(userId)
    }

    fun logout() {
        auth.signOut()
    }

    suspend fun getCurrentUserProfile(): RemoteUser? {
        val userId = auth.currentUser?.uid ?: return null
        return getUserById(userId)
    }

    suspend fun getFreshIdToken(): String? {
        return auth.currentUser?.getIdToken(true)?.await()?.token
    }

    suspend fun getAllUsers(): List<RemoteUser> {
        val snapshot = users.orderBy("plotName", Query.Direction.ASCENDING).get().await()
        return snapshot.documents.mapNotNull { it.toRemoteUser() }
    }

    suspend fun addUser(
        email: String,
        password: String,
        fullName: String,
        plotName: String
    ) {
        val uid = createAuthUserWithoutSwitchingSession(email.trim(), password)
        users.document(uid).set(
            mapOf(
                "email" to email.trim(),
                "login" to email.substringBefore("@").trim(),
                "fullName" to fullName.trim(),
                "plotName" to plotName.trim(),
                "plots" to listOf(plotName.trim()),
                "role" to Role.USER.name,
                "balance" to 0
            )
        ).await()
    }

    suspend fun submitRegistrationRequest(
        login: String,
        password: String,
        fullName: String,
        plots: List<String>
    ) {
        val normalizedLogin = login.trim()
        val normalizedPlots = plots.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        require(normalizedLogin.isNotBlank()) { "Login is required" }
        require(password.isNotBlank()) { "Password is required" }
        require(fullName.isNotBlank()) { "Full name is required" }
        require(normalizedPlots.isNotEmpty()) { "At least one plot is required" }

        try {
            val result = auth.createUserWithEmailAndPassword(normalizeAuthEmail(normalizedLogin), password).await()
            val uid = result.user?.uid ?: error("Created auth user has no uid")
            registrationRequests.document(uid).set(
                mapOf(
                    "login" to normalizedLogin,
                    "authEmail" to normalizeAuthEmail(normalizedLogin),
                    "fullName" to fullName.trim(),
                    "plots" to normalizedPlots,
                    "status" to RegistrationRequestStatus.PENDING.name,
                    "reviewedByName" to "",
                    "reviewReason" to "",
                    "createdAt" to FieldValue.serverTimestamp(),
                    "createdAtClient" to System.currentTimeMillis()
                )
            ).await()
        } finally {
            auth.signOut()
        }
    }

    suspend fun getRegistrationRequestForCurrentUser(): RegistrationRequest? {
        val uid = auth.currentUser?.uid ?: return null
        return getRegistrationRequestById(uid)
    }

    suspend fun ensureUserDocument(
        email: String,
        fullName: String,
        plotName: String,
        role: Role
    ) {
        val uid = auth.currentUser?.uid ?: return
        val existing = getUserById(uid)
        if (existing == null) {
            users.document(uid).set(
                mapOf(
                    "email" to email.trim(),
                    "fullName" to fullName.trim(),
                    "plotName" to plotName.trim(),
                    "role" to role.name,
                    "balance" to 0
                )
            ).await()
        }
    }

    suspend fun deleteUser(userId: String) {
        users.document(userId).delete().await()
    }

    suspend fun setUserRole(userId: String, role: Role) {
        users.document(userId).update("role", role.name).await()
    }

    suspend fun adminAdjustBalance(userId: String, amount: Int) {
        val user = getUserById(userId) ?: return
        users.document(userId).update("balance", user.balance + amount).await()
        payments.add(
            mapOf(
                "userId" to userId,
                "amount" to amount,
                "note" to if (amount >= 0) "Admin increase" else "Admin decrease",
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun setUserBalance(userId: String, newBalance: Int) {
        users.document(userId).update("balance", newBalance).await()
    }

    suspend fun setCommunityFunds(amount: Int) {
        appSettings.document(COMMUNITY_FUNDS_DOCUMENT).set(mapOf("amount" to amount.coerceAtLeast(0))).await()
    }

    suspend fun userPay(userId: String, amount: Int) {
        if (amount <= 0) return
        val user = getUserById(userId) ?: return
        users.document(userId).update("balance", user.balance + amount).await()
        payments.add(
            mapOf(
                "userId" to userId,
                "amount" to amount,
                "note" to "User payment",
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun createPaymentRequest(user: RemoteUser, amount: Int) {
        createPaymentRequest(user, amount, null, "")
    }

    suspend fun createPaymentRequest(user: RemoteUser, amount: Int, event: ChargeSuggestion?, purpose: String) {
        if (amount <= 0) return
        val cleanPurpose = purpose.trim()
        paymentRequests.add(
            mapOf(
                "userId" to user.id,
                "userName" to user.fullName,
                "plotName" to user.plotName,
                "amount" to amount,
                "eventId" to event?.eventId,
                "eventTitle" to event?.title.orEmpty(),
                "purpose" to cleanPurpose,
                "status" to ManualPaymentStatus.PENDING.name,
                "reviewedByName" to "",
                "reviewReason" to "",
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun confirmPaymentRequest(requestId: String, reviewer: RemoteUser) {
        val requestRef = paymentRequests.document(requestId)
        val confirmedRequest = firestore.runTransaction { transaction ->
            val requestSnapshot = transaction.get(requestRef)
            val userId = requestSnapshot.getString("userId") ?: error("Payment request userId is missing")
            val amount = (requestSnapshot.getLong("amount") ?: requestSnapshot.getDouble("amount")?.toLong())?.toInt()
                ?: error("Payment request amount is missing")
            val status = requestSnapshot.getString("status")?.let(ManualPaymentStatus::valueOf)
                ?: error("Payment request status is missing")
            if (status != ManualPaymentStatus.PENDING) return@runTransaction null

            val eventTitle = requestSnapshot.getString("eventTitle").orEmpty()
            val purpose = requestSnapshot.getString("purpose").orEmpty()

            val userRef = users.document(userId)
            val userSnapshot = transaction.get(userRef)
            val fundsRef = appSettings.document(COMMUNITY_FUNDS_DOCUMENT)
            val currentFunds = transaction.get(fundsRef).getLong("amount")?.toInt() ?: 0
            val currentBalance = userSnapshot.getLong("balance")?.toInt() ?: 0
            val updatedBalance = currentBalance + amount

            transaction.update(userRef, "balance", updatedBalance)
            transaction.update(
                requestRef,
                mapOf(
                    "status" to ManualPaymentStatus.CONFIRMED.name,
                    "reviewedById" to reviewer.id,
                    "reviewedByName" to reviewer.fullName,
                    "reviewReason" to "",
                    "reviewedAt" to FieldValue.serverTimestamp()
                )
            )
            transaction.set(
                payments.document(),
                mapOf(
                    "userId" to userId,
                    "amount" to amount,
                    "note" to if (eventTitle.isBlank()) {
                        "Manual transfer confirmed"
                    } else {
                        "Manual transfer confirmed: $eventTitle"
                    },
                    "provider" to "SBP_MANUAL",
                    "createdAt" to FieldValue.serverTimestamp(),
                    "createdAtClient" to System.currentTimeMillis()
                )
            )
            transaction.set(fundsRef, mapOf("amount" to currentFunds + amount))

            ManualPaymentRequest(
                id = requestSnapshot.id,
                userId = userId,
                userName = requestSnapshot.getString("userName").orEmpty(),
                plotName = requestSnapshot.getString("plotName").orEmpty(),
                amount = amount,
                eventId = requestSnapshot.getString("eventId").orEmpty(),
                eventTitle = eventTitle,
                purpose = purpose,
                status = ManualPaymentStatus.CONFIRMED,
                createdAtClient = requestSnapshot.getLong("createdAtClient") ?: 0L,
                reviewedByName = reviewer.fullName,
                reviewReason = ""
            )
        }.await() ?: return

        createTargetedEvent(
            creator = reviewer,
            userId = confirmedRequest.userId,
            title = "Оплата подтверждена",
            message = if (confirmedRequest.eventTitle.isNotBlank()) {
                "Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден. Назначение: ${confirmedRequest.eventTitle}."
            } else if (confirmedRequest.purpose.isNotBlank()) {
                "Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден. Назначение: ${confirmedRequest.purpose}."
            } else {
                "Ваш платеж на сумму ${confirmedRequest.amount} ₽ подтвержден."
            }
        )
    }

    suspend fun rejectPaymentRequest(requestId: String, reviewer: RemoteUser, reason: String) {
        val snapshot = paymentRequests.document(requestId).get().await()
        val request = snapshot.toManualPaymentRequest()
        paymentRequests.document(requestId).update(
            mapOf(
                "status" to ManualPaymentStatus.REJECTED.name,
                "reviewedById" to reviewer.id,
                "reviewedByName" to reviewer.fullName,
                "reviewReason" to reason.trim(),
                "reviewedAt" to FieldValue.serverTimestamp()
            )
        ).await()
        if (request != null) {
            createTargetedEvent(
                creator = reviewer,
                userId = request.userId,
                title = "Оплата отклонена",
                message = if (reason.isBlank()) {
                    "Ваш платеж на сумму ${request.amount} ₽ отклонен. Уточните детали у администратора или модератора."
                } else {
                    "Ваш платеж на сумму ${request.amount} ₽ отклонен. Причина: ${reason.trim()}."
                }
            )
        }
    }

    fun observePaymentRequests(
        currentUser: RemoteUser,
        onChange: (List<ManualPaymentRequest>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        val query = if (currentUser.role == Role.ADMIN || currentUser.role == Role.MODERATOR) {
            paymentRequests.orderBy("createdAtClient", Query.Direction.DESCENDING)
                .limit(50)
        } else {
            paymentRequests
                .whereEqualTo("userId", currentUser.id)
                .orderBy("createdAtClient", Query.Direction.DESCENDING)
                .limit(50)
        }

        return query
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }

                onChange(snapshot?.documents?.mapNotNull { it.toManualPaymentRequest() }.orEmpty())
            }
    }

    fun observeRegistrationRequests(
        onChange: (List<RegistrationRequest>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return registrationRequests.orderBy("createdAtClient", Query.Direction.DESCENDING)
            .limit(50)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toRegistrationRequest() }.orEmpty())
            }
    }

    suspend fun approveRegistrationRequest(requestId: String, reviewer: RemoteUser) {
        val requestRef = registrationRequests.document(requestId)
        firestore.runTransaction { transaction ->
            val request = transaction.get(requestRef).toRegistrationRequest()
                ?: error("Registration request not found")
            if (request.status != RegistrationRequestStatus.PENDING) {
                return@runTransaction
            }

            transaction.set(
                users.document(request.id),
                mapOf(
                    "email" to request.authEmail,
                    "login" to request.login,
                    "fullName" to request.fullName,
                    "plotName" to request.plots.joinToString(", "),
                    "plots" to request.plots,
                    "role" to Role.USER.name,
                    "balance" to 0
                )
            )
            transaction.update(
                requestRef,
                mapOf(
                    "status" to RegistrationRequestStatus.APPROVED.name,
                    "reviewedById" to reviewer.id,
                    "reviewedByName" to reviewer.fullName,
                    "reviewReason" to "",
                    "reviewedAt" to FieldValue.serverTimestamp()
                )
            )
        }.await()
    }

    suspend fun rejectRegistrationRequest(requestId: String, reviewer: RemoteUser, reason: String) {
        registrationRequests.document(requestId).update(
            mapOf(
                "status" to RegistrationRequestStatus.REJECTED.name,
                "reviewedById" to reviewer.id,
                "reviewedByName" to reviewer.fullName,
                "reviewReason" to reason.trim(),
                "reviewedAt" to FieldValue.serverTimestamp()
            )
        ).await()
    }

    suspend fun savePaymentConfig(config: PaymentTransferConfig) {
        appSettings.document(PAYMENT_CONFIG_DOCUMENT).set(
            mapOf(
                "recipientName" to config.recipientName.trim(),
                "recipientPhone" to config.recipientPhone.trim(),
                "bankName" to config.bankName.trim(),
                "sbpLink" to config.sbpLink.trim()
            )
        ).await()
    }

    suspend fun fetchAppGateConfig(): AppGateConfig? {
        val snapshot = appSettings.document(APP_GATE_DOCUMENT).get().await()
        if (!snapshot.exists()) return null
        return AppGateConfig(
            minSupportedVersionCode = snapshot.getLong("minSupportedVersionCode") ?: 1L,
            latestVersionName = snapshot.getString("latestVersionName").orEmpty(),
            updateUrl = snapshot.getString("updateUrl").orEmpty(),
            updateTitle = snapshot.getString("updateTitle").orEmpty(),
            updateMessage = snapshot.getString("updateMessage").orEmpty()
        )
    }

    fun observePaymentConfig(
        onChange: (PaymentTransferConfig) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return appSettings.document(PAYMENT_CONFIG_DOCUMENT)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }

                onChange(
                    if (snapshot != null && snapshot.exists()) {
                        PaymentTransferConfig(
                            recipientName = snapshot.getString("recipientName").orEmpty(),
                            recipientPhone = snapshot.getString("recipientPhone").orEmpty(),
                            bankName = snapshot.getString("bankName").orEmpty(),
                            sbpLink = snapshot.getString("sbpLink").orEmpty()
                        )
                    } else {
                        PaymentTransferConfig()
                    }
                )
            }
    }

    fun observeCommunityFunds(
        onChange: (Int) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return appSettings.document(COMMUNITY_FUNDS_DOCUMENT)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.getLong("amount")?.toInt() ?: 0)
            }
    }

    suspend fun sendChatMessage(sender: RemoteUser, text: String) {
        val message = text.trim()
        if (message.isEmpty()) return
        chat.add(
            mapOf(
                "senderId" to sender.id,
                "senderName" to sender.fullName,
                "text" to message,
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun updateChatMessage(messageId: String, sender: RemoteUser, text: String) {
        val cleanText = text.trim()
        if (cleanText.isEmpty()) return
        chat.document(messageId).update(
            mapOf(
                "text" to cleanText,
                "updatedAtClient" to System.currentTimeMillis(),
                "senderName" to sender.fullName
            )
        ).await()
    }

    suspend fun deleteChatMessage(messageId: String) {
        chat.document(messageId).delete().await()
    }

    suspend fun markChatRead(userId: String) {
        users.document(userId).update("lastChatReadAt", System.currentTimeMillis()).await()
    }

    suspend fun createEvent(
        creator: RemoteUser,
        title: String,
        message: String,
        type: EventType,
        amount: Int,
        pollOptions: List<String> = emptyList()
    ) {
        val cleanTitle = title.trim()
        val cleanMessage = message.trim()
        val cleanAmount = amount.coerceAtLeast(0)
        val cleanPollOptions = pollOptions.map { it.trim() }.filter { it.isNotBlank() }.distinct()

        if ((type == EventType.CHARGE || type == EventType.EXPENSE) && cleanAmount <= 0) {
            error("Charge amount must be greater than zero")
        }
        if (type == EventType.POLL && cleanPollOptions.size < 2) {
            error("Poll must contain at least two options")
        }

        val eventData = mapOf(
            "title" to cleanTitle,
            "message" to cleanMessage,
            "type" to type.name,
            "amount" to cleanAmount,
            "isClosed" to false,
            "pollOptions" to cleanPollOptions,
            "pollVotes" to cleanPollOptions.associateWith { 0 },
            "voterIds" to emptyList<String>(),
            "voterChoices" to emptyMap<String, String>(),
            "createdById" to creator.id,
            "createdByName" to creator.fullName,
            "createdAt" to FieldValue.serverTimestamp(),
            "createdAtClient" to System.currentTimeMillis()
        )

        if (type == EventType.CHARGE) {
            val snapshot = users.get().await()
            val batch = firestore.batch()
            snapshot.documents.mapNotNull { it.toRemoteUser() }
                .filter { it.role != Role.ADMIN }
                .forEach { user ->
                    val plotCount = user.plots.ifEmpty { listOf(user.plotName) }.size.coerceAtLeast(1)
                    val totalCharge = cleanAmount * plotCount
                    batch.update(users.document(user.id), "balance", user.balance - totalCharge)
                    batch.set(
                        payments.document(),
                        mapOf(
                            "userId" to user.id,
                            "amount" to -totalCharge,
                            "note" to "Charge event: $cleanTitle",
                            "createdAt" to FieldValue.serverTimestamp(),
                            "createdAtClient" to System.currentTimeMillis()
                        )
                    )
                }
            batch.set(events.document(), eventData)
            batch.commit().await()
        } else if (type == EventType.EXPENSE) {
            val fundsRef = appSettings.document(COMMUNITY_FUNDS_DOCUMENT)
            firestore.runTransaction { transaction ->
                val currentFunds = transaction.get(fundsRef).getLong("amount")?.toInt() ?: 0
                require(currentFunds >= cleanAmount) { "Недостаточно средств в общей кассе" }
                transaction.set(fundsRef, mapOf("amount" to currentFunds - cleanAmount))
                transaction.set(events.document(), eventData)
            }.await()
        } else {
            events.add(eventData).await()
        }
    }

    suspend fun voteInPoll(eventId: String, option: String, voter: RemoteUser) {
        val cleanOption = option.trim()
        require(cleanOption.isNotEmpty()) { "Poll option is required" }
        val eventRef = events.document(eventId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(eventRef)
            val type = snapshot.getString("type")?.let(EventType::valueOf) ?: error("Event type is missing")
            val isClosed = snapshot.getBoolean("isClosed") ?: false
            require(type == EventType.POLL) { "Event is not a poll" }
            require(!isClosed) { "Poll is already closed" }

            val options = (snapshot.get("pollOptions") as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()
            require(cleanOption in options) { "Poll option is invalid" }

            val voterIds = (snapshot.get("voterIds") as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()
            if (voter.id in voterIds) {
                return@runTransaction
            }

            val rawVotes = snapshot.get("pollVotes") as? Map<*, *>
            val votes = options.associateWith { pollOption ->
                when (val value = rawVotes?.get(pollOption)) {
                    is Long -> value.toInt()
                    is Int -> value
                    is Double -> value.toInt()
                    else -> 0
                }
            }.toMutableMap()
            votes[cleanOption] = (votes[cleanOption] ?: 0) + 1
            val currentChoices = (snapshot.get("voterChoices") as? Map<*, *>)
                ?.mapNotNull { (key, value) ->
                    val userId = key?.toString()
                    val optionValue = value?.toString()
                    if (userId.isNullOrBlank() || optionValue.isNullOrBlank()) null else userId to optionValue
                }
                ?.toMap()
                ?.toMutableMap()
                ?: mutableMapOf()
            currentChoices[voter.id] = cleanOption

            transaction.update(
                eventRef,
                mapOf(
                    "pollVotes" to votes,
                    "voterIds" to voterIds + voter.id,
                    "voterChoices" to currentChoices
                )
            )
        }.await()
    }

    private suspend fun createTargetedEvent(
        creator: RemoteUser,
        userId: String,
        title: String,
        message: String
    ) {
        events.add(
            mapOf(
                "title" to title.trim(),
                "message" to message.trim(),
                "type" to EventType.INFO.name,
                "amount" to 0,
                "isClosed" to false,
                "targetUserId" to userId,
                "createdById" to creator.id,
                "createdByName" to creator.fullName,
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun closeEvent(eventId: String, reviewer: RemoteUser) {
        val eventRef = events.document(eventId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(eventRef)
            val type = snapshot.getString("type")?.let(EventType::valueOf) ?: error("Event type is missing")
            val isClosed = snapshot.getBoolean("isClosed") ?: false
            if ((type != EventType.CHARGE && type != EventType.POLL) || isClosed) return@runTransaction
            transaction.update(
                eventRef,
                mapOf(
                    "isClosed" to true,
                    "closedById" to reviewer.id,
                    "closedByName" to reviewer.fullName,
                    "closedAtClient" to System.currentTimeMillis(),
                    "message" to buildString {
                        append(snapshot.getString("message").orEmpty().trim())
                        if (isNotEmpty()) append("\n\n")
                        append(if (type == EventType.POLL) "Опрос завершен." else "Сбор завершен.")
                    }
                )
            )
        }.await()
    }
    fun observeUsers(onChange: (List<RemoteUser>) -> Unit, onError: (Exception) -> Unit): ListenerRegistration {
        return users.orderBy("plotName", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toRemoteUser() }.orEmpty())
            }
    }

    fun observeLatestMessages(
        pageSize: Long,
        onChange: (List<ChatMessage>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return chat.orderBy("createdAtClient", Query.Direction.ASCENDING)
            .limitToLast(pageSize)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toChatMessage() }.orEmpty())
            }
    }

    suspend fun loadOlderMessages(oldestTimestamp: Long, pageSize: Long): ChatPage {
        val snapshot = chat.orderBy("createdAtClient", Query.Direction.ASCENDING)
            .endBefore(oldestTimestamp)
            .limitToLast(pageSize)
            .get()
            .await()

        val messages = snapshot.documents.mapNotNull { it.toChatMessage() }
        return ChatPage(
            messages = messages,
            hasMore = messages.size >= pageSize
        )
    }

    fun observeEvents(
        limit: Long,
        onChange: (List<CommunityEvent>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return events.orderBy("createdAtClient", Query.Direction.DESCENDING)
            .limit(limit)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toCommunityEvent() }.orEmpty())
            }
    }

    suspend fun getRecentEvents(limit: Long): List<CommunityEvent> {
        val snapshot = events.orderBy("createdAtClient", Query.Direction.DESCENDING)
            .limit(limit)
            .get()
            .await()
        return snapshot.documents.mapNotNull { it.toCommunityEvent() }
    }

    suspend fun getRecentEventsForUser(user: RemoteUser, limit: Long): List<CommunityEvent> {
        return getRecentEvents(limit).filter { event ->
            event.targetUserId.isBlank() || event.targetUserId == user.id || user.role == Role.ADMIN || user.role == Role.MODERATOR
        }
    }

    private suspend fun getUserById(userId: String): RemoteUser? {
        val snapshot = users.document(userId).get().await()
        return if (snapshot.exists()) snapshot.toRemoteUser() else null
    }

    private suspend fun getRegistrationRequestById(requestId: String): RegistrationRequest? {
        val snapshot = registrationRequests.document(requestId).get().await()
        return if (snapshot.exists()) snapshot.toRegistrationRequest() else null
    }

    private suspend fun createAuthUserWithoutSwitchingSession(email: String, password: String): String {
        val options = FirebaseOptions.fromResource(context)
            ?: error("Firebase options are unavailable")
        val secondaryName = "secondary-auth-${System.currentTimeMillis()}"
        val secondaryApp = FirebaseApp.initializeApp(context, options, secondaryName)
            ?: error("Failed to init secondary Firebase app")

        try {
            val secondaryAuth = FirebaseAuth.getInstance(secondaryApp)
            val result = secondaryAuth.createUserWithEmailAndPassword(email, password).await()
            return result.user?.uid ?: error("Created auth user has no uid")
        } finally {
            FirebaseAuth.getInstance(secondaryApp).signOut()
            secondaryApp.delete()
        }
    }

    private fun DocumentSnapshot.toRemoteUser(): RemoteUser? {
        val email = getString("email") ?: return null
        val login = getString("login").orEmpty().ifBlank { email.substringBefore("@") }
        val fullName = getString("fullName") ?: return null
        val plots = get("plots") as? List<*>
        val normalizedPlots = plots?.mapNotNull { it?.toString() }?.filter { it.isNotBlank() }.orEmpty()
        val plotName = getString("plotName")
            ?: normalizedPlots.joinToString(", ").ifBlank { return null }
        val role = getString("role")?.let(Role::valueOf) ?: return null
        val balance = getLong("balance")?.toInt() ?: 0
        val lastChatReadAt = getLong("lastChatReadAt") ?: 0L
        return RemoteUser(
            id = id,
            login = login,
            email = email,
            fullName = fullName,
            plotName = plotName,
            plots = normalizedPlots.ifEmpty { listOf(plotName) },
            role = role,
            balance = balance,
            lastChatReadAt = lastChatReadAt
        )
    }

    private fun DocumentSnapshot.toChatMessage(): ChatMessage? {
        val senderId = getString("senderId") ?: return null
        val senderName = getString("senderName") ?: return null
        val text = getString("text").orEmpty()
        val createdAtClient = getLong("createdAtClient") ?: 0L
        return ChatMessage(
            id = id,
            senderId = senderId,
            senderName = senderName,
            text = text,
            createdAtClient = createdAtClient,
            updatedAtClient = getLong("updatedAtClient") ?: 0L
        )
    }

    private fun DocumentSnapshot.toCommunityEvent(): CommunityEvent? {
        val title = getString("title") ?: return null
        val message = getString("message").orEmpty()
        val type = getString("type")?.let(EventType::valueOf) ?: return null
        val createdById = getString("createdById") ?: return null
        val createdByName = getString("createdByName") ?: return null
        val createdAtClient = getLong("createdAtClient") ?: 0L
        val amount = getLong("amount")?.toInt() ?: 0
        val isClosed = getBoolean("isClosed") ?: false
        val pollOptions = (get("pollOptions") as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()
        val rawPollVotes = get("pollVotes") as? Map<*, *>
        val pollVotes = pollOptions.associateWith { option ->
            when (val value = rawPollVotes?.get(option)) {
                is Long -> value.toInt()
                is Int -> value
                is Double -> value.toInt()
                else -> 0
            }
        }
        val voterIds = (get("voterIds") as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()
        val voterChoices = (get("voterChoices") as? Map<*, *>)?.mapNotNull { (key, value) ->
            val userId = key?.toString()
            val selectedOption = value?.toString()
            if (userId.isNullOrBlank() || selectedOption.isNullOrBlank()) null else userId to selectedOption
        }?.toMap().orEmpty()
        val targetUserId = getString("targetUserId").orEmpty()
        return CommunityEvent(
            id = id,
            title = title,
            message = message,
            type = type,
            amount = amount,
            isClosed = isClosed,
            pollOptions = pollOptions,
            pollVotes = pollVotes,
            voterIds = voterIds,
            voterChoices = voterChoices,
            targetUserId = targetUserId,
            createdById = createdById,
            createdByName = createdByName,
            createdAtClient = createdAtClient
        )
    }

    private fun DocumentSnapshot.toManualPaymentRequest(): ManualPaymentRequest? {
        val userId = getString("userId") ?: return null
        val userName = getString("userName") ?: return null
        val amount = getLong("amount")?.toInt() ?: return null
        val status = getString("status")?.let(ManualPaymentStatus::valueOf) ?: return null
        val createdAtClient = getLong("createdAtClient") ?: 0L
        return ManualPaymentRequest(
            id = id,
            userId = userId,
            userName = userName,
            plotName = getString("plotName").orEmpty(),
            amount = amount,
            eventId = getString("eventId").orEmpty(),
            eventTitle = getString("eventTitle").orEmpty(),
            purpose = getString("purpose").orEmpty(),
            status = status,
            createdAtClient = createdAtClient,
            reviewedByName = getString("reviewedByName").orEmpty(),
            reviewReason = getString("reviewReason").orEmpty()
        )
    }

    private fun DocumentSnapshot.toRegistrationRequest(): RegistrationRequest? {
        val login = getString("login") ?: return null
        val authEmail = getString("authEmail").orEmpty().ifBlank { normalizeAuthEmail(login) }
        val fullName = getString("fullName") ?: return null
        val plots = (get("plots") as? List<*>)?.mapNotNull { it?.toString() }?.filter { it.isNotBlank() }.orEmpty()
        val status = getString("status")?.let(RegistrationRequestStatus::valueOf) ?: return null
        return RegistrationRequest(
            id = id,
            login = login,
            authEmail = authEmail,
            fullName = fullName,
            plots = plots,
            status = status,
            createdAtClient = getLong("createdAtClient") ?: 0L,
            reviewedByName = getString("reviewedByName").orEmpty(),
            reviewReason = getString("reviewReason").orEmpty()
        )
    }

    private fun normalizeAuthEmail(loginOrEmail: String): String {
        val value = loginOrEmail.trim()
        return if (value.contains("@")) value else "$value@malinkieco.local"
    }

    private suspend fun <T> Task<T>.await(): T {
        return suspendCoroutine { continuation ->
            addOnSuccessListener { continuation.resume(it) }
            addOnFailureListener { continuation.resumeWithException(it) }
        }
    }

    companion object {
        private const val USERS_COLLECTION = "users"
        private const val PAYMENTS_COLLECTION = "payments"
        private const val PAYMENT_REQUESTS_COLLECTION = "payment_requests"
        private const val REGISTRATION_REQUESTS_COLLECTION = "registration_requests"
        private const val APP_SETTINGS_COLLECTION = "app_settings"
        private const val PAYMENT_CONFIG_DOCUMENT = "payment_config"
        private const val COMMUNITY_FUNDS_DOCUMENT = "community_funds"
        private const val APP_GATE_DOCUMENT = "app_gate"
        private const val CHAT_COLLECTION = "chat_messages"
        private const val EVENTS_COLLECTION = "events"
    }
}
