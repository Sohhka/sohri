import java.util.Properties

plugins {
    id("com.android.application")
}

// Clé de signature, créée par build-apk.ps1 au premier build (voir README.md).
val keystoreDir = rootProject.file("keystore")
val keystoreProps = Properties().apply {
    val file = File(keystoreDir, "keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.sohri.app"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.sohri.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.3"
    }

    signingConfigs {
        if (!keystoreProps.isEmpty) {
            create("release") {
                storeFile = File(keystoreDir, keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // L'appli web (dossier www/ à la racine de Sohri) est embarquée telle quelle dans l'APK.
    sourceSets {
        getByName("main") {
            assets.directories.add("../../www")
        }
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.18.0")
    implementation("androidx.webkit:webkit:1.17.1")
}

// Après « assembleRelease », copie l'APK signé dans Sohri/dist/ sous un nom lisible.
val apkName = "Sohri-${android.defaultConfig.versionName}.apk"
val copyReleaseApk = tasks.register<Copy>("copyReleaseApk") {
    from(layout.buildDirectory.dir("outputs/apk/release")) {
        include("app-release.apk")
        rename { apkName }
    }
    into(rootProject.file("../dist"))
}
tasks.matching { it.name == "assembleRelease" }.configureEach { finalizedBy(copyReleaseApk) }
