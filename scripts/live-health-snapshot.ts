// Builds one real HealthSnapshot from the live IXS vault on BSC mainnet, using the
// REQUEST_FINALIZE_VIEW method (spec/health.md section 2). Read-only: every call below is a
// `cast call`/`cast implementation`/`cast codehash` view read, nothing is broadcast, no key or
// funded wallet is involved. Named with the `live:` prefix (CLAUDE.md engineering rules) since
// it talks to mainnet over network — kept out of `pnpm test`/CI's default job, same treatment
// as contracts/test/fork/*.t.sol.
//
// Usage: node --experimental-strip-types scripts/live-health-snapshot.ts [--rpc-url URL]
// Defaults to the public endpoint in .env.example if BSC_RPC_URL is unset and --rpc-url is
// not passed — that endpoint is not a secret (see docs/API_NOTES.md).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildRequestFinalizeSnapshot } from "../packages/engine/src/health.ts";
import type { RedeemRequestRecord } from "../packages/engine/src/types.ts";

const VAULT = "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82";
const DEFAULT_RPC_URL = "https://bsc-rpc.publicnode.com";
const EXPECTED_CODEHASH = "0x7bea564b7ac5d41acabc7bacfb4a1f2ebdee868cbd8d0ae33f6ed9173472187a"; // Phase 0/2, spec/DECISIONS.md

function argRpcUrl(): string | undefined {
  const idx = process.argv.indexOf("--rpc-url");
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
const RPC_URL = argRpcUrl() ?? process.env.BSC_RPC_URL ?? DEFAULT_RPC_URL;

const CAST_TIMEOUT_MS = 15_000; // docs/API_NOTES.md: cast's own timeout/retry behavior against
                                 // a hung RPC is unmeasured — bound the subprocess ourselves
                                 // rather than let a bad endpoint hang this script forever.

function castCall(sig: string, ...args: string[]): string[] {
  const out = execFileSync("cast", ["call", VAULT, sig, ...args, "--rpc-url", RPC_URL], { encoding: "utf8", timeout: CAST_TIMEOUT_MS });
  return out
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((v): v is string => v !== undefined);
}

const STATUS_NAMES = ["None", "Pending", "Finalized", "Rejected"] as const;

function fetchRedeemRequest(id: number): RedeemRequestRecord {
  const fields = castCall(
    "redeemRequests(uint256)(address,address,uint256,uint256,uint256,uint256,uint256,uint8)",
    String(id),
  );
  const [owner, receiver, shares, , , requestedAt, processedAt, status] = fields;
  if (owner === undefined || receiver === undefined || shares === undefined || requestedAt === undefined || processedAt === undefined || status === undefined) {
    throw new Error(`redeemRequests(${id}): unexpected cast output shape: ${JSON.stringify(fields)}`);
  }
  const statusIdx = Number(status);
  const statusName = STATUS_NAMES[statusIdx];
  if (statusName === undefined) throw new Error(`redeemRequests(${id}): unrecognized status ${status}`);
  return {
    id,
    owner,
    receiver,
    shares: BigInt(shares),
    requestedAt: Number(requestedAt),
    processedAt: Number(processedAt),
    status: statusName,
  };
}

function main(): void {
  const [nextIdRaw] = castCall("nextRedeemRequestId()(uint256)");
  const [totalAssetsRaw] = castCall("totalAssets()(uint256)");
  const [totalSupplyRaw] = castCall("totalSupply()(uint256)");
  const [pausedRaw] = castCall("paused()(bool)");
  if (nextIdRaw === undefined || totalAssetsRaw === undefined || totalSupplyRaw === undefined || pausedRaw === undefined) {
    throw new Error("unexpected empty cast output for a base vault read");
  }

  const nextId = Number(nextIdRaw);
  const totalAssets = BigInt(totalAssetsRaw);
  const totalSupply = BigInt(totalSupplyRaw);
  const paused = pausedRaw === "true";

  const implOut = execFileSync("cast", ["implementation", VAULT, "--rpc-url", RPC_URL], { encoding: "utf8", timeout: CAST_TIMEOUT_MS }).trim();
  const codehashOut = execFileSync("cast", ["codehash", implOut, "--rpc-url", RPC_URL], { encoding: "utf8", timeout: CAST_TIMEOUT_MS }).trim();

  const records: RedeemRequestRecord[] = [];
  for (let id = 1; id < nextId; id++) records.push(fetchRedeemRequest(id));

  // navPerShare, 18-decimal fixed point: spec/accounting.md section 2 note — the vault has no
  // literal pricePerShare() getter; derive from totalAssets/totalSupply (same figure Phase 0
  // read informally). Guard totalSupply == 0 (never observed live, but a fresh/empty vault
  // must not divide by zero here).
  const navPerShare = totalSupply === 0n ? 0n : (totalAssets * 10n ** 18n) / totalSupply;

  const atBlockOut = execFileSync("cast", ["block-number", "--rpc-url", RPC_URL], { encoding: "utf8", timeout: CAST_TIMEOUT_MS }).trim();
  const atBlock = Number(atBlockOut);
  const ts = Math.floor(Date.now() / 1000);

  const snapshot = buildRequestFinalizeSnapshot(
    records,
    atBlock,
    ts,
    navPerShare,
    0n, // drawdownBps: needs a high-water mark tracked over time, not derivable from one read — see docs/LIMITATIONS.md
    codehashOut,
    EXPECTED_CODEHASH,
    false, // navStale: this read is itself the freshness check; a caller consuming this snapshot judges staleness against its own ts
    paused,
  );

  const report = {
    fetchedAt: new Date(ts * 1000).toISOString(),
    rpcUrl: RPC_URL,
    vault: VAULT,
    implementation: implOut,
    atBlock,
    method: "REQUEST_FINALIZE_VIEW",
    n: snapshot.n,
    p50Sec: snapshot.p50Sec,
    p90Sec: snapshot.p90Sec,
    maxSec: snapshot.maxSec,
    navPerShare: navPerShare.toString(),
    totalAssets: totalAssets.toString(),
    totalSupply: totalSupply.toString(),
    paused,
    codehash: codehashOut,
    expectedCodehash: EXPECTED_CODEHASH,
    codehashMatches: codehashOut.toLowerCase() === EXPECTED_CODEHASH.toLowerCase(),
    evidenceHash: snapshot.evidenceHash,
    records: records.map((r) => ({ ...r, shares: r.shares.toString() })),
  };

  console.log(JSON.stringify(report, null, 2));

  const outPath = process.argv.includes("--write") ? "docs/measurement-report.json" : undefined;
  if (outPath !== undefined) {
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.error(`\nwrote ${outPath}`);
  }
}

main();
