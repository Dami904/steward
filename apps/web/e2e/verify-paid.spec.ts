import { test, expect } from "@playwright/test";

// Phase 6, sixth item (spec/DECISIONS.md): the x402-priced verification endpoint. Confirmed
// manually first against a real running dev server before writing this — a real HTTP 402
// with a genuine, spec-compliant PaymentRequired payload (real network, real USDC asset
// address resolved for Base Sepolia, real configured price) — this test pins that behavior
// as a regression check. Does not (and cannot, without a funded testnet wallet) exercise the
// actual payment-and-retry half of the flow; that needs a real signer, out of scope for CI.
test.describe("/api/verify-paid x402 gate", () => {
  test("an unauthenticated request gets a real, spec-compliant 402 challenge", async ({ request }) => {
    const res = await request.get(
      "/api/verify-paid?account=0x1234567890123456789012345678901234567890&rpcUrl=http://localhost:1",
    );
    expect(res.status()).toBe(402);

    const header = res.headers()["payment-required"];
    expect(header).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));

    expect(decoded.x402Version).toBe(2);
    expect(Array.isArray(decoded.accepts)).toBe(true);
    expect(decoded.accepts.length).toBeGreaterThan(0);

    const [requirement] = decoded.accepts;
    expect(requirement.scheme).toBe("exact");
    expect(requirement.network).toBe("eip155:84532"); // Base Sepolia — spec/DECISIONS.md, "Phase 6, sixth item"
    expect(requirement.amount).toBe("10000"); // $0.01 at USDC's 6 decimals, matching proxy.ts's configured price
    expect(typeof requirement.payTo).toBe("string");
    expect(requirement.payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("routes other than /api/verify-paid are not gated", async ({ request }) => {
    const res = await request.get("/api/honeypot/notices");
    expect(res.status()).not.toBe(402);
  });
});
