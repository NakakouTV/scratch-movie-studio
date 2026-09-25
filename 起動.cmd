@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
echo Scratch Movie Studio
echo Open http://127.0.0.1:8601 in your browser.
call npm.cmd start
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"
popd
pause
exit /b %STUDIO_EXIT_CODE%
