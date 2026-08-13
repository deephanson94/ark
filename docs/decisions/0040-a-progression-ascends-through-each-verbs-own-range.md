# ADR-0040 — A progression ascends through each verb's own range, and the landmark term is refuted

**Status**: accepted
**Date**: 2026-08-13
**Amends**: ADR-0011 decision 4 (the selector's rank), for the third time.
**Relates to**: ADR-0039, whose rejected alternative this is, one layer up.

---

## 1. The defect

The guide's opening is trivia. Measured at `b08a1f5`, on full clones of named commits, simulating a
player who passes everything:

| repo | first 15 boards | difficulty | second verb first appears at |
|---|---|---|---|
| hono `7075369e` | blastRadius × 15 | 0.03–0.10 | board **25** |
| graphql-js `9c245018` | blastRadius × 15 | 0.03–0.28 | board **19** |
| kysely `f24018c7` | blastRadius × 11, companion × 4 | 0.03–0.68 | board 9 |
| ark | blastRadius × 15 | 0.04–0.51 | board 17 |

hono's first six boards are `benchmarks/jsx/src/preact.ts`, **`src/middleware/jwk/keys.test.json`**
— a JSON fixture — `benchmarks/query-param/src/qs.mts`, and three `src/jsx/dom/*`. Seven of
graphql-js's first ten are `src/__testUtils__/*`. Both of those repos are `docs/experiments/0001`'s
matched pair, so this is what twelve recruited participants would have met.

Archaeology first appears at board 109–150 and Placement at 163–221. **A first session never reaches
the git-graded half of the product**, which is M4's entire thesis and NORTH-STAR §5's
"disproportionately high-value" tier.

---

## 2. The cause: raw difficulty is not comparable across verbs

§8.4 computes `difficulty` from each verb's own inputs. The ranges are not the same:

```
hono @ 7075369e     min    p25    med    p75    max
  blastRadius      0.03   0.08   0.55   0.71   0.94
  companion        0.49   0.74   0.80   0.85   0.91
```

`rankLess` compared these numbers directly. So **every** Blast Radius board below 0.49 was served
before the first Companion board — not by a design choice, but because two incommensurable scales
were compared as if they were one. That is a category error, and it is the whole mechanism.

---

## 3. Why the obvious fix is refused, measured

The proposal on the table was a *landmark* term above difficulty: prefer a board whose subject is
load-bearing, so the opening stops being about test fixtures. It is refused.

Blast Radius's difficulty is **strongly positively correlated** with how load-bearing its subject is.
Scoring subjects by *non-leaf dependent count* — transitive dependents that themselves have
dependents, which separates `__testUtils__/dedent.ts` (22 direct importers, **0** non-leaf) from
`GraphQLError.ts` (**112**) — Spearman ρ against difficulty reads:

| | hono | graphql-js | kysely | ark |
|---|---|---|---|---|
| blastRadius | **0.961** | 0.842 | 0.378 | 0.836 |
| companion | −0.299 | −0.236 | **−0.652** | −0.057 |

`breadth` is a term in §8.4 and a landmark's cone is broad, so for Blast Radius the landmark term is
very nearly *difficulty wearing another name*. Ranked landmark-first, the measured opening is

- graphql-js: difficulty **0.71–0.91**, starting at `src/jsutils/inspect.ts`
- kysely: **0.63–0.77**, starting at `src/query-builder/update-result.ts`
- hono: **0.49–0.82**

which is a deck with no easy end — ADR-0039 §5's rejected alternative exactly, arriving one level up.
The variant that caps difficulty first was also measured and produces a non-monotonic opening
(graphql-js: 0.58, 0.53, 0.37, 0.28, 0.49, 0.23 …) that still starts at 0.58.

**The same table contains the fix.** Companion's correlation runs the *other* way, and its easiest
boards are `GraphQLError.ts` (nl 112), `insert-query-node.ts` (155) and `http-status.ts` (105). Easy
questions about landmarks already existed in every deck measured. Nothing needed to be generated;
they were unreachable behind Blast Radius's easy tail.

---

## 4. Decision

The rank becomes `(attempts, sameRegion, tier, **progress**, difficulty, overlap, id)`, where
`progress` is the challenge's **band within its own verb's difficulty range**.

Two properties of `progress` are load-bearing and each was learned by breaking it.

**It is a band, not a position.** A bare position totally orders each verb's deck, so every term
below it becomes unreachable between two challenges of the same verb. The first implementation did
that and silently killed `overlapWith`, which ADR-0011's second amendment had measured into place.
Two existing unit tests went red; the tests were right.

**It bands over ties, not over the sorted index.** A challenge's band is set by how much of its
verb's deck is *strictly* easier, so two equally-hard questions always share a band. Banding by index
instead separates them by the byte order of their ids, which is the opposite of what a progression
means. Being rank-based rather than range-based, it also equalises the two *distributions*:
normalising by `(d − min) / (max − min)` was tried and does not interleave, because Companion's
difficulties are packed against the top of its own range, so its first band holds three boards where
Blast Radius's holds fifteen.

`progress` is computed over the **whole** deck, never the unanswered remainder — otherwise a verb
re-scales as it is cleared, and a two-board verb's last question re-enters band 0 however hard it is.

### 4.1 The band count is measured

`PROGRESS_BANDS = 10`, chosen by sweeping it and reading two quantities:

| bands | second verb first appears (hono / ark) | positions the `overlap` term still decides (hono) |
|---|---|---|
| 4 | 15 / 10 | 18 of 216 |
| **10** | **7 / 5** | **18 of 216** |
| 20 | 7 / 5 | 14 of 216 |
| 60 | 7 / 2 | 14 of 216 |

Four is too coarse to interleave. Twenty and sixty buy no further interleave and start starving the
term underneath. Ten is the knee.

---

## 5. What it bought, measured

| | hono | graphql-js | kysely | ark |
|---|---|---|---|---|
| second verb first appears at board | 25 → **7** | 19 → **8** | 9 → **7** | 17 → **5** |
| mean subject elevation, first 15 | 1.87 → **3.20** | 2.80 → **4.40** | 4.53 → **4.67** | 3.47 → 3.27 |
| deck mean elevation (for reference) | 3.14 | 4.50 | 4.55 | 3.04 |
| `overlap` term's reach | 24 → 18 of 216 | — | — | 42 → 29 of 160 |

The opening now reaches `src/utils/http-status.ts`, `src/router/reg-exp-router/index.ts`,
`src/error/GraphQLError.ts` and `src/operation-node/insert-query-node.ts` inside the first ten
boards, and the first-15 mean elevation moves from *below* the deck's mean to at or above it on three
repos of four.

**The `overlap` term's reach falls by about a quarter and it is not starved**, which is the number
this decision is most at risk of having got wrong, so it is stated rather than left implied.

---

## 6. What this does *not* fix

**Archaeology and Placement still first appear at board 68–150 and 116–221.** `tier` remains above
`progress`, because §5's tiers *are* the curriculum and demoting them is a north-star question, not a
selector one. Ranking `progress` above `tier` was measured and puts all four verbs inside the first
twelve boards on every repo — three each — at a first-12 difficulty range of 0.03–0.63. **That is
available and deliberately not taken here**; it needs an owner's decision about whether the tier
ordering or the verb mix is the progression.

**The opening is still about half peripheral files.** Blast Radius's easy end is peripheral by
construction (§3), and this decision reaches the easy landmark questions that exist rather than
creating any. The structural answer is content whose difficulty is *not* a function of the subject's
fan-out — NORTH-STAR §5's tiers 1 and 2, which no shipped verb emits. That is a roadmap item.

---

## 7. Consequences

- Every repo's served order changes. No atlas changes: `progress` is derived from the deck the
  player was given, so there is no schema bump and no reindex.
- `withinVerbRank` runs once per suggestion over the whole deck — O(n log n) at n ≤ 500, called once
  per grade.
- Three new unit tests, each verified against a mutant: deleting the band term, banding by index
  instead of by ties, and banding over the remainder. The third mutant initially survived the test
  named for it, because that test asserted ascending difficulty over a single verb — true either way.
  It is rewritten to use a two-board verb whose hardest member re-enters band 0 under the mutant.
