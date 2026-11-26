#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
foreach ($name in @('AlRahma Hospital HTTPS LAN', 'AlRahma Hospital HTTP LAN', 'AlRahma Hospital mDNS LAN')) {
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
New-NetFirewallRule -DisplayName 'AlRahma Hospital HTTPS LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress LocalSubnet -Profile Private,Domain | Out-Null
New-NetFirewallRule -DisplayName 'AlRahma Hospital HTTP LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -RemoteAddress LocalSubnet -Profile Private,Domain | Out-Null
New-NetFirewallRule -DisplayName 'AlRahma Hospital mDNS LAN' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -RemoteAddress LocalSubnet -Profile Private,Domain | Out-Null
Write-Host 'تم السماح بالاتصال على الشبكة الخاصة. اجعل شبكة المستشفى Private من إعدادات ويندوز.' -ForegroundColor Green
Write-Host ('اسم الجهاز الرئيسي: ' + $env:COMPUTERNAME)
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object InterfaceAlias,IPAddress | Format-Table
Read-Host 'اضغط Enter للإغلاق'