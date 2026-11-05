#requires -Version 5.1
<#
  Release preflight (E8). Read-only: checks APK, signature, device version,
  keystore backups. It does NOT uninstall or install anything.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-preflight.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-preflight.ps1 -Apk D:\path\app-release.apk

  Exit 0 = ready for a human-confirmed install step; 1 = preflight failed.
#>
param(
  [string]$Package = 'cool.cnb.dshpalm',
  [string]$Apk = 'app/android/app/build/outputs/apk/release/app-release.apk',
  [string]$Metadata = 'app/android/app/build/outputs/apk/release/output-metadata.json'
)

$ErrorActionPreference = 'Stop'
$fail = 0
function Ok($m) { Write-Host "PASS  $m" }
function Warn($m) { Write-Host "WARN  $m" }
function Bad($m) { Write-Host "FAIL  $m"; $script:fail = 1 }

if (-not (Test-Path $Apk)) { Bad "APK not found: $Apk"; exit 1 }
$apkItem = Get-Item $Apk
Ok ("APK {0} ({1:N1} MB)" -f $apkItem.FullName, ($apkItem.Length / 1MB))
Write-Host ("      sha256 {0}" -f (Get-FileHash $Apk -Algorithm SHA256).Hash)

if (Test-Path $Metadata) {
  $meta = Get-Content $Metadata -Raw | ConvertFrom-Json
  $el = $meta.elements | Select-Object -First 1
  Ok ("metadata versionName={0} versionCode={1} applicationId={2}" -f $el.versionName, $el.versionCode, $meta.applicationId)
  if ($meta.applicationId -ne $Package) { Bad "applicationId mismatch: $($meta.applicationId) != $Package" }
} else {
  Warn "output-metadata.json missing, skip version check"
}

$apksigner = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if ($apksigner) {
  $certs = & $apksigner.FullName verify --print-certs $Apk 2>&1
  $line = $certs | Select-String 'SHA-256 digest' | Select-Object -First 1
  $sha256 = ($line -replace '.*SHA-256 digest:\s*', '').Trim()
  Ok ("APK signature SHA-256 {0}" -f $sha256)
} else {
  Warn "apksigner not found, skip APK signature check"
}

$deviceLine = (adb devices | Select-String -Pattern '\sdevice$' | Select-Object -First 1)
if (-not $deviceLine) { Bad 'no adb device connected'; exit 1 }
Ok ("adb device: {0}" -f $deviceLine.ToString().Trim())

$dumpsys = adb shell dumpsys package $Package 2>$null
if ($LASTEXITCODE -ne 0 -or -not $dumpsys) {
  Ok "package $Package not installed (clean first install is possible)"
} else {
  $versionName = ($dumpsys | Select-String 'versionName=' | Select-Object -First 1) -replace '.*versionName=', ''
  $versionCode = ($dumpsys | Select-String 'versionCode=' | Select-Object -First 1) -replace '.*versionCode=', ''
  Ok ("device installed versionName={0} versionCode={1}" -f $versionName.Trim(), ($versionCode -split ' ')[0])
  $sig = $dumpsys | Select-String 'signatures=\[' | Select-Object -First 1
  if ($sig) { Write-Host ("      $($sig.ToString().Trim())") }
  Warn 'debug and release signatures differ; install -r will fail. Data migration: see docs/RELEASE.md'
}

$ksProps = 'app/android/keystore.properties'
if (Test-Path $ksProps) {
  Ok "keystore.properties present (gitignored)"
} else {
  Warn "$ksProps missing; release build will fail or fall back to debug signing"
}

$backups = @('D:\dsh-palm-backup\keystore-2026-11-05', "$env:USERPROFILE\Desktop\dsh-palm-keystore-backup-2026-11-05")
foreach ($dir in $backups) {
  if (Test-Path $dir) { Ok "keystore backup: $dir" } else { Warn "keystore backup missing: $dir" }
}

Write-Host ''
Write-Host 'After human confirmation:'
Write-Host '  A. Clean first install (recommended for release verification):'
Write-Host ("     adb uninstall {0}; adb install <apk>; verify first launch/account/light/files/settings." -f $Package)
Write-Host '  B. Keep data while switching debug -> release: only possible with the same signing key.'
Write-Host '     Current debug and release certs differ; see docs/RELEASE.md. Do not claim data survives'
Write-Host '     a plain uninstall + install.'
Write-Host ''
if ($fail -ne 0) { Write-Host 'Preflight FAILED'; exit 1 }
Write-Host 'Preflight OK: APK/device/signature/backups checked; waiting for human confirmation.'
exit 0
