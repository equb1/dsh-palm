param(
  [Parameter(Mandatory = $true)][string]$Local,
  [Parameter(Mandatory = $true)][string]$RemoteRel   # path relative to files/ (e.g. workspace/x.py)
)
# Push any file into the app's files dir as base64 text, then decode on device.
# Works around PowerShell -> adb stdin text encoding mangling UTF-8 / binary.
$ErrorActionPreference = 'Stop'
$path = (Resolve-Path $Local).Path
$remote = "files/$RemoteRel"
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
$b64 | adb shell "run-as cool.cnb.dshpalm sh -c 'cat > $remote.b64'"
adb shell "run-as cool.cnb.dshpalm sh -c 'base64 -d $remote.b64 > $remote; rm -f $remote.b64; ls -l $remote'"
exit $LASTEXITCODE
