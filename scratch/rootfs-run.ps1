param(
  [Parameter(Mandatory = $true)][string]$ScriptPath
)
# Push a shell script into the app workspace and run it inside the phone rootfs.
# Usage: pwsh -File scratch/rootfs-run.ps1 scratch/probe.sh
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$localFile = Resolve-Path $ScriptPath

$dump = adb shell "dumpsys package cool.cnb.dshpalm | grep codePath" | Out-String
if ($dump -notmatch 'codePath=(\S+)') { throw "cannot find codePath: $dump" }
$codePath = $Matches[1].Trim()
$lib = "$codePath/lib/arm64"

Get-Content -Raw $localFile | adb shell "run-as cool.cnb.dshpalm sh -c 'cat > files/workspace/_run.sh'"
adb shell "run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh $lib `"/bin/sh /root/work/_run.sh`""
exit $LASTEXITCODE
