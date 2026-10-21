@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  start "PDF Master Suite Pro - servidor" cmd /k "cd /d "%~dp0" && py -m http.server 8000"
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    start "PDF Master Suite Pro - servidor" cmd /k "cd /d "%~dp0" && python -m http.server 8000"
  ) else (
    echo No se encontro Python. Instala Python 3 y activa Add Python to PATH.
    pause
    exit /b 1
  )
)
timeout /t 2 /nobreak >nul
start "" http://localhost:8000/index.html
endlocal
