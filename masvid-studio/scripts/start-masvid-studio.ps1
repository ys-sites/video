# Start Masvid Studio on this PC and open it in the browser.
#   powershell -ExecutionPolicy Bypass -File masvid-studio\scripts\start-masvid-studio.ps1
# Uses the shared projects folder (openmotion-data next to the repo) and port 4180.
param([int]$Port = 4180, [string]$DataDir = "")

$ErrorActionPreference = "Continue"
$studio = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $studio
if (-not $DataDir) { $DataDir = Join-Path (Split-Path -Parent $repo) "openmotion-data" }
$url = "http://localhost:$Port/"

function Test-Ping {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 2 } catch { return $null }
}

$ping = Test-Ping
if ($ping -and $ping.app -eq "masvid-studio") { Start-Process $url; exit 0 }
if ($ping) {
  Write-Host "Port $Port is used by another app ($($ping.app)). Close it, or run with -Port <other>." -ForegroundColor Yellow
  Read-Host "Press Enter to close"; exit 1
}

# Another studio already serving this projects folder (for example the original OpenMotion checkout)?
$previewFile = Join-Path $DataDir "preview.json"
if (Test-Path $previewFile) {
  try {
    $old = (Get-Content $previewFile -Raw | ConvertFrom-Json).port
    if ($old -and $old -ne $Port) {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$old/api/health" -TimeoutSec 2 -ErrorAction Stop
      if ($health) {
        Write-Host "Another studio is already using your projects on port $old." -ForegroundColor Yellow
        Write-Host "Close it first (only one studio can own the projects folder), then start Masvid Studio again."
        Read-Host "Press Enter to close"; exit 1
      }
    }
  } catch { }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js is not installed." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
if (-not (Test-Path (Join-Path $studio "node_modules"))) {
  Write-Host "Installing packages (first run)..."; Push-Location $studio; npm ci --ignore-scripts; Pop-Location
}
if (-not (Test-Path (Join-Path $studio "studio\build\index.html"))) {
  Write-Host "Building the studio (first run, about 2 minutes)..."; Push-Location $studio; npm run build:studio; Pop-Location
}

# Your skills and site styles into the studio's skill library (text files only).
$py = (Get-Command python -ErrorAction SilentlyContinue)
if ($py) { & python -I (Join-Path $repo "tools\sync_openmotion_skills.py") | Out-Null }

$env:PORT = "$Port"; $env:MOTION_DATA_DIR = $DataDir; $env:DO_NOT_TRACK = "1"; $env:OPENMOTION_TELEMETRY = "off"
Write-Host "Starting Masvid Studio..."
Push-Location $studio
& node --experimental-strip-types preview.ts | Out-Null
Pop-Location
for ($i = 0; $i -lt 30; $i++) { if (Test-Ping) { break }; Start-Sleep -Milliseconds 500 }
if (Test-Ping) { Start-Process $url; exit 0 }
Write-Host "Masvid Studio did not start. Log: $(Join-Path $DataDir 'preview.log')" -ForegroundColor Red
Read-Host "Press Enter to close"; exit 1
