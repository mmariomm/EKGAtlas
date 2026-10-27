@echo off
rem PS Assist - toglie la stampa automatica per questo utente: le due chiavi
rem nel registro dell'utente, la cartella %LOCALAPPDATA%\PSAssist (l'aiutante,
rem SumatraPDF, il registro delle stampe) e i fogli temporanei rimasti. Lo fa
rem installa.ps1, e controlla che sia andato via tutto.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1" -Togli
echo.
pause
