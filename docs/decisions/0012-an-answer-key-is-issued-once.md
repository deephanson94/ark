# ADR-0012 — An answer key is issued once

- **Status**: accepted
- **Date**: 2026-08-07
- **Extends**: ADR-0008 (truth is the unbounded dependent set, and a hub's key is a *sample* of it),
  ADR-0011 decision 4 (the serving rule, whose first constraint this removes the need for)
- **Bumps**: nothing. `Challenge` is unchanged; this is a generation policy, not a format change.
- **Reviewed by**: Fable, which found a factual error in the first draft's own measurements, a
  cross-reindex instability in the representative rule, and an unreported cost. All three are
  addressed below rather than dropped.

## Context

Several subjects produce **byte-identical answer keys**. M3's selector stops them being served back
to back, but that is a symptom fix: two challenges with the same key are one question wearing two
subjects, and the deck spends two of the player's questions teaching one fact.

Measured before deciding anything, on four repos:

| repo | files | deck | distinct keys | redundant |
|---|---:|---:|---:|---:|
| ark | 96 | 40 | 35 | 5 |
| vitejs/vite | 2,025 | 163 | 122 | **41** |
| sveltejs/svelte | 4,059 | 350 | 138 | **212** |
| vuejs/core | 591 | 7 | 7 | 0 |

Svelte's deck is **61% repeats**. So this is not a bootstrap-repo curiosity.

The causes were separated before choosing a fix, because they want opposite treatment:

- **A — the subjects' certain dependent sets are equal.** Nothing outside the pair can tell them
  apart through the import graph.
- **B — the sets differ, but the six-file sample collapsed them.**

**Every duplicate on ark, vite and vue is cause A. Svelte has 6 cause-B groups out of 23.** So a fix
that only diversified sampling would miss almost everything.

> **A correction, kept rather than edited out.** The first draft of this reasoning measured *raw*
> cone sizes and concluded svelte had duplicate classes of 63 subjects sharing a 2,745-file cone,
> with hundreds of spare answer keys available. That is wrong. The generator may only sample
> **certain** dependents — a tainted dependent drags its unsound cone onto the board — and svelte's
> duplicate classes have certain cones of **3, 19 and 115 files**. Fable's review was built on the
> wrong number because this document supplied it. The rule below is what the corrected measurement
> supports, and `generate.ts` carries the warning in-line.

## Decision

> **The generator issues each answer key at most once.** When a subject's canonical key is already
> taken, it is re-asked with the next **disjoint window** of its own ranked dependent order. If no
> distinct window exists, the subject carries no challenge and is counted as `duplicateKey`.

Three parts, each measured.

### 1. Windows, not perturbation

`sampleByDistance` is now the head of a total ranking (`rankByDistance`); a re-asked subject takes
`ranked[k·size … (k+1)·size)` for the first `k` whose key is unissued. Windows **tile** rather than
slide, so window 1 is the best key that shares no file with window 0. A sliding window would produce
two keys differing in one file — the same thing taught twice, and byte-equality would not even see
it. Only whole windows are used: a short tail would shrink the key below the size ADR-0007's 3:1 rule
was checked at.

Re-asking fires **3 times on ark, 15 on svelte, 0 on vite**, and `report.reasked` prints it on every
run. That number is in the report deliberately: it is the only way a future session can tell whether
this path is still alive, and `CLAUDE.md` says a path that never executes should be deleted rather
than tested around.

### 2. The representative is the least obvious member

Not the hardest. `difficultyOf` divides by repo-wide maxima, so ranking a duplicate group by
difficulty lets an edit *anywhere* reorder it and swap which twin survives — and because the save is
keyed by `(verb, subject)` (ADR-0011), a swap re-serves a question the player already answered
wearing the other subject's name. That is this ADR's own defect re-imported across time; compare the
landmine about regions being stable for a commit and not across commits.

So the group is ranked on an **unnormalised** local count: how many answer-key files are *not* direct
importers of the subject. The map gives depth 1 away on hover by design (ADR-0008), so that is
literally the number of answers the map has not already supplied.

**How far the evidence goes**: the flip is derivable — a member ahead on depth and behind on surprise
loses its lead as `maxDepth` grows — but it is **not observed**. The two rules pick the same
representative on ark and svelte and differ on one vite group. A test pins the rule's *direction*;
nothing pins the choice of quantity, deliberately.

### 3. The cost is reported, not absorbed

Refusing a duplicate costs coverage. `progress.ts` promotes a node only as the subject of a passed
challenge or as a picked member of some key, so a dropped twin that appears in nobody else's key can
**never** come out of the fog. Measured: ark 69 → 68 provable nodes, vite 245 → 213, svelte 391 →
282. `report.unprovableNodes` now carries that figure and the CLI prints it, because a deck count
alone implies a coverage the atlas does not have.

## Results

| repo | deck | **distinct questions** | redundant | re-asked |
|---|---|---|---|---|
| ark | 40 → 39 | 35 → **39** | 5 → 0 | 3 |
| vite | 163 → 122 | 122 → **122** | 41 → 0 | 0 |
| svelte | 350 → 153 | 138 → **153** | 212 → 0 | 15 |
| vue/core | 7 → 7 | 7 → **7** | 0 → 0 | 0 |

**No repo loses a distinct question.** The deck shrinks only where it was repeating itself, and grows
in distinct content on the two repos with spare cone. Every non-colliding challenge is byte-identical
to what the generator produced before.

Near-duplication falls with it, though it was not the target: adjacent keys sharing ≥ half their
files drop from 139 to 0 on svelte and 4 to 0 on ark under the plain sort's exact matches, and the
pairwise J ≥ 0.5 rate goes 14.6% → 2.6% on svelte and 1.5% → 0.45% on vite. On **ark it barely
moves** (12.6% → 11.2%), which is why ADR-0011 decision 4 gains a continuous overlap term in the same
session: exact dedupe is the generator's job, and partial repetition remains the selector's.

## Rejected alternatives

**Merge a class into one challenge with several subjects.** The schema ripple is real — `subject`
becomes a set, and the validator, the atlas doc, the console, the reveal, the notes and the save all
follow — but that is not the reason. The reason is that **`(verb, subject)` is the unit of proof**.
A pass on a multi-subject challenge would claim N proofs for one answer, promoting subjects the
player never reasoned about. ADR-0011 decision 3 spent a whole rung separating what was *shown* from
what was *proved*; this would undo it. Recorded explicitly so nobody reopens it with "the schema
change is actually small".

**Diversify the sampling for everything, drop nothing.** Impossible for 41 of 46 redundant challenges
on ark+vite and for most of svelte's: the certain cone *is* the key, so there is no second question
to ask. Diversification is the minority case, not the fix.

**A similarity threshold instead of byte-equality.** A Jaccard cutoff in the *generator* would be a
magic number deciding whether a real question gets deleted. Byte-equality needs no threshold and
deletes only provable repeats. Partial overlap is handled where deletion is not on the table — as a
continuous *ranking* term in the selector, which needs no cutoff either.

**Promote uniqueness to an atlas invariant enforced by the validator.** Rejected: two different verbs
may honestly share an answer set, because they are asking different questions about the same files.
Uniqueness is a within-verb generation property and belongs in the verb.

## Consequences

- `SkipReason` gains `duplicateKey`; `GenerationReport` gains `reasked` and `unprovableNodes`.
- ADR-0011 decision 4's constraint (a) is deleted — see its second amendment.
- `sampleByDistance` is now a slice of `rankByDistance`; behaviour for window 0 is unchanged.
- **Not addressed**: the surviving twin does not tell the player that its twins exist.
  `cone(A) = cone(B)` is a true, derived, non-obvious fact, and on vite's fixture clusters it is
  arguably worth more than the nine questions it replaces. It would be a *shown* fact — no field
  note, no `understood` promotion — and it is the natural mitigation for the coverage cost in §3.
  Deliberately left to its own rung.
