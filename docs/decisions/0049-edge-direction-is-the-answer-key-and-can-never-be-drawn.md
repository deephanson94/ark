# ADR-0049 — Edge direction is the answer key, and can never be drawn

**Status**: accepted, and **permanent** — this is not a "revisit when" decision.
**Date**: 2026-08-17
**Amended**: 2026-08-18 — §7 tightens decision 3. The permission it granted was
argued from nodes and edges and is **wrong about direction**; the layer ships
behind a gate, measured.
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

---

## 7. Amendment, 2026-08-18 — decision 3 was permitted on an incomplete argument

Decision 3 required whoever built the proved chain to *"re-measure with
`scripts/probe-*` against band A first"*. `scripts/probe-chain.ts` is that
measurement, and **it refutes §4.3's reason**.

### 7.1 What was wrong

§4.3 permits the chain because *"highlighting the path through nodes the player
has already been shown adds no node and no edge the map is not already
drawing."* That sentence is true — and it is about **nodes and edges**. The
thing this document refuses is neither: it is **direction**. A route drawn from
a truth member to the subject, with the subject marked as the subject, states
which way every edge on it points however undirected the ink is. Decision 2 says
so in as many words about a *hover* — *"a hover-scoped arrow is the same leak
paid for in instalments"* — and a chain is a run of arrows.

The soft spot was where the document was most pleased with itself: §4 is the
consolation prize offered to the player after a refusal, so it reads as
generosity rather than as a claim, and nothing in it was measured. That is this
repository's proudest-paragraph landmine with the polarity flipped — not the
argument a document defends hardest, but the one it uses to stop looking.

### 7.2 The measurement

ADR-0049's own backwards walk, restricted to the edges some drawn chain has
revealed the direction of. Scored with `scoreSet`. **Precision is 1.000 in every
row** by ADR-0008's invariant — everything the walk reaches is in `truth` — so
this is a pure *recall* number: the map handing over an answer key with no wrong
picks.

| repo | half the deck answered | every board but the one scored | **gated** |
|---|---|---|---|
| ark | 5 of 40 beat A, 3 exact | 9 of 40, **5 exact** | **0** |
| hono | 8 of 54, 5 exact | 14 of 54, **11 exact** | **0** |
| kysely | 6 of 75, 5 exact | 9 of 75, 8 exact | **0** |

**What the counterfactual holds fixed**: the atlas, the deck, every answer key
and every candidate set. The only thing varied is which edges have a known
direction, so a difference between rows is the chain's own contribution.

The probe **self-gates at both extremes** — no edge directed reads 0.000, every
edge directed reads 1.000 and reproduces §2's table to the digit. Without that
plant the middle rows would be an instrument nobody had checked, which on this
project is the failure that reads as good news.

### 7.3 The gate

**A chain link `u → v` is drawn only when `v` carries no unanswered Blast Radius
board.**

It closes the leak *by construction* rather than by threshold: every walk out of
an open board `Q` must take an edge whose head is `Q`, so the rule empties that
walk at its first step. That is why the gated column reads `0` and not "below
the bar", and why it needs no re-measure when a repo's deck changes shape.

It is a gate on the **head node**, so it is a property of the subject and never
of a row — ADR-0020's *withhold by class or by board, never by row*. The absence
it creates discloses nothing a player cannot already see: a withheld link is
indistinguishable from a node no chain runs through, and *"this node carries an
open board"* is drawn on the map as its question ring.

### 7.4 What it costs, measured where the cost is real

**72.8% of the chain ink survives on ark, 81.8% on hono, 93.0% on kysely**, with
half the deck still open.

The first version of that figure was **99% on all three**, because it was
measured with a single board open — the bound, not a session. Counting what a
gate emits rather than what survives it is precisely ADR-0016's vanishing-wire
defect, and it was reproduced here in the same commit as the comment quoting it.
The survival figure is now printed beside the number of open boards for that
reason.

On the map itself, at `bc3f039`, a full clear of this repo draws **138 links
over 860 edges**, a half-clear 74, and a tenth 23 (`npx tsx
scripts/shot-chains.ts`). So the layer is neither invisible nor a second hairball.

### 7.5 Decision 3, restated

3. **The proved chain is drawn undirected and behind the gate in §7.3.** It is
   built (`src/player/chains.ts`), gated in that module and nowhere else, and
   pinned by `tests/atlas/atlas.test.ts` — which asserts the layer fires, that
   no in-edge of an open board is drawn, **and that the ungated version leaks**,
   because a gate measured only on the arm where it holds is a rule nobody has
   priced.

Decisions 1, 2 and 4 are unchanged. Note that this amendment *narrows* a
permission, which is the safe direction; nothing here reopens the refusal, and
§5.4 still holds — if ADR-0008's invariant ever changes, this document is void
rather than out of date.

### 7.6 The hop count, and the trap in it

The round-5 request was *"keep each proved chain drawn, **labelled with its hop
count**"*. Both halves ship. The count is in the **inspector** rather than beside
every glyph, because 79 of ark's 279 nodes carry one at a full clear (120 of
hono's 425, 140 of kysely's 600) and a map already spending a label budget on
names has no room for a number on a quarter of it. Pointing at a node brightens
the routes through it, which costs no disclosure — every one of those links is
already stroked.

**The count is measured over the drawn links and never over the original
route**, and that distinction is the whole of its safety. A chain the gate broke
in the middle still *has* a length; printing it would say the far end reaches
the subject across the very hop that was withheld — §7.3's leak restated as a
number, and a number is exactly the shape that looks too small to be a
disclosure. Distance along drawn links cannot say it, because every hop it
counts is on screen: a node beyond a break simply has no entry.
