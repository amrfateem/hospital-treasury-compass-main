# Remove the Al-Rahma Hospital Windows service. Data on the USB is not touched.
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$ServiceName = "AlRahmaHospital"
$ServiceHome = Join-Path $env:ProgramFiles "AlRahmaHospital"

if (Test-Path (Join-Path $ServiceHome "AlRahmaService.exe")) {
  $cfg = Join-Path $ServiceHome "AlRahmaService.xml"
  & (Join-Path $ServiceHome "AlRahmaService.exe") stop $cfg 2>$null | Out-Null
  & (Join-Path $ServiceHome "AlRahmaService.exe") uninstall $cfg 2>$null | Out-Null
}
sc.exe delete $ServiceName 2>$null | Out-Null
Unregister-ScheduledTask -TaskName "AlRahmaHospitalUpdate" -Confirm:$false -ErrorAction SilentlyContinue
netsh advfirewall firewall delete rule name="AlRahma Hospital HTTP" 2>$null | Out-Null
netsh advfirewall firewall delete rule name="AlRahma Hospital mDNS" 2>$null | Out-Null
Remove-Item $ServiceHome -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Service removed. Application data and backups were left in place." -ForegroundColor Green
