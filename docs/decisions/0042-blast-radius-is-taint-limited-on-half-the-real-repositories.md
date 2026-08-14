# ADR-0042 — Blast Radius is taint-limited on half of real repositories, and the reference set could not see it

- **Status**: proposed
- **Date**: 2026-08-14
- **Bears on**: ADR-0003 (an unresolved import produces no edge), ADR-0008 (truth is unbounded),
  ADR-0024 (a language ships on its deck, not its map), ADR-0028 (Python is mapped and never graded);
  NORTH-STAR §6.1 (the v1 verb), §13 M2 (the kill point), guardrail 4
- **Code shipped by this ADR**: phase 6 only. The survey and the candidate measurements are probes.

## Progress

| phase | state | headline |
|---|---|---|
| 0 — pre-flight | **done** | 20 repos, full depth, pinned; baseline 878 unit / atlas / determinism green |
| 1 — the survey | **done** | **7 of 16** gradeable repos are taint-limited. **All 4 reference repos are cap-limited.** |
| 2 — where the taint sits | pending | |
| 3 — candidate A (workspace specifiers) | pending | |
| 4 — candidate B (taint stops at first unresolved edge) | pending | |
| 5 — candidate C (bounded depth) | pending | |
| 6 — two smaller findings | pending | |
| 7 — synthesis + adversarial review | pending | |

---

## 1. The survey

Twenty repositories, cloned at **full depth** and pinned to a named commit
(`scripts/probe-repos.sh`), indexed through ark's own `buildIndex` so every figure is the instrument
that decides the deck rather than a re-derivation of it (`scripts/probe-supply.ts`).

Full depth is not a nicety: `src/verbs/commits.ts` refuses the whole history deck on a shallow
repository, so a `--depth` clone reads zero history boards and makes Blast Radius's share of the deck
look artificially *high* — the exact opposite of the effect being measured.

### 1.1 The distribution

| repo | sha | nodes | edges/node | res% | closure med | blast subjects | subjects tainted | boards | cap | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| ark | `9b86d12b` | 226 | 3.10 | 100.0 | 9 | 88 | 0.0% | 40 | 40 | cap-limited |
| cobra | `adbc8813` | 19 | 0.05 | 100.0 | 0 | 1 | 0.0% | 0 | 40 | nothing to predict |
| hugo | `44da0860` | 1242 | 1.04 | 99.2 | 0 | 197 | 0.0% | 156 | 156 | cap-limited |
| date-fns | `a0a39220` | 1801 | 2.52 | 93.0 | 7 | 1258 | 0.3% | 226 | 226 | cap-limited |
| graphql-js | `9c245018` | 549 | 3.70 | 96.1 | 4 | 220 | 0.9% | 69 | 69 | cap-limited |
| hono | `7075369e` | 425 | 2.51 | 98.5 | 19 | 218 | 1.4% | 54 | 54 | cap-limited |
| kysely | `f24018c7` | 600 | 4.13 | 92.1 | 3.5 | 331 | 3.6% | 75 | 75 | cap-limited |
| webpack | `f0246170` | 12626 | 0.67 | 80.1 | 0 | 4250 | 18.8% | 1579 | 1579 | cap-limited |
| prometheus | `3c82a95e` | 501 | 2.48 | 99.2 | 1 | 288 | 19.8% | 63 | 63 | cap-limited |
| **rxjs** | `54796b38` | 1197 | 0.75 | 51.7 | 0 | 295 | **47.8%** | 75 | 150 | **taint-limited** |
| **apollo-client** | `ba511be4` | 857 | 1.12 | 60.9 | 0 | 348 | **62.4%** | 46 | 108 | **taint-limited** |
| **express** | `a3714473` | 146 | 0.39 | 74.2 | 0 | 36 | **66.7%** | 2 | 40 | **taint-limited** |
| **excalidraw** | `abeeaeba` | 777 | 4.45 | **97.0** | 397 | 479 | **81.0%** | 21 | 98 | **taint-limited** |
| **typeorm** | `df07bf1e` | 3704 | 3.16 | **97.6** | 473 | 2221 | **86.5%** | 58 | 463 | **taint-limited** |
| **vue-core** | `a2b40db9` | 591 | 3.05 | **96.3** | 15 | 254 | **86.6%** | 7 | 74 | **taint-limited** |
| **nest** | `674ac31d` | 2011 | 1.22 | 60.1 | 1 | 286 | **87.1%** | 7 | 252 | **taint-limited** |
| django | `c9eb16a8` | 3035 | 3.35 | 98.7 | 212 | 981 | 83.7% | 0 | 380 | ungraded language |
| flask | `6a2f545b` | 91 | 2.12 | 94.2 | 22 | 32 | 93.8% | 0 | 40 | ungraded language |
| system-design-primer | `ae9bbd7b` | 49 | 0.00 | 76.5 | 0 | 0 | 0.0% | 0 | 40 | ungraded language |

**The classification rule, stated so it can be argued with.** *cap-limited* = the deck cap actually
bit (`skipped.capped > 0`): supply exceeded what the product chose to ship. *taint-limited* = the cap
did not bite **and** guardrail 4 refused more subjects than the repo shipped boards
(`capped = 0 ∧ uncertain > generated`). A repo that is neither is refused for a third reason — cobra
has one package, so there is nothing to predict, which is ADR-0024 §5's diagnosis and not a defect.

### 1.2 The gate

**7 of 16 gradeable repositories are taint-limited.** The hypothesis survives.

And the sharper half: **all four reference repos — ark, hono, kysely, graphql-js — are cap-limited**,
as are the two the roadmap's own experiment is run on. The set this project measures itself against
contains no member of the case that matters. `docs/experiments/0001`'s matched pair, ADR-0039's
`retain` measurements, ADR-0040's progression work and every "the cap is the binding constraint"
sentence in the repository were all taken on the eight repos where the cap binds.

### 1.3 Resolution rate is anti-predictive at the top

ADR-0024 decision 4 already retired the resolution rate as the kill-point metric. This is a sharper
instance, because the ordering is not merely uninformative — it **inverts**:

| | res% | subjects tainted | boards / subjects |
|---|---|---|---|
| typeorm | **97.6** | 86.5% | 58 / 2221 (2.6%) |
| excalidraw | **97.0** | 81.0% | 21 / 479 (4.4%) |
| vue-core | **96.3** | 86.6% | 7 / 254 (2.8%) |
| rxjs | **51.7** | 47.8% | 75 / 295 (25.4%) |
| apollo-client | **60.9** | 62.4% | 46 / 348 (13.2%) |

The three worst-starved repos in the corpus resolve better than 96%. The two worst *resolvers* ship
five to ten times the share of their subjects.

### 1.4 Closure depth does not explain it either

ADR-0024 decision 4 proposed `rate × mean closure depth`. That is right about typeorm (median
closure 473) and excalidraw (397) and **wrong about the other two**:

| repo | closure median | subjects tainted |
|---|---|---|
| typeorm | 473 | 86.5% |
| excalidraw | 397 | 81.0% |
| **vue-core** | **15** | **86.6%** |
| **nest** | **1** | **87.1%** |
| hono | 19 | 1.4% |
| ark | 9 | 0.0% |

vue-core has a shallower median closure than hono and 62× its taint. nest's median closure is **1**.
Whatever poisons those two is not depth, and §2 is where it is.

### 1.5 The other three verbs are not starved on the same repos

| repo | blast | companion | placement | archaeology |
|---|---|---|---|---|
| typeorm | **58** | 463 | 327 | 114 |
| excalidraw | **21** | 98 | 98 | 98 |
| vue-core | **7** | 74 | 74 | 74 |
| nest | **7** | 0 | 96 | 45 |
| apollo-client | **46** | 108 | 108 | 108 |
| express | **2** | 40 | 40 | 40 |
| rxjs | **75** | 150 | 150 | 131 |

On every taint-limited repo except nest, the three git-graded verbs ship a full or capped deck while
Blast Radius does not. The product on those repositories is already mostly a history product; the
documents do not say so.

*(nest is a separate finding: its Companion deck is `windowTruncated` — the co-change walk
truncated, so absence from the matrix certifies nothing, which is ADR-0024 §5's django diagnosis
arriving on a TypeScript repo.)*

---

*Phases 2–7 follow.*
