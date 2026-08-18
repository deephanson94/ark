# ADR-0048 — the free hint *is* the difficulty model, and the player took it away

**Status.** Accepted. Restores ADR-0008 decision 1 as written; supersedes nothing, because the rule
it restores was never amended — it was diverged from without a record, twice.

## The divergence

ADR-0008 decision 1 says, in as many words:

> Hover and selection highlight **direct importers only (depth 1)**, for every node, always — in free
> roam and while a challenge is open alike. […] No modal special-casing and no per-subject
> suppression: the rule must not depend on whether a challenge is open, because the leak happens at
> the moment of *choosing* the subject.

and lists under **Rejected**:

> *Suppress everything while a challenge is open* — fixes nothing at the moment of choosing, and
> costs §9's "the world stays visible behind the scrim".

`src/verbs/gate.ts` says the same thing from the other side, about the same guess:

> **`directImporters` is deliberately absent.** ADR-0008 gives depth 1 away on the map on purpose,
> and §8.4 measures `surprise` against exactly that guess. A question that strategy passes is an
> *easy* question, which the progression needs — not a broken one.

The player did it anyway. A cold playtester used a subject's ring as a lookup; it was measured —
**37 of ark's 40 Blast Radius boards drew at least one key member, 81 of 216 members in all**, 94–96%
on hono and graphql-js — and the whole import channel was switched off while any board was open. A
later round narrowed that to import-graded boards, restoring it for the two verbs graded on git.

**No ADR was written for either step, and the comment that shipped with the second cited decision 1
as its authority on the line that nulled it** — *"what is restored is `DIRECT_ONLY`, the hint
ADR-0008 decision 1 gives away to everyone at all times"*, directly above
`radius: importGraded(challengePanel) ? null : radius`. That is this repository's signature failure
with the polarity reversed: usually a rule stated in an ADR is not implemented; here a rule *is*
implemented, in the ADR, and the code overrode it while quoting it.

## Why the ADR was right and the fix was wrong

Two arguments, and the second is the one nobody had.

**It fixed nothing.** Decision 1's own reasoning: the leak happens when you choose a subject, not
when you answer about it. Close the board, hover, reopen. A speed bump, not a gate.

**It disabled the difficulty model.** §8.4 defines

    surprise = |truth Δ naiveGuess| / |truth|,  naiveGuess = "only direct neighbours matter"

so a player who cannot see direct neighbours **cannot form the guess the difficulty is calibrated
against**. Every board the progression classifies as easy is only easy relative to a player holding
the free hint, and nobody was holding it. Three cold playtest rounds reported the same symptom —
first two or three boards scoring zero, *"three losses with no payoff moment"* — and this is the
arithmetic behind it.

## The measurement

`scripts/probe-depth1.ts`. The guess is *tick exactly the candidates that directly import the
subject*, scored with `scoreSet` — the metric the player is graded by, not precision, because a leak
reported in the wrong units is comparable to no threshold. The opening is the first fifteen boards
the **shipped selector** serves a model player who passes everything, which is what a newcomer meets.

| repo | blast boards | opening (first 15 served) | deck-wide |
|---|---|---|---|
| ark | 40 | **0.985** · 6/6 beat A · 5 exact | 0.531 · 11/40 beat A · 7 exact |
| hono | 54 | **1.000** · 6/6 beat A · 6 exact | 0.561 · 18/54 beat A · 15 exact |
| kysely | 75 | 0.611 · 1/6 beat A · 1 exact | 0.293 · 4/75 beat A · 3 exact |
| graphql-js | 69 | 0.800 · 3/6 beat A · 2 exact | 0.467 · 10/69 beat A · 9 exact |

**That two-column shape is the difficulty curve, not a leak.** The hint wins the opening — which is
what an opening is for — and loses most of the deck. A rule that took it away converted the
designed-winnable boards into unwinnable ones and left the hard ones exactly as hard.

The honest reading of the high opening figures is that on ark and hono a newcomer's first boards are
*meant* to be answerable from what the map shows. §8.4 calls those low-`surprise` boards and serves
them first on purpose; the reveal still teaches, and the grade is still honest.

## Decision

1. **Depth 1 renders for every node at all times, whatever board is open.** ADR-0008 decision 1,
   unamended, unqualified.
2. **The full cone stays gated on `subjectsPassed`** — unchanged, and the half of decision 1 that was
   never in dispute.
3. **ADR-0016's wire gate is untouched.** A co-change wire *is* Companion's answer relation; depth 1
   is the baseline Blast Radius measures departure from. Borrowing ADR-0016's ink-versus-memory rule
   for this channel was the analogy that failed, and it failed precisely where it was borrowed.

## Consequences

`scripts/probe-depth1.ts` is the table to re-run if anyone proposes touching this again, and the
condition that would reverse it is stated rather than left to taste: **if the deck-wide column ever
approaches the opening column**, depth 1 has stopped being a baseline and become a lookup, and
ADR-0008 needs amending rather than restoring. It is not close on any of four repos.

The e2e gate now reads the decision rather than the code, and asserts both halves — a live channel
whatever the open board's verb, bounded at depth 1 for an unproved subject. **It had asserted three
different rules in three commits**, each time written from whatever the code happened to do, which is
how a gate ends up certifying a divergence. Both halves are mutation-checked: nulling the channel and
unbounding the depth each turn it red.
