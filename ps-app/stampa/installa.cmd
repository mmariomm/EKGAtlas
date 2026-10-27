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
rem Un criterio di gruppo che impone gli script firmati vince su -ExecutionPolicy
rem Bypass: installa.ps1 non partirebbe nemmeno, e Windows direbbe solo "non e'
rem firmato digitalmente". Un comando (-Command) parte lo stesso, e lo guarda.
set "PSA_CRITERIO="
for /f "usebackq delims=" %%p in (`""%PSA_PS%" -NoLogo -NoProfile -Command "Get-ExecutionPolicy -Scope MachinePolicy; Get-ExecutionPolicy -Scope UserPolicy""`) do (
  if /i "%%p"=="AllSigned" set "PSA_CRITERIO=%%p"
  if /i "%%p"=="Restricted" set "PSA_CRITERIO=%%p"
)
if defined PSA_CRITERIO (
  echo.
  echo - Un criterio di gruppo impone "%PSA_CRITERIO%": gli script di PS Assist, che non sono firmati, non partono.
  echo   Da chiedere all'IT: firmare host.ps1 e installa.ps1 col certificato aziendale, o consentire la
  echo   cartella %LOCALAPPDATA%\PSAssist\stampa intera ^(punto 2 di stampa\README.md^).
  echo.
  echo Non riuscito: PS Assist intanto usa il dialogo di stampa.
  echo.
  pause
  exit /b 1
)
rem Uno zip scaricato col browser porta il segno "dal web": Windows bloccherebbe
rem gli script. Lo si toglie a questa cartella (un comando, non uno script).
"%PSA_PS%" -NoLogo -NoProfile -Command "Get-ChildItem -LiteralPath '%PSA_QUI%' | Unblock-File"
"%PSA_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
echo.
pause
