<#
.SYNOPSIS
Downloads a verified copy of Jern's production SQLite database from Railway.

.DESCRIPTION
Railway's Hobby plan cannot create volume backups, so this script makes one on
your computer. It copies the database in memory inside the running backend with
SQLite's backup API (safe while the app is writing), streams it over
`railway ssh` as compressed base64, and checks the SHA-256 fingerprint,
`PRAGMA integrity_check` and the migration version before keeping the file.
Nothing is written to the Railway volume.

Requires the Railway CLI, `railway login`, `railway link` to the W-Tracker
project, an SSH key registered with `railway ssh keys add`, and Python locally.
If ~/.ssh/id_ed25519_railway exists it is used; otherwise Railway picks a key
from ~/.ssh. A key with a passphrase asks for it on each run.

The backup contains every account's training data. It is saved outside the
repository by default so it cannot be committed or copied into a Docker image.

.EXAMPLE
.\scripts\backup-railway.ps1
.\scripts\backup-railway.ps1 -OutDir D:\Backups\Jern
.\scripts\backup-railway.ps1 -IdentityFile $env:USERPROFILE\.ssh\other_key
#>
param(
    [string]$Service = 'Backend',
    [string]$OutDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Jern backups'),
    # Private key for `railway ssh`. Defaults to a dedicated Railway key when present.
    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_railway')
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$name, [string]$hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' was not found. $hint" }
}
Require-Command 'railway' 'Install it with: npm i -g @railway/cli'
Require-Command 'python' 'Install Python 3 to verify the downloaded database.'

# Runs inside the backend container. It is sent base64-encoded so no shell or
# PowerShell quoting can change it on the way.
$remote = @'
import base64, gzip, hashlib, os, sqlite3, sys
url = os.environ.get("DATABASE_URL", "sqlite:////data/workout_tracker.db")
if not url.startswith("sqlite:///"):
    sys.exit("DATABASE_URL is not a SQLite file: " + url.split(":", 1)[0])
path = url[len("sqlite:///"):]
if not os.path.exists(path):
    sys.exit("Database not found at " + path)
source = sqlite3.connect(path)
copy = sqlite3.connect(":memory:")
source.backup(copy)
source.close()
data = copy.serialize()
copy.close()
print("JERN-BACKUP-BEGIN", hashlib.sha256(data).hexdigest(), len(data))
encoded = base64.b64encode(gzip.compress(data)).decode()
for start in range(0, len(encoded), 76):
    print(encoded[start:start + 76])
print("JERN-BACKUP-END")
'@
$program = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote.Replace("`r`n", "`n")))

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$target = Join-Path $OutDir "workout_tracker-$stamp.db"
$transfer = Join-Path $OutDir ".transfer-$stamp.txt"

$identity = ''
if ($PSBoundParameters.ContainsKey('IdentityFile') -and -not (Test-Path -LiteralPath $IdentityFile)) {
    throw "SSH key not found: $IdentityFile"
}
if (Test-Path -LiteralPath $IdentityFile) { $identity = " --identity-file `"$IdentityFile`"" }

Write-Host "Copying the database from Railway service '$Service'..." -ForegroundColor Cyan
# cmd writes the stream to disk byte for byte; PowerShell 5.1 redirection would
# re-encode it as UTF-16. A passphrase prompt still appears in the console.
cmd /c "railway ssh --service `"$Service`"$identity `"echo $program | base64 -d | python3 -`" > `"$transfer`""
if ($LASTEXITCODE -ne 0) {
    $detail = if (Test-Path $transfer) { (Get-Content -Raw $transfer) } else { '' }
    Remove-Item $transfer -ErrorAction SilentlyContinue
    if ($detail -match 'no_ssh_key') {
        $railwayKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519_railway'
        throw "Railway received no usable SSH key. If ssh asked for a passphrase, that key is protected: type its passphrase, or create a separate key for Railway with: ssh-keygen -t ed25519 -f `"$railwayKey`" -C railway-jern, then: railway ssh keys add -k `"$railwayKey.pub`""
    }
    throw "railway ssh failed (exit $LASTEXITCODE). Check 'railway status' and 'railway ssh keys list'. $detail"
}

try {
    $text = [IO.File]::ReadAllText($transfer)
    $match = [regex]::Match($text, 'JERN-BACKUP-BEGIN ([0-9a-f]{64}) (\d+)\s+([A-Za-z0-9+/=\s]+?)\s*JERN-BACKUP-END')
    if (-not $match.Success) { throw "The backup stream was incomplete or not recognised:`n$($text.Substring(0, [Math]::Min(500, $text.Length)))" }
    $expectedHash, $expectedLength = $match.Groups[1].Value, [long]$match.Groups[2].Value
    $compressed = [Convert]::FromBase64String(($match.Groups[3].Value -replace '\s', ''))

    $compressedStream = New-Object IO.MemoryStream(, $compressed)
    $gzip = New-Object IO.Compression.GZipStream($compressedStream, [IO.Compression.CompressionMode]::Decompress)
    $output = New-Object IO.MemoryStream
    $gzip.CopyTo($output); $gzip.Dispose()
    $bytes = $output.ToArray()

    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    if ($bytes.Length -ne $expectedLength -or $hash -ne $expectedHash) {
        throw "The downloaded copy does not match the server's fingerprint. Run the script again."
    }
    [IO.File]::WriteAllBytes($target, $bytes)
} finally {
    Remove-Item $transfer -ErrorAction SilentlyContinue
}

$check = @'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
try:
    status = db.execute("pragma integrity_check").fetchone()[0]
except sqlite3.DatabaseError as error:
    status = str(error)
if status != "ok":
    print(status)
    sys.exit(1)
tables = {row[0] for row in db.execute("select name from sqlite_master where type = 'table'")}
version = db.execute("select version_num from alembic_version").fetchone() if "alembic_version" in tables else None
workouts = db.execute("select count(*) from workouts").fetchone()[0] if "workouts" in tables else 0
print("ok", version[0] if version else "none", workouts)
'@
$result = $check | python -I - $target
if ($LASTEXITCODE -ne 0) {
    Remove-Item $target -ErrorAction SilentlyContinue
    throw "The downloaded database failed SQLite's integrity check: $result"
}
$status, $version, $workouts = "$result".Trim() -split ' '
if ($version -eq 'none') { $version = 'none recorded' }
$size = '{0:N1} MB' -f ($bytes.Length / 1MB)
Write-Host "Backup saved and verified: $target" -ForegroundColor Green
Write-Host "  Size $size, migration $version, $workouts workouts, SHA-256 $hash"
Write-Host "  It contains every account's data. Keep it private."
