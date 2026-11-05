param(
  [string]$StorePassword = '',
  [string]$KeyPassword = '',
  [string]$Alias = 'dshpalm',
  [string]$Dname = 'CN=DSH Palm, OU=Mobile, O=dsh-palm, L=Shenyang, ST=Liaoning, C=CN',
  [switch]$Force
)
# Generate the release keystore and app/android/keystore.properties (both gitignored).
# Usage: powershell -File scripts/gen-release-keystore.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'app/android'
$keystoreDir = Join-Path $android 'keystore'
$keystore = Join-Path $keystoreDir 'release.jks'
$props = Join-Path $android 'keystore.properties'

if ((Test-Path $keystore) -or (Test-Path $props)) {
  if (-not $Force) {
    throw "keystore or properties already exists; pass -Force only if you accept losing the old key"
  }
}
if (-not $StorePassword) {
  $bytes = New-Object byte[] 24
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $StorePassword = [Convert]::ToBase64String($bytes).Replace('/', '_').Replace('+', '-').Replace('=', '')
}
if (-not $KeyPassword) { $KeyPassword = $StorePassword }

$keytool = $null
foreach ($cand in @(
    (Join-Path $env:JAVA_HOME 'bin/keytool.exe'),
    'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe',
    'C:\Program Files\Java\jdk-17\bin\keytool.exe'
  )) {
  if ($cand -and (Test-Path $cand)) { $keytool = $cand; break }
}
if (-not $keytool) {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { $keytool = $cmd.Source }
}
if (-not $keytool) { throw 'keytool not found; set JAVA_HOME or install JDK 17+' }

New-Item -ItemType Directory -Force $keystoreDir | Out-Null
# keytool writes progress to stderr; Windows PowerShell 5.1 turns that into an
# ErrorRecord and would abort under ErrorActionPreference=Stop. Relax it just for this call.
$ErrorActionPreference = 'Continue'
& $keytool -genkeypair -v -storetype PKCS12 `
  -keystore $keystore -storepass $StorePassword -alias $Alias -keypass $KeyPassword `
  -keyalg RSA -keysize 4096 -validity 10000 -dname $Dname 2>&1 | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) { throw "keytool failed (exit $code)" }

$propLines = @(
  '# local release signing config; do not commit',
  'storeFile=keystore/release.jks',
  "storePassword=$StorePassword",
  "keyAlias=$Alias",
  "keyPassword=$KeyPassword"
)
# Java Properties treats a UTF-8 BOM as part of the first key; write without BOM.
[IO.File]::WriteAllText($props, ($propLines -join "`r`n"), (New-Object Text.UTF8Encoding($false)))

Write-Host "keystore: $keystore"
Write-Host "properties: $props"
& $keytool -list -v -keystore $keystore -storepass $StorePassword -alias $Alias |
  Select-String -Pattern 'SHA256:|Alias name|Valid from'
Write-Host 'Back up keystore + keystore.properties; losing them breaks in-place upgrades.'
