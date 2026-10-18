@echo off
title Chatbot - Windows Application
cd /d "%~dp0"

echo ===================================================
echo   Starting Chatbot Native Windows Application
echo ===================================================
echo.

if exist "release\Chatbot-1.0.0-portable.exe" (
    echo Found portable executable. Launching...
    start "" "release\Chatbot-1.0.0-portable.exe"
    exit /b
)

if exist "release\win-unpacked\Chatbot.exe" (
    echo Found unpacked executable. Launching...
    start "" "release\win-unpacked\Chatbot.exe"
    exit /b
)

echo Executable not found. Running development shell...
call npm run electron:dev
