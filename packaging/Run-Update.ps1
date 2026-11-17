# Runs a staged, signed update. Installed as a SYSTEM scheduled task by install-service.ps1.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pathFile = Join-Path $root "app-path.txt"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "update.log"

function Log([string]$text) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "s"), $text) -Encoding UTF8
}

try {
  if (-not (Test-Path $pathFile)) { Log "app-path.txt missing"; exit 0 }
  $app = (Get-Content $pathFile -Raw).Trim()
  $script = Join-Path $app "Updates\apply-update.ps1"
  if (-not (Test-Path $script)) { exit 0 }
  $sig = Get-AuthenticodeSignature -FilePath $script
  if ($sig.Status -ne "Valid") {
    Log "update script signature is $($sig.Status): $($sig.StatusMessage)"
    exit 1
  }
  Log "applying update from $script"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script *>> $log
  Log "update finished with exit code $LASTEXITCODE"
} catch {
  Log "update failed: $($_.Exception.Message)"
  exit 1
}
