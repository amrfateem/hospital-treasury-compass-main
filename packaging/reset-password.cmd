@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set /p USER=Username:
set /p PASS=New password (at least 8 characters):
if "%USER%"=="" goto end
if "%PASS%"=="" goto end
"%~dp0..\node.exe" "%~dp0reset-password.mjs" --user "%USER%" --password "%PASS%"
pause
:end
