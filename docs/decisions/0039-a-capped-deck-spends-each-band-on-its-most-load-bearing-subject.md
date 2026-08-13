# ADR-0039 — A capped deck spends each band on its most load-bearing subject

**Status**: accepted
**Date**: 2026-08-13
**Supersedes**: nothing. Refines `src/verbs/sample.ts`'s `retain`, which has been in the tree
since M4 with no tests of its own.

---

## 1. The defect

`retain` decides which subjects a repo's whole deck is spent on. Every verb builds every board it
can, then caps: `maxChallengesFor(n) = max(40, ceil(n/8))` per verb. **The cap bites on every repo
measured** — `honojs/hono` at `7075369e` builds 149 Blast Radius boards and ships 54; kysely at
`f24018c7` builds 279 and ships 75.

Which 54? The old rule sorted by difficulty and took evenly-spaced *indices*. So the surviving
subject was decided by where it happened to land in a difficulty sort, and what that discarded was
the thing a player is most likely to click:

```
hono @ 7075369e                        importers   board?
  src/context.ts                            76       no
  src/hono.ts                               72       no
  src/router.ts                             32       no
kysely @ f24018c7
  src/util/object-utils.ts                 183       no
  src/util/abort.ts                         46       no
  src/query-compiler/compiled-query.ts      42       no
```

**Six of hono's fifteen most-imported files carried any board at all, and seven of kysely's.** A
cold playtester found it from the other end and stopped there: *"the map begs you to click landmarks
and the landmarks are mute."* That is pillar 6 failing at the only moment it is measured — the first
ten minutes, where a player clicks the biggest thing on the map.

Nothing was red, because **`retain` had no tests**. It is 20 lines of arithmetic between the
generator and the atlas, and it decided more about a repo's deck than any distractor strategy.

---

## 2. Decision

**Bands, not indices.** `retain` partitions the difficulty-sorted list into `max` contiguous bands
and each band contributes its **most important** member, where `importance` is supplied by the
caller.

The difficulty range is preserved exactly as before — one pick per band, bands partition the whole
list, so both ends and the middle survive the cut. That was the property the function existed for
and it is untouched. What changed is only *which member of a band* gets the slot.

### 2.1 `importance` is the caller's, and every caller passes one

There is no default. A default here is a decision nobody made, and the right measure is not the same
for every verb:

| Verb | Subject | `importance` |
|---|---|---|
| `blastRadius` | a file | `elevation` |
| `companion` | a file | `elevation` |
| `archaeology` | a file | `elevation` |
| `placement` | **a commit** | `() => 0` |

`elevation` is ADR-0013's bit length of the transitive dependent count — one layer up is twice as
depended-upon — and it is *also the map's vertical channel*. So a deck ranked by it agrees with the
picture the player is looking at: the tallest towers are the ones with questions. That agreement is
the reason to prefer it over raw in-degree, which would rank by direct importers and disagree with
the map.

Placement passes a flat function because **its subject is a commit**, which has no elevation and no
place in the graph. This is the *subject-is-not-a-node* landmine arriving in a new file, and it is
the reason `importance` is a callback rather than a field lookup inside `retain`: `retain` cannot
know what its entries are about.

---

## 3. The identity, and the version of it that was false

**Under flat importance the result must be byte-identical to the old rule.** That is what makes this
a generalisation rather than a replacement — it is why Placement's deck does not move, and it is the
only cheap check that the range-preserving property survived.

The first implementation asserted that identity in a docstring and did not have it. It spaced the
**bands** evenly and clamped the old rule's index into whichever band it fell outside. That reads as
the same construction and is not:

- anchors are `(L−1)/(max−1)` apart
- bands are `L/max` wide
- and `L > max`, so the anchors are **wider-spaced than the bands** and drift forward

The drift reaches `(L−max)/max` bands by the end of the list. On hono's 183 Placement entries in 54
bands that is 2.4 bands, so band 52's anchor lands inside band 53 and the clamp drags it back one
place. Measured: **Placement moved on 3 of hono's boards and 7 of kysely's** — a verb whose
importance function is constant.

The fix is to build the bands **around** the anchors — each band is the half-open interval between
the midpoints of its neighbouring anchors — rather than clamping the anchors into independently
chosen bands. Every band then contains its own anchor by construction, so no band is empty, and flat
importance reproduces the previous pick exactly.

Two things worth recording about the old implementation while it is still legible. Its anchors went
into a `Set` and it padded from index 0 on a collision; **that padding was unreachable**, because
`entries.length <= max` returns early and any longer list gives anchors spaced more than 1 apart.
And its index sequence was never one-per-band under any even partition — that is the mechanism
above, not an implementation detail.

**The two hand-written examples in the test file both passed while this was wrong.** What caught it
was a measurement on a real repo, and what pins it now is a test over shapes rather than examples:
`max ∈ {1,2,3,7,10,54,75} × (L−max) ∈ {1,2,3,7,40,129,300}`, compared against the previous rule
transcribed verbatim. Mutating the anchored bands back to clamped bands fails **exactly that one
assertion** of nine.

---

## 4. What it bought, measured

Clean clones of named commits — hono `7075369e`, kysely `f24018c7`, both full depth. Old indexer
(`46352f0`) against new.

| | hono | kysely |
|---|---|---|
| 15 most-imported files with any board | 6 → **12** | 7 → **9** |
| top elevation decile with a Blast Radius board | 6/22 → **10/22** | 5/34 → **15/34** |
| challenges shipped | 216 → 216 | 300 → 300 |
| Placement deck | **byte-identical** | **byte-identical** |

`src/context.ts` (76 importers), `src/hono.ts` (72), `src/router.ts` (32) and
`src/util/object-utils.ts` (183) all have boards now. **The deck did not grow**; the same number of
questions is spent on different subjects.

### 4.1 The cost, stated

The deck's *hardest* board gets slightly easier, because the top band now trades its hardest member
for its most load-bearing one: Archaeology's maximum difficulty goes 1.000 → 0.890 on hono and
1.000 → 0.950 on kysely. Every other quantile is unchanged to two decimal places. That is the trade
this ADR makes deliberately — a question about a file nobody imports, at difficulty 1.00, against a
question about the file everybody imports, at 0.89.

Some landmarks are still mute and are supposed to be. `benchmarks/routers/src/tool.mts` and
`src/http-exception.ts` on hono, and five kysely files, have no board because they lose their band
to something taller, or because guardrail 4 refuses them. This decision changes *which* subjects a
capped deck spends itself on; it does not raise the cap, and raising the cap is a different decision
with its own budget.

---

## 5. Alternatives rejected

**Sort by importance and take the top `max`.** This is the obvious rule, and **it beats the one
shipped here on the metric this whole document is about** — 14 of hono's 15 most-imported files get
a board against 12, and the top elevation decile goes to **22 of 22** against 10. It was measured
rather than reasoned about, and the measurement is the reason it is refused:

| hono `7075369e`, Blast Radius | min | p25 | med | p75 | max |
|---|---|---|---|---|---|
| importance-only | 0.550 | 0.710 | 0.770 | 0.800 | 0.940 |
| shipped (banded) | 0.030 | 0.080 | 0.550 | 0.710 | 0.940 |

**The easy end of the deck is gone.** A repo's hubs are hard questions — that is nearly what being a
hub means — so ranking by importance alone raises the *floor* of the deck from 0.03 to 0.55 and its
p25 from 0.08 to 0.71. The first board a new player sees would be a mid-difficulty transitive-closure
question about the most connected file in the repository. That is pillar 6 failing in the opposite
direction from the defect in §1, and it is worse, because a mute landmark is a disappointment where
an unanswerable first question is a stopping point. (This trade is exactly why the range-preserving
half of `retain` is not negotiable, and why §3's identity check is worth the test it costs.)

**Raise the cap so the landmarks fit.** Does not fit in the atlas-size budget at django's scale, and
it is the wrong shape anyway: a deck of 149 Blast Radius boards on a 425-node repo is not a better
deck, it is the same deck with the marginal questions added back.

**Rank by in-degree rather than elevation.** Ranks by *direct* importers, which is a different claim
from the one the map draws and the one Blast Radius grades — ADR-0008's truth is the unbounded
transitive dependent set, and `elevation` is its bit length. Using in-degree would put the deck and
the map's vertical channel into disagreement for no gain.

---

## 6. Consequences

- Every history-and-graph verb's deck moves on every repo. Ark's own atlas moves, as always.
- `retain` has tests for the first time: nine, of which the shape-sweep is the load-bearing one.
- **The next verb whose subject is not a file must choose an `importance` explicitly.** There is no
  default to fall through to, which is the point — a silent `() => 0` would look like a decision.
