# Experiment 0001 — Does the world beat the map?

- **Status**: **designed, not run — and revised after review.** Four defects were found in the
  first draft, including a tier-3 item using the exact wording ADR-0008 removed from the product.
  Two structural problems remain open and are listed in §8: the matched repos are still a TODO, and
  the two-arm design cannot measure the outcome `docs/prior-art.md` predicts. Committing this clears the half of ADR-0009's S1 that gates
  *merging*; the half that gates *shipping* needs the experiment actually run.
- **Date**: 2026-08-10
- **Discharges**: [ADR-0009](../decisions/0009-third-person-is-a-presentation-layer-over-the-same-atlas.md)
  S1 — *"before any third-person code merges, a written experiment design is committed"* — recorded
  there as a **breach** since the orbit view merged without one
- **Bears on**: [ADR-0032](../decisions/0032-the-walkable-world-is-a-city-on-a-plane.md) stage D;
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

So the prior is that the flat map wins on recall and the orbit is the intervention with evidence.
**Stating that here is the point of stating it here**: an experiment whose designer expects to win is
an experiment that finds a way to.

---

## 3. The measure, and why it is two measures rather than one

S1 as written measures **recall**. The product's stated motivation — *"let players explore any repo
and understand it easily; gamify it"* — has a second half that recall does not capture: a tool that
teaches marginally better and does not get used teaches nothing.

So the criterion is **extended, not relaxed**, and both halves are pre-registered:

| | measure | how |
|---|---|---|
| **M1 — comprehension** | recall of structure, one day later | §4's quiz, scored blind |
| **M2 — engagement** | challenges attempted **within the fixed 20 minutes**, and self-reported willingness to continue | instrumented by the player, plus one intake-style question |

**Exposure stays fixed at 20 minutes for both arms.** The first draft also measured *"voluntary
session length when the timer is removed"* — which destroys M1's only control, because voluntary
exposure is exactly the quantity the world is hypothesised to increase, so a world that teaches less
per minute could pass the recall gate on time-on-task alone. And `docs/prior-art.md` §4.3.9 is blunt
about the other half: *"A 3D world will produce a spike. The spike is not evidence."*

**M1 is the gate. M2 is reported and cannot substitute for it.** A world that is more fun and teaches
less is a worse product than a map that is duller and teaches more, and ADR-0009 exists to stop the
opposite argument being made after the fact. What M2 buys is the ability to say *why* if M1 comes out
level: the same score in half the time, or twice the challenges attempted, is a real finding and it
would go to the owner as a decision rather than being folded into a pass.

---

## 4. Design

**Between subjects.** Once you have mapped a repo in one mode your knowledge of it is contaminated
for the other, so nobody sees the same repo twice and nobody sees both modes on one repo.

- **n ≥ 6 per arm, 12 participants, each seeing exactly one mode**, recruited from outside the
  project. **Between subjects throughout**: the first draft said this and then described a crossover
  in §7 (*"two 20-minute sessions … each"*), which is a different experiment with a different n and a
  paired analysis. One participant, one repo, one mode, one quiz. This disqualifies the author and
  anyone who has read this repository — which is the clause that makes S1 hard and is not negotiable,
  because the whole construct is *knowledge of a codebase you did not already know*.
- **Two matched repos**, neither seen by any participant. Matched on node count within ~20%, on
  having a real history, and on language familiarity self-reported at intake. Candidates from the
  set ark already indexes cleanly: `honojs/hono` (425 nodes) and `gohugoio/hugo` (1,242) are *not*
  matched; two repos of similar size must be chosen and named here before recruiting.
- **Counterbalanced**: half start with the map, half with the world; repo assignment crossed with
  mode so repo difficulty cannot be read as a mode effect.
- **Fixed exposure**: 20 minutes, timed, with the same "Where next?" guidance available in both arms.
- **The quiz is administered one day later**, not immediately — retained structure is the construct,
  and `docs/prior-art.md` §2's closing point is that **no study in this literature has ever measured
  retained structural knowledge after the tool was taken away.**

### 4.1 The quiz must go beyond the stated single-session outcome

NORTH-STAR §4 promises that after one session a player can name the entry point, the top-level
regions, and the most-depended-upon module. **A quiz made of those three questions will hit the
ceiling in both arms and the criterion will pass trivially** — ADR-0009 says so explicitly, and it is
the most likely way for this experiment to produce a meaningless pass.

So the instrument is scored in three tiers, and only the third discriminates:

1. **Orientation** (expected ceiling in both arms): name the entry point; name three top-level
   regions.
2. **Topology**: given six files, rank them by how many things depend on them. Scored by rank
   correlation against the atlas.
3. **Coupling — the discriminating tier**: *"a change lands in X; which of these eight files
   **depend on it**, directly or through a chain of imports?"* over files the participant was
   **never asked about during the session**, and *"which two of these files **change together most
   often**?"*. Scored with the same F1 the product grades by, so the number is commensurable with a
   played board.

   > **Both wordings were wrong in the first draft and are corrected here rather than quietly.** It
   > asked *"which of these files **break**"* — which is the exact phrasing NORTH-STAR §6.1's
   > 2026-08-07 amendment removed **from the product**, because import reachability overapproximates
   > required change and the old wording *"would mark players wrong on files that provably need no
   > change"* (ADR-0008). Scored against atlas truth it would have done precisely that, **inside the
   > instrument that gates the milestone**. And *"always change together"* claims universality where
   > the co-change matrix records frequency — Companion's own prompt says *most often*. A quiz may
   > not make claims the product refuses to make.

Tier 3 items are drawn from the atlas by the same generator the deck uses, with the subjects the
participant actually played **excluded**, so the quiz measures transferred structure rather than
remembered answers.

---

## 5. Pre-registered analysis, written before any data exists

- **Primary**: mean tier-3 F1, world arm vs map arm. **The world ships only if its mean is at least
  the map's.** Not "not significantly worse" — at least. With n = 6 per arm nothing here is powered
  for significance, and pretending otherwise with a p-value would be the dressing-up this project
  spends its ADRs refusing.
- **Reported alongside, never substituted**: tiers 1 and 2, M2's two engagement measures, and time to
  first correct answer.
- **Blind scoring**: quizzes are scored by arm-blinded transcript, because tier 3 is F1 over a set
  and tier 2 is a rank correlation — both mechanical, so blinding costs nothing and removes the
  obvious hole.
- **Stopping rule**: the arms are fixed at 6 before recruiting and are not extended after looking.

---

## 6. What counts as failure, and what happens then

- **The world's mean tier-3 F1 is below the map's** → rung 3 does not ship. ADR-0009: *"everything in
  'Against' says that is a real possible outcome."*
- **Participants cannot be recruited** → S1 is **failed, not waived**, and ADR-0009 is revisited
  rather than reinterpreted. That sentence is quoted here because it is the one a future session
  under deadline will most want to read past.
- **Both arms hit the ceiling** → the instrument failed, not the world. Re-run with a harder tier 3;
  do not report a tie as a pass.

**A result nobody has to obey is not a gate.** If the owner intends to ship the walkable world
regardless of what this measures, the honest form of that is a dated note in ADR-0009 saying so —
not an experiment quietly not run, and not one run and then reinterpreted.

---

## 7. What this costs

Twelve participants, one 20-minute session and one next-day quiz each. The expensive part is
recruitment from outside the project, and it is the same wall NORTH-STAR risk #1's transfer playtest
has never got over — that experiment has also never been run, and this one is deliberately shaped so
that **running it answers a large part of risk #1 as a side effect**: tier 3 over unseen subjects is
a transfer measure whether the arms differ or not.

---

## 8. What review left open

Corrected above: the between-subjects/crossover contradiction, the voluntary-exposure measure that
destroyed the control, and both tier-3 wordings — one of which asked the question ADR-0008 removed
from the product for marking players wrong.

**Still open, and blocking a run:**

- **The matched repos are a TODO.** *"Two repos of similar size must be chosen and named here before
  recruiting"* — and naming them is the hard part, not a formality: tier 3's dependence item needs a
  repo in `GRADED_IMPORT_LANGS` (a Python repo ships **no** Blast Radius boards at all, ADR-0028),
  node counts within ~20%, real history, and neither seen by any of twelve people. A decision is not
  a delivery; this design cannot be run until the two are named.
- **Two arms cannot measure the thing the evidence predicts.** `docs/prior-art.md` §2's finding is
  that *exocentric* 3D wins and *egocentric* loses — to exocentric. Map-versus-world cannot see
  "orbit beats both", and ADR-0009 gates the avatar on *the orbit's own measured results*, which no
  arm here produces. A third arm is the repair and it is 50% more recruiting on the constraint that
  already makes S1 hard.
- **The quiz is per-participant, not fixed.** Excluding the subjects each person played makes every
  quiz different, and played sets will differ **systematically by arm** — walking reaches different
  subjects than the map does — so arm means would be computed over systematically different items.
  S1 asked for *"a fixed recall quiz"*. Either fix the item set and accept some overlap with played
  subjects, or stratify; the first draft did neither and did not notice it had deviated.
