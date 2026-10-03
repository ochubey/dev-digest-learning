<#
DevDigest production-mode run (PowerShell) — build the client, start server +
client against their `start` scripts (not the dev watchers).

  .\scripts\pw1.ps1               # full: docker -> migrate -> build client -> start server + client
  .\scripts\pw1.ps1 -NoSeed       # skip the demo seed
  .\scripts\pw1.ps1 -SkipBuild    # reuse an existing client\.next build

Server's `start` runs via tsx (src/server.ts directly) — its `tsc` build
output lands nested (dist/server/src/server.js, not dist/server.js) because
reviewer-core's raw source is compiled in via a tsconfig path alias rather
than a separate package build, so `rootDir` can't be set to "src". Running
via tsx sidesteps that (and the repo's extensionless-relative-import style,
which plain `node` doesn't resolve) the same way `dev`/`db:migrate`/`db:seed`
already do.

Idempotent: re-running installs only what's missing, migrations and seed
both upsert. Ctrl-C stops server + client and leaves Postgres running.
#>

param(
  [switch]$NoSeed,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ROOT

$CONTAINER = "devdigest-postgres"

function Log($msg)  { Write-Host "▸ $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }

# --- prerequisites -----------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Error "docker not found"; exit 1 }
if (-not (Get-Command pnpm   -ErrorAction SilentlyContinue)) { Write-Error "pnpm not found (npm i -g pnpm)"; exit 1 }

# --- env files ---------------------------------------------------------------
foreach ($dir in @("server", "client")) {
  $envFile = Join-Path $dir ".env"
  $exampleFile = Join-Path $dir ".env.example"
  if (-not (Test-Path $envFile) -and (Test-Path $exampleFile)) {
    Copy-Item $exampleFile $envFile
    Warn "created $envFile from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  }
}

# --- Postgres ----------------------------------------------------------------
$state = try { docker inspect -f '{{.State.Status}}' $CONTAINER 2>$null } catch { $null }
if (-not $state) { $state = "missing" }

switch ($state) {
  "running" { Log "Postgres container already running — reusing it" }
  { $_ -in @("exited", "created") } { Log "starting existing Postgres container"; docker start $CONTAINER | Out-Null }
  default { Log "starting Postgres (docker compose up -d)"; docker compose up -d }
}

Log "waiting for Postgres to be healthy"
$status = "starting"
for ($i = 0; $i -lt 60; $i++) {
  $status = try { docker inspect -f '{{.State.Health.Status}}' $CONTAINER 2>$null } catch { "starting" }
  if ($status -eq "healthy") { break }
  Start-Sleep -Seconds 1
}
if ($status -ne "healthy") { Write-Error "Postgres did not become healthy in time"; exit 1 }
Log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
function Install-IfNeeded($dir) {
  if (-not (Test-Path (Join-Path $dir "node_modules"))) {
    Log "installing deps in $dir"
    Push-Location $dir; pnpm install; Pop-Location
  }
}
Install-IfNeeded "server"
Install-IfNeeded "client"
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
if (-not (Test-Path "reviewer-core\node_modules")) {
  Log "installing deps in reviewer-core"
  Push-Location "reviewer-core"; npm ci; Pop-Location
}

# --- migrate + seed ----------------------------------------------------------
Log "applying migrations"
Push-Location "server"; pnpm db:migrate; Pop-Location

if (-not $NoSeed) {
  Log "seeding demo data"
  Push-Location "server"; pnpm db:seed; Pop-Location
}

# --- build client --------------------------------------------------------
# Server's `start` runs source directly via tsx — no build step needed there.
# The client's `start` (next start) requires a real `next build` first.
if ($SkipBuild) {
  Log "skipping client build (-SkipBuild) — reusing existing client\.next"
} else {
  Log "building client (next build)"
  Push-Location "client"; pnpm build; Pop-Location
}

# --- run ----------------------------------------------------------------
# Server started via `cmd /c` in a separate process (not Start-Job) so output
# streams live to this console instead of being buffered until collected.
$serverProc = $null
try {
  Log "starting API on :3001 (server, pnpm start)"
  $serverProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "pnpm start" `
    -WorkingDirectory (Join-Path $ROOT "server") -NoNewWindow -PassThru

  Log "starting web on :3000 (client, pnpm start) — Ctrl-C to stop both"
  Push-Location "client"
  try { pnpm start } finally { Pop-Location }
}
finally {
  Log "shutting down server + client (Postgres stays up; stop it with: docker compose down)"
  if ($serverProc -and -not $serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  }
}
