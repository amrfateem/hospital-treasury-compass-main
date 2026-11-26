$ErrorActionPreference = 'Stop'
$address = (Read-Host 'اكتب اسم الجهاز الرئيسي أو عنوان IP الخاص به؛ اتركه فارغاً لاستخدام alrahma.local').Trim()
if (-not $address) { $address = 'alrahma.local' }
if ($address -notmatch '^https?://') { $address = 'https://' + $address }
$uri = $null
if (-not [Uri]::TryCreate($address, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https') -or -not $uri.Host -or $uri.UserInfo) {
  throw 'العنوان غير صحيح. مثال: 192.168.1.10'
}
$json = @{ url = $uri.AbsoluteUri } | ConvertTo-Json
$encoding = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'client.json'), $json, $encoding)
Write-Host 'تم حفظ الاتصال. أغلق البرنامج وافتحه مرة أخرى.' -ForegroundColor Green
Read-Host 'اضغط Enter للإغلاق'