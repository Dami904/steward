import { test, expect } from "@playwright/test";
import { RPC, OWNER_PK, OWNER_ADDRESS, mockWallet } from "./mock-wallet";

// Not part of the CI-run suite — same manual-only category as app-controls.spec.ts (needs a
// freshly deployed local Anvil, see contracts/script/DeployLocalMock.s.sol's header comment).
// Tests apps/web/app/app/MandateBuilder.tsx's two-step "preview, then confirm & sign" flow —
// the highest-stakes control in the live app (setMandate replaces the mandate outright, no
// seq check, no direction restriction), so it gets its own dedicated real-signed-transaction
// test rather than relying on the cast-based ABI sanity check alone.

const LOCAL_ACCOUNT = process.env.LOCAL_STEWARD_ACCOUNT;

test.describe("/app mandate builder (local mock chain, real signed transaction)", () => {
  test.skip(!LOCAL_ACCOUNT, "LOCAL_STEWARD_ACCOUNT not set — see app-controls.spec.ts's header comment for how to deploy one");

  test("editing a field shows a plain-language preview, and confirming actually changes the on-chain mandate", async ({ page }) => {
    await mockWallet(page, OWNER_PK, OWNER_ADDRESS);
    await page.goto(`/app?address=${LOCAL_ACCOUNT}&rpc=${encodeURIComponent(RPC)}`);

    // One shared wallet connection (WalletSection.tsx) covers both Controls and
    // MandateBuilder — a single "Connect wallet" click is enough for both.
    await page.getByRole("button", { name: "Connect wallet" }).click();

    const maxTxField = page.getByLabel("maxTxUsdc");
    await expect(maxTxField).toBeVisible();
    const before = await maxTxField.inputValue();
    const after = String(Number(before) + 111);
    // The dashboard's own display formats with toLocaleString() (thousands separators) —
    // matching against the raw digit string would silently fail once the value crosses 1,000
    // (e.g. "1111" never appears as a contiguous substring of "1,111"). Compute the same
    // formatted form the UI will actually render, and assert against that.
    const afterFormatted = Number(after).toLocaleString();

    await maxTxField.fill(after);

    // The diff list only renders once "Preview N changes" is clicked (MandateBuilder.tsx's
    // `confirming` state) — the button's own label already reflects the change count before
    // that click, but the actual diff text does not appear until after it.
    await page.getByRole("button", { name: /Preview \d+ change/ }).click();
    await expect(page.getByText("Plain-language preview — nothing on-chain yet")).toBeVisible();
    await expect(page.getByText(`maxTxUsdc: ${before} units → ${after} units (looser)`)).toBeVisible();

    await page.getByRole("button", { name: "Confirm & sign" }).click();
    // Controls.tsx-style reload-on-success — expect's polling rides it out. Asserted against
    // the dashboard's own mandate display (DashboardCard, a separate component reading fresh
    // SSR'd state after reload), not the builder's own input — the real proof this changed
    // on-chain, not just in the form.
    await expect(page.getByText(`maxTxUsdc: ${afterFormatted}`)).toBeVisible({ timeout: 15000 });
  });
});
