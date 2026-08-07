# ADR-0010 — Terrain, islands, and the Ctrl+F gate

- **Status**: accepted
- **Date**: 2026-08-07
- **Extends**: ADR-0006 (layout and regions are computed in the indexer), ADR-0007 (the pass
  threshold as a generation constraint)
- **Bumps**: `ATLAS_VERSION` 1 → 2. `Region` gains `kind`.
- **Reviewed by**: Fable, which rejected two of the three framings this ADR started from. Both
  rejections are recorded below rather than quietly dropped.

## Context

Pointing the indexer at `vitejs/vite` (2,025 files, 3,730 commits) produced a map that is a solid
smear of overlapping text and a question deck about the wrong files. Measured, after the
nearest-manifest resolver landed in the same session:

| | before resolver | after |
|---|---:|---:|
| edges | 1,745 | 1,885 |
| nodes with no edge at all | 1,234 (61%) | 1,142 (56%) |
| regions | 771 | 675 |
| …single-node | 251 | 181 |
| `packages/` refused by guardrail 4 | 43% | 36% |
| challenges about vite's real source | 7 of 254 | **21 of 254** |
| challenges about `playground/` demos | 197 | **185** |

A cold playtest scored 80% over five questions, and that was the bad news: four were answerable by
*"which file in this directory is called `index.js`"*, which is pillar 3's stated violation —
*"answerable by Ctrl+F rather than by reasoning about structure"*. The fifth was a synthetic
24-deep chain `a24 → … → a0` that exists only to exercise vite's bundler, and §8.4 ranked it the
**hardest question in the deck**.

## What this ADR got wrong before review

**The region count is not a label-propagation failure.** Propagation only ever runs on nodes with
edges (`regions.ts`); the 1,142 edgeless ones never enter it and hit the directory fallback, which
groups by *exact* directory — and vite's playground is hundreds of tiny directories. That fallback
alone manufactures most of the excess. So `CLAUDE.md`'s tripwire — *"if a third structural patch
looks necessary, stop and write deterministic Louvain/Leiden instead"* — **does not fire**.
Community detection has exactly as little to say about a degree-0 node as label propagation does.
Writing Leiden now would be rewriting the algorithm that is not failing.

**"Detect fixtures" is the wrong question, and a path rule would have broken the bootstrap repo.**
The instinct was a rule for `playground/` and `__tests__/fixtures/`, modelled on the lockfile
entries in `DEFAULT_EXCLUDES`. That precedent does not extend: `package-lock.json` is a
machine-generated artifact whose *name is fixed by a tool*, while `playground/` names human-authored
code in a conventional place. The falsifier is in this repo — **Ark's own `tests/` are load-bearing
dependents inside its shipped answer keys**, so a "test paths are not real code" rule would gut the
bootstrap fixture's own challenges. That is guardrail 2 failing on the first repo it was ever
pointed at.

## Decision 1 — edgeless files stay on the map, but stop founding regions

Every walked file remains a node. What changes is the fallback: edgeless files aggregate into a
small number of coarse **terrain** regions, grouped by top-level path segment, and `Region` gains
`kind: 'topology' | 'terrain'` so both sides of the wall can tell a derived cluster from a bag of
unconnected files.

Keeping them is not sentimentality. `docs/atlas-format.md` already promises they are terrain that
"carries real history"; tier 1 of the curriculum grades against the tree and LOC, which they are
part of; M4's git verbs need them, because a `.md` that co-changes with code is a *correct answer*
for Companion and deleting the node deletes the ground truth; and risk #7's degenerate case is
already real — the `vllm` run produced 918 nodes and **zero** edges, and a rule that drops edgeless
files renders that repo as an empty page.

Top-level segment rather than deepest directory, because the granularity is pinned by the curriculum
rather than by taste: the fallback's only job is tier-1 orientation, and the tier-1 question is
literally "what are the top-level regions?" On vite this collapses ~500 fallback regions into
roughly `playground`, `packages`, `docs`, `scripts`, `root`. A `packages` terrain lump does mix
files from thirty npm packages — but they are edgeless files and the only claim being printed is "N
files with no imports under `packages/`", which is true. **A coarse true claim beats five hundred
precise useless ones**, and ADR-0006 already conceded the underlying point: derived regions do not
license inventing a topological claim where there is none.

Terrain regions share one desaturated wash instead of consuming palette slots. Seven hundred
edgeless files eating region colours is why the map reads as confetti.

## Decision 2 — islands below the floor fold into terrain

A connected component smaller than `MIN_REGION` stops being its own region and folds into its
top-level terrain region. Its internal edges still render, so "these two files talk only to each
other" remains visible on the map; it simply stops costing a legend entry and a palette slot.
Components at or above the floor stay — "playground is a bag of independent mini-apps" is a true and
useful tier-1 insight about vite.

**No cap on region count.** A numeric ceiling is a magic number with no objective function, which is
the exact class of patch the landmine warns about. What replaces it is a bound that falls out of the
rules: every topology region has at least `MIN_REGION` members and terrain regions number at most
one per top-level directory, so `regions ≤ n / MIN_REGION + topLevelDirs`. That is a theorem rather
than a tuning, and `test:atlas` asserts the invariant it rests on.

**When the tripwire *does* fire**: if, now that the resolver has made `packages/` a real graph, the
partition of the *connected* component is wrong — one giant blob again, or systematic fragmentation
— that is the third structural patch, and the answer is deterministic Leiden: a modularity objective
in `+ - * /` only (ADR-0006 forbids transcendentals), ascending-index visit order, lowest-label
tiebreaks, fixed level count, and a refinement pass with the same ordering discipline in place of
Leiden's randomised one.

## Decision 3 — region labels go through the collision pass node labels already use

`draw.ts` draws every on-screen region label raw, while node labels go through `placeLabels`, which
rejects collisions. That is a rendering bug independent of every decision above: **even a perfect
region detector smears at some repo size.** Region labels now go through the same function, ranked
by member count, so at territory zoom only the big regions win screen space and zooming into
`playground` lets the smaller ones appear — which is what the semantic-zoom contract in `zoom.ts`
already promises and no numeric cap can reproduce.

## Decision 4 — a challenge may not ship if a structure-blind strategy passes it

This is ADR-0007's argument applied a second time. There, the constraint was that "select
everything" must score below the pass threshold, and the F1 metric enforced it with no special-case
code. Here, the same metric is pointed at two more strategies that require no understanding of the
graph:

1. **the directory heuristic** — select every candidate under the subject's own directory;
2. **the name heuristic** — select every candidate sharing a name token with the subject.

After a board is assembled, both are scored with the real `scoreSet`. If either reaches the bar, the
challenge is refused.

**The bar is band A (0.78), not the pass threshold.** ADR-0007 used the pass threshold for
"select everything", which is right *there* because selecting everything uses no knowledge at all.
These two heuristics are different: in a codebase whose directories track its modules, "the files in
this folder are coupled" is cheap but **true**, and a player applying it has reasoned badly rather
than not at all. Measured on vite, the pass threshold cut the deck from 254 to 57 and took two
thirds of the questions about the *real source* with it (31 → 10). Band A keeps 135 and, usefully,
the surviving count is identical at 0.70 and 0.78 — the threshold sits on a plateau, not a cliff.

**There is no repair pass, and that is measured rather than assumed.** One was written and
benchmarked: on a beaten board, re-mix the quota toward whichever strategy punishes the winning
heuristic. It **rescued zero boards on both this repo and vite**, because §8.3's default mix already
*is* the repair — it spends 25% on tree-siblings and 20% on name-alikes precisely to defeat these
guesses. A board they still beat is a board where that supply does not exist, and re-weighting an
empty supply changes nothing. The loop was deleted rather than shipped as untested machinery.

This kills the measured failures without inventing anything. The `a24 → … → a0` chain dies exactly
where it should: at **the end of the chain**, `a0` has every file in its directory as a dependent, so
no sibling distractor exists, the directory heuristic scores 1.0, and the question is refused — and
that is precisely the question a cold playtest scored 0% on. A subject in the *middle* of the same
chain survives, because the files it imports are same-directory non-dependents and ADR-0008's
flagship strategy already puts them on the board. Refusing the whole shape would have been the
cruder and worse rule.

Measured effect: ark keeps all 39 of its challenges; vite goes from 254 to **163**, with 139
questions removed that a reader of filenames alone would have earned an A on.

**§8.4 is not touched.** Its `surprise` term ranked the chain hardest because the chain was on the
deck at all; difficulty's job is ranking legitimate questions, and this gate defines legitimacy.
Adding a "generatedness" term to difficulty would be exactly the hand-tuned importance score this
ADR refuses elsewhere.

**The third naive strategy is deliberately excluded.** "Select the direct importers" is *supposed*
to sometimes pass: ADR-0008 gives depth-1 away on the map by design, and §8.4 measures `surprise`
against precisely that guess. A question it passes is an easy question, which the progression needs,
not a broken one.

## Alternatives rejected

**Drop edgeless files from the atlas.** Renders `vllm` — 918 nodes, 0 edges — as an empty page, and
deletes the ground truth M4's Companion verb needs.

**Cap the region count.** A magic number with no objective function. See Decision 2.

**A "fixture" classifier.** No honest structural signal exists. Edgelessness fails (the a0…a24 chain
is edgeful; real standalone scripts are edgeless). "Imported only by a glob" fails (most fixtures are
imported by nothing at all). "No inbound edges from outside its own directory" fails — that is true
of any well-encapsulated leaf module, which is to say of good architecture. The one aggregate signal
that genuinely does characterise `playground/` — many mutually disconnected, structurally
homogeneous sibling subtrees — characterises a monorepo of independent plugins just as well. The
structure proves "mutually isolated corpus"; *fixture* is a guess about why, and intent is not
extractable from structure.

**Filter subjects by importance.** Needs a notion of importance the product has no way to derive
without authoring it, which is guardrail 2. Decision 4 gets the same outcome from a computable
predicate the north star already states.

## Consequences

- `ATLAS_VERSION` → 2. The validator's existing version check reports "reindex required"; there is
  no installed base and no migration is owed (guardrail 5).
- Region cohesion in the layout now pulls each terrain lump together (`build.ts` feeds region
  indices into the layout), so a big terrain group renders as one compact blob — a desert on the
  map. That is intended, and it was checked on a screenshot rather than assumed.
- Decision 4 may reduce the shipped deck. If Ark's own 37 challenges collapse, **that is a finding
  about Ark's questions, not a reason to weaken the gate**, and it is worth knowing before M3.
- The reveal's route rendering is capped regardless of Decision 4, because honest deep chains exist.
