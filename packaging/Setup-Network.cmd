@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File ""{0}Setup-Network.ps1""' -f '%~dp0')"
if errorlevel 1 pause