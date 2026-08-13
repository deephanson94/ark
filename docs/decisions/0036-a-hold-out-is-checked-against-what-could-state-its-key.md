# ADR-0036 — A hold-out is checked against what *could* state its key, and two of the four verbs cannot say

- **Status**: accepted
- **Date**: 2026-08-13
- **Discharges**: [`docs/experiments/0001`](../experiments/0001-does-the-world-beat-the-map.md) §9 item 1
  — the hold-out split script
- **Extends**: [ADR-0019](./0019-archaeology-asks-a-place-what-happened-to-it.md) decision 7
  (`Verb.discloses`), [ADR-0030](./0030-a-twin-is-named-once-its-whole-class-is-cleared.md),
  [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) decision 1
- **Measured on**: full clones of named commits — ark `75b6117`, `graphql/graphql-js` `9c245018`,
  `kysely-org/kysely` `f24018c7`, `honojs/hono` `7075369e`. `git rev-parse
  --is-shallow-repository` is `false` for all four, checked rather than remembered.

## Context

§4.4 makes the quiz a **hold-out**: before recruiting, `k` boards per verb come out of the deck, the
atlas both arms play is the remainder, and the removed boards are the quiz. The items then keep every
certification the product's own boards carry, and overlap with played subjects is zero by
construction.

§4.4 also names the one leak a hold-out does not close on its own, and §9 specifies the fix in one
sentence: *"checks the removed keys against the served deck's `discloses` output"*. `Verb.discloses`
exists precisely so that this is computable.

Built and measured, that sentence is **true, cheap, and not sufficient** — and the shape of its
insufficiency is the reason this document exists rather than a commit message.

## Decision 1 — the check is `Verb.keyFacts`, a third direction, and it returns `null` rather than `[]`

`discloses` asks *what does my reveal give away about other boards?* The hold-out needs the mirror:
*what would another board's reveal have to say to give away **mine**?* On the two history verbs those
have the same answer, which is exactly what would have made reusing one for the other look correct.
They are not the same: Placement's `discloses` also yields a `widthFact`, which names a **size** and
no member, so a check built on it refuses a board because some reveal printed *how big* its answer is.

The load-bearing part is the return type. Blast Radius and Companion answer keys are relations
between **files**; every constructor in `disclosure.ts` is keyed on a `CommitId`. Measured over
kysely's full deck: 613 facts, 538 naming at least one node id, and **zero naming two**. So no
accumulated fact can state one of their key atoms, under any deck, any repo, any `k`.

An empty iterable would report that as *nothing was disclosed*, which is the same cell as *nothing
could be*. `null` forces the caller to print **`unchecked`**, and `summary()` does.

This matters more than it reads, because those two verbs are **§4.4's entire discriminating tier**.
The check §9 specifies is, on exactly the items the experiment is scored on, an assertion that a
string which cannot be constructed is absent from a set.

## Decision 2 — the zero on the two verbs where it *can* fire is reported as regression detection, not as safety

The check refuses **0 on all four repos**, and the swap loop runs **once**. On Placement and
Archaeology that is a real measurement: ADR-0019 decision 7 already takes a commit whose membership an
earlier reveal stated off the later board entirely.

**How much that proves is bounded by deck coverage, and the first draft of this section overstated
it.** It said the zero proves decision 7 *"survives an arbitrary subset of the deck"*. On hono a
Placement board covers 54 of 500 retained commits and an Archaeology board 54 of 425 nodes, so across
both decks only **52 key atoms of 332** sit where the cross-verb channel could fire at all — and a
k=6 sample contains almost none of them. Decision 7 is confirmed on those 52. The honest description
of this check is a **regression detector on decision 7**: it fires if that guard ever breaks, and
kysely's counterfactual prices what it is guarding — regenerate Archaeology with `disclosed = {}` and
Placement's reveals state **54 of 291 atoms (18.6%) over 41 of 75 boards**.

## Decision 3 — the split may not *create* a leak, and it did

This is the finding the specified check cannot see, and it was found by measuring rather than by
reading.

ADR-0030 names a twin class *"only when no member still carries an **unanswered** Blast Radius
board"*, and `main.ts` asks that question as `challengesById.get(id) ?? []`. **A held-out board is not
unanswered — it is absent.** The bucket is empty, the guard passes **vacuously**, the inspector
volunteers `cone(S) = cone(T)`, and ADR-0008's invariant `candidates ∩ dependents(subject, ∞) = truth`
turns that into the held-out key **byte-exact**.

Measured: **4 of kysely's 6** held-out Blast Radius boards recover at F1 **1.000** — 19 of 19 under
leave-one-out, 25.3% of that deck — and **3 of graphql-js's 6**. The gate is real and the removal is
what opens it: run the same four boards with every Blast Radius board treated as *open* and it closes
4 of 4.

The player is not wrong; a board that does not exist cannot be open. So the repair is in the thing
that made it not exist. `HoldoutBar` refuses to hold out a board whose subject shares a cone with
anything else. It bars **11 / 24 / 26 / 6** boards on ark / graphql-js / kysely / hono, costs no repo
its `k=6`, and afterwards **0 of 6** held-out subjects sit in a twin class on any of the four.

`findTwins` is imported from `src/player/` rather than reimplemented. Two definitions of *twin* is
worse than the leak.

## Decision 4 — a board the map already answers is not a quiz item

Hovering a node paints its **direct importers**, for everyone, in every arm, gated by nothing
(ADR-0008 decision 1). On the easy end of a deck that is not a hint but the answer: measured on hono,
ticking exactly what the hover paints beats band A on **17 of 54** boards, with mean F1 **0.890**
below difficulty 0.50 against **0.095** above 0.80 (Spearman ρ = **−0.826** — §8.4's `surprise` is
*defined* against this guess, so difficulty is a measure of how much it helps).

In the held-out set it decided **2 of 6** boards on graphql-js and on hono and 1 of 6 on kysely, at
**best F1 1.000**. Barred using the product's own bar (`CTRL_F_THRESHOLD`) and the product's own
metric (`scoreSet`), it is **0 of 6 on all four**, best 0.667 / 0.667 / 0.667 / 0.750.

**The product ships those boards deliberately** — `gate.ts` declines to refuse the guess because §8.4
already prices it and the progression needs easy rungs. A quiz is not a progression, and that is the
whole difference.

**Why a bar and not a change to the ranking.** Selecting the quiz by descending difficulty would also
close this channel; the same measurement takes it to 0 of 6. It was rejected because it closes it by
taking **one end of the range**, and §6 names a floor and a ceiling as one instrument failure wearing
two signs. A bar removes the compromised items and leaves the spread.

## Decision 5 — mutual membership is reported, not refused on, and returns `null` where it cannot be asked

Two boards of one verb that name each other. Stated structurally, so it names no verb and therefore no
relation: on Companion it is the symmetric co-change pair, on Blast Radius the same shape is a
**cycle**, which is ADR-0034 §4's SCC finding arriving from the other side.

It reads **0 / 0 / 0 / 1** across the four repos and moves with the selection rule, because barring
changes which boards are picked. Refusing on a channel this small and this rule-sensitive would shrink
the quiz for an unmeasured benefit; §4.4's instruction is to swap items that are *disclosed*, and this
is a property of two boards' shapes rather than a fact any reveal states.

**The first version of this channel broke decision 1's own rule, in the file whose docstring is
mostly about that rule**, and a review sweep caught it. Placement's subject is a commit and its
members are nodes; Archaeology's are the other way round. The two roles are in **disjoint
namespaces**, so the lookup misses by construction and the count is 0 for a reason that has nothing to
do with the repo — printed in the same column as Blast Radius's checked 0. It returns `null` now and
the report prints **`n/a`**. Two zeroes, again, in the channel added second, by the author of the
paragraph forbidding it.

### What this channel subsumes

ADR-0016's wire gate has the identical *absent-versus-unanswered* shape as decision 3: `openBoards` is
built from **unanswered** `coChangeTies` challenges, so a held-out Companion board suppresses nothing
and its subject's pairs draw. Measured, the leak reduces to mutual membership and is **0 atoms on all
four repos** — because a wire needs `S ∈ truth(Y)` for a served `Y`, and `Y` must also be a candidate
on `S`'s board, which by ADR-0014's certification puts `Y ∈ truth(S)`. That is mutual membership
exactly.

**Apparatus, since the result is another zero**: 172 / 329 / 348 / 194 wires drawn, **1–2 of 6**
held-out subjects carry an incident wire, and **6 of 6** boards' candidates appear in the wire graph
on every repo. The join found rows; there is nothing in them.

## Decision 6 — taking a verb's whole supply is a shortfall

`shortfall = k − held` fires only when `k > eligible`, never at `k === eligible` — so `-k 40` on a
40-board verb removed **every** board of that verb, reported `shortfall 0`, and exited 0. The played
atlas then has no board of that kind, and `empty.ts` would tell the participant *"every question
answered"* over a deck that was taken from them: `deckRefused` comes from `sourceCoverage`, which
never reads `challenges`, so a hold-out is a **third** cause for a zero the panel already forks on
twice. Held out entirely, a verb now reports the whole request as short and the script exits 2.

## What was measured and deliberately **not** called a leak

A served Blast Radius board about `D` where `D` transitively imports `S` discloses `dependents(D) ⊆
dependents(S)`, covering part of the key on **29 of ark's 40** boards. Exploiting it requires knowing
`D` depends on `S` and then reasoning transitively — which is tier 3's construct in as many words
(*"directly, or through a chain of imports"*). ADR-0019's rule separates them: **an implied relation
is accepted where a stated atom is refused.** Recorded so the next session does not "fix" the thing
being measured.

## How the apparatus is proved, given that every branch is dead

Every new branch reports zero on every real repo. That is indistinguishable from a check that does not
work, and `CLAUDE.md`'s landmine is that the error runs in the direction that gets believed. So:

- `tests/unit/holdout.test.ts` **hand-builds the collision a generated atlas cannot contain** —
  ADR-0019 decision 7 makes one impossible — and asserts the refusal, the swap, and `rounds === 2`.
- Eight mutants die, including `keyFacts` returning `[]`, `REFUSE_AT` unreachable, `MAX_ROUNDS = 1`,
  a verb-blind `mutualMembership`, a `keyFacts` that reuses `discloses`, an ignored bar, and a
  `preferenceOrder` that takes one end of the range.
- **A post-ship review sweep found two defects the mutants could not**, both in this document's own
  decisions rather than in the code they describe: the vacuous `mutual` zero (decision 5) and the
  whole-supply shortfall (decision 6). Neither is reachable by mutating a line — one is a missing
  distinction and the other a boundary nothing exercised. That is the argument for the sweep being a
  separate instrument from the mutation run, not a redundant one.
- One mutant **reddened nothing on its first draft** because it mutated the map *builder* instead of
  the matcher. A bad mutant looks exactly like a robust test.

## Revisit when

- **A fifth verb ships, or generation order changes.** The Placement/Archaeology zero is a claim about
  `build.ts`, not about the split.
- **A verb's answer key becomes expressible** as a fact over two nodes. Then `keyNotExpressible`
  changes in one verb and the check starts firing without the harness learning a verb's name.
- **A repo whose mutual-membership count is not ~0.** Decision 5 is a judgement taken against small
  numbers.
- **The twin surface's gate changes.** Decision 3's bar is deliberately blunter than the gate it
  protects, and the two agree only because the quiz is taken after a full clear.
