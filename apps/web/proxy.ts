import { paymentProxy } from "@x402/next";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
// NOT the package root's `ExactEvmScheme` — that's the CLIENT-side class (constructor takes
// a signer), a real naming collision between @x402/evm's root export and this subpath's
// server-side class of the same name. Caught by `tsc`, not by inspection: the root import
// type-checked as "missing SchemeNetworkServer's methods" and "constructor expected 1-2 args,
// got 0" — confirmed by reading the installed package's own .d.ts files directly (not the
// docs site, which described neither export path precisely enough to catch this) that the
// server-side registrar lives at this specific subpath instead.
import { registerExactEvmScheme } from "@x402/evm/exact/server";

// x402-priced verification endpoint.
//
// Network: Base Sepolia (`eip155:84532`), not BSC — checked before assuming: x402's own
// official settlement contracts (typescript/../contracts/evm in
// github.com/x402-foundation/x402) are deployed via CREATE2 to Base, Arbitrum, Polygon,
// Optimism, Avalanche, Celo, Linea, Unichain, Monad, and World Chain mainnets plus Base
// Sepolia/World Chain Sepolia testnets — BSC is not among them. Rather than self-deploying
// audited third-party settlement contracts to a new chain (real mainnet deployment risk, out
// of scope for a hackathon build) or forcing a mismatch, this uses Base Sepolia: the real,
// official x402 protocol and a real, official hosted facilitator, against a public testnet
// where the payment token has no real value — the same "real protocol, zero real funds at
// risk" spirit as this project's own BSC fork-only path, just on a different chain because
// that's genuinely where x402's real infrastructure lives today.
//
// `middleware.ts` is deprecated in Next.js 16 (this repo runs 16.3.5) — renamed to `proxy.ts`,
// confirmed by reading node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions
// /proxy.md rather than assuming x402/next's own examples (written against the old
// convention) still apply verbatim. Same function, different file/export name.
const PAY_TO =
  (process.env.X402_PAY_TO_ADDRESS as `0x${string}` | undefined) ??
  // Well-known Anvil default test account #0 — never a real key, works out of the box in dev
  // without implying any real payout destination.
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = registerExactEvmScheme(new x402ResourceServer(facilitatorClient), { networks: ["eip155:84532"] });

export const proxy = paymentProxy(
  {
    "/api/verify-paid": {
      accepts: {
        scheme: "exact",
        price: "$0.01",
        network: "eip155:84532",
        payTo: PAY_TO,
      },
      description: "Independent tier-transition replay verification for a StewardAccount",
    },
  },
  resourceServer,
);

export const config = {
  matcher: ["/api/verify-paid"],
};
