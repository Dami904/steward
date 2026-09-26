import { test, expect, type Locator, type Page } from "@playwright/test";

// Closes the gap noted in spec/DECISIONS.md's Phase 5 "second slice" entry: Simulate's
// interactivity (sliders, attack-lab buttons actually recomputing the verdict in a real
// browser) was verified only by hand-tracing the engine's logic and reading the server-
// rendered initial HTML, not by driving an actual browser — the Claude in Chrome extension
// wasn't connected in that session. This is the real browser check.

function verdictBadge(page: Page): Locator {
  return page.getByRole("heading", { name: "Verdict" }).locator("xpath=following-sibling::span[1]");
}

function reasonsPanel(page: Page): Locator {
  return page.getByText("reasons", { exact: true }).locator("xpath=following-sibling::div[1]");
}

// Attack-lab button titles ("Over tier's capacity") can appear again inside a *different*
// button's own description text (e.g. "Over mandate's maxTx"'s description cross-references
// "Over tier's capacity" by name) — a role/name regex match against the whole button (title +
// description) is ambiguous. Match the exact title text node instead, then walk up to its
// containing <button>.
function attackButton(page: Page, title: string): Locator {
  return page.getByText(title, { exact: true }).locator("xpath=ancestor::button[1]");
}

test.describe("/simulate", () => {
  test("default scenario computes a clean ALLOW via the real engine", async ({ page }) => {
    await page.goto("/simulate");
    await expect(verdictBadge(page)).toHaveText("ALLOW");
    await expect(reasonsPanel(page)).toContainText("OK");
    // capacity/headroom/binding term match the hand-computed values recorded in
    // spec/DECISIONS.md: T1's capTier (400) binds under the default mandate/treasury.
    await expect(page.getByText("capTier", { exact: true })).toBeVisible();
  });

  test("attack lab presets each recompute a real, distinct verdict", async ({ page }) => {
    await page.goto("/simulate");

    await attackButton(page, "Owner has paused the account").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("OWNER_PAUSED");

    await attackButton(page, "Stale evidence").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("STALE_EVIDENCE");

    await attackButton(page, "Severe corroborated adverse claim").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("OVER_CAPACITY");

    await attackButton(page, "Below reserve after withdrawal").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("BELOW_RESERVE");

    await attackButton(page, "Over mandate's maxTx").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("OVER_MAX_TX");

    await attackButton(page, "Over tier's capacity").click();
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("OVER_CAPACITY");

    await attackButton(page, "Reset to a clean ALLOW").click();
    await expect(verdictBadge(page)).toHaveText("ALLOW");
  });

  test("dragging the proposed-deposit slider live-recomputes the verdict (real slider interaction, not just buttons)", async ({ page }) => {
    await page.goto("/simulate");
    await expect(verdictBadge(page)).toHaveText("ALLOW");

    // The label text sits one level deeper than verdict/reasons (label > div > span, with the
    // <input> a sibling of the div, not of the span) — go up one level before following-sibling.
    const slider = page.getByText("Proposed deposit", { exact: true }).locator("xpath=../following-sibling::input[@type='range']");
    await slider.focus();
    await slider.press("End"); // jumps a range input to its max — well past any capacity in the default scenario

    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("OVER_CAPACITY");

    // Home -> 0, which is below the vault's minDepositAssets floor (100) — still a REFUSE, but
    // via a different bit (PROPOSAL_INVALID). Asserting the reason actually changes, not just
    // that it stays REFUSE, is what proves this is a live recompute and not a stuck value.
    await slider.press("Home");
    await expect(verdictBadge(page)).toHaveText("REFUSE");
    await expect(reasonsPanel(page)).toContainText("PROPOSAL_INVALID");
    await expect(reasonsPanel(page)).not.toContainText("OVER_CAPACITY");
  });

  test("tier selector recomputes the tier ceiling live", async ({ page }) => {
    await page.goto("/simulate");
    const tierCeiling = page.getByText("tier ceiling (maxVault)").locator("xpath=following-sibling::div[1]");

    await page.getByRole("button", { name: "T0", exact: true }).click();
    await expect(tierCeiling).toHaveText("150");

    await page.getByRole("button", { name: "T3", exact: true }).click();
    await expect(tierCeiling).toHaveText("1,200");
  });
});
