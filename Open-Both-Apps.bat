@echo off
title Launch Chatbot (Windows + Mobile)
cd /d "%~dp0"

echo ===================================================
echo   Launching Chatbot (Both Windows and Mobile)
echo ===================================================
echo.

echo [1/2] Opening Mobile Application view...
start "" "%~dp0Open-Mobile-App.bat"

timeout /t 2 /nobreak >nul

echo [2/2] Opening Windows Native Application...
start "" "%~dp0Open-Windows-App.bat"

echo.
echo Both applications launched successfully!
timeout /t 3 >nul
