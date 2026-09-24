plugins {
    id("com.android.application") version "9.4.1" apply false
}

// Si le projet est dans un dossier OneDrive, les fichiers de compilation (des milliers de fichiers
// temporaires) sont placés hors de la synchronisation, dans %LOCALAPPDATA%\Sohri\build.
val localAppData: String? = System.getenv("LOCALAPPDATA")
if (localAppData != null && rootDir.absolutePath.contains("OneDrive", ignoreCase = true)) {
    allprojects {
        layout.buildDirectory.set(File(localAppData, "Sohri/build/${project.name}"))
    }
}
