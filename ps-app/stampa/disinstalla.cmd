@echo off
rem PS Assist - toglie la stampa automatica per questo utente: le due chiavi
rem nel registro dell'utente e il file che indicano a Chrome e a Edge.
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\it.psassist.stampa" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\it.psassist.stampa" /f >nul 2>&1
del "%~dp0it.psassist.stampa.json" >nul 2>&1
echo.
echo Fatto. La stampa automatica e' tolta: PS Assist torna al dialogo di stampa.
echo Ora puoi cancellare questa cartella (con dentro SumatraPDF.exe).
echo.
pause
