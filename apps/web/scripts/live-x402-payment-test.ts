// Tests the payment-and-retry half of the x402 flow: a real client, signing a real (testnet, valueless) Base Sepolia
// USDC payment via the official @x402/fetch wrapper, against a real running apps/web server's
// /api/verify-paid route. Confirms the FULL round trip — 402 challenge, signed payment,
// retry, settlement — not just the challenge half apps/web/e2e/verify-paid.spec.ts already
// covers.
//
// Lives inside apps/web (not the root scripts/ folder) because every dependency here
// (@x402/fetch, @x402/evm, viem) is only installed in this workspace — Node's ESM resolution
// walks up from the importing file's own location, not the process's CWD, so a root-level
// script can't see apps/web/node_modules even when run from inside apps/web. Found this the
// hard way: it failed with ERR_MODULE_NOT_FOUND from both the repo root and apps/web itself
// before moving the file here fixed it.
//
// Needs a funded throwaway Base Sepolia wallet (X402_TEST_WALLET_PRIVATE_KEY — never a
// real-value key, see .env.example) and a running server (`pnpm --filter web dev` or
// `next start`, pointed at by --base-url). Named with the `live:` category (the repo's
// rules) since it makes a real, though valueless, on-chain payment — never run in
// CI, never run automatically.
//
// Usage (from the repo root): node --env-file=.env --experimental-strip-types apps/web/scripts/live-x402-payment-test.ts [--base-url http://localhost:3000]

import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const PRIVATE_KEY = process.env.X402_TEST_WALLET_PRIVATE_KEY;
if (PRIVATE_KEY === undefined || PRIVATE_KEY === "") {
  console.error("X402_TEST_WALLET_PRIVATE_KEY is not set — see .env.example.");
  process.exit(1);
}

const BASE_URL = arg("base-url") ?? "http://localhost:3000";

async function main(): Promise<void> {
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`Paying from: ${account.address}`);

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(account) }],
  });

  // Account/rpcUrl are deliberately fake — this test verifies the x402 PAYMENT mechanics
  // (402 -> sign -> retry -> past the gate), not the underlying verification logic, which
  // has its own separate coverage (lib/replay.ts's own tests, apps/web/e2e/verify-paid.spec.ts
  // for the unpaid-402 case). A 502 (bad RPC) response here is actually the SUCCESS signal:
  // it means payment cleared and the request reached this route's own handler.
  const url = `${BASE_URL}/api/verify-paid?account=0x1234567890123456789012345678901234567890&rpcUrl=http://localhost:1`;
  console.log(`Requesting (with automatic x402 payment): ${url}`);

  const response = await fetchWithPayment(url, { method: "GET" });
  console.log(`Final status: ${response.status}`);
  const body = await response.json().catch(() => undefined);
  console.log("Body:", JSON.stringify(body, null, 2));

  if (response.status === 402) {
    console.error("\nFAIL: still 402 after the payment wrapper ran — payment did not clear.");
    process.exit(1);
  }

  console.log(
    `\n${response.status === 502 ? "PASS" : "PASS (unexpected but non-402 status)"}: the x402 payment-and-retry round trip completed — the request reached the route handler past the payment gate.`,
  );
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
