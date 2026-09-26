# The reconciliation pattern

The gap this closes: a webhook/API call times out, your route handler
returns a 502 to the user, and the record of what you were trying to do
gets deleted or just never persisted. If the action actually succeeded on
the other end (the tx landed, the workflow fired), you now have no way to
find that out. The user thinks it failed, retries, and you get a duplicate
— or worse, they don't retry and a payout silently never happens.

## The fix, as a state machine

```
        create idempotency record (PENDING)
                    |
                    v
            call the external API
              /            \
        got a response   no response / timeout / 5xx
             |                       |
     positive proof of        UNKNOWN — do NOT delete
     success or failure       the record. Persist it as-is.
             |                       |
      CONFIRMED / FAILED      surfaced to a reconciliation
                              job or admin route
```

## What "reconciliation" actually means in practice

You don't need a fancy system. The minimum viable version:

1. A `status` column with `PENDING | CONFIRMED | FAILED | UNKNOWN` on
   whatever table tracks these calls.
2. A route or script — even a manually-triggered one — that takes a record
   in `UNKNOWN` and re-queries the external API for the real status (most
   execution/payment APIs have a "check status by id/key" endpoint even if
   the original call was fire-and-forget). Update the record once you get
   a real answer.
3. Alerting (even just a log line at `warn` level, or a Discord/Slack
   webhook) when a record sits in `UNKNOWN` for longer than a few minutes
   — that's your signal something needs a human look, instead of silently
   rotting in a table nobody checks.

## Worked example: a sponsored-relay route

If you have a route like `/api/relay` that submits a meta-transaction
through a third-party executor and waits for confirmation:

- **Before** the outbound call: persist `{ idempotencyKey, status: PENDING,
  userAddress, payload }`.
- If the wait/poll for confirmation times out: update to `UNKNOWN`, return
  a response to the user that says "submitted, confirming" rather than
  "failed" — because you don't actually know that it failed.
- A background job (even a cron every few minutes) re-checks anything in
  `UNKNOWN` against the executor's status-by-id endpoint and flips it to
  `CONFIRMED`/`FAILED` once it knows.

This is the single highest-leverage change you can make to a route that
currently treats "timed out" the same as "failed."
