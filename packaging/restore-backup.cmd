@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo Al-Rahma Hospital - restore a backup / استرجاع نسخة احتياطية
echo Close the hospital app (or stop the service) first. / اقفل البرنامج الأول.
echo.
"%~dp0..\node.exe" "%~dp0restore-backup.mjs" --list
echo.
set /p OK=Restore the newest healthy backup? (yes/no) / ترجع أحدث نسخة سليمة؟ :
if /i not "%OK%"=="yes" goto end
"%~dp0..\node.exe" "%~dp0restore-backup.mjs"
:end
pause
