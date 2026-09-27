# Threat model

Who is trusted with what, and what happens if each key is compromised. Current as of
2026-09-27.

**No key in this build holds real funds, and nothing is deployed to mainnet** (a deliberate
zero-funds build). The contracts run on a local fork of BSC, on the hosted read-only demo
chain, and on BSC testnet against a mock vault (`LIVE.md`), all with throwaway keys. The
`owner`/`agent`/`guardian` separation below is real, tested code (89 Foundry tests including
fuzzed invariants); what it has not had is real keys guarding real value. Update this file the
moment that changes.

## Trusted parties and keys

- **`owner`** (fixed when the account is created): sets the mandate, raises limits, unpauses,
  `withdraw(to, amount)`, emergency redeem. The most powerful key.
- **`agent`**: `deposit`, `requestRedeem`, `logDecision`, `tightenCap`, `raiseReserve`,
  `pause`, `proposeLoosenCap`. Cannot raise capacity alone: a loosening waits out a delay that
  the owner or guardian can veto (`applyLoosen`, `cancelLoosen`).
- **`guardian`**: `tightenCap`, `raiseReserve`, `pause`, `requestRedeem`, `cancelLoosen`,
  `logDecision`. Can never add risk (no `deposit`; tested in
  `contracts/test/unit/StewardAccount.t.sol`).
- **`operator`** (fee-on-yield, set by the owner, none by default): can only `claimFees()`,
  which sweeps fees accrued as `gain * feeBps / 10000` on redemptions; never principal.
- **The model (via SERV)**: trusted with nothing. It emits a typed proposal that
  `packages/serv-client`'s validator checks against a strict schema; any extra field (an
  address, calldata, a limit) is rejected and the result falls back to HOLD.
- **`SERV_API_KEY`** (local `.env`, gitignored): pays for SERV calls. Read only by the `live:`
  scripts, run by the owner or with the owner's explicit go-ahead; the scripts never print it.
- **`BSCSCAN_API_KEY`**, **`COMPASS_API_KEY`** (local `.env`): read-only lookups.
- **Not ours, but load-bearing:** the IXS `ManagedVault`'s admin roles (`DEFAULT_ADMIN_ROLE`,
  `NAV_MANAGER_ROLE`, `OPERATOR_ROLE`, `PAUSER_ROLE`). This project treats their output (NAV,
  whitelist, pause state) as trusted input.

## What happens if each one is compromised

- **`agent`**: bounded by the current tier's limits (per deposit, per vault, daily actions)
  and the account's hard cap. It cannot raise those itself, so the worst case is what the
  agent has already earned, not the whole balance.
- **`guardian`**: can only tighten, pause or reduce risk; no action it takes adds exposure.
- **`owner`**: can withdraw the whole balance (bounded by the hard cap). No multisig or
  timelock in this build; see below.
- **`operator`**: can claim fees already accrued, never principal. The owner revokes it with
  `setOperator` (setting it to the zero address disables `claimFees()` for good).
- **`SERV_API_KEY`**: an attacker spends the SERV credit. No path to funds or the vault.
- **Read-only API keys**: read calls under this project's rate limit; nothing else.
- **The IXS vault's admins**: NAV could be moved up to `maxNavChangeBps` (measured: 50%) per
  update, the whitelist turned on, or the vault paused. The health feed's `NAV_STALE`,
  `PAUSED` and `CODEHASH_CHANGED` flags can only tighten this project's exposure in response;
  they cannot prevent the vault-side compromise.

## Not defended

- **A compromised owner key** can withdraw the account's balance. No multisig, timelock or
  quorum is planned for the hackathon build.
- **The model provider's data handling.** Validation limits what gets acted on, not what
  OpenServ or its model providers keep from the prompts sent to them.
  `serv_prompt_guard`/`serv_shadow_agent` are not wired (their wire format is unknown), so no
  protection beyond the validator's own checks should be assumed.
- **The vault operator's honesty.** NAV is set by the operator, not computed from on-chain
  prices. Large single jumps and staleness are detectable; a series of small false updates
  is not.
- **RPC integrity.** Reads go through public BSC nodes with no cross-check against a second
  provider; a malicious node could serve false reads to the off-chain engine.
- **Sybil records.** `StewardFactory` only grants a new account a higher starting tier when
  the agent's record spans several distinct owners (2 for T1, 3 for T2), but it cannot tell
  whether those owners are distinct people. It exposes the numbers; a
  delegator has to read them.
- **A redemption the operator never settles** blocks that account from redeeming again (one
  pending request per account, so each payout can be measured exactly from the balance
  change). Inaction, not a hack; no emergency override. The owner's `withdraw()` of idle
  balance still works. Observed on the real vault: 2 of its 8 requests were unsettled after 63
  and 107 days on 2026-09-24 (`docs/measurement-report.md`).

## Demo infrastructure

- **Fork demo:** runs on a local Anvil fork with Anvil's public dev keys and impersonated
  balances. Those keys are public; they guard nothing of value.
- **BSC testnet run:** fresh throwaway keys kept in a gitignored file, never Anvil's public
  keys (bots drain those on public testnets). A leak loses a few cents of test BNB and mock
  tokens. The deploy script refuses any chain but 97.
- **Hosted site, server-side reads (SSRF):** `/verify`, `/app`, `/honeypot` and
  `/api/verify-paid` read the chain from the server. Locally they honour a visitor-supplied
  RPC URL; on Vercel that would let a visitor make the server fetch any address, so
  `apps/web/lib/deployment.ts` ignores it and reads only the operator-set `FORK_RPC_URL`
  (`deployment.test.ts` fails if that guard is removed). A hosted verifier result is only as
  trustworthy as that setting; the same check run locally against your own RPC is not.
- **Hosted demo chain (Render):** a public Anvil would accept any transaction and its cheat
  methods, so `deploy/demo-chain/proxy.mjs` forwards read methods only (`allowlist.test.mjs`
  fails if a write or cheat method gets through). Anvil listens on loopback inside the
  container. A bypass could falsify the demo chain, not lose funds, and a restart reloads the
  committed `state.json`.
- **Vercel or Render account compromise:** pages or a chain showing false history. No funds
  at risk. Check independently with `make demo-chain` and the verifier locally.
- **x402 gate:** `/api/verify-paid` charges on Base Sepolia (testnet); the payment test used a
  throwaway faucet-funded wallet.
- **Honeypot inbox:** submitted notices are untrusted text, sanitised and capped at 2 KB with
  an in-memory rate limit. No model reads them in this build. Closed on the hosted site.

## Weakest points, in order

1. The IXS vault's own admin surface, which this project can only observe.
2. Single-provider RPC reads feeding capacity and health.
3. The owner key, once real funds are involved.

Non-security limitations: `docs/LIMITATIONS.md`.
