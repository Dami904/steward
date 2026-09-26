# Threat model

Keep this short and current. Its job is to state trust assumptions
explicitly so they can be checked, not to be exhaustive.

## Trusted parties / keys

<!-- List every key, wallet, role, or service account that has real power
in this system, and exactly what it can do. Example: -->
- `RELAYER_PRIVATE_KEY` — pays gas for sponsored transactions. Can spend
  its own gas balance; cannot move user funds directly.
- `<admin role / owner address>` — can pause/upgrade `<contract>`. Held by
  <EOA / multisig / etc>.

## What happens if each one is compromised

<!-- For each entry above, one or two sentences: what's the actual blast
radius. Example: -->
- If `RELAYER_PRIVATE_KEY` leaks: attacker can drain its gas balance by
  spamming sponsored calls. It cannot move user deposits — worst case is
  a bounded financial loss capped at the relayer's balance, and the relay
  route stops sponsoring transactions once it's empty.

## Not defended — be explicit

<!-- Say what you haven't defended against, plainly. This is the section
that builds trust — an honest "we haven't hardened X yet" reads better to
a reviewer than silence that turns out to hide the same gap. For each
one, name the actual mechanism that's missing, not just the topic.
Example: -->
- **A compromised owner/admin key.** Whoever holds it can grant anything.
  There is no multisig, no timelock, no quorum. This is the single
  largest concentration of risk in the system.
- **The model/service provider**, if this involves handing data to a
  third-party API you don't control: your gate limits what's sent, it
  cannot limit what the recipient retains afterward.

## Known weaknesses worth attacking first

<!-- A short, ranked list, most exploitable first. Writing this list
yourself, before a reviewer or auditor does, is what makes the rest of
the document credible. A threat model that only lists solved problems is
marketing, not a threat model. -->
1. <the weakest point, plainly named>
2. <the second weakest point>

## Known limitations

<!-- Link to or duplicate the relevant parts of docs/LIMITATIONS.md if you
keep that as a separate file. -->

Found something else? That's the point of writing this down.
