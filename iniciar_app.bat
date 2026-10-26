@echo off
setlocal
set "URL=http://localhost/guia_academica/"
set "XAMPP=C:\xampp"
set "OLLAMA_DIR=%LOCALAPPDATA%\Programs\Ollama"

rem --- Apache ---
tasklist /FI "IMAGENAME eq httpd.exe" 2>NUL | find /I "httpd.exe" >NUL
if errorlevel 1 (
    start "" /min "%XAMPP%\apache_start.bat"
    timeout /t 4 /nobreak >NUL
)

rem --- Ollama ---
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I "ollama.exe" >NUL
if errorlevel 1 (
    if exist "%OLLAMA_DIR%\ollama app.exe" (
        start "" "%OLLAMA_DIR%\ollama app.exe"
    ) else if exist "%OLLAMA_DIR%\ollama.exe" (
        start "" /min "%OLLAMA_DIR%\ollama.exe" serve
    )
    timeout /t 3 /nobreak >NUL
)

start "" "%URL%"
exit /b 0
