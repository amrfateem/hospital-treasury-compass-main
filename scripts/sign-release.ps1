# Signs the release binaries and the generated update script with the internal leaf certificate.
# Run after `npm run app:package` and after stopping the running app.
param(
  [string]$ReleaseDir = (Join-Path $PSScriptRoot "..\release")
)
$ErrorActionPreference = "Stop"
$thumbprintFile = Join-Path $PSScriptRoot "..\signing\leaf-thumbprint.txt"
if (-not (Test-Path $thumbprintFile)) { throw "signing\leaf-thumbprint.txt is missing." }
$thumbprint = (Get-Content $thumbprintFile -Raw).Trim()
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
if (-not $cert) { throw "Signing certificate $thumbprint is not in Cert:\CurrentUser\My." }

$files = @(
  (Join-Path $ReleaseDir "AlRahmaHospital\AlRahmaHospital.exe"),
  (Join-Path $ReleaseDir "AlRahmaHospital-client\AlRahmaHospital.exe"),
  (Join-Path $ReleaseDir "AlRahmaHospital\AlRahmaService.exe")
)
$updateScript = Get-ChildItem (Join-Path $ReleaseDir "updates") -Recurse -Filter "apply-update.ps1" -ErrorAction SilentlyContinue
foreach ($s in $updateScript) { $files += $s.FullName }
$files += Get-ChildItem (Join-Path $ReleaseDir "AlRahmaHospital") -Filter "*.ps1" -File | ForEach-Object { $_.FullName }
$clientTrust = Join-Path $ReleaseDir "AlRahmaHospital-client\Trust-AlRahma.ps1"
if (Test-Path $clientTrust) { $files += $clientTrust }

foreach ($file in $files) {
  if (-not (Test-Path $file)) { continue }
  $sig = Set-AuthenticodeSignature -FilePath $file -Certificate $cert -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256
  Write-Host ("{0} -> {1}" -f $file, $sig.Status)
}
