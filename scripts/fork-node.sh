#!/usr/bin/env bash
# Launches a PERSISTENT Anvil fork of BSC mainnet for the Phase 4 demo — distinct from
# contracts/test/fork/*.t.sol's disposable per-test fork. This one stays up across multiple
# deployment/driver/replay script runs so on-chain (on-fork) state actually accumulates over
# time, the way a real deployment would, while never broadcasting anything to real BSC and
# never spending real funds. spec/DECISIONS.md's 2026-09-22 "Live deployment -> fork-only"
# decision is what this implements.
#
# State persistence: --dump-state writes the full EVM state to disk on clean shutdown
# (Ctrl-C); --load-state reloads it on the next start, so the demo's accumulated history
# (deployed contracts, graduation events, balances) survives restarts. Anyone can load the
# same dump and independently replay/verify what happened — see scripts/replay-fork-demo.ts.
#
# Usage: bash scripts/fork-node.sh [--fresh]
#   --fresh: ignore any existing state dump and start from a clean fork at the current pinned
#            block (use this exactly once, to start a new demo run).
set -euo pipefail
cd "$(dirname "$0")/.."

RPC_URL="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
PORT="${FORK_PORT:-8546}"
STATE_DIR=".fork-state"
STATE_FILE="$STATE_DIR/anvil-demo-state.json"
PINNED_BLOCK_FILE="$STATE_DIR/pinned-block.txt"

mkdir -p "$STATE_DIR"

LOAD_ARGS=()
if [[ "${1:-}" != "--fresh" && -f "$STATE_FILE" ]]; then
  echo "Loading existing fork state from $STATE_FILE"
  LOAD_ARGS=(--load-state "$STATE_FILE")
else
  # Pin a fresh block now and record it, so the demo's starting point is reproducible even
  # after the dump is loaded on a later run (anvil_dumpState doesn't itself record which
  # upstream block the fork started from in a way this script reads back out).
  PINNED_BLOCK="$(cast block-number --rpc-url "$RPC_URL")"
  echo "$PINNED_BLOCK" > "$PINNED_BLOCK_FILE"
  echo "Starting a fresh fork pinned at block $PINNED_BLOCK (recorded in $PINNED_BLOCK_FILE)"
  LOAD_ARGS=(--fork-block-number "$PINNED_BLOCK")
fi

echo "Anvil fork listening on http://127.0.0.1:$PORT (upstream: $RPC_URL)"
echo "Press Ctrl-C to stop and dump state to $STATE_FILE"

# --preserve-historical-states: without it the dump keeps only the latest state, so after a
# reload any read at an earlier block (scripts/replay-fork-demo.ts reads the TierState just
# before graduate()) fails. Found 2026-09-26, see docs/LIMITATIONS.md.
exec anvil \
  --fork-url "$RPC_URL" \
  --port "$PORT" \
  --dump-state "$STATE_FILE" \
  --preserve-historical-states \
  "${LOAD_ARGS[@]}"
