#!/usr/bin/env bash
#
# DevDigest L06 verification — typecheck + hermetic tests for the eval pipeline.
# Needs no Docker, DB, network or model key. Never installs dependencies.
#
#   pnpm verify:l06        (from the repo root)
#   bash scripts/verify-l06.sh
#
# Exits 0 on success; on failure prints "verify:l06 FAILED at step: <name>" and
# exits with the failing command's exit code.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Hermetic: no provider keys, token or DB leak into the tests.
unset OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GITHUB_TOKEN DATABASE_URL

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

for pkg in server client reviewer-core; do
  if [ ! -d "$ROOT/$pkg/node_modules" ]; then
    err "$pkg/node_modules is missing — run pnpm install in $pkg"
    exit 1
  fi
done

# step "<name>" <cmd...> — run in the current dir (callers cd via subshell).
step() {
  local name="$1"; shift
  log "$name"
  local code=0
  "$@" || code=$?
  if [ "$code" -ne 0 ]; then
    err "verify:l06 FAILED at step: $name"
    exit "$code"
  fi
}

in_pkg() { local dir="$1"; shift; ( cd "$ROOT/$dir" && "$@" ); }

step "server typecheck"   in_pkg server pnpm typecheck
step "server unit"        in_pkg server pnpm exec vitest run --exclude '**/*.it.test.ts'
step "client typecheck"   in_pkg client pnpm typecheck
step "client test"        in_pkg client pnpm test
step "reviewer-core typecheck" in_pkg reviewer-core pnpm typecheck
step "reviewer-core test" in_pkg reviewer-core pnpm test
step "seed fixture"       in_pkg server pnpm exec vitest run test/eval-seed-fixture.test.ts
step "scorer purity"      in_pkg server pnpm exec vitest run test/eval-scoring.test.ts test/eval-scoring-purity.test.ts
step "experiment"         in_pkg server pnpm exec vitest run test/eval-experiment.test.ts

echo "verify:l06 OK"
