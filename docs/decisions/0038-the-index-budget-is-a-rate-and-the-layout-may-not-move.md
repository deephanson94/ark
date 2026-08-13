# ADR-0038 — The index budget is a rate, and the layout may not move to meet it

- **Status**: accepted
- **Date**: 2026-08-13
- **Extends**: `CLAUDE.md`'s budget table; [ADR-0028](./0028-python-is-mapped-and-never-graded.md) §6,
  which recorded the breach and named the layout as ~40% of it
- **Constrained by**: NORTH-STAR §7 (*"the layout does not move and never will"*)
- **Measured on**: `django/django` at **`c9eb16a87e`**, full clone
  (`is-shallow-repository` → `false`), 3,035 nodes / 10,167 edges / 358 challenges — the same
  figures ADR-0028 records, reproduced. Plus clean clones of ark `75b6117`, `honojs/hono`
  `7075369e`, `kysely-org/kysely` `f24018c7`, `graphql/graphql-js` `9c245018`.

## Context

`README.md` has carried this for two milestones: *"django breaches the index budget and it is said out
loud: 17.6–18.6 s at 3,035 nodes against a 10 s ceiling"*, with the layout named as ~40% and the fix
described as *"a `layout.ts` change with its own determinism risk"*.

The prescription in that sentence is wrong, and the headline figure is the wrong one to lead with.
Both are corrected below; the *diagnosis* — that the layout dominates — turned out to be right.

## Finding 1 — the ceiling is a rate, and the breach is 5% rather than 76%

**The record already knew this and buried it.** That same Known-gaps entry ends *"the per-node rate is
~5.9 ms against a 5.00 ms/file row, on a repo 1.5× the 2,000-file reference scale the ceiling is
written for"*, and `scripts/budget.ts` enforces the **hard** `ms/file` budget while printing the
absolute figure for a large repo as **advisory** — because *"comparing a 28 KiB atlas against a 5 MB
ceiling would pass forever"*. So this is not a discovery, it is a **correction of emphasis**: the
sentence leads with `17.6–18.6 s against a 10 s ceiling`, and that is the number a session acts on.

django has **3,035 files**. At the ceiling's own rate that is 15.2 s, not 10 s:

| | before | after | ceiling |
|---|---|---|---|
| django, absolute | 17.4 s | **15.9 s** | 10 s *(advisory, quoted at 2,000 files)* |
| django, per file | 5.73 ms | **5.25 ms** | **5.00 ms (hard)** |

From **15% over the rate to 5% over**. Still over, and still worth saying out loud — but a headline of
*"17.6 s against a 10 s ceiling"* reads as a 76% breach and sends a session to change the layout,
which the next section is about why it must not do.

## Finding 2 — the layout is 98% one loop, and that loop may not be made cheaper

Profiled at django's shape, `computeLayout` is **35.4%** of the whole index, and inside it the
repulsion loop is **98%**. The cause is measurable: the 3×3 grid neighbourhood holds **937 nodes on
average**, so the loop runs **853M pair tests**, and cost grows superlinearly — **0.41 ms/node at 190
nodes against 2.78 at 3,035**. `layout.ts`'s own comment claimed *"a uniform grid keeps this linear in
practice"*; that sentence is now corrected in place. Cohesion is why: it collapses each region toward
its centroid and saturates, so cells become dense and the grid stops separating anything.

**The obvious fix is a finer grid, and it is forbidden.** A finer grid changes the *order* in which
contributions are summed; floating-point addition is not associative; the last bits move; nodes move.
NORTH-STAR §7 freezes the layout because spatial memory of a codebase is the mechanic the whole
product rests on, and `CLAUDE.md` says the same thing about X,Y. **Any speedup that changes a
coordinate is not a speedup, it is a re-layout**, and a re-layout is an owner-level amendment to the
north star, not a performance change.

So this ADR ships **constant-factor work only**, and the acceptance test is byte-identity rather than
a benchmark.

## Decision 1 — the repulsion loop is optimised without moving a coordinate

Three changes, each order-preserving by construction:

- **A conservative squared-distance pre-filter.** 59.4% of the 853M pair tests are beyond the cutoff
  and contribute nothing, and every one of them paid a `Math.sqrt`. `beyondCutoff` is strictly
  **above** `cutoff²`, so anything it rejects would certainly have failed the exact test, which still
  runs on every survivor. Comparing `squared > cutoff * cutoff` directly is the tempting version and
  is the one that can disagree in the last bit — a mutant that makes that substitution goes red.
- **Accumulate into locals.** `dx[i] = dx[i] + term` 346M times is the same *sequence* of additions as
  `dxi += term` with one store, and two fewer typed-array accesses per contributing pair.
- **An indexed inner loop** instead of `for…of`, which allocated an iterator per cell per node per
  iteration.

Measured: **8.4 s → 6.4 s** at django's shape (1.32×), and 1.17–1.53× on the four real repos.

## Decision 2 — the walk prefetches a directory's files concurrently

The per-file loop was `await stat` then `await readFile`, sequentially, for every file — about 6,000
round trips on django, showing as **22% of the index idle** in a CPU profile while git accounted for
only ~300 ms of it.

It is a **cache, not a rewrite**: the sequential loop keeps its exact shape and order, so `onDisk`'s
insertion order, the `skipped` counts, `dropped` and `files` are built in the same sequence. That is
not fastidiousness — `build.ts` passes `[...walked.onDisk]` to `loadGoModules` **unsorted**, so the
set's insertion order is observable. An error is captured and rethrown where the sequential loop
reaches it, so the file that fails an index is still the first in path order.

Measured: idle **3.57 s → 2.85 s**. Smaller than hoped, and stated as such — the remaining idle is
not git and is not the walk.

**The prefetch fires for every file and its fall-back never fires**: 190 / 425 / 3,035 hits and **0**
misses on ark, hono and django. The fall-back to sequential I/O is kept anyway, so that a future
divergence between the prefetch's filter and the loop's degrades to *slow* rather than *wrong*.

## Decision 3 — byte-identity is the acceptance test, and it is now a test rather than a promise

The full atlas is **byte-identical** before and after on **five repositories**: django, ark, hono,
kysely and graphql-js, compared with `cmp` on the serialised output of the old and new code over the
same trees.

That was done by hand and is not repeatable, which is the actual gap this change exposed:
`tests/unit/layout.test.ts` had eleven assertions about *properties* — determinism across runs, finite
coordinates, connected nodes closer than unconnected — and **not one pinned a value**. An optimisation
that moved every node by a hundredth passed the entire file. The freeze NORTH-STAR §7 describes was a
promise nothing checked.

There is now a **golden layout**: exact coordinates for a fixed nine-node input, on both the
with-regions and no-regions branches. Two mutants die on it — the exact-square pre-filter, and a
reordered accumulation. If it goes red the question is not *"update the numbers"*; it is whether the
change was meant to move the map, and whether the north star has been amended to allow it.

## What is left, with its number

django is **5.25 ms/file against a 5.00 ceiling** — about **1.5 s** short. Where the remaining time
is, profiled after both changes:

| phase | | note |
|---|---|---|
| `layout.ts` | **5.68 s (35.4%)** | 98% repulsion; no order-preserving lever left of any size |
| *(idle)* | 2.85 s (17.7%) | not git — git's three commands total ~300 ms on django |
| `placement/distractors.ts` | **1.43 s (8.9%)** | the next lever, and roughly the size of the gap |
| `pyscan.ts` | 1.02 s (6.4%) | |
| *(garbage collector)* | 0.45 s (2.8%) | |

**The next lever is `placement/distractors.ts`**, not the layout — it is ~8.9% and the gap is ~9%. It
already avoids the per-subject tokenisation `CLAUDE.md` has a landmine about (the corpus is
precomputed and inverted), so whatever it is doing is something else and wants measuring before it
wants changing.

**The one lever left on the layout is parallelism, and it is left deliberately.** Repulsion reads
`xs`/`ys` and writes only its own node's accumulator, so it is embarrassingly parallel across `i` —
and splitting it across workers preserves each node's accumulation order exactly, which is the
property that makes it byte-identical rather than merely close. At 98% of 5.7 s that is the only
remaining change with the size to matter. It is not done here because it is a different kind of
change — `worker_threads`, transferable buffers, a fallback for a single-core machine — and it wants
its own decision, not a paragraph in one about constant factors.

## Revisit when

- **A repo materially larger than django is indexed.** The rate is what scales; the absolute figure
  is not the thing to quote.
- **Anyone proposes changing `LayoutOptions`.** Every constant there moves the map. `cohesion` in
  particular is what makes the grid useless at scale, and tuning it for speed would be a re-layout
  wearing a performance argument.
- **The golden test goes red.** See decision 3 — that is a question about intent, not about numbers.
