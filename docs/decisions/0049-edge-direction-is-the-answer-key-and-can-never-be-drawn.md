# ADR-0049 — Edge direction is the answer key, and can never be drawn

**Status**: accepted, and **permanent** — this is not a "revisit when" decision.
**Date**: 2026-08-17
**Supersedes**: nothing. **Amends**: nothing. It writes down a refusal that has been
re-derived three times and recorded nowhere.

---

## 1. The request

The map draws every import edge **undirected**. Across five rounds of ten cold
playtesters, once the edges became visible at all (ADR-0048's opacity fix), edge
direction became the **most-requested visual change**, twice running:

> *"833 imports render as undirected grey hairs converging on one hub — I can see
> **that** things are related but never **which way**, which is the first thing I'd
> ask of any dependency diagram."* — staff architect, round 5

> *"make the graded result persist as ink on the map — keep each proved chain
> drawn, **directed**, labelled with its hop count."* — data scientist, round 5

> *"put direction on the map — arrowed or tapered edges, plus a click-to-highlight
> 'this file's cone, out and in'."* — staff architect, round 4

They are right that it is the first thing a dependency diagram should say. It still
cannot ship, and the reason is arithmetic rather than taste.

## 2. Why it cannot ship

ADR-0008 fixes Blast Radius's generator invariant:

```
candidates ∩ dependents(subject, ∞) = truth
```

Every candidate on a board is either in the answer key or is certified *not* to
reach the subject. That is what lets a hub ship a sampled key honestly — and it
also means the board's answer is exactly *"which of these candidates has a directed
path to the subject"*.

A drawn direction turns that into a lookup. Walk backwards along the arrows from
the subject, tick everything you arrive at, and you have `dependents(subject, ∞) ∩
candidates`, which **is** `truth`, by the invariant. Not approximately — the same
set, by construction.

Measured with `scoreSet` — the metric §8.2 grades in — at `66f13d7` by `scripts/probe-direction.ts`, which is kept so the claim
stays checkable rather than quoted:

| repo | Blast Radius boards | mean F1 of the backwards walk | beat band A | exact |
|---|---|---|---|---|
| ark | 40 | **1.000** | 40 of 40 | 40 |
| hono | 54 | **1.000** | 54 of 54 | 54 |

**The first draft of this table said 94 boards on both rows**, which is ark's 40
plus hono's 54 written into each — a number nobody measured, in the document whose
whole purpose is to stop a refusal being re-derived from memory. Re-run, the
verdict held and the counts did not.

That is not a leak to be gated, coarsened or withheld by class. It is the answer
key rendered as a picture, on every board, permanently.

**An earlier probe of the same guess first reported 0.000 across those 94 boards**,
which is the direction that makes
shipping look safe: it iterated `graph.in[ref]`, which holds *edges* rather than
refs, so the walk never left depth 0. A mean of exactly zero across two
repositories is an instrument measuring nothing. That correction is why this
document quotes 1.000 rather than 0.000, and it is recorded because the failure ran
toward the answer a session wants to hear.

## 3. Why the usual escalations do not apply

This project has a ladder for a disclosure: gate it by board (ADR-0016), withhold
it by class (ADR-0020), score it and declare a verdict (ADR-0022), or refuse the
board (guardrail 4). **None of them reaches this one.**

- **By board.** ADR-0016 gates a co-change wire on "no board open about either
  end". Direction is a property of *every* edge, so the gate would have to hide the
  whole channel while any board is open — and ADR-0048 measured what that costs
  when it was tried for the import ring: the opening becomes unwinnable, because
  §8.4's difficulty is calibrated against a hint the player can see.
- **By class.** There is no class. Direction is one fact about one edge, and the
  leak is the conjunction of all of them.
- **By verdict.** ADR-0022 works because a guess that scores 0.750 can be declared
  and the deck rearranged around it. A guess that scores 1.000 exactly, on 100% of
  boards, leaves no deck to rearrange.
- **By refusal.** Guardrail 4 refuses a board whose *truth* is uncertain. Here the
  truth is certain and the *rendering* gives it away, which is the opposite
  problem.

## 4. What the player actually wants, and what can be given

The request is not really "arrowheads". Read the three quotations again: each one
asks to see **which way a specific relationship runs**, at a moment when they are
reasoning about it. Three things already answer that and two of them ship:

1. **The reveal states the direction per row, in words**, and every playtester who
   mentioned it called it the best thing in the product: *"the subject depends on
   this (2 hops out), not the reverse"*, *"it imports palette.ts, which did change,
   and needed no edit of its own"*, *"the arrow points the other way"*. Direction
   is *already* the content of the teaching; it is withheld only from the map.
2. **The subject's own ring is drawn while its board is open** (ADR-0008 decision
   1, restored by ADR-0048). Those edges are directed *by context* — they are the
   things importing the subject — and the prompt now says so.
3. **The proved chain could be drawn**, undirected, once earned. Passing a board
   unlocks its full cone, so highlighting the *path* through nodes the player has
   already been shown adds no node and no edge the map is not already drawing. That
   is the round-5 request the product can honour, and it is the open work item.

The distinction that makes (3) legal and arrowheads illegal: an unlock **earned by
proof, about the thing proven** is ADR-0008's own pattern. A global channel that
answers every unasked board is not.

## 5. Decision

1. **The map never draws edge direction** — no arrowheads, no taper, no gradient,
   no animated flow, in any of the three views. This includes the world's roads and
   the orbit's stalks, which are the same edge set (ADR-0033 decision 1).
2. **A hover or selection may not reveal direction either.** The measurement above
   is about a *walk*, and a walk needs only one edge's direction at a time; a
   hover-scoped arrow is the same leak paid for in instalments.
3. **The proved chain may be drawn undirected**, because ADR-0008 already unlocked
   the cone it lies inside. Whoever builds it re-measures with `scripts/probe-*`
   against band A first, and states what the counterfactual holds fixed.
4. **This refusal is permanent and has no revisit condition.** It does not depend
   on a repo, a threshold, a distractor mix or a measurement that might move. It
   depends on ADR-0008's invariant, and if that invariant ever changes this document
   is void rather than out of date — which is a different thing and should be
   noticed as one.

## 6. Why this document exists at all

The refusal was correct in round 4 and correct in round 5, and both times it was
re-derived from first principles by a session that had no record of the previous
one. ADR-0016 has a landmine about exactly this: *"a conditional instruction in an
ADR has no trigger unless something re-reads it"*. An unwritten refusal is worse —
it has nothing to re-read, so it costs a fresh derivation every time a playtester
asks, and each derivation is a chance to get it wrong in the direction of shipping.

It is also the **most-requested change in the product**, which means it will be
asked for again. The honest answer to a good request is not silence; it is this
document, plus §4's list of what the player can have instead.
