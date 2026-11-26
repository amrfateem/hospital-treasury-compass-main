@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Connect-Client.ps1"
if errorlevel 1 pause