# PS Assist — installa la stampa automatica per QUESTO utente di Windows.
# Niente amministratore: una chiave nel registro dell'utente (HKCU) che dice a
# Chrome e a Edge dov'è l'aiutante di stampa, e SumatraPDF portable in questa
# cartella. Si lancia con un doppio clic su installa.cmd; si toglie con
# disinstalla.cmd.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$QUI = $PSScriptRoot
$NOME = 'it.psassist.stampa'
# SumatraPDF portable, 64 bit, dal sito ufficiale; l'impronta è quella di
# questa versione: un file diverso non si usa.
$SUMATRA_ZIP = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
$SUMATRA_SHA256 = '98B33A518D42986856D225064B0CD2D3643ECF78CBF84AB873D26CC51877A544'
$SUMATRA_PAGINA = 'https://www.sumatrapdfreader.org/download-free-pdf-viewer'

function Fine([bool]$ok, [string]$testo) {
  Write-Host ''
  if ($ok) { Write-Host "Fatto. $testo" -ForegroundColor Green }
  else { Write-Host "Non riuscito: $testo" -ForegroundColor Red }
  exit $(if ($ok) { 0 } else { 1 })
}

# 1. SumatraPDF: c'è già, o si scarica una volta (e si controlla l'impronta).
$exe = Join-Path $QUI 'SumatraPDF.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host 'Scarico SumatraPDF (portable, 64 bit) dal sito ufficiale...'
  $zip = Join-Path $env:TEMP ('psassist-sumatra-{0}.zip' -f [guid]::NewGuid().ToString('N'))
  $tmp = $zip -replace '\.zip$', ''
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $web = New-Object Net.WebClient
    $web.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials   # il proxy dell'ospedale, se c'è
    $web.DownloadFile($SUMATRA_ZIP, $zip)
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $SUMATRA_SHA256) { throw 'il file scaricato non è quello atteso (impronta SHA-256 diversa)' }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp
    Move-Item -LiteralPath (Get-ChildItem -LiteralPath $tmp -Filter 'SumatraPDF*.exe' | Select-Object -First 1).FullName -Destination $exe
  } catch {
    Write-Host "Il download non è riuscito ($($_.Exception.Message))."
    Write-Host "Scarica a mano «SumatraPDF portable 64-bit» (zip) da $SUMATRA_PAGINA,"
    Write-Host "estrai il file .exe, rinominalo SumatraPDF.exe e mettilo qui: $QUI — poi rilancia installa.cmd."
    Fine $false 'manca SumatraPDF.exe.'
  } finally {
    Remove-Item -LiteralPath $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 2. Quale estensione può chiamare l'aiutante: PS Assist, caricata «non
# pacchettizzata». Il suo ID sta nelle preferenze di ogni profilo di Chrome e di
# Edge, accanto alla cartella da cui è caricata.
$ids = @()
$profili = Get-ChildItem -Path "$env:LOCALAPPDATA\Google\Chrome\User Data", "$env:LOCALAPPDATA\Microsoft\Edge\User Data" -Directory -ErrorAction SilentlyContinue
foreach ($pref in ($profili | ForEach-Object { Join-Path $_.FullName 'Secure Preferences'; Join-Path $_.FullName 'Preferences' })) {
  if (-not (Test-Path -LiteralPath $pref)) { continue }
  try { $estensioni = (Get-Content -LiteralPath $pref -Raw -Encoding UTF8 | ConvertFrom-Json).extensions.settings } catch { continue }
  if (-not $estensioni) { continue }
  foreach ($e in $estensioni.PSObject.Properties) {
    $dir = [string]$e.Value.path
    if (-not $dir -or -not [IO.Path]::IsPathRooted($dir)) { continue }
    $man = Join-Path $dir 'manifest.json'
    if ((Test-Path -LiteralPath $man) -and (Get-Content -LiteralPath $man -Raw -Encoding UTF8) -match '"short_name"\s*:\s*"PS Assist"') { $ids += $e.Name }
  }
}
$ids = @($ids | Sort-Object -Unique)
if ($ids.Count) {
  Write-Host ("Trovata PS Assist: {0}" -f ($ids -join ', '))
} else {
  Write-Host 'Non trovo PS Assist fra le estensioni di Chrome e di Edge.'
  Write-Host "Apri il pannello di PS Assist, menu ⋯ → Stampanti: in fondo c'è l'ID dell'estensione, con «Copia»."
  $id = ([string](Read-Host 'Incollalo qui e premi Invio')).Trim()
  if ($id -notmatch '^[a-p]{32}$') { Fine $false "questo non è l'ID di un'estensione (sono 32 lettere fra a e p)." }
  $ids = @($id)
}

# 3. Il «manifest» dell'aiutante, qui accanto, e la chiave che lo indica a
# Chrome e a Edge (solo per questo utente).
$json = Join-Path $QUI "$NOME.json"
$manifest = [ordered]@{
  name = $NOME
  description = 'PS Assist: stampa automatica'
  path = 'host.cmd'
  type = 'stdio'
  allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
}
[IO.File]::WriteAllText($json, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
foreach ($browser in 'Google\Chrome', 'Microsoft\Edge') {
  $null = New-Item -Path "HKCU:\Software\$browser\NativeMessagingHosts\$NOME" -Value $json -Force
}

Fine $true "Torna su PS Assist: menu ⋯ → Stampanti, scegli l'etichettatrice e l'A4, e stampa una pagina di prova."
