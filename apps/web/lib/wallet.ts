// Minimal EIP-1193 browser wallet connection — deliberately not wagmi/RainbowKit/ConnectKit.
// This repo's rule against unrequested abstractions applies here: the live app needs
// "connect, read the address, send a handful of writeContract calls," not a full wallet-
// connector framework with its own provider tree, chain-switching UI, and dependency surface.
// viem's own createWalletClient(custom(window.ethereum)) covers exactly this.

import { createWalletClient, custom, type WalletClient, type Address } from "viem";

// window.ethereum's real shape (MetaMask and most injected wallets) isn't in lib.dom.d.ts.
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const bscChain = { id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [] } } };

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

export interface ConnectedWallet {
  address: Address;
  client: WalletClient;
}

// Requests account access (triggers the wallet's own connect prompt if not already
// authorized) and returns a WalletClient bound to whatever chain the wallet is currently on.
// Does not force a chain switch — a mismatched chain surfaces naturally as a failed/rejected
// transaction with the wallet's own error, which is clearer than silently proceeding.
export async function connectWallet(): Promise<ConnectedWallet> {
  if (!hasInjectedWallet()) {
    throw new Error("No injected wallet found (window.ethereum is undefined) — install MetaMask or a compatible browser wallet.");
  }
  const client = createWalletClient({ chain: bscChain, transport: custom(window.ethereum!) });
  const [address] = await client.requestAddresses();
  if (!address) {
    throw new Error("Wallet connected but returned no account.");
  }
  return { address, client };
}
