<#
.SYNOPSIS
  Apply database migrations only (no seed, no servers).

.EXAMPLE
  .\scripts\migrate.ps1     # make sure Postgres is up, then run the migrations
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Container = "devdigest-postgres"

function Log($m) { Write-Host "> $m" -ForegroundColor Cyan }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker not found" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm not found (npm i -g pnpm)" }
if (-not (Test-Path "server/.env")) { throw "server/.env is missing: run .\scripts\dev.ps1 once to create it" }

$state = (docker inspect -f '{{.State.Status}}' $Container 2>$null)
if ($state -eq "running") { }
elseif ($state -eq "exited" -or $state -eq "created") { Log "starting existing Postgres container"; docker start $Container | Out-Null }
else { Log "starting Postgres (docker compose up -d)"; docker compose up -d }

Log "waiting for Postgres to be healthy"
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  $s = (docker inspect -f '{{.State.Health.Status}}' $Container 2>$null)
  if ($s -eq "healthy") { $healthy = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $healthy) { throw "Postgres did not become healthy in time" }

if (-not (Test-Path "server/node_modules")) { Log "installing deps in server"; Push-Location server; pnpm install; Pop-Location }
if (-not (Test-Path "reviewer-core/node_modules")) { Log "installing deps in reviewer-core"; Push-Location reviewer-core; npm ci; Pop-Location }

Log "applying migrations"
Push-Location server; pnpm db:migrate; Pop-Location
Log "migrations applied"
