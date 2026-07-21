@echo off
title SOAZ Servidor Local
cd /d "%~dp0"
set PORT=8080

echo.
echo ========================================
echo   SOAZ - Servidor local + iPad
echo ========================================
echo   Carpeta: %CD%
echo   PC:      http://127.0.0.1:%PORT%/
echo   iPad:    mira la IP que saldra abajo
echo ========================================
echo.
echo 1) PC e iPad en la MISMA Wi-Fi
echo 2) Deja ESTA ventana abierta
echo 3) En iPad Safari abre la URL http://TU_IP:%PORT%/
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1" -Port %PORT%
set ERR=%ERRORLEVEL%

echo.
if not "%ERR%"=="0" (
  echo ERROR: el servidor no pudo iniciar. Codigo %ERR%
  echo Si pide permiso de red/firewall, acepta. Prueba como Administrador.
) else (
  echo Servidor detenido.
)
echo.
pause
