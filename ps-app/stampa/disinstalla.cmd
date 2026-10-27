@echo off
rem PS Assist - toglie la stampa automatica per questo utente: le due chiavi
rem nel registro dell'utente, la cartella %LOCALAPPDATA%\PSAssist (l'aiutante,
rem SumatraPDF, il registro delle stampe) e i fogli temporanei rimasti. Lo fa
rem installa.ps1, e controlla che sia andato via tutto.
rem Si lancia dalla cartella dello zip o da %LOCALAPPDATA%\PSAssist\stampa, che
rem va via anche lei: per questo si lavora da %TEMP%, e tutto su una riga (cmd
rem legge questo file una riga alla volta, e il file non ci sara' piu').
cd /d "%TEMP%" & "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1" -Togli & echo. & pause & exit /b
