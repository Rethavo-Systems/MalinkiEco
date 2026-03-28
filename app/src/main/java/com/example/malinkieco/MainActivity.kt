package com.example.malinkieco

import android.Manifest
import android.content.res.ColorStateList
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.RadioButton
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.example.malinkieco.data.ChatMessage
import com.example.malinkieco.data.CommunityEvent
import com.example.malinkieco.data.AppGateConfig
import com.example.malinkieco.data.EventType
import com.example.malinkieco.data.FirebaseRepository
import com.example.malinkieco.data.ChargeSuggestion
import com.example.malinkieco.data.ManualPaymentRequest
import com.example.malinkieco.data.ManualPaymentStatus
import com.example.malinkieco.data.PaymentTransferConfig
import com.example.malinkieco.data.PushBackendClient
import com.example.malinkieco.data.RegistrationRequest
import com.example.malinkieco.data.RegistrationRequestStatus
import com.example.malinkieco.data.RemoteUser
import com.example.malinkieco.data.Role
import com.example.malinkieco.notifications.EventReminderScheduler
import com.example.malinkieco.notifications.EventStateStore
import com.example.malinkieco.notifications.EventNotificationHelper
import com.example.malinkieco.ui.AuditLogAdapter
import com.example.malinkieco.ui.ChatAdapter
import com.example.malinkieco.ui.EventAdapter
import com.example.malinkieco.ui.PaymentRequestAdapter
import com.example.malinkieco.ui.PollAdapter
import com.example.malinkieco.ui.RegistrationRequestAdapter
import com.example.malinkieco.ui.UserListAdapter
import com.google.android.material.tabs.TabLayout
import com.google.android.material.card.MaterialCardView
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class MainActivity : AppCompatActivity() {
    private data class EventTemplate(
        val name: String,
        val title: String,
        val message: String,
        val type: EventType
    )

    private lateinit var loginContainer: LinearLayout
    private lateinit var dashboardContainer: LinearLayout
    private lateinit var eventsContainer: View
    private lateinit var eventsContent: LinearLayout
    private lateinit var communityFundsCard: View
    private lateinit var pollsContainer: View
    private lateinit var pollCreateControls: View
    private lateinit var pollCreatePanel: View
    private lateinit var residentsContainer: View
    private lateinit var logsContainer: View
    private lateinit var chatContainer: LinearLayout
    private lateinit var tilLoginEmail: TextInputLayout
    private lateinit var tilLoginPassword: TextInputLayout
    private lateinit var etLoginEmail: EditText
    private lateinit var etLoginPassword: EditText
    private lateinit var btnLogin: Button
    private lateinit var btnOpenRegistration: Button
    private lateinit var btnOpenSettings: View
    private lateinit var tvHeaderTitle: TextView
    private lateinit var tvHeaderSubtitle: TextView
    private lateinit var summaryCard: MaterialCardView
    private lateinit var tvWelcome: TextView
    private lateinit var tvWelcomeDetails: TextView
    private lateinit var tvBalanceHero: TextView
    private lateinit var tvBalanceHeroStatus: TextView
    private lateinit var tvCommunityFunds: TextView
    private lateinit var btnEditCommunityFunds: Button
    private lateinit var btnLogout: Button
    private lateinit var unreadEventsBanner: View
    private lateinit var tvUnreadEventsTitle: TextView
    private lateinit var tvUnreadEventsSubtitle: TextView
    private lateinit var btnMarkEventsRead: Button
    private lateinit var btnLoadMoreEvents: Button
    private lateinit var appGateContainer: LinearLayout
    private lateinit var tvGateTitle: TextView
    private lateinit var tvGateMessage: TextView
    private lateinit var btnGatePrimary: Button
    private lateinit var btnGateSecondary: Button
    private lateinit var btnGateTertiary: Button
    private lateinit var btnTogglePaymentRequests: Button
    private lateinit var paymentRequestsHeader: View
    private lateinit var adminControls: View
    private lateinit var btnToggleAdminPanel: Button
    private lateinit var adminFormContainer: View
    private lateinit var etNewPlot: EditText
    private lateinit var etNewFullName: EditText
    private lateinit var tilNewEmail: TextInputLayout
    private lateinit var etNewEmail: EditText
    private lateinit var tilNewPassword: TextInputLayout
    private lateinit var etNewPassword: EditText
    private lateinit var btnAddUser: Button
    private lateinit var eventControls: View
    private lateinit var eventControlsPanel: View
    private lateinit var etEventTitle: EditText
    private lateinit var etEventMessage: EditText
    private lateinit var etEventAmount: EditText
    private lateinit var eventAmountLayout: TextInputLayout
    private lateinit var pollOptionsLayout: TextInputLayout
    private lateinit var etPollOptions: EditText
    private lateinit var rbEventInfo: RadioButton
    private lateinit var rbEventCharge: RadioButton
    private lateinit var rbEventExpense: RadioButton
    private lateinit var rbEventPoll: RadioButton
    private lateinit var btnToggleEventControls: Button
    private lateinit var btnCreateEvent: Button
    private lateinit var userPayControls: View
    private lateinit var etPayAmount: EditText
    private lateinit var etPayPurpose: EditText
    private lateinit var btnPay: Button
    private lateinit var btnSelectChargeEvent: Button
    private lateinit var paymentConfigCard: View
    private lateinit var paymentConfigPanel: View
    private lateinit var btnTogglePaymentConfig: Button
    private lateinit var etRecipientName: EditText
    private lateinit var etRecipientPhone: EditText
    private lateinit var etRecipientBank: EditText
    private lateinit var etSbpLink: EditText
    private lateinit var btnSavePaymentConfig: Button
    private lateinit var tvPaymentTransferInfo: TextView
    private lateinit var btnOpenSbp: Button
    private lateinit var btnCopyPaymentDetails: Button
    private lateinit var rvEvents: RecyclerView
    private lateinit var rvPolls: RecyclerView
    private lateinit var rvUsers: RecyclerView
    private lateinit var rvLogs: RecyclerView
    private lateinit var rvChat: RecyclerView
    private lateinit var rvPaymentRequests: RecyclerView
    private lateinit var rvRegistrationRequests: RecyclerView
    private lateinit var chatLayoutManager: LinearLayoutManager
    private lateinit var tabLayout: TabLayout
    private lateinit var etChatMessage: EditText
    private lateinit var chatComposerInputLayout: TextInputLayout
    private lateinit var btnSendMessage: Button
    private lateinit var btnAttachPlaceholder: Button
    private lateinit var pinnedMessageCard: MaterialCardView
    private lateinit var tvPinnedMessageCounter: TextView
    private lateinit var tvPinnedMessageTitle: TextView
    private lateinit var tvPinnedMessageBody: TextView
    private lateinit var chatReplyPreviewContainer: View
    private lateinit var tvReplyingToTitle: TextView
    private lateinit var tvReplyingToBody: TextView
    private lateinit var btnCancelReply: Button
    private lateinit var tvEventsEmpty: TextView
    private lateinit var tvPollsEmpty: TextView
    private lateinit var tvLogsEmpty: TextView
    private lateinit var etPollTitle: EditText
    private lateinit var etPollMessage: EditText
    private lateinit var etPollCreateOptions: EditText
    private lateinit var btnTogglePollCreateControls: Button
    private lateinit var btnCreatePoll: Button
    private lateinit var tvResidentsEmpty: TextView
    private lateinit var tvChatEmpty: TextView
    private lateinit var tvPaymentRequestsEmpty: TextView
    private lateinit var paymentRequestsPanel: View
    private lateinit var registrationRequestsHeader: View
    private lateinit var registrationRequestsPanel: View
    private lateinit var btnToggleRegistrationRequests: Button
    private lateinit var tvPaymentRequestsTitle: TextView
    private lateinit var tvRegistrationRequestsTitle: TextView
    private lateinit var tvRegistrationRequestsEmpty: TextView

    private lateinit var repository: FirebaseRepository
    private lateinit var eventStateStore: EventStateStore
    private val pushBackendClient = PushBackendClient()
    private lateinit var userAdapter: UserListAdapter
    private lateinit var chatAdapter: ChatAdapter
    private lateinit var eventAdapter: EventAdapter
    private lateinit var pollAdapter: PollAdapter
    private lateinit var auditLogAdapter: AuditLogAdapter
    private lateinit var paymentRequestAdapter: PaymentRequestAdapter
    private lateinit var registrationRequestAdapter: RegistrationRequestAdapter

    private var currentUser: RemoteUser? = null
    private var currentPaymentConfig = PaymentTransferConfig()
    private var allUsers = emptyList<RemoteUser>()
    private var selectedChargeEvents = emptyList<ChargeSuggestion>()
    private var availableChargeEvents = emptyList<ChargeSuggestion>()
    private var latestEvents = emptyList<CommunityEvent>()
    private var latestPolls = emptyList<CommunityEvent>()
    private var usersListener: ListenerRegistration? = null
    private var chatListener: ListenerRegistration? = null
    private var eventsListener: ListenerRegistration? = null
    private var auditLogsListener: ListenerRegistration? = null
    private var paymentRequestsListener: ListenerRegistration? = null
    private var paymentConfigListener: ListenerRegistration? = null
    private var registrationRequestsListener: ListenerRegistration? = null
    private var communityFundsListener: ListenerRegistration? = null
    private var pinnedMessageListener: ListenerRegistration? = null
    private var isAdminPanelExpanded = false
    private var isEventControlsExpanded = false
    private var isPollCreateExpanded = false
    private var isPaymentConfigExpanded = false
    private var isPaymentRequestsExpanded = false
    private var isRegistrationRequestsExpanded = false
    private var pendingPaymentRequestsCount = 0
    private var pendingRegistrationRequestsCount = 0
    private var currentEventsLimit = EVENTS_PAGE_SIZE

    private val latestMessages = mutableListOf<ChatMessage>()
    private val olderMessages = mutableListOf<ChatMessage>()
    private var pinnedMessages = emptyList<ChatMessage>()
    private var currentPinnedMessageIndex = 0
    private var replyingToMessage: ChatMessage? = null
    private val selectedMentionedUsers = linkedSetOf<RemoteUser>()
    private var everyoneMentionActive = false
    private var isLoadingOlderMessages = false
    private var hasMoreOlderMessages = true
    private var lastSeenEventTimestamp = 0L
    private var eventsInitialized = false
    private var hasInitializedSession = false
    private var currentGateConfig: AppGateConfig? = null
    private var gatePrimaryAction: (() -> Unit)? = null
    private var gateSecondaryAction: (() -> Unit)? = null
    private var gateTertiaryAction: (() -> Unit)? = null
    private var hasInitializedChatNotifications = false
    private var pendingNotificationDestination: String? = null
    private var suppressMentionPicker = false

    private val chatMentionWatcher = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

        override fun afterTextChanged(editable: Editable?) {
            if (suppressMentionPicker) return
            val text = editable?.toString().orEmpty()
            if (text.isEmpty()) {
                selectedMentionedUsers.clear()
                everyoneMentionActive = false
                return
            }
            everyoneMentionActive = text.contains("@${getString(R.string.chat_mentions_everyone)}")
            if (!text.endsWith("@")) return
            etChatMessage.removeTextChangedListener(this)
            try {
                showModernMentionPicker()
            } finally {
                etChatMessage.addTextChangedListener(this)
            }
        }
    }

    private val notificationsPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted && currentUser != null) {
                lifecycleScope.launch {
                    runCatching { registerDeviceForPush() }
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initialStateStore = EventStateStore(applicationContext)
        AppCompatDelegate.setDefaultNightMode(
            when (initialStateStore.getThemeMode()) {
                EventStateStore.ThemeMode.LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
                EventStateStore.ThemeMode.DARK -> AppCompatDelegate.MODE_NIGHT_YES
                EventStateStore.ThemeMode.SYSTEM -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            }
        )
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        repository = FirebaseRepository(
            context = applicationContext,
            auth = FirebaseAuth.getInstance(),
            firestore = FirebaseFirestore.getInstance()
        )
        eventStateStore = EventStateStore(applicationContext)

        bindViews()
        setupLists()
        setupTabs()
        setupListeners()
        captureNotificationDestination(intent)
        checkStartupRequirements()
    }

    override fun onResume() {
        super.onResume()
        checkStartupRequirements()
        if (currentUser != null && pushBackendClient.isConfigured()) {
            lifecycleScope.launch {
                runCatching { registerDeviceForPush() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureNotificationDestination(intent)
        applyPendingNotificationDestination()
    }

    override fun onDestroy() {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        auditLogsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        registrationRequestsListener?.remove()
        communityFundsListener?.remove()
        pinnedMessageListener?.remove()
        super.onDestroy()
    }

    private fun bindViews() {
        loginContainer = findViewById(R.id.loginContainer)
        dashboardContainer = findViewById(R.id.dashboardContainer)
        eventsContainer = findViewById(R.id.eventsScrollContainer)
        eventsContent = findViewById(R.id.eventsContainer)
        communityFundsCard = findViewById(R.id.communityFundsCard)
        pollsContainer = findViewById(R.id.pollsScrollContainer)
        pollCreateControls = findViewById(R.id.pollCreateControls)
        pollCreatePanel = findViewById(R.id.pollCreatePanel)
        residentsContainer = findViewById(R.id.residentsScrollContainer)
        logsContainer = findViewById(R.id.logsScrollContainer)
        chatContainer = findViewById(R.id.chatContainer)
        tilLoginEmail = findViewById(R.id.tilLoginEmail)
        tilLoginPassword = findViewById(R.id.tilLoginPassword)
        etLoginEmail = findViewById(R.id.etLoginEmail)
        etLoginPassword = findViewById(R.id.etLoginPassword)
        btnLogin = findViewById(R.id.btnLogin)
        btnOpenRegistration = findViewById(R.id.btnOpenRegistration)
        btnOpenSettings = findViewById(R.id.btnOpenSettings)
        tvHeaderTitle = findViewById(R.id.tvHeaderTitle)
        tvHeaderSubtitle = findViewById(R.id.tvHeaderSubtitle)
        summaryCard = findViewById(R.id.summaryCard)
        tvWelcome = findViewById(R.id.tvWelcome)
        tvWelcomeDetails = findViewById(R.id.tvWelcomeDetails)
        tvBalanceHero = findViewById(R.id.tvBalanceHero)
        tvBalanceHeroStatus = findViewById(R.id.tvBalanceHeroStatus)
        tvCommunityFunds = findViewById(R.id.tvCommunityFunds)
        btnEditCommunityFunds = findViewById(R.id.btnEditCommunityFunds)
        btnLogout = findViewById(R.id.btnLogout)
        unreadEventsBanner = findViewById(R.id.unreadEventsBanner)
        tvUnreadEventsTitle = findViewById(R.id.tvUnreadEventsTitle)
        tvUnreadEventsSubtitle = findViewById(R.id.tvUnreadEventsSubtitle)
        btnMarkEventsRead = findViewById(R.id.btnMarkEventsRead)
        btnLoadMoreEvents = findViewById(R.id.btnLoadMoreEvents)
        appGateContainer = findViewById(R.id.appGateContainer)
        tvGateTitle = findViewById(R.id.tvGateTitle)
        tvGateMessage = findViewById(R.id.tvGateMessage)
        btnGatePrimary = findViewById(R.id.btnGatePrimary)
        btnGateSecondary = findViewById(R.id.btnGateSecondary)
        btnGateTertiary = findViewById(R.id.btnGateTertiary)
        btnTogglePaymentRequests = findViewById(R.id.btnTogglePaymentRequests)
        paymentRequestsHeader = findViewById(R.id.paymentRequestsHeader)
        adminControls = findViewById(R.id.adminControls)
        btnToggleAdminPanel = findViewById(R.id.btnToggleAdminPanel)
        adminFormContainer = findViewById(R.id.adminFormContainer)
        etNewPlot = findViewById(R.id.etNewPlot)
        etNewFullName = findViewById(R.id.etNewFullName)
        tilNewEmail = findViewById(R.id.tilNewEmail)
        etNewEmail = findViewById(R.id.etNewEmail)
        tilNewPassword = findViewById(R.id.tilNewPassword)
        etNewPassword = findViewById(R.id.etNewPassword)
        btnAddUser = findViewById(R.id.btnAddUser)
        eventControls = findViewById(R.id.eventControls)
        eventControlsPanel = findViewById(R.id.eventControlsPanel)
        etEventTitle = findViewById(R.id.etEventTitle)
        etEventMessage = findViewById(R.id.etEventMessage)
        etEventAmount = findViewById(R.id.etEventAmount)
        eventAmountLayout = findViewById(R.id.eventAmountLayout)
        pollOptionsLayout = findViewById(R.id.pollOptionsLayout)
        etPollOptions = findViewById(R.id.etPollOptions)
        rbEventInfo = findViewById(R.id.rbEventInfo)
        rbEventCharge = findViewById(R.id.rbEventCharge)
        rbEventExpense = findViewById(R.id.rbEventExpense)
        rbEventPoll = findViewById(R.id.rbEventPoll)
        btnToggleEventControls = findViewById(R.id.btnToggleEventControls)
        btnCreateEvent = findViewById(R.id.btnCreateEvent)
        userPayControls = findViewById(R.id.userPayControls)
        etPayAmount = findViewById(R.id.etPayAmount)
        etPayPurpose = findViewById(R.id.etPayPurpose)
        btnPay = findViewById(R.id.btnPay)
        btnSelectChargeEvent = findViewById(R.id.btnSelectChargeEvent)
        paymentConfigCard = findViewById(R.id.paymentConfigCard)
        paymentConfigPanel = findViewById(R.id.paymentConfigPanel)
        btnTogglePaymentConfig = findViewById(R.id.btnTogglePaymentConfig)
        etRecipientName = findViewById(R.id.etRecipientName)
        etRecipientPhone = findViewById(R.id.etRecipientPhone)
        etRecipientBank = findViewById(R.id.etRecipientBank)
        etSbpLink = findViewById(R.id.etSbpLink)
        btnSavePaymentConfig = findViewById(R.id.btnSavePaymentConfig)
        tvPaymentTransferInfo = findViewById(R.id.tvPaymentTransferInfo)
        btnOpenSbp = findViewById(R.id.btnOpenSbp)
        btnCopyPaymentDetails = findViewById(R.id.btnCopyPaymentDetails)
        rvEvents = findViewById(R.id.rvEvents)
        rvPolls = findViewById(R.id.rvPolls)
        etPollTitle = findViewById(R.id.etPollTitle)
        etPollMessage = findViewById(R.id.etPollMessage)
        etPollCreateOptions = findViewById(R.id.etPollCreateOptions)
        btnTogglePollCreateControls = findViewById(R.id.btnTogglePollCreateControls)
        btnCreatePoll = findViewById(R.id.btnCreatePoll)
        rvUsers = findViewById(R.id.rvUsers)
        rvLogs = findViewById(R.id.rvLogs)
        rvChat = findViewById(R.id.rvChat)
        rvPaymentRequests = findViewById(R.id.rvPaymentRequests)
        rvRegistrationRequests = findViewById(R.id.rvRegistrationRequests)
        tabLayout = findViewById(R.id.tabLayout)
        pinnedMessageCard = findViewById(R.id.pinnedMessageCard)
        tvPinnedMessageCounter = findViewById(R.id.tvPinnedMessageCounter)
        tvPinnedMessageTitle = findViewById(R.id.tvPinnedMessageTitle)
        tvPinnedMessageBody = findViewById(R.id.tvPinnedMessageBody)
        chatReplyPreviewContainer = findViewById(R.id.chatReplyPreviewContainer)
        tvReplyingToTitle = findViewById(R.id.tvReplyingToTitle)
        tvReplyingToBody = findViewById(R.id.tvReplyingToBody)
        btnCancelReply = findViewById(R.id.btnCancelReply)
        btnAttachPlaceholder = findViewById(R.id.btnAttachPlaceholder)
        chatComposerInputLayout = findViewById(R.id.chatComposerInputLayout)
        etChatMessage = findViewById(R.id.etChatMessage)
        btnSendMessage = findViewById(R.id.btnSendMessage)
        tvEventsEmpty = findViewById(R.id.tvEventsEmpty)
        tvPollsEmpty = findViewById(R.id.tvPollsEmpty)
        tvResidentsEmpty = findViewById(R.id.tvResidentsEmpty)
        tvLogsEmpty = findViewById(R.id.tvLogsEmpty)
        tvChatEmpty = findViewById(R.id.tvChatEmpty)
        tvPaymentRequestsEmpty = findViewById(R.id.tvPaymentRequestsEmpty)
        paymentRequestsPanel = findViewById(R.id.paymentRequestsPanel)
        registrationRequestsHeader = findViewById(R.id.registrationRequestsHeader)
        registrationRequestsPanel = findViewById(R.id.registrationRequestsPanel)
        btnToggleRegistrationRequests = findViewById(R.id.btnToggleRegistrationRequests)
        tvPaymentRequestsTitle = findViewById(R.id.tvPaymentRequestsTitle)
        tvRegistrationRequestsTitle = findViewById(R.id.tvRegistrationRequestsTitle)
        tvRegistrationRequestsEmpty = findViewById(R.id.tvRegistrationRequestsEmpty)
    }

    private fun setupLists() {
        userAdapter = UserListAdapter(
            currentUserIdProvider = { currentUser?.id },
            canManageUsers = false,
            canManageModerators = false,
            onEditBalance = { target -> promptEditBalance(target) },
            onDelete = { target -> deleteUser(target) },
            onPromoteModerator = { target -> changeRole(target, Role.MODERATOR) },
            onDemoteModerator = { target -> changeRole(target, Role.USER) }
        )
        rvUsers.layoutManager = LinearLayoutManager(this)
        rvUsers.adapter = userAdapter

        eventAdapter = EventAdapter(
            lastSeenTimestampProvider = { currentUser?.id?.let(eventStateStore::getLastSeenEventTimestamp) ?: 0L },
            canCloseChargesProvider = { currentUser?.role == Role.ADMIN || currentUser?.role == Role.MODERATOR },
            onCloseCharge = { event -> promptCloseCharge(event) }
        )
        rvEvents.layoutManager = LinearLayoutManager(this)
        rvEvents.adapter = eventAdapter

        pollAdapter = PollAdapter(
            currentUserIdProvider = { currentUser?.id },
            canClosePollProvider = { event -> canClosePoll(event) },
            onVote = { event, option -> voteInPoll(event, option) },
            onClosePoll = { event -> promptCloseCharge(event) }
        )
        rvPolls.layoutManager = LinearLayoutManager(this)
        rvPolls.adapter = pollAdapter

        auditLogAdapter = AuditLogAdapter()
        rvLogs.layoutManager = LinearLayoutManager(this)
        rvLogs.adapter = auditLogAdapter

        paymentRequestAdapter = PaymentRequestAdapter(
            canReviewProvider = { canReviewPayments() },
            onConfirm = { request -> confirmPaymentRequest(request) },
            onReject = { request -> promptRejectPaymentRequest(request) }
        )
        rvPaymentRequests.layoutManager = LinearLayoutManager(this)
        rvPaymentRequests.adapter = paymentRequestAdapter

        registrationRequestAdapter = RegistrationRequestAdapter(
            onApprove = { request -> approveRegistrationRequest(request) },
            onReject = { request -> promptRejectRegistrationRequest(request) }
        )
        rvRegistrationRequests.layoutManager = LinearLayoutManager(this)
        rvRegistrationRequests.adapter = registrationRequestAdapter

        chatAdapter = ChatAdapter(
            currentUserIdProvider = { currentUser?.id },
            readerCutoffProvider = { allUsers.filter { it.id != currentUser?.id }.maxOfOrNull { it.lastChatReadAt } ?: 0L },
            onReplyMessage = { message -> startReplyToMessage(message) },
            onOpenReplyTarget = { message -> openReplyTarget(message.replyToMessageId) },
            onTogglePinMessage = { message -> togglePinMessage(message) },
            onEditMessage = { message -> promptEditMessage(message) },
            onDeleteMessage = { message -> confirmDeleteMessage(message) }
        )
        chatLayoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        rvChat.layoutManager = chatLayoutManager
        rvChat.adapter = chatAdapter
        ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
            override fun onMove(
                recyclerView: RecyclerView,
                viewHolder: RecyclerView.ViewHolder,
                target: RecyclerView.ViewHolder
            ): Boolean = false

            override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
                val message = chatAdapter.currentList.getOrNull(viewHolder.bindingAdapterPosition) ?: return
                startReplyToMessage(message)
                chatAdapter.notifyItemChanged(viewHolder.bindingAdapterPosition)
            }
        }).attachToRecyclerView(rvChat)
        rvChat.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                super.onScrolled(recyclerView, dx, dy)
                if (chatLayoutManager.findFirstVisibleItemPosition() <= 3) {
                    loadOlderMessages()
                }
            }
        })
    }

    private fun setupTabs() {
        configureTabs(includeLogs = false)
        showEventsTab()
        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> showEventsTab()
                    1 -> showChatTab()
                    2 -> showResidentsTab()
                    3 -> showPollsTab()
                    4 -> if (canSeeLogs()) showLogsTab() else showEventsTab()
                    else -> showEventsTab()
                }
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })
    }

    private fun configureTabs(includeLogs: Boolean) {
        tabLayout.removeAllTabs()
        tabLayout.addTab(tabLayout.newTab().setText(R.string.events_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.chat_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.residents_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.polls_tab))
        if (includeLogs) {
            tabLayout.addTab(tabLayout.newTab().setText(R.string.logs_tab))
        }
    }

    private fun canSeeLogs(): Boolean {
        return currentUser?.role == Role.ADMIN || currentUser?.role == Role.MODERATOR
    }

    private fun canClosePoll(event: CommunityEvent): Boolean {
        val user = currentUser ?: return false
        return user.role == Role.ADMIN ||
            user.role == Role.MODERATOR ||
            event.createdById == user.id
    }

    private fun updateResidentsTabBadge() {
        val count = pendingPaymentRequestsCount + pendingRegistrationRequestsCount
        val tab = tabLayout.getTabAt(2) ?: return
        if (count > 0 && canReviewPayments()) {
            val badge = tab.orCreateBadge
            badge.isVisible = true
            badge.backgroundColor = ContextCompat.getColor(this, android.R.color.holo_red_dark)
            badge.number = count
            badge.horizontalOffset = -12
        } else {
            tab.removeBadge()
        }
    }

    private fun updateEventsTabBadge(count: Int) {
        val tab = tabLayout.getTabAt(0) ?: return
        if (count > 0) {
            val badge = tab.orCreateBadge
            badge.isVisible = true
            badge.backgroundColor = ContextCompat.getColor(this, android.R.color.holo_red_dark)
            badge.number = count
            badge.horizontalOffset = -6
        } else {
            tab.removeBadge()
        }
    }

    private fun updateChatTabBadge(count: Int) {
        val tab = tabLayout.getTabAt(1) ?: return
        if (count > 0) {
            val badge = tab.orCreateBadge
            badge.isVisible = true
            badge.backgroundColor = ContextCompat.getColor(this, android.R.color.holo_red_dark)
            badge.number = count
            badge.horizontalOffset = -12
        } else {
            tab.removeBadge()
        }
    }

    private fun updatePollsTabBadge(count: Int) {
        val tab = tabLayout.getTabAt(3) ?: return
        if (count > 0) {
            val badge = tab.orCreateBadge
            badge.isVisible = true
            badge.backgroundColor = ContextCompat.getColor(this, android.R.color.holo_red_dark)
            badge.number = count
            badge.horizontalOffset = -12
        } else {
            tab.removeBadge()
        }
    }

    private fun setupListeners() {
        btnLogin.setOnClickListener { doLogin() }
        btnOpenRegistration.setOnClickListener { showRegistrationFormDialog() }
        btnOpenSettings.setOnClickListener { showSettingsDialog() }
        btnLogout.setOnClickListener { doLogout() }
        btnAddUser.setOnClickListener { addUser() }
        btnCreateEvent.setOnClickListener { createEvent() }
        btnCreatePoll.setOnClickListener { createPoll() }
        btnToggleEventControls.setOnClickListener { toggleEventControlsPanel() }
        btnTogglePollCreateControls.setOnClickListener { togglePollCreatePanel() }
        btnTogglePaymentConfig.setOnClickListener { togglePaymentConfigPanel() }
        btnPay.setOnClickListener { createManualPaymentRequest() }
        btnSelectChargeEvent.setOnClickListener { chooseChargeEvent() }
        btnSendMessage.setOnClickListener { sendMessage() }
        btnAttachPlaceholder.setOnClickListener { toast(getString(R.string.chat_attachment_unavailable)) }
        btnCancelReply.setOnClickListener { clearReplyTarget() }
        btnToggleAdminPanel.setOnClickListener { toggleAdminPanel() }
        btnTogglePaymentRequests.setOnClickListener { togglePaymentRequestsPanel() }
        btnToggleRegistrationRequests.setOnClickListener { toggleRegistrationRequestsPanel() }
        btnMarkEventsRead.setOnClickListener { markEventsAsRead() }
        btnLoadMoreEvents.setOnClickListener {
            currentEventsLimit += EVENTS_PAGE_SIZE
            currentUser?.let { attachRealtimeListeners(it) }
        }
        btnGatePrimary.setOnClickListener { gatePrimaryAction?.invoke() ?: onGatePrimaryAction() }
        btnGateSecondary.setOnClickListener { gateSecondaryAction?.invoke() ?: finishAffinity() }
        btnGateTertiary.setOnClickListener { gateTertiaryAction?.invoke() }
        btnOpenSbp.setOnClickListener { openSbpLink() }
        btnCopyPaymentDetails.setOnClickListener { copyPaymentDetails() }
        btnSavePaymentConfig.setOnClickListener { savePaymentConfig() }
        btnEditCommunityFunds.setOnClickListener { promptEditCommunityFunds() }
        rbEventInfo.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                updateEventForm()
            }
        }
        rbEventCharge.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                updateEventForm()
            }
        }
        rbEventExpense.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                updateEventForm()
            }
        }
        rbEventPoll.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                updateEventForm()
            }
        }
        etChatMessage.addTextChangedListener(chatMentionWatcher)
        updateEventForm()
        setupEventTemplates()
    }

    private fun checkStartupRequirements() {
        if (!hasInternetConnection()) {
            showGate(
                title = getString(R.string.gate_no_internet_title),
                message = getString(R.string.gate_no_internet_message),
                primaryText = getString(R.string.gate_retry_button),
                showSecondary = true
            )
            return
        }

        showGate(
            title = getString(R.string.gate_loading_title),
            message = getString(R.string.gate_loading_message),
            primaryText = getString(R.string.gate_retry_button),
            showSecondary = false,
            primaryEnabled = false
        )

        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { repository.fetchAppGateConfig() }
            }.onSuccess { config ->
                currentGateConfig = config
                val mustUpdate = config?.minSupportedVersionCode?.let { currentVersionCode() < it } ?: false
                if (mustUpdate) {
                    val primaryUrl = config?.githubReleaseUrl?.ifBlank { config.updateUrl } ?: config?.updateUrl.orEmpty()
                    val rustoreUrl = config?.rustoreUrl?.ifBlank { config.updateUrl } ?: config?.updateUrl.orEmpty()
                    val githubRepoUrl = config?.githubRepoUrl.orEmpty()
                    showGate(
                        title = config?.updateTitle?.ifBlank { getString(R.string.gate_update_default_title) }
                            ?: getString(R.string.gate_update_default_title),
                        message = buildString {
                            append(
                                config?.updateMessage?.ifBlank { getString(R.string.gate_update_default_message) }
                                    ?: getString(R.string.gate_update_default_message)
                            )
                            val latestVersion = config?.latestVersionName?.trim().orEmpty()
                            if (latestVersion.isNotEmpty()) {
                                append("\n\n")
                                append("Актуальная версия: ")
                                append(latestVersion)
                            }
                        },
                        primaryText = getString(R.string.gate_download_apk_button),
                        showSecondary = rustoreUrl.isNotBlank(),
                        secondaryText = getString(R.string.gate_rustore_button),
                        showTertiary = githubRepoUrl.isNotBlank(),
                        tertiaryText = getString(R.string.gate_github_button),
                        onPrimary = { openUpdateUrl(primaryUrl) },
                        onSecondary = { openUpdateUrl(rustoreUrl) },
                        onTertiary = { openUpdateUrl(githubRepoUrl) }
                    )
                } else {
                    hideGate()
                    if (!hasInitializedSession) {
                        hasInitializedSession = true
                        ensureNotificationPermission()
                        restoreFirebaseSession()
                    }
                }
            }.onFailure {
                showGate(
                    title = getString(R.string.gate_check_failed_title),
                    message = getString(R.string.gate_check_failed_message),
                    primaryText = getString(R.string.gate_retry_button),
                    showSecondary = true,
                    secondaryText = getString(R.string.gate_close_button),
                    onPrimary = { checkStartupRequirements() },
                    onSecondary = { finishAffinity() }
                )
            }
        }
    }

    private fun onGatePrimaryAction() {
        val config = currentGateConfig
        val mustUpdate = config?.minSupportedVersionCode?.let { currentVersionCode() < it } == true
        if (mustUpdate) {
            openUpdateUrl(config.updateUrl)
        } else {
            checkStartupRequirements()
        }
    }

    private fun showGate(
        title: String,
        message: String,
        primaryText: String,
        showSecondary: Boolean,
        secondaryText: String = getString(R.string.gate_close_button),
        showTertiary: Boolean = false,
        tertiaryText: String = getString(R.string.gate_github_button),
        primaryEnabled: Boolean = true,
        onPrimary: (() -> Unit)? = null,
        onSecondary: (() -> Unit)? = null,
        onTertiary: (() -> Unit)? = null
    ) {
        appGateContainer.visibility = View.VISIBLE
        tvGateTitle.text = title
        tvGateMessage.text = message
        btnGatePrimary.text = primaryText
        btnGatePrimary.isEnabled = primaryEnabled
        btnGateSecondary.text = secondaryText
        btnGateSecondary.visibility = if (showSecondary) View.VISIBLE else View.GONE
        btnGateTertiary.text = tertiaryText
        btnGateTertiary.visibility = if (showTertiary) View.VISIBLE else View.GONE
        gatePrimaryAction = onPrimary
        gateSecondaryAction = onSecondary
        gateTertiaryAction = onTertiary
    }

    private fun hideGate() {
        appGateContainer.visibility = View.GONE
        gatePrimaryAction = null
        gateSecondaryAction = null
        gateTertiaryAction = null
    }

    private fun hasInternetConnection(): Boolean {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun currentVersionCode(): Long {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        return PackageInfoCompat.getLongVersionCode(packageInfo)
    }

    private fun openUpdateUrl(url: String) {
        val trimmedUrl = url.trim()
        if (trimmedUrl.isBlank()) {
            toast(getString(R.string.gate_update_link_missing))
            return
        }

        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(trimmedUrl)))
        }.onFailure {
            toast(getString(R.string.gate_update_link_missing))
        }
    }

    private fun restoreFirebaseSession() {
        if (repository.currentAuthUser() == null) return
        lifecycleScope.launch {
            val profile = withContext(Dispatchers.IO) { repository.getCurrentUserProfile() }
            if (profile != null) {
                enterDashboard(profile)
            } else {
                handlePendingRegistrationAfterLogin()
            }
        }
    }

    private fun doLogin() {
        val email = etLoginEmail.text.toString().trim()
        val password = etLoginPassword.text.toString()
        tilLoginEmail.error = null
        tilLoginPassword.error = null
        if (email.isBlank()) {
            tilLoginEmail.error = getString(R.string.validation_email_required)
        } else if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            tilLoginEmail.error = getString(R.string.validation_email_invalid)
        }
        if (password.isBlank()) {
            tilLoginPassword.error = getString(R.string.validation_password_required)
        }
        if (tilLoginEmail.error != null || tilLoginPassword.error != null) {
            return
        }

        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) { repository.login(email, password) }
                if (profile == null) {
                    handlePendingRegistrationAfterLogin()
                } else {
                    etLoginEmail.text.clear()
                    etLoginPassword.text.clear()
                    enterDashboard(profile)
                }
            } catch (error: Exception) {
                toast(getString(R.string.login_failed, error.localizedMessage ?: getString(R.string.generic_error)))
            }
        }
    }

    private fun enterDashboard(user: RemoteUser) {
        currentUser = user
        EventReminderScheduler.schedule(applicationContext)
        loginContainer.visibility = View.GONE
        dashboardContainer.visibility = View.VISIBLE
        btnOpenSettings.visibility = View.VISIBLE

        val isAdmin = user.role == Role.ADMIN
        val isModerator = user.role == Role.MODERATOR
        val canCreateEvents = user.role == Role.ADMIN || user.role == Role.MODERATOR
        val canCreatePolls = user.role == Role.ADMIN || user.role == Role.MODERATOR || user.role == Role.USER
        val canManageUsers = isAdmin || isModerator
        configureTabs(includeLogs = canManageUsers)

        tvHeaderTitle.text = getString(R.string.app_name)
        tvHeaderSubtitle.text = when (user.role) {
            Role.ADMIN -> getString(R.string.admin_dashboard_title)
            Role.MODERATOR -> getString(R.string.moderator_dashboard_title)
            Role.USER -> getString(R.string.user_dashboard_title)
        }
        tvWelcome.text = user.fullName
        tvWelcomeDetails.text = getString(R.string.your_plot, user.plotName)
        bindBalanceHero(user.balance)
        arrangePaymentCard(user)
        adminControls.visibility = View.GONE
        eventControls.visibility = if (canCreateEvents) View.VISIBLE else View.GONE
        pollCreateControls.visibility = if (canCreatePolls) View.VISIBLE else View.GONE
        eventControlsPanel.visibility = View.GONE
        pollCreatePanel.visibility = View.GONE
        userPayControls.visibility = if (user.role == Role.USER || user.role == Role.MODERATOR) View.VISIBLE else View.GONE
        selectedChargeEvents = emptyList()
        updateSelectedChargeEventsUi()
        paymentConfigCard.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        btnEditCommunityFunds.visibility = if (isAdmin) View.VISIBLE else View.GONE
        paymentRequestsHeader.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        registrationRequestsHeader.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        registrationRequestsPanel.visibility = View.GONE
        tvRegistrationRequestsEmpty.visibility = View.GONE
        adminFormContainer.visibility = View.GONE
        unreadEventsBanner.visibility = View.GONE
        isAdminPanelExpanded = false
        isEventControlsExpanded = false
        isPollCreateExpanded = false
        isPaymentConfigExpanded = false
        isPaymentRequestsExpanded = false
        isRegistrationRequestsExpanded = false
        btnToggleAdminPanel.text = getString(R.string.admin_tools_open)
        btnToggleEventControls.text = getString(R.string.panel_expand)
        btnTogglePollCreateControls.text = getString(R.string.panel_expand)
        btnTogglePaymentConfig.text = getString(R.string.panel_expand)
        paymentConfigPanel.visibility = View.GONE
        btnTogglePaymentRequests.text = getString(R.string.panel_expand)
        btnToggleRegistrationRequests.text = getString(R.string.panel_expand)
        bindCommunityFunds(0)
        currentEventsLimit = EVENTS_PAGE_SIZE
        tvPaymentRequestsTitle.text = getString(R.string.payment_requests_title)
        tvRegistrationRequestsTitle.text = getString(R.string.registration_requests_title)
        pendingPaymentRequestsCount = 0
        pendingRegistrationRequestsCount = 0
        updateResidentsTabBadge()
        updateEventsTabBadge(0)
        renderPinnedMessage(null)
        clearReplyTarget()
        tabLayout.getTabAt(0)?.select()
        lifecycleScope.launch {
            runCatching { registerDeviceForPush() }
        }
        applyPendingNotificationDestination()

        userAdapter = UserListAdapter(
            currentUserIdProvider = { currentUser?.id },
            canManageUsers = canManageUsers,
            canManageModerators = isAdmin,
            onEditBalance = { target -> promptEditBalance(target) },
            onDelete = { target -> deleteUser(target) },
            onPromoteModerator = { target -> changeRole(target, Role.MODERATOR) },
            onDemoteModerator = { target -> changeRole(target, Role.USER) }
        )
        rvUsers.adapter = userAdapter

        resetUiState()
        attachRealtimeListeners(user)
    }

    private fun arrangePaymentCard(user: RemoteUser) {
        eventsContent.removeView(userPayControls)
        val targetIndex = when (user.role) {
            Role.MODERATOR -> eventsContent.indexOfChild(communityFundsCard) + 1
            else -> eventsContent.indexOfChild(eventControls) + 1
        }.coerceAtLeast(0)
        eventsContent.addView(userPayControls, targetIndex)
    }

    private fun resetUiState() {
        latestMessages.clear()
        olderMessages.clear()
        pinnedMessages = emptyList()
        currentPinnedMessageIndex = 0
        replyingToMessage = null
        selectedMentionedUsers.clear()
        everyoneMentionActive = false
        hasInitializedChatNotifications = false
        hasMoreOlderMessages = true
        isLoadingOlderMessages = false
        selectedChargeEvents = emptyList()
        availableChargeEvents = emptyList()
        latestEvents = emptyList()
        latestPolls = emptyList()
        updateEventsTabBadge(0)
        updateChatTabBadge(0)
        updatePollsTabBadge(0)
        chatAdapter.submitList(emptyList())
        eventAdapter.submitList(emptyList())
        pollAdapter.submitList(emptyList())
        auditLogAdapter.submitList(emptyList())
        paymentRequestAdapter.submitList(emptyList())
        registrationRequestAdapter.submitList(emptyList())
        unreadEventsBanner.visibility = View.GONE
        eventsInitialized = false
        lastSeenEventTimestamp = 0L
        paymentRequestsPanel.visibility = View.GONE
        registrationRequestsPanel.visibility = View.GONE
        if (::btnSelectChargeEvent.isInitialized) {
            btnSelectChargeEvent.text = getString(R.string.payment_select_event)
        }
        if (::tvRegistrationRequestsEmpty.isInitialized) {
            tvRegistrationRequestsEmpty.visibility = View.GONE
        }
        if (::tvPollsEmpty.isInitialized) {
            tvPollsEmpty.visibility = View.GONE
        }
        if (::tvLogsEmpty.isInitialized) {
            tvLogsEmpty.visibility = View.GONE
        }
        if (::pinnedMessageCard.isInitialized) {
            pinnedMessageCard.visibility = View.GONE
        }
        if (::chatReplyPreviewContainer.isInitialized) {
            chatReplyPreviewContainer.visibility = View.GONE
        }
    }

    private fun attachRealtimeListeners(user: RemoteUser) {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        auditLogsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        registrationRequestsListener?.remove()
        communityFundsListener?.remove()
        pinnedMessageListener?.remove()

        usersListener = repository.observeUsers(
            onChange = { users ->
                runOnUiThread {
                    userAdapter.submitList(users)
                    allUsers = users
                    tvResidentsEmpty.visibility = if (users.isEmpty()) View.VISIBLE else View.GONE
                    currentUser?.let { active ->
                        val refreshedUser = users.firstOrNull { it.id == active.id } ?: active
                        currentUser = refreshedUser
                        tvWelcome.text = refreshedUser.fullName
                        tvWelcomeDetails.text = getString(R.string.your_plot, refreshedUser.plotName)
                        bindBalanceHero(refreshedUser.balance)
                    }
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.users_load_failed)) } }
        )

        eventsListener = repository.observeEvents(
            limit = currentEventsLimit.toLong(),
            onChange = { events ->
                runOnUiThread {
                    val visibleItems = events.filter { event ->
                        event.targetUserId.isBlank() ||
                            event.targetUserId == user.id ||
                            canReviewPayments(user)
                    }
                    val visibleEvents = visibleItems.filter { it.type != EventType.POLL }
                    val visiblePolls = visibleItems.filter { it.type == EventType.POLL }
                    eventAdapter.submitList(visibleEvents)
                    pollAdapter.submitList(visiblePolls)
                    latestEvents = visibleEvents
                    latestPolls = visiblePolls
                    availableChargeEvents = visibleItems
                        .filter { it.type == EventType.CHARGE && it.amount > 0 && !it.isClosed }
                        .map { ChargeSuggestion(eventId = it.id, title = it.title, amount = it.amount) }
                    rvEvents.visibility = if (visibleEvents.isEmpty()) View.GONE else View.VISIBLE
                    rvPolls.visibility = if (visiblePolls.isEmpty()) View.GONE else View.VISIBLE
                    tvEventsEmpty.visibility = if (visibleEvents.isEmpty()) View.VISIBLE else View.GONE
                    tvPollsEmpty.visibility = if (visiblePolls.isEmpty()) View.VISIBLE else View.GONE
                    btnLoadMoreEvents.visibility = if (visibleItems.size >= currentEventsLimit) View.VISIBLE else View.GONE
                    currentUser?.id?.let { userId ->
                        val unreadEvents = eventStateStore.unreadEvents(userId, visibleEvents)
                        val unreadPolls = eventStateStore.unreadPolls(userId, visiblePolls)
                        renderUnreadEventsBanner(unreadEvents)
                        updatePollsTabBadge(unreadPolls.size)
                        handleLiveEventNotifications(user, unreadEvents, unreadPolls)
                    }

                    val newest = visibleItems.maxOfOrNull { it.createdAtClient } ?: 0L
                    if (eventsInitialized && newest > lastSeenEventTimestamp) {
                        val latestEvent = visibleItems.maxByOrNull { it.createdAtClient }
                        if (latestEvent != null && latestEvent.createdById != currentUser?.id && latestEvent.type != EventType.POLL) {
                            toast(getString(R.string.new_event_toast, latestEvent.title))
                        }
                    }
                    lastSeenEventTimestamp = maxOf(lastSeenEventTimestamp, newest)
                    eventsInitialized = true
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.events_load_failed)) } }
        )

        auditLogsListener = repository.observeAuditLogs(
            onChange = { logs ->
                runOnUiThread {
                    auditLogAdapter.submitList(logs)
                    rvLogs.visibility = if (logs.isEmpty()) View.GONE else View.VISIBLE
                    tvLogsEmpty.visibility = if (logs.isEmpty()) View.VISIBLE else View.GONE
                }
            },
            onError = {
                runOnUiThread {
                    auditLogAdapter.submitList(emptyList())
                    rvLogs.visibility = View.GONE
                    tvLogsEmpty.visibility = View.VISIBLE
                }
            }
        )

        paymentRequestsListener = repository.observePaymentRequests(
            currentUser = user,
            onChange = { requests ->
                runOnUiThread {
                    paymentRequestAdapter.submitList(requests)
                    paymentRequestsHeader.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
                    pendingPaymentRequestsCount = requests.count { it.status == ManualPaymentStatus.PENDING }
                    tvPaymentRequestsTitle.text = if (pendingPaymentRequestsCount > 0) {
                        getString(R.string.payment_requests_title_with_pending, pendingPaymentRequestsCount)
                    } else {
                        getString(R.string.payment_requests_title)
                    }
                    updateResidentsTabBadge()
                    rvPaymentRequests.visibility = if (isPaymentRequestsExpanded && requests.isNotEmpty()) View.VISIBLE else View.GONE
                    tvPaymentRequestsEmpty.visibility = if (isPaymentRequestsExpanded && requests.isEmpty()) View.VISIBLE else View.GONE
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.payment_requests_load_failed)) } }
        )

        paymentConfigListener = repository.observePaymentConfig(
            onChange = { config ->
                runOnUiThread {
                    currentPaymentConfig = config
                    renderPaymentConfig(config)
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.payment_config_load_failed)) } }
        )

        communityFundsListener = repository.observeCommunityFunds(
            onChange = { amount ->
                runOnUiThread { bindCommunityFunds(amount) }
            },
            onError = { runOnUiThread { toast(getString(R.string.community_funds_load_failed)) } }
        )

        if (canReviewPayments(user)) {
            registrationRequestsListener = repository.observeRegistrationRequests(
                onChange = { requests ->
                    runOnUiThread {
                        registrationRequestAdapter.submitList(requests)
                        val empty = requests.isEmpty()
                        pendingRegistrationRequestsCount = requests.count { it.status == RegistrationRequestStatus.PENDING }
                        registrationRequestsHeader.visibility = View.VISIBLE
                        tvRegistrationRequestsTitle.text = if (pendingRegistrationRequestsCount > 0) {
                            getString(R.string.registration_requests_title_with_pending, pendingRegistrationRequestsCount)
                        } else {
                            getString(R.string.registration_requests_title)
                        }
                        updateResidentsTabBadge()
                        rvRegistrationRequests.visibility = if (isRegistrationRequestsExpanded) View.VISIBLE else View.GONE
                        tvRegistrationRequestsEmpty.visibility = if (isRegistrationRequestsExpanded && empty) View.VISIBLE else View.GONE
                    }
                },
                onError = { runOnUiThread { toast(getString(R.string.registration_requests_load_failed)) } }
            )
        } else {
            registrationRequestAdapter.submitList(emptyList())
            registrationRequestsHeader.visibility = View.GONE
            registrationRequestsPanel.visibility = View.GONE
            tvRegistrationRequestsEmpty.visibility = View.GONE
            tvRegistrationRequestsTitle.text = getString(R.string.registration_requests_title)
            pendingRegistrationRequestsCount = 0
            updateResidentsTabBadge()
        }

        chatListener = repository.observeLatestMessages(
            pageSize = CHAT_PAGE_SIZE.toLong(),
            onChange = { messages ->
                runOnUiThread {
                    val wasNearBottom = chatLayoutManager.findLastVisibleItemPosition() >= maxOf(chatAdapter.itemCount - 3, 0)
                    latestMessages.clear()
                    latestMessages.addAll(messages)
                    updateChatList(scrollToBottom = wasNearBottom || olderMessages.isEmpty())
                    val mergedMessages = mergedChatMessages()
                    handleChatNotifications(user, mergedMessages)
                    if (chatContainer.visibility == View.VISIBLE) {
                        markChatRead()
                    } else {
                        val unreadMessages = eventStateStore.unreadChatMessages(user.id, mergedMessages)
                        updateChatTabBadge(unreadMessages.size)
                    }
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.chat_load_failed)) } }
        )

        pinnedMessageListener = repository.observePinnedMessages(
            onChange = { messages ->
                runOnUiThread {
                    pinnedMessages = messages
                    currentPinnedMessageIndex = currentPinnedMessageIndex.coerceIn(0, maxOf(messages.lastIndex, 0))
                    renderPinnedMessage(messages.getOrNull(currentPinnedMessageIndex))
                }
            },
            onError = {
                runOnUiThread { renderPinnedMessage(null) }
            }
        )
    }

    private fun updateChatList(scrollToBottom: Boolean = false) {
        val merged = mergedChatMessages()

        chatAdapter.submitList(merged) {
            rvChat.visibility = if (merged.isEmpty()) View.GONE else View.VISIBLE
            tvChatEmpty.visibility = if (merged.isEmpty()) View.VISIBLE else View.GONE
            if (scrollToBottom && merged.isNotEmpty()) {
                rvChat.scrollToPosition(merged.lastIndex)
            }
        }
    }

    private fun mergedChatMessages(): List<ChatMessage> {
        return (olderMessages + latestMessages)
            .distinctBy { it.id }
            .sortedBy { it.createdAtClient }
    }

    private fun renderPinnedMessage(message: ChatMessage?) {
        if (message == null) {
            pinnedMessageCard.visibility = View.GONE
            tvPinnedMessageCounter.text = ""
            return
        }
        pinnedMessageCard.visibility = View.VISIBLE
        tvPinnedMessageCounter.text = getString(
            R.string.chat_pinned_banner_counter,
            currentPinnedMessageIndex + 1,
            pinnedMessages.size.coerceAtLeast(1)
        )
        tvPinnedMessageTitle.text = buildString {
            append(message.senderName)
            if (message.senderPlotName.isNotBlank()) {
                append(" • ")
                append(message.senderPlotName)
            }
        }
        tvPinnedMessageTitle.text = formatSenderWithPlot(message.senderName, message.senderPlotName)
        tvPinnedMessageBody.text = message.text
        pinnedMessageCard.setOnClickListener {
            val index = chatAdapter.currentList.indexOfFirst { it.id == message.id }
            if (index >= 0) {
                tabLayout.getTabAt(1)?.select()
                rvChat.smoothScrollToPosition(index)
            }
            if (pinnedMessages.size > 1) {
                currentPinnedMessageIndex = (currentPinnedMessageIndex + 1) % pinnedMessages.size
                renderPinnedMessage(pinnedMessages[currentPinnedMessageIndex])
            }
        }
    }

    private fun handleChatNotifications(user: RemoteUser, messages: List<ChatMessage>) {
        val latestTimestamp = messages.maxOfOrNull { it.createdAtClient } ?: return
        if (!hasInitializedChatNotifications) {
            hasInitializedChatNotifications = true
            eventStateStore.setLastChatNotificationTimestamp(user.id, latestTimestamp)
            return
        }
        if (pushBackendClient.isConfigured() && eventStateStore.isPushRegistrationConfirmed(user.id)) {
            eventStateStore.setLastChatNotificationTimestamp(user.id, latestTimestamp)
            return
        }

        val lastNotified = eventStateStore.getLastChatNotificationTimestamp(user.id)
        val incomingMessages = messages.filter { it.senderId != user.id && it.createdAtClient > lastNotified }
        if (incomingMessages.isEmpty()) return

        val chatNotificationsEnabled = eventStateStore.isChatNotificationsEnabled(user.id)
        val mentionNotificationsEnabled = eventStateStore.isMentionNotificationsEnabled(user.id)
        val mentionMessage = incomingMessages.lastOrNull { it.mentionedUserIds.contains(user.id) }
        val latestIncoming = incomingMessages.maxByOrNull { it.createdAtClient } ?: return

        if (chatContainer.visibility != View.VISIBLE && (chatNotificationsEnabled || (mentionNotificationsEnabled && mentionMessage != null))) {
            val notificationTarget = mentionMessage ?: latestIncoming
            val titleRes = if (mentionMessage != null) R.string.chat_notification_mention_title else R.string.chat_notification_title
            val bodyRes = if (mentionMessage != null) R.string.chat_notification_mention_body else R.string.chat_notification_body
            com.example.malinkieco.notifications.EventNotificationHelper.showChatNotification(
                this,
                getString(titleRes),
                getString(bodyRes, notificationTarget.senderName, notificationTarget.text)
            )
        }

        eventStateStore.setLastChatNotificationTimestamp(user.id, latestIncoming.createdAtClient)
    }

    private fun handleLiveEventNotifications(
        user: RemoteUser,
        unreadEvents: List<CommunityEvent>,
        unreadPolls: List<CommunityEvent>
    ) {
        if (pushBackendClient.isConfigured() && eventStateStore.isPushRegistrationConfirmed(user.id)) {
            return
        }

        if (eventsContainer.visibility != View.VISIBLE && unreadEvents.isNotEmpty() && eventStateStore.isEventNotificationsEnabled(user.id)) {
            val latestEvent = unreadEvents.maxByOrNull { it.createdAtClient } ?: return
            val latestTimestamp = latestEvent.createdAtClient
            if (latestTimestamp > eventStateStore.getLastBackgroundNotificationTimestamp(user.id)) {
                EventNotificationHelper.showEventNotification(
                    this,
                    getString(R.string.push_event_created_title),
                    latestEvent.title,
                    destination = "events"
                )
                eventStateStore.setLastBackgroundNotificationTimestamp(user.id, latestTimestamp)
            }
        }

        if (pollsContainer.visibility != View.VISIBLE && unreadPolls.isNotEmpty() && eventStateStore.isPollNotificationsEnabled(user.id)) {
            val latestPoll = unreadPolls.maxByOrNull { it.createdAtClient } ?: return
            val latestTimestamp = latestPoll.createdAtClient
            if (latestTimestamp > eventStateStore.getLastPollNotificationTimestamp(user.id)) {
                EventNotificationHelper.showEventNotification(
                    this,
                    getString(R.string.push_poll_created_title),
                    latestPoll.title,
                    destination = "polls"
                )
                eventStateStore.setLastPollNotificationTimestamp(user.id, latestTimestamp)
            }
        }
    }

    private fun loadOlderMessages() {
        if (isLoadingOlderMessages || !hasMoreOlderMessages) return
        val oldestTimestamp = (olderMessages + latestMessages).minOfOrNull { it.createdAtClient } ?: return

        isLoadingOlderMessages = true
        lifecycleScope.launch {
            try {
                val page = withContext(Dispatchers.IO) {
                    repository.loadOlderMessages(oldestTimestamp, CHAT_PAGE_SIZE.toLong())
                }
                val currentFirstVisible = chatLayoutManager.findFirstVisibleItemPosition()
                val currentOffsetView = rvChat.getChildAt(0)
                val currentTopOffset = currentOffsetView?.top ?: 0

                olderMessages.addAll(0, page.messages)
                hasMoreOlderMessages = page.hasMore && page.messages.isNotEmpty()
                updateChatList(scrollToBottom = false)

                if (page.messages.isNotEmpty()) {
                    chatLayoutManager.scrollToPositionWithOffset(currentFirstVisible + page.messages.size, currentTopOffset)
                }
            } catch (_: Exception) {
                toast(getString(R.string.chat_load_older_failed))
            } finally {
                isLoadingOlderMessages = false
            }
        }
    }

    private fun addUser() {
        val plot = etNewPlot.text.toString().trim()
        val fullName = etNewFullName.text.toString().trim()
        val email = etNewEmail.text.toString().trim()
        val password = etNewPassword.text.toString()
        tilNewEmail.error = null
        tilNewPassword.error = null

        if (plot.isBlank() || fullName.isBlank() || email.isBlank() || password.isBlank()) {
            toast(getString(R.string.user_form_empty))
            return
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            tilNewEmail.error = getString(R.string.validation_email_invalid)
            return
        }
        if (password.length < 6) {
            tilNewPassword.error = getString(R.string.validation_password_short)
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.addUser(email, password, fullName, plot) }
                etNewPlot.text.clear()
                etNewFullName.text.clear()
                etNewEmail.text.clear()
                etNewPassword.text.clear()
                toast(getString(R.string.user_created))
                toggleAdminPanel(forceCollapse = true)
            } catch (error: Exception) {
                toast(getString(R.string.user_create_failed, error.localizedMessage ?: getString(R.string.generic_error)))
            }
        }
    }

    private fun changeRole(user: RemoteUser, role: Role) {
        val actor = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.setUserRole(user, role, actor) }
                toast(if (role == Role.MODERATOR) getString(R.string.moderator_assigned) else getString(R.string.moderator_removed))
            } catch (_: Exception) {
                toast(getString(R.string.role_change_failed))
            }
        }
    }

    private fun createEvent() {
        val creator = currentUser ?: return
        val title = etEventTitle.text.toString().trim()
        val message = etEventMessage.text.toString().trim()
        val type = when {
            rbEventCharge.isChecked -> EventType.CHARGE
            rbEventExpense.isChecked -> EventType.EXPENSE
            else -> EventType.INFO
        }
        val amount = etEventAmount.text.toString().toIntOrNull() ?: 0

        if (title.isBlank()) {
            toast(getString(R.string.event_title_required))
            return
        }
        if ((type == EventType.CHARGE || type == EventType.EXPENSE) && amount <= 0) {
            toast(getString(R.string.event_amount_required))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.createEvent(creator, title, message, type, amount, emptyList())
                    runCatching {
                        val pushTitle = when (type) {
                            EventType.CHARGE -> getString(R.string.push_charge_created_title)
                            EventType.EXPENSE -> getString(R.string.push_expense_created_title)
                            else -> getString(R.string.push_event_created_title)
                        }
                        publishBroadcastPush(
                            title = pushTitle,
                            body = title,
                            destination = "events",
                            category = "events",
                            excludedUserIds = listOf(creator.id)
                        )
                    }
                }
                etEventTitle.text.clear()
                etEventMessage.text.clear()
                etEventAmount.text.clear()
                rbEventInfo.isChecked = true
                toggleEventControlsPanel(forceCollapse = true)
                toast(getString(R.string.event_created))
            } catch (error: Exception) {
                toast(getString(R.string.event_create_failed, error.localizedMessage ?: getString(R.string.generic_error)))
            }
        }
    }

    private fun createPoll() {
        val creator = currentUser ?: return
        val title = etPollTitle.text.toString().trim()
        val message = etPollMessage.text.toString().trim()
        val pollOptions = etPollCreateOptions.text.toString()
            .lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()

        if (title.isBlank()) {
            toast(getString(R.string.event_title_required))
            return
        }
        if (pollOptions.size < 2) {
            toast(getString(R.string.poll_options_required))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.createEvent(creator, title, message, EventType.POLL, 0, pollOptions)
                    runCatching {
                        publishBroadcastPush(
                            title = getString(R.string.push_poll_created_title),
                            body = title,
                            destination = "polls",
                            category = "polls",
                            excludedUserIds = listOf(creator.id)
                        )
                    }
                }
                etPollTitle.text.clear()
                etPollMessage.text.clear()
                etPollCreateOptions.text.clear()
                togglePollCreatePanel(forceCollapse = true)
                toast(getString(R.string.poll_create_success))
            } catch (error: Exception) {
                toast(getString(R.string.event_create_failed, error.localizedMessage ?: getString(R.string.generic_error)))
            }
        }
    }

    private fun createManualPaymentRequest() {
        val amount = etPayAmount.text.toString().toIntOrNull()
        val purpose = etPayPurpose.text.toString().trim()
        val user = currentUser ?: return
        if (amount == null || amount <= 0) {
            toast(getString(R.string.payment_amount_invalid))
            return
        }
        if (!currentPaymentConfig.isConfigured()) {
            toast(getString(R.string.payment_config_missing))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.createPaymentRequest(
                        user = user,
                        amount = amount,
                        events = selectedChargeEvents,
                        purpose = purpose
                    )
                }
                etPayAmount.text.clear()
                etPayPurpose.text.clear()
                selectedChargeEvents = emptyList()
                updateSelectedChargeEventsUi()
                toast(getString(R.string.payment_request_created))
            } catch (_: Exception) {
                toast(getString(R.string.payment_request_create_failed))
            }
        }
    }

    private fun savePaymentConfig() {
        if (!canReviewPayments()) return
        val config = PaymentTransferConfig(
            recipientName = etRecipientName.text.toString(),
            recipientPhone = etRecipientPhone.text.toString(),
            bankName = etRecipientBank.text.toString(),
            sbpLink = etSbpLink.text.toString()
        )

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.savePaymentConfig(config) }
                togglePaymentConfigPanel(forceCollapse = true)
                toast(getString(R.string.payment_config_saved))
            } catch (_: Exception) {
                toast(getString(R.string.payment_config_save_failed))
            }
        }
    }

    private fun renderPaymentConfig(config: PaymentTransferConfig) {
        etRecipientName.setText(config.recipientName)
        etRecipientPhone.setText(config.recipientPhone)
        etRecipientBank.setText(config.bankName)
        etSbpLink.setText(config.sbpLink)

        tvPaymentTransferInfo.text = if (config.isConfigured()) {
            getString(
                R.string.payment_transfer_info,
                config.recipientName.ifBlank { getString(R.string.payment_config_not_set) },
                config.recipientPhone.ifBlank { getString(R.string.payment_config_not_set) },
                config.bankName.ifBlank { getString(R.string.payment_config_not_set) }
            )
        } else {
            getString(R.string.payment_transfer_empty)
        }

        btnOpenSbp.isEnabled = config.sbpLink.isNotBlank()
        btnCopyPaymentDetails.isEnabled = config.isConfigured()
    }

    private fun openSbpLink() {
        val sbpLink = currentPaymentConfig.sbpLink.trim()
        if (sbpLink.isBlank()) {
            toast(getString(R.string.payment_sbp_unavailable))
            return
        }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(sbpLink))) }
            .onFailure { toast(getString(R.string.payment_sbp_open_failed)) }
    }

    private fun copyPaymentDetails() {
        if (!currentPaymentConfig.isConfigured()) {
            toast(getString(R.string.payment_config_missing))
            return
        }

        val text = buildString {
            append(getString(R.string.payment_copy_block_title))
            append('\n')
            append(
                getString(
                    R.string.payment_transfer_info,
                    currentPaymentConfig.recipientName.ifBlank { getString(R.string.payment_config_not_set) },
                    currentPaymentConfig.recipientPhone.ifBlank { getString(R.string.payment_config_not_set) },
                    currentPaymentConfig.bankName.ifBlank { getString(R.string.payment_config_not_set) }
                )
            )
        }
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.payment_copy_clip_label), text))
        toast(getString(R.string.payment_details_copied))
    }

    private fun confirmPaymentRequest(request: ManualPaymentRequest) {
        val reviewer = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.confirmPaymentRequest(request.id, reviewer)
                    runCatching {
                        publishTargetedPush(
                            userIds = listOf(request.userId),
                            title = getString(R.string.push_payment_confirmed_title),
                            body = getString(R.string.push_payment_confirmed_body, request.amount),
                            destination = "events",
                            category = "payments"
                        )
                    }
                }
                toast(getString(R.string.payment_request_confirmed_toast))
            } catch (error: Exception) {
                toast("${getString(R.string.payment_request_confirm_failed)}: ${error.localizedMessage ?: getString(R.string.generic_error)}")
            }
        }
    }

    private fun promptRejectPaymentRequest(request: ManualPaymentRequest) {
        val input = EditText(this).apply {
            hint = getString(R.string.payment_request_reject_reason_hint)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.payment_request_reject_dialog_title)
            .setView(input)
            .setPositiveButton(R.string.payment_request_reject_button) { _, _ ->
                rejectPaymentRequest(request, input.text.toString())
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun rejectPaymentRequest(request: ManualPaymentRequest, reason: String) {
        val reviewer = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.rejectPaymentRequest(request.id, reviewer, reason)
                    runCatching {
                        publishTargetedPush(
                            userIds = listOf(request.userId),
                            title = getString(R.string.push_payment_rejected_title),
                            body = getString(
                                R.string.push_payment_rejected_body,
                                reason.ifBlank { getString(R.string.registration_request_reason_empty) }
                            ),
                            destination = "events",
                            category = "payments"
                        )
                    }
                }
                toast(getString(R.string.payment_request_rejected_toast))
            } catch (error: Exception) {
                toast("${getString(R.string.payment_request_reject_failed)}: ${error.localizedMessage ?: getString(R.string.generic_error)}")
            }
        }
    }

    private fun promptEditBalance(user: RemoteUser) {
        val input = EditText(this).apply {
            hint = "Например: -100, 0 или 250"
            setText(user.balance.toString())
            setSelection(text?.length ?: 0)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
        }
        AlertDialog.Builder(this)
            .setTitle("Изменить баланс")
            .setMessage("${user.fullName} (${user.plotName})")
            .setView(input)
            .setPositiveButton("Сохранить") { _, _ ->
                val newBalance = input.text.toString().trim().toIntOrNull()
                if (newBalance == null) {
                    toast("Введите корректное значение баланса")
                } else {
                    updateUserBalance(user, newBalance)
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun updateUserBalance(user: RemoteUser, newBalance: Int) {
        val actor = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.setUserBalance(user, newBalance, actor) }
            } catch (error: Exception) {
                toast(getString(R.string.balance_change_failed))
            }
        }
    }

    private fun promptEditCommunityFunds() {
        val user = currentUser ?: return
        if (user.role != Role.ADMIN) return

        val input = EditText(this).apply {
            hint = "Введите общую сумму поселка"
            setText(tvCommunityFunds.text.toString().filter { it.isDigit() || it == '-' })
            setSelection(text?.length ?: 0)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        AlertDialog.Builder(this)
            .setTitle("Изменить общую сумму")
            .setView(input)
            .setPositiveButton("Сохранить") { _, _ ->
                val amount = input.text.toString().trim().toIntOrNull()
                if (amount == null) {
                    toast("Введите корректную сумму")
                } else {
                    lifecycleScope.launch {
                        runCatching {
                            val previousAmount = tvCommunityFunds.text.toString()
                                .filter { it.isDigit() || it == '-' }
                                .toIntOrNull() ?: 0
                            withContext(Dispatchers.IO) { repository.setCommunityFunds(amount, user, previousAmount) }
                        }.onFailure {
                            toast("Не удалось обновить общую сумму")
                        }
                    }
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun promptCloseCharge(event: CommunityEvent) {
        val reviewer = currentUser ?: return
        if (reviewer.role != Role.ADMIN && reviewer.role != Role.MODERATOR) return
        val isPoll = event.type == EventType.POLL

        AlertDialog.Builder(this)
            .setTitle(if (isPoll) "Закрыть опрос" else "Закрыть сбор")
            .setMessage(
                if (isPoll) {
                    "Опрос \"${event.title}\" будет закрыт и останется в событиях как завершенный."
                } else {
                    "Сбор \"${event.title}\" будет закрыт. У пользователей он исчезнет из выбора, а в событиях останется как завершенный."
                }
            )
            .setPositiveButton(if (isPoll) "Закрыть опрос" else "Закрыть") { _, _ ->
                lifecycleScope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repository.closeEvent(event.id, reviewer)
                            runCatching {
                                publishBroadcastPush(
                                    title = if (isPoll) getString(R.string.push_poll_closed_title) else getString(R.string.push_charge_closed_title),
                                    body = event.title,
                                    destination = if (isPoll) "polls" else "events",
                                    category = if (isPoll) "polls" else "events",
                                    excludedUserIds = listOf(reviewer.id)
                                )
                            }
                        }
                    }.onSuccess {
                        toast(if (isPoll) "Опрос закрыт" else "Сбор закрыт")
                    }.onFailure { error ->
                        toast("Не удалось закрыть: ${error.localizedMessage ?: getString(R.string.generic_error)}")
                    }
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun voteInPoll(event: CommunityEvent, option: String) {
        val voter = currentUser ?: return
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { repository.voteInPoll(event.id, option, voter) }
            }.onSuccess {
                toast(getString(R.string.poll_vote_saved))
            }.onFailure { error ->
                toast(getString(R.string.poll_vote_failed, error.localizedMessage ?: getString(R.string.generic_error)))
            }
        }
    }

    private fun deleteUser(user: RemoteUser) {
        val actor = currentUser ?: return
        if (user.id == currentUser?.id) {
            toast(getString(R.string.delete_self_forbidden))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.deleteUser(user, actor) }
                toast(getString(R.string.user_deleted))
            } catch (_: Exception) {
                toast(getString(R.string.user_delete_failed))
            }
        }
    }

    private fun sendMessage() {
        val text = etChatMessage.text.toString().trim()
        val user = currentUser ?: return
        if (text.isBlank()) {
            toast(getString(R.string.chat_message_empty))
            return
        }

        lifecycleScope.launch {
            try {
                val everyoneTag = "@${getString(R.string.chat_mentions_everyone)}"
                val mentionedUsers = buildList {
                    addAll(selectedMentionedUsers.filter { text.contains("@${it.fullName}") })
                    if (text.contains(everyoneTag)) {
                        addAll(allUsers.filter { it.id != user.id })
                    }
                }.distinctBy { it.id }
                withContext(Dispatchers.IO) {
                    repository.sendChatMessage(
                        sender = user,
                        text = text,
                        replyTo = replyingToMessage,
                        mentionedUsers = mentionedUsers
                    )
                    publishBroadcastPush(
                        title = getString(R.string.chat_push_new_message_title),
                        body = getString(R.string.chat_notification_body, user.fullName, text),
                        destination = "chat",
                        category = "chat",
                        excludedUserIds = buildList {
                            add(user.id)
                            addAll(mentionedUsers.map { it.id })
                        }
                    )
                    if (mentionedUsers.isNotEmpty()) {
                        publishTargetedPush(
                            userIds = mentionedUsers.map { it.id },
                            title = getString(R.string.chat_notification_mention_title),
                            body = getString(R.string.chat_notification_mention_body, user.fullName, text),
                            destination = "chat",
                            category = "mention"
                        )
                    }
                }
                etChatMessage.text.clear()
                selectedMentionedUsers.clear()
                everyoneMentionActive = false
                clearReplyTarget()
            } catch (_: Exception) {
                toast(getString(R.string.chat_send_failed))
            }
        }
    }

    private fun doLogout() {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        auditLogsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        registrationRequestsListener?.remove()
        communityFundsListener?.remove()
        pinnedMessageListener?.remove()
        EventReminderScheduler.cancel(applicationContext)
        repository.logout()
        currentUser = null
        currentPaymentConfig = PaymentTransferConfig()
        resetUiState()
        configureTabs(includeLogs = false)
        loginContainer.visibility = View.VISIBLE
        dashboardContainer.visibility = View.GONE
        btnOpenSettings.visibility = View.GONE
        etLoginPassword.text.clear()
    }

    private fun showEventsTab() {
        eventsContainer.visibility = View.VISIBLE
        chatContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        pollsContainer.visibility = View.GONE
        logsContainer.visibility = View.GONE
    }

    private fun showPollsTab() {
        eventsContainer.visibility = View.GONE
        chatContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        pollsContainer.visibility = View.VISIBLE
        logsContainer.visibility = View.GONE
        markPollsAsRead()
    }

    private fun showResidentsTab() {
        eventsContainer.visibility = View.GONE
        chatContainer.visibility = View.GONE
        residentsContainer.visibility = View.VISIBLE
        pollsContainer.visibility = View.GONE
        logsContainer.visibility = View.GONE
    }

    private fun showChatTab() {
        eventsContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        pollsContainer.visibility = View.GONE
        logsContainer.visibility = View.GONE
        chatContainer.visibility = View.VISIBLE
        markChatRead()
    }

    private fun showLogsTab() {
        eventsContainer.visibility = View.GONE
        chatContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        pollsContainer.visibility = View.GONE
        logsContainer.visibility = View.VISIBLE
    }

    private fun toggleAdminPanel(forceCollapse: Boolean = false) {
        isAdminPanelExpanded = if (forceCollapse) false else !isAdminPanelExpanded
        adminFormContainer.visibility = if (isAdminPanelExpanded) View.VISIBLE else View.GONE
        btnToggleAdminPanel.text = if (isAdminPanelExpanded) getString(R.string.admin_tools_close) else getString(R.string.admin_tools_open)
    }

    private fun toggleEventControlsPanel(forceCollapse: Boolean = false) {
        isEventControlsExpanded = if (forceCollapse) false else !isEventControlsExpanded
        eventControlsPanel.visibility = if (isEventControlsExpanded) View.VISIBLE else View.GONE
        btnToggleEventControls.text = if (isEventControlsExpanded) getString(R.string.panel_collapse) else getString(R.string.panel_expand)
    }

    private fun togglePollCreatePanel(forceCollapse: Boolean = false) {
        isPollCreateExpanded = if (forceCollapse) false else !isPollCreateExpanded
        pollCreatePanel.visibility = if (isPollCreateExpanded) View.VISIBLE else View.GONE
        btnTogglePollCreateControls.text = if (isPollCreateExpanded) getString(R.string.panel_collapse) else getString(R.string.panel_expand)
    }

    private fun togglePaymentConfigPanel(forceCollapse: Boolean = false) {
        isPaymentConfigExpanded = if (forceCollapse) false else !isPaymentConfigExpanded
        paymentConfigPanel.visibility = if (isPaymentConfigExpanded) View.VISIBLE else View.GONE
        btnTogglePaymentConfig.text = if (isPaymentConfigExpanded) getString(R.string.panel_collapse) else getString(R.string.panel_expand)
    }

    private fun togglePaymentRequestsPanel() {
        isPaymentRequestsExpanded = !isPaymentRequestsExpanded
        paymentRequestsPanel.visibility = if (isPaymentRequestsExpanded) View.VISIBLE else View.GONE
        btnTogglePaymentRequests.text = if (isPaymentRequestsExpanded) getString(R.string.panel_collapse) else getString(R.string.panel_expand)
        rvPaymentRequests.visibility = if (isPaymentRequestsExpanded && paymentRequestAdapter.currentList.isNotEmpty()) View.VISIBLE else View.GONE
        tvPaymentRequestsEmpty.visibility = if (isPaymentRequestsExpanded && paymentRequestAdapter.currentList.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun toggleRegistrationRequestsPanel() {
        isRegistrationRequestsExpanded = !isRegistrationRequestsExpanded
        registrationRequestsPanel.visibility = if (isRegistrationRequestsExpanded) View.VISIBLE else View.GONE
        rvRegistrationRequests.visibility = if (isRegistrationRequestsExpanded) View.VISIBLE else View.GONE
        btnToggleRegistrationRequests.text = if (isRegistrationRequestsExpanded) getString(R.string.panel_collapse) else getString(R.string.panel_expand)
        tvRegistrationRequestsEmpty.visibility = if (isRegistrationRequestsExpanded && registrationRequestAdapter.currentList.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun renderUnreadEventsBanner(unreadEvents: List<CommunityEvent>) {
        if (unreadEvents.isEmpty()) {
            unreadEventsBanner.visibility = View.GONE
            updateEventsTabBadge(0)
            eventAdapter.notifyDataSetChanged()
            pollAdapter.notifyDataSetChanged()
            return
        }

        val latestEvent = unreadEvents.maxByOrNull { it.createdAtClient } ?: return
        unreadEventsBanner.visibility = View.VISIBLE
        tvUnreadEventsTitle.text = resources.getQuantityString(R.plurals.unread_events_title, unreadEvents.size, unreadEvents.size)
        tvUnreadEventsSubtitle.text = getString(R.string.unread_events_subtitle, latestEvent.title)
        updateEventsTabBadge(unreadEvents.size)
        eventAdapter.notifyDataSetChanged()
        pollAdapter.notifyDataSetChanged()
    }

    private fun markEventsAsRead() {
        val userId = currentUser?.id ?: return
        val latestTimestamp = eventAdapter.currentList.maxOfOrNull { it.createdAtClient } ?: return
        eventStateStore.setLastSeenEventTimestamp(userId, latestTimestamp)
        eventStateStore.setLastBackgroundNotificationTimestamp(
            userId,
            maxOf(eventStateStore.getLastBackgroundNotificationTimestamp(userId), latestTimestamp)
        )
        renderUnreadEventsBanner(emptyList())
    }

    private fun markPollsAsRead() {
        val userId = currentUser?.id ?: return
        val latestTimestamp = pollAdapter.currentList
            .filter { !it.isClosed }
            .maxOfOrNull { it.createdAtClient } ?: run {
            updatePollsTabBadge(0)
            return
        }
        eventStateStore.setLastSeenPollTimestamp(userId, latestTimestamp)
        updatePollsTabBadge(0)
    }

    private fun bindBalanceHero(balance: Int) {
        tvBalanceHero.text = getString(R.string.balance_hero_format, balance)
        tvBalanceHeroStatus.text = when {
            balance > 0 -> getString(R.string.status_overpaid)
            balance < 0 -> getString(R.string.status_debt)
            else -> getString(R.string.status_clear)
        }
        val colorRes = when {
            balance < 0 -> R.color.summary_debt_light
            balance > 0 -> R.color.summary_overpaid_light
            else -> R.color.summary_clear_light
        }
        val color = ContextCompat.getColor(this, colorRes)
        summaryCard.setCardBackgroundColor(color)
        summaryCard.backgroundTintList = ColorStateList.valueOf(color)
    }

    private fun bindCommunityFunds(amount: Int) {
        tvCommunityFunds.text = getString(R.string.community_funds_format, amount)
    }

    private fun updateEventForm() {
        val amountVisible = rbEventCharge.isChecked || rbEventExpense.isChecked
        val pollVisible = rbEventPoll.isChecked
        eventAmountLayout.visibility = if (amountVisible) View.VISIBLE else View.GONE
        pollOptionsLayout.visibility = if (pollVisible) View.VISIBLE else View.GONE
        if (!amountVisible) {
            etEventAmount.text.clear()
        }
        if (!pollVisible) {
            etPollOptions.text.clear()
        }
        val hint = when {
            rbEventExpense.isChecked -> getString(R.string.event_expense_amount_hint)
            else -> getString(R.string.event_amount_hint)
        }
        eventAmountLayout.hint = hint
        etEventAmount.hint = hint
    }

    private fun setupEventTemplates() {
        etEventTitle.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus && currentTemplates().isNotEmpty()) {
                showTemplatePicker()
            }
        }
    }

    private fun showTemplatePicker() {
        val templates = currentTemplates()
        if (templates.isEmpty()) return

        val items = templates.map { it.name }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(R.string.event_template_picker_title)
            .setItems(items) { _, which ->
                if (which in templates.indices) {
                    applyEventTemplate(templates[which])
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun currentTemplates(): List<EventTemplate> {
        val type = when {
            rbEventCharge.isChecked -> EventType.CHARGE
            rbEventExpense.isChecked -> EventType.EXPENSE
            rbEventPoll.isChecked -> EventType.POLL
            else -> EventType.INFO
        }
        return when (type) {
            EventType.CHARGE -> listOf(
                EventTemplate(
                    name = "Нужды КП",
                    title = "Сбор средств на нужды КП",
                    message = "Проводится сбор средств на нужды коттеджного поселка. Просьба внести оплату в установленный срок.",
                    type = EventType.CHARGE
                )
            )
            EventType.EXPENSE -> listOf(
                EventTemplate(
                    name = "За электричество",
                    title = "Оплата за электричество",
                    message = "Из общей суммы поселка проводится оплата за электричество. Средства списываются на покрытие текущих расходов по электроэнергии.",
                    type = EventType.EXPENSE
                ),
                EventTemplate(
                    name = "Вывоз мусора",
                    title = "Оплата за вывоз мусора",
                    message = "Из общей суммы поселка проводится оплата за вывоз мусора. Это обязательный расход для поддержания порядка на территории КП.",
                    type = EventType.EXPENSE
                ),
                EventTemplate(
                    name = "Покос травы",
                    title = "Оплата за покос травы",
                    message = "Из общей суммы поселка проводится оплата за покос травы и обслуживание общей территории.",
                    type = EventType.EXPENSE
                ),
                EventTemplate(
                    name = "Уборка снега",
                    title = "Оплата за уборку снега",
                    message = "Из общей суммы поселка проводится оплата за уборку снега и расчистку проездов внутри КП.",
                    type = EventType.EXPENSE
                ),
                EventTemplate(
                    name = "Налоги",
                    title = "Оплата налогов",
                    message = "Из общей суммы поселка проводится оплата налогов и обязательных начислений.",
                    type = EventType.EXPENSE
                )
            )
            else -> EVENT_TEMPLATES.filter { it.type == type }
        }
    }

    private fun applyEventTemplate(template: EventTemplate) {
        etEventTitle.setText(template.title)
        etEventMessage.setText(template.message)
        when (template.type) {
            EventType.INFO -> rbEventInfo.isChecked = true
            EventType.CHARGE -> rbEventCharge.isChecked = true
            EventType.EXPENSE -> rbEventExpense.isChecked = true
            EventType.POLL -> rbEventPoll.isChecked = true
        }
    }

    private fun chooseChargeEvent() {
        if (availableChargeEvents.isEmpty()) {
            toast(getString(R.string.payment_select_event_empty))
            return
        }

        val selectedIds = selectedChargeEvents.map { it.eventId }.toMutableSet()
        val labels = availableChargeEvents.map { event ->
            getString(R.string.payment_select_event_item_multiline, event.title, event.amount, event.amount * currentPlotCount())
        }.toTypedArray()
        val checkedItems = availableChargeEvents.map { selectedIds.contains(it.eventId) }.toBooleanArray()

        AlertDialog.Builder(this)
            .setTitle(R.string.payment_select_event_dialog_title)
            .setMultiChoiceItems(labels, checkedItems) { _, which, isChecked ->
                val target = availableChargeEvents[which]
                if (isChecked) {
                    selectedIds.add(target.eventId)
                } else {
                    selectedIds.remove(target.eventId)
                }
            }
            .setPositiveButton(android.R.string.ok) { _, _ ->
                selectedChargeEvents = availableChargeEvents.filter { selectedIds.contains(it.eventId) }
                val totalAmount = selectedChargeEvents.sumOf { it.amount } * currentPlotCount()
                if (selectedChargeEvents.isNotEmpty()) {
                    etPayAmount.setText(totalAmount.toString())
                    etPayPurpose.setText(selectedChargeEvents.joinToString(", ") { it.title })
                }
                updateSelectedChargeEventsUi()
            }
            .setNegativeButton(R.string.payment_select_event_reset) { _, _ ->
                selectedChargeEvents = emptyList()
                etPayPurpose.text.clear()
                updateSelectedChargeEventsUi()
            }
            .show()
    }

    private fun updateSelectedChargeEventsUi() {
        btnSelectChargeEvent.text = when {
            selectedChargeEvents.isEmpty() -> getString(R.string.payment_select_event)
            selectedChargeEvents.size == 1 -> getString(R.string.payment_selected_event, selectedChargeEvents.first().title)
            else -> getString(R.string.payment_selected_events_count, selectedChargeEvents.size)
        }
    }

    private fun promptEditMessage(message: ChatMessage) {
        val contentView = layoutInflater.inflate(R.layout.dialog_chat_edit, null)
        val input = contentView.findViewById<TextInputEditText>(R.id.etEditChatMessage)
        input.setText(message.text)
        input.setSelection(input.text?.length ?: 0)

        AlertDialog.Builder(this)
            .setView(contentView)
            .setPositiveButton(R.string.chat_action_edit) { _, _ ->
                saveEditedMessage(message, input.text?.toString().orEmpty())
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun saveEditedMessage(message: ChatMessage, newText: String) {
        val user = currentUser ?: return
        if (newText.isBlank()) {
            toast(getString(R.string.chat_message_empty))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.updateChatMessage(message.id, user, newText) }
                toast(getString(R.string.chat_edit_success))
            } catch (_: Exception) {
                toast(getString(R.string.chat_edit_failed))
            }
        }
    }

    private fun confirmDeleteMessage(message: ChatMessage) {
        val contentView = layoutInflater.inflate(R.layout.dialog_chat_delete, null)
        contentView.findViewById<TextView>(R.id.tvDeleteChatMessagePreview).text =
            getString(R.string.chat_delete_dialog_preview, message.text)

        AlertDialog.Builder(this)
            .setView(contentView)
            .setPositiveButton(R.string.chat_action_delete) { _, _ ->
                deleteMessage(message)
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun deleteMessage(message: ChatMessage) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.deleteChatMessage(message.id) }
                latestMessages.removeAll { it.id == message.id }
                olderMessages.removeAll { it.id == message.id }
                pinnedMessages = pinnedMessages.filterNot { it.id == message.id }
                if (replyingToMessage?.id == message.id) {
                    replyingToMessage = null
                    tvReplyingToTitle.text = getString(R.string.chat_reply_deleted)
                    tvReplyingToBody.text = getString(R.string.chat_reply_deleted)
                    chatReplyPreviewContainer.visibility = View.GONE
                }
                currentPinnedMessageIndex = currentPinnedMessageIndex.coerceIn(0, maxOf(pinnedMessages.lastIndex, 0))
                renderPinnedMessage(pinnedMessages.getOrNull(currentPinnedMessageIndex))
                updateChatList()
                toast(getString(R.string.chat_delete_success))
            } catch (_: Exception) {
                toast(getString(R.string.chat_delete_failed))
            }
        }
    }

    private fun openReplyTarget(messageId: String) {
        if (messageId.isBlank()) return
        val targetIndex = chatAdapter.currentList.indexOfFirst { it.id == messageId }
        if (targetIndex < 0) {
            toast(getString(R.string.chat_reply_deleted))
            return
        }
        tabLayout.getTabAt(1)?.select()
        rvChat.post {
            rvChat.smoothScrollToPosition(targetIndex)
        }
    }

    private fun markChatRead() {
        val user = currentUser ?: return
        val latestTimestamp = chatAdapter.currentList.maxOfOrNull { it.createdAtClient } ?: 0L
        if (latestTimestamp > 0L) {
            eventStateStore.setLastSeenChatTimestamp(user.id, latestTimestamp)
            eventStateStore.setLastChatNotificationTimestamp(
                user.id,
                maxOf(eventStateStore.getLastChatNotificationTimestamp(user.id), latestTimestamp)
            )
        }
        updateChatTabBadge(0)
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { repository.markChatRead(user.id) }
            }
        }
    }

    private fun startReplyToMessage(message: ChatMessage) {
        replyingToMessage = message
        tvReplyingToTitle.text = buildString {
            append(getString(R.string.chat_reply_to_prefix, message.senderName))
            if (message.senderPlotName.isNotBlank()) {
                append(" • ")
                append(message.senderPlotName)
            }
        }
        tvReplyingToTitle.text = getString(R.string.chat_reply_to_prefix, formatSenderWithPlot(message.senderName, message.senderPlotName))
        tvReplyingToBody.text = message.text
        chatReplyPreviewContainer.visibility = View.VISIBLE
        tabLayout.getTabAt(1)?.select()
        etChatMessage.requestFocus()
    }

    private fun clearReplyTarget() {
        replyingToMessage = null
        chatReplyPreviewContainer.visibility = View.GONE
    }

    private fun openInlineMentionPicker() {
        if (allUsers.isEmpty()) {
            toast(getString(R.string.chat_mentions_empty))
            return
        }
        val candidates = allUsers.filter { it.id != currentUser?.id }
        val everyoneLabel = "@${getString(R.string.chat_mentions_everyone)}"
        val labels = buildList {
            add(everyoneLabel)
            addAll(candidates.map {
                buildString {
                    append("@")
                    append(it.fullName)
                    if (it.plotName.isNotBlank()) {
                        append(" • ")
                        append(it.plotName)
                    }
                }
            })
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle(R.string.chat_mentions_picker_title)
            .setItems(labels) { _, which ->
                if (which == 0) {
                    everyoneMentionActive = true
                    insertMentionToken(everyoneLabel)
                    return@setItems
                }
                val selected = candidates.getOrNull(which - 1) ?: return@setItems
                selectedMentionedUsers.add(selected)
                insertMentionToken("@${selected.fullName}")
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun insertMentionToken(token: String) {
        val currentText = etChatMessage.text?.toString().orEmpty()
        val atIndex = currentText.lastIndexOf('@')
        val updatedText = if (atIndex >= 0) {
            currentText.substring(0, atIndex) + token + " "
        } else {
            "$currentText$token "
        }
        suppressMentionPicker = true
        etChatMessage.setText(updatedText)
        etChatMessage.setSelection(etChatMessage.text?.length ?: 0)
        suppressMentionPicker = false
    }

    private fun showModernMentionPicker() {
        if (allUsers.isEmpty()) {
            toast(getString(R.string.chat_mentions_empty))
            return
        }
        val candidates = allUsers.filter { it.id != currentUser?.id }
        val everyoneLabel = "@${getString(R.string.chat_mentions_everyone)}"
        val labels = buildList {
            add(everyoneLabel)
            addAll(candidates.map { user ->
                buildString {
                    append("@")
                    append(user.fullName)
                    val plots = formatUserPlots(user)
                    if (plots.isNotBlank()) {
                        append(" | ")
                        append(plots)
                    }
                }
            })
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle(R.string.chat_mentions_picker_title)
            .setItems(labels) { _, which ->
                if (which == 0) {
                    everyoneMentionActive = true
                    insertMentionToken(everyoneLabel)
                    return@setItems
                }
                val selected = candidates.getOrNull(which - 1) ?: return@setItems
                selectedMentionedUsers.add(selected)
                insertMentionToken("@${selected.fullName}")
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun formatUserPlots(user: RemoteUser): String {
        val normalizedPlots = user.plots
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        return when {
            normalizedPlots.isNotEmpty() -> normalizedPlots.joinToString(", ")
            user.plotName.isNotBlank() -> user.plotName.trim()
            else -> ""
        }
    }

    private fun formatSenderWithPlot(senderName: String, plotName: String): String {
        return if (plotName.isBlank()) senderName else "$senderName | $plotName"
    }

    private fun showMentionPicker() {
        if (allUsers.isEmpty()) {
            toast(getString(R.string.chat_mentions_empty))
            return
        }
        val candidates = allUsers.filter { it.id != currentUser?.id }
        val labels = candidates.map {
            buildString {
                append(it.fullName)
                if (it.plotName.isNotBlank()) {
                    append(" • ")
                    append(it.plotName)
                }
            }
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle(R.string.chat_mentions_picker_title)
            .setItems(labels) { _, which ->
                val selected = candidates.getOrNull(which) ?: return@setItems
                selectedMentionedUsers.add(selected)
                val mentionText = "@${selected.fullName} "
                val currentText = etChatMessage.text?.toString().orEmpty()
                etChatMessage.setText(currentText + mentionText)
                etChatMessage.setSelection(etChatMessage.text?.length ?: 0)
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun togglePinMessage(message: ChatMessage) {
        val user = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.toggleChatMessagePin(message.id, user, !message.isPinned)
                }
                toast(
                    getString(
                        if (message.isPinned) R.string.chat_unpinned_success else R.string.chat_pinned_success
                    )
                )
            } catch (_: Exception) {
                toast(getString(R.string.chat_pin_failed))
            }
        }
    }

    private fun showSettingsDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_settings, null)
        val themeGroup = dialogView.findViewById<RadioGroup>(R.id.rgThemeMode)
        val rbThemeSystem = dialogView.findViewById<RadioButton>(R.id.rbThemeSystem)
        val rbThemeLight = dialogView.findViewById<RadioButton>(R.id.rbThemeLight)
        val rbThemeDark = dialogView.findViewById<RadioButton>(R.id.rbThemeDark)
        val switchChatMessages = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsChatMessages)
        val switchChatMentions = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsChatMentions)
        val switchEvents = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsEvents)
        val switchPolls = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsPolls)
        val switchPayments = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsPayments)
        val switchRegistration = dialogView.findViewById<MaterialSwitch>(R.id.switchSettingsRegistration)
        val user = currentUser
        val userId = user?.id
        val isStaff = user?.role == Role.ADMIN || user?.role == Role.MODERATOR

        when (eventStateStore.getThemeMode()) {
            EventStateStore.ThemeMode.SYSTEM -> rbThemeSystem.isChecked = true
            EventStateStore.ThemeMode.LIGHT -> rbThemeLight.isChecked = true
            EventStateStore.ThemeMode.DARK -> rbThemeDark.isChecked = true
        }

        if (userId != null) {
            switchChatMessages.isChecked = eventStateStore.isChatNotificationsEnabled(userId)
            switchChatMentions.isChecked = eventStateStore.isMentionNotificationsEnabled(userId)
            switchEvents.isChecked = eventStateStore.isEventNotificationsEnabled(userId)
            switchPolls.isChecked = eventStateStore.isPollNotificationsEnabled(userId)
            switchPayments.isChecked = eventStateStore.isPaymentNotificationsEnabled(userId)
            switchRegistration.isChecked = eventStateStore.isRegistrationNotificationsEnabled(userId)
            switchRegistration.visibility = if (isStaff) View.VISIBLE else View.GONE
        } else {
            listOf(
                switchChatMessages,
                switchChatMentions,
                switchEvents,
                switchPolls,
                switchPayments,
                switchRegistration
            ).forEach { it.isEnabled = false }
            switchRegistration.visibility = View.GONE
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.settings_title)
            .setView(dialogView)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val selectedTheme = when (themeGroup.checkedRadioButtonId) {
                    R.id.rbThemeLight -> EventStateStore.ThemeMode.LIGHT
                    R.id.rbThemeDark -> EventStateStore.ThemeMode.DARK
                    else -> EventStateStore.ThemeMode.SYSTEM
                }
                eventStateStore.setThemeMode(selectedTheme)
                applyThemeMode(selectedTheme)
                userId?.let {
                    eventStateStore.setChatNotificationsEnabled(it, switchChatMessages.isChecked)
                    eventStateStore.setMentionNotificationsEnabled(it, switchChatMentions.isChecked)
                    eventStateStore.setEventNotificationsEnabled(it, switchEvents.isChecked)
                    eventStateStore.setPollNotificationsEnabled(it, switchPolls.isChecked)
                    eventStateStore.setPaymentNotificationsEnabled(it, switchPayments.isChecked)
                    eventStateStore.setRegistrationNotificationsEnabled(it, switchRegistration.isChecked)
                }
                toast(getString(R.string.settings_saved))
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun applyThemeMode(mode: EventStateStore.ThemeMode) {
        val nightMode = when (mode) {
            EventStateStore.ThemeMode.SYSTEM -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            EventStateStore.ThemeMode.LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
            EventStateStore.ThemeMode.DARK -> AppCompatDelegate.MODE_NIGHT_YES
        }
        AppCompatDelegate.setDefaultNightMode(nightMode)
    }

    private fun openRegistrationDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
        }
        val emailInput = EditText(this).apply {
            hint = getString(R.string.registration_email_hint)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val nameInput = EditText(this).apply { hint = getString(R.string.registration_full_name_hint) }
        val passwordInput = EditText(this).apply {
            hint = getString(R.string.registration_password_hint)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val plotsLabel = TextView(this).apply {
            text = getString(R.string.registration_plots_empty)
            setPadding(0, 24, 0, 16)
        }
        val selectedPlots = mutableSetOf<String>()
        val choosePlotsButton = Button(this).apply {
            text = getString(R.string.registration_choose_plots)
            setOnClickListener {
                openPlotsDialog(selectedPlots) { plots ->
                    plotsLabel.text = if (plots.isEmpty()) {
                        getString(R.string.registration_plots_empty)
                    } else {
                        getString(R.string.registration_plots_selected, plots.joinToString(", "))
                    }
                }
            }
        }

        container.addView(emailInput)
        container.addView(nameInput)
        container.addView(passwordInput)
        container.addView(plotsLabel)
        container.addView(choosePlotsButton)

        AlertDialog.Builder(this)
            .setTitle(R.string.open_registration_button)
            .setView(container)
            .setPositiveButton(R.string.registration_submit) { _, _ ->
                submitRegistration(
                    login = emailInput.text.toString(),
                    fullName = nameInput.text.toString(),
                    password = passwordInput.text.toString(),
                    plots = selectedPlots.toList()
                )
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun openPlotsDialog(selectedPlots: MutableSet<String>, onChanged: (Set<String>) -> Unit) {
        val options = PLOT_OPTIONS
        val checked = options.map { selectedPlots.contains(it) }.toBooleanArray()
        AlertDialog.Builder(this)
            .setTitle(R.string.registration_choose_plots)
            .setMultiChoiceItems(options, checked) { _, which, isChecked ->
                if (isChecked) {
                    selectedPlots.add(options[which])
                } else {
                    selectedPlots.remove(options[which])
                }
            }
            .setPositiveButton(android.R.string.ok) { _, _ -> onChanged(selectedPlots) }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun submitRegistration(login: String, fullName: String, password: String, plots: List<String>) {
        if (login.isBlank() || fullName.isBlank() || password.isBlank() || plots.isEmpty()) {
            toast(getString(R.string.registration_form_invalid))
            return
        }
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(login.trim()).matches()) {
            toast("Введите корректную почту")
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.submitRegistrationRequest(
                        login = login.trim(),
                        password = password,
                        fullName = fullName.trim(),
                        phone = "",
                        plots = plots
                    )
                }
                showRegistrationPendingDialog()
            } catch (error: Exception) {
                toast(getString(R.string.registration_request_send_failed, humanReadableRegistrationError(error)))
            }
        }
    }

    private fun showRegistrationFormDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_registration, null)
        val emailLayout = dialogView.findViewById<TextInputLayout>(R.id.tilRegistrationEmail)
        val displayNameLayout = dialogView.findViewById<TextInputLayout>(R.id.tilRegistrationDisplayName)
        val phoneLayout = dialogView.findViewById<TextInputLayout>(R.id.tilRegistrationPhone)
        val passwordLayout = dialogView.findViewById<TextInputLayout>(R.id.tilRegistrationPassword)
        val emailInput = dialogView.findViewById<EditText>(R.id.etRegistrationEmail)
        val displayNameInput = dialogView.findViewById<EditText>(R.id.etRegistrationDisplayName)
        val phoneInput = dialogView.findViewById<EditText>(R.id.etRegistrationPhone)
        val passwordInput = dialogView.findViewById<EditText>(R.id.etRegistrationPassword)
        val plotsLabel = dialogView.findViewById<TextView>(R.id.tvRegistrationPlots)
        val choosePlotsButton = dialogView.findViewById<Button>(R.id.btnRegistrationPlots)
        val selectedPlots = mutableSetOf<String>()

        choosePlotsButton.setOnClickListener {
            openPlotsDialog(selectedPlots) { plots ->
                plotsLabel.text = if (plots.isEmpty()) {
                    getString(R.string.registration_plots_empty)
                } else {
                    getString(R.string.registration_plots_selected, plots.joinToString(", "))
                }
            }
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.open_registration_button)
            .setView(dialogView)
            .setPositiveButton(R.string.registration_submit, null)
            .setNegativeButton(R.string.dialog_cancel, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                emailLayout.error = null
                displayNameLayout.error = null
                phoneLayout.error = null
                passwordLayout.error = null

                val email = emailInput.text.toString().trim()
                val displayName = displayNameInput.text.toString().trim()
                val phone = phoneInput.text.toString().trim()
                val password = passwordInput.text.toString()

                var valid = true
                if (email.isBlank()) {
                    emailLayout.error = getString(R.string.validation_email_required)
                    valid = false
                } else if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                    emailLayout.error = getString(R.string.validation_email_invalid)
                    valid = false
                }
                if (displayName.length < 2) {
                    displayNameLayout.error = getString(R.string.validation_display_name_invalid)
                    valid = false
                }
                if (!isValidPhone(phone)) {
                    phoneLayout.error = getString(R.string.validation_phone_invalid)
                    valid = false
                }
                if (password.length < 6) {
                    passwordLayout.error = getString(R.string.validation_password_short)
                    valid = false
                }
                if (selectedPlots.isEmpty()) {
                    toast(getString(R.string.validation_plots_required))
                    valid = false
                }
                if (!valid) return@setOnClickListener

                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            repository.submitRegistrationRequest(
                                login = email,
                                password = password,
                                fullName = displayName,
                                phone = phone,
                                plots = selectedPlots.toList()
                            )
                        }
                        dialog.dismiss()
                        showRegistrationPendingDialog()
                    } catch (error: Exception) {
                        toast(getString(R.string.registration_request_send_failed, humanReadableRegistrationError(error)))
                    }
                }
            }
        }
        dialog.show()
    }

    private fun isValidPhone(phone: String): Boolean {
        val digits = phone.filter { it.isDigit() }
        return digits.length in 10..15
    }

    private fun humanReadableRegistrationError(error: Throwable): String {
        return when (error) {
            is FirebaseAuthUserCollisionException -> "такая почта уже зарегистрирована"
            is FirebaseAuthWeakPasswordException -> "пароль слишком короткий или слишком простой"
            is FirebaseAuthInvalidCredentialsException -> "некорректная почта"
            is IllegalArgumentException -> error.message ?: getString(R.string.generic_error)
            else -> error.localizedMessage ?: getString(R.string.generic_error)
        }
    }

    private fun handlePendingRegistrationAfterLogin() {
        lifecycleScope.launch {
            val request = withContext(Dispatchers.IO) { repository.getRegistrationRequestForCurrentUser() }
            repository.logout()
            when (request?.status) {
                RegistrationRequestStatus.PENDING -> showRegistrationPendingDialog()
                RegistrationRequestStatus.REJECTED -> {
                    val reason = request.reviewReason.ifBlank { getString(R.string.registration_request_reason_empty) }
                    showRegistrationRejectedDialog(reason)
                }
                RegistrationRequestStatus.APPROVED -> toast(getString(R.string.account_profile_missing))
                null -> toast(getString(R.string.profile_not_found))
            }
        }
    }

    private fun showRegistrationPendingDialog() {
        AlertDialog.Builder(this)
            .setTitle("Заявка отправлена")
            .setMessage("Ваша заявка успешно отправлена администратору или модератору. Пока она не будет одобрена, вход в приложение недоступен.")
            .setPositiveButton("Понятно", null)
            .show()
    }

    private fun showRegistrationRejectedDialog(reason: String) {
        AlertDialog.Builder(this)
            .setTitle("Заявка отклонена")
            .setMessage("Заявка не была одобрена.\n\nПричина: $reason")
            .setPositiveButton("Понятно", null)
            .show()
    }

    private fun approveRegistrationRequest(request: RegistrationRequest) {
        val reviewer = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.approveRegistrationRequest(request.id, reviewer)
                    runCatching {
                        publishTargetedPush(
                            userIds = listOf(request.id),
                            title = getString(R.string.push_registration_approved_title),
                            body = getString(R.string.push_registration_approved_body),
                            destination = "events",
                            category = "registration"
                        )
                    }
                }
                toast(getString(R.string.registration_request_approved_toast))
            } catch (_: Exception) {
                toast(getString(R.string.registration_request_approve_failed))
            }
        }
    }

    private fun promptRejectRegistrationRequest(request: RegistrationRequest) {
        val input = EditText(this).apply {
            hint = getString(R.string.registration_request_reason_hint)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.registration_request_reject_dialog_title)
            .setView(input)
            .setPositiveButton(R.string.registration_request_reject) { _, _ ->
                rejectRegistrationRequest(request, input.text.toString())
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun rejectRegistrationRequest(request: RegistrationRequest, reason: String) {
        val reviewer = currentUser ?: return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    repository.rejectRegistrationRequest(request.id, reviewer, reason)
                    runCatching {
                        publishTargetedPush(
                            userIds = listOf(request.id),
                            title = getString(R.string.push_registration_rejected_title),
                            body = getString(
                                R.string.push_registration_rejected_body,
                                reason.ifBlank { getString(R.string.registration_request_reason_empty) }
                            ),
                            destination = "events",
                            category = "registration"
                        )
                    }
                }
                toast(getString(R.string.registration_request_rejected_toast))
            } catch (_: Exception) {
                toast(getString(R.string.registration_request_reject_failed))
            }
        }
    }

    private fun currentPlotCount(): Int {
        return currentUser?.plots?.size?.takeIf { it > 0 } ?: 1
    }

    private fun canReviewPayments(user: RemoteUser? = currentUser): Boolean {
        return user?.role == Role.ADMIN || user?.role == Role.MODERATOR
    }

    private fun captureNotificationDestination(sourceIntent: Intent?) {
        pendingNotificationDestination = sourceIntent?.getStringExtra(EventNotificationHelper.EXTRA_DESTINATION)
            ?.takeIf { it.isNotBlank() }
    }

    private fun applyPendingNotificationDestination() {
        val destination = pendingNotificationDestination ?: return
        if (dashboardContainer.visibility != View.VISIBLE) return
        when (destination) {
            "chat" -> tabLayout.getTabAt(1)?.select()
            "polls" -> tabLayout.getTabAt(3)?.select()
            else -> tabLayout.getTabAt(0)?.select()
        }
        pendingNotificationDestination = null
    }

    private suspend fun registerDeviceForPush() {
        if (!pushBackendClient.isConfigured()) return
        val userId = currentUser?.id ?: return
        repeat(3) { attempt ->
            val idToken = currentFirebaseIdToken() ?: return
            val fcmToken = FirebaseMessaging.getInstance().token.awaitResult()
            runCatching {
                pushBackendClient.registerDeviceToken(idToken, fcmToken)
                pushBackendClient.getRegisteredDeviceCount(idToken)
            }.onSuccess { registeredCount ->
                val confirmed = registeredCount > 0
                eventStateStore.setPushRegistrationConfirmed(userId, confirmed)
                if (confirmed) {
                    return
                }
                if (attempt < 2) {
                    kotlinx.coroutines.delay(1200)
                }
            }.onFailure {
                eventStateStore.setPushRegistrationConfirmed(userId, false)
                if (attempt < 2) {
                    kotlinx.coroutines.delay(1200)
                }
            }
        }
    }

    private suspend fun currentFirebaseIdToken(): String? {
        val firebaseUser = repository.currentAuthUser() ?: return null
        return firebaseUser.getIdToken(true).awaitResult().token
    }

    private suspend fun publishBroadcastPush(
        title: String,
        body: String,
        destination: String,
        category: String = destination,
        excludedUserIds: List<String> = emptyList()
    ) {
        if (!pushBackendClient.isConfigured()) return
        val idToken = currentFirebaseIdToken() ?: return
        pushBackendClient.publishBroadcast(idToken, title, body, destination, category, excludedUserIds)
    }

    private suspend fun publishTargetedPush(
        userIds: List<String>,
        title: String,
        body: String,
        destination: String,
        category: String = destination
    ) {
        if (!pushBackendClient.isConfigured() || userIds.isEmpty()) return
        val idToken = currentFirebaseIdToken() ?: return
        pushBackendClient.publishToUsers(idToken, userIds, title, body, destination, category)
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationsPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private suspend fun <T> com.google.android.gms.tasks.Task<T>.awaitResult(): T =
        suspendCoroutine { continuation ->
            addOnSuccessListener { continuation.resume(it) }
            addOnFailureListener { continuation.resumeWithException(it) }
        }

    companion object {
        private const val CHAT_PAGE_SIZE = 30
        private const val EVENTS_PAGE_SIZE = 20
        private val EVENT_TEMPLATES = listOf(
            EventTemplate(
                name = "Покос травы",
                title = "Покос травы",
                message = "Проводится оплата за покос травы на территории поселка. Работы необходимы для поддержания порядка на общей территории.",
                type = EventType.EXPENSE
            ),
            EventTemplate(
                name = "Электричество",
                title = "Оплата за электричество",
                message = "Из общей кассы проводится оплата за электричество по поселку. Средства списываются на покрытие текущих расходов.",
                type = EventType.EXPENSE
            ),
            EventTemplate(
                name = "Вывоз мусора",
                title = "Оплата за вывоз мусора",
                message = "Из общей кассы проводится оплата за вывоз мусора. Это обязательный расход для поддержания чистоты в поселке.",
                type = EventType.EXPENSE
            ),
            EventTemplate(
                name = "Сбор на дороги",
                title = "Сбор средств на дороги",
                message = "Проводится сбор средств на ремонт и подсыпку дорог в поселке. Просьба внести оплату в установленный срок.",
                type = EventType.CHARGE
            ),
            EventTemplate(
                name = "Сбор на покос",
                title = "Сбор средств на покос травы",
                message = "Проводится сбор средств на покос травы и обслуживание общей территории. Просьба внести платеж в ближайшее время.",
                type = EventType.CHARGE
            ),
            EventTemplate(
                name = "Сбор на электричество",
                title = "Сбор средств на электричество",
                message = "Проводится сбор средств на оплату электричества по поселку. Сумма начисляется согласно количеству участков.",
                type = EventType.CHARGE
            ),
            EventTemplate(
                name = "Собрание",
                title = "Скоро собрание",
                message = "Просьба всем собственникам принять участие в общем собрании в назначенное время. Обсудим текущие вопросы поселка и ближайшие расходы.",
                type = EventType.INFO
            )
        )
        private val PLOT_OPTIONS = Array(35) { index -> "Участок ${index + 1}" }
    }
}
