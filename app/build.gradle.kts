plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    id("com.google.gms.google-services")
}

val paymentsBackendUrl = (project.findProperty("PAYMENTS_BACKEND_URL") as String?) ?: ""

android {
    namespace = "com.example.malinkieco"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = "com.example.malinkieco"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "v2.1b"
        buildConfigField("String", "PAYMENTS_BACKEND_URL", "\"$paymentsBackendUrl\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

android.applicationVariants.configureEach {
    if (buildType.name == "release") {
        outputs.configureEach {
            (this as com.android.build.gradle.internal.api.ApkVariantOutputImpl).outputFileName =
                "MalinkiEco-v2.1b.apk"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.work:work-runtime-ktx:2.10.3")
    implementation(platform("com.google.firebase:firebase-bom:34.4.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-messaging")
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
