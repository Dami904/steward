import { defineConfig } from "@playwright/test";

const CI_PORT = 3100;

// Locally: no webServer block — drives a real headless Chromium against an already-running
// app (either `pnpm dev` or a `pnpm build && pnpm start`). This repo's dev/fork processes are
// frequently already up across a session (earlier sessions hit
// backgrounded anvil/next processes outliving TaskStop), so letting Playwright manage its own
// server instance locally would just fight over the port. 3000 is Next's own default on a
// clean run; if something else on your machine is already using it, Next prints the port it
// actually picked instead (e.g. "Port 3000 is in use... using 3001") — pass that via BASE_URL,
// e.g. `BASE_URL=http://localhost:3001 pnpm test:e2e`.
//
// In CI: Playwright manages the server itself via `webServer` — starts `next start` (the app
// must already be built, see .github/workflows/ci.yml's `web` job), polls the given `url`
// until it answers, runs the suite, then tears the server down. This replaces a first draft's
// hand-rolled `nohup ... &` + bash curl-polling CI steps, which worked (confirmed on a real
// ubuntu-latest run) but relied on undocumented GitHub Actions runner behavior — a background
// process surviving across separate `run:` steps in the same job — rather than a documented
// contract. `reuseExistingServer: false` in CI is deliberate: always start fresh rather than
// silently reusing a leftover process from a previous, possibly-stale run.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? (process.env.CI ? `http://localhost:${CI_PORT}` : "http://localhost:3000"),
    trace: "retain-on-failure",
  },
  webServer: process.env.CI
    ? {
        command: `npx next start -p ${CI_PORT}`,
        url: `http://localhost:${CI_PORT}/simulate`,
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
