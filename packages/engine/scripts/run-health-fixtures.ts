import { readFileSync } from "node:fs";
import { buildRequestFinalizeSnapshot } from "../src/health.ts";
import type { RedeemRequestRecord } from "../src/types.ts";

const fixturesPath = process.argv[2];
if (fixturesPath === undefined) {
  throw new Error("usage: node run-health-fixtures.ts <fixtures.json>");
}
interface RawRecord {
  id: number; owner: string; receiver: string; shares: string;
  requestedAt: number; processedAt: number;
  status: "None" | "Pending" | "Finalized" | "Rejected";
}
interface RawHealthCase {
  id: string; atBlock: number; ts: number; navPerShare: string; drawdownBps: string;
  codehash: string; expectedCodehash: string; navStale: boolean; paused: boolean;
  records: RawRecord[];
}

const raw: RawHealthCase[] = JSON.parse(readFileSync(fixturesPath, "utf8"));

const results = raw.map((c) => {
  const records: RedeemRequestRecord[] = c.records.map((r) => ({
    id: r.id,
    owner: r.owner,
    receiver: r.receiver,
    shares: BigInt(r.shares),
    requestedAt: r.requestedAt,
    processedAt: r.processedAt,
    status: r.status,
  }));
  const snap = buildRequestFinalizeSnapshot(
    records,
    c.atBlock,
    c.ts,
    BigInt(c.navPerShare),
    BigInt(c.drawdownBps),
    c.codehash,
    c.expectedCodehash,
    c.navStale,
    c.paused,
  );
  return {
    id: c.id,
    method: snap.method,
    n: snap.n,
    p50Sec: snap.p50Sec,
    p90Sec: snap.p90Sec,
    maxSec: snap.maxSec,
    flags: snap.flags,
    evidenceHash: snap.evidenceHash,
  };
});

console.log(JSON.stringify(results, null, 2));
