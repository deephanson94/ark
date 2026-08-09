# ADR-0021 — A gate heuristic is a guess that needs no graph

- **Date**: 2026-08-09
- **Status**: accepted
- **Extends**: [ADR-0019](./0019-archaeology-asks-a-place-what-happened-to-it.md) decision 6 (what belongs
  in a gate set) and its *fourth disclosure direction* section (a **stated** atom is refused, an
  **implied** relation is accepted); [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md)
  decision 3 (withhold by class or by board, never by row) and decision 4 (the two classes never
  spoken). Closes the direction ADR-0020 measured and left open.
- **Bumps**: nothing. No schema change, no `ATLAS_VERSION` move, no migration.
- **Measured on**: clean clones of ark at **`a063f01`** and of `honojs/hono` at **`cf78528`** (full
  clone, not `--depth`), every figure read off `atlas.json` — the artefact the generator actually
  emits. Ark indexes itself, so the commit carrying this document is by construction one later than
  the one it describes.

---

## The question ADR-0020 left open

Archaeology's `sibling` witness says *"a commit that touched this file's own corner of the tree"*.
That is an existential over a subtree, and read the other way it is a weakened atom of that commit's
**Placement** answer key: go to that board, tick the candidates whose paths sit under the hinted
directory. ADR-0020 measured its **precision** — 100% on 9 of this repo's boards, at least half on 21
— and stopped there, in as many words: *"it has not been scored against a band, so it is a measured
open question rather than a demonstrated gate failure. Scoring the subtree hint as a `gate.ts`
heuristic on the Placement board is the work this leaves behind."*

This is that scoring. It changes the answer, and not in the direction the sentence above expects.

## Why the work it left behind cannot be done as written

*"Score the guess in `gate.ts` and refuse what it beats"* is not implementable, and finding out why
is the first half of this decision.

`build.ts` generates **blastRadius → companion → placement → archaeology**, and ADR-0019 decision 7
depends on that order: whichever verb asks a fact first keeps it, so Placement runs first and keeps
the commit-membership atoms its reveal names. Therefore:

- when a **Placement** board is gated, the Archaeology board that would hint at it **does not exist
  yet**, so `gate.ts` has nothing to score;
- when the **Archaeology** board is built, scoring the hint means reading Placement's candidates and
  truth — one verb reading another verb's deck, which is the coupling M4 spent its whole budget
  removing.

So the fork is not "score it or don't". It is: **how does a later verb learn that a sentence it wants
to say would decide an earlier verb's board, without reading that verb's deck?** Four answers were
open, and the measurement below decides between them rather than an argument.

## What was measured, and it is all three arms

Three of Archaeology's four witness classes state an existential of the same shape — *it touched
something in this file's neighbourhood* — and two of them, `neighbour` and `companion`, are also said
by `whyNot`'s own arms, which shipped a milestone earlier and have never been scored either. Both
surfaces are measured, separately, because they quantify over the same sets but different
populations of rows.

For every row a reveal speaks such a sentence on, if the commit it names ships a Placement board:
tick that board's candidates inside the hinted set, and score it with `scoreSet` — the scorer the
player is graded by — against band A, the bar `gate.ts` uses.

**ark @ `a063f01`** — 32 Archaeology boards, 540 wrong-answer rows, 40 Placement boards:

| arm | stated | scored | mean | best | boards beaten at **A** | at B | at pass |
|---|---|---|---|---|---|---|---|
| witness `sibling` | 117 | 104 | 0.277 | 0.600 | **0** | 1 | 9 |
| witness `neighbour` | 171 | 152 | 0.207 | 0.500 | **0** | 0 | 3 |
| witness `companion` | 201 | 182 | 0.393 | 0.857 | **1** | 8 | 14 |
| note `neighbour` | 27 | 20 | 0.176 | 0.444 | **0** | 0 | 0 |
| note `companion` | 449 | 407 | 0.353 | 0.923 | **3** | 10 | 21 |

**`honojs/hono` @ `cf78528`** — 54 boards, 875 rows, 54 Placement boards:

| arm | stated | scored | mean | best | boards beaten at **A** | at B | at pass |
|---|---|---|---|---|---|---|---|
| witness `sibling` | 91 | 29 | 0.403 | 0.727 | **0** | 2 | 6 |
| witness `neighbour` | 280 | 67 | 0.303 | 0.750 | **0** | 4 | 9 |
| witness `companion` | 147 | 45 | 0.408 | 0.800 | **1** | 6 | 9 |
| note `neighbour` | 123 | 24 | 0.252 | 0.500 | **0** | 0 | 1 |
| note `companion` | 353 | 107 | 0.320 | 0.800 | **1** | 7 | 14 |

Pooling every single hint and every intersection of the hints **one** board states about **one**
commit: **3 of ark's 40 Placement boards and 3 of hono's 54** are decided at band A. On ark all three
fall to a `companion` hint on its own; on hono one does, and the other two need that board's
`companion` and `neighbour` hints intersected. **Every firing on either repo involves the co-change
relation, and none involves `sibling`.**

**The direction this ADR was opened to close fires zero times on both repos.** Precision was the
wrong instrument and that is the whole finding: a subtree hint picks one or two of a four-to-six file
key, so its recall caps the F1 far below the bar no matter how clean the picks are. ADR-0020's nine
100%-precise boards are real and they are not a grade.

**And the bar is not a knife edge here.** The `sibling` scores immediately below the best are 0.500
on ark and 0.600 on hono — nothing sits in the gap between the best score and 0.78, which is the
plateau `gate.ts` asks for when it sets the bar at A rather than at pass. It is bar-dependent and
that is said rather than hidden: at the **pass** threshold the same hint beats 9 of ark's boards and
6 of hono's. Moving the bar is a different decision, with ADR-0010's measurement behind it.

### The counterfactual, and what it holds fixed

A hint's score is worthless without asking whether the guess needed the hint at all. The hint's only
content is *which* file to seed the neighbourhood from, so the counterfactual holds the board, the
relation and the scorer fixed and varies **only the seed**:

| how the seed is chosen | ark boards beaten | hono boards beaten |
|---|---|---|
| **handed over by a reveal** (as shipped) | **3** | **3** |
| a candidate on the board itself, whichever covers most of it | 0 | 0 |
| any file in the repo, whichever covers most of the board | 0 | 0 |
| *oracle*: any file in the repo, whichever scores best — `companion` | 18 | 15 |
| *oracle* — `neighbour` | 0 | 8 |
| *oracle* — `sibling` | 0 | 9 |

The middle two rows are guesses a person can actually execute, and they fire nowhere. So the hint is
load-bearing: this is a genuine cross-verb exposure and not a Placement-native one wearing a costume.

The oracle row is **not** a guess — it maximises F1, which needs the answer key — and it is here for
one reason: it says the co-change relation *contains* enough to decide 18 of ark's 40 Placement
boards, and all a hint does is collapse the search for the right seed. That is the number to watch if
the product ever prints the matrix.

## Decision 1 — the subtree hint stays, and a test holds it below the bar

`sibling` is spoken exactly as ADR-0020 shipped it. It is scored at 0.600 and 0.727 against a 0.78
bar, and `tests/atlas/` now asserts that every board it is spoken on stays there, using
`CTRL_F_THRESHOLD` and `scoreSet` rather than copies of them, so it moves if §8.2's bands move.

This is the arm that most needed the test, because it is the only one of the three that a player can
run **knowing nothing whatever about the repo**: a subtree is a string prefix, which is pillar 3's
*"answered by `Ctrl+F`"* word for word. It passes today on two repos and there is no argument that it
must pass on a third.

## Decision 2 — the line `gate.ts` has drawn since M2, stated

Every heuristic in `gate.ts` is executable with **no knowledge of the repo's structure**: match a
path against a path (`directory`, `name`), a token against a message (`mentions`), or sort a printed
column — dates (`recency`, `endpoints`, `oldestK`, `recentK`), churn counts (`churn`), widths
(`broadKnown`). Nine for nine. And the one guess the file has ever considered and **declined**,
`directImporters`, is the only one of the ten that needs a relation to run.

**That correlation is the argument, and the overclaim it invites has to be refused before it is
made.** A first draft of this section said the rule *"was already there, applied consistently, and
never written down"*, and that is not true. `gate.ts` describes two of its heuristics as needing
*"no understanding of the graph at all"* — a description of what they are, not a bar on what may
enter — and it excludes `directImporters` for a **different stated reason**: ADR-0008 gives depth 1
away on the map on purpose, §8.4 measures `surprise` against exactly that guess, and so *"a question
that strategy passes is an easy question, which the progression needs — not a broken one."* The two
reasons agree on the verdict for that guess and they are not the same reason.

So what follows is a **new articulation** that reproduces all ten prior decisions, not a restatement
of one already written. A rule fitted to ten points and then applied to an eleventh is a fair use of
a rule; claiming the file already contained it would have been the post-hoc rationalisation this
decision most needed to avoid, since the eleventh point is the one it was written to decide:

> A guess belongs in `gate.ts` when a player could execute it knowing nothing about the repo. If
> running it requires the import graph, the co-change matrix or a cone, it is not a `Ctrl+F` and this
> file is not the instrument for it.

The rule has teeth in both directions, which is the test of whether it is a rule or a rationalisation.
It **excludes** the two arms below. It would **include** them tomorrow if the product ever printed the
co-change matrix or the import ring as a list rather than drawing them — at which point the oracle row
above stops being a bound and starts being a guess.

## Decision 3 — the `companion` arm is accepted, and here is the number

`companion` beats band A on **3 of ark's 40 Placement boards and 3 of hono's 54**. It is not gated,
and the reason is decision 2: executing it requires knowing which files move with the subject. That
is the co-change relation — the thing Companion exists to teach and ADR-0016 draws on the map as
ember arcs. A player who answers a Placement board that way has done what pillar 3's sentence asks
for in its second half: *reasoned about structure* rather than looked something up.

**This is a judgement and the counter-argument is real.** Four things, stated rather than left for a
reviewer:

1. **This repo has refused a smaller number before.** ADR-0019 gated `broadKnown` at 1 ark board and 0
   on hono, writing *"'we measured it and shipped it anyway' is not a sentence this repo should add to
   its record."* That sentence was about a guess that reads a **printed number**. Decision 2 is what
   distinguishes the two, and if decision 2 is wrong then this is wrong with it.
2. **ADR-0019 already decided the same shape and decided it this way.** Its fourth-disclosure section
   found Archaeology→Companion leaking 23 pairs here, 14 of them a shipped Companion answer, and
   accepted it because *"Placement's reveal **states** the atom … Archaeology's reveals only
   **imply**"* the relation, and combining reveals *"is not a lookup, it is exactly the inference
   Companion exists to teach."* This is that rule one verb over, now with a band score attached,
   which that section never had.
3. **A player can reach the seed set, and how easily differs by repo.** All three ark subjects carry a
   shipped Companion board, so the partner list is knowable in-product and provable. **None of hono's
   four does**, so there the only route is reading the map's arcs. Recorded, and not as reassurance:
   ADR-0019's set-size guard leaned on a chain being incompletable in today's deck and had to say so
   out loud, because which questions happen to exist is not a property anything enforces.
4. **It is closeable, cheaply, and difficulty is not the reason it is not closed.** See the next
   section. A first draft of this document argued that no by-board guard could see a guess assembled
   from two boards — that is **false**, measured: every firing on both repos is visible to a single
   Archaeology board. The decision rests on decision 2 alone.

## Decision 4 — the guard that would close it, designed and not built

Recorded so the next session to reach this point does not redesign it, exactly as ADR-0020 recorded
the rejected `pairFact`.

The verb-blind accumulator runs in the wrong direction for scoring but the right one for
**declaring**: Placement generates first, so it can declare a *verdict* rather than a fact —
`decidedFact(commit, seed, relation)` for every (seed file, relation) whose guess beats band A on its
own board — and Archaeology withholds a class from a board when any row's commit carries that verdict
for that subject and relation. The guard is a property of the subject and the board, so ADR-0020
decision 3 holds for free.

**Measured cost: a class goes silent on 3 of ark's 32 Archaeology boards and 4 of hono's 54.** That is
cheap. What is not cheap is the shape:

- `Verb.discloses(challenge)` takes no atlas — ADR-0020 records that limit already — so declaring a
  verdict needs the graph, i.e. a contract change at every verb.
- Worse, the earlier verb has to **enumerate the relations a later verb might name**. Three exist
  today. A fifth verb stating a fourth relation gets no verdict and the leak returns **silently**,
  which is the gate-that-never-fires failure this repo has a landmine about.

So the machinery is affordable and the anticipation is not. If decision 2 is ever overturned, this is
the build.

## Found while measuring

**ADR-0020's own `sibling` precision figures do not reproduce, and one of them cannot be right.** That
document recorded *"100%-precise on 9 boards here and 4 on hono, and at least half-precise on 21 and
2"*. A fully-precise board is at-least-half-precise by definition, so **4 and 2 cannot both be true**
— the hono pair contradicts itself in its own sentence. Re-measured at `cf78528`, the commit that
document names and which has not moved: precision 1.0 on **4 rows / 3 boards**, ≥ 0.5 on **7 rows / 6
boards**. The recorded `4` matches the rows reading and the recorded `2` matches nothing.

The instrument is not in doubt, which is what makes this diagnosable: the same probe reproduces that
document's structural counts on the unchanged repo **exactly** — 91 spoken `sibling` rows and 29 of
them naming a commit with a Placement board, against a recorded 91 and 29. Ark's column drifted with
the repo (117 and 104 at `a063f01`), as it must. Fourth instance of the same class: a sentence
disagreeing with the table above it, in a document whose numbers were right.

**`sibling`'s docstring still described the population ADR-0020 had just corrected.** That document
found the class quantifying over three different sets and repaired the sentence and the guard;
`distractors.ts`'s own docstring, one file over, still said *"the deepest bucket only"*, which reads
as the exact directory when `byDirPrefix.get(home)` is the whole subtree. Fixed. This is the
already-fixed-one-line-down landmine, at file scale rather than function scale.

## Rejected alternatives

**Withhold `companion` by class.** The only complete version of the by-class rule, since the `whyNot`
arm says the same thing as the witness. It costs **449 of ark's 540 wrong-answer rows and 353 of
hono's 875** falling through to *"it landed inside this file's lifetime and never touched it"* — 83%
of the reveal's content on this repo, to close 3 boards. The flagship lesson of the verb, deleted for
a leak the same document argues is not a leak.

**Weaken the sentence until it decides nothing.** The decisive content *is* which relation is named;
anything that stops identifying the set collapses to the generic sentence. This is by-class
withholding wearing a different word, at the same price.

**Reverse generation order so Archaeology runs first and Placement's gate can score the hints.** This
is the only shape in which the objective's original sentence is literally implementable, and it
inverts ADR-0019 decision 7: Placement would then yield the commit-membership atoms, paying a deck
cost that document measured at 40 → 27 in the other direction. ADR-0019 listed *"whether Placement
should yield instead of Archaeology"* under what it does not decide, calling it *"a choice about
disruption rather than about which question is better"*. Trading a 3-board exposure for a
double-digit deck loss answers that question the expensive way round.

**Score the guess with an oracle seed and gate on that.** 18 of ark's 40 boards and 15 of hono's. It
would delete a third of the deck for a strategy **nobody can execute**, since choosing the seed needs
the answer key. That is the mistake `COMMIT_HEURISTICS` avoids by leaving `directory` out of
Placement's set — a home for a commit *"which the player cannot read off the prompt and which would
therefore delete questions for a strategy nobody could have used"*.

## Consequences

- **No code path changed.** One docstring, one header, one test. The two `src/` edits are comments —
  and on a repo that indexes itself that still moves the atlas, because a comment is bytes and `loc`.
- **`gate.ts` now states its admission rule**, so the next session adding a heuristic has a question to
  answer rather than a table to imitate.
- **The canary is the deliverable, not the prose.** The decision rests on `sibling` staying under the
  bar; a test asserts it on the real deck, was made to fail three ways before it was believed, and
  carries a vacuity guard because the population it scores sits behind three filters a deck change
  could empty.
- **`report` says nothing about this.** The exposure is cross-verb, and no single generator can see
  it — the same reason ADR-0019's disclosure check lives in `tests/atlas/` rather than in a report.

## What this does not decide

- **Whether the bar should be A for a hinted guess.** `gate.ts` sets it at A because a player applying
  a cheap-but-true structural rule *"has reasoned, badly but not vacuously"*. When the product hands
  the rule over, that argument is thinner. At pass, `sibling` beats 9 ark boards and 6 hono boards.
  Re-opening the bar means re-running ADR-0010's vite measurement, which is why it is not re-opened
  here.
- **Whether Placement wants a co-change distractor strategy.** §8.3 calls historically-coupled-but-not-
  structurally the *best* distractors and Placement is the one verb with no such strategy. Adding one
  would put F's partners on the board as wrong answers and lower every number in decision 3's table
  at the source — the `busy`-against-`churn` move, which this codebase has made twice. It is a change
  to a shipped deck, so it wants its own measurement and its own decision.
- **Whether a 1-file Placement answer key is worth shipping.** Two of hono's three decided boards have
  `truth.length === 1`, where any guess that picks the one right file scores 1.000. That is a property
  of the board, not of the hint.
