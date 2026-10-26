@echo off
rem PS Assist - installa la stampa automatica, solo per questo utente.
rem Niente amministratore: tutto il lavoro lo fa installa.ps1, qui accanto.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
echo.
pause
