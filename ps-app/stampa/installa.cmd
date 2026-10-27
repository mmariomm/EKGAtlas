@echo off
rem PS Assist - installa la stampa automatica, solo per questo utente.
rem Niente amministratore: tutto il lavoro lo fa installa.ps1, qui accanto.
if not exist "%~dp0installa.ps1" (
  echo.
  echo Estrai prima lo zip: tasto destro sullo zip, "Estrai tutto...", poi doppio clic
  echo su installa.cmd nella cartella stampa estratta. Da dentro lo zip non funziona.
  echo.
  pause
  exit /b 1
)
set "PSA_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "PSA_QUI=%~dp0"
set "PSA_QUI=%PSA_QUI:'=''%"
rem Uno zip scaricato col browser porta il segno "dal web": Windows bloccherebbe
rem gli script. Lo si toglie a questa cartella (un comando, non uno script).
"%PSA_PS%" -NoLogo -NoProfile -Command "Get-ChildItem -LiteralPath '%PSA_QUI%' | Unblock-File"
"%PSA_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
echo.
pause
