#!/usr/bin/env bash
#
# Apply database migrations only (no seed, no servers).
#
#   ./scripts/migrate.sh          # make sure Postgres is up, then run the migrations
#   pnpm db:migrate               # same, from the repo root
#
# Use it after `git pull` when a branch added a migration. Idempotent: already
# applied migrations are skipped. The full bootstrap (./scripts/dev.sh) runs the
# same step before seeding.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

[ -f server/.env ] || { echo "server/.env is missing: run ./scripts/dev.sh once to create it"; exit 1; }

# Same container handling as dev.sh: reuse a running one, start a stopped one, else compose up.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }

[ -d server/node_modules ] || { log "installing deps in server"; (cd server && pnpm install); }
# The migration runner loads server code that imports reviewer-core's raw source.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

log "applying migrations"
(cd server && pnpm db:migrate)
log "migrations applied"
