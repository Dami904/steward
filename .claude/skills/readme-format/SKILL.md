---
name: readme-format
description: Use this whenever writing or rewriting a README — for a hackathon submission, an open-source project, a portfolio piece, or any repo someone unfamiliar will open cold. Trigger whenever the user asks to "write a README," "make the README professional/modern," "prepare this for judges/submission," or is finishing a project and about to share the repo link. Produces a judge-ready, evidence-first README structure, not a generic project-description template.
---

# README Format: Judge-Ready, Evidence-First

The goal: a stranger with two minutes — a hackathon judge, a hiring
manager, a new contributor — should be able to verify your claims
without running your code, and should never have to hunt for the thing
that would make them trust you more. Every section below exists to move
a specific piece of evidence in front of that reader at the moment they'd
otherwise doubt it.

This is not "add more sections." A three-screen CLI tool doesn't need
all twenty sections below. Use the ones that carry real weight for this
project, in this order, and cut the rest — a README padded with empty
sections reads worse than a short honest one.

## The core principle: show, don't tell

The single highest-leverage change you can make to any README: replace
an adjective with a verbatim artifact. "Fast and reliable" is a claim.
A pasted terminal block showing a real run, real numbers, and a real
timestamp is evidence. Everywhere below that says "state X," prefer
pasting the real thing X produced over describing it in prose.

## The structural skeleton, in order

### 1. Hero block
- One visual identity element above the fold — a banner image, a logo,
  or (if you have nothing else) a strong one-line tagline in large type.
  A repo with zero visual identity blends into a list of a hundred
  others; a distinctive banner is what makes someone remember which one
  yours was.
- **Badge row**, in this order, every badge linking to something real
  that actually resolves when clicked (a decorative badge is worse than
  none — it invites the reader to trust the rest of the README less once
  they notice one is fake): CI status → test count (a real number from
  your test runner) → license → live deploy link → the key stack/chain
  piece → a demo-video badge if one exists.
- **One bolded sentence that reframes the problem**, not a feature
  description. "Does it remember" describes a feature; "can you prove
  what it used and stop it touching what it shouldn't" reframes it as
  the actual hard problem. Lead with the reframe — it's usually the real
  reason the project is worth someone's two minutes.
- A short pitch paragraph: what it is, the mechanism, the trigger
  condition — one paragraph, not three.
- Optional: a horizontal strip of jump-links to the sections a skimmer
  cares about most (demo, judge-fast-path, the core proof), separated by
  `·`. This is a teaser subset of the real TOC further down, not a
  replacement for it.

### 2. Demo (if a video/GIF exists)
- A **clickable thumbnail image**, not a bare link — wrap a real preview
  frame (`img.youtube.com/vi/<id>/maxresdefault.jpg` for YouTube) in a
  link so it renders as a poster, not text.
- A **timestamped chapter table** (`0:00`, `0:30`, ...) with deep links
  (`youtu.be/<id>?t=<seconds>`) per row, so a skimming reader jumps
  straight to the 20 seconds that prove your claim instead of watching
  linearly.
- One paragraph that pre-empts skepticism: state plainly that the
  footage is real (not mocked/scripted-looking), and name the exact
  number(s) the viewer should watch for before they press play.

### 3. "Judge/reviewer in N seconds"
The single most under-used section in most READMEs. Written for the one
reader who has a stack of these and two minutes each, not for someone
who will read the whole document:
- The live link, with an honest one-line note on what's actually live
  vs. a static snapshot (say so explicitly if the hosted version can't
  run the full thing — e.g. no headless browser on serverless).
- A tiny stat table (3-5 numbers, no more): the numbers that summarize
  scope and rigor at a glance (test count, flows covered, cost per run,
  a hard behavioral guarantee like "exit 2 on regression").
- One fenced code block that is the entire "try it yourself" path in as
  few commands as truthfully possible.

### 4. Table of contents
A real one — anchor links, one per top-level heading — once the doc is
long enough that scrolling to find something is real friction (roughly:
more than 6-7 top-level sections). Skip it for a short README; forcing
one in adds noise, not credibility.

### 5. The core proof / "what it catches" / flagship evidence
This is the section that does the actual convincing, and it deserves
more space than any other:
- State the test case or scenario in one sentence, as a blockquote if
  it's a literal request/prompt.
- Paste the **verbatim, real output** — a blocked CI run, a terminal
  session, a diff, a signed transaction hash — in a fenced block, kept
  as raw output rather than reformatted into a tidy table. Reformatting
  it invites the suspicion that it was written after the fact, not
  captured from a real run.
- Then narrate the same output back in prose, walking the reader through
  what each part means and why it matters — teach them to read your
  evidence instead of just asserting the conclusion.

### 6. The problem
Short, prose only, no tables or code. State it the way a frustrated user
would feel it, not the way a spec would describe it.

### 7. What was built
A short list of the distinct pieces (the app; the tool; the pipeline),
each one sentence, followed by a single bolded sentence that names the
end-to-end loop connecting them.

### 8. Architecture
- A diagram — mermaid renders natively on GitHub and in Claude
  artifacts; keep it to the real trust/data boundaries, not every
  function call. Prefer `flowchart LR` for a short linear pipeline,
  `flowchart TD` with subgraphs when there are distinct trust zones
  (client vs. server vs. chain, etc.).
- A file-or-module → role table for anything a reader would otherwise
  have to open every file to understand.
- **Verify every label in the diagram against the actual current code
  before publishing** — an inaccurate architecture diagram is worse than
  none, because it actively misleads a reader who trusts it. If the
  project has multiple docs, cross-check the diagram against them too:
  a diagram that contradicts your own threat-model or API-notes doc is a
  correctness bug in the documentation, not a formatting nitpick.

### 9. How it decides / core algorithm
For anything with real decision logic (a gate, a scoring function, a
state machine): a numbered step list for the sequential logic, plus a
separate situation → outcome table for the policy/edge-case rules. Don't
merge these two — a list is for "in what order," a table is for
"what happens when."

### 10. The test/verification contract
If the project's credibility rests on tests or verification artifacts:
a table mapping each test/contract file → step count → what it proves,
and (if relevant) a cost/time table with a bolded totals row. Numbers
here should be real and reproducible from the repo, not estimates.

### 11. Engineering decisions (the "why," not the "what")
A flat bulleted list, each bullet a bolded one-line decision followed by
the reasoning. This is where you defend the non-obvious choices — why
this over the obvious alternative — not re-describe what the code does.

### 12. Integrity / what's staged vs. real
Include this whenever any part of the demo involved a deliberately
planted bug, seeded data, or a scripted scenario. Say so explicitly, name
the exact line/commit that was staged, and state plainly that everything
downstream of it is real and reproducible. This section is what makes
the rest of the README trustworthy — silence here, once a reader
suspects something was staged, retroactively taints every other claim in
the document.

### 13. Live product surface map
A route/page → what-it-shows table if there's a hosted app with more
than 2-3 pages. Functions as a sitemap for someone who won't click
through themselves.

### 14. Honesty: limitations
Bulleted, bold-lead-in per bullet, **in the README body itself** — not
just linked out to a separate `LIMITATIONS.md`. A reviewer who has to
click through to find your honesty about gaps will usually not click
through. If a separate limitations doc exists for depth, link it at the
end of this section, but the headline gaps belong in the README.

### 15. Tech stack
A flat list, grouped by layer (app / verification / agent / etc. — pick
groupings that mean something for this project). Name real packages and
real pinned versions where version pinning was itself a deliberate
decision worth surfacing.

### 16. Project layout
A commented ASCII directory tree — real paths that exist in the repo
right now, not an aspirational structure. Regenerate or delete this
section the moment it drifts from reality; a stale tree is one of the
fastest ways to lose a technical reader's trust (see "Keeping this
accurate" below).

### 17. Run it locally
Fenced code blocks with inline `#` comments explaining non-obvious
lines. Prefer the fewest commands that are still honestly complete —
don't hide a required manual step to make the block look shorter.

### 18. Tests
How to run them, and — if some logic is tested against a fake/mock to
avoid spending money or hitting a live network — say so explicitly, and
say what real path never runs on a fake (e.g. "no baseline or verdict
in `.lens/` ever comes from a fake").

### 19. Attribution
A dedicated section, not a footer afterthought: every third-party
library, API, model, or tool the project depends on, each with a link
and (for licensed libraries) the license. If an AI coding agent was used
to build it, say so here plainly — judges increasingly check for this,
and disclosing it costs you nothing if the engineering underneath is
real.

### 20. License
One line, linked.

## Cross-cutting rules

- **Judge-first ordering.** The reviewer's fast path (live link, judge
  section, core proof) comes before the narrative build-up. Put the
  storytelling problem/solution framing early for a general reader, but
  never bury the verifiable evidence past the halfway point of the
  document.
- **Every claim should be independently checkable.** If a sentence makes
  a claim a reader can't verify from something else in the same
  document (a link, a table, a pasted output), either add the evidence
  or soften the claim.
- **State what's real vs. mocked/staged before a reader has to find it.**
  This is the single biggest trust-multiplier available and it costs
  nothing but honesty.
- **A fixed multiplier or number in prose ages badly.** Prefer "priced
  live by X" over "you get 1.92× back" if the real number varies — a
  precise-sounding fake number is worse than an honestly vague one, and
  reads as sloppy the moment a reader tests it themselves.
- **Cross-check the README against your own other docs before
  publishing**, not just against the code. A README that contradicts
  your own `LIMITATIONS.md`/architecture doc/threat model is a
  correctness bug, and a technical reviewer who finds one inconsistency
  will go looking for more.

## Keeping this accurate over time

A polished README describing stale behavior is worse than a plain one
describing real behavior — it actively misleads. Before publishing or
re-publishing:
1. Re-derive every factual claim (version numbers, test counts, file
   paths, architecture edges) from the current code or a command you
   just ran — not from memory of what was true earlier in the project.
2. Grep the repo for anything the README claims exists (a script name, a
   config path, a component) and confirm it's still there.
3. If the project has other docs (limitations, threat model, API notes),
   read them fresh and reconcile any claim that's now stale in either
   direction — the README describing an already-fixed bug as current
   behavior, or an older doc still warning about something the README
   now claims is solved.

See `references/README.template.md` for a fill-in-the-blank skeleton
following this structure.
