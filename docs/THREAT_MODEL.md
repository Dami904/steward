# Threat model

Keep this short and current. Its job is to state trust assumptions explicitly so they can be
checked, not to be exhaustive. Written starting at Phase 1 (spec + engine), updated through
Phase 2 (contracts, `StewardAccount`/`StewardFactory`/`ConductRegistry`/`VaultHealthFeed` all
exist and are unit/invariant/fork-tested) and Phase 3 (SERV client, `packages/serv-client`).
Phases 4-7 additions are summarized in "Phases 4-7 additions" at the end (added 2026-09-24,
brief, not a full re-audit).
**No contracts are deployed to any network** (zero-funds/fork-only path, `spec/DECISIONS.md`)
— that is a different claim from "no contracts exist": the `owner`/`agent`/`guardian` role
separation below is real, tested code, just not yet backed by real deployed key material or a
live network. Update this file the moment deployment changes that.

## Trusted parties / keys

- `SERV_API_KEY` (local `.env`, gitignored) — pays for/authenticates SERV Reasoning API
  calls. Used by `packages/serv-client` (Phase 3) — read only by scripts the repo owner runs
  themselves (`make live-serv-probe`, `make live-eval`), never by an automated agent session
  (`CLAUDE.md`: no `.env*` reads). Can only spend against the hackathon's own credit balance;
  cannot move funds or touch the vault — `packages/serv-client/src/reasoner.ts` also rejects
  any model output that tries to smuggle an address/calldata/limit field, so even a fully
  malicious response over this key has no path to acting on the vault.
- `BSCSCAN_API_KEY` (local `.env`, gitignored) — read-only access to BscScan's contract
  source/ABI lookup API. No write capability of any kind.
- `owner` key — role defined in `contracts/src/StewardAccount.sol` (immutable at
  construction), tested (88 unit tests + the invariant suite; 89 in `forge test` as of 2026-09-24), **not deployed** — no real key
  material exists yet. Per PLAN_v2 §7.1, can set the mandate, raise limits, unpause,
  `withdraw(to, amount)`, emergency redeem. The single most powerful key in the eventual
  system.
- `agent` key — same status (coded and tested, not deployed). Can `deposit`, `requestRedeem`,
  `logDecision`, `tightenCap`, `raiseReserve`, `pause`, `proposeLoosenCap`. Cannot raise
  capacity alone (owner-gated or veto-windowed per the asymmetric-authority design, enforced
  by `StewardAccount.applyLoosen`'s delay and `cancelLoosen`'s owner/guardian-only gate).
- `guardian` key — same status. Can `tightenCap`, `raiseReserve`, `pause`, `requestRedeem`,
  `cancelLoosen`, `logDecision`. Strictly less powerful than `agent`; cannot add risk under
  any circumstance (no `deposit` access — checked directly in
  `contracts/test/unit/StewardAccount.t.sol`).
- `operator` key (Phase 6, `serv PLAN_v2.md` §7.6 fee-on-yield module — coded and tested, not
  deployed) — owner-configured (`setOperator`, unlike `owner`/`agent`/`guardian`, not fixed at
  construction; defaults to `address(0)`, i.e. no operator until the owner sets one). Can only
  `claimFees()`: sweeps `accruedFees`, a value that only ever increases via
  `gain * feeBps / 10000` inside `reconcileRedemption` — never derived from `costBasis` or a
  raw balance read (`contracts/src/StewardAccount.sol`'s own comment on `claimFees`). No other
  capability at all — cannot deposit, redeem, pause, or touch the mandate/envelope.
- **Not ours, but load-bearing:** the IXS `ManagedVault`'s own admin roles
  (`DEFAULT_ADMIN_ROLE`, `NAV_MANAGER_ROLE`, `OPERATOR_ROLE`, `PAUSER_ROLE`) at
  `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`. This project has zero control over them and
  treats their output (NAV, whitelist state, pause state) as trusted external input.

## What happens if each one is compromised

- `SERV_API_KEY` leaks: attacker can spend the project's SERV credit balance. No path to
  funds, no path to the vault. Worst case is a bounded financial loss capped at remaining
  credit, and API calls stop working once it's exhausted or revoked.
- `BSCSCAN_API_KEY` leaks: attacker can make read-only calls against BscScan's API under this
  project's rate limit. No state-changing capability exists on that API at all.
- If the `agent` key leaks (once deployed): the attacker is bounded by the *current* tier's
  `maxTx`/`maxVault`/`maxBps`/`hardCap` (`spec/tiers.md` §1) — they cannot raise those limits
  themselves, and any risk-adding action is capped by whatever the agent has already earned.
  Worst case is bounded to the current tier's ceiling, not the account's total balance.
- If the `guardian` key leaks (once deployed): strictly less dangerous than the agent key
  leaking — guardian actions can only tighten, pause, or risk-reduce; there's no action a
  compromised guardian key can take that increases loss exposure.
- If the `owner` key leaks (once deployed): total loss of the account's `hardCap`-bounded
  balance is possible (owner can `withdraw` directly). This is, by design, the single largest
  concentration of risk once the contracts are deployed — no multisig or timelock is
  currently planned for the hackathon build.
- If the `operator` key leaks (once deployed and configured): the attacker can claim
  `accruedFees` — bounded to `feeBps * cumulative realised gains so far`, never principal, and
  never more than whatever had already accrued at the moment of compromise. The owner can
  immediately revoke by calling `setOperator` again (including back to `address(0)`, which
  makes `claimFees()` permanently unreachable — `onlyOperator` can never match
  `msg.sender == address(0)`). Worst case is bounded to accrued-but-unclaimed fees at leak
  time, structurally the smallest blast radius of any role in this system.
- If the IXS vault's own admin keys are compromised (outside this project's control): NAV
  could be set arbitrarily up to `maxNavChangeBps` (measured: 50%) per update, whitelist could
  be toggled on to block this project's deposits, or the vault could be paused. The Health
  Feed's `NAV_STALE`/`PAUSED`/`CODEHASH_CHANGED` flags (`spec/health.md` §4) are the
  mitigation: they can only *tighten* this project's own exposure in response, never prevent
  the vault-side compromise itself.

## Not defended — be explicit

- **A compromised owner key**, once contracts are deployed, can withdraw the full account
  balance. No multisig, no timelock, no quorum is planned for this hackathon build. This will
  be the single largest concentration of risk in the eventual system — stated here now so it
  isn't discovered later and presented as an oversight.
- **The SERV model/provider itself.** `packages/serv-client`'s grounding/validation checks
  limit what gets *acted on* (an ungrounded or malformed claim/proposal is dropped or fails
  closed to `HOLD`), but cannot limit what OpenServ/its underlying model providers retain from
  submitted prompts (source text, proposal context) — that's a data-handling trust boundary
  this project has no visibility into or control over. `serv_prompt_guard`'s actual behavior
  is also still unmeasured (`docs/API_NOTES.md`) — until `make live-serv-probe` is run, don't
  assume it provides any specific protection beyond what `validateProposal`'s own
  schema/field-allowlist check already does independently.
- **The vault operator's honesty.** NAV is admin-attested (`setNAV`), not computed from
  verifiable on-chain price data. This project can detect a large single jump
  (`maxNavChangeBps`) or staleness, but cannot detect a series of small, honestly-signed but
  substantively false NAV updates.
- **Public RPC availability/integrity.** Reads currently go through public nodes
  (`bsc-dataseed.binance.org`, `bsc-rpc.publicnode.com`) with no fallback/quorum across
  multiple independent RPC providers. A malicious or compromised RPC node could serve false
  read data to the off-chain engine today; nothing here cross-checks reads against a second
  independent source yet.
- **Sybil resistance on the ConductRegistry** (once built). Per `spec/tiers.md` §7, a record
  farmed across many self-owned accounts is limited by a `distinctOwners` threshold above T1,
  but true Sybil resistance (verifying owners are actually distinct humans/entities) is
  explicitly out of scope — the registry exposes the numbers; a delegator is expected to read
  them, not to be protected from a determined Sybil by the contract alone.
- **A never-finalized redemption permanently blocks the account from redeeming again.**
  `spec/DECISIONS.md` "Phase 6, fourth item": since the real vault provides no on-chain-readable
  record of what a redemption actually settled for, `StewardAccount` derives the true amount
  from a USDC balance delta, which only stays correct if exactly one redemption is outstanding
  at a time (`requestRedeem`'s `pendingRequestId` guard). If the vault operator never calls
  `finalizeRedeem`/`rejectRedeem` for a pending request — inaction, not a hack — the account can
  never request another redemption. Deliberately not defended with an emergency-override
  function (out of scope for this build's risk/effort tradeoff); the owner's direct
  `withdraw()` of idle balance is unaffected by this and remains available regardless.
  **Observed on the real vault, not only hypothetical:** as of 2026-09-24, 2 of its 8 recorded
  redemption requests are unsettled after 63 and 107 days (`docs/measurement-report.md`). An
  account whose request landed in that state would stay locked out of redeeming. n = 8 and one
  of the two is dust, so this shows the failure mode exists, not how likely it is.

## Known weaknesses worth attacking first

1. **The IXS vault's own admin surface** — this project inherits whatever trust assumptions
   the vault's `DEFAULT_ADMIN_ROLE`/`NAV_MANAGER_ROLE` carry, and has no way to independently
   verify NAV correctness. This is the weakest link and the one hardest to defend against
   from outside the vault contract itself.
2. **Single-RPC-source reads** — no cross-checking against multiple independent RPC providers
   yet; a bad read propagates straight into capacity/health calculations.
3. **No contracts deployed yet** — the on-chain half of this threat model (owner/agent/
   guardian key separation, receipt binding, sequence continuity) is coded and tested
   (unit + invariant + fork tests against the real vault's state), which is a real step up
   from spec-only, but it is still *unenforced on any live network* until deployment — no
   real key has custody of real funds yet, so every "if this key leaks" bullet above is a
   statement about tested code behavior, not an incident that could currently happen.

## Known limitations

See `docs/LIMITATIONS.md` for the full, non-security-focused list (fixture scale,
zero-funds path, etc).

Found something else? That's the point of writing this down.

## Phases 4-7 additions (2026-09-24; brief, not a full re-audit)

- **Fork demo keys (Phase 4):** the demo runs only on a local Anvil fork with locally generated
  or default test keys and balances obtained by `anvil_impersonateAccount` on a public holder.
  Nothing is broadcast to a live network, so a leak of these keys has no real-funds impact.
- **x402 payment gate (Phase 6):** `apps/web/proxy.ts` gates `/api/verify-paid` on Base
  Sepolia (testnet). The receiving address is a public value; the payer wallet used in
  `live-x402-payment-test` was a throwaway funded from public faucets. Compromise of either has
  no path to the vault or a StewardAccount. The route reuses the read-only `/verify` logic.
- **ERC-8004 bridge (Phase 6):** registers a StewardAccount as an identity. It cannot post
  feedback for itself (the real registry rejects self-feedback), so it cannot inflate its own
  reputation. Fork-tested only; not deployed.
- **Honeypot store (Phase 5):** submitted notices are untrusted text, sanitized and capped at
  2048 bytes, with an in-memory per-key rate limit that resets on restart. No model consumes
  them in this build, so a malicious notice currently has nowhere to act.
- **Redemption serialization (Phase 6):** one pending redemption per account. A vault operator
  who never finalizes or rejects a request blocks that account's further redemptions (a
  liveness loss, not a fund loss). No emergency override exists.
