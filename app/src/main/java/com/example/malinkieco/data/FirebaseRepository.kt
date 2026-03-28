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
    private val auditLogs = firestore.collection(AUDIT_LOGS_COLLECTION)

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
        phone: String,
        plots: List<String>
    ) {
        val normalizedLogin = login.trim()
        val normalizedPhone = phone.trim()
        val normalizedPlots = plots.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        require(normalizedLogin.isNotBlank()) { "Login is required" }
        require(password.isNotBlank()) { "Password is required" }
        require(fullName.isNotBlank()) { "Full name is required" }
        require(normalizedPhone.isNotBlank()) { "Phone is required" }
        require(normalizedPlots.isNotEmpty()) { "At least one plot is required" }

        try {
            val result = auth.createUserWithEmailAndPassword(normalizeAuthEmail(normalizedLogin), password).await()
            val uid = result.user?.uid ?: error("Created auth user has no uid")
            registrationRequests.document(uid).set(
                mapOf(
                    "login" to normalizedLogin,
                    "authEmail" to normalizeAuthEmail(normalizedLogin),
                    "fullName" to fullName.trim(),
                    "phone" to normalizedPhone,
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

    suspend fun deleteUser(targetUser: RemoteUser, actor: RemoteUser) {
        users.document(targetUser.id).delete().await()
        createAuditLog(
            actor = actor,
            title = "Удален пользователь",
            message = "Пользователь удален из списка собственников.",
            targetUserId = targetUser.id,
            targetUserName = targetUser.fullName,
            targetPlotName = targetUser.plotName
        )
    }

    suspend fun setUserRole(targetUser: RemoteUser, role: Role, actor: RemoteUser) {
        users.document(targetUser.id).update("role", role.name).await()
        createAuditLog(
            actor = actor,
            title = if (role == Role.MODERATOR) "РќР°Р·РЅР°С‡РµРЅ РјРѕРґРµСЂР°С‚РѕСЂ" else "РЎРЅСЏС‚Р° СЂРѕР»СЊ РјРѕРґРµСЂР°С‚РѕСЂР°",
            message = if (role == Role.MODERATOR) {
                "РџРѕР»СЊР·РѕРІР°С‚РµР»СЋ РЅР°Р·РЅР°С‡РµРЅР° СЂРѕР»СЊ РјРѕРґРµСЂР°С‚РѕСЂР°."
            } else {
                "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїРµСЂРµРІРµРґРµРЅ РІ РѕР±С‹С‡РЅС‹Рµ СѓС‡Р°СЃС‚РЅРёРєРё."
            },
            targetUserId = targetUser.id,
            targetUserName = targetUser.fullName,
            targetPlotName = targetUser.plotName
        )
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

    suspend fun setUserBalance(targetUser: RemoteUser, newBalance: Int, actor: RemoteUser) {
        users.document(targetUser.id).update("balance", newBalance).await()
        createAuditLog(
            actor = actor,
            title = "РР·РјРµРЅРµРЅ Р±Р°Р»Р°РЅСЃ СѓС‡Р°СЃС‚РЅРёРєР°",
            message = "Р‘Р°Р»Р°РЅСЃ РёР·РјРµРЅРµРЅ СЃ ${targetUser.balance} в‚Ѕ РЅР° ${newBalance} в‚Ѕ.",
            targetUserId = targetUser.id,
            targetUserName = targetUser.fullName,
            targetPlotName = targetUser.plotName
        )
    }

    suspend fun setCommunityFunds(amount: Int, actor: RemoteUser, previousAmount: Int) {
        val normalizedAmount = amount.coerceAtLeast(0)
        appSettings.document(COMMUNITY_FUNDS_DOCUMENT).set(mapOf("amount" to normalizedAmount)).await()
        createAuditLog(
            actor = actor,
            title = "РР·РјРµРЅРµРЅР° РѕР±С‰Р°СЏ СЃСѓРјРјР° РїРѕСЃРµР»РєР°",
            message = "РћР±С‰Р°СЏ СЃСѓРјРјР° РёР·РјРµРЅРµРЅР° СЃ ${previousAmount} в‚Ѕ РЅР° ${normalizedAmount} в‚Ѕ."
        )
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
        createPaymentRequest(user, amount, emptyList(), "")
    }

    suspend fun createPaymentRequest(user: RemoteUser, amount: Int, events: List<ChargeSuggestion>, purpose: String) {
        if (amount <= 0) return
        val cleanPurpose = purpose.trim()
        val cleanEvents = events.distinctBy { it.eventId }
        val joinedEventIds = cleanEvents.joinToString(",") { it.eventId }
        val joinedEventTitles = cleanEvents.joinToString(", ") { it.title }
        paymentRequests.add(
            mapOf(
                "userId" to user.id,
                "userName" to user.fullName,
                "plotName" to user.plotName,
                "amount" to amount,
                "eventId" to joinedEventIds,
                "eventTitle" to joinedEventTitles,
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
        val allUsersSnapshot = users.get().await()
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
            val payerPlots = userSnapshot.extractPlots()
            val plotShares = splitAmountAcrossPlots(payerPlots, amount)
            val affectedUsers = allUsersSnapshot.documents
                .mapNotNull { snapshot ->
                    val candidate = snapshot.toRemoteUser() ?: return@mapNotNull null
                    val increment = candidate.plots
                        .ifEmpty { listOf(candidate.plotName) }
                        .sumOf { plotShares[it] ?: 0 }
                    if (candidate.role == Role.ADMIN || increment == 0) {
                        null
                    } else {
                        candidate.id to users.document(candidate.id)
                    }
                }
            val fundsRef = appSettings.document(COMMUNITY_FUNDS_DOCUMENT)
            val currentFunds = transaction.get(fundsRef).getLong("amount")?.toInt() ?: 0
            val affectedSnapshots = affectedUsers.associate { (affectedUserId, affectedRef) ->
                affectedUserId to transaction.get(affectedRef)
            }
            val incrementsByUserId = affectedSnapshots.mapValues { (_, snapshot) ->
                snapshot.extractPlots().sumOf { plotShares[it] ?: 0 }
            }

            affectedUsers.forEach { (affectedUserId, affectedRef) ->
                val currentBalance = affectedSnapshots.getValue(affectedUserId).getLong("balance")?.toInt() ?: 0
                val increment = incrementsByUserId.getValue(affectedUserId)
                transaction.update(affectedRef, "balance", currentBalance + increment)
            }
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
            title = "РћРїР»Р°С‚Р° РїРѕРґС‚РІРµСЂР¶РґРµРЅР°",
            message = if (confirmedRequest.eventTitle.isNotBlank()) {
                "Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.eventTitle}."
            } else if (confirmedRequest.purpose.isNotBlank()) {
                "Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ. РќР°Р·РЅР°С‡РµРЅРёРµ: ${confirmedRequest.purpose}."
            } else {
                "Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${confirmedRequest.amount} в‚Ѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅ."
            }
        )
        createAuditLog(
            actor = reviewer,
            title = "Подтверждена оплата",
            message = if (confirmedRequest.eventTitle.isNotBlank()) {
                "Подтверждена оплата на ${confirmedRequest.amount} ₽. Назначение: ${confirmedRequest.eventTitle}."
            } else if (confirmedRequest.purpose.isNotBlank()) {
                "Подтверждена оплата на ${confirmedRequest.amount} ₽. Назначение: ${confirmedRequest.purpose}."
            } else {
                "Подтверждена оплата на ${confirmedRequest.amount} ₽."
            },
            targetUserId = confirmedRequest.userId,
            targetUserName = confirmedRequest.userName,
            targetPlotName = confirmedRequest.plotName
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
                title = "РћРїР»Р°С‚Р° РѕС‚РєР»РѕРЅРµРЅР°",
                message = if (reason.isBlank()) {
                    "Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РЈС‚РѕС‡РЅРёС‚Рµ РґРµС‚Р°Р»Рё Сѓ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° РёР»Рё РјРѕРґРµСЂР°С‚РѕСЂР°."
                } else {
                    "Р’Р°С€ РїР»Р°С‚РµР¶ РЅР° СЃСѓРјРјСѓ ${request.amount} в‚Ѕ РѕС‚РєР»РѕРЅРµРЅ. РџСЂРёС‡РёРЅР°: ${reason.trim()}."
                }
            )
            createAuditLog(
                actor = reviewer,
                title = "РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р°",
                message = if (reason.isBlank()) {
                    "РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${request.amount} в‚Ѕ."
                } else {
                    "РћС‚РєР»РѕРЅРµРЅР° РѕРїР»Р°С‚Р° РЅР° ${request.amount} в‚Ѕ. РџСЂРёС‡РёРЅР°: ${reason.trim()}."
                },
                targetUserId = request.userId,
                targetUserName = request.userName,
                targetPlotName = request.plotName
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
        val approvedRequest = firestore.runTransaction { transaction ->
            val request = transaction.get(requestRef).toRegistrationRequest()
                ?: error("Registration request not found")
            if (request.status != RegistrationRequestStatus.PENDING) {
                return@runTransaction null
            }

            transaction.set(
                users.document(request.id),
                mapOf(
                    "email" to request.authEmail,
                    "login" to request.login,
                    "fullName" to request.fullName,
                    "phone" to request.phone,
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
            request
        }.await()
        if (approvedRequest != null) {
            createAuditLog(
                actor = reviewer,
                title = "РћРґРѕР±СЂРµРЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЏ",
                message = "Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕРґРѕР±СЂРµРЅР°.",
                targetUserId = approvedRequest.id,
                targetUserName = approvedRequest.fullName,
                targetPlotName = approvedRequest.plots.joinToString(", ")
            )
        }
    }

    suspend fun rejectRegistrationRequest(requestId: String, reviewer: RemoteUser, reason: String) {
        val request = registrationRequests.document(requestId).get().await().toRegistrationRequest()
        registrationRequests.document(requestId).update(
            mapOf(
                "status" to RegistrationRequestStatus.REJECTED.name,
                "reviewedById" to reviewer.id,
                "reviewedByName" to reviewer.fullName,
                "reviewReason" to reason.trim(),
                "reviewedAt" to FieldValue.serverTimestamp()
            )
        ).await()
        if (request != null) {
            createAuditLog(
                actor = reviewer,
                title = "РћС‚РєР»РѕРЅРµРЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЏ",
                message = if (reason.isBlank()) {
                    "Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕС‚РєР»РѕРЅРµРЅР°."
                } else {
                    "Р—Р°СЏРІРєР° РЅР° СЂРµРіРёСЃС‚СЂР°С†РёСЋ РѕС‚РєР»РѕРЅРµРЅР°. РџСЂРёС‡РёРЅР°: ${reason.trim()}."
                },
                targetUserId = request.id,
                targetUserName = request.fullName,
                targetPlotName = request.plots.joinToString(", ")
            )
        }
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
            rustoreUrl = snapshot.getString("rustoreUrl").orEmpty(),
            githubReleaseUrl = snapshot.getString("githubReleaseUrl").orEmpty(),
            githubRepoUrl = snapshot.getString("githubRepoUrl").orEmpty(),
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

    suspend fun sendChatMessage(
        sender: RemoteUser,
        text: String,
        replyTo: ChatMessage? = null,
        mentionedUsers: List<RemoteUser> = emptyList()
    ) {
        val message = text.trim()
        if (message.isEmpty()) return
        val senderPlots = sender.plots.ifEmpty { listOf(sender.plotName) }
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString(", ")
        chat.add(
            mapOf(
                "senderId" to sender.id,
                "senderName" to sender.fullName,
                "senderPlotName" to senderPlots,
                "text" to message,
                "replyToMessageId" to replyTo?.id.orEmpty(),
                "replyToSenderName" to replyTo?.senderName.orEmpty(),
                "replyToSenderPlotName" to replyTo?.senderPlotName.orEmpty(),
                "replyToText" to replyTo?.text.orEmpty(),
                "mentionedUserIds" to mentionedUsers.map { it.id }.distinct(),
                "isPinned" to false,
                "pinnedByUserId" to "",
                "pinnedByUserName" to "",
                "pinnedAtClient" to 0L,
                "createdAt" to FieldValue.serverTimestamp(),
                "createdAtClient" to System.currentTimeMillis()
            )
        ).await()
    }

    suspend fun updateChatMessage(messageId: String, sender: RemoteUser, text: String) {
        val cleanText = text.trim()
        if (cleanText.isEmpty()) return
        val senderPlots = sender.plots.ifEmpty { listOf(sender.plotName) }
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString(", ")
        chat.document(messageId).update(
            mapOf(
                "text" to cleanText,
                "updatedAtClient" to System.currentTimeMillis(),
                "senderName" to sender.fullName,
                "senderPlotName" to senderPlots
            )
        ).await()
    }

    suspend fun deleteChatMessage(messageId: String) {
        chat.document(messageId).delete().await()
    }

    suspend fun toggleChatMessagePin(messageId: String, actor: RemoteUser, shouldPin: Boolean) {
        chat.document(messageId).update(
            mapOf(
                "isPinned" to shouldPin,
                "pinnedByUserId" to if (shouldPin) actor.id else "",
                "pinnedByUserName" to if (shouldPin) actor.fullName else "",
                "pinnedAtClient" to if (shouldPin) System.currentTimeMillis() else 0L
            )
        ).await()
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
                require(currentFunds >= cleanAmount) { "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РІ РѕР±С‰РµР№ РєР°СЃСЃРµ" }
                transaction.set(fundsRef, mapOf("amount" to currentFunds - cleanAmount))
                transaction.set(events.document(), eventData)
            }.await()
        } else {
            events.add(eventData).await()
        }
        if (creator.role == Role.ADMIN || creator.role == Role.MODERATOR) {
            createAuditLog(
                actor = creator,
                title = when (type) {
                    EventType.CHARGE -> "РЎРѕР·РґР°РЅ СЃР±РѕСЂ"
                    EventType.EXPENSE -> "РЎРѕР·РґР°РЅР° РѕРїР»Р°С‚Р°"
                    EventType.POLL -> "РЎРѕР·РґР°РЅ РѕРїСЂРѕСЃ"
                    EventType.INFO -> "РЎРѕР·РґР°РЅРѕ РѕР±СЉСЏРІР»РµРЅРёРµ"
                },
                message = buildString {
                    append(cleanTitle)
                    if (type == EventType.CHARGE || type == EventType.EXPENSE) {
                        append(". РЎСѓРјРјР°: ${cleanAmount} в‚Ѕ.")
                    }
                }.trim()
            )
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
        val closedEvent = firestore.runTransaction { transaction ->
            val snapshot = transaction.get(eventRef)
            val type = snapshot.getString("type")?.let(EventType::valueOf) ?: error("Event type is missing")
            val isClosed = snapshot.getBoolean("isClosed") ?: false
            if ((type != EventType.CHARGE && type != EventType.POLL) || isClosed) return@runTransaction null
            val title = snapshot.getString("title").orEmpty()
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
                        append(if (type == EventType.POLL) "РћРїСЂРѕСЃ Р·Р°РІРµСЂС€РµРЅ." else "РЎР±РѕСЂ Р·Р°РІРµСЂС€РµРЅ.")
                    }
                )
            )
            type to title
        }.await()
        if (closedEvent != null) {
            val (type, title) = closedEvent
            createAuditLog(
                actor = reviewer,
                title = if (type == EventType.POLL) "Р—Р°РєСЂС‹С‚ РѕРїСЂРѕСЃ" else "Р—Р°РєСЂС‹С‚ СЃР±РѕСЂ",
                message = title
            )
        }
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

    fun observePinnedMessage(
        onChange: (ChatMessage?) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return chat.orderBy("pinnedAtClient", Query.Direction.DESCENDING)
            .limit(10)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toChatMessage() }?.firstOrNull { it.isPinned })
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

    suspend fun getRecentChatMessages(limit: Long): List<ChatMessage> {
        val snapshot = chat.orderBy("createdAtClient", Query.Direction.DESCENDING)
            .limit(limit)
            .get()
            .await()
        return snapshot.documents.mapNotNull { it.toChatMessage() }
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

    fun observeAuditLogs(
        onChange: (List<AuditLogEntry>) -> Unit,
        onError: (Exception) -> Unit
    ): ListenerRegistration {
        return auditLogs.orderBy("createdAtClient", Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error)
                    return@addSnapshotListener
                }
                onChange(snapshot?.documents?.mapNotNull { it.toAuditLogEntry() }.orEmpty())
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
        val phone = getString("phone").orEmpty()
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
            phone = phone,
            plotName = plotName,
            plots = normalizedPlots.ifEmpty { listOf(plotName) },
            role = role,
            balance = balance,
            lastChatReadAt = lastChatReadAt
        )
    }

    private fun DocumentSnapshot.extractPlots(): List<String> {
        val plots = get("plots") as? List<*>
        val normalizedPlots = plots?.mapNotNull { it?.toString()?.trim() }?.filter { it.isNotBlank() }.orEmpty()
        if (normalizedPlots.isNotEmpty()) return normalizedPlots
        return getString("plotName")
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotBlank() }
            .orEmpty()
    }

    private fun splitAmountAcrossPlots(plots: List<String>, amount: Int): Map<String, Int> {
        val normalizedPlots = plots.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (normalizedPlots.isEmpty() || amount == 0) return emptyMap()

        val baseShare = amount / normalizedPlots.size
        var remainder = amount % normalizedPlots.size
        return normalizedPlots.associateWith {
            val extra = if (remainder > 0) {
                remainder -= 1
                1
            } else {
                0
            }
            baseShare + extra
        }
    }

    private suspend fun createAuditLog(
        actor: RemoteUser,
        title: String,
        message: String,
        targetUserId: String = "",
        targetUserName: String = "",
        targetPlotName: String = ""
    ) {
        if (actor.role != Role.ADMIN && actor.role != Role.MODERATOR) return
        runCatching {
            auditLogs.add(
                mapOf(
                    "actorId" to actor.id,
                    "actorName" to actor.fullName,
                    "actorRole" to actor.role.name,
                    "title" to title.trim(),
                    "message" to message.trim(),
                    "targetUserId" to targetUserId,
                    "targetUserName" to targetUserName,
                    "targetPlotName" to targetPlotName,
                    "createdAt" to FieldValue.serverTimestamp(),
                    "createdAtClient" to System.currentTimeMillis()
                )
            ).await()
        }
    }

    private fun DocumentSnapshot.toAuditLogEntry(): AuditLogEntry? {
        val actorId = getString("actorId") ?: return null
        val actorName = getString("actorName") ?: return null
        val actorRole = getString("actorRole")?.let(Role::valueOf) ?: return null
        val title = getString("title") ?: return null
        val createdAtClient = getLong("createdAtClient") ?: 0L
        return AuditLogEntry(
            id = id,
            actorId = actorId,
            actorName = actorName,
            actorRole = actorRole,
            title = title,
            message = getString("message").orEmpty(),
            targetUserId = getString("targetUserId").orEmpty(),
            targetUserName = getString("targetUserName").orEmpty(),
            targetPlotName = getString("targetPlotName").orEmpty(),
            createdAtClient = createdAtClient
        )
    }

    private fun DocumentSnapshot.toChatMessage(): ChatMessage? {
        val senderId = getString("senderId") ?: return null
        val senderName = getString("senderName") ?: return null
        val text = getString("text").orEmpty()
        val createdAtClient = getLong("createdAtClient") ?: 0L
        val mentionedUserIds = (get("mentionedUserIds") as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()
        return ChatMessage(
            id = id,
            senderId = senderId,
            senderName = senderName,
            senderPlotName = getString("senderPlotName").orEmpty(),
            text = text,
            replyToMessageId = getString("replyToMessageId").orEmpty(),
            replyToSenderName = getString("replyToSenderName").orEmpty(),
            replyToSenderPlotName = getString("replyToSenderPlotName").orEmpty(),
            replyToText = getString("replyToText").orEmpty(),
            mentionedUserIds = mentionedUserIds,
            isPinned = getBoolean("isPinned") ?: false,
            pinnedByUserId = getString("pinnedByUserId").orEmpty(),
            pinnedByUserName = getString("pinnedByUserName").orEmpty(),
            pinnedAtClient = getLong("pinnedAtClient") ?: 0L,
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
        val phone = getString("phone").orEmpty()
        val plots = (get("plots") as? List<*>)?.mapNotNull { it?.toString() }?.filter { it.isNotBlank() }.orEmpty()
        val status = getString("status")?.let(RegistrationRequestStatus::valueOf) ?: return null
        return RegistrationRequest(
            id = id,
            login = login,
            authEmail = authEmail,
            fullName = fullName,
            phone = phone,
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
        private const val AUDIT_LOGS_COLLECTION = "audit_logs"
    }
}

