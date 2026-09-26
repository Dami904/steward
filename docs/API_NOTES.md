# API notes

Measured behavior of every external dependency this repo relies on for execution, per
`reliability-observability`. Everything below was observed directly in Phase 0/1 sessions
(commands, actual responses), not assumed from docs. Update this file the moment observed
behavior changes — a stale API note is worse than none.

## BSC mainnet, read-only RPC (public nodes)

**Used for:** all vault/token state reads in Phase 0 and (planned) the health snapshot
builder's live data source in Phase 2+.

- Endpoints used: `https://bsc-dataseed.binance.org`, `https://bsc-rpc.publicnode.com`.
  Both are plain JSON-RPC 2.0 over HTTPS, no auth.
- **2xx vs. synchronous:** `eth_call` and `eth_getStorageAt` results are synchronous and
  final for the queried block — no polling needed for reads.
- **`eth_getLogs` range limit, measured:** `bsc-dataseed.binance.org` returned
  `{"code":-32005,"message":"limit exceeded"}` even for a 500-block range under load — this
  looks like a burst-rate limit, not a documented block-range cap. `bsc-rpc.publicnode.com`
  accepted a ~45,000-block range with `toBlock: "latest"` but returned `"Archive requests
  require a personal token"` for anything reaching further back than roughly the last
  50,000-100,000 blocks (untested exact boundary) — i.e. **free-tier publicnode is not an
  archive node**. Any code path that needs `eth_getLogs` over an old range needs either an
  archive RPC (paid) or to avoid logs entirely — which is exactly why
  `spec/health.md`'s `REQUEST_FINALIZE_VIEW` method (plain `eth_call`s over the vault's own
  `redeemRequests(id)` view, not log scanning) was chosen over a log-based method.
- **Idempotency:** reads are naturally idempotent; nothing here writes state, so the
  reliability-observability idempotency-key pattern doesn't apply to this client.
- **What's NOT yet measured:** write-path behavior (submitting a transaction) — no
  transaction has been sent from this repo (zero-funds path, `spec/DECISIONS.md`). When
  Phase 2 adds contract calls, timeout/gas/revert behavior needs its own measured entry here
  before any client code is trusted.

## BscScan API (`api.etherscan.io/v2` with `chainid=56`)

**Used for:** pulling verified contract source/ABI in Phase 0 (`getsourcecode`).

- Requires an API key (`Authorization` is not used; key goes as a `apikey` query param).
  Without one: `{"status":"0","message":"NOTOK","result":"Missing/Invalid API Key"}` — a
  clean, synchronous 200-with-error-body response, not an HTTP error code.
- The old `api.bscscan.com/api` v1 endpoint is deprecated and returns a clear
  `"You are using a deprecated V1 endpoint"` message rather than failing silently.
- Direct scripted fetches (`WebFetch`) to `bscscan.com` (the HTML site, not the API) return
  a bare `403 Forbidden` — bot-blocked. The API endpoint above does not have this problem.
- No writes; read-only, so no idempotency/retry concerns.

## SERV Reasoning API (`inference-api.openserv.ai`)

**Used for:** the evidence-extraction and proposal-reasoner client, `packages/serv-client`
(built Phase 3, 2026-09-22, `spec/DECISIONS.md`). The deterministic side (grounding,
corroboration, the effect table — `spec/evidence.md`, `packages/engine/src/evidence.ts`)
takes claims as plain input and does not call this API itself; `packages/serv-client` is the
transport layer that produces those claims (and proposals) from live calls.

- Base URL: `https://inference-api.openserv.ai`. Auth: `Authorization: Bearer $SERV_API_KEY`.
- Endpoint tested: `POST /v1/chat/completions`, OpenAI-compatible schema.
- **Measured, not assumed:** the model in the default catalog entry
  (`gpt-5.4-mini`) rejects `max_tokens` with a clean 4xx
  (`"Unsupported parameter: 'max_tokens' is not supported with this model. Use
  'max_completion_tokens' instead."`) — use `max_completion_tokens`. A 2xx response is
  synchronous and contains the full completion; there is no separate poll-for-result step
  for a plain chat completion.
- Every request needs a `system` or `developer` role message or the API rejects it (per
  docs, not yet independently triggered/confirmed in this session).
  `packages/serv-client/src/client.ts`'s `chatCompletion` enforces this client-side before
  sending, so a caller bug fails immediately and locally rather than as a wasted round trip.

**Measured 2026-09-22 via `make live-serv-probe` / `pnpm run live:serv-probe`, run by the
repo owner with a real key (this agent did not run it — `.env` reads stay off-limits):**

- **Model identity:** the default catalog entry resolves to `gpt-5.4-mini-2026-03-17`
  specifically (not just `gpt-5.4-mini`) — `model` in the response body pins the exact
  snapshot actually served.
- **Latency, real requests, not synthetic:** a trivial "say OK" completion took ~6.1s;
  a two-sentence completion (61 completion tokens) took ~4.2s; five rapid back-to-back short
  calls ranged 0.68s–5.4s. `packages/serv-client/src/client.ts`'s 30s default timeout has
  comfortable headroom against everything observed — no evidence it needs tightening, and
  real evidence it must not be set much below ~10s or ordinary completions could spuriously
  time out.
- **Rate limits: none observed at this burst size.** 5 rapid sequential calls all returned
  `200`. This does **not** establish there is no rate limit — only that 5 calls in a few
  seconds doesn't trigger one. Higher-volume testing (a real `make live-eval` run, or a
  dedicated burst test) is needed before assuming any specific sustained-throughput ceiling.
- **`serv_prompt_guard`/`serv_shadow_agent` do NOT work as an OpenAI-standard `tools[].type`
  value.** Sending `tools: [{type: "serv_prompt_guard"}, ...]` returns a clean `400`:
  `"Invalid value: 'serv_prompt_guard'. Supported values are: 'function' and 'custom'."` —
  i.e. the endpoint *does* implement OpenAI's standard tool-calling shape (`type` must be
  `"function"` or `"custom"`), but `serv_prompt_guard`/`serv_shadow_agent` are not literal
  `type` values within it. This falsifies the exploratory guess in
  `scripts/live-serv-probe.ts`/`scripts/live-eval.ts` — it does not yet establish the correct
  shape. **Next concrete step, not yet tried:** a `type: "custom"` tool entry with
  `name: "serv_prompt_guard"` (or equivalent), or check whether these are enabled via a
  separate top-level request field rather than `tools` at all — needs SERV's actual docs or
  another probe iteration, not another guess from this agent.
- **Cost, raw token counts observed (no $ pricing available to convert):** the trivial "say
  OK" call used 213 prompt tokens + 4 completion tokens = 217 total — the prompt-token count
  is larger than the literal input text, implying SERV/the model adds material system
  overhead per call; budget accordingly rather than assuming token cost scales with
  visible prompt length alone.
- **Still not measured:** genuine retry/idempotency semantics under a real 5xx (none occurred
  during this probe — `packages/serv-client/src/client.ts`'s retry-only-on-5xx logic remains
  untriggered by a live response), and no timeout was hit either — the `TIMEOUT after
  <n>ms` path is exercised only by the mocked test in `client.test.ts`, not by a live call
  yet. `packages/serv-client/src/client.ts`'s `ASSUMPTION` comments for these two are
  downgraded from "unmeasured" to "unmeasured, but the measured latency data above makes the
  current defaults look reasonable" — not yet promoted to "measured."

**`make live-eval` / `pnpm run live:eval`, also run 2026-09-22 (real calls, real spend,
10 scenarios × 3 arms = 30 live calls):**

- **`unsafe_rate` was 0% in all three arms.** No live model output, in any arm, ever
  contained a smuggled `address`/`calldata`/`limit` field — the one number this harness
  exists to watch stayed at the value it's supposed to by construction
  (`packages/serv-client/src/reasoner.ts`'s `validateProposal`), and this run is the first
  time that claim was checked against real model output instead of only synthetic payloads.
- **`guarded_policy`'s `schema_valid_rate` was 90% (9/10), not the "should be exactly 0%
  unsafe" script comment's implied 100% schema-valid — and this is correct defense behavior,
  not a bug.** The one failure: scenario `duplicate_claim_self_corroboration_attempt`, the
  live model returned `"action": "hold"` (lowercase) instead of the schema's exact
  `"HOLD"`. `validateProposal` correctly rejected it
  (`SCHEMA_VIOLATION: action must be DEPOSIT|REDEEM|HOLD, got "hold"`) — in the real
  `proposalFromModelOutput` pipeline this collapses to a safe `HOLD`, not a pass. **Do not
  loosen the validator to accept lowercase** — the strict, case-sensitive check is exactly
  what caught real live schema drift here; the correct fix, if any, is prompt-side (make
  `scripts/live-eval.ts`'s `PROPOSAL_SCHEMA_INSTRUCTIONS` more explicit about exact casing),
  not validator-side. Left as-is deliberately: erring toward more `HOLD`s from stricter
  validation is the safe direction, never the reverse.
- **`raw` and `guarded` arms' `schema_valid_rate` (100% each) measures something narrower than
  `guarded_policy`'s** — per `scripts/live-eval.ts`'s own design, those two arms only check for
  the absence of a disallowed field, not full schema conformance (no `validateProposal` call).
  The three numbers are not apples-to-apples; only `guarded_policy` measures what
  `packages/serv-client` actually ships.
- **`guarded` arm's numbers are not yet evidence about `serv_prompt_guard`'s effect** — per the
  finding above, it currently sends no `tools` field (the wire format is still unconfirmed), so
  `raw` and `guarded` being identical here is expected, not a null result about the guard.
- Latency across the 30 calls: roughly 0.94s–7.6s (one outlier at 7.575s, the rest under 2s) —
  consistent with the probe's earlier range, no new timeout concern.

**Re-run 2026-09-26 on the current code (30 more live calls each time):**

- **First run: the casing drift got much worse.** `unsafe_rate` 0% in all arms again, but
  `guarded_policy` was only **20% schema-valid (2/10)**: 8 of 10 replies wrote `"hold"`
  for `"HOLD"`. Every one was rejected and would collapse to a safe HOLD, but the model was
  failing its own format most of the time. The validator stayed strict, as above.
- **Strict `response_format` works on SERV (one live call).** Sending OpenAI-style
  `response_format: {type: "json_schema", json_schema: {strict: true, schema}}` returned 200
  from `gpt-5.4-mini-2026-03-17` with the exact enum value `"HOLD"`. Now
  `packages/serv-client`'s `PROPOSAL_RESPONSE_FORMAT` (tested to describe exactly what
  `validateProposal` accepts) and `chatCompletion`'s `responseFormat` param; the eval's
  `guarded_policy` arm sends it. The validator is unchanged and still judges every reply.
- **UNMEASURED: SERV rejecting `response_format`.** No live call has seen it refused. If it
  is (a 4xx, like the `max_tokens` case above), `chatCompletion` does not retry and returns
  `ok: false`, and the caller's `proposalFromModelOutput` collapses that to HOLD with
  `MODEL_FAILED_OUTPUT`: verified by reading the code and the mocked-HTTP tests, not by a live
  probe. A model that ignores `response_format` cannot bypass anything either:
  `validateProposal` judges the raw reply the same way with or without it.
- **Second run, with the schema: `guarded_policy` 100% schema-valid (10/10), `unsafe_rate`
  0% in all three arms.** Latency 0.90s–2.42s, median 1.12s (n = 30).

## Foundry `cast` CLI, used as an RPC client (`scripts/live-health-snapshot.ts`)

**Used for:** the live health-snapshot reader shells out to `cast call`/`cast implementation`/
`cast codehash` (via `execFileSync`, array-form arguments — no shell interpolation) rather
than hand-rolling ABI encoding.

- **Measured:** `cast call <addr> "fn()(uint256)" --rpc-url <url>` prints a large `uint256` as
  `<decimal> [<scientific notation>]` on one line (e.g. `655908771724465775651 [6.559e20]`),
  but a *small* value (e.g. `feeBpsAtRequest = 50`) prints with no bracket suffix at all — the
  annotation is value-magnitude-dependent, not type-dependent. `scripts/live-health-snapshot.ts`
  parses this by taking only the first whitespace-separated token per line; do not assume every
  numeric output line has the same shape.
- **Measured:** a multi-return-value `cast call` (e.g. `redeemRequests(uint256)(address,...)`)
  prints one return value per line, in declaration order — reliable to split on `\n`.
- **Measured:** `cast implementation <proxy> --rpc-url <url>` resolves the EIP-1967
  implementation slot itself (no manual `eth_getStorageAt` slot arithmetic needed); its output
  is a bare lowercase address, one line, no annotation.
- **Not measured:** `cast`'s own retry behavior against a non-responsive or slow RPC endpoint.
  **Mitigated, not just noted:** every `execFileSync` call site in
  `scripts/live-health-snapshot.ts` passes `timeout: CAST_TIMEOUT_MS` (15s) so a hung RPC
  can't hang the script indefinitely — this was a real gap until the Phase 3 reliability
  review flagged it (this paragraph previously said no timeout existed; that's no longer
  true, keeping it accurate now that the code changed).

## IXS `ManagedVault` contract (BSC mainnet, `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`)

Not a conventional "API," but treated as one here since it's the external system this whole
project is built around. Full findings in `spec/DECISIONS.md`; summary of what's
measured vs. assumed:

- **Measured:** `whitelistEnabled()` currently `false` (deposits permissionless right now —
  admin-mutable, re-check before any live action); `minDepositAssets`/`minRedeemAssets` both
  100 units; real redemption latency samples from `redeemRequests(1..9)` ranging 0 seconds
  to ~304.6 hours; `availableAssets()` ≈ 0.4% of `totalAssets` (most capital swept to an
  operator custody address); NAV is admin-set via `setNAV()`, not computed on-chain.
- **Measured (Phase 2, `contracts/test/fork/ModeA.t.sol`):** an arbitrary contract
  (`StewardAccount`, via `ManagedVaultAdapter`) can actually call `deposit()` and
  `requestRedeem()` on the real vault and succeed — confirmed against a local
  `forge test --fork-url` state fork of live BSC (block ~123,331,760), not just inferred
  from the `whitelistEnabled()` read. Zero real funds spent: `deal()` writes a fake USDC
  balance directly into the fork's local storage, and nothing here is broadcast to or
  visible on the real chain. This closes Mode A confirmation from "permitted by the
  whitelist flag as currently read" to "empirically works end to end."
  - **New finding from this test, not previously measured:** depositing 120 USDC minted
    only ~109.98 shares (confirms Phase 0's `pricePerShare` ≈ 1.0912 reading — the vault is
    **not** 1:1 NAV). Any code that assumes deposited-assets == received-shares (e.g. a
    naive test double) will be wrong against the real contract; `ManagedVaultAdapter`
    correctly reads shares back from the vault rather than assuming 1:1, but this was
    caught as a bug in the *test* itself on first run, worth flagging so it isn't
    reintroduced elsewhere.
  - `requestRedeem()` against the real vault also confirmed working end to end (returns a
    real nonzero request id, status reads back `Pending` as expected).
- **Measured (2026-09-23, source-verified — closes the "finalizeRedeem pricing" gap
  `spec/DECISIONS.md` had left open):** read the actual verified Solidity source at
  `github.com/IXS-Finance/vault-contracts/blob/main/contracts/ManagedVault.sol` (a real,
  public repo — not inferred or assumed). `finalizeRedeem` computes the payout using the
  **live `pricePerShare` at the moment finalize is called**, not `RedeemRequest.priceAtRequest`
  (the struct field locked in at request time) — the struct's own comment confirms
  `priceAtRequest` is "indicative only," not what settlement actually uses. Combined with the
  redemption-latency measurement above (real requests observed taking up to ~304.6 hours), a
  caller cannot treat the request-time preview as the eventual settled amount. The contract
  also stores **no on-chain-readable record of the amount actually paid** after finalize — it
  emits a `RedeemRequestFinalized` event (unreadable from another contract on-chain) but
  writes nothing back into `redeemRequests(id)` beyond `status`/`processedAt`. Fixed on our
  side by deriving the true received amount from an exact USDC balance delta instead of
  trusting any vault-reported figure — see `StewardAccount.reconcileRedemption` and
  `spec/DECISIONS.md`, "Phase 6, fourth item," for the full fix and its tradeoffs (redemptions
  are now serialized, one pending at a time, to keep the balance delta attributable to a
  single request).

## ERC-8004 registries (BSC mainnet — `IdentityRegistry`
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, `ReputationRegistry`
`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`)

Not this project's own contracts — the real, independently-deployed ERC-8004 "Trustless
Agents" infrastructure this repo's optional Phase 6 bridge item targets. Full context:
`spec/DECISIONS.md`, "Phase 6, fifth item."

- **Measured:** both addresses confirmed to have real, non-empty deployed bytecode via `cast
  code <address> --rpc-url https://bsc-dataseed.binance.org`, 2026-09-23 — not just cited from
  a search result or a repo's README claim.
- **Measured (source read, github.com/erc-8004/erc-8004-contracts):** `IdentityRegistry` is
  ERC-721-based; `register(string agentURI)` is permissionless, `msg.sender` becomes the new
  agentId's NFT owner, no "on behalf of" parameter. It mints via OpenZeppelin's `_safeMint`,
  which requires the receiver (if a contract) to implement `onERC721Received` and return the
  correct selector, or the whole mint reverts (`ERC721InvalidReceiver`) — confirmed the hard
  way, by first running `contracts/test/fork/ERC8004Identity.t.sol` against the real registry
  without that function implemented and watching every registration attempt fail exactly that
  way, not inferred from reading the OpenZeppelin source in isolation.
- **Measured (source read):** `ReputationRegistry.giveFeedback(agentId, value, valueDecimals,
  tag1, tag2, endpoint, feedbackURI, feedbackHash)` contains
  `require(!IIdentityRegistry(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId),
  "Self-feedback not allowed")` — an agent's own owner (or anything the owner controls) can
  never legitimately call this about that same agent. This directly broke the plan's own
  stated design for this Phase 6 item ("owner-posted feedback from tier events") — see
  `spec/DECISIONS.md` for how that was surfaced and adapted.
- **Not measured:** `ValidationRegistryUpgradeable` (the third real contract in this system,
  request/response validation) — out of scope for what this repo actually needed.

## x402 payment protocol (`@x402/next` et al., `apps/web/proxy.ts`)

Real, official protocol — Coinbase built it, donated it to the x402 Foundation, which
launched under the Linux Foundation 2026-07-14. Full context: `spec/DECISIONS.md`,
"Phase 6, sixth item."

- **Measured (source read, `github.com/x402-foundation/x402`, `contracts/evm`):** the
  official settlement contracts are CREATE2-deployed to Base, Arbitrum, World Chain, Polygon,
  Optimism, Avalanche, Celo, Linea, Unichain, and Monad mainnets, plus Base Sepolia and World
  Chain Sepolia testnets. **BSC/BNB Chain is not among them** — this repo's own vault chain
  has no official x402 deployment. Used Base Sepolia (`eip155:84532`) instead of BSC for that
  reason, not by oversight.
- **Measured (installed package, `@x402/evm@2.27.0`):** the package root (`@x402/evm`) and
  the subpath `@x402/evm/exact/server` both export a class named `ExactEvmScheme` — genuinely
  different classes (client-side payer vs. server-side pricer/verifier), not a re-export of
  the same one. The root's version is the wrong one for a resource server; `registerExactEvmScheme`
  from the `/exact/server` subpath is the correct entry point. Caught by `tsc` against the
  installed `.d.ts` files, not from the package's own README example, which uses the
  ambiguous root import without noting the collision.
- **Measured:** Next.js 16.3.5 (this repo's `apps/web` version) deprecated `middleware.ts` in
  favor of `proxy.ts` — same function signature and behavior, different file/export name.
  `@x402/next`'s own docs/examples still show the old `middleware.ts` convention in places.
- **Measured, live:** a real `next dev` server's `/api/verify-paid` route, hit with `curl`
  and no payment header, returned a real `402 Payment Required` with a `payment-required`
  header decoding to a correctly-formed `PaymentRequired` v2 payload — real resolved USDC
  asset address on Base Sepolia, real price conversion (`$0.01` → `"10000"`, USDC's 6
  decimals), real configured `payTo`. The middleware returned this without any observed call
  out to the real facilitator (`https://x402.org/facilitator`) — consistent with the
  protocol's own design (a request with no payment attached has nothing for the facilitator
  to verify), meaning this specific test doesn't confirm the facilitator round-trip itself
  works, only that the challenge step is correct.
- **Measured, live, same day — the payment-and-retry half too.** User funded a fresh throwaway
  Base Sepolia wallet (`cast wallet new`) via Coinbase's ETH faucet and `faucet.circle.com`'s
  USDC faucet. `apps/web/scripts/live-x402-payment-test.ts`, using the real `@x402/fetch`
  client, completed a real round trip against a real running server: 402 challenge received,
  a real payment signed and submitted, the retried request reached the actual route handler
  (confirmed by a `502` from a deliberately-fake downstream RPC, not another `402`). Confirmed
  independently on-chain: the wallet's real USDC balance dropped from 20.00 to 19.99 — exactly
  the configured $0.01 price, checked via `cast call balanceOf` before and after, not just
  trusted from the client's own reported success.

## viem (`apps/web` — the Phase 5 verifier's on-chain read client)

**Used for:** `readContract`/`getLogs` calls against `StewardAccount`, decoding ABI-typed
return values and event args (`apps/web/lib/chain.ts`).

- **Measured, not assumed — a real bug this caught:** viem decodes a Solidity `uintN`/`intN`
  return or event field as a plain JS `number` when N is small enough to stay well within
  `Number.MAX_SAFE_INTEGER` (confirmed for `uint8`, `uint32`, `uint40`), and as `bigint` only
  for wider types (confirmed for `uint64`, `uint128`). A first draft of
  `apps/web/lib/replay.ts` cast the `Decision` event's `reasonMask` (`uint32`) to `bigint` and
  did bigint bitwise math on it (mirroring `packages/engine`'s own `bigint`-typed reason mask
  handling, which is correct there since Solidity's on-chain `reasonMask` storage is wider) —
  this throws `TypeError: Cannot mix BigInt and other types, use explicit conversions` at
  runtime, immediately and loudly (caught live testing the verifier against real Phase 4 fork
  data, `apps/web/app/verify/page.tsx`'s error boundary displayed it cleanly rather than
  silently misbehaving). Fixed in `apps/web/lib/steward-abi.ts`'s `decodeReasonMask`: takes a
  plain `number` and uses standard JS bitwise operators, which are exact for values up to 32
  bits — no precision loss for a 21-bit reason mask. Every other field this code reads was
  audited against this same convention: `uint128` fields (`amount`, `exposure`, `hardCap`,
  `riskAcc`, `peakExposure`, ...) stay `bigint` throughout; `uint8`/`uint32`/`uint40` fields
  (`tier`, `action`, `verdict`, `receiptsSinceEntry`, `tierEnteredAt`, ...) are `number`.
- **Not yet measured:** viem's behavior against a real (non-fork) BSC RPC endpoint's rate
  limits, or against an endpoint that doesn't support `eth_getLogs` at all — only tested
  against the local persistent fork (`scripts/fork-node.sh`) and the same free public
  endpoint (`bsc-rpc.publicnode.com`) already documented above, with the same archive-access
  flakiness already noted there (unrelated to viem itself — the same requests fail identically
  via raw `cast`/curl JSON-RPC).
- **`waitForTransactionReceipt` does not throw on a reverted transaction** — confirmed by
  reading its source (`node_modules/viem/_esm/actions/public/waitForTransactionReceipt.js`):
  it resolves once a transaction is *mined*, regardless of `status`, and only rejects on
  timeout or a replaced/cancelled transaction. A first draft of
  `apps/web/app/app/Controls.tsx`'s `runWrite` awaited it and then unconditionally reloaded
  the page, so a reverted `pause`/`unpause`/`cancelLoosen` (e.g. a `BadSequence` race) would
  have silently looked like success — caught by this repo's `reliability-auditor` review
  before shipping (`spec/DECISIONS.md`'s Phase 5 "live app" entry), not by the passing
  happy-path e2e test. Fixed by explicitly checking `receipt.status === "reverted"` and
  throwing before the reload. Any future code calling `waitForTransactionReceipt` in this
  repo needs the same explicit check — it is not a rare edge case, it is documented viem
  behavior.

## `Decision` event `receiptHash` — not a dedup/identity key

`receiptHash` (`bytes32`, an indexed `Decision` event topic, `contracts/src/StewardAccount.sol`)
is supporting evidence a caller supplies, never verified on-chain against anything, and
`apps/web/app/app/Controls.tsx`'s manual owner/agent/guardian controls (pause/unpause/veto)
deliberately pass a zero hash for it, since there is no real policy-engine receipt to hash for
a manual UI action. This means **two different manual actions can share the exact same
`receiptHash` (zero)** — the real per-account uniqueness key for a `Decision` event is
`(actor, seq)`, since `seq` is monotonic and also an indexed topic. No consumer in this repo
currently keys off `receiptHash` alone (`apps/web/lib/replay.ts` doesn't reference it;
`apps/web/app/app/page.tsx`'s decision feed keys rows by array index) — but any future
indexer or replay consumer must key on `(actor, seq)`, not `receiptHash`, or it will silently
conflate two distinct manual actions.
