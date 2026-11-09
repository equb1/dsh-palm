# 把 dist/ 里的 APK 上传到 GitHub Releases。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/upload-release.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/upload-release.ps1 -Tag v0.2.2 -Draft
#
# Token 读取顺序：
#   1. $env:GITHUB_TOKEN / $env:GH_TOKEN
#   2. git credential fill（本机已保存的 github.com 凭据）
#
# 只上传资产，不会修改仓库代码；-Draft 创建的 release 在手动发布前对公众不可见。

param(
  [string]$Tag = "v0.2.2",
  [string]$Apk = "dist/dsh-palm-0.2.2-arm64.apk",
  [string]$Repo = "equb1/dsh-palm",
  [string]$Target = "main",
  [switch]$Draft
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$apkPath = if ([System.IO.Path]::IsPathRooted($Apk)) { $Apk } else { Join-Path $repoRoot $Apk }

if (-not (Test-Path $apkPath)) { throw "APK not found: $apkPath" }

function Get-GitHubToken {
  if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
  if ($env:GH_TOKEN) { return $env:GH_TOKEN }
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'never'
  $lines = "protocol=https`nhost=github.com`n`n" | git credential fill
  $password = $lines | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if (-not $password) { throw "No GitHub token. Set GITHUB_TOKEN or sign in with git credential manager." }
  return ($password -replace '^password=', '')
}

$token = Get-GitHubToken
$headers = @{
  Authorization = "token $token"
  Accept = "application/vnd.github+json"
  "User-Agent" = "dsh-palm-release"
}
$api = "https://api.github.com/repos/$Repo"

# 已有同名 tag 的 release 就复用，否则创建
$release = $null
try {
  $release = Invoke-RestMethod -Uri "$api/releases/tags/$Tag" -Headers $headers -Method Get
} catch {
  $payload = @{
    tag_name = $Tag
    target_commitish = $Target
    name = "Jinang $Tag"
    draft = [bool]$Draft
    prerelease = $false
    body = @'
New icon, Material Design 3 landing page and bilingual README.

- 300ms in-process light engine, on-demand proot
- docx / xlsx / pptx delivered on the phone
- Interactive pet and approval-card demos
'@
  } | ConvertTo-Json -Depth 5
  $release = Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Post -ContentType "application/json" -Body $payload
  Write-Host "created release: $($release.html_url)"
}

# 同名资产已存在则先删除，避免重复上传
foreach ($asset in @($release.assets)) {
  if ($asset.name -eq (Split-Path -Leaf $apkPath)) {
    Invoke-RestMethod -Uri "$api/releases/assets/$($asset.id)" -Headers $headers -Method Delete
    Write-Host "deleted old asset: $($asset.name)"
  }
}

$uploadUrl = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets"
$name = [System.Uri]::EscapeDataString((Split-Path -Leaf $apkPath))
Write-Host "uploading $apkPath ..."
& curl.exe -sS -X POST `
  -H "Authorization: token $token" `
  -H "Content-Type: application/octet-stream" `
  -H "User-Agent: dsh-palm-release" `
  --data-binary "@$apkPath" `
  "$uploadUrl?name=$name" | Out-Null

if ($LASTEXITCODE -ne 0) { throw "curl upload failed: $LASTEXITCODE" }

$release = Invoke-RestMethod -Uri "$api/releases/tags/$Tag" -Headers $headers -Method Get
$asset = $release.assets | Where-Object { $_.name -eq (Split-Path -Leaf $apkPath) } | Select-Object -First 1
if (-not $asset) { throw "asset not found after upload" }

Write-Host "done: $($asset.browser_download_url)"
if ($Draft) { Write-Host "release is a draft; publish it on GitHub after pushing the source." }
