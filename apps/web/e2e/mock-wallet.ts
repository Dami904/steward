import type { Page } from "@playwright/test";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Shared by every e2e test that needs a signing wallet against the local mock chain (see
// contracts/script/DeployLocalMock.s.sol). No real MetaMask/Chrome extension involved:
// window.ethereum is a page-injected mock whose eth_sendTransaction handler round-trips
// through Node (page.exposeFunction) to a real viem WalletClient holding one of Anvil's
// well-known dev-account private keys, which signs and broadcasts a REAL transaction to the
// REAL local Anvil.
//
// Every test file that imports this shares ONE live on-chain account and its real, monotonic
// `seq` counter. Playwright's default parallelism runs different spec FILES in different
// workers concurrently even when each file serializes its own tests internally
// (test.describe.configure({mode: "serial"}) only serializes within a file) — two files
// racing real transactions against the same seq is exactly the kind of interference these
// tests are designed to catch when it's deliberate (app-controls.spec.ts's race test) and a
// source of real flakiness when it's accidental. Run multiple of these files together with
// `--workers=1`, e.g. `pnpm exec playwright test app-controls.spec.ts mandate-builder.spec.ts
// --workers=1`. Running a single file alone is unaffected either way.

export const RPC = "http://127.0.0.1:8551";
export const LOCAL_CHAIN = { id: 31337, name: "anvil-local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

// Anvil's well-known dev accounts 1/2/3 — same ones contracts/script/DeployLocalMock.s.sol
// assigns as owner/agent/guardian. Copied from a live `anvil` startup log, per this repo's
// own established lesson (spec/DECISIONS.md: never hand-transcribe these).
export const OWNER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
export const OWNER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const AGENT_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
export const AGENT_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
export const GUARDIAN_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
export const GUARDIAN_ADDRESS = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

export function walletFor(pk: Hex) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: LOCAL_CHAIN, transport: http(RPC) });
}

// Registers a page-injected mock wallet signing as `pk`. `delaySendMs`, when set, makes the
// mock's eth_sendTransaction handler wait that long before actually broadcasting — used by
// race-condition tests to open a deterministic window for an out-of-band tx to land first.
export async function mockWallet(page: Page, pk: Hex, address: string, delaySendMs = 0) {
  const wallet = walletFor(pk);
  await page.exposeFunction("__mockAccounts", () => [address]);
  await page.exposeFunction("__mockSendTransaction", async (tx: { to: `0x${string}`; data: Hex }) => {
    if (delaySendMs > 0) await new Promise((r) => setTimeout(r, delaySendMs));
    return wallet.sendTransaction({ to: tx.to, data: tx.data });
  });

  // Registered before navigation so it's present the moment the app's own scripts run. The
  // mock always answers eth_chainId with BSC's id (0x38) — this repo's real intended
  // deployment target (apps/web/lib/wallet.ts hardcodes chain id 56, correct for the actual
  // Phase 4 BSC fork, which reports the same id) — the underlying RPC here is a plain local
  // Anvil (31337) purely because it sidesteps the BSC fork's archive-pruning flakiness
  // (spec/DECISIONS.md); the mock papers over that one difference, nothing else.
  await page.addInitScript(() => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") {
          return (window as unknown as { __mockAccounts: () => Promise<string[]> }).__mockAccounts();
        }
        if (method === "eth_chainId") return "0x38";
        if (method === "eth_sendTransaction") {
          const tx = (params as [{ to: `0x${string}`; data: Hex }])[0];
          return (window as unknown as { __mockSendTransaction: (tx: { to: `0x${string}`; data: Hex }) => Promise<string> }).__mockSendTransaction(tx);
        }
        throw new Error(`mock wallet: unsupported method ${method}`);
      },
    };
  });
}
