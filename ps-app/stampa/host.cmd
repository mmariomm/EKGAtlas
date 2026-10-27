@echo off
rem PS Assist - stampa automatica. Chrome avvia questo file per ogni stampa:
rem passa la domanda a host.ps1, che risponde ed esce. Niente resta acceso.
rem (Niente "echo" qui: stdout e' il filo con Chrome.) PowerShell col percorso
rem intero: cmd cerca prima in questa cartella. -InputFormat None: stdin lo
rem legge host.ps1, non PowerShell (Chrome lo tiene aperto fino alla risposta).
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File "%~dp0host.ps1"
