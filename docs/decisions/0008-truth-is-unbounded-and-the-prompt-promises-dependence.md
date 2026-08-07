# ADR-0008 — Truth is unbounded, the prompt promises dependence, and the map shows only direct importers

- **Status**: accepted
- **Date**: 2026-08-07
- **Decided by**: Fable review, at the human's request. The two questions below were raised by the
  same reviewer against M1 and deliberately answered before any of M2 was written.
- **Amends**: NORTH-STAR §6.1 — the sample prompt *"Select every file that will need to change"* is
  replaced. See "The north star changes" below.
- **Extends**: ADR-0003 (unresolved imports), ADR-0007 (pass threshold and the 3:1 choice set)

## Context

M2 is the roadmap's kill point: *"if Blast Radius isn't engaging on a repo you wrote yourself, stop
and rethink the verb."* You cannot measure that if the interface answers the question for the
player, and you cannot measure it if the answer key marks correct answers wrong. Both were true of
the code as M1 left it.

**The leak.** `src/player/main.ts` showed a node's full transitive dependent set on hover. §4's loop
has the player choose a subject *by pointing at it*, so the complete answer appeared milliseconds
before the click that opened the challenge — involuntarily, to a player who never chose to cheat.

**The false-negative.** Truth was "transitive dependents within `maxDepth` hops". §8.3's
highest-weighted distractor strategy is "nodes at distance *n±1*". At n = maxDepth, "n+1" is a
**real dependent** presented as a distractor: a player who knows the codebase picks it and is told
they are wrong.

**The over-promise.** §6.1's sample prompt asks which files *"will need to change"*. The graph
proves import reachability, which overapproximates — a file importing a different symbol from the
subject, or importing it only as a type, may need no change at all. The key would mark players wrong
on files that provably need no change: the tool's approximation sold as the player's error.

## Measured facts these decisions rest on

Taken from this repo's atlas at the time of writing (69 nodes, 125 edges):

| Fact | Value |
|---|---|
| Max eccentricity in the dependents direction | **3** |
| Nodes where depth-3 truth differs from unbounded truth | **0** |
| Subjects with a non-empty radius | 30 |
| …of those, where the full radius differs from the direct importers | **23** |
| …that ship whole under the ADR-0007 cap (≤ 6) | 13 |
| …that need a sampled truth set | 17 |
| `src/atlas/schema.ts` | 4 direct importers, **39** transitive |
| Unresolved imports / `probable` edges | **0 / 0** |

## Decision 1 — the map shows direct importers; the full radius is earned

Hover and selection highlight **direct importers only (depth 1)**, for every node, always — in free
roam and while a challenge is open alike. The **full transitive radius renders only for nodes in
`fog.understood`**. It is shown once as the reveal when a Blast Radius grade lands, pass or fail, and
is permanently unlocked by passing that node's challenge.

No modal special-casing and no per-subject suppression: the rule must not depend on whether a
challenge is open, because the leak happens at the moment of *choosing* the subject.

Depth-1 is not a leak — those edges are already drawn on the canvas. It is also exactly the right
thing to give away, because §8.4 defines `surprise` against the naive direct-neighbour guess. The map
hands you the naive baseline for free, and the grade measures precisely what you know beyond it. On
this repo 23 of 30 answerable subjects have a full radius that differs from their direct importers,
so the question keeps its content.

Guardrail 6 holds: nothing is taken away for a wrong answer, and the reveal fires regardless of
score. Only the *persistent* unlock tracks `understood`.

**Rejected.** *Keep it* — the devtools argument in §7.1 does not transfer: opening devtools is
deliberate and out-of-band, hover is in-band and involuntary. *Suppress for the subject only* — leaks
through neighbours, since if D directly imports S then `dependents(D) ⊆ dependents(S)`, so hovering
any suspected truth member reads off the rest; and one mysteriously dead node is risk #4 in
miniature. *Suppress everything while a challenge is open* — fixes nothing at the moment of
choosing, and costs §9's "the world stays visible behind the scrim".

## Decision 2 — unbounded truth, and a prompt that promises dependence

These were two questions with one answer, because they are the same defect: **the prompt promising
something the answer key does not hold.**

1. **Truth is the full, unbounded transitive dependent set** over `certain` import edges. No depth
   bound anywhere in the truth semantics.
2. **The generator maintains one invariant**: `candidates ∩ dependents(subject, ∞) = truth`. Every
   candidate that depends on the subject at any depth is in `truth`; any dependent not in `truth`
   never appears as a candidate at all.
3. **The prompt is candidate-relative and promises dependence, not required change**:

   > A breaking change lands in `{subject}`. Which of these files depend on it — directly, or
   > through a chain of imports?

The depth bound protected nothing: on this repo depth-3 truth equals unbounded truth for *every*
node. All it did was plant the n+1 landmine. Removing it deletes the landmine and a magic number in
one move. "Which of these" is doing real work too — it never claims the choice set is exhaustive,
which is what makes a sampled truth set honest.

**Reconciling with ADR-0007.** The 3:1 rule caps a shipped answer key at ~6 files against 20
candidates. 13 subjects here ship whole. For the 17 hubs, `truth` is a **deterministic sample** of ≤ 6
dependents and every unsampled dependent is banned from the candidate pool — which is exactly the
escape ADR-0007 anticipated ("sample the truth set and say so in the prompt"). Skipping hubs instead
would forfeit the subjects §4 says the player most needs to learn, and half the challengeable
inventory.

**Rejected.** *State the bound in the prompt* — turns tier-3 coupling into hop-counting trivia
(pillar 3), unverifiable without the tool running the query for you, and every future verb inherits
the clause. *Bounded truth with unbounded distractor certification* — pays the same certification
cost while leaving two different "blast radius" definitions in one product, so the graded set and the
revealed overlay disagree and the field note "you know `schema.ts` has 39 dependents" becomes
unwritable. *Keep §6.1's wording* — marks players wrong on files that provably need no change, which
is the trust destruction guardrail 4 exists to prevent.

## Consequences for `generate()`

1. **The invariant is the algorithm.** Compute `D = dependents(subject, ∞)` over `certain` edges.
   If `1 ≤ |D| ≤ ⌊(candidateCount − 1) / 3⌋`, `truth = D`. If larger, `truth` is a deterministic
   sample and every member of `D \ truth` is banned from the candidate pool. If `|D| = 0`, no
   challenge — the validator requires a non-empty truth set.
2. **Sampling must stratify by distance, and must not use `Math.random()`.** A hub sample of six
   direct importers is answerable straight from the map under Decision 1. Include members at distance
   ≥ 2. For `schema.ts` — 4 direct, 39 transitive — the barrel at `src/atlas/index.ts` is why the cone
   explodes at hop 2, and *that is the lesson the challenge exists to teach*.
3. **Distractor certification goes unbounded.** Every distractor from all four §8.3 strategies must
   be certified a non-dependent at any depth, so `isChallengeable` runs with no depth bound. Free on
   this repo (zero unresolved imports, zero `probable` edges) and correct everywhere.
4. **§8.3 strategy 1 is reinterpreted, not dropped.** With no boundary hop, "graph-adjacent n±1"
   becomes *structurally-near non-dependents*, and the richest source is the subject's own
   **dependencies** — confusing "imports" with "is imported by" is a real tier-2 mistake, and it is
   now the flagship structural distractor. Siblings, name-similar and co-change-without-import are
   unchanged.
5. **`evidence.depth` becomes measured, not prescribed** — the maximum distance found in the truth
   set. The validator only requires an integer ≥ 1, so there is no shape change and no
   `ATLAS_VERSION` bump; no challenge has ever shipped.
6. **`GenerateOptions.depth` is deleted.** It no longer means anything.

## What must change in the existing code

| File | Change |
|---|---|
| `src/player/scene.ts` | `blastRadius()` loses its `maxDepth = 3` default; callers pass `1` or `Infinity`. The "shown on hover is deliberate" comment is superseded. |
| `src/player/main.ts` | Hover and selection gate depth on `fog.understood.has(id)`; grading wires up `understand()`, which has existed unused since M1. |
| `src/player/ui.ts` | The inspector's "blast radius (≤N hops)" line leaks `\|truth\|` for unproven nodes — show "direct importers — k" until proven. |
| `src/verbs/types.ts` | Remove `depth` from `GenerateOptions` and `DEFAULT_GENERATE_OPTIONS`. |
| `src/atlas/graph.ts` | `dependents` / `isChallengeable` comments saying "within the depth bound" are no longer accurate. |
| `src/verbs/score.ts` | `explain()`'s "traced … to depth N" becomes the measured claim. |
| `src/atlas/schema.ts`, `docs/atlas-format.md` | Document `evidence.depth` as the measured maximum distance. Same commit, per the schema header rule. |

`src/player/draw.ts` and `src/player/fog.ts` need no changes: `draw.ts` renders whatever `Radius` it
is handed, and `fog.ts` already has `understood` and `understand()`.

## The north star changes

NORTH-STAR §6.1's sample prompt is amended by this ADR, and the file carries a note pointing here.
Leaving the two documents in quiet disagreement is how a future session "fixes" the generator back
into over-promising — the same failure mode ADR-0001 hit with `indexedAt`.
