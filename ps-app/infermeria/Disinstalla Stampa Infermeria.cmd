@echo off
rem PS Assist - Stampa Infermeria: toglie tutto con un doppio clic, per questo
rem utente. Lo fa installa.ps1 -Togli (quello installato, o quello dello zip):
rem le due chiavi del registro dell'utente (l'aiutante per Chrome e per Edge),
rem la cartella %LOCALAPPDATA%\PSAssist (l'aiutante, SumatraPDF, il registro
rem delle stampe, l'estensione e la sua versione di prima), i fogli temporanei
rem e i resti di un aggiornamento; poi controlla che non resti niente. Apre
rem chrome://extensions: l'estensione in Chrome si toglie li', con Rimuovi.
rem Si lavora da %TEMP%: la cartella che si toglie non deve essere in uso.
setlocal
set "PSA_I=%LOCALAPPDATA%\PSAssist\stampa\installa.ps1"
if not exist "%PSA_I%" set "PSA_I=%~dp0stampa\installa.ps1"
if not exist "%PSA_I%" (
  echo.
  echo Niente da togliere: la Stampa Infermeria non e' installata per questo utente.
  echo Se in chrome://extensions c'e' ancora "PS Assist - Stampa Infermeria", premi Rimuovi.
  echo.
  pause
  exit /b 0
)
cd /d "%TEMP%" & "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PSA_I%" -Togli & echo. & pause & exit /b
