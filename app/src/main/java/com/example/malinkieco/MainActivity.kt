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
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.RadioButton
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
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
import com.example.malinkieco.data.RegistrationRequest
import com.example.malinkieco.data.RegistrationRequestStatus
import com.example.malinkieco.data.RemoteUser
import com.example.malinkieco.data.Role
import com.example.malinkieco.notifications.EventReminderScheduler
import com.example.malinkieco.notifications.EventStateStore
import com.example.malinkieco.ui.ChatAdapter
import com.example.malinkieco.ui.EventAdapter
import com.example.malinkieco.ui.PaymentRequestAdapter
import com.example.malinkieco.ui.PollAdapter
import com.example.malinkieco.ui.RegistrationRequestAdapter
import com.example.malinkieco.ui.UserListAdapter
import com.google.android.material.tabs.TabLayout
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputLayout
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    private lateinit var pollsContainer: View
    private lateinit var residentsContainer: View
    private lateinit var chatContainer: LinearLayout
    private lateinit var etLoginEmail: EditText
    private lateinit var etLoginPassword: EditText
    private lateinit var btnLogin: Button
    private lateinit var btnOpenRegistration: Button
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
    private lateinit var btnTogglePaymentRequests: Button
    private lateinit var paymentRequestsHeader: View
    private lateinit var adminControls: View
    private lateinit var btnToggleAdminPanel: Button
    private lateinit var adminFormContainer: View
    private lateinit var etNewPlot: EditText
    private lateinit var etNewFullName: EditText
    private lateinit var etNewEmail: EditText
    private lateinit var etNewPassword: EditText
    private lateinit var btnAddUser: Button
    private lateinit var eventControls: View
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
    private lateinit var btnCreateEvent: Button
    private lateinit var userPayControls: View
    private lateinit var etPayAmount: EditText
    private lateinit var etPayPurpose: EditText
    private lateinit var btnPay: Button
    private lateinit var btnSelectChargeEvent: Button
    private lateinit var paymentConfigCard: View
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
    private lateinit var rvChat: RecyclerView
    private lateinit var rvPaymentRequests: RecyclerView
    private lateinit var rvRegistrationRequests: RecyclerView
    private lateinit var chatLayoutManager: LinearLayoutManager
    private lateinit var tabLayout: TabLayout
    private lateinit var etChatMessage: EditText
    private lateinit var btnSendMessage: Button
    private lateinit var tvEventsEmpty: TextView
    private lateinit var tvPollsEmpty: TextView
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
    private lateinit var userAdapter: UserListAdapter
    private lateinit var chatAdapter: ChatAdapter
    private lateinit var eventAdapter: EventAdapter
    private lateinit var pollAdapter: PollAdapter
    private lateinit var paymentRequestAdapter: PaymentRequestAdapter
    private lateinit var registrationRequestAdapter: RegistrationRequestAdapter

    private var currentUser: RemoteUser? = null
    private var currentPaymentConfig = PaymentTransferConfig()
    private var allUsers = emptyList<RemoteUser>()
    private var selectedChargeEvent: ChargeSuggestion? = null
    private var availableChargeEvents = emptyList<ChargeSuggestion>()
    private var latestEvents = emptyList<CommunityEvent>()
    private var latestPolls = emptyList<CommunityEvent>()
    private var usersListener: ListenerRegistration? = null
    private var chatListener: ListenerRegistration? = null
    private var eventsListener: ListenerRegistration? = null
    private var paymentRequestsListener: ListenerRegistration? = null
    private var paymentConfigListener: ListenerRegistration? = null
    private var registrationRequestsListener: ListenerRegistration? = null
    private var communityFundsListener: ListenerRegistration? = null
    private var isAdminPanelExpanded = false
    private var isPaymentRequestsExpanded = false
    private var isRegistrationRequestsExpanded = false
    private var pendingPaymentRequestsCount = 0
    private var pendingRegistrationRequestsCount = 0
    private var currentEventsLimit = EVENTS_PAGE_SIZE

    private val latestMessages = mutableListOf<ChatMessage>()
    private val olderMessages = mutableListOf<ChatMessage>()
    private var isLoadingOlderMessages = false
    private var hasMoreOlderMessages = true
    private var lastSeenEventTimestamp = 0L
    private var eventsInitialized = false
    private var hasInitializedSession = false
    private var currentGateConfig: AppGateConfig? = null

    private val notificationsPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        checkStartupRequirements()
    }

    override fun onResume() {
        super.onResume()
        checkStartupRequirements()
    }

    override fun onDestroy() {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        registrationRequestsListener?.remove()
        communityFundsListener?.remove()
        super.onDestroy()
    }

    private fun bindViews() {
        loginContainer = findViewById(R.id.loginContainer)
        dashboardContainer = findViewById(R.id.dashboardContainer)
        eventsContainer = findViewById(R.id.eventsScrollContainer)
        pollsContainer = findViewById(R.id.pollsScrollContainer)
        residentsContainer = findViewById(R.id.residentsScrollContainer)
        chatContainer = findViewById(R.id.chatContainer)
        etLoginEmail = findViewById(R.id.etLoginEmail)
        etLoginPassword = findViewById(R.id.etLoginPassword)
        btnLogin = findViewById(R.id.btnLogin)
        btnOpenRegistration = findViewById(R.id.btnOpenRegistration)
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
        btnTogglePaymentRequests = findViewById(R.id.btnTogglePaymentRequests)
        paymentRequestsHeader = findViewById(R.id.paymentRequestsHeader)
        adminControls = findViewById(R.id.adminControls)
        btnToggleAdminPanel = findViewById(R.id.btnToggleAdminPanel)
        adminFormContainer = findViewById(R.id.adminFormContainer)
        etNewPlot = findViewById(R.id.etNewPlot)
        etNewFullName = findViewById(R.id.etNewFullName)
        etNewEmail = findViewById(R.id.etNewEmail)
        etNewPassword = findViewById(R.id.etNewPassword)
        btnAddUser = findViewById(R.id.btnAddUser)
        eventControls = findViewById(R.id.eventControls)
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
        btnCreateEvent = findViewById(R.id.btnCreateEvent)
        userPayControls = findViewById(R.id.userPayControls)
        etPayAmount = findViewById(R.id.etPayAmount)
        etPayPurpose = findViewById(R.id.etPayPurpose)
        btnPay = findViewById(R.id.btnPay)
        btnSelectChargeEvent = findViewById(R.id.btnSelectChargeEvent)
        paymentConfigCard = findViewById(R.id.paymentConfigCard)
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
        rvUsers = findViewById(R.id.rvUsers)
        rvChat = findViewById(R.id.rvChat)
        rvPaymentRequests = findViewById(R.id.rvPaymentRequests)
        rvRegistrationRequests = findViewById(R.id.rvRegistrationRequests)
        tabLayout = findViewById(R.id.tabLayout)
        etChatMessage = findViewById(R.id.etChatMessage)
        btnSendMessage = findViewById(R.id.btnSendMessage)
        tvEventsEmpty = findViewById(R.id.tvEventsEmpty)
        tvPollsEmpty = findViewById(R.id.tvPollsEmpty)
        tvResidentsEmpty = findViewById(R.id.tvResidentsEmpty)
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
            canModerateProvider = { currentUser?.role == Role.ADMIN || currentUser?.role == Role.MODERATOR },
            onVote = { event, option -> voteInPoll(event, option) },
            onClosePoll = { event -> promptCloseCharge(event) }
        )
        rvPolls.layoutManager = LinearLayoutManager(this)
        rvPolls.adapter = pollAdapter

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
            onEditMessage = { message -> promptEditMessage(message) },
            onDeleteMessage = { message -> confirmDeleteMessage(message) }
        )
        chatLayoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        rvChat.layoutManager = chatLayoutManager
        rvChat.adapter = chatAdapter
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
        tabLayout.addTab(tabLayout.newTab().setText(R.string.events_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.polls_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.residents_tab))
        tabLayout.addTab(tabLayout.newTab().setText(R.string.chat_tab))
        showEventsTab()
        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> showEventsTab()
                    1 -> showPollsTab()
                    2 -> showResidentsTab()
                    else -> showChatTab()
                }
            }

            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })
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

    private fun updatePollsTabBadge(count: Int) {
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

    private fun setupListeners() {
        btnLogin.setOnClickListener { doLogin() }
        btnOpenRegistration.setOnClickListener { openRegistrationDialog() }
        btnLogout.setOnClickListener { doLogout() }
        btnAddUser.setOnClickListener { addUser() }
        btnCreateEvent.setOnClickListener { createEvent() }
        btnPay.setOnClickListener { createManualPaymentRequest() }
        btnSelectChargeEvent.setOnClickListener { chooseChargeEvent() }
        btnSendMessage.setOnClickListener { sendMessage() }
        btnToggleAdminPanel.setOnClickListener { toggleAdminPanel() }
        btnTogglePaymentRequests.setOnClickListener { togglePaymentRequestsPanel() }
        btnToggleRegistrationRequests.setOnClickListener { toggleRegistrationRequestsPanel() }
        btnMarkEventsRead.setOnClickListener { markEventsAsRead() }
        btnLoadMoreEvents.setOnClickListener {
            currentEventsLimit += EVENTS_PAGE_SIZE
            currentUser?.let { attachRealtimeListeners(it) }
        }
        btnGatePrimary.setOnClickListener { onGatePrimaryAction() }
        btnGateSecondary.setOnClickListener { finishAffinity() }
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
                        primaryText = getString(R.string.gate_update_button),
                        showSecondary = false
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
                    showSecondary = true
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
        primaryEnabled: Boolean = true
    ) {
        appGateContainer.visibility = View.VISIBLE
        tvGateTitle.text = title
        tvGateMessage.text = message
        btnGatePrimary.text = primaryText
        btnGatePrimary.isEnabled = primaryEnabled
        btnGateSecondary.visibility = if (showSecondary) View.VISIBLE else View.GONE
    }

    private fun hideGate() {
        appGateContainer.visibility = View.GONE
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
        if (email.isBlank() || password.isBlank()) {
            toast(getString(R.string.login_empty_fields))
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

        val isAdmin = user.role == Role.ADMIN
        val isModerator = user.role == Role.MODERATOR
        val canCreateEvents = user.role == Role.ADMIN || user.role == Role.MODERATOR
        val canManageUsers = isAdmin || isModerator

        tvHeaderTitle.text = getString(R.string.app_name)
        tvHeaderSubtitle.text = when (user.role) {
            Role.ADMIN -> getString(R.string.admin_dashboard_title)
            Role.MODERATOR -> getString(R.string.moderator_dashboard_title)
            Role.USER -> getString(R.string.user_dashboard_title)
        }
        tvWelcome.text = user.fullName
        tvWelcomeDetails.text = getString(R.string.your_plot, user.plotName)
        bindBalanceHero(user.balance)
        adminControls.visibility = View.GONE
        eventControls.visibility = if (canCreateEvents) View.VISIBLE else View.GONE
        userPayControls.visibility = if (user.role == Role.USER || user.role == Role.MODERATOR) View.VISIBLE else View.GONE
        paymentConfigCard.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        btnEditCommunityFunds.visibility = if (isAdmin) View.VISIBLE else View.GONE
        paymentRequestsHeader.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        registrationRequestsHeader.visibility = if (canReviewPayments(user)) View.VISIBLE else View.GONE
        registrationRequestsPanel.visibility = View.GONE
        tvRegistrationRequestsEmpty.visibility = View.GONE
        adminFormContainer.visibility = View.GONE
        unreadEventsBanner.visibility = View.GONE
        isAdminPanelExpanded = false
        isPaymentRequestsExpanded = false
        isRegistrationRequestsExpanded = false
        btnToggleAdminPanel.text = getString(R.string.admin_tools_open)
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

    private fun resetUiState() {
        latestMessages.clear()
        olderMessages.clear()
        hasMoreOlderMessages = true
        isLoadingOlderMessages = false
        selectedChargeEvent = null
        availableChargeEvents = emptyList()
        latestEvents = emptyList()
        latestPolls = emptyList()
        updateEventsTabBadge(0)
        updatePollsTabBadge(0)
        chatAdapter.submitList(emptyList())
        eventAdapter.submitList(emptyList())
        pollAdapter.submitList(emptyList())
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
    }

    private fun attachRealtimeListeners(user: RemoteUser) {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        registrationRequestsListener?.remove()
        communityFundsListener?.remove()

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
                    if (chatContainer.visibility == View.VISIBLE) {
                        markChatRead()
                    }
                }
            },
            onError = { runOnUiThread { toast(getString(R.string.chat_load_failed)) } }
        )
    }

    private fun updateChatList(scrollToBottom: Boolean = false) {
        val merged = (olderMessages + latestMessages)
            .distinctBy { it.id }
            .sortedBy { it.createdAtClient }

        chatAdapter.submitList(merged) {
            rvChat.visibility = if (merged.isEmpty()) View.GONE else View.VISIBLE
            tvChatEmpty.visibility = if (merged.isEmpty()) View.VISIBLE else View.GONE
            if (scrollToBottom && merged.isNotEmpty()) {
                rvChat.scrollToPosition(merged.lastIndex)
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

        if (plot.isBlank() || fullName.isBlank() || email.isBlank() || password.isBlank()) {
            toast(getString(R.string.user_form_empty))
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
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.setUserRole(user.id, role) }
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
            rbEventPoll.isChecked -> EventType.POLL
            else -> EventType.INFO
        }
        val amount = etEventAmount.text.toString().toIntOrNull() ?: 0
        val pollOptions = etPollOptions.text.toString()
            .lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()

        if (title.isBlank()) {
            toast(getString(R.string.event_title_required))
            return
        }
        if ((type == EventType.CHARGE || type == EventType.EXPENSE) && amount <= 0) {
            toast(getString(R.string.event_amount_required))
            return
        }
        if (type == EventType.POLL && pollOptions.size < 2) {
            toast(getString(R.string.poll_options_required))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.createEvent(creator, title, message, type, amount, pollOptions) }
                etEventTitle.text.clear()
                etEventMessage.text.clear()
                etEventAmount.text.clear()
                etPollOptions.text.clear()
                rbEventInfo.isChecked = true
                toast(getString(R.string.event_created))
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
                        event = selectedChargeEvent,
                        purpose = purpose
                    )
                }
                etPayAmount.text.clear()
                etPayPurpose.text.clear()
                selectedChargeEvent = null
                btnSelectChargeEvent.text = getString(R.string.payment_select_event)
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
                withContext(Dispatchers.IO) { repository.confirmPaymentRequest(request.id, reviewer) }
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
                withContext(Dispatchers.IO) { repository.rejectPaymentRequest(request.id, reviewer, reason) }
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
                    updateUserBalance(user.id, newBalance)
                }
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun updateUserBalance(userId: String, newBalance: Int) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.setUserBalance(userId, newBalance) }
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
                            withContext(Dispatchers.IO) { repository.setCommunityFunds(amount) }
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
                        withContext(Dispatchers.IO) { repository.closeEvent(event.id, reviewer) }
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
        if (user.id == currentUser?.id) {
            toast(getString(R.string.delete_self_forbidden))
            return
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.deleteUser(user.id) }
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
                withContext(Dispatchers.IO) { repository.sendChatMessage(user, text) }
                etChatMessage.text.clear()
            } catch (_: Exception) {
                toast(getString(R.string.chat_send_failed))
            }
        }
    }

    private fun doLogout() {
        usersListener?.remove()
        chatListener?.remove()
        eventsListener?.remove()
        paymentRequestsListener?.remove()
        paymentConfigListener?.remove()
        EventReminderScheduler.cancel(applicationContext)
        repository.logout()
        currentUser = null
        currentPaymentConfig = PaymentTransferConfig()
        resetUiState()
        loginContainer.visibility = View.VISIBLE
        dashboardContainer.visibility = View.GONE
        etLoginPassword.text.clear()
    }

    private fun showEventsTab() {
        eventsContainer.visibility = View.VISIBLE
        pollsContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        chatContainer.visibility = View.GONE
    }

    private fun showPollsTab() {
        eventsContainer.visibility = View.GONE
        pollsContainer.visibility = View.VISIBLE
        residentsContainer.visibility = View.GONE
        chatContainer.visibility = View.GONE
        markPollsAsRead()
    }

    private fun showResidentsTab() {
        eventsContainer.visibility = View.GONE
        pollsContainer.visibility = View.GONE
        residentsContainer.visibility = View.VISIBLE
        chatContainer.visibility = View.GONE
    }

    private fun showChatTab() {
        eventsContainer.visibility = View.GONE
        pollsContainer.visibility = View.GONE
        residentsContainer.visibility = View.GONE
        chatContainer.visibility = View.VISIBLE
        markChatRead()
    }

    private fun toggleAdminPanel(forceCollapse: Boolean = false) {
        isAdminPanelExpanded = if (forceCollapse) false else !isAdminPanelExpanded
        adminFormContainer.visibility = if (isAdminPanelExpanded) View.VISIBLE else View.GONE
        btnToggleAdminPanel.text = if (isAdminPanelExpanded) getString(R.string.admin_tools_close) else getString(R.string.admin_tools_open)
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
        return EVENT_TEMPLATES.filter { it.type == type }
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

        val labels = availableChargeEvents.map { event ->
            getString(R.string.payment_select_event_item, event.title, event.amount)
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle(R.string.payment_select_event_dialog_title)
            .setItems(labels) { _, which ->
                val selected = availableChargeEvents[which]
                selectedChargeEvent = selected
                etPayAmount.setText((selected.amount * currentPlotCount()).toString())
                etPayPurpose.setText(selected.title)
                btnSelectChargeEvent.text = getString(R.string.payment_selected_event, selected.title)
            }
            .setNegativeButton(R.string.payment_select_event_reset) { _, _ ->
                selectedChargeEvent = null
                etPayPurpose.text.clear()
                btnSelectChargeEvent.text = getString(R.string.payment_select_event)
            }
            .show()
    }

    private fun promptEditMessage(message: ChatMessage) {
        val input = EditText(this).apply {
            setText(message.text)
            setSelection(text?.length ?: 0)
            hint = getString(R.string.chat_hint)
            minLines = 2
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.chat_edit_dialog_title)
            .setView(input)
            .setPositiveButton(R.string.chat_action_edit) { _, _ ->
                saveEditedMessage(message, input.text.toString())
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
        AlertDialog.Builder(this)
            .setTitle(R.string.chat_delete_dialog_title)
            .setMessage(R.string.chat_delete_dialog_message)
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
                toast(getString(R.string.chat_delete_success))
            } catch (_: Exception) {
                toast(getString(R.string.chat_delete_failed))
            }
        }
    }

    private fun markChatRead() {
        val user = currentUser ?: return
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { repository.markChatRead(user.id) }
            }
        }
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
                        plots = plots
                    )
                }
                showRegistrationPendingDialog()
            } catch (error: Exception) {
                toast(getString(R.string.registration_request_send_failed, humanReadableRegistrationError(error)))
            }
        }
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
                withContext(Dispatchers.IO) { repository.approveRegistrationRequest(request.id, reviewer) }
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
                withContext(Dispatchers.IO) { repository.rejectRegistrationRequest(request.id, reviewer, reason) }
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
