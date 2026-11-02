@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-mecoffe.ps1" %*
set "MECOFFE_EXIT=%ERRORLEVEL%"
if not "%MECOFFE_EXIT%"=="0" pause
exit /b %MECOFFE_EXIT%
