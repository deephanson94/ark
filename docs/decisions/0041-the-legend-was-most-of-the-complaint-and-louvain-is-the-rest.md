# ADR-0041 — The legend was most of the complaint, and deterministic Louvain is the rest

**Status**: **proposed** — not accepted. Adopting §8 moves every node on every map, which
NORTH-STAR §7 reserves to the owner. Nothing here has been merged to `master`.
**Date**: 2026-08-13
**Supersedes**: nothing. Extends [ADR-0010](./0010-terrain-islands-and-the-ctrl-f-gate.md)'s terrain
rule, which is held fixed throughout and is **not** what this is about.

---

## 0. What was asked, and the shape of the answer

1. **How bad is region clustering across every reference repo?** Bad in two opposite ways, and the
   headline — hono's 57 regions for 425 nodes — is the smaller of them.
2. **Is the clustering the binding constraint, or the rendering?** **The rendering, on six repos of
   eight.** One comparator and one CSS property take the map a reader can account for from 36% to
   89% on graphql-js and 43% to 95% on prometheus. No node moves.
3. **Should the clustering be replaced anyway?** **Yes** — on region count and on hugo's collapse.
   Not on nameability, which is the criterion this work started from and which §7 refutes.
4. **And it is not either/or.** Wired for real, Louvain still overflows the legend on **four repos
   of eight**. Legend alone reaches ≥ 89% on six; Louvain alone leaves four clipping; **both reach
   100% on all eight.**

Every figure is measured on a **full clone of a named commit**. Ark indexes itself, so its column
comes from a clean clone of **`d4acfa5`** and is false by the next commit — prefer the invariants.

---

## 1. How bad it is

| repo | commit | nodes | regions | topo | terrain | clipped rows | **nodes clipped** | Q |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ark | `d4acfa5b` | 203 | 19 | 15 | 4 | 2 | **4%** | 0.334 |
| flask | `6a2f545b` | 91 | 17 | 10 | 7 | 0 | **0%** | 0.306 |
| hono | `7075369e` | 425 | **57** | 49 | 8 | 40 | **71%** | 0.476 |
| graphql-js | `9c245018` | 549 | 36 | 30 | 6 | 19 | **64%** | 0.302 |
| kysely | `f24018c7` | 600 | 23 | 18 | 5 | 6 | **30%** | 0.208 |
| prometheus | `3c82a95e` | 501 | 34 | 21 | 13 | 17 | **57%** | 0.543 |
| hugo | `44da0860` | 1242 | 18 | 8 | 10 | 1 | **0%** | 0.089 |
| django | `c9eb16a8` | 3035 | **175** | 168 | 7 | 158 | **86%** | 0.281 |

The playtest's *"17 of 36"* is confirmed twice over: **36 is graphql-js's region count to the
digit**, and 17 is what `.legend`'s `max-height: 42vh` admits at a 20.4 px row.

### 1.1 Two failures, opposite, and the count hides the worse one

**Fragmentation** — hono, django. The regions are *honest and too small*: `src/middleware/etag` (3),
`src/adapter/netlify` (5). hono's modularity is **0.476, the highest of the four TypeScript repos**.
Nothing is wrong with the clusters; there are 57, and 40 sit in rows the panel never shows. The
mechanism is the connector hold-out `regions.ts` documents: hono's middleware reaches the repo only
through `src/hono.ts` and `src/context.ts`, which are held out of the vote, so each directory becomes
a genuine island. The patch that fixed the one-giant-blob failure causes this one.

**Collapse** — hugo. Its largest *topology* region holds **161 of 204 linked nodes (78.9%)** at
**Q = 0.089**, barely distinguishable from no community structure. hugo's 1,003-node `docs` lump is
**terrain**, not this, and is held fixed by every counterfactual below.

hugo shows **18 regions, 0% clipped** — the healthiest row in the table, and the sickest repo.
**The count is not the measurement.**

### 1.2 The identical greys are terrain

`scene.ts` maps every terrain region to `TERRAIN_INDEX = -1`, so they share one grey by design
(ADR-0010). The legend still spends **a row each**: 4 on ark, 6 on graphql-js, **13 on prometheus**.

### 1.3 The clipped rows are unreachable, not below the fold

```css
.legend { max-height: 42vh; overflow-y: auto; /* says it scrolls */
          pointer-events: none; /* and makes scrolling impossible */ }
```

Same rule block, nothing re-enables it. django's 158 hidden rows are reachable by no input at all.

---

## 2. The cheap fixes, measured before being declined

None of these moves a node. The measure is **share of nodes a reader can account for from a legend
row**, because a row naming 3 of 425 nodes and one naming 49 are not the same amount of map.

| repo | today (17 rows, id order) | + ordered by size | + terrain as one row |
|---|---:|---:|---:|
| ark | 96% | 99% | **100%** |
| flask | 100% | 100% | **100%** |
| hono | 29% | 60% | **67%** |
| graphql-js | 36% | 85% | **89%** |
| kysely | 70% | 95% | **99%** |
| prometheus | 43% | 84% | **95%** |
| hugo | 100% | 100% | **100%** |
| django | 14% | 68% | **70%** |

**One comparator and one collapsed row take six repos of eight to ≥ 89%.** The legend is ordered by
region **id** — alphabetical, so what falls off the end is arbitrary. On six of eight repos the
clustering is **not** the binding constraint. These changes are not owner-gated and should be made
whatever is decided about §8.

**What they do not buy**: seventeen rows covering 95% is still seventeen regions, so NORTH-STAR §5
tier 1 (*"what are the top-level regions?"*) is untouched — the five largest cover **31% of hono**
— and nothing in a legend addresses hugo's blob, whose legend is already perfectly honest.

### 2.1 Collapsing regions at territory zoom — rejected on the spec

Any merge rule is either **topological**, and then it is a clustering change in a rendering costume
needing the same epoch, or **path-based**, and then pillar 4 refuses it. ADR-0010 decision 1 already
fixes the one place a path-based grouping is allowed, and that place is terrain.

---

## 3. The prototype

`scripts/prototype-louvain.ts` — deterministic Louvain with Leiden's connectivity guarantee, 313
lines. Built like `layout.ts`: **no `Math.random`** (textbook Louvain randomises the visit order and
published Leiden samples its refinement; here it is ascending node index at every level), **ties to
the lowest community id**, **only `+ - * /`**, every accumulation in index order, `Map`s read only
through sorted key lists.

### 3.1 Which rules are load-bearing — mutated, and one is not

A paired re-run inside one process is weak: `Map` order is deterministic for a fixed insertion
sequence, so a partition secretly depending on insertion order still passes. So each rule was
removed in turn and the partition alone compared (`scripts/probe-labels.ts`):

| mutant | result |
|---|---|
| candidate iteration unsorted | **dies** |
| `gain >= bestGain` instead of `>` | **dies** |
| aggregated adjacency unsorted | **survives** — byte-identical on all eight repos |

Two of three decide the answer. The third is kept because this prototype's weights are integer
counts and integer addition is associative; the real `AtlasEdge` carries a `weight`, and a
non-integral one would make aggregation order matter. Stated as a guard for a configuration that
does not exist yet, not as a measured win.

**The first run of that mutation test was itself vacuous** and reported a clean 3-of-3 kill: it
hashed a report containing per-repo timings, so it compared clock noise. The tell was the *restored*
file hashing differently from the baseline.

### 3.2 The Leiden repair fires zero times

`splitDisconnected` fired on **0 communities across 56 runs**. It is dead under this configuration
and is kept as the only cheap proof that regions are connected, not as a feature — the same honesty
ADR-0019 had to apply to `oldestK`. Two more sessions at zero is grounds to delete it.

---

## 4. γ is one value, fixed by a rule stated before the results

**The rule, stated first**: γ is the resolution of the modularity objective the algorithm already
optimises. It is fixed at the **textbook value γ = 1**, identically for every repo, chosen *a
priori* because it is the definition of modularity rather than a tuned knob. **Nameability plays no
part in selecting it**, and there is no per-repo γ — tuning it per repo would be pillar 2 ("the repo
is the level") violated in a new costume, and tuning it against a nameability score would be fitting
to the sample.

The sweep below is therefore a **robustness check, not a selection**. It happens to agree — γ = 1 is
the modularity argmax on all eight repos (tied with 0.75 on flask and graphql-js) — but the value
was not chosen from it, and no bar is needed, which is a better outcome than a well-placed one.

| γ | 0.25 | 0.50 | 0.75 | **1.00** | 1.50 | 2.00 | 3.00 |
|---|---:|---:|---:|---:|---:|---:|---:|
| ark | 0.257 | 0.320 | 0.403 | **0.421** | 0.396 | 0.362 | 0.328 |
| hono | 0.483 | 0.569 | 0.615 | **0.628** | 0.621 | 0.589 | 0.580 |
| django | 0.043 | 0.379 | 0.446 | **0.474** | 0.458 | 0.450 | 0.417 |
| hugo | 0.022 | 0.095 | 0.297 | **0.315** | 0.288 | 0.271 | 0.235 |

The sweep also kills the tempting direction. Lowering γ merges toward "about five regions a person
can hold" and **destroys the structure to get there**: at γ = 0.25, graphql-js reads **Q = 0.060**,
django **0.043**, hugo **0.022** — hugo's existing failure applied to everything. A five-region
answer that is not true is worth less than a fifteen-region answer that is.

---

## 5. Wired for real — and it corrects an overclaim

An earlier draft of this document said Louvain puts "every repo inside the legend". That was measured
on the **prototype over the linked subgraph**; the shipped pipeline also runs small-region absorption
and counts **terrain** rows. Wired into a scratch copy of `regions.ts` (Louvain replacing label
propagation, the connector hold-out and the connector placement pass; absorption, terrain and naming
untouched), the real atlas says:

| repo | regions now → wired | Q now → wired | clipped rows | **nodes clipped** |
|---|---:|---:|---:|---:|
| ark | 19 → **9** | 0.334 → **0.421** | 0 | 0% |
| flask | 17 → **13** | 0.306 → **0.386** | 0 | 0% |
| hono | 57 → **20** | 0.476 → **0.628** | **3** | **25%** |
| graphql-js | 36 → **17** | 0.302 → **0.442** | 0 | 0% |
| kysely | 23 → **14** | 0.208 → **0.429** | 0 | 0% |
| prometheus | 34 → **20** | 0.543 → **0.719** | **3** | **34%** |
| hugo | 18 → **19** | 0.089 → **0.315** | **2** | 3% |
| django | 175 → **22** | 0.281 → **0.474** | **5** | **18%** |

**Modularity rises on all eight** (+0.080 flask to +0.226 hugo). Region counts land at **9–22**, not
5–15 — and **four repos still overflow the 17-row legend**, hugo actually gaining a row. With the §2
legend fixes on top, all eight reach **100%**. That is the argument for doing both rather than
choosing.

Health measures of the *shipped naming rule* improve sharply: labels the rule had to disambiguate
with a hub filename drop **88 → 4 on django and 14 → 2 on ark**, and directories split across more
than one region drop **25 → 2** and **9 → 4** (graphql-js).

### 5.1 The map still reads

`tests/atlas/atlas.test.ts` pins intra-region spread over inter-region centroid spacing, ceiling
**0.20**. `scripts/probe-layout-quality.ts` computes both with identical layout options and
**discards the positions**.

| repo | ark | flask | hono | graphql-js | kysely | prometheus | hugo | django |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| now | 0.188 | 0.110 | 0.088 | 0.162 | 0.163 | 0.097 | 0.355 | **0.244** |
| louvain | **0.158** | 0.115 | 0.117 | **0.135** | **0.140** | 0.121 | **0.312** | **0.191** |

Better on five, slightly worse on three, all inside the ceiling bar hugo. **django is over the
ceiling today (0.244) and comes back under it (0.191)** — a finding about the test as much as the
layout, since that assertion only ever runs on ark.

---

## 6. Stability across commits — Louvain is worse, and the first measurement hid it

CLAUDE.md's landmine says label propagation "can reshuffle wholesale" on a small graph change, and
that this is what a layout epoch is supposed to buy. Measured as **nodes that changed region between
adjacent commits**, 20 consecutive pairs per repo, three arms:

| | A label prop | B louvain | C directory |
|---|---|---|---|
| **ark**, 20 adjacent pairs | worst **1 node (0.5%)**, mean 0.1% | worst **7 (3.4%)**, mean 0.3% | 0 always |
| **hono**, 20 adjacent pairs | worst **4 nodes (0.9%)**, mean 0.1% | worst **38 (9.0%)**, mean 0.5% | 0 always |

**Louvain is measurably less stable**: one hono commit moves 38 of 425 nodes where label propagation
moves none. Modularity optimisation has near-degenerate optima, so a small edge change can flip a
whole merge decision at the aggregation level. Neither "reshuffles wholesale" — both are quiet on 17
of 20 pairs — but the direction is against the replacement and it belongs in the cost table.

**The first version of this measurement said the opposite**, and the error is instructive. Measured
over **25-commit jumps** it read 12.7% against 12.3%, a dead heat, and two similarity coefficients
disagreed about the sign (raw Rand favours the finer partition, excess-over-chance the coarser).
Wide jumps change so much of the graph that both arms saturate. **The granularity a player actually
experiences is one reindex, and at that granularity the answer reverses.**

---

## 7. Nameability cannot decide this, and a third arm proves it

*"A region a human cannot name is not a region"* was the criterion this work started from. It was
measured as F1 between a region and the best directory describing it. **That metric rewards
directory alignment** — and `docs/atlas-format.md` §3.4 says, in as many words, that regions are
*"derived from the import graph by label propagation, **not** from the directory tree (pillar 4)"*.
A metric whose optimum is the folder tree cannot arbitrate a clustering that is forbidden to be one.

So the folder tree was added as a **third arm** and scored on both axes. It is the metric's ceiling
by construction, and it is also a real candidate: five lines instead of 313, and it still moves the
layout, so if it won it would be a completely different and much cheaper decision.

| repo | arm | regions | **Q** | **mean name F1** | largest |
|---|---|---:|---:|---:|---:|
| ark | A label prop | 15 | 0.334 | 0.288 | 47% |
| | B louvain | 5 | **0.421** | 0.744 | 27% |
| | C directory | 3 | 0.010 | **0.974** | 58% |
| hono | A | 51 | 0.476 | 0.683 | 13% |
| | B | 14 | **0.628** | 0.599 | 17% |
| | C | 4 | 0.121 | **0.693** | 84% |
| prometheus | A | 21 | 0.543 | 0.427 | 15% |
| | B | 7 | **0.719** | 0.724 | 27% |
| | C | 11 | 0.316 | **0.742** | 67% |
| django | A | 168 | 0.281 | 0.507 | 31% |
| | B | 15 | **0.474** | 0.503 | 22% |
| | C | 4 | **−0.095** | **0.589** | 69% |

**Arm C wins the name column on 8 of 8. Arm B wins the modularity column on 8 of 8.** The two
columns are perfectly anti-correlated across arms, which is the demonstration: the name column is
measuring how much a clustering resembles the folder tree, and cannot on its own decide one.

**Arm C is refuted decisively and cheaply.** Its modularity is ≈ 0 on every repo — 0.010 on ark,
0.059 on graphql-js, 0.096 on hugo — and **negative on django (−0.095), worse than a random
partition**. It also fails the problem it appears to solve: its largest region holds **84% of hono,
88% of graphql-js, 69% of django**, so the folder tree is one giant `src` blob. Five lines that
would move every node and buy nothing.

The consequence for §7's own criterion is that **"nameability is a wash" costs much less than it
looked**. It remains true — under the directory-prefix metric Louvain improves on three repos,
worsens on three, django going 14% → 1% of nodes in a nameable region — and a segment-based naming
rule was built and scored on the identical partition and moves no repo's mean F1 by more than 0.068.
But the yardstick's optimum is the thing the spec forbids, so a wash on it is not evidence against
the clustering. **Tier 1 is unblocked on count and still blocked on naming**, and the naming problem
is now clearly a *naming* problem, separable from this decision.

Where it works, it works: ark's five regions come out as `tests / src/verbs / src/player /
src/indexer / src/atlas` — `README.md`'s own architecture table, recovered from the import graph
without reading it. It fails where a repo's directories do not follow its coupling (django separates
`tests/` from `django/`), which is a fact about the repository.

---

## 8. The acceptance test — a run, not a claim

The prototype was wired into a scratch copy of the tree and the **real** suite run against it. The
exact diff is [`0041-wiring.patch`](./0041-wiring.patch), which is **not applied to this branch** —
`git apply` it plus `cp scripts/prototype-louvain.ts src/indexer/louvain.ts` reproduces everything
below.

```
npm run test:determinism  (ark, under the wired prototype, full git history)
  → 2 independent runs produced byte-identical atlases (369.6 KiB)

eight repos, two independent processes each:
  OK ark        361.4 KiB   9 regions      OK prometheus  871.6 KiB  20 regions
  OK hono       597.8 KiB  20 regions      OK hugo       1336.3 KiB  19 regions
  OK kysely     934.1 KiB  14 regions      OK django     2951.4 KiB  22 regions
  OK graphql-js 882.0 KiB  17 regions      OK flask       284.4 KiB  13 regions
```

**And it caught nothing, which is the lesson.** The first wired run produced a badly wrong partition
— ark with **one** topology region and prometheus with none at all — because terrain ids are handed
out from `nextSynthetic = count` and the wiring offset community ids by `count` too, so communities
and terrain lumps shared labels and silently merged. The comment above that line claimed to prevent
exactly this collision and guarded the wrong range. **`test:determinism` passed on it**: a wrong
partition is still a deterministic one. The defect was found by printing the regions and reading
them. Determinism is a necessary property and not a correctness check, and this document's own
acceptance test is evidence for that rather than against it.

Two earlier scratch-copy mistakes are worth recording for whoever does this next: the copy initially
had **no `.git`**, so ark's determinism run exercised a history-less pipeline (192 KiB against 369),
and `git checkout -- .` inside it reverted the wiring — the landmine, committed while chasing the
first one.

---

## 9. The blast radius, costed

**What moves.** Every `[x, y]` in every atlas: `build.ts` feeds `groupByRef` into `computeLayout`
and cohesion pulls each node toward its region's centroid.

**What a player loses.** Spatial memory, completely and once.

**What a player keeps — all of it.** `nodeIdFor` hashes `originPath` and nothing else, so **no node
id changes**. `save.ts`, `progress.ts`, `notes.ts` and `fog.ts` never read a region; the only
consumer near player state is `selector.ts`'s variety constraint, through `main.ts`'s `regionOf`
closure, which is correct under any partition. **Every saved pass, field note and lifted fog
survives.**

**Atlas version: no bump.** `Region`'s shape is unchanged; only values move.

| | |
|---|---|
| `tests/unit/layout.test.ts` golden layout (ADR-0038) | **Re-pin.** Every coordinate changes. |
| `atlas.test.ts` spread ratio | **Re-measure.** ark 0.188 → 0.158, bar holds. |
| `atlas.test.ts` region-count bound | **Holds as written** — absorption still runs after Louvain, so the `MIN_REGION ≥ 3` premise survives in the wired build. *(An earlier draft said this breaks; that was the prototype's raw output, which absorption never saw.)* |
| `tests/unit/regions.test.ts` | **1 of its 15 tests fails**, measured, not estimated — *"folds a stranded file into the region it is most connected to"*. It encodes label propagation's repair for label propagation's own side effect (*"holding connectors out of the vote leaves some files with no voters at all"*), and that mechanism ceases to exist. On its fixture Louvain returns the triangle `{a,b,c}` and the star `{hub,lonely,d,e}`, which is a defensible partition of it. `regions.ts` goes 428 → 389 lines plus a 313-line module. |
| `test:unit` overall | **852 of 853 pass wired.** |
| `test:atlas` | **112 of 112 pass wired**, on the real generated atlas. |
| `test:determinism` | **Passes wired**, on ark plus seven repos. |
| Deployed page | Rebuilds from `master` on push; the map moves under anyone mid-session. |

**Effort**: smaller than this document first estimated, and now measured rather than guessed. The
algorithm exists and is wired in a scratch tree; the whole test surface is **one failing unit test,
plus re-pinning the golden layout and the spread ratio**. The separable naming problem is the real
remaining work.

---

## 10. Recommendation

1. **Fix the legend now, independently.** Order by `nodeCount`; collapse terrain to one row; drop
   `pointer-events: none`; show `+N more`. Six repos of eight go to ≥ 89%, from 36% and 43% on the
   two the playtest ran on. No node moves, no owner decision.
2. **Recommend the owner license a layout epoch for deterministic Louvain at γ = 1**, on region
   count and hugo's collapse. Carrying it: 175 → 22 and 57 → 20 regions; modularity up on all eight;
   hugo's blob 78.9% → 20.1%; django back inside pillar 4's spread ceiling; `test:determinism`
   byte-identical on eight repos. Against it: **less stable across adjacent commits** (worst step 38
   nodes vs 4 on hono), and it does **not** on its own fit the legend on four repos — §2 is still
   needed.
3. **Do not adopt the folder tree**, and the refutation is one cell: **Q = −0.095 on django**.

The cost of (2) is now measured end to end rather than estimated: **852/853 unit, 112/112 atlas,
determinism byte-identical on eight repos**, one failing test that encodes a mechanism being
removed, and two golden values to re-pin.

If the owner declines the epoch, **do (1) anyway.**

---

## 11. What would change this

- **A naming rule that can name a cross-directory community.** The single highest-value follow-up:
  it is what still blocks tier 1, and §7 shows it is separable from the clustering.
- **Adjacent-commit instability getting worse on a bigger repo.** django was not measured this way;
  hono's worst step is 9.0% and that is the number to beat.
- **A repo where the Leiden repair fires**, or two more sessions at zero, which is grounds to delete
  it.
- **γ moving off 1.00.** It is the argmax on all eight; a repo where it is not would make γ a tuned
  parameter, which is worse to own than a textbook constant.
- **A measurement of what a player retains.** Every number here is a property of a partition, not of
  a person; `docs/experiments/0001` is the instrument and it is unrun.
