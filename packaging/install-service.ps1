# Al-Rahma Hospital - install the headless server as a Windows service.
# Run as Administrator. The application folder may stay on the USB drive.
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$ServiceName = "AlRahmaHospital"
$ServiceHome = Join-Path $env:ProgramFiles "AlRahmaHospital"
$WinswSource = Join-Path $AppDir "AlRahmaService.exe"
$NodeExe = Join-Path $AppDir "node.exe"
$ServerEntry = Join-Path $AppDir "server\tls-entry.mjs"
if (-not (Test-Path $ServerEntry)) { $ServerEntry = Join-Path $AppDir "server\index.mjs" }
$BackupDir = Join-Path $env:PUBLIC "Documents\AlRahmaHospitalBackups\$env:COMPUTERNAME"
$RootCert = Join-Path $AppDir "trust\AlRahmaRoot.cer"
$Version = "0.1.0"
$VersionFile = Join-Path $AppDir "version.txt"
if (Test-Path $VersionFile) {
  $Version = ((Get-Content $VersionFile -Raw).Trim() -replace '^version=', '')
}

if (-not (Test-Path $WinswSource)) { throw "AlRahmaService.exe is missing. Run this from the application folder." }
if (-not (Test-Path $NodeExe)) { throw "node.exe is missing. Run this from the application folder." }
if (-not (Test-Path $ServerEntry)) { throw "server\index.mjs is missing. Build the server first." }

New-Item -ItemType Directory -Force -Path $ServiceHome | Out-Null
Copy-Item $WinswSource (Join-Path $ServiceHome "AlRahmaService.exe") -Force

function XmlEsc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

$xml = @"
<service>
  <id>$ServiceName</id>
  <name>AlRahma Hospital Server</name>
  <description>Al-Rahma Hospital treasury and accounting server (alrahma.local).</description>
  <executable>$(XmlEsc $NodeExe)</executable>
  <arguments>"$(XmlEsc $ServerEntry)"</arguments>
  <workingdirectory>$(XmlEsc $AppDir)</workingdirectory>
  <env name="NODE_ENV" value="production"/>
  <env name="ALRAHMA_APP" value="1"/>
  <env name="PORT" value="443"/>
  <env name="HOST" value="0.0.0.0"/>
  <env name="ALRAHMA_HOST" value="alrahma.local"/>
  <env name="ALRAHMA_MDNS" value="1"/>
  <env name="ALRAHMA_DATA_DIR" value="$(XmlEsc (Join-Path $AppDir 'data'))"/>
  <env name="ALRAHMA_BACKUP_DIR" value="$(XmlEsc $BackupDir)"/>
  <env name="ALRAHMA_VERSION" value="$(XmlEsc $Version)"/>
  <logpath>$(XmlEsc (Join-Path $AppDir 'data\logs'))</logpath>
  <log mode="roll-by-size"/>
  <onfailure action="restart" delay="10 sec"/>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>20 sec</stoptimeout>
</service>
"@
$xml | Set-Content -Path (Join-Path $ServiceHome "AlRahmaService.xml") -Encoding UTF8

# Remove a previous install so paths can change (for example a new USB letter).
$cfg = Join-Path $ServiceHome "AlRahmaService.xml"
& (Join-Path $ServiceHome "AlRahmaService.exe") stop $cfg 2>$null | Out-Null
& (Join-Path $ServiceHome "AlRahmaService.exe") uninstall $cfg 2>$null | Out-Null
& (Join-Path $ServiceHome "AlRahmaService.exe") install $cfg
& (Join-Path $ServiceHome "AlRahmaService.exe") start $cfg

# Firewall: HTTP and mDNS, local network only.
netsh advfirewall firewall delete rule name="AlRahma Hospital HTTP" 2>$null | Out-Null
netsh advfirewall firewall delete rule name="AlRahma Hospital HTTPS" 2>$null | Out-Null
netsh advfirewall firewall delete rule name="AlRahma Hospital mDNS" 2>$null | Out-Null
netsh advfirewall firewall add rule name="AlRahma Hospital HTTPS" dir=in action=allow protocol=TCP localport=443 profile=private,domain | Out-Null
netsh advfirewall firewall add rule name="AlRahma Hospital HTTP" dir=in action=allow protocol=TCP localport=80 profile=private,domain | Out-Null
netsh advfirewall firewall add rule name="AlRahma Hospital mDNS" dir=in action=allow protocol=UDP localport=5353 profile=private,domain | Out-Null

# Internal root certificate: lets Windows trust our signed exe and signed updates.
if (Test-Path $RootCert) {
  Import-Certificate -FilePath $RootCert -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  Import-Certificate -FilePath $RootCert -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
}

# Nightly signed-update task (SYSTEM). It does nothing when Updates\apply-update.ps1 is absent.
Copy-Item (Join-Path $AppDir "Run-Update.ps1") (Join-Path $ServiceHome "Run-Update.ps1") -Force -ErrorAction SilentlyContinue
$AppDir | Set-Content -Path (Join-Path $ServiceHome "app-path.txt") -Encoding UTF8
$updateAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ServiceHome\Run-Update.ps1`""
$daily = New-ScheduledTaskTrigger -Daily -At 3am
$onStart = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "AlRahmaHospitalUpdate" -Action $updateAction -Trigger @($daily, $onStart) -Principal $principal -Force | Out-Null

Write-Host ""
Write-Host "Al-Rahma Hospital server installed as a Windows service." -ForegroundColor Green
Write-Host "Clients open:  https://alrahma.local"
Write-Host "Data folder:   $AppDir\data"
Write-Host "Backups:       $BackupDir"
Write-Host "Service logs:  $AppDir\data\logs"
Write-Host ""
Write-Host "Keep the USB drive plugged into this PC. If the USB letter changes, run this script again."
