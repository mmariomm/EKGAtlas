# PS Assist — stampa automatica: l'aiutante che Chrome (o Edge) avvia per UNA
# domanda dell'estensione, e che esce appena ha risposto. In Windows non resta
# acceso niente: nessun processo fisso, nessuna icona.
#
# Il protocollo è quello dei «native messaging host» di Chrome: su stdin 4 byte
# (la lunghezza, little-endian) e un JSON in UTF-8; la risposta allo stesso modo
# su stdout. Tre domande, nient'altro:
#   {t:"ping"}                                  → la versione
#   {t:"stampanti"}                             → le stampanti installate e la predefinita
#   {t:"stampa", pdf, stampante, tipo, ruota}   → quel PDF su QUELLA stampante, senza dialogo
# e per la stampa un esito, detto onestamente:
#   ok:true,  esito "stampato"     il foglio è uscito dalla coda di Windows
#   ok:true,  esito "mandato"      è nella coda di Windows, e lì è rimasto
#   ok:false, esito "fallito"      non è uscito niente (stampante spenta o sparita, PDF rotto…)
#   ok:false, esito "sconosciuto"  SumatraPDF è partito e non ha finito: può essere uscito
# Tutto entro 35 secondi dall'avvio (l'estensione ne aspetta 90). Non usa la
# rete, non esegue altro che SumatraPDF.exe di questa cartella, e annota solo in
# %LOCALAPPDATA%\PSAssist\stampa.log (mai il contenuto, mai nomi).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # stdout è di Chrome: niente barre, niente testo
$INIZIO = Get-Date
$VERSIONE = '2'
$MAX_MESSAGGIO = 40MB    # il PDF in base64 e poco altro
$MAX_PDF = 25MB
$TETTO_S = 35            # tutto il lavoro di una stampa; con l'avvio di PowerShell, sotto i 40
$CODA_S = 4              # dopo SumatraPDF, quanto si guarda la coda di Windows
$SUMATRA = Join-Path $PSScriptRoot 'SumatraPDF.exe'
$base = $env:LOCALAPPDATA
if (-not $base) { $base = [IO.Path]::GetTempPath() }
$LOG = Join-Path (Join-Path $base 'PSAssist') 'stampa.log'
$TEMP = [IO.Path]::GetTempPath()
$partito = $false        # SumatraPDF è partito: da qui in poi un guaio non è più «non è uscito niente»

function Annota([string]$riga) {
  try {
    $dir = Split-Path $LOG
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir }
    if ((Test-Path -LiteralPath $LOG) -and (Get-Item -LiteralPath $LOG).Length -gt 256KB) { Move-Item -LiteralPath $LOG "$LOG.1" -Force }
    Add-Content -LiteralPath $LOG -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $riga) -Encoding UTF8
  } catch { }   # un registro che non si scrive non ferma la stampa
}

# Un esito che non è «stampato»: il motivo per il medico, e che cosa vuol dire.
function Esito([string]$esito, [string]$why) {
  $e = New-Object Exception $why
  $e.Data['esito'] = $esito
  throw $e
}

# Esattamente n byte: stdin arriva a pezzi.
function Leggi([IO.Stream]$s, [int]$n) {
  $buf = New-Object byte[] $n
  $letti = 0
  while ($letti -lt $n) {
    $k = $s.Read($buf, $letti, $n - $letti)
    if ($k -le 0) { throw 'messaggio troncato' }
    $letti += $k
  }
  , $buf
}

function Rispondi($obj) {
  $b = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 3))
  $out = [Console]::OpenStandardOutput()
  $out.Write([BitConverter]::GetBytes([int32]$b.Length), 0, 4)
  $out.Write($b, 0, $b.Length)
  $out.Flush()
}

# Le stampanti di questo utente, con la predefinita di Windows. Solo per la
# pagina delle impostazioni: per stampare se ne guarda una sola (Pronta).
function Stampanti {
  $tutte = @()
  try { $tutte = @(Get-CimInstance -ClassName Win32_Printer -OperationTimeoutSec 20 | ForEach-Object { [pscustomobject]@{ nome = [string]$_.Name; predefinita = [bool]$_.Default } }) } catch { }
  if (-not $tutte.Count) {
    try { $tutte = @(Get-Printer | ForEach-Object { [pscustomobject]@{ nome = [string]$_.Name; predefinita = $false } }) } catch { }
  }
  $tutte | Select-Object -First 100   # la risposta a Chrome non può superare 1 MB
}

# La stampante di questo foglio: c'è, col nome esatto che le dà Windows, ed è
# accesa? Se c'è lo dice lo spooler (InstalledPrinters, niente WMI); se è
# accesa, una domanda a Windows per QUELLA stampante — mai l'elenco intero,
# che con le code di un server di stampa costava secondi a ogni foglio.
function Pronta([string]$nome) {
  # un nome con le virgolette, o che finisce con «\», romperebbe la riga di comando di SumatraPDF
  if (-not $nome -or $nome.Contains('"') -or $nome.EndsWith('\')) { Esito 'fallito' ('il nome della stampante «{0}» non si può usare: scegline un''altra nelle impostazioni' -f $nome) }
  $tutte = $null
  try {
    Add-Type -AssemblyName System.Drawing
    $tipo = 'System.Drawing.Printing.PrinterSettings' -as [type]
    if ($tipo) { $tutte = @($tipo::InstalledPrinters) }
  } catch { }
  if ($tutte) {
    $vero = $tutte | Where-Object { $_ -eq $nome } | Select-Object -First 1
    if (-not $vero) { Esito 'fallito' ('la stampante «{0}» non c''è su questo PC' -f $nome) }
    $nome = [string]$vero
  }
  $wql = $nome.Replace('\', '\\').Replace("'", "\'")
  try { $p = @(Get-CimInstance -ClassName Win32_Printer -Filter "Name='$wql'" -OperationTimeoutSec 5) | Select-Object -First 1 }
  catch { return $nome }   # Windows non risponde: una stampante spenta la dice la coda, dopo
  if (-not $p) {
    if ($tutte) { return $nome }
    Esito 'fallito' ('la stampante «{0}» non c''è su questo PC' -f $nome)
  }
  if ($p.WorkOffline -or $p.PrinterStatus -eq 7) { Esito 'fallito' ('la stampante «{0}» risulta spenta o offline' -f $nome) }
  $nome
}

# La misura della prima pagina (la prima MediaBox del file), per il registro e
# per la pagina di prova: dice se l'etichetta è più larga che alta. Nessun contenuto.
function Misura([byte[]]$byte) {
  $testa = [Text.Encoding]::ASCII.GetString($byte, 0, [Math]::Min($byte.Length, 256KB))
  $m = [regex]::Match($testa, '/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]')
  if (-not $m.Success) { return $null }
  $v = 1..4 | ForEach-Object { [double]::Parse($m.Groups[$_].Value, [Globalization.CultureInfo]::InvariantCulture) }
  , @([math]::Round($v[2] - $v[0]), [math]::Round($v[3] - $v[1]))
}

# Il foglio è nella coda di Windows (SumatraPDF lo chiama col percorso del
# file). Uscito dalla coda: stampato. Fermo in errore, offline o in pausa: lo si
# toglie, e non è uscito niente. Ancora lì quando il tempo finisce: mandato, e basta.
function Coda([string]$nome, [string]$file, [datetime]$fino) {
  $chiave = [IO.Path]::GetFileNameWithoutExtension($file)
  do {
    try { $miei = @(Get-PrintJob -PrinterName $nome | Where-Object { [string]$_.DocumentName -like "*$chiave*" }) }
    catch { return 'mandato' }   # la coda non si lascia leggere: di più non si sa
    if (-not @($miei | Where-Object { [string]$_.JobStatus -notmatch 'Printed|Complete' }).Count) { return 'stampato' }
    if ($miei | Where-Object { [string]$_.JobStatus -match 'Error|Offline|Paused' }) {
      $tolto = $true
      foreach ($j in $miei) { try { Remove-PrintJob -InputObject $j } catch { $tolto = $false } }
      if ($tolto) { Esito 'fallito' ('la stampante «{0}» risulta spenta o offline: il foglio è stato tolto dalla coda' -f $nome) }
      Esito 'sconosciuto' ('la stampante «{0}» risulta spenta o offline, e il foglio non si toglie dalla coda: può uscire quando torna accesa' -f $nome)
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $fino)
  'mandato'
}

function Stampa($d, [string]$pdf64) {
  if ($d.tipo -ne 'etichette' -and $d.tipo -ne 'a4') { Esito 'fallito' 'tipo di foglio sconosciuto' }
  try { $byte = [Convert]::FromBase64String($pdf64) } catch { Esito 'fallito' 'il PDF non è leggibile' }
  if ($byte.Length -gt $MAX_PDF) { Esito 'fallito' 'il PDF è troppo grande' }
  if ($byte.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($byte, 0, 5) -ne '%PDF-') { Esito 'fallito' 'non è un PDF' }
  $nome = Pronta ([string]$d.stampante)
  if (-not (Test-Path -LiteralPath $SUMATRA)) { Esito 'fallito' 'manca SumatraPDF.exe nella cartella della stampa automatica: rilancia installa.cmd' }
  # Le etichette alla loro misura vera; il resto adattato al foglio. SumatraPDF
  # gira di 90° ogni pagina più larga che alta: con i driver delle
  # etichettatrici (Zebra, TSC, Citizen) l'etichetta uscirebbe di traverso, e
  # per loro la rotazione è spenta («ruota: no», dalle impostazioni).
  $opzioni = if ($d.tipo -ne 'etichette') { 'fit' } elseif ($d.ruota -eq 'no') { 'noscale,disable-auto-rotation' } else { 'noscale' }
  $file = Join-Path $TEMP ('psassist-{0}.pdf' -f [guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllBytes($file, $byte)
  try {
    $attesa = [math]::Max(5, [math]::Floor($TETTO_S - $CODA_S - ((Get-Date) - $INIZIO).TotalSeconds))
    $si = New-Object Diagnostics.ProcessStartInfo
    $si.FileName = $SUMATRA
    $si.Arguments = '-print-to "{0}" -print-settings "{1}" -silent "{2}"' -f $nome, $opzioni, $file
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    # stdin e stdout sono il filo con Chrome: SumatraPDF ha i suoi
    $si.RedirectStandardInput = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($si)   # (bloccato da una regola: non è partito, non è uscito niente)
    $script:partito = $true
    $null = $p.StandardOutput.ReadToEndAsync()
    $null = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($attesa * 1000)) {
      try { $p.Kill() } catch { }
      Esito 'sconosciuto' ('SumatraPDF non ha finito in {0} secondi: il foglio può essere uscito lo stesso' -f $attesa)
    }
    # SumatraPDF 3.6.1 esce col numero dei file che non ha stampato: 1, qui.
    # Un foglio che non riesce a stampare lo toglie dalla coda: non è uscito niente.
    if ($p.ExitCode -ne 0) { Esito 'fallito' ('SumatraPDF non è riuscito a stampare il foglio{0}' -f $(if ($p.ExitCode -ne 1) { " (codice $($p.ExitCode))" } else { '' })) }
    $esito = Coda $nome $file ((Get-Date).AddSeconds($CODA_S))
  } finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  [pscustomobject]@{ esito = $esito; stampante = $nome; pagina = (Misura $byte); opzioni = $opzioni }
}

$d = $null
try {
  # I fogli di una stampa interrotta (il PC spento a metà, la sessione chiusa)
  # non restano nella cartella temporanea: a ogni avvio via quelli di più di 10 minuti.
  Get-ChildItem -LiteralPath $TEMP -Filter 'psassist-*.pdf' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  $in = [Console]::OpenStandardInput()
  $n = [BitConverter]::ToInt32((Leggi $in 4), 0)
  if ($n -le 0 -or $n -gt $MAX_MESSAGGIO) { throw 'messaggio di lunghezza impossibile' }
  $testo = [Text.Encoding]::UTF8.GetString((Leggi $in $n))
  # Il PDF (base64: mai virgolette dentro) si stacca prima di leggere il JSON:
  # il resto è piccolo, e ConvertFrom-Json non deve masticare megabyte.
  $pdf64 = ''
  $m = [regex]::Match($testo, '"pdf"\s*:\s*"([A-Za-z0-9+/=]*)"')
  if ($m.Success) {
    $pdf64 = $m.Groups[1].Value
    $testo = $testo.Remove($m.Groups[1].Index, $m.Groups[1].Length)
  }
  $d = $testo | ConvertFrom-Json
  switch ([string]$d.t) {
    'ping' { Rispondi @{ ok = $true; versione = $VERSIONE } }
    'stampanti' {
      $tutte = @(Stampanti)
      $pred = $tutte | Where-Object { $_.predefinita } | Select-Object -First 1
      Rispondi @{ ok = $true; stampanti = @($tutte | ForEach-Object { $_.nome }); predefinita = [string]$pred.nome }
    }
    'stampa' {
      $r = Stampa $d $pdf64
      $mm = if ($r.pagina) { '{0}x{1} mm' -f [math]::Round($r.pagina[0] * 25.4 / 72), [math]::Round($r.pagina[1] * 25.4 / 72) } else { 'misura ?' }
      Annota ('stampa {0} -> {1}: {2} ({3} KB, {4:0.0} s, {5}, {6})' -f $d.tipo, $r.stampante, $r.esito, [math]::Round($pdf64.Length * 3 / 4 / 1KB), ((Get-Date) - $INIZIO).TotalSeconds, $mm, $r.opzioni)
      Rispondi @{ ok = $true; esito = $r.esito; stampante = $r.stampante; pagina = $r.pagina }
    }
    default { throw 'domanda sconosciuta' }
  }
} catch {
  $why = [string]$_.Exception.Message
  # un guaio non previsto dopo la partenza di SumatraPDF: il foglio può essere uscito
  $esito = [string]$_.Exception.Data['esito']
  if (-not $esito) { $esito = if ($partito) { 'sconosciuto' } else { 'fallito' } }
  Annota ('{0} {1}: {2} - {3}' -f $(if ($d) { $d.t } else { '?' }), $(if ($d) { $d.tipo } else { '' }), $esito, $why)
  Rispondi @{ ok = $false; esito = $esito; why = $why }
}
