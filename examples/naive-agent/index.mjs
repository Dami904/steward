#!/usr/bin/env node
// Reference agent: fetches a live health snapshot (read-only, no key) and prints a
// DEPOSIT/DECLINE decision. Usage:
//   node examples/naive-agent/index.mjs [--threshold-sec N] [--rpc-url URL]
// Default threshold: 259200s (3 days) — a reasonable "I need my money back within a few
// days" assumption for a naive agent with no explicit mandate; a real agent would set this
// from its own owner's requirements, not this default.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide } from "./decide.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const thresholdSec = Number(argValue("--threshold-sec", "259200"));
const rpcUrl = argValue("--rpc-url", undefined);

const scriptArgs = ["--experimental-strip-types", join(repoRoot, "scripts", "live-health-snapshot.ts")];
if (rpcUrl !== undefined) scriptArgs.push("--rpc-url", rpcUrl);

const raw = execFileSync("node", scriptArgs, { encoding: "utf8", cwd: repoRoot });
const snapshot = JSON.parse(raw);

const result = decide(snapshot, thresholdSec);
console.log(`[naive-agent] ${result.action}: ${result.reason}`);
process.exit(result.action === "DEPOSIT" ? 0 : 1);
