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
| **3** the new mix, `coChange` without §8.3's *don't import* clause | 40 | 5 | 36 | 54 | 181 | 23 |
| **4** the new mix, as shipped | 40 | 5 | **36** | 54 | 183 | **13** |

*verdicts* = `placement.decidedBy` declarations, ADR-0022's own instrument. Row 2 is the control that
separates the re-weighting from the picks, and it earns its place: hono's total falls 28 → 20 on the
re-weighting **alone**. Row 3 is the version that enforced only the *co-change* half of the class name
and is kept because decision 5 turns on the difference.

And the totals cannot be compared, which is the point of having a third row of arithmetic. The deck
reshuffles — one more board refused by the gate here, one fewer capped — so a total mixes *how
exposed a board is* with *which boards shipped*. The counterfactual that holds the board fixed is the
per-commit one. Same commit, same answer key, different wrong answers — and *"same answer key"* is
checked rather than read off the code: `truth` is sampled from the commit's own file list and `size`
depends on the pool's *size* rather than its contents, so nothing a strategy does can move it, and
diffing the two atlases confirms it on the **30 boards that ship in both — 0 answer keys differ**.

| same-board comparison | boards in both | verdicts | fell on | rose on | boards with a verdict | mean best score |
|---|---|---|---|---|---|---|
| ark, 1 → 4 | 30 | 26 → **27** | **0** | 1 | 12 → 12 | 0.697 → **0.697** |
| ark, 1 → 2 (re-weight only) | 40 | 33 → 33 | 0 | 0 | 16 → 16 | 0.703 → 0.699 |
| hono, 1 → 4 | 38 | 14 → **8** | 4 | 0 | 9 → 7 | 0.599 → 0.583 |
| hono, 1 → 2 (re-weight only) | 38 | 14 → 14 | 0 | 0 | 9 → 9 | 0.599 → 0.603 |
| hono, 2 → 4 (strategy only) | 54 | 20 → **13** | 5 | 0 | 14 → 11 | 0.635 → 0.612 |

**On the bootstrap repo the strategy removes not one verdict** — 30 boards, 26 → 27, and the one
board that moves moves *up*. On hono it removes **6 of 14** across the 38 boards that ship in both,
on **4** of them, and two of those boards lose their last verdict (9 → 7). Three populations, said
separately, because fusing them is how this repo has written "37 firings" as "37 refused boards"
before. The drop is the strategy rather than the mix: both re-weight-only rows move **nothing** on
shared boards, on either repo.

## Decision 1 — this ships as a §8.3 board improvement, and closes nothing

It is not a gate and it must not be described as one. ADR-0022's `decidedBy` stays exactly as it is;
nothing in this change licenses relaxing it, and the residual it bounds is unchanged.

What ships is the thing §8.3 asked for: **97 wrong answers on this repo and 139 on hono** drawn from
the class it calls best — over **39 of this repo's 40 boards and 48 of hono's 54** — where there were
none. Getting one wrong is the
lesson that a file which always travels with `parse.ts` did not have to travel *this* time — which is
the distinction between coupling and causation, and the one this verb is otherwise silent about.

**The other exposure instrument, published because it was measured.** Beside `decidedBy`, the probe
scores the same guess with an **oracle seed** — best over every seed reachable through a *drawn* wire
— which is the shape ADR-0021 rejected outright (*"it would delete a third of the deck for a strategy
**nobody can execute**, since choosing the seed needs the answer key"*), because a player still has to
decide which of the map's wires to run the guess from. It reads **9 boards / best 0.909 → 9 boards /
best 0.923** on this repo and **7 / 1.000 → 5 / 1.000** on hono. It is recorded here rather than left
in a scratch file for one reason: it bears on this document's central question and it does not flatter
the answer — on ark the best oracle score goes *up*. It changes nothing about decision 1 (the strategy
closes nothing either way) and it is not the residual ADR-0022 bounds, which is a different guess with
a seed the product hands over.

## Decision 2 — why it does not close it: the dilution is incidental, not aimed

> **A first version of this section argued the stronger thing and was wrong, in the paragraph this
> document spends the most effort on.** It read: *"To dilute the guess you need a candidate that is a
> partner of **S**; this strategy offers partners of the answer key; those are the same set only when
> S is a key member — so a distractor anchored on the answer key **cannot reach** a seed that is not
> adjacent to the answer key."* The set logic is false — `partners(key) ∩ partners(S) ≠ ∅` does not
> require `S ∈ key` — and so is the consequence: run against the control row, **4 of the 6 verdicts
> the strategy removes on hono's shared boards are seeded off the board**, exactly the class the
> paragraph declared unreachable. An adversarial review found it by diffing the verdict facts the
> document's own control row isolates. The empirical result below is unchanged; the explanation is
> replaced.

The guess ADR-0022 prices is *"pick every candidate the matrix wires to seed S"*. Diluting it needs a
wrong answer that is a partner of **S**. This strategy picks partners of the **answer key**. The two
overlap whenever a key member's partner happens to be S's partner too — which is real and is why hono
moves at all, and which the strategy has no way to aim at, because aiming means knowing S.

Where the deciding seeds sit says why the overlap is thin rather than why it is impossible:

| where the deciding seed sits | ark @ `d91ba27` | hono @ `7075369e` |
|---|---|---|
| a key member of the board it decides | 12 of 33 | 4 of 28 |
| a wrong answer on that board | 2 | 5 |
| **not on the board at all** | **19 (58%)** | **19 (68%)** |

Most seeds are files the board never shows, so most of the time the strategy's picks and the seed's
partners are two different neighbourhoods that intersect by luck. Measured, the luck runs from
**0 of ark's 26 verdicts on shared boards to 6 of hono's 14** — a lever that does nothing on one repo
and 43% on another, by coincidence, **is not a gate**. That is the claim decision 1 makes, and it
survives the argument that was wrong.

The version that *would* be a gate has to pick wrong answers that are partners of the deciding seed,
and finding that seed means scoring the guess against the answer key — `decidedBy` with a different
return type. **The upstream fix, executed, is the downstream gate wearing a hat.** ADR-0022's choice
is measured rather than argued, and the sentence it left behind is answered: yes, the verb wants the
strategy; no, it does not reliably lower the exposure, and not at all here.

There is a second reason not to reach for that version, and it is the older one: choosing a wrong
answer *against a specific guess* is authoring the board, which ADR-0018 §6 already declined for
`busy` — the gate refuses a board the guess beats; it does not compose one the guess loses on.

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
| `busy` | 244 → **242** | 357 → **358** |
| `coChange` | 0 → 97 | 0 → 139 |
| `structural` | 107 → 69 | 179 → 133 |
| `treeSibling` | 117 → 77 | 171 → 128 |
| `nameSimilar` | 78 → 69 | 148 → 110 |
| `mentioned` | 58 → 59 | 79 → 79 |

The gate moves by exactly one board in each direction — `ctrlF` refusals 4 → 5 here, 182 → **183**
there — which is a deck reshuffling around an unchanged `busy`, not a weakened gate. *(An earlier
draft called this "unmoved" three lines from a consequence calling it "one more board refused". Both
sentences were about the same +1.)* The two deep-supply strategies give up more than their quota cut
because the unspent-quota pass hands leftovers back in declared order and they were the ones
collecting them — the second knob, visible only because row 2 exists.

## Decision 4 — the class is **withheld**, on the same refusal Blast Radius makes

`blastRadius/reveal.ts` deletes its co-change sentence because the pair it names is Companion's
answer key for the same subject. **This is a judgement and the argument for speaking it is real**, so
it is stated first: Placement's sentence would be an *existential* over the answer key — *"a file
that usually moves with one this commit changed"* — where Blast Radius's is an **identity** with the
subject. A disjunction over a six-file key is genuinely weaker than naming a pair.

Three things outweigh it, all measured at `d91ba27` and `7075369e`:

- **Volume.** 49 of this repo's 97 co-change rows hold a pair that is a member of a shipped Companion
  board's answer key; 26 of hono's 139. Blast Radius refuses the same relation at **7 rows of 15 here
  and 4 of 53 there** — so this is 6.5× the rows and 7× the atoms of a class already refused at the
  smaller number. *(Its own file recorded "12 … 3", from a commit it did not name. Re-measuring it
  produced a second defect worth more than the correction: a first pass reported **11 and 8**, from a
  pair-level relation — is this pair in *any* shipped key, either way round — where that file's
  sentence is *"a member of **that** board's key"*. That is **a different instrument wearing drift's
  name**, the landmine ADR-0019 earned, committed inside the fix for the landmine next to it. The 7
  and 4 above are the file's own definition, re-measured.)*
- **On a one-file answer key the existential is an identity.** The set it quantifies over has size 1,
  so *"one this commit changed"* names that file and the sentence *is* the pair — ADR-0019's
  set-size rule, arriving here as a property of the board. **8 rows here, 32 of hono's 139.** A
  `truth.length >= 2` guard would be legal under ADR-0020 decision 3 and would still leave the other
  89 rows stating the disjunction, which is the thing being withheld.
- **The fall-through is not empty.** A withheld row still gets *"edited in N commits, but not in this
  one"*, or the import or message arm if one fires. Nothing is lost but the naming of the relation.

Withholding is by **class**, never by row, so the silence says nothing about which row it is on.

**What it costs, stated rather than hidden — and the first draft priced only half of it.** Two costs,
both counted:

- **The silence is unique.** Of the two silent classes, `coChange` ships **97 rows here and 139 on
  hono** and `distant` ships **0 on both**, so an unexplained row on a Placement board is now
  *uniquely* a co-change pick, and a player who works the class partition out across boards recovers
  the disjunction anyway.
- **The map draws it.** Those 49 withheld pairs are precisely the pairs ADR-0016 renders as wires once
  the naming Companion board is answered — **49 rows over 31 of this repo's 40 boards, 26 over 21 of
  hono's 54** — and `main.ts` suppresses wires only for open *Companion* boards, so they are drawable
  beside the open Placement board, behind the scrim §9 keeps the map visible through. A first draft of
  this section said *"nothing is lost but the naming of the relation"* without opening `src/player/`,
  which is ADR-0021's premise failing in the same place for the same reason.

Both are paid on ADR-0019's line — a **stated** atom is refused, an **implied** relation is accepted —
and the second narrows the claim rather than overturning it: withholding stops the product from
*saying* the pair on a board where nothing has been earned; it does not stop a player who has spent a
Companion pass from seeing the wire. The panel is the gate on what the product says out loud; the
atlas still records the label, exactly as §7.1 puts `truth` in plaintext.

One thing withholding must not do is push a row onto a false sentence. It does not: a pair enters the
matrix only by being counted in a commit, so a partner's churn is never zero and `whyNot`'s
zero-churn arm — the one sentence that would be false of this class — is unreachable from it. That is
asserted, not assumed.

## Decision 5 — both halves of the class name are enforced, because the first version enforced one

§8.3 words this class *"files that co-change but **don't import**"*. The strategy shipped in review
consulted the matrix and never the graph, so a file that both imports a changed file **and** moves
with it went out under a purely-historical label — **9 of this repo's 98 rows and 67 of hono's 141**,
i.e. **48% of the second repo's rows were graph-adjacent distractors wearing the historical name**.
`coChange` sits before `structural` in the mix, so it claimed those first.

That is the class-label-is-not-a-class-description landmine, and it is not only wording. A row with
two reasons to be picked teaches `structural`'s lesson; the historical signal is a trap only while it
stands alone. So the strategy now excludes a partner with a **direct import edge** to any key member —
the direct ring and no further, since that is what *"imports"* means, and `structural` reaches past it
under the honest word *near*.

Measured after: **0 import-adjacent rows on either repo**, at a cost of 1 row here and 2 on hono,
because supply was never the constraint (1,781 of 2,132 eligible partners here are non-importing,
1,431 of 1,867 on hono). It also *strengthened* the hono result — verdicts 23 → **13** (row 3 → row 4)
— which is worth naming as luck rather than design: the clause was added to make the label true.

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

**Found by the post-ship adversarial review, and it is the majority of this section.** Decision 2's
argument (broken by the document's own control row), decision 5's missing §8.3 clause, the
different-instrument re-measurement in decision 4, the map cost the withhold accounting omitted, the
oracle-seed numbers the probe produced and the document did not print, the Archaeology reconciliation,
and "5 of 24 over 2 of 10 boards" fusing three populations. Every one is a category `CLAUDE.md`
already names, which is the argument for consulting on the categories rather than on the change: the
review was told where this repo's defects live and found six of them there.

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

**Speak the class behind a `truth.length >= 2` guard.** Legal, and it buys the 89 rows the identity
case does not cover — at the price of stating a Companion pair on 49 of 97 rows here. Decision 4.

**Leave §8.3's *don't import* clause unenforced.** What review found shipped. It costs 1 row here and
2 on hono to enforce, and leaving it puts 48% of hono's rows under a label that is false of them.
Decision 5.

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
  considered), so a different set of commit-membership atoms reaches the accumulator. The refusal
  tallies move four ways at once and are given as such rather than as a story: `disclosed` **37 → 30**,
  `duplicateKey` **4 → 7**, `ctrlF` **2 → 0**, deck **34 → 40** — a reshuffle in which boards are both
  gained and lost, not seven releases of which six ship. *(A first draft told the one-way version and
  it does not reconcile with its own tallies.)* Row 2 leaves the deck at 34, so this is the strategy's
  doing — and still incidental, the same shape as ADR-0022's deck growing on a `duplicateKey`
  reshuffle. Nothing was designed for it and nothing should be read into it. hono's is unchanged at 54.
- **Budgets unmoved.** One matrix-row walk per key member per commit, off an index built once per
  atlas — so there is nothing per-node to pay for. `npm run budget` reports every ceiling clear;
  index time stays in the same 0.4–0.5 s band this repo was already in (475 ms on a clean clone of
  `d91ba27`, 402–461 ms with the change on a working tree the change itself has grown) and hono's
  425 files index in **1,426 ms**, comfortably inside the 10,000 ms ceiling — 7× of headroom, which
  is not "an order of magnitude" and an earlier draft called it that. Run-to-run variance is wider
  than the effect, which is the honest way to say it did not cost anything.
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
