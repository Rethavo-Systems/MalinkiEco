package com.example.malinkieco.data

data class AppGateConfig(
    val minSupportedVersionCode: Long = 1L,
    val latestVersionName: String = "",
    val updateUrl: String = "",
    val updateTitle: String = "",
    val updateMessage: String = ""
)
