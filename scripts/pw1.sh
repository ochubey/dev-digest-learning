#!/usr/bin/env bash
#
# DevDigest production-mode run — build the client, start server + client
# against their `start` scripts (not the dev watchers).
#
#   ./scripts/pw1.sh              # full: docker → migrate → build client → start server + client
#   ./scripts/pw1.sh --no-seed    # skip the demo seed
#   ./scripts/pw1.sh --skip-build # reuse an existing client/.next build
#
# Server's `start` runs via tsx (src/server.ts directly) — its `tsc` build
# output lands nested (dist/server/src/server.js, not dist/server.js) because
# reviewer-core's raw source is compiled in via a tsconfig path alias rather
# than a separate package build, so `rootDir` can't be set to "src". Running
# via tsx sidesteps that (and the repo's extensionless-relative-import style,
# which plain `node --experimental-modules` doesn't resolve) the same way
# `dev`/`db:migrate`/`db:seed` already do.
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops server + client and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)    RUN_SEED=0 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres ----------------------------------------------------------------
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) log "Postgres container already running — reusing it" ;;
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
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed ----------------------------------------------------------
log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

# --- build client --------------------------------------------------------
# Server's `start` runs source directly via tsx — no build step needed there.
# The client's `start` (next start) requires a real `next build` first.
if [ "$SKIP_BUILD" -eq 1 ]; then
  log "skipping client build (--skip-build) — reusing existing client/.next"
else
  log "building client (next build)"
  (cd client && pnpm build)
fi

# --- run ----------------------------------------------------------------
SERVER_PID=""
cleanup() {
  log "shutting down server + client (Postgres stays up; stop it with: docker compose down)"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "starting API on :3001 (server, pnpm start)"
(cd server && pnpm start) &
SERVER_PID=$!

log "starting web on :3000 (client, pnpm start) — Ctrl-C to stop both"
(cd client && pnpm start)
