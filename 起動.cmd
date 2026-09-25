@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Scratch Movie Studio
echo http://127.0.0.1:8601 をブラウザで開いてください。
call npm start
pause
