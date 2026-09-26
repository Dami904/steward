---
name: integration-dev-experience
description: Use this whenever setting up a new repo, configuring or changing CI, adding package scripts, or preparing a project for review/submission/portfolio use. Also use whenever the user mentions pnpm, monorepo setup, GitHub Actions, "clean up my repo," "make this reproducible," or is getting a project ready for a hackathon or a job application. Trigger this proactively at the start of any new project, not just when explicitly asked to set up tooling.
---

# Integration Quality & Dev Experience

The goal: a stranger (a judge, a reviewer, a future employer) can clone
this repo, run one install command and one test command, and see it
actually work — without secrets, without tribal knowledge, without CI
lying to them about what's actually verified.

## Package manager: pnpm

- Set `"packageManager": "pnpm@<version>"` in `package.json` — this pins
  the exact version so CI and every contributor use the same one.
- Commit `pnpm-lock.yaml`. Delete any `package-lock.json` or `yarn.lock`
  left over from a previous setup — having two lockfiles is worse than
  having the "wrong" one, because tools disagree about which is authoritative.
- If this is a monorepo (an app + contracts + a shared client package,
  etc.), use a real `pnpm-workspace.yaml` and `--filter` in scripts rather
  than duplicating dependencies across packages.
- Migrating an existing npm project: delete `node_modules` and
  `package-lock.json`, run `pnpm import` (converts the existing lockfile
  so versions don't drift), then `pnpm install`. See
  `references/pnpm-migration.md`.

## CI must run everything that matters

The most common gap: CI compiles and tests contracts (or backend logic)
but never runs `lint`, `typecheck`, or `build` on the app itself, even
though those scripts exist in `package.json`. That means the app can be
completely broken and CI stays green.

Every push and PR should run, at minimum:
```
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```
See `references/ci.yml` for a pnpm-based GitHub Actions template that runs
all four as separate jobs (so a lint failure doesn't hide a test failure
behind it) with dependency caching.

## Reproducibility without secrets

A reviewer should be able to `git clone`, `pnpm install`, `pnpm test`, and
get a real pass/fail with zero API keys, zero funded wallets, zero network
calls to anything that costs money or requires an account. If part of your
test suite needs a live API key or a funded testnet wallet, that's a demo
script, not a test — name it accordingly (`live:demo`, `deploy:testnet`) so
it's obviously separate from what CI runs and what a cold reviewer can
verify themselves.

## Guardrails as code

A rule that only exists as a sentence in your README or CLAUDE.md will
eventually get violated by someone (including future-you, including an
agent) who didn't read it. Where you can, turn the rule into something
that actually fails when violated:
- An eslint rule or a grep-based CI step that fails the build if a secret
  env var is referenced outside its designated file.
- A test that asserts a specific function signature/permission set instead
  of just documenting "this should only be callable by X."
- A CI job that runs a static analyzer (`slither` for Solidity, `eslint`
  with `--max-warnings 0` for TS) instead of just recommending one in a doc.

## Docs that build trust instead of costing it

Two docs, cheap to write, disproportionately useful:
- `docs/LIMITATIONS.md` — what's explicitly not handled yet, stated
  plainly. Reviewers trust a project more when it names its own gaps than
  when they have to find them.
- `docs/THREAT_MODEL.md` — who's trusted, what happens if each key/wallet
  is compromised, and (the part most people skip) a section titled "not
  defended, be explicit" plus a ranked "known weaknesses worth attacking
  first" list. A threat model that only lists solved problems is
  marketing, not a threat model. See `references/THREAT_MODEL.template.md`.

Keep the README's setup instructions in sync with reality — after a pnpm
migration, grep the README for `npm install`/`npm run` and fix every
instance in the same PR, not later.

## Submission presentation (hackathon, portfolio, job application)

A judge or reviewer spends minutes, not hours, per project. The README's
job is to make every claim independently checkable in that window.

- **Badge row, top of README, in this order:** CI status, test count
  (`tests: N passing` — a real number pulled from your test runner, not a
  vibe), license, live deploy link, the chain/network or key stack piece.
  Every badge must resolve to something real when clicked — a decorative
  badge is worse than none, because it invites the reviewer to check the
  rest less charitably once they notice.
- **One bolded sentence that reframes the problem**, not just describes
  the feature. "Does it remember" is a feature description; "can you prove
  what it used and stop it touching what it shouldn't" is a reframe. The
  reframe is usually the actual hard part of what you built, lead with it.
- **An honesty table**: a plain "what's real vs mocked" breakdown, this
  capability is live against the real API/chain, that one falls back to a
  deterministic mock without a key, here's exactly why. State it before a
  reviewer has to find the gap themselves.
- **A demo run-of-show, scripted, including the failure path.** Write the
  live demo as a timed script (cold open line, the one moment you want
  them watching closely, the close), not something you'll wing. Include an
  explicit contingency section: what you say and do if wifi dies, the live
  app won't load, or a terminal command misbehaves. Rehearsing the failure
  mode matters as much as rehearsing the happy path. See
  `references/RUNOFSHOW.template.md`.
- **Expose the same core logic through more than one surface** when it's
  cheap (a CLI wrapper, an MCP tool, a one-line SDK middleware around the
  same underlying package). Each extra surface is another way a reviewer
  can verify your claim without touching your UI, for about a day of glue
  code if the core logic is already a clean, dependency-free module.
- **A strong build can legitimately be resubmitted, rebranded, to a second
  hackathon on the same underlying chain/stack.** Check each hackathon's
  originality/eligibility rules first, some explicitly forbid it. Where
  it's allowed, this beats originating something new from zero every time.

## Quick checklist before calling a repo "done"

- [ ] `packageManager` pinned, single lockfile committed, no leftover
      npm/yarn artifacts.
- [ ] CI runs lint, typecheck, build, and test as separate jobs on every
      push/PR — not just the contract/backend test suite.
- [ ] A cold `git clone && pnpm install && pnpm test` passes with zero
      secrets and zero network calls to paid/live services.
- [ ] Any live/demo/deploy script that needs real credentials is clearly
      named and separated from the default test path.
- [ ] `docs/LIMITATIONS.md` and `docs/THREAT_MODEL.md` exist and match the
      current code, not an earlier version of it, and the threat model
      names what's NOT defended, not just what is.
- [ ] README setup steps actually match the current scripts.
- [ ] Badge row (CI, tests passing, license, live demo, network/stack) is
      at the top of the README and every badge resolves to something real.
- [ ] A scripted demo run-of-show exists with a contingency plan for the
      live-demo failure modes (wifi, app down, terminal misbehaving).
