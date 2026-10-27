# PS Assist — installa la stampa automatica per QUESTO utente di Windows (con
# -Togli la toglie). Niente amministratore: l'aiutante, questo script e
# SumatraPDF portable vanno in %LOCALAPPDATA%\PSAssist\stampa, e una chiave nel
# registro dell'utente (HKCU) dice a Chrome e a Edge dov'è. Rilanciarlo
# aggiorna la copia. Si lancia con un doppio clic su installa.cmd; si toglie
# con disinstalla.cmd. Prima di tutto guarda i blocchi noti, e per ognuno dice
# in una riga che cosa chiedere all'IT.
param([switch]$Togli)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$QUI = $PSScriptRoot
$NOME = 'it.psassist.stampa'
# L'unica estensione che può chiamare l'aiutante: PS Assist. L'ID viene dalla
# chiave nel suo manifest, ed è lo stesso su ogni PC, in Chrome e in Edge.
$ID = 'jhhlgabilanhhnncahahclcjbefaofij'
$CASA = Join-Path $env:LOCALAPPDATA 'PSAssist'
$DOVE = Join-Path $CASA 'stampa'
$CHIAVI = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NOME", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$NOME"
# SumatraPDF portable, 64 bit, 3.6.1: le impronte sono quelle di questa versione,
# e un file diverso non si usa.
$ZIP_NOME = 'SumatraPDF-3.6.1-64.zip'
$ZIP_URL = "https://www.sumatrapdfreader.org/dl/rel/3.6.1/$ZIP_NOME"
$ZIP_SHA256 = '98B33A518D42986856D225064B0CD2D3643ECF78CBF84AB873D26CC51877A544'
$EXE_SHA256 = '719F689B34F47BE8CA105CE8484948474DAFDE0E106BAB599E4A89326070C3D0'

function Fine([bool]$ok, [string]$testo) {
  Write-Host ''
  if ($ok) { Write-Host "Fatto. $testo" -ForegroundColor Green }
  else { Write-Host "Non riuscito: $testo" -ForegroundColor Red }
  exit $(if ($ok) { 0 } else { 1 })
}

# 0. PowerShell in modalità limitata (AppLocker/WDAC): qui non si va avanti, e
# l'aiutante non potrebbe nemmeno rispondere a Chrome.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Host "PowerShell su questo PC è in modalità limitata ($($ExecutionContext.SessionState.LanguageMode)): una regola dell'IT blocca gli script, e l'aiutante di stampa non potrebbe rispondere."
  Write-Host "  Da chiedere all'IT: consentire host.ps1 e installa.ps1 della cartella $DOVE in modalità FullLanguage (regola per hash o per percorso, o firmarli col certificato aziendale)."
  Fine $false 'PowerShell in modalità limitata.'
}

# ---- togliere ----------------------------------------------------------------
if ($Togli) {
  # (ogni pezzo per conto suo: quello che non va via lo dice il controllo, sotto)
  foreach ($k in $CHIAVI) { try { if (Test-Path -Path $k) { Remove-Item -Path $k -Recurse -Force } } catch { } }
  # l'aiutante, SumatraPDF e le sue impostazioni, il registro delle stampe
  if (Test-Path -LiteralPath $CASA) { Remove-Item -LiteralPath $CASA -Recurse -Force -ErrorAction SilentlyContinue }
  # i fogli temporanei di una stampa interrotta (etichette di pazienti)
  Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Filter 'psassist-*.pdf' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $resta = @($CHIAVI | Where-Object { Test-Path -Path $_ }) + @(if (Test-Path -LiteralPath $CASA) { $CASA }) +
    @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Filter 'psassist-*.pdf' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  if ($resta.Count) { Fine $false ("resta ancora: {0}. Chiudi Chrome e Edge e rilancia disinstalla.cmd." -f ($resta -join ', ')) }
  Fine $true "La stampa automatica è tolta: PS Assist torna al dialogo di stampa. Ora puoi cancellare la cartella dello zip."
}

# ---- installare --------------------------------------------------------------
# 1. La copia di lavoro: sempre la stessa cartella, nel profilo dell'utente
# (non Documenti, che spesso sta su un server o su OneDrive).
Write-Host "Copio l'aiutante in $DOVE..."
$null = New-Item -ItemType Directory -Path $DOVE -Force
if ($QUI -ne $DOVE) {
  foreach ($f in 'host.cmd', 'host.ps1', 'installa.ps1') { Copy-Item -LiteralPath (Join-Path $QUI $f) -Destination $DOVE -Force }
}

# 2. SumatraPDF: c'è già, giusto; o dallo zip (in questa cartella o in
# Download, se l'hai scaricato col browser); o, solo se manca, dal sito.
function Giusto([string]$f, [string]$sha) { (Test-Path -LiteralPath $f) -and (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash -eq $sha }
$exe = Join-Path $DOVE 'SumatraPDF.exe'
if (-not (Giusto $exe $EXE_SHA256)) {
  if (Giusto (Join-Path $QUI 'SumatraPDF.exe') $EXE_SHA256) { Copy-Item -LiteralPath (Join-Path $QUI 'SumatraPDF.exe') -Destination $exe -Force }
  else {
    $zip = @((Join-Path $QUI $ZIP_NOME), (Join-Path (Join-Path $env:USERPROFILE 'Downloads') $ZIP_NOME)) | Where-Object { Giusto $_ $ZIP_SHA256 } | Select-Object -First 1
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('psassist-sumatra-{0}' -f [guid]::NewGuid().ToString('N'))
    try {
      if ($zip) { Write-Host "Uso $zip (impronta controllata)." }
      else {
        Write-Host 'Scarico SumatraPDF (portable, 64 bit) dal sito ufficiale...'
        $zip = "$tmp.zip"
        try {
          [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
          try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }   # il proxy dell'ospedale, se c'è
          Invoke-WebRequest -Uri $ZIP_URL -OutFile $zip -UseBasicParsing
        } catch { throw "il download non è riuscito ($($_.Exception.Message))" }
        if (-not (Giusto $zip $ZIP_SHA256)) { throw 'il file scaricato non è quello atteso (impronta SHA-256 diversa)' }
      }
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp
      $dentro = Get-ChildItem -LiteralPath $tmp -Filter 'SumatraPDF*.exe' | Select-Object -First 1
      if (-not $dentro -or -not (Giusto $dentro.FullName $EXE_SHA256)) { throw 'nello zip non c''è il SumatraPDF atteso' }
      Move-Item -LiteralPath $dentro.FullName -Destination $exe -Force
    } catch {
      Write-Host "SumatraPDF: $($_.Exception.Message)."
      Write-Host "Scaricalo col browser: $ZIP_URL (passa anche da files.sumatrapdfreader.org)."
      Write-Host "Lascia $ZIP_NOME in Download (o in questa cartella) e rilancia installa.cmd: lo uso se l'impronta SHA-256 è $ZIP_SHA256."
      Write-Host "  Da chiedere all'IT, se il proxy lo blocca: www.sumatrapdfreader.org e files.sumatrapdfreader.org, o lo zip qui sopra."
      Fine $false 'manca SumatraPDF.exe.'
    } finally {
      if ($zip -eq "$tmp.zip") { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# 3. I blocchi noti, ognuno in una riga con quello che va chiesto all'IT.
$blocchi = @()
function Blocco([string]$cosa, [string]$it) { $script:blocchi += [pscustomobject]@{ cosa = $cosa; it = $it } }
function Valore([string]$chiave, [string]$nome) { try { (Get-ItemProperty -Path $chiave -Name $nome -ErrorAction Stop).$nome } catch { $null } }
function Elenco([string]$chiave) {
  try { @((Get-ItemProperty -Path $chiave -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object { [string]$_.Value }) } catch { @() }
}
foreach ($p in (Get-ExecutionPolicy -List)) {
  if ($p.Scope -in 'MachinePolicy', 'UserPolicy' -and $p.ExecutionPolicy -in 'AllSigned', 'Restricted') {
    Blocco "un criterio di gruppo ($($p.Scope)) impone «$($p.ExecutionPolicy)»: host.ps1, che non è firmato, non parte" "firmare host.ps1 e installa.ps1 col certificato aziendale, o consentirli per hash o per percorso ($DOVE)"
  }
}
foreach ($b in @(@{ nome = 'Chrome'; chiave = 'Google\Chrome' }, @{ nome = 'Edge'; chiave = 'Microsoft\Edge' })) {
  foreach ($radice in 'HKLM:', 'HKCU:') {
    $pol = "$radice\SOFTWARE\Policies\$($b.chiave)"
    if ((Valore $pol 'NativeMessagingUserLevelHosts') -eq 0) {
      Blocco "$($b.nome) non accetta aiutanti installati dall'utente (criterio NativeMessagingUserLevelHosts disattivato)" "registrare $NOME in HKLM\SOFTWARE\$($b.chiave)\NativeMessagingHosts\$NOME col percorso di $DOVE\$NOME.json, o permettere gli aiutanti dell'utente"
    }
    $no = Elenco "$pol\NativeMessagingBlocklist"
    if (($no -contains '*' -or $no -contains $NOME) -and (Elenco "$pol\NativeMessagingAllowlist") -notcontains $NOME) {
      Blocco "$($b.nome) vieta gli aiutanti (criterio NativeMessagingBlocklist)" "aggiungere $NOME a NativeMessagingAllowlist"
    }
  }
}
foreach ($radice in 'HKCU:', 'HKLM:') {
  if ((Valore "$radice\SOFTWARE\Policies\Microsoft\Windows\System" 'DisableCMD') -eq 1) {
    Blocco 'il prompt dei comandi è vietato anche agli script (criterio DisableCMD = 1): Chrome avvia l''aiutante con cmd.exe' "impostare DisableCMD = 2 (vieta il prompt, lascia gli script), o nessun criterio"
  }
}
# SumatraPDF parte davvero? (un file che non c'è: deve uscire subito, senza stampare niente)
try {
  $prova = Start-Process -FilePath $exe -ArgumentList '-print-to', '"PS Assist prova"', '-silent', ('"{0}"' -f (Join-Path ([IO.Path]::GetTempPath()) 'psassist-nessuno.pdf')) -PassThru -WindowStyle Hidden
  if (-not $prova.WaitForExit(15000)) { try { $prova.Kill() } catch { }; throw 'non ha finito in 15 secondi' }
} catch {
  Blocco "SumatraPDF.exe non parte da $DOVE ($($_.Exception.Message))" "consentire (AppLocker/WDAC, antivirus) SumatraPDF.exe 3.6.1, firmato «Krzysztof Kowalczyk», SHA-256 $EXE_SHA256"
}

# 4. Il «manifest» dell'aiutante, nella copia, e la chiave che lo indica a
# Chrome e a Edge (solo per questo utente).
$json = Join-Path $DOVE "$NOME.json"
$manifest = [ordered]@{
  name = $NOME
  description = 'PS Assist: stampa automatica'
  path = 'host.cmd'
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ID/")
}
[IO.File]::WriteAllText($json, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
foreach ($k in $CHIAVI) { $null = New-Item -Path $k -Value $json -Force }

if ($blocchi.Count) {
  Write-Host ''
  Write-Host 'Installata, ma qui la stampa automatica non può funzionare finché l''IT non toglie questi blocchi:' -ForegroundColor Yellow
  foreach ($x in $blocchi) { Write-Host "- $($x.cosa)."; Write-Host "  Da chiedere all'IT: $($x.it)." }
  Fine $false ('{0} da togliere (qui sopra). PS Assist intanto usa il dialogo di stampa.' -f $(if ($blocchi.Count -eq 1) { '1 blocco' } else { "$($blocchi.Count) blocchi" }))
}
Fine $true "Torna su PS Assist: menu ⋯ → Stampanti, scegli l'etichettatrice e l'A4, e stampa una pagina di prova."
