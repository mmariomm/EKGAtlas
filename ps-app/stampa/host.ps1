# PS Assist — stampa automatica: l'aiutante che Chrome (o Edge) avvia per UNA
# domanda dell'estensione, e che esce appena ha risposto. In Windows non resta
# acceso niente: nessun processo fisso, nessuna icona.
#
# Il protocollo è quello dei «native messaging host» di Chrome: su stdin 4 byte
# (la lunghezza, little-endian) e un JSON in UTF-8; la risposta allo stesso modo
# su stdout. Tre domande, nient'altro:
#   {t:"ping"}                              → la versione
#   {t:"stampanti"}                         → le stampanti installate e la predefinita
#   {t:"stampa", pdf, stampante, tipo}      → quel PDF su QUELLA stampante, senza dialogo
# Non usa la rete, non esegue altro che SumatraPDF.exe di questa cartella, e
# annota solo in %LOCALAPPDATA%\PSAssist\stampa.log (mai il contenuto, mai nomi).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # stdout è di Chrome: niente barre, niente testo
$VERSIONE = '1'
$MAX_MESSAGGIO = 40MB    # il PDF in base64 e poco altro
$MAX_PDF = 25MB
$ATTESA_S = 60           # SumatraPDF che non finisce: si ferma, e lo si dice
$SUMATRA = Join-Path $PSScriptRoot 'SumatraPDF.exe'
$base = $env:LOCALAPPDATA
if (-not $base) { $base = [IO.Path]::GetTempPath() }
$LOG = Join-Path (Join-Path $base 'PSAssist') 'stampa.log'
# i codici d'uscita di SumatraPDF con -print-to
$PERCHE = @{
  2 = 'SumatraPDF non riesce ad aprire il PDF'
  3 = 'il PDF non permette la stampa'
  4 = 'la stampante non esiste'
  5 = 'la stampante (o il suo driver) ha dato errore'
  6 = 'la stampa è vietata da una regola di questo PC'
}

function Annota([string]$riga) {
  try {
    $dir = Split-Path $LOG
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir }
    if ((Test-Path -LiteralPath $LOG) -and (Get-Item -LiteralPath $LOG).Length -gt 256KB) { Move-Item -LiteralPath $LOG "$LOG.1" -Force }
    Add-Content -LiteralPath $LOG -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $riga) -Encoding UTF8
  } catch { }   # un registro che non si scrive non ferma la stampa
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

# Le stampanti di questo utente, con la predefinita di Windows.
function Stampanti {
  $tutte = @()
  try { $tutte = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object { [pscustomobject]@{ nome = [string]$_.Name; predefinita = [bool]$_.Default } }) } catch { }
  if (-not $tutte.Count) {
    try { $tutte = @(Get-Printer | ForEach-Object { [pscustomobject]@{ nome = [string]$_.Name; predefinita = $false } }) } catch { }
  }
  $tutte | Select-Object -First 100   # la risposta a Chrome non può superare 1 MB
}

function Stampa($d, [string]$pdf64) {
  if ($d.tipo -ne 'etichette' -and $d.tipo -ne 'a4') { throw 'tipo di foglio sconosciuto' }
  try { $byte = [Convert]::FromBase64String($pdf64) } catch { throw 'il PDF non è leggibile' }
  if ($byte.Length -gt $MAX_PDF) { throw 'il PDF è troppo grande' }
  if ($byte.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($byte, 0, 5) -ne '%PDF-') { throw 'non è un PDF' }
  # solo una stampante che c'è davvero, col nome esatto che le dà Windows
  $nome = (Stampanti | Where-Object { $_.nome -eq [string]$d.stampante } | Select-Object -First 1).nome
  if (-not $nome -or $nome.Contains('"')) { throw ('la stampante «{0}» non c''è su questo PC' -f $d.stampante) }
  if (-not (Test-Path -LiteralPath $SUMATRA)) { throw 'manca SumatraPDF.exe nella cartella della stampa automatica: rilancia installa.cmd' }
  $file = Join-Path ([IO.Path]::GetTempPath()) ('psassist-{0}.pdf' -f [guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllBytes($file, $byte)
  try {
    # etichette alla loro misura vera; il resto adattato al foglio
    $misura = if ($d.tipo -eq 'etichette') { 'noscale' } else { 'fit' }
    $si = New-Object Diagnostics.ProcessStartInfo
    $si.FileName = $SUMATRA
    $si.Arguments = '-print-to "{0}" -print-settings {1} -silent "{2}"' -f $nome, $misura, $file
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    # stdin e stdout sono il filo con Chrome: SumatraPDF ha i suoi
    $si.RedirectStandardInput = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($si)
    $null = $p.StandardOutput.ReadToEndAsync()
    $null = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($ATTESA_S * 1000)) {
      try { $p.Kill() } catch { }
      throw ('SumatraPDF non ha finito in {0} secondi' -f $ATTESA_S)
    }
    if ($p.ExitCode -ne 0) {
      $why = $PERCHE[$p.ExitCode]
      if (-not $why) { $why = 'SumatraPDF ha risposto con il codice {0}' -f $p.ExitCode }
      throw $why
    }
  } finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  $nome
}

$d = $null
try {
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
      $t0 = Get-Date
      $nome = Stampa $d $pdf64
      Annota ('stampa {0} -> {1}: ok ({2} KB, {3:0.0} s)' -f $d.tipo, $nome, [math]::Round($pdf64.Length * 3 / 4 / 1KB), ((Get-Date) - $t0).TotalSeconds)
      Rispondi @{ ok = $true; stampante = $nome }
    }
    default { throw 'domanda sconosciuta' }
  }
} catch {
  $why = [string]$_.Exception.Message
  Annota ('{0} {1}: non riuscita - {2}' -f $(if ($d) { $d.t } else { '?' }), $(if ($d) { $d.tipo } else { '' }), $why)
  Rispondi @{ ok = $false; why = $why }
}
