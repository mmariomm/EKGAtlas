@echo off
rem PS Assist - Stampa Infermeria: installa tutto con un doppio clic, solo per
rem questo utente, senza amministratore. Funziona da solo (scaricato da GitHub),
rem da dentro lo zip o dalla cartella estratta: se accanto non trova il
rem pacchetto (extension e stampa), scarica ps-assist-lettura.zip da GitHub.
rem Poi fa quello che fa stampa\installa.cmd: l'aiutante di stampa, SumatraPDF
rem (impronta controllata), l'estensione in %LOCALAPPDATA%\PSAssist\estensione.
rem Il lavoro lo fa PowerShell, con il testo che sta in fondo a questo file.
setlocal
set "PSA_CMD=%~f0"
set "PSA_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
echo.
echo PS Assist - Stampa Infermeria: installo...
echo.
"%PSA_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText($env:PSA_CMD, [Text.Encoding]::UTF8); $m = '#PSA' + '-INIZIO'; Invoke-Expression $t.Substring($t.IndexOf($m))"
echo.
pause
exit /b

#PSA-INIZIO
# (da qui in giù PowerShell: cmd non ci arriva mai, esce prima)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# La chiave della build «Stampa Infermeria» (tools/lettura.mjs): un pacchetto con un'altra chiave non si installa.
$CHIAVE = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAytiHbR7RsveimO0o29OJhpUmE25bk0Zt0PWqQl0RJmuKf6vmBsZVMTzB4pd6rCJaSIOQjXj45Q7UcsHvv4KEybD/HSkwIKhdlVUuCJXdwymp7DQf6Ez5vP0QwjkjiI0JinWicVYWJbzDbkN+Xtj7ANugrFpNkcoDXYFwxjzZ1myt4iQ31YftT0oKeC7laW2i20cYt4Ial4e3OcNgHu+Pa8uPFDdLx2zcA4Xv0QXKh7VICL0DJPQL15/Oobp3kRzc05AhJGSa9sLUH5934bkKfkWOyto7QbgU5kcWqgEE17gWfc/JnueFXYo5XTK6R7RiiIZ4z5Tw1lVsOicZ2w5GgwIDAQAB'
$URL = 'https://raw.githubusercontent.com/mmariomm/EKGAtlas/main/ps-app/dist/ps-assist-lettura.zip'
$PS = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Ferma([string]$testo) { Write-Host ''; Write-Host "Non riuscito: $testo" -ForegroundColor Red; exit 1 }

if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Ferma "PowerShell su questo PC è in modalità limitata: una regola dell'IT blocca gli script. Da chiedere all'IT: consentire la cartella %LOCALAPPDATA%\PSAssist\stampa intera, con gli script in modalità FullLanguage."
}
# Un criterio che impone gli script firmati: installa.ps1 non partirebbe nemmeno.
$criterio = @(Get-ExecutionPolicy -Scope MachinePolicy; Get-ExecutionPolicy -Scope UserPolicy) | Where-Object { "$_" -in 'AllSigned', 'Restricted' } | Select-Object -First 1
if ($criterio) { Ferma "un criterio di gruppo impone «$criterio»: gli script di PS Assist, che non sono firmati, non partono. Da chiedere all'IT: firmare host.ps1 e installa.ps1 col certificato aziendale, o consentire la cartella %LOCALAPPDATA%\PSAssist\stampa intera." }

$qui = Split-Path -Parent $env:PSA_CMD
$tmp = $null
$rc = 1
try {
  # Il pacchetto: accanto (la cartella estratta), o da GitHub (questo file da solo, o aperto da dentro lo zip).
  if ((Test-Path -LiteralPath (Join-Path $qui 'stampa\installa.ps1')) -and (Test-Path -LiteralPath (Join-Path $qui 'extension\manifest.json'))) {
    $pacco = $qui
  } else {
    Write-Host 'Scarico PS Assist · Stampa Infermeria da GitHub...'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('psassist-inf-{0}' -f [guid]::NewGuid().ToString('N'))
    $zip = "$tmp.zip"
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }   # il proxy dell'ospedale, se c'è
      Invoke-WebRequest -Uri $URL -OutFile $zip -UseBasicParsing
    } catch { Ferma "il download non è riuscito ($($_.Exception.Message)). Scarica ps-assist-lettura.zip col browser da $URL, estrailo e fai doppio clic su «Installa Stampa Infermeria.cmd» nella cartella estratta." }
    $b = [IO.File]::ReadAllBytes($zip)
    if ($b.Length -lt 4 -or $b[0] -ne 0x50 -or $b[1] -ne 0x4B) { Ferma 'quello che è arrivato da GitHub non è uno zip (un proxy che blocca?).' }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp
    $pacco = $tmp
  }
  $man = Join-Path $pacco 'extension\manifest.json'
  $chiave = ''
  try { $chiave = [string](Get-Content -LiteralPath $man -Raw -Encoding UTF8 | ConvertFrom-Json).key } catch { }
  if ($chiave -ne $CHIAVE) { Ferma "il pacchetto non è PS Assist · Stampa Infermeria (in $pacco). Usa ps-assist-lettura.zip." }
  # il segno «scaricato da Internet» bloccherebbe gli script
  Get-ChildItem -LiteralPath $pacco -Recurse -File | Unblock-File
  & $PS -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pacco 'stampa\installa.ps1')
  $rc = $LASTEXITCODE
} finally {
  if ($tmp) {
    Remove-Item -LiteralPath "$tmp.zip" -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit $rc
