<#
  Construit l'APK de SOHRI : dist\Sohri-<version>.apk, signé et prêt à installer.

    .\build-apk.ps1            construit l'APK
    .\build-apk.ps1 -Install   puis l'installe sur le téléphone branché en USB (débogage USB activé)

  Au premier lancement, crée la clé de signature dans android\keystore\ : à conserver, car sans
  elle une nouvelle version ne pourra pas s'installer par-dessus l'ancienne (voir README.md).
#>
param([switch]$Install)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$androidDir = Join-Path $root 'android'
$appGradle = Get-Content (Join-Path $androidDir 'app\build.gradle.kts') -Raw
$compileSdk = [regex]::Match($appGradle, 'compileSdk\s*=\s*(\d+)').Groups[1].Value
$buildTools = [regex]::Match($appGradle, 'buildToolsVersion\s*=\s*"([^"]+)"').Groups[1].Value
$versionName = [regex]::Match($appGradle, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value

function Write-Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# Les outils Java écrivent leurs messages sur stderr : on ne s'arrête que sur le code de sortie.
function Invoke-Native([string]$exe, [string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $exe @arguments } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "Échec de $(Split-Path $exe -Leaf) (code $LASTEXITCODE), voir les messages ci-dessus." }
}

# Les fichiers .properties sont lus en ISO-8859-1 : écriture en ASCII, caractères accentués échappés,
# et « : » échappé comme le fait Android Studio (C\:/...).
function ConvertTo-PropertyValue([string]$value) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($c in ($value -replace '\\', '/').ToCharArray()) {
        if ([int]$c -gt 126) { [void]$sb.AppendFormat('\u{0:x4}', [int]$c) }
        elseif ($c -eq ':') { [void]$sb.Append('\:') }
        else { [void]$sb.Append($c) }
    }
    $sb.ToString()
}
function Write-AsciiFile([string]$path, [string[]]$lines) {
    [System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), [System.Text.Encoding]::ASCII)
}

function Get-JdkMajor([string]$dir) {
    $release = Join-Path $dir 'release'
    if (-not (Test-Path (Join-Path $dir 'bin\keytool.exe')) -or -not (Test-Path $release)) { return 0 }
    $match = Select-String -Path $release -Pattern 'JAVA_VERSION="(\d+)' | Select-Object -First 1
    if ($match) { return [int]$match.Matches[0].Groups[1].Value }
    return 0
}

function Find-Jdk {
    $candidates = @($env:JAVA_HOME, "$env:ProgramFiles\Android\Android Studio\jbr")
    foreach ($pattern in @("$env:ProgramFiles\Android\openjdk\jdk-*", "$env:USERPROFILE\.jdks\*",
                           "$env:ProgramFiles\Eclipse Adoptium\jdk-*", "$env:ProgramFiles\Microsoft\jdk-*",
                           "$env:ProgramFiles\Java\jdk-*")) {
        $candidates += Get-ChildItem $pattern -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | ForEach-Object { $_.FullName }
    }
    foreach ($dir in $candidates) { if ($dir -and (Get-JdkMajor $dir) -ge 17) { return $dir } }
    return $null
}

function Find-AndroidSdk {
    $candidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk",
                    "${env:ProgramFiles(x86)}\Android\android-sdk")
    foreach ($dir in $candidates) {
        if ($dir -and (Test-Path (Join-Path $dir "platforms\android-$compileSdk\android.jar")) -and
                      (Test-Path (Join-Path $dir "build-tools\$buildTools"))) { return $dir }
    }
    return $null
}

Write-Step 'Recherche des outils'
$jdk = Find-Jdk
if (-not $jdk) { throw 'Aucun JDK 17 ou plus récent trouvé. Installe-le par exemple avec :  winget install Microsoft.OpenJDK.21' }
$sdk = Find-AndroidSdk
if (-not $sdk) {
    throw "SDK Android introuvable (il faut « platforms;android-$compileSdk » et « build-tools;$buildTools »). " +
          'Le plus simple : installer Android Studio, puis relancer ce script.'
}
Write-Host "JDK : $jdk"
Write-Host "SDK : $sdk"
Write-AsciiFile (Join-Path $androidDir 'local.properties') @("sdk.dir=$(ConvertTo-PropertyValue $sdk)")

$keystoreDir = Join-Path $androidDir 'keystore'
$keystoreFile = Join-Path $keystoreDir 'sohri-release.jks'
$keystoreProps = Join-Path $keystoreDir 'keystore.properties'
if (-not (Test-Path $keystoreProps)) {
    if (Test-Path $keystoreFile) { throw "$keystoreFile existe mais pas keystore.properties : récupère ce fichier (voir README.md)." }
    Write-Step 'Création de la clé de signature (une seule fois)'
    New-Item -ItemType Directory -Force $keystoreDir | Out-Null
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    Invoke-Native (Join-Path $jdk 'bin\keytool.exe') @(
        '-genkeypair', '-keystore', $keystoreFile, '-storetype', 'PKCS12', '-alias', 'sohri',
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=SOHRI',
        '-storepass', $password, '-keypass', $password)
    Write-AsciiFile $keystoreProps @(
        '# Cle de signature de SOHRI : a conserver avec sohri-release.jks (voir README.md)',
        'storeFile=sohri-release.jks',
        "storePassword=$password",
        'keyAlias=sohri',
        "keyPassword=$password")
    Write-Host "Clé créée : $keystoreFile"
}

Write-Step "Compilation de l'APK (la première fois, Gradle télécharge ses dépendances : quelques minutes)"
if ($sdk -like "$env:ProgramFiles*" -or $sdk -like "${env:ProgramFiles(x86)}*") {
    Write-Host 'SDK en lecture seule : les messages « Probably the SDK is read-only » sont sans conséquence.' -ForegroundColor DarkGray
}
$env:JAVA_HOME = $jdk
$gradleArgs = @('assembleRelease')
# Projet dans OneDrive : le cache Gradle du projet est placé hors synchronisation, comme les dossiers build.
if ($root -match 'OneDrive' -and $env:LOCALAPPDATA) {
    $gradleArgs += @('--project-cache-dir', (Join-Path $env:LOCALAPPDATA 'Sohri\gradle-project-cache'))
}
Push-Location $androidDir
try { Invoke-Native (Join-Path $androidDir 'gradlew.bat') $gradleArgs } finally { Pop-Location }

$apk = Join-Path $root "dist\Sohri-$versionName.apk"
if (-not (Test-Path $apk)) { throw "APK introuvable : $apk" }
Write-Step 'APK prêt'
Write-Host $apk -ForegroundColor Green
Write-Host ('{0:N1} Mo' -f ((Get-Item $apk).Length / 1MB))

if ($Install) {
    Write-Step 'Installation sur le téléphone (USB)'
    Invoke-Native (Join-Path $sdk 'platform-tools\adb.exe') @('install', '-r', $apk)
}
