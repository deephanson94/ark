# ADR-0023 — The best wrong answer is a board improvement, not a gate

- **Date**: 2026-08-09
- **Status**: accepted, and built.
- **Extends**: NORTH-STAR §8.3 (the four strategies, and the sentence naming
  *historically-coupled-but-not-structurally* the best of them);
  [ADR-0018](./0018-a-subject-is-a-place-or-an-event.md) decision 6 (this verb's mix, and the
  counterfactual discipline it had to learn twice);
  [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md) decisions 3 and 4 (withhold
  by class or by board, never by row).
  **Answers, in the negative, the question
  [ADR-0022](./0022-a-verb-declares-what-would-beat-it.md) left open** — *"whether Placement wants a
  co-change distractor strategy … it would lower the guess's precision at the source rather than
  gating it"*.
- **Bumps**: nothing. No schema change, no `ATLAS_VERSION` move, no migration — a strategy id is a
  witness token and `witness.ts` validates the *shape* of one, never a list of names.
- **Measured on**: clean clones of ark at **`d91ba27`** and of `honojs/hono` at **`7075369e`** (full
  clone, not `--depth`), every figure produced by the generator `build.ts` actually runs, against a
  tree that does not contain the probe. Ark indexes itself, so the commit carrying this document is
  by construction one later than the one it describes.

---

## The gap, which is two gaps wearing one name

NORTH-STAR §8.3 lists four distractor strategies and ranks them, and it is unambiguous about the
fourth:

> **Historically-coupled-but-not-structurally**: files that co-change but don't import. These are the
> **best** distractors, because getting them wrong is itself a lesson.

Blast Radius has had one since M2. Companion *is* one — its whole answer key is that relation, so its
flagship distractor inverts to `structural`. Archaeology has `companion`. **Placement had none**: its
mix was `busy`, `mentioned`, `nameSimilar`, `structural`, `treeSibling`, and the one class §8.3 calls
best was missing from the one verb whose subject is a change.

That is the §8.3 gap. The second is ADR-0022's, and it is the reason this was next rather than
merely nice: that document closed a leak by **gating** — Placement declares a verdict, Archaeology
withholds the commit — and recorded in as many words that the honest fix might be upstream, *"at the
source rather than gating it"*. Put a commit's co-change partners on its board as wrong answers and
the guess *"tick everything wired to the seed"* stops being precise, because some of what is wired is
now wrong.

**That is a claim, so it was measured before it was believed. It is false on this repo.**

## The counterfactual, and what it holds fixed

A mix is a budget: a sixth strategy is paid for by the other five, so a naive before/after turns two
knobs and names one — the error ADR-0018 §6 records and which this repo has now made twice. Three
configurations, all run through the real generator:

| | ark deck | ark `ctrlF` | verdicts | hono deck | hono `ctrlF` | verdicts |
|---|---|---|---|---|---|---|
| **1** as shipped at `d91ba27` | 40 | 4 | **33** | 54 | 182 | **28** |
| **2** the new mix, `coChange` supplying nothing | 40 | 4 | 33 | 54 | 183 | 20 |
| **3** the new mix, strategy live | 40 | 5 | **36** | 54 | 181 | **23** |

*verdicts* = `placement.decidedBy` declarations, ADR-0022's own instrument. Row 2 is the control that
separates the re-weighting from the picks, and it earns its place: hono's total falls 28 → 20 on the
re-weighting **alone**.

And the totals cannot be compared, which is the point of having a third row of arithmetic. The deck
reshuffles — one more board refused by the gate here, one fewer capped — so a total mixes *how
exposed a board is* with *which boards shipped*. The counterfactual that holds the board fixed is the
per-commit one. Same commit, same answer key, different wrong answers — and *"same answer key"* is
checked rather than read off the code: `truth` is sampled from the commit's own file list and `size`
depends on the pool's *size* rather than its contents, so nothing a strategy does can move it, and
diffing the two atlases confirms it on the **30 boards that ship in both — 0 answer keys differ**.

| same-board comparison | boards in both | verdicts | fell on | rose on | boards with a verdict | mean best score |
|---|---|---|---|---|---|---|
| ark, 1 → 3 | 30 | 26 → **27** | **0** | 1 | 12 → 12 | 0.697 → **0.697** |
| ark, 1 → 2 (re-weight only) | 40 | 33 → 33 | 0 | 0 | 16 → 16 | 0.703 → 0.699 |
| hono, 1 → 3 | 40 | 24 → **19** | 4 | 1 | 10 → 8 | 0.596 → 0.586 |
| hono, 1 → 2 (re-weight only) | 38 | 14 → 14 | 0 | 0 | 9 → 9 | 0.599 → 0.603 |
| hono, 2 → 3 (strategy only) | 28 | 13 → **8** | 3 | 0 | 7 → 6 | 0.587 → 0.568 |

**On the bootstrap repo the strategy removes not one verdict.** On hono it removes 5 of 24 over 2 of
10 boards, and that drop is the strategy rather than the mix: the two re-weight-only rows move
**nothing** on shared boards, on either repo, while row 2 → 3 accounts for the whole fall.

## Decision 1 — this ships as a §8.3 board improvement, and closes nothing

It is not a gate and it must not be described as one. ADR-0022's `decidedBy` stays exactly as it is;
nothing in this change licenses relaxing it, and the residual it bounds is unchanged.

What ships is the thing §8.3 asked for: **98 wrong answers on this repo and 141 on hono** drawn from
the class it calls best — over **39 of this repo's 40 boards and 48 of hono's 54** — where there were
none. Getting one wrong is the
lesson that a file which always travels with `parse.ts` did not have to travel *this* time — which is
the distinction between coupling and causation, and the one this verb is otherwise silent about.

## Decision 2 — why it cannot close it, which is structural rather than a tuning failure

The guess ADR-0022 prices is *"pick every candidate the matrix wires to seed S"*. To dilute it you
need a candidate that is a partner of **S**. This strategy offers partners of the **answer key**.
Those are the same set only when S is a key member — and mostly it is not:

| where the deciding seed sits | ark @ `d91ba27` | hono @ `7075369e` |
|---|---|---|
| a key member of the board it decides | 12 of 33 | 4 of 28 |
| a wrong answer on that board | 2 | 5 |
| **not on the board at all** | **19 (58%)** | **19 (68%)** |

A distractor anchored on the answer key cannot reach a seed that is not adjacent to the answer key.
This is ADR-0022 decision 1's finding from the other side — its variant B failed *"because the
decisive wire runs from an off-board seed to a candidate"* — and it says the same thing about the
upstream lever that it said about the downstream one.

So the fix that would work is to choose distractors that are partners of the deciding seed. Finding
that seed means scoring the guess against the answer key, which is `decidedBy` with a different
return type. **The upstream fix, executed, is the downstream gate wearing a hat.** ADR-0022's choice
is now measured rather than argued, and the sentence it left behind is answered: yes, the verb wants
the strategy; no, it does not lower the exposure here.

There is a second reason not to reach for the version that would work, and it is the older one:
choosing a wrong answer *against a specific guess* is authoring the board, which ADR-0018 §6 already
declined for `busy` — the gate refuses a board the guess beats; it does not compose one the guess
loses on.

## Decision 3 — the mix takes 0.05 each from §8.3's three anchors, and nothing from `busy`

| | before | after | why |
|---|---|---|---|
| `busy` | 0.35 | **0.35** | The counterweight to `gate.ts`'s `churn` heuristic — the guess this verb's boards structurally invite, since a commit's files are files that get committed to. ADR-0018 §6 measured it at five boards and twenty-two hono refusals. Starving it weakens a gate that refuses boards today. |
| `coChange` | — | **0.15** | §8.3's own share for the historical class, and Blast Radius's. |
| `structural` | 0.20 | 0.15 | §8.3's first anchor, re-anchored on the key. |
| `treeSibling` | 0.20 | 0.15 | §8.3's second. |
| `nameSimilar` | 0.15 | 0.10 | §8.3's third — the least-valued of the three gives up the largest share of itself. |
| `mentioned` | 0.10 | **0.10** | Supply is thin enough that its quota rarely binds, and its picks are the sharpest on the board. |

Measured, the mix moves as declared and `busy` is untouched in fact as well as in quota:

| strategy | ark before → after | hono before → after |
|---|---|---|
| `busy` | 244 → **242** | 357 → **354** |
| `coChange` | 0 → 98 | 0 → 141 |
| `structural` | 107 → 68 | 179 → 123 |
| `treeSibling` | 117 → 77 | 171 → 124 |
| `nameSimilar` | 78 → 69 | 148 → 108 |
| `mentioned` | 58 → 59 | 79 → 83 |

The gate is unmoved: `ctrlF` refusals 4 → 5 here, 182 → 181 there. The two deep-supply strategies
give up more than their quota cut because the unspent-quota pass hands leftovers back in declared
order and they were the ones collecting them — the second knob, visible only because row 2 exists.

## Decision 4 — the class is **withheld**, on the same refusal Blast Radius makes

`blastRadius/reveal.ts` deletes its co-change sentence because the pair it names is Companion's
answer key for the same subject. **This is a judgement and the argument for speaking it is real**, so
it is stated first: Placement's sentence would be an *existential* over the answer key — *"a file
that usually moves with one this commit changed"* — where Blast Radius's is an **identity** with the
subject. A disjunction over a six-file key is genuinely weaker than naming a pair.

Three things outweigh it, all measured at `d91ba27` and `7075369e`:

- **Volume.** 52 of this repo's 98 co-change rows hold a pair that is a member of a shipped Companion
  board's answer key; 29 of hono's 141. Blast Radius refuses the same relation at **11 of 15 rows
  here and 8 of 53 there** — so this is 6.5× the rows and 4.7× the atoms of a class already refused
  at the smaller number. *(Its own file recorded "3 of 12", from a commit it did not name; those
  figures are re-measured and stamped as part of this change — the measured-constant landmine, found
  because this decision needed the comparison.)*
- **On a one-file answer key the existential is an identity.** The set it quantifies over has size 1,
  so *"one this commit changed"* names that file and the sentence *is* the pair — ADR-0019's
  set-size rule, arriving here as a property of the board. **8 rows here, 25 of hono's 141.** A
  `truth.length >= 2` guard would be legal under ADR-0020 decision 3 and would still leave the other
  90 rows stating the disjunction, which is the thing being withheld.
- **The fall-through is not empty.** A withheld row still gets *"edited in N commits, but not in this
  one"*, or the import or message arm if one fires. Nothing is lost but the naming of the relation.

Withholding is by **class**, never by row, so the silence says nothing about which row it is on.

**What it costs, stated rather than hidden.** Counted rather than assumed: of the two silent classes,
`coChange` ships **98 rows here and 141 on hono** and `distant` ships **0 on both**, so an
unexplained row on a Placement board is now *uniquely* a co-change pick, and a player who works the
class partition out across boards recovers the disjunction anyway. That is real, and it is paid on
ADR-0019's own line: a **stated** atom is refused, an **implied** relation is accepted. The panel is
the gate on what the product says out loud; the atlas still records the label, exactly as §7.1 puts
`truth` in plaintext.

One thing withholding must not do is push a row onto a false sentence. It does not: a pair enters the
matrix only by being counted in a commit, so a partner's churn is never zero and `whyNot`'s
zero-churn arm — the one sentence that would be false of this class — is unreachable from it. That is
asserted, not assumed.

## Found while building it

**The unit fixture had no co-change matrix at all**, so the strategy would have shipped with zero
supply in the suite and every assertion about it would have passed over an empty set — CLAUDE.md's
degenerate-fixture landmine, arriving on schedule. The fixture now carries four pairs, one of them to
a file the commit **did** change, and each test counts the population before believing anything about
it. The first version of these tests failed with *"the strategy produced nothing"* for a second
reason worth keeping: `busy` runs first with the largest quota, and in a fixture where every file has
churn 1 it took all three partners before `coChange` was asked.

**An ordering assertion read `picked[0]` and was asserting the id sort.** `candidates` is sorted by
node id, so position in it says nothing about the order a strategy chose in. It now asserts the
picked *set* against the top of the ranking, which is the claim.

## Rejected alternatives

**Rank partners by how many key members they are coupled to, rather than by strength.** Breadth is
the more tempting-looking pick and strength is the one a player actually remembers; §6.2 words
Companion *"changes with this one most often"*, so the strongest coupling leading is the same choice
`rankCompanions` already makes. Not measured against, and it would not change decision 2 — both
orderings are anchored on the key, which is where the argument fails.

**Draw partners of the commit's whole membership rather than of the answer key.** Every other
strategy in this file takes `anchors`, and for the reason ADR-0020 found in flight: an unsampled
member is off the board entirely, so a candidate whose only relation is to one is a candidate the
player cannot reason about. It would also widen the population a withheld sentence quantifies over,
which is the shape that produced ADR-0022's found-in-flight defect.

**Apply `index.floor` to the matrix rows.** That bar exists so Companion can certify an *absence* —
the ceiling on what the pair cap could have hidden. This strategy certifies nothing by absence: a
candidate's wrongness comes from the commit's own positive file list. Every pair the matrix holds is
a pair the repo recorded, so presence needs no floor.

**Speak the class behind a `truth.length >= 2` guard.** Legal, and it buys the 90 rows the identity
case does not cover — at the price of stating a Companion pair on 52 of 98 rows here. Decision 4.

**Invert the matrix inside this file.** It is already inverted ad hoc in four places in this tree
beside the canonical one; a fifth ad-hoc copy is how two of them come to disagree.
`companion/cochange.ts`'s index is memoised per atlas, and `placement/generate.ts` already reaches
into `companion/` for the path corpus.

## Consequences

- **Placement's boards carry §8.3's best class**, and no verb is now without one.
- **ADR-0022's gate is load-bearing and stays.** The upstream alternative is measured at zero on this
  repo, and the reason is structural: 58% of deciding seeds here and 68% on hono are files the board
  never shows.
- **Archaeology's deck on this repo grows 34 → 40**, and it is a consequence rather than a payment.
  The gate refuses one more Placement board (`ctrlF` 4 → 5, `capped` 10 → 9, the same 67 commits
  considered), so a different set of commit-membership atoms reaches the accumulator and seven
  subjects stop being refused as `disclosed` (37 → 30); six of them ship, one lands on
  `duplicateKey` instead. Row 2 leaves the deck at 34, so this is the strategy's doing — and it is
  still incidental, the same shape as ADR-0022's deck growing on a `duplicateKey` reshuffle. Nothing
  was designed for it and nothing should be read into it. hono's is unchanged at 54.
- **Budgets unmoved.** One matrix-row walk per key member per commit, off an index built once per
  atlas — so there is nothing per-node to pay for. `npm run budget` reports every ceiling clear;
  index time stays in the same 0.4–0.5 s band this repo was already in (475 ms on a clean clone of
  `d91ba27`, 402–461 ms with the change on a working tree the change itself has grown) and hono's
  425 files index in **1,426 ms** against a 10,000 ms ceiling. Run-to-run variance is wider than the
  effect, which is the honest way to say it did not cost anything.
- **`report.distractorMix` gains a row** and the CLI prints it, so the class announces its own supply
  on every index.

## What this does not decide

- **Whether a distractor may be chosen against a named guess.** Decision 2 says the only version of
  this strategy that would close ADR-0022's exposure has to score the guess to pick its wrong
  answers. That is a real design question — the gate refuses, it does not compose — and it is
  declined here rather than settled.
- **Whether `truth.length === 1` boards are worth shipping at all.** They make the withheld
  existential an identity here, and ADR-0021 already noted that any guess picking the one right file
  scores 1.000 on them. Two documents have now tripped over the same board shape.
- **Whether the four ad-hoc inversions of `history.coChange` should become one.**
  `blastRadius/generate.ts`, `archaeology/corpus.ts`, `archaeology/reveal.ts` and
  `placement/index.ts` each build their own beside `companion/cochange.ts`'s; this change **imports
  the canonical one rather than writing a fifth**, which is the smallest step in the right direction
  and not the step.
