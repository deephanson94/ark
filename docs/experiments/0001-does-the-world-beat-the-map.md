# Experiment 0001 — Does the world beat the map?

- **Status**: **designed and runnable; not run.** Revised twice. The first review found four
  defects, including a tier-3 item using the exact wording ADR-0008 removed from the product. The
  second revision (2026-08-11) closed the three structural problems §8 had left open — the matched
  repos are **named with commits** (§4.1), the arm structure is **staged** and the minimap confound
  resolved by measurement (§4.2, §4.3), and the quiz is a **fixed held-out item set** (§4.4). What
  remains is in §9: two pieces of harness, and recruiting, which is owner-only. Committing the
  design cleared the half of ADR-0009's S1 that gates *merging*; the half that gates *shipping*
  needs the experiment actually run.
- **Date**: 2026-08-10, revised 2026-08-11
- **Discharges**: [ADR-0009](../decisions/0009-third-person-is-a-presentation-layer-over-the-same-atlas.md)
  S1 — *"before any third-person code merges, a written experiment design is committed"* — recorded
  there as a **breach** since the orbit view merged without one
- **Bears on**: [ADR-0032](../decisions/0032-the-walkable-world-is-a-city-on-a-plane.md) stage D;
  [ADR-0033](../decisions/0033-the-roads-are-the-edges-and-a-commit-stands-at-the-chronicle.md) §4;
  NORTH-STAR risk #1 (transfer)

---

## 1. Why this document exists at all

ADR-0009's ship criterion is one sentence — *"It beats the flat map on measured recall, or it does
not ship"* — and it has never been executable, because nobody wrote down what "measured" means. The
orbit view then merged anyway. That ADR records it as *"a breach, not a waiver"* and makes the design
a blocking precondition on the **next** rung rather than retroactively on the last one.

This is that design. It is written before the world exists on purpose: a criterion authored after you
have seen the thing you are grading is not a criterion.

---

## 2. What is being asked, and the honest prior

**Does exploring a repository as a place teach you more about it than reading a map of it?**

The nearest evidence says **no**, and `docs/prior-art.md` is where it was gathered:

- Studying a map produces better **survey knowledge** — relative position, global layout, which is
  the hub — while navigating produces **route knowledge**. Survey knowledge is what ark teaches.
- Spatial memory for item locations degraded **monotonically with dimensional freedom** (Cockburn &
  McKenzie, n = 69), in physical environments as well as virtual.
- Traversing a virtual building was the **worst** of map / real navigation / virtual environment
  (Richardson et al. 1999).
- The measured 3D win is **exocentric** — rotating a structure you stay outside of — and replicates
  on ark's exact task (path tracing in node-link graphs, 1996 → 2005 → a preregistered 2023 study).

So the prior is that the flat map wins on recall and the **orbit** is the intervention with evidence.
**Stating that here is the point of stating it here**: an experiment whose designer expects to win is
an experiment that finds a way to. Two independent playtests of the walkable world rated it 3/10 and
then 5/10 and both concluded it teaches nothing the flat map does not (ADR-0033 §8.1, §8.4), which is
the same prediction arriving from the other direction.

---

## 3. The measure, and why it is two measures rather than one

S1 as written measures **recall**. The product's stated motivation — *"let players explore any repo
and understand it easily; gamify it"* — has a second half that recall does not capture: a tool that
teaches marginally better and does not get used teaches nothing.

So the criterion is **extended, not relaxed**, and both halves are pre-registered:

| | measure | how |
|---|---|---|
| **M1 — comprehension** | recall of structure, one day later | §4.4's quiz, scored blind |
| **M2 — engagement** | challenges attempted **within the fixed 20 minutes**, and self-reported willingness to continue | instrumented by the player, plus one intake-style question |

**Exposure stays fixed at 20 minutes for every arm.** The first draft also measured *"voluntary
session length when the timer is removed"* — which destroys M1's only control, because voluntary
exposure is exactly the quantity the world is hypothesised to increase, so a world that teaches less
per minute could pass the recall gate on time-on-task alone. And `docs/prior-art.md` §4.3.9 is blunt
about the other half: *"A 3D world will produce a spike. The spike is not evidence."*

**M1 is the gate. M2 is reported and cannot substitute for it.** A world that is more fun and teaches
less is a worse product than a map that is duller and teaches more, and ADR-0009 exists to stop the
opposite argument being made after the fact. What M2 buys is the ability to say *why* if M1 comes out
level: the same score in half the time, or twice the challenges attempted, is a real finding and it
would go to the owner as a decision rather than being folded into a pass.

> **M2 is not instrumented today, and the table above says it is.** `noteAttempt` keeps attempt
> counts in `selector.ts`'s session state and **nothing persists them** — the save records passes
> and `surveyed`, and neither is a count of attempts. §9 carries the cost. Recorded here rather than
> quietly fixed in the sentence, because a document claiming a behaviour the code does not have is
> this repo's most-repeated defect.

---

## 4. Design

**Between subjects.** Once you have mapped a repo in one mode your knowledge of it is contaminated
for the other, so nobody sees the same repo twice and nobody sees both modes on one repo.

- **n ≥ 6 per arm, one mode each**, recruited from outside the project. **Between subjects
  throughout**: the first draft said this and then described a crossover in §7 (*"two 20-minute
  sessions … each"*), which is a different experiment with a different n and a paired analysis. One
  participant, one repo, one mode, one quiz. This disqualifies the author and anyone who has read
  this repository — which is the clause that makes S1 hard and is not negotiable, because the whole
  construct is *knowledge of a codebase you did not already know*.
- **Two matched repos** (§4.1), neither seen by any participant, screened at intake.
- **Counterbalanced**: repo assignment crossed with mode, so repo difficulty cannot be read as a
  mode effect. With 6 per arm that is 3 participants per (repo, mode) cell.
- **Fixed exposure**: 20 minutes, timed, with the same "Where next?" guidance available in every arm.
- **The quiz is administered one day later**, not immediately — retained structure is the construct,
  and `docs/prior-art.md` §2's closing point is that **no study in this literature has ever measured
  retained structural knowledge after the tool was taken away.**

### 4.1 The two matched repos, named

**`graphql/graphql-js` at `9c245018484668b7c35f3ed219092a98855bd51e`** and **`kysely-org/kysely` at
`f24018c789c3cf7ad03ccc672ada63a1ded87f88`**. Both cloned at **full depth** — `git rev-parse
--is-shallow-repository` returns `false` for both, checked rather than remembered, because a
`--depth` clone trips the shallow refusal in `src/verbs/commits.ts` and would silently withdraw the
history half of the deck.

| | graphql-js | kysely | apart |
|---|---|---|---|
| nodes | 549 | 600 | **8.9%** |
| edges | 2,029 | 2,476 | |
| edges per node | 3.70 | 4.13 | **11.0%** |
| Blast Radius boards | 69 | 75 | **8.3%** |
| deck | 276 = 69 × 4 | 300 = 75 × 4 | |
| regions | 36 | 23 | 44.1% |
| commits retained | 500 of 3,774 | 500 of 1,549 | |
| retained window | 2022-04-26 → 2026-07-27 | 2023-12-29 → 2026-08-10 | |
| co-change pairs | 4,102 | 3,719 | |
| TypeScript share of code nodes | 0.84 | 0.90 | |
| index time | 2,733 ms | 3,058 ms | (ceiling 10 s) |
| atlas | 886.2 KiB | 936.4 KiB | (ceiling 5 MB) |
| stars, as a recruiting proxy | 20.3k | 14.1k | |

*(Measured with ark at `7a79ee5`, on full clones of the two commits above. Every figure moves if
either repo's HEAD moves, which is why the commits are named and not the branches.)*

Both are written in languages in `GRADED_IMPORT_LANGS`, so tier 3's dependence item has boards on
both sides — a Python repo ships **no** Blast Radius at all (ADR-0028) and was never eligible.

Both decks come out **exactly balanced across the four verbs** — 69 × 4 and 75 × 4 — and that is not
a coincidence worth admiring, it is the useful fact underneath: on both repos every verb is
**cap-limited rather than supply-limited**, so the generator stopped because it had enough and not
because it ran out. (`graphql-js` had 220 subjects with a radius and shipped 69; `kysely` 331 and
shipped 75.) It matters because a supply-limited verb is one an arm cannot practise: `cheerio`'s deck
is 16 / 29 / 23 / 8, and a player there plays whatever the repo happened to leave lying around.

**How they were chosen, and what a size-only rule would have picked.** Thirty-one repositories were
cloned at full depth and indexed. Nine cleared the first filter — a Blast Radius deck of ≥ 25 boards,
and 150–700 nodes, the band where a 20-minute session covers meaningful ground without either
ceiling or flooring the quiz:

| repo | nodes | e/n | blast | deck | regions | TS share |
|---|---|---|---|---|---|---|
| `unjs/h3` | 203 | 1.88 | 40 | 160 | 23 | 0.84 |
| `fastify/fastify` | 354 | 1.00 | 37 | 172 | 20 | 0.11 |
| `honojs/hono` | 425 | 2.51 | 54 | 216 | 57 | 0.99 |
| `colinhacks/zod` | 464 | 1.16 | 58 | 232 | 31 | 0.99 |
| **`graphql/graphql-js`** | **549** | **3.70** | **69** | **276** | **36** | **0.84** |
| `effector/effector` | 564 | 1.77 | 57 | 265 | 53 | 0.80 |
| **`kysely-org/kysely`** | **600** | **4.13** | **75** | **300** | **23** | **0.90** |
| `sindresorhus/execa` | 624 | 1.92 | 78 | 312 | 35 | 0.25 |
| `statelyai/xstate` | 681 | 0.96 | 67 | 325 | 56 | 0.97 |

Thirteen pairs of those nine sit within the §4's ~20% node bound. Ranked by their **worst** mismatch
across node count, density and Blast Radius supply:

| pair | nodes | e/n | blast | worst |
|---|---|---|---|---|
| **graphql-js / kysely** | 549 / 600 | 3.70 / 4.13 | 69 / 75 | **11.0%** |
| effector / execa | 564 / 624 | 1.77 / 1.92 | 57 / 78 | 31.1% |
| effector / zod | 564 / 464 | 1.77 / 1.16 | 57 / 58 | 41.6% |
| … | | | | |
| hono / zod | 425 / 464 | 2.51 / 1.16 | 54 / 58 | 73.6% |

Three things this measurement settled that picking by feel would not have:

- **Node count alone is not a match.** The pair a size-only rule picks is **hono / zod** — 8.8%
  apart on nodes and **2.2× apart on density**, which is the quantity that decides how big a
  transitive cone is and therefore how hard every Blast Radius board is. §4's stated criterion was
  node count; it needed a second axis, and the second axis is where the candidates separate.
- **Blast supply is not implied by size or density and had to be measured.** `elysiajs/elysia` (255
  nodes, 1.93 e/n) is a near-exact structural twin of `unjs/h3` (203, 1.88) and ships **2** Blast
  Radius boards of 44 eligible subjects — the other 42 refused as `uncertain`, guardrail 4 doing its
  job. A pair chosen on the two structural axes alone would have had no tier-3 dependence item on
  one side of it.
- **The runner-up is demoted by language, not by structure.** `effector / execa` matches better on
  size *and* density than anything but the chosen pair, and execa's code nodes are 25% TypeScript
  against effector's 80%. §4 matches on language familiarity; that is the axis it fails.

Residual mismatch, stated rather than absorbed: **region count, 36 against 23.** Regions are a
derived clustering rather than a property of the source, and the crossing absorbs repo-level
difficulty, so this is reported and not corrected for. The obvious alternative — matching on regions
too — has no candidate pair at all in the measured slate.

### 4.2 Three arms, run in two stages

Two arms cannot detect *"orbit beats both"*, which is what §2's evidence actually predicts, and
ADR-0009's own ordering is explicit: *"the first experiment is the fly-through, not the avatar …
if the fly-through does not beat the flat map on S1, the avatar never happens."* Four structures
were put to the owner with their recruiting costs. **The owner chose the staged one** (2026-08-11):

**Stage 1 — map vs orbit. 12 participants, 6 per arm.**
This is the comparison the evidence is about, and it produces the *"orbit's own measured results"*
that ADR-0009's P4 named and that no arm of the two-arm design produced.

> **Stop rule, pre-registered.** If the orbit arm's mean tier-3 F1 is **below** the map arm's, stage
> 2 is not run. ADR-0009 says the avatar is gated on the fly-through's results; a fly-through that
> loses gates it shut. The world then stays a mode with S1 unmet, and the honest form of that is
> §6's last paragraph — a dated note in ADR-0009, not a quiet non-run.

**Stage 2 — the world arm. 6 more participants, scored against stage 1's map arm as a shared
control.** Same two repos at the same two commits, the same held-out quiz, the same 20 minutes, the
same blind scorer. The atlas is byte-identical by construction: `test:determinism` is the assertion
that indexing a named commit twice produces the same bytes, so the second round plays exactly the
artifact the first round played.

Total **12 if it stops, 18 if it runs** — against 18 committed up front for three simultaneous arms.

> **What reusing a control costs, said out loud.** Stage 1's map arm is not randomised against stage
> 2's world arm in time: the two rounds are recruited separately and sit weeks apart, so any drift in
> the recruiting pool loads onto the map-vs-world contrast and not onto map-vs-orbit. Record the date
> of every session. If the two rounds' recruiting differs in any way the facilitator can name — a
> different channel, a different seniority mix — the map-vs-world contrast is reported as
> **descriptive** and the map-vs-orbit one remains the gate.

### 4.3 The minimap draws no edges in the world arm

ADR-0033 §4 records the confound: the world's minimap is a north-up 2D inset that draws the same
import edges the world does, so a walker may be reading topology off a flat map drawn over a 3D
scene. That section frames the repair as a binary — the inset *"must be present in both of its arms
or in neither"*.

**Measured, the binary is wrong, and so was the first guess at why the inset helps.** The hypothesis
going in was that the inset shows *more* than the world, since `render.ts` culls roads at
`VIEW_DISTANCE = 620` and `minimap.ts` culls nothing. Sampling 121 standing positions on an 11 × 11
grid over each repo's bounds and counting roads that pass `withinReach`:

| | roads | world, min | world, mean | world, max | minimap |
|---|---|---|---|---|---|
| graphql-js | 2,029 | 79.3% | **98.7%** | 100% | 100% |
| kysely | 2,476 | 90.3% | **99.0%** | 100% | 100% |
| *(hono, for scale)* | 1,067 | 66.4% | 95.2% | 100% | 100% |

The map spans are ~750 units against a view distance of 620, so **the cull is not the mechanism.**
The probe asserts its road count equals the atlas edge count and refuses to print for a world with
no roads, because an instrument that measures nothing looks exactly like good news.

What the inset adds is the **projection**: the same graph, exocentric, permanently on screen — which
is precisely where `docs/prior-art.md` §2 puts the entire measured 3D win. So the confound is not
that the world arm sees extra topology; it is that **the world arm contains a small instance of the
map arm**, and a world win could not be attributed to walking.

**The owner chose the third option: keep the inset, drop its road layer.** Dots, hero arrow, sight
cone and waypoint stay. Dropping the whole inset would cost the arm its orientation support, and
disorientation after rotation is exactly the confound Richardson et al. 1999 report for
virtual-environment traversal — so a loss under *that* configuration would be ambiguous in the other
direction. The reach measurement above is what makes this a targeted removal rather than a guess:
the road layer is the duplicated channel, and it is the only one.

**What a win under this configuration licenses, and what it does not.** It licenses the world *with
an edgeless minimap*. That is not the build that ships today, and turning a pass into a shipping
change means shipping the graded configuration or grading the shipped one.

Built: `?arm=map|orbit|world` (`src/player/experiment.ts`). It fixes the mode the session starts in,
refuses the keys that would leave it, drops the world arm's minimap roads, and keeps the HUD's
control line from advertising a key it has disabled. **No query string is today's player, unchanged**
— the deployed page has none. This is a precondition rather than a convenience: every view is one
keystroke from every other, so before this existed a participant who pressed `o` out of curiosity
moved themselves into another arm and nothing recorded it.

### 4.4 The quiz is a fixed held-out item set

The first draft drew tier-3 items *"with the subjects the participant actually played excluded"*,
which makes every quiz different — and played sets differ **systematically by arm**, because walking
reaches different subjects than the map does. Arm means would then be computed over systematically
different items. S1 asked for *"a fixed recall quiz"*.

**The fix is a hold-out split.** Before recruiting, k boards are removed from each repo's generated
deck; the atlas both arms play is the remainder, and the removed boards are the quiz.

- **The item set is identical for every participant in both arms**, which is what S1 asked for.
- **Overlap with played subjects is zero by construction**, because a held-out board is not in
  anyone's deck.
- **The items keep the generator's certifications.** A hand-written quiz item has none of them; a
  held-out board carries all of them — guardrail 4 (no challenge whose ground truth is uncertain),
  the Ctrl+F gate, ADR-0012's one-key-once, and ADR-0008's `candidates ∩ dependents(subject, ∞) =
  truth`. It is also scored by the same F1 the product grades by, so a quiz score and a played
  board's score are the same number in the same units (§8.2's bands).

The three tiers, of which only the third discriminates:

1. **Orientation** (expected ceiling in both arms): name the entry point; name three top-level
   regions.
2. **Topology**: given six files, rank them by how many things depend on them. Scored by rank
   correlation against the atlas.
3. **Coupling — the discriminating tier**: six held-out **Blast Radius** boards (*"a change lands in
   X; which of these depend on it, directly or through a chain of imports?"*) and six held-out
   **Companion** boards (*"which of these change with X most often?"*), played on paper, scored with
   `scoreSet`. Holding out six of each costs graphql-js 12 of 276 boards and kysely 12 of 300.

   > **Both wordings were wrong in the first draft and are corrected rather than quietly.** It asked
   > *"which of these files **break**"* — the exact phrasing NORTH-STAR §6.1's 2026-08-07 amendment
   > removed **from the product**, because import reachability overapproximates required change and
   > the old wording *"would mark players wrong on files that provably need no change"* (ADR-0008).
   > Scored against atlas truth it would have done precisely that, **inside the instrument that
   > gates the milestone**. And *"always change together"* claims universality where the co-change
   > matrix records frequency — Companion's own prompt says *most often*. A quiz may not make claims
   > the product refuses to make. Taking the items from the generator makes this class of error
   > unrepeatable: the wording is the verb's, and the verb writes one sentence for both surfaces.

**The one leak a hold-out does not close, and the check that does.** A board removed from the deck is
still a subject in the graph, and ADR-0019's disclosure channel is between *reveals*: a Placement or
Companion reveal in the served deck can state an atom of a held-out Blast Radius key, which hands a
quiz answer to whoever happened to open that board. It is equal in both arms, so it adds ceiling
rather than bias — but "equal noise" is not a reason to ship an instrument with a known hole. The
split must be checked with the same `discloses` accumulator the generator uses, and any held-out item
whose key is disclosed by the served deck is swapped for the next candidate. This is the second piece
of unbuilt harness (§9).

---

## 5. Pre-registered analysis, written before any data exists

- **Primary**: mean tier-3 F1 per arm. **Stage 1: the orbit ships only if its mean is at least the
  map's. Stage 2: the world ships only if its mean is at least the map's.** Not "not significantly
  worse" — at least. With n = 6 per arm nothing here is powered for significance, and pretending
  otherwise with a p-value would be the dressing-up this project spends its ADRs refusing.
- **Reported alongside, never substituted**: tiers 1 and 2, M2's two engagement measures, and time to
  first correct answer.
- **Blind scoring**: quizzes are scored by arm-blinded transcript, because tier 3 is F1 over a set
  and tier 2 is a rank correlation — both mechanical, so blinding costs nothing and removes the
  obvious hole.
- **Stopping rule**: each arm is fixed at 6 before recruiting and is not extended after looking. The
  stage-2 stop rule in §4.2 is a decision about *whether to run an arm*, taken on stage 1's result
  and not on stage 2's.

---

## 6. What counts as failure, and what happens then

- **The orbit's mean tier-3 F1 is below the map's** → the orbit does not become the arrival state,
  and stage 2 is not run: ADR-0009 gates the avatar on the fly-through's own results.
- **The world's mean tier-3 F1 is below the map's** → rung 3 does not ship as anything but a mode.
  ADR-0009: *"everything in 'Against' says that is a real possible outcome."*
- **Participants cannot be recruited** → S1 is **failed, not waived**, and ADR-0009 is revisited
  rather than reinterpreted. That sentence is quoted here because it is the one a future session
  under deadline will most want to read past.
- **Every arm hits the ceiling** → the instrument failed, not the world. Re-run with a harder tier 3;
  do not report a tie as a pass. The mirror case is as real and the first draft did not name it: with
  549- and 600-node repos and a 20-minute exposure, **the floor is as likely as the ceiling**, and a
  tier-3 mean near zero in every arm is the same instrument failure wearing the opposite sign.

**A result nobody has to obey is not a gate.** If the owner intends to ship the walkable world
regardless of what this measures, the honest form of that is a dated note in ADR-0009 saying so —
not an experiment quietly not run, and not one run and then reinterpreted.

---

## 7. What this costs

Twelve participants, or eighteen if stage 1 passes: one 20-minute session and one next-day quiz each.
The expensive part is recruitment from outside the project, and it is the same wall NORTH-STAR risk
#1's transfer playtest has never got over — that experiment has also never been run, and this one is
deliberately shaped so that **running it answers a large part of risk #1 as a side effect**: tier 3
over held-out subjects is a transfer measure whether the arms differ or not.

---

## 8. What the second revision closed

All three of the blockers the first review left open:

- **The matched repos** are named with commits and chosen from a measured slate of 31 (§4.1),
  including the finding that the criterion as written — node count — picks a pair whose densities
  differ by 2.2×.
- **The arm structure** is staged, three arms across two rounds with a stop rule, decided by the
  owner (§4.2); and ADR-0033 §4's minimap confound is resolved by a measurement that refuted the
  obvious account of it (§4.3).
- **The quiz** is a fixed held-out item set carrying the generator's own certifications (§4.4).

Corrected in the first revision and still standing: the between-subjects/crossover contradiction, the
voluntary-exposure measure that destroyed the control, and both tier-3 wordings — one of which asked
the question ADR-0008 removed from the product for marking players wrong.

---

## 9. What is left before this can be run

Two pieces of harness, both small and neither owner-gated, and then the thing that is:

1. **The hold-out split.** A script that takes a built atlas, removes k boards per verb, writes the
   played atlas and the quiz, and **checks the removed keys against the served deck's `discloses`
   output** (§4.4). Without the check the split ships with a known leak; without the split there is
   no fixed item set. Estimated at one script and one test over the two named atlases.
2. **M2's instrumentation.** Attempts are session state and nothing persists them (§3), so the
   engagement half of the criterion cannot be read off a finished session today. A counter in the
   save, or a facilitator's tally — the first is a schema change and the second is free and less
   reliable.
3. **Recruiting twelve people from outside the project.** Owner-only, and the wall S1 was always
   going to hit. Everything above exists so that the answer to *"why has this not run?"* is this line
   and nothing else.
