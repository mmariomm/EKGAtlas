@echo off
rem PS Assist - rimette la versione di prima dell'ultimo "Aggiorna app": la
rem cartella %LOCALAPPDATA%\PSAssist\estensione.prima torna estensione. Per
rem quando la versione nuova non parte (il pannello non compare piu').
rem Lo fa installa.ps1 -Ripristina, qui accanto. Poi in chrome://extensions:
rem ricarica PS Assist (o chiudi e riapri Chrome).
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1" -Ripristina
echo.
pause
