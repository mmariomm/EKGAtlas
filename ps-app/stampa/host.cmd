@echo off
rem PS Assist - stampa automatica. Chrome avvia questo file per ogni stampa:
rem passa la domanda a host.ps1, che risponde ed esce. Niente resta acceso.
rem (Niente "echo" qui: stdout e' il filo con Chrome.)
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0host.ps1"
