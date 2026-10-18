@echo off
title Chatbot - Mobile Application View
cd /d "%~dp0"

echo ===================================================
echo   Starting Chatbot Mobile Application
echo ===================================================
echo.

:: Check if port 5173 is already running
netstat -ano | findstr :5173 | findstr LISTENING >nul
if %errorlevel% neq 0 (
    echo Starting local server in background...
    start /min "Chatbot Server" cmd /c "npm run dev"
    timeout /t 3 /nobreak >nul
) else (
    echo Local server already active on port 5173.
)

echo Opening mobile application frame (Smartphone aspect ratio 420x880)...

set EDGE_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"

if exist %EDGE_PATH% (
    start "" %EDGE_PATH% --app="http://localhost:5173" --window-size=420,880
) else if exist %CHROME_PATH% (
    start "" %CHROME_PATH% --app="http://localhost:5173" --window-size=420,880
) else (
    start http://localhost:5173
)
