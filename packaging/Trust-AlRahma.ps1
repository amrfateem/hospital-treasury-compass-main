# Trust the Al-Rahma internal signing root on this PC (one-time, administrator).
# Required for a clean "trusted publisher" prompt with the self-signed certificate.
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$RootCert = Join-Path $PSScriptRoot "trust\AlRahmaRoot.cer"
if (-not (Test-Path $RootCert)) { throw "trust\AlRahmaRoot.cer is missing." }
Import-Certificate -FilePath $RootCert -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $RootCert -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
Write-Host "Al-Rahma signing root trusted on this PC." -ForegroundColor Green
