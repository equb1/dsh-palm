param(
  [string]$VersionName = "0.2.0",
  [int]$VersionCode = 16
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# Metro 增量缓存会让改了 JS 的 release 仍旧打旧 bundle；统一在发布构建前清掉。
Remove-Item -Recurse -Force (Join-Path $env:TEMP "metro-cache") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $repo "app/android/app/build/generated/assets/react/release") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $repo "app/android/app/build/intermediates/assets/release/mergeReleaseAssets") -ErrorAction SilentlyContinue

$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
$env:DSH_PALM_VERSION_NAME = $VersionName
$env:DSH_PALM_VERSION_CODE = "$VersionCode"

Push-Location (Join-Path $repo "app/android")
try {
  & .\gradlew.bat :app:assembleRelease
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
