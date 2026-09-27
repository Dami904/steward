// Phase 4 replay/verification: the concrete answer to "can this be independently checked."
// Not on a public block explorer (the zero-funds build runs on a fork, so there is no
// public chain to check against) — but fully reproducible by anyone who has this repo and
// the fork's state dump: reload the same state (scripts/fork-node.sh, no --fresh), run this
// script, and get the same result.
//
// Does two things a receipts list alone doesn't:
// 1. Confirms every recorded tx hash in .demo-state/receipts.json still resolves against the
//    current fork state (proves the --dump-state/--load-state round trip actually preserved
//    the history, not just that the numbers were written down once).
// 2. Independently recomputes the T0->T1 graduation predicate using
//    packages/engine/src/tiers.ts's checkPromotion — the SAME deterministic function that's
//    differential-tested against the Python and Solidity implementations throughout this
//    project (spec/accounting.md invariant P-08) — fed with the account's actual on-chain
//    TierState read at the block immediately before graduate() was called, and the real
//    block timestamp graduate() ran at. If the TS engine says "not eligible" here, that's a
//    real divergence between the deployed contract and the off-chain engine, not a formatting
//    detail — this is the check that would have caught it.
//
// Usage: node --experimental-strip-types scripts/replay-fork-demo.ts
// Requires: scripts/fork-node.sh running with the demo's state loaded (the default when NOT
// passed --fresh) and .demo-state/receipts.json from a prior scripts/demo-driver.ts run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkPromotion } from "../packages/engine/src/tiers.ts";
import type { TierState } from "../packages/engine/src/types.ts";

const RPC_URL = process.env["FORK_RPC_URL"] ?? "http://127.0.0.1:8546";

interface ReceiptEntry {
  step: string;
  txHash: string | null;
  status: string;
  blockNumber: number | null;
  timestampSec: number | null;
}
interface DemoState {
  addresses: { accountA: string; [k: string]: string };
  receipts: ReceiptEntry[];
}

const demoState: DemoState = JSON.parse(readFileSync(".demo-state/receipts.json", "utf8"));

function castCall(to: string, sig: string, args: string[] = [], block?: number): string[] {
  const extra = block !== undefined ? ["--block", String(block)] : [];
  const out = execFileSync("cast", ["call", to, sig, ...args, ...extra, "--rpc-url", RPC_URL], { encoding: "utf8" });
  return out.trim().split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((v): v is string => v !== undefined);
}

function main(): void {
  console.log("=== Step 1: confirming every recorded tx hash still resolves ===");
  let resolvedCount = 0;
  for (const r of demoState.receipts) {
    if (r.txHash === null) continue;
    const out = execFileSync("cast", ["receipt", r.txHash, "--rpc-url", RPC_URL, "--json"], { encoding: "utf8" });
    const receipt = JSON.parse(out);
    const ok = receipt.status === "0x1";
    console.log(`  [${r.step}] ${r.txHash} -> status=${receipt.status} block=${receipt.blockNumber} ${ok ? "OK" : "REVERTED"}`);
    resolvedCount++;
  }
  console.log(`${resolvedCount} tx hashes resolved against the current fork state.\n`);

  console.log("=== Step 2: independently recomputing the T0->T1 graduation predicate ===");
  const graduateReceipt = demoState.receipts.find((r) => r.step === "A_graduate");
  if (graduateReceipt?.blockNumber === null || graduateReceipt?.blockNumber === undefined || graduateReceipt.timestampSec === null) {
    throw new Error("no A_graduate receipt with a block number found in receipts.json");
  }

  const fields = castCall(
    demoState.addresses.accountA,
    "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)",
    [],
    graduateReceipt.blockNumber - 1, // state immediately BEFORE graduate() ran
  );
  const tierState: TierState = {
    tier: Number(fields[0]),
    tierEnteredAt: Number(fields[1]),
    riskAcc: BigInt(fields[2]!),
    peakExposure: BigInt(fields[3]!),
    receiptsSinceEntry: Number(fields[4]),
    incidentCount: Number(fields[5]),
    lastIncidentAt: Number(fields[6]),
    lastExposure: BigInt(fields[7]!),
    lastTs: Number(fields[8]),
    incidentsSinceEntry: Number(fields[9]),
  };
  console.log(`  On-chain TierState at block ${graduateReceipt.blockNumber - 1} (immediately before graduate()):`);
  console.log(`    tier=${tierState.tier} riskAcc=${tierState.riskAcc} peakExposure=${tierState.peakExposure} receiptsSinceEntry=${tierState.receiptsSinceEntry}`);

  const result = checkPromotion(tierState, graduateReceipt.timestampSec, 60, {
    paused: false,
    mandateExpired: false,
    evidenceStale: false,
  });
  console.log(`  packages/engine's checkPromotion (TS, same function covered by fixtures/differential/): eligible=${result.eligible}`);
  if (!result.eligible) {
    throw new Error(
      `MISMATCH: the off-chain engine says NOT eligible (failed: ${result.failedConditions.join(", ")}), ` +
      `but graduate() succeeded on-chain at tx ${graduateReceipt.txHash}. This would be a real divergence, not a formatting issue.`,
    );
  }

  console.log("\nConfirmed: the deployed contract's graduation and the off-chain policy engine agree.");
  console.log("This is what 'verifiable' means for a fork-only build — reproducible");
  console.log("by anyone with this repo and the fork's state dump, not checkable on a public explorer.");
}

main();
