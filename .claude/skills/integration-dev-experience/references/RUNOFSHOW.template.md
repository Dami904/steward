# <Project> — live demo run-of-show

**Thesis in one line:** <the one bolded reframe sentence from the README>.

Target: <2-3 minutes>, then Q&A. Lead with feeling, escalate to proof,
close on the thesis. Every claim on screen should be live, not a screenshot,
unless the contingency plan below has kicked in.

---

## Pre-flight (before you walk up)

- [ ] App running locally or on the live deploy URL, correct tab open.
- [ ] Terminal tab ready, large font, pre-authenticated (wallet/API keys
      already set so you're not typing secrets on stage).
- [ ] Any state the demo depends on (a granted permission, a seeded
      record, a funded test wallet) is reset to its starting condition.
- [ ] Backup tabs pre-opened in case wifi is slow: the on-chain
      explorer link, the recorded demo video, the deployed app.
- [ ] Decide the one moment you want the room watching closely (a
      revoke, a failure, a before/after) and plan a beat of silence
      around it — don't talk over your own best moment.

## Cold open — the problem (0:00–0:20)

> "<one or two sentences that state the problem the way a frustrated user
> would feel it, not the way a spec would describe it.>"

## Act 1 — the feel (0:20–1:15)

Walk through the ordinary happy path first, so the audience has a mental
model before you show them the hard part. Narrate what's actually
happening under the hood as you go, don't just click through silently.

## Act 2 — the proof (1:15–2:15)

This is where you show the thing a screenshot can't fake: a live
on-chain transaction, a revoked permission that's actually enforced, a
number that's actually computed rather than hardcoded. Say out loud what
would happen if you were lying, then show that it doesn't.

## Close — the thesis + the ask (2:15–end)

> "So: <restate the one-line thesis>. Everything you just saw is live at
> <url> right now. Thank you."

Land it, stop talking, take questions. Don't keep selling after the ask.

---

## If something breaks (write this before you need it)

- **Network/wifi flaky:** <what degrades gracefully, and the exact line
  you say instead of apologizing for it — e.g. "this falls back to a
  deterministic mock, the logic you're seeing is identical, only the
  network calls change">.
- **Live app won't load:** <the fallback: recorded video, a second
  deployment, a local instance>.
- **A command misbehaves on stage:** <the step you skip straight to>.
- **Everything dies:** <the single strongest static artifact you can
  screen-share instead, e.g. a block explorer link or a signed receipt,
  that proves the claim without the app running at all>.
