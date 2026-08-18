# ADR-0050 — A wrong answer you did not pick is explained, but never labelled

**Status**: accepted
**Date**: 2026-08-18
**Amends**: [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md) —
the witness is recorded for every candidate and now **rendered for a strict
subset** of them, on a measurement.
**Builds on**: ADR-0047 (the register a first answer earns), ADR-0022 (a verb
declares what would beat it).

---

## 1. The gap

Every reveal built its rows from `Grade`'s three sets — `missed`, `spurious`,
`correct` — whose union is `truth ∪ picked`. So a player who answered
**perfectly** was told nothing whatever about the candidates they were right to
skip. On a twenty-candidate board with four right answers, sixteen wrong answers
walked off unexamined.

NORTH-STAR §8.3 calls distractor generation *"a real subsystem, not a helper
function"*, and ADR-0020 records a reason for every slot in the atlas. Measured
by `scripts/probe-silent.ts` at `19b571a`:

| repo | wrong-answer slots | carrying a recorded reason |
|---|---|---|
| ark | 2,411 across 160 boards | 1,869 (77.5%) |
| hono | 3,474 across 216 boards | 2,722 (78.4%) |

None of it was spoken unless the player happened to tick the row — and the one
way to see all of it was to tick **everything**, which is the select-all farm
ADR-0047 exists to defuse. The best answer and the worst answer were the two
that learned least.

## 2. What ships

**Every candidate gets a reveal row.** A fourth `NoteKind`, `avoided`, sorted
last by every verb so the lesson stays at the top, dimmed in the panel and
introduced by one heading at the seam.

**Grouped by sentence, because a row each would be longer without being
richer.** The count that decided it is distinct sentences, not rows:

| verb | mean rows a perfect answer newly sees | mean distinct sentences |
|---|---|---|
| archaeology | 15.6 | **2.2** |
| blastRadius | 14.5 | **3.3** |
| companion | 14.6 | 10.1 |
| placement | 15.6 | 11.9 |

So on two of the four verbs a sentence per row makes the panel eight times
longer and says two things. Grouping collapses those to two or three blocks and
is close to a **no-op** on the other two — which is the right outcome rather
than a missed optimisation, and is asserted as such.

Each row carries the verb's graph-derived sentence — *"the subject imports this
— the arrow points the other way"*, *"edited in 14 commits, but never in one
that also touched the subject"* — which is the teaching. It does **not** carry
the witness, and that is §3.

## 3. Why the witness stays on picked rows only

This is the part that was measured before it was designed, and the measurement
changed the answer.

ADR-0020 decision 4 withholds a class **as a class**, because a per-row guard
makes the *absence* of a line say which class the row was in. `probe-silent.ts`
takes the count that rule implies and nobody had taken — **how many classes are
silent, and how many rows does each ship?**

| verb | silent classes | rows (ark / hono) |
|---|---|---|
| blastRadius | `coChange` | 38 / 47 |
| companion | `structural` | 226 / 319 |
| placement | `coChange` | 97 / 129 |
| archaeology | `sibling`, `distant` (+ `companion` partial) | 166+5 / 109+140 |

**Three of the four have exactly one, on both repos** — which matters, because a
rule resting on "the complement is exact" is a claim about a count that could
easily differ between repositories and does not. So if every other row spoke, a silent row
would name that class outright — the disjunction the landmine describes,
collapsed to an identity because nothing else is silent alongside it.

Scored in §8.2's units rather than reported as a count of rows:

| repo | Companion's silent rows → the same subject's Blast Radius board |
|---|---|
| ark | 5 boards reachable, best F1 **0.500**, 0 beat band A |
| hono | 5 boards reachable, best F1 **0.857**, **1 beats band A** |
| kysely | 7 boards reachable, best F1 **0.500**, 0 beat band A |

It **fires on hono and not on ark**, which is the whole reason the bootstrap repo
could not have decided this — the second-repo rule, paid for again.

So the witness is withheld from `avoided` rows. Note the shape of the rule: it is
a property of the **pick**, not of the class, so it correlates with nothing a
player is trying to infer. Every class is equally silent on an unpicked row and
equally spoken on a picked one.

## 4. Why the sentence is safe where the label is not

The obvious worry is that the sentence gives away by paraphrase what the label
gives away by name. Measured — `probe-silent.ts` cross-tabulates note shape
against strategy, with paths and hop counts normalised out:

- The purest shape that maps onto a silent class is Companion's *"it imports the
  subject, and yet they have never changed together"* at **89% `structural`**,
  and what it states is a **depth-1 import edge**, which ADR-0008 decision 1
  draws on the map for every node whether or not a board is open. It is not a
  disclosure; it is a caption for something already on screen.
- `blastRadius/coChange`'s 38 rows fall into shapes dominated by `treeSibling`
  (*"no chain of imports reaches the subject"*, 52%; *"same directory, no import
  path"*, 64%). `placement/coChange`'s 97 fall into *"edited in N commits, but
  not in this one"* (56% `busy`). Neither sorts.

The second exposure is real and bounded. `whyNot`'s deep arm — *"the subject
depends on this (k hops out)"* — states a **cone** edge the map does not draw,
which is an atom of the *candidate's own* Blast Radius key. Scored as a guess on
the board it weakens, taking the union across every other board's reveal:

| repo | boards receiving something | best F1 | beat band A |
|---|---|---|---|
| ark | 12 | 0.667 | **0** |
| hono | 10 | 0.667 | **0** |
| kysely | 14 | 0.500 | **0** |

And note what the change does to the *ceiling*: nothing. Select-all already
produced every one of these rows, so this levels a floor rather than raising a
roof — and removes the reason to farm.

## 5. Decision

1. **Every candidate gets a reveal row.** `avoidedOf(challenge, grade)` is
   derived from `Grade`'s three sets in one shared module, not four times.
2. **An `avoided` row carries no witness**, on §3's measurement. The rule keys
   on the pick, never on the class.
3. **`NoteKind` is exhaustive at the render site.** The console's mark was a
   two-armed conditional with `'✗'` as its fall-through, so an `avoided` row —
   a wrong answer the player was **right** to skip — would have been marked as a
   mistake, silently, on every board. It is a `switch` with no default, so the
   next kind is a compile error.
4. **Re-measure §3 when a verb's silent set changes.** The rule rests on *"the
   complement is exact"*, which is a fact about how many classes are silent, and
   that number moves whenever a class is withheld or restored. ADR-0016's
   landmine is that a conditional instruction has no trigger unless something
   re-reads it — so this one is also a `tests/atlas/` assertion, which fires on
   its own.

## 6. What this does not do

It does not explain a wrong answer's **strategy** to a player who avoided it,
which is the more interesting half and is refused above on 0.857. If a future
change gives two classes silence on the same verb, §3's complement stops being
an identity and the refusal is worth re-scoring — with the caveat that
deliberately silencing a second class to buy the first one cover would cost a
shipped feature to hide a fact, which is the wrong trade.
