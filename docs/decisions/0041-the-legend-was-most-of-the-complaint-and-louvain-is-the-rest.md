# ADR-0041 — The legend was most of the complaint, and deterministic Louvain is the rest

**Status**: **proposed** — not accepted. Adopting §7 moves every node on every map, which
NORTH-STAR §7 reserves to the owner. Nothing in this document has been merged to `master`.
**Date**: 2026-08-13
**Supersedes**: nothing. Extends [ADR-0010](./0010-terrain-is-not-a-region.md)'s terrain rule, which
is held fixed throughout and is **not** what this is about.

---

## 0. What was asked, and the shape of the answer

Three questions, in order, and the honest answer changes between the second and the third:

1. **How bad is region clustering, across every reference repo?** Bad in two opposite ways, and the
   headline number — hono's 57 regions for 425 nodes — is the smaller of them.
2. **Is the clustering the binding constraint, or is the rendering?** **The rendering, on six repos
   of eight.** One comparator and one CSS property take the share of the map a reader can account
   for from 36% to 89% on graphql-js and 43% to 95% on prometheus. That fix moves no node, needs no
   owner decision, and is most of what the playtest was complaining about.
3. **Should the clustering be replaced anyway?** **Yes, and on a narrower argument than the one this
   work started from.** Louvain earns its keep on region *count* and on hugo's collapse. It does
   **not** earn it on nameability, which this document set out to prove and which the measurement
   refutes — see §6.1.

Every figure below is measured on a **full clone of a named commit**. Ark indexes itself, so its
column is taken from a clean clone of **`d4acfa5`** and is false by the next commit; prefer the
invariants. The probes are `scripts/probe-*.ts` and `scripts/prototype-louvain.ts`, which are **not
wired into the indexer** and are not part of any suite.

---

## 1. How bad it is

`scripts/probe-regions.ts` indexes each repo once; `scripts/probe-region-stats.ts` reads the dump.

| repo | commit | nodes | regions | topo | terrain | clipped rows | **nodes in clipped rows** | Q |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ark | `d4acfa5b` | 203 | 19 | 15 | 4 | 2 | **4%** | 0.334 |
| flask | `6a2f545b` | 91 | 17 | 10 | 7 | 0 | **0%** | 0.306 |
| hono | `7075369e` | 425 | **57** | 49 | 8 | 40 | **71%** | 0.476 |
| graphql-js | `9c245018` | 549 | 36 | 30 | 6 | 19 | **64%** | 0.302 |
| kysely | `f24018c7` | 600 | 23 | 18 | 5 | 6 | **30%** | 0.208 |
| prometheus | `3c82a95e` | 501 | 34 | 21 | 13 | 17 | **57%** | 0.543 |
| hugo | `44da0860` | 1242 | 18 | 8 | 10 | 1 | **0%** | 0.089 |
| django | `c9eb16a8` | 3035 | **175** | 168 | 7 | 158 | **86%** | 0.281 |

The reported 57-for-425 reproduces exactly. So does the playtest's *"clips at 17 of 36"*: **36 is
graphql-js's region count to the digit**, and 17 is what `.legend`'s `max-height: 42vh` over a
20.4 px row admits at a 900 px viewport. Two independent sources agree on the number, which is why
it is used as the legend's capacity below rather than guessed at.

### 1.1 There are two failures, not one, and they are opposite

**Fragmentation** is hono and django. Their regions are mostly *honest and too small*:
`src/middleware/etag` (3 nodes), `src/middleware/jwt` (3), `src/adapter/netlify` (5). hono's
modularity is **0.476 — the highest of the four TypeScript repos**. Nothing is wrong with the
clusters; there are 57 of them, and 40 are in legend rows the panel never shows.

The mechanism is the connector hold-out that `regions.ts`'s header describes. hono's middleware and
adapter directories reach the rest of the repo *only* through `src/hono.ts` and `src/context.ts`,
which are held out of the vote precisely because they are adjacent to everything. Remove the
connectors and each little directory is a genuine island. The patch that fixed the
one-giant-blob failure causes this one, which is what CLAUDE.md's landmine about a third structural
patch is warning against.

**Collapse** is hugo, and it is the failure the counts hide. Its largest *topology* region holds
**161 of 204 linked nodes — 78.9%** — at **Q = 0.089**, which is barely distinguishable from no
community structure at all. hugo's 1,003-node `docs` lump is terrain and is *not* this: terrain is
ADR-0010 working correctly and is held fixed by every counterfactual in this document.

Note which way the counts mislead. hugo has **18 regions and clips 0%**, so on the table above it
is the healthiest repo in the set. It is the sickest. **The count is not the measurement.**

### 1.2 The five identical greys are terrain, and that is a rendering decision

`scene.ts` maps every terrain region to `TERRAIN_INDEX = -1`, so they share one grey by design
(ADR-0010: a hue is a claim of topological kinship, and terrain has none). The legend nonetheless
prints **one row per terrain region**, each with the identical swatch: 4 on ark, 6 on graphql-js,
**13 on prometheus**. The playtester who reported "five of them the same grey" was reading the
palette correctly; the defect is that the legend spends a row on each.

### 1.3 The clipped rows are unreachable, not merely below the fold

```css
.legend {
  max-height: 42vh;
  overflow-y: auto;      /* says it scrolls */
  pointer-events: none;  /* and makes scrolling impossible */
}
```

Both properties are in the same rule block and no other rule re-enables pointer events on
`.legend`. So the 158 rows django hides are not one scroll away — there is no input that reaches
them. This is a one-line defect that has been reported as "the legend clips" for a milestone.

---

## 2. The cheap fixes, measured before being declined

CLAUDE.md: *measure the fix you are declining before you decline it.* None of these moves a node.
`scripts/probe-legend.ts`. The measure is **share of nodes a reader can account for from a legend
row**, because a row naming 3 of 425 nodes and a row naming 49 are not the same amount of map.

| repo | today (17 rows, id order) | + ordered by size | + terrain as one row | rows for 90% |
|---|---:|---:|---:|---:|
| ark | 96% | 99% | **100%** | 12 |
| flask | 100% | 100% | **100%** | 11 |
| hono | 29% | 60% | **67%** | 42 |
| graphql-js | 36% | 85% | **89%** | 22 |
| kysely | 70% | 95% | **99%** | 14 |
| prometheus | 43% | 84% | **95%** | 20 |
| hugo | 100% | 100% | **100%** | 2 |
| django | 14% | 68% | **70%** | 90 |

**One comparator and one collapsed row take six repos of eight to ≥ 89% of the map accounted for
from seventeen legend rows.** The legend is sorted by region id today, which is alphabetical and
therefore unrelated to size, which is why 71% of hono's map and 86% of django's fall off the end.

This is the answer to "is the clustering the binding constraint": **on ark, flask, kysely,
prometheus, hugo and graphql-js, it is not.** The rendering is. Those changes should be made
whatever is decided about §7, and they are not owner-gated.

**What the cheap fix does not buy**: it does not answer NORTH-STAR §5 tier 1. Seventeen legend rows
covering 95% of the map is still seventeen regions, and the tier-1 question is *"what are the
top-level regions?"* The five largest regions cover **31% of hono, 41% of prometheus, 54% of
django** — so on those repos there is no honest five-region answer to give, however the legend is
drawn. And nothing in a legend touches hugo's 78.9% blob, because hugo's legend is already perfect:
it faithfully reports one region containing most of the repo.

### 2.1 Semantic zoom collapsing regions at territory level — rejected, no measurement needed

The third cheap candidate was to merge regions at territory zoom. It is rejected on the spec rather
than on a number: any merge rule is either **topological**, in which case it is a clustering change
wearing a rendering costume and needs the same layout epoch, or **path-based**, in which case
pillar 4 refuses it — a node grouped by its directory has been grouped for filing reasons. ADR-0010
decision 1 already settles the one place a path-based grouping is allowed, and that place is
terrain.

---

## 3. The prototype

`scripts/prototype-louvain.ts` — deterministic Louvain with Leiden's connectivity guarantee, **313
lines including comments**. **Not wired into the indexer.**

Determinism is the whole risk, so it is built the way `layout.ts` is:

- **No `Math.random`.** Textbook Louvain randomises the visit order and published Leiden also
  samples its refinement; here the visit order is ascending node index at every level and the
  refinement is greedy.
- **Ties break to the lowest community id.** Candidate communities are iterated in ascending order
  and the comparison is strictly `>`, so an equal-gain candidate never displaces a lower-id one.
- **Only `+ - * /`.** No `Math.pow`, `exp` or `log`, which are implementation-defined to within an
  ulp and would let a partition differ between engines.
- **Every accumulation runs in index order**; `Map`s are only ever read through a sorted key list.

**Measured: 56 of 56 paired runs byte-identical**, across eight repos × seven values of γ
(`scripts/probe-sweep.ts`). That is the prototype's own determinism; the shipped
`test:determinism` remains byte-identical on this branch because nothing in `src/` changed.

### 3.0 Which of those rules is load-bearing — mutated, and one of them is not

A paired re-run inside one process is a weak instrument: `Map` iteration order is itself
deterministic for a fixed insertion sequence, so a partition that secretly depends on insertion
order still passes it. The rules above are therefore justified by *construction*, and construction
claims are worth exactly as much as a mutation test. `scripts/probe-labels.ts` prints the partition
and nothing else, and each rule was removed in turn:

| mutant | result |
|---|---|
| candidate iteration unsorted (tie-break becomes insertion order) | **dies** — different partition |
| `gain >= bestGain` instead of `>` (equal gain displaces the lower id) | **dies** — different partition |
| aggregated adjacency unsorted | **survives** — byte-identical partition on all eight repos |

So two of the three decide the answer and the third does not. It is not decorative and it is not
proven either: edge weights in this prototype are integer counts, and integer addition is
associative, so the aggregation order cannot move a sum *at this configuration*. The real atlas
carries an `AtlasEdge.weight`, and the moment a non-integral weight reaches the aggregation the
guard starts mattering. It is kept for that reason, stated rather than dressed up as a measured win.

**The first run of this mutation test was itself vacuous** and reported a clean 3-of-3 kill: it
hashed `probe-louvain`'s whole report, which prints per-repo timings, so it was comparing clock
noise and every mutant "died". The tell was the restored file hashing differently from the baseline.
That is the always-reads-good instrument, in the harness built to check the instruments.

### 3.1 The Leiden repair fires zero times, and it is being kept anyway

Louvain's known defect is that a community can come out internally disconnected. `splitDisconnected`
gets Leiden's guarantee deterministically: after the levels settle, each community is checked for
connectivity and a disconnected one is split into components, first-reached-keeps-the-label.

**It fired on 0 communities across all 56 runs.** CLAUDE.md's landmine is explicit that a path
nobody counted is code asserting a behaviour the product does not have, and that counting comes
before writing tests around it — so it is counted here, before, and reported as dead.

It is kept, and the reason is narrower than "defence in depth": it is not a *repair* that never
fires, it is the **only cheap proof that the property holds**. Deleting it would leave the claim
"regions are connected" resting on eight repos having happened not to violate it. The honest
statement is the one ADR-0019 had to make about `oldestK`: **it is dead under this configuration**,
and the condition that revives it is a repo whose local moving strands a community — which nothing
in the algorithm forbids. If a later session finds it still at zero on a wider set, deleting it is
defensible; keeping it and calling it load-bearing is not.

---

## 4. Choosing γ — an argmax, not a threshold

CLAUDE.md says to put a bar in the largest gap in the measured distribution and name both
neighbours. **γ needs no bar**, which is a better outcome than a well-placed one: the modularity
each repo achieves is maximised at **γ = 1.00 on all eight repos** (tied with 0.75 on flask and
graphql-js). It is simultaneously the textbook value and the argmax on every repo measured, so the
roundness is a coincidence rather than the argument.

The sweep also refutes the tempting direction. Low γ merges toward the "about five regions a person
can hold" target and **destroys the structure to get there**: at γ = 0.25, graphql-js reads
**Q = 0.060**, django **0.043**, hugo **0.022** — one blob and some crumbs, which is hugo's existing
failure applied to everything. A five-region answer that is not true is worth less than a
fifteen-region answer that is.

| γ | 0.25 | 0.50 | 0.75 | **1.00** | 1.50 | 2.00 | 3.00 |
|---|---:|---:|---:|---:|---:|---:|---:|
| ark Q | 0.257 | 0.320 | 0.403 | **0.421** | 0.396 | 0.362 | 0.328 |
| hono Q | 0.483 | 0.569 | 0.615 | **0.628** | 0.621 | 0.589 | 0.580 |
| django Q | 0.043 | 0.379 | 0.446 | **0.474** | 0.458 | 0.450 | 0.417 |
| hugo Q | 0.022 | 0.095 | 0.297 | **0.315** | 0.288 | 0.271 | 0.235 |

---

## 5. Before and after

Both partitions scored on **the same graph** — the linked subgraph, with the terrain rule, the node
set and the edge set held fixed. Only the assignment of linked nodes differs. That is what the
counterfactual holds fixed, and it holds it: edgeless nodes keep the terrain region they have today
in every table here, which is why hugo's 1,003-node `docs` lump appears on neither side.

| repo | linked | regions now → lou | **Q now → lou** | largest now → lou (share of linked) |
|---|---:|---:|---:|---:|
| ark | 148 | 15 → **5** | 0.334 → **0.421** | 47% → **27%** |
| flask | 78 | 10 → **6** | 0.306 → **0.386** | 38% → 37% |
| hono | 367 | 51 → **14** | 0.476 → **0.628** | 13% → 17% |
| graphql-js | 418 | 32 → **13** | 0.302 → **0.442** | 25% → 19% |
| kysely | 432 | 19 → **10** | 0.208 → **0.429** | 39% → **23%** |
| prometheus | 350 | 21 → **7** | 0.543 → **0.719** | 15% → 27% |
| hugo | 204 | 8 → **9** | 0.089 → **0.315** | **79% → 20%** |
| django | 2249 | 168 → **15** | 0.281 → **0.474** | 31% → **22%** |

**Modularity rises on all eight**, by +0.080 (flask) to +0.226 (hugo). **Every repo lands between 5 and 15 regions
— all inside the legend, none needing a scroll.** hugo's collapse is fixed: 78.9% → 20.1%.

Cost is negligible: **58 ms on django**, against a 12.4 s index and a 5.5 s layout.

### 5.1 The map still reads

Regions reach the map through `computeLayout`'s `groups`, so "are these regions better" is finally a
question about the picture. `tests/atlas/atlas.test.ts` pins it as the ratio of mean intra-region
spread to mean inter-region centroid spacing, ceiling **0.20**.
`scripts/probe-layout-quality.ts` computes it for both groupings with identical layout options and
**discards the positions**.

| repo | ratio now | ratio lou |
|---|---:|---:|
| ark | 0.188 | **0.158** |
| flask | 0.110 | 0.115 |
| hono | 0.088 | 0.117 |
| graphql-js | 0.162 | **0.135** |
| kysely | 0.163 | **0.140** |
| prometheus | 0.097 | 0.121 |
| hugo | 0.355 | **0.312** |
| django | **0.244** | **0.191** |

Better on five, slightly worse on three, and every repo bar hugo is inside the ceiling under
Louvain. **django is over the ceiling today at 0.244 and comes back under it at 0.191** — which is a
finding about the test as much as the layout: that assertion only ever runs on ark, so django has
been breaching pillar 4's regression floor invisibly. hugo fails both, because a 1,003-node terrain
lump has no cohesion structure to give.

### 5.2 Stability across commits is a dead heat

CLAUDE.md's landmine: regions are stable for a commit and nothing guarantees they survive a small
graph change, and a replacement that is worse at this costs more than its counts suggest.
`scripts/probe-stability.ts`, over six 25-commit jumps through ark's history.

Three instruments, and the first two disagree:

- **Raw Rand index** favours label propagation: 0.938–0.980 against 0.899–0.978.
- **Excess over chance** favours Louvain: mean **0.260 vs 0.205**, on all six jumps.

They disagree because a partition of 5 blocks has a high chance-level Rand *by construction*, so the
raw score flatters whichever side has more regions. Quoting either alone would be picking the
instrument that gives the answer wanted. The third is granularity-neutral and is what a returning
player would actually notice — **the share of shared nodes that changed region** after matching each
old region to its best-overlapping new one:

> **now 12.7%, louvain 12.3%.**

A dead heat. **Stability is not a reason to prefer or reject either**, and a layout epoch buys
nothing on this axis. (Across *consecutive* commits both score 1.000 on 7 of 7 and 6 of 7 — that
window is too quiet to discriminate, which is why it is not the number quoted.)

---

## 6. What the measurements refuted

### 6.1 Nameability does not improve — the argument this work started from is wrong

*"A region a human cannot name is not a region"* was the brief's criterion and the expected payoff.
It is measured in `scripts/probe-nameable.ts` as F1 between the region and the best directory
describing it, using the product's own set metric so that a name covering the region but sweeping in
strangers is penalised exactly as an over-broad player answer is.

| repo | nameable now | nameable lou | mean F1 now → lou | **share of topology nodes in a nameable region** |
|---|---:|---:|---:|---:|
| ark | 1/15 | **3/5** | 0.288 → **0.744** | 5% → **51%** |
| flask | 4/10 | 2/6 | 0.532 → 0.650 | **59% → 17%** |
| hono | 21/49 | 5/14 | 0.699 → 0.599 | 27% → 25% |
| graphql-js | 5/30 | **5/13** | 0.333 → **0.631** | 23% → **37%** |
| kysely | 6/18 | 4/10 | 0.567 → 0.622 | **60% → 44%** |
| prometheus | 1/21 | **4/7** | 0.427 → **0.724** | 4% → **54%** |
| hugo | 1/8 | 1/9 | 0.559 → 0.574 | 3% → 6% |
| django | 50/168 | 2/15 | 0.507 → 0.503 | **14% → 1%** |

**Improves on three, worsens on three, flat on two.** Mean best-directory F1 rises on six of eight,
but the reader-facing column — how much of the map sits in a region anything can name — is a wash,
and django goes from 14% to **1%**.

The cause is structural rather than fixable: a coarse community crosses directory boundaries.
django's 170-node region is `tests/forms_tests/field_tests` + `tests/forms_tests/widget_tests` +
`django/forms`, which a human names "forms" in one word and which no directory describes, because
`tests/forms_tests` holds far more files than the region does. **The region is a true and
interesting claim about django** — a feature's implementation and its tests are one coupling cluster
— and it is precisely the shape a directory name cannot express.

The obvious follow-up was that the *naming rule* is the constraint, not the region: name a region
after its most salient **path segment** ("forms", "migrations", "gis", "jsx") rather than a shared
directory prefix. `scripts/probe-naming.ts` scores both rules on the identical partition, and it is
a wash — no repo's mean F1 moves by more than **0.068** (hono, in the segment rule's favour; its
worst is −0.051 on graphql-js), and the node share barely moves at all:

| | ark | flask | hono | graphql-js | kysely | prometheus | hugo | django |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| subtree rule | 0.744 | 0.650 | 0.599 | **0.631** | 0.622 | 0.724 | **0.574** | 0.503 |
| segment rule | 0.702 | 0.658 | **0.667** | 0.580 | 0.640 | 0.729 | 0.529 | 0.526 |

So the hypothesis is refuted twice over, and the honest conclusion is that **Louvain does not
unblock tier 1 by itself.** It removes the *count* obstacle — you cannot ask "what are the top-level
regions?" of 175 things — and leaves the *naming* obstacle standing on django and hugo.

### 6.2 Where it plainly does work, it works very well

Qualitatively, which is the check no F1 replaces. ark's five regions, from the import graph alone:

```
  40  tests        35  src/verbs      33  src/player     32  src/indexer     8  src/atlas
```

That is `README.md`'s own architecture table, recovered without reading it. Today's partition names
the same repo `src/atlas/index` (69), `src/player/main` (23), `src/atlas/schema` (7),
`src/indexer/build` (6) — hub filenames, not architecture. prometheus's seven are as clean: the
React UI, the Go core, the Mantine UI, its query pages, service discovery, the CodeMirror PromQL
module, and the remote-storage examples.

**The split is not random.** It works on repos whose directory layout follows their coupling and
fails on repos where it does not (django separates `tests/` from `django/`; hugo puts most of itself
in one package). That is a fact about the repositories, and a clustering that reported otherwise
would be lying.

---

## 7. The blast radius, costed

**What moves.** Everything. `build.ts` passes `groupByRef` into `computeLayout` and the cohesion
force pulls each node toward its region's centroid, so a changed partition changes every `[x, y]` in
every atlas. This is the whole reason this ADR is `proposed`: NORTH-STAR §7 freezes the layout, and
a session may not license the epoch.

**What a player loses.** Spatial memory, completely — the asset §7 exists to protect. Not partially:
every node, every repo, once.

**What a player keeps — all of it.** `nodeIdFor` hashes `originPath` and nothing else, so **no node
id changes**. `save.ts`, `progress.ts`, `notes.ts` and `fog.ts` never read a region; grepped, the
only reader anywhere near the player's state is `selector.ts`, reached through the `regionOf`
closure `main.ts` builds at line 466, which uses it as a *variety* constraint on which board to
serve next and is correct under any partition. So **every saved pass,
every field note and every lifted fog survives**, and ADR-0011's re-check at render has nothing to
drop. The loss is entirely "I no longer know where anything is", not "my progress was erased".

**Atlas version: no bump.** `Region`'s shape is unchanged — ids, labels, `kind`, `nodeCount`,
`centroid` all keep their types. Only values change, and `validateAtlas`'s region back-references
hold by construction. A stale atlas still loads; it just draws a different picture, which
`repo.head` already reports as staleness.

**What needs re-pinning, and what breaks.**

| | |
|---|---|
| `tests/unit/layout.test.ts` golden layout (ADR-0038) | **Re-pin.** Every coordinate changes; this is the file whose whole point is that a moved coordinate is caught. |
| `tests/atlas/atlas.test.ts` intra/inter spread ratio | **Re-measure.** ark 0.188 → 0.158, still under the 0.20 ceiling, so the bar holds. |
| `tests/atlas/atlas.test.ts` region-count bound | **Breaks as written.** It asserts every topology region has ≥ `MIN_REGION` = 3 members; Louvain ships two 2-node regions on hono. Either keep the small-region absorption pass in front of the new clustering, or replace the theorem — the bound it protects (`regions ≤ n/3 + topLevelDirs`) is no longer the live risk, since the measured range is now 5–15. |
| `tests/unit/regions.test.ts` (29 assertions) | **Rewritten.** They test label propagation's mechanics — connector hold-out, small-region absorption — most of which cease to exist. |
| `test:determinism` | **Must stay byte-identical.** The prototype is deterministic by construction and measures 56/56, but this is the canary and the acceptance gate. |
| `npm run raster`, budgets | Re-measure. Layout time is unchanged; clustering adds 58 ms at django's scale. |
| Deployed page | Rebuilds from `master` on push, so the map moves under anyone mid-session. **Sequencing, not just correctness.** |

**Effort**: the clustering itself is 313 lines and exists. The work is the test surface — one
rewritten unit file, three re-pins, one broken invariant to re-decide — plus a naming rule that
still cannot name django. Call it a session, and a second session if the naming question is taken
seriously.

---

## 8. Recommendation

**Two changes, and only the first is mine to propose doing.**

1. **Fix the legend now, independently of everything else.** Order by `nodeCount` descending;
   collapse terrain to a single row (they already share one colour); drop `pointer-events: none` so
   the overflow the CSS already declares can actually be scrolled; and show `+N more` when rows
   remain. Measured: **six repos of eight go to ≥ 89% of the map accounted for**, from 36% and 43%
   on the two where the playtest was run. No node moves, no owner decision, no epoch. This is most
   of the reported complaint and it is not blocked on anything in this document.

2. **Recommend the owner license a layout epoch for deterministic Louvain at γ = 1** — on the
   count-and-collapse argument, not the nameability one. What carries it: every repo lands at 5–15
   regions instead of up to 175; modularity rises on all eight; hugo's 78.9% blob becomes 20.1%;
   django comes back inside pillar 4's own spread ceiling; stability across commits is unchanged;
   the cost is 58 ms; and CLAUDE.md pre-authorises exactly this move rather than a third patch to
   label propagation. What does **not** carry it: nameability, which is a wash (§6.1), so tier-1
   content is *unblocked on count and still blocked on naming for django and hugo*.

If the owner declines the epoch, **do (1) anyway** — it is the larger share of the measured harm on
six of the eight repos, and it was never the clustering's fault.

---

## 9. What would change this

- **A repo where the Leiden repair fires.** It is 0/56 today and is kept as a proof, not a feature
  (§3.1). Two sessions of zero on a wider slate is grounds to delete it.
- **A naming rule that can name a cross-directory community.** Both rules measured here fail on
  django. If one is found, §6.1's refutation is reopened and the tier-1 argument returns — this is
  the single highest-value follow-up in this document.
- **γ moving off 1.00 on a new repo.** It is the argmax on all eight; a repo where it is not would
  make γ a tuned parameter, which is a materially worse thing to own than a textbook constant.
- **A measurement of what a player actually retains.** Every number here is a property of a
  partition, not of a person. `docs/experiments/0001` is the instrument that could say whether five
  regions are remembered better than fifty-seven, and it is unrun.
- **hugo's ratio.** It fails pillar 4's spread ceiling under both partitions (0.355 → 0.312) because
  of its terrain lump, and nothing in this document addresses that.
