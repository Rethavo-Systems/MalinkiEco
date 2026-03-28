package com.example.malinkieco.data

data class AppGateConfig(
    val minSupportedVersionCode: Long = 1L,
    val latestVersionName: String = "",
    val updateUrl: String = "",
    val rustoreUrl: String = "",
    val githubReleaseUrl: String = "",
    val githubRepoUrl: String = "",
    val updateTitle: String = "",
    val updateMessage: String = ""
)
