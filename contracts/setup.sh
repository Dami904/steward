#!/usr/bin/env bash
# Fetches contracts/lib/ dependencies. Not tracked as git submodules because this repo had
# zero commits when Phase 2 started (forge install's `git submodule add` requires a valid
# HEAD to compute relative paths, and fails with "Library directory is not relative to the
# repository root" otherwise) — plain clones into a gitignored lib/ avoid that entirely, at
# the cost of pinning by tag here instead of via .gitmodules. Re-run any time lib/ is empty
# (fresh clone, or after `git clean`).
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p lib
if [ ! -d lib/forge-std/.git ]; then
  git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
fi
if [ ! -d lib/openzeppelin-contracts/.git ]; then
  git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
fi
echo "contracts/lib/ ready."
