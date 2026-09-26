// Measures the SERV Reasoning API behavior that docs/API_NOTES.md flags as "not yet
// measured": timeout, retry/idempotency semantics, serv_prompt_guard/serv_shadow_agent tool
// behavior, rate limits, and cost per call. Per CLAUDE.md's engineering rule ("before
// integrating any external API that moves money or state, spend real time mapping its failure
// modes... write it down in docs/API_NOTES.md before writing the client"), this needs to run
// BEFORE packages/serv-client's transport assumptions (30s timeout, 2-attempt 5xx-only retry —
// see packages/serv-client/src/client.ts's header comment) are trusted as more than
// placeholders.
//
// This agent does not read .env, so it cannot run this itself (CLAUDE.md: "Don't read .env*,
// keystores, or secret directories") — run it yourself, with your own SERV_API_KEY in .env,
// and paste the findings into docs/API_NOTES.md's SERV section, replacing each "ASSUMPTION"
// comment in packages/serv-client/src/client.ts with the measured value.
//
// Usage (prefer `make live-serv-probe`, which passes the flag below for you):
//   node --env-file-if-exists=.env --experimental-strip-types scripts/live-serv-probe.ts
// Node does not load .env files on its own — `--env-file-if-exists` is required or
// SERV_API_KEY will read as unset even with a real key sitting in .env.
// Reads SERV_API_KEY and SERV_BASE_URL from process.env (see .env.example) — this script
// itself reads them at ITS OWN runtime when YOU run it; nothing here is read by the agent
// session that wrote this file. Cost: each probe below uses a short prompt and a low
// max_completion_tokens; total should be a small fraction of a cent per run, but this makes
// real, billed calls — do not put this in CI or run it in a loop.

import { chatCompletion } from "../packages/serv-client/src/client.ts";

const rawApiKey = process.env["SERV_API_KEY"];
const baseUrl = process.env["SERV_BASE_URL"] ?? "https://inference-api.openserv.ai";
const model = process.argv[2] ?? "gpt-5.4-mini";

if (rawApiKey === undefined || rawApiKey.length === 0) {
  console.error("SERV_API_KEY is not set (check your .env). This script must be run with a real key.");
  process.exit(1);
}
// Reassigned to a `string`-typed binding (not just a narrowed `string | undefined`) so the
// closures passed to probe() below — hoisted into `main`, a function declaration TS can't
// prove runs only after the check above — see it as unconditionally `string`.
const apiKey: string = rawApiKey;

interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs: number;
}
const results: ProbeResult[] = [];

async function probe(name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, elapsedMs: Date.now() - start });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err), elapsedMs: Date.now() - start });
  }
}

async function main(): Promise<void> {
  // 1. Baseline latency and cost (usage tokens), confirming the already-measured
  // max_completion_tokens requirement still holds and capturing actual response time.
  await probe("baseline_chat_completion", async () => {
    const res = await chatCompletion({
      apiKey, baseUrl, model,
      messages: [
        { role: "system", content: "Respond with exactly one word." },
        { role: "user", content: "Say OK." },
      ],
      maxCompletionTokens: 10,
    });
    return JSON.stringify(res);
  });

  // 2. Raw fetch (bypassing packages/serv-client) with a `tools` array in the OpenAI-standard
  // shape, naming serv_prompt_guard/serv_shadow_agent per PLAN_v2 section 9's terminology.
  // CONFIRMED BROKEN as of 2026-09-22 (docs/API_NOTES.md): returns a clean 400,
  // "Supported values are: 'function' and 'custom'" — kept here (cheap, informative) as a
  // regression check that the endpoint's error behavior hasn't silently changed.
  await probe("tool_use_serv_prompt_guard_shadow_agent_exploratory", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Respond with exactly one word." },
          { role: "user", content: "Say OK." },
        ],
        max_completion_tokens: 10,
        tools: [{ type: "serv_prompt_guard" }, { type: "serv_shadow_agent", hint: "test", max_iterations: 1 }],
      }),
    });
    const text = await res.text();
    return `status=${res.status} body=${text.slice(0, 800)}`;
  });

  // 2b. Follow-up exploratory probe: probe 2's 400 confirmed `type` must be `function` or
  // `custom` — this tries the OpenAI "custom tool" shape as the next-best guess for how
  // serv_prompt_guard might actually be named. Still a guess, not a confirmed finding; if
  // this also 400s, the error message itself is the next data point, same as probe 2.
  await probe("tool_use_custom_type_exploratory", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Respond with exactly one word." },
          { role: "user", content: "Say OK." },
        ],
        max_completion_tokens: 10,
        tools: [{ type: "custom", custom: { name: "serv_prompt_guard" } }],
      }),
    });
    const text = await res.text();
    return `status=${res.status} body=${text.slice(0, 800)}`;
  });

  // 3. Timeout behavior: does the provider itself ever hang past a normal request/response
  // cycle, or does it always resolve quickly even under a large max_completion_tokens? A
  // short client-side timeout here (5s) will show whether 30s (client.ts's current default)
  // is generous or already too tight for a real generation.
  await probe("timeout_check_5s_budget", async () => {
    const res = await chatCompletion({
      apiKey, baseUrl, model, timeoutMs: 5000, maxAttempts: 1,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write two sentences about vault liquidity." },
      ],
      maxCompletionTokens: 200,
    });
    return JSON.stringify(res);
  });

  // 4. Rapid burst (5 calls back to back) to surface a rate limit, if any, and its response
  // shape (429? Retry-After header? a JSON error body?).
  for (let i = 0; i < 5; i++) {
    await probe(`burst_call_${i}`, async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: "Reply with just: OK" }],
          max_completion_tokens: 5,
        }),
      });
      const retryAfter = res.headers.get("retry-after");
      return `status=${res.status}${retryAfter !== null ? ` retry-after=${retryAfter}` : ""}`;
    });
  }

  console.log(JSON.stringify(results, null, 2));
  console.log("\nPaste the findings above into docs/API_NOTES.md's SERV section, and update");
  console.log("the ASSUMPTION comments in packages/serv-client/src/client.ts with measured values.");
}

main();
