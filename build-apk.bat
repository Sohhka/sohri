@echo off
rem Double-clic : construit l'APK dans le dossier dist (voir build-apk.ps1 et README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
echo.
pause
