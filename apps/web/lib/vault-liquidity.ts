import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, fallback, http, parseAbi } from "viem";

// Live redemption history for the landing page's liquidity chart: every request the real IXS
// vault has ever recorded, read from BNB Chain at render time — same data and same
// REQUEST_FINALIZE_VIEW method as scripts/live-health-snapshot.ts (spec/health.md §2), but
// keeping PENDING requests with their age so far, which the health feed itself does not
// (docs/LIMITATIONS.md). Read-only view calls; no key, no wallet. If every RPC fails, falls
// back to the last committed snapshot (docs/measurement-report.json) and says so, rather than
// showing nothing or inventing numbers.

export const VAULT = "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82" as const;

// Public, non-secret endpoints (docs/API_NOTES.md). BSC_RPC_URL, if set, is tried first.
const RPCS = [process.env.BSC_RPC_URL, "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"].filter(
  (u): u is string => typeof u === "string" && u.length > 0,
);

const abi = parseAbi([
  "function nextRedeemRequestId() view returns (uint256)",
  "function redeemRequests(uint256) view returns (address owner, address receiver, uint256 shares, uint256 priceAtRequest, uint256 feeBpsAtRequest, uint256 requestedAt, uint256 processedAt, uint8 status)",
]);

const STATUS = ["None", "Pending", "Finalized", "Rejected"] as const;

export interface RedeemRequestView {
  id: number;
  status: (typeof STATUS)[number];
  shares: number; // whole shares, for display only
  seconds: number; // settled: processedAt - requestedAt; pending: asOf - requestedAt (still growing)
}

export interface VaultLiquidity {
  source: "live" | "snapshot";
  asOf: Date;
  block: bigint;
  requests: RedeemRequestView[];
}

async function readLive(): Promise<VaultLiquidity> {
  const client = createPublicClient({
    chain: { id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: RPCS } } },
    transport: fallback(RPCS.map((url) => http(url, { timeout: 8_000, retryCount: 1 }))),
  });

  // Pin every read to one block so the ages are consistent with a single chain timestamp.
  const block = await client.getBlock();
  const next = await client.readContract({ address: VAULT, abi, functionName: "nextRedeemRequestId", blockNumber: block.number });
  const ids = Array.from({ length: Number(next) - 1 }, (_, i) => i + 1);
  const rows = await Promise.all(
    ids.map((id) =>
      client.readContract({ address: VAULT, abi, functionName: "redeemRequests", args: [BigInt(id)], blockNumber: block.number }),
    ),
  );

  const now = Number(block.timestamp);
  const requests = rows.map(([, , shares, , , requestedAt, processedAt, statusIdx], i): RedeemRequestView => {
    const status = STATUS[statusIdx] ?? "None";
    const settled = status === "Finalized" || status === "Rejected";
    return {
      id: ids[i]!,
      status,
      shares: Number(shares) / 1e18,
      seconds: settled ? Number(processedAt - requestedAt) : now - Number(requestedAt),
    };
  });

  return { source: "live", asOf: new Date(now * 1000), block: block.number, requests };
}

interface SnapshotFile {
  fetchedAt: string;
  atBlock: number;
  records: { id: number; shares: string; requestedAt: number; processedAt: number; status: RedeemRequestView["status"] }[];
}

function readSnapshot(): VaultLiquidity {
  // apps/web runs with cwd = apps/web (next dev/start), same assumption app/demo/page.tsx makes.
  const raw = readFileSync(join(process.cwd(), "..", "..", "docs", "measurement-report.json"), "utf-8");
  const s = JSON.parse(raw) as SnapshotFile;
  const asOf = new Date(s.fetchedAt);
  const now = Math.floor(asOf.getTime() / 1000);
  return {
    source: "snapshot",
    asOf,
    block: BigInt(s.atBlock),
    requests: s.records.map((r) => {
      const settled = r.status === "Finalized" || r.status === "Rejected";
      return {
        id: r.id,
        status: r.status,
        shares: Number(r.shares) / 1e18,
        seconds: settled ? r.processedAt - r.requestedAt : now - r.requestedAt,
      };
    }),
  };
}

export async function getVaultLiquidity(): Promise<VaultLiquidity> {
  try {
    return await readLive();
  } catch (err) {
    console.error("[landing] live vault read failed, using committed snapshot:", err instanceof Error ? err.message : err);
    return readSnapshot();
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3_600) {
    const m = seconds / 60;
    return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
  }
  if (seconds < 172_800) {
    const h = seconds / 3_600;
    return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  }
  const d = seconds / 86_400;
  return `${d < 30 ? d.toFixed(1) : Math.round(d)} days`;
}
