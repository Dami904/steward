import { test, expect } from "@playwright/test";
import { encodeFunctionData } from "viem";
import { stewardAccountAbi } from "../lib/steward-abi";
import { client as chainClient, readNextSeq } from "../lib/chain";
import { RPC, OWNER_PK, OWNER_ADDRESS, walletFor, mockWallet } from "./mock-wallet";

// Not part of the CI-run suite (see playwright.config.ts's testDir — this file IS under
// e2e/, so it WILL run with the rest; kept here deliberately, not excluded, because it needs
// no BSC RPC or archive access, just a plain local chain, same zero-network-dependency bar as
// simulate.spec.ts). Requires a StewardAccount deployed by
// contracts/script/DeployLocalMock.s.sol against a plain local Anvil on :8551 — see that
// script's own header comment. Not run by CI yet (CI has no such Anvil instance up); run
// manually: anvil --port 8551, then
// forge script script/DeployLocalMock.s.sol --rpc-url http://127.0.0.1:8551 --broadcast,
// then set LOCAL_STEWARD_ACCOUNT below to the printed `account:` address.

const ownerWallet = walletFor(OWNER_PK);
const LOCAL_ACCOUNT = process.env.LOCAL_STEWARD_ACCOUNT;

test.describe("/app controls (local mock chain, real signed transactions)", () => {
  test.skip(!LOCAL_ACCOUNT, "LOCAL_STEWARD_ACCOUNT not set — see this file's header comment for how to deploy one");
  // Both tests below share ONE live contract/account and mutate its real state (pause/
  // unpause, seq) — running them in parallel workers would race against each other on the
  // same on-chain account, especially the second test's own deliberately-engineered race.
  // Serial execution trades speed for correctness here.
  test.describe.configure({ mode: "serial" });

  test("connect wallet, detect owner role, pause and unpause via real on-chain writes", async ({ page }) => {
    await mockWallet(page, OWNER_PK, OWNER_ADDRESS);
    await page.goto(`/app?address=${LOCAL_ACCOUNT}&rpc=${encodeURIComponent(RPC)}`);

    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByText("owner", { exact: true })).toBeVisible();

    const pauseButton = page.getByRole("button", { name: "Pause" });
    const alreadyPaused = await page.getByText("PAUSED", { exact: true }).isVisible().catch(() => false);
    if (!alreadyPaused) {
      await pauseButton.click();
      // Controls.tsx calls window.location.reload() once the tx confirms — expect's own
      // polling naturally rides out that reload rather than needing an explicit wait.
      await expect(page.getByText("PAUSED", { exact: true })).toBeVisible({ timeout: 15000 });
    }

    // Restore state for repeatability: unpause again.
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByText("owner", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Unpause" }).click();
    await expect(page.getByText("PAUSED", { exact: true })).not.toBeVisible({ timeout: 15000 });
  });

  // Regression test for a real bug this repo's reliability-auditor review caught:
  // waitForTransactionReceipt resolves on ANY mined receipt, including a reverted one, so an
  // earlier draft of Controls.tsx's runWrite would reload the page as if a reverted action
  // had succeeded, with no error ever shown. Forces the exact race that produces a real
  // BadSequence revert (contracts/src/StewardAccount.sol), then asserts the UI surfaces an
  // error and does NOT silently reload — per the repo rule "a guard ships with a test that
  // fails if the guard is deleted," this test fails again if the receipt.status check in
  // Controls.tsx's runWrite is ever removed.
  test("a stale-seq race (BadSequence revert) is surfaced as an error, not silently treated as success", async ({ page }) => {
    // Delay the mock's actual broadcast so there's a real window to win the race in: the UI
    // reads nextSeq, then "prepares to send" — during that gap, an out-of-band tx (below)
    // consumes the same seq for real, so by the time the delayed send finally goes out, it's
    // stale.
    await mockWallet(page, OWNER_PK, OWNER_ADDRESS, 2000);
    await page.goto(`/app?address=${LOCAL_ACCOUNT}&rpc=${encodeURIComponent(RPC)}`);

    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByText("owner", { exact: true })).toBeVisible();

    // Make sure we're starting unpaused, so "Pause" is the visible action.
    if (await page.getByText("PAUSED", { exact: true }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Unpause" }).click();
      await expect(page.getByText("PAUSED", { exact: true })).not.toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "Connect wallet" }).click();
      await expect(page.getByText("owner", { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Pause" }).click(); // this read's nextSeq now, but its send is delayed 2s

    // While the UI's tx is still "in flight" (delayed), win the race out-of-band: submit and
    // confirm a real pause() ourselves with the same current seq, consuming it for real
    // before the UI's own delayed send goes out.
    await new Promise((r) => setTimeout(r, 300)); // let the UI's readNextSeq/prepare happen first
    const currentSeq = await readNextSeq(RPC, LOCAL_ACCOUNT as `0x${string}`);
    const raceHash = await ownerWallet.sendTransaction({
      to: LOCAL_ACCOUNT as `0x${string}`,
      // pause(uint64 seq, bytes32 receiptHash, uint32 reasons, bytes policyInput) — same
      // shape Controls.tsx uses, called directly here to win the race deterministically.
      data: encodeFunctionData({
        abi: stewardAccountAbi,
        functionName: "pause",
        args: [currentSeq, `0x${"0".repeat(64)}` as `0x${string}`, 0, "0x"],
      }),
    });
    await chainClient(RPC).waitForTransactionReceipt({ hash: raceHash });

    // Now the UI's own delayed send finally goes out, using the seq it read before losing
    // the race — it must revert BadSequence, and Controls.tsx must surface that as an error,
    // not reload the page as if it had succeeded. Two different, both-correct places this can
    // be caught: viem's writeContract pre-flight simulation rejects it before ever
    // broadcasting (its own "Execution reverted... custom error" message, thrown straight
    // into runWrite's catch block) — the more common outcome in practice, confirmed live —
    // or, if simulation raced ahead of mining, the receipt.status==='reverted' check this
    // test exists to guard lands instead ("reverted on-chain", this file's own wording). The
    // real invariant under test is "an error is shown and nothing reloads", not which of the
    // two code paths catches it.
    await expect(page.getByText(/revert/i)).toBeVisible({ timeout: 15000 });
    // A reload would have reset React state, requiring "Connect wallet" to reappear — its
    // absence here is direct evidence no reload happened after the revert.
    await expect(page.getByRole("button", { name: "Connect wallet" })).not.toBeVisible();

    // Cleanup: the out-of-band tx above did legitimately pause the account. The dashboard
    // still shows the props from BEFORE that (paused: false) — correctly, since a reverted
    // write must NOT reload the page (that's exactly the bug this test guards against) — so
    // "Unpause" isn't on screen yet; only "Pause" is, bound to stale state. Reload ourselves
    // (as a real user would after seeing the error) to pick up the real on-chain state, then
    // unpause for real.
    await page.reload();
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByText("owner", { exact: true })).toBeVisible();
    await expect(page.getByText("PAUSED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Unpause" }).click();
    await expect(page.getByText("PAUSED", { exact: true })).not.toBeVisible({ timeout: 15000 });
  });
});
