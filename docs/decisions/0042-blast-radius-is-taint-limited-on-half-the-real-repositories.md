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
| 2 — where the taint sits | **done** | Taint is **overdetermined**. Every resolver fix combined frees **5 of typeorm's 1,921** tainted subjects, 6 of excalidraw's 388, 1 of vue-core's 220 — and **192 of apollo-client's 217, 215 of nest's 249, 127 of rxjs's 141**. The corpus splits in two. |
| 3 — candidate A (workspace specifiers) | **done** | Built, measured, reverted. **+250 blast boards, 0 lost, 0 wrong answer keys** — but on **3 repos of 20**, and none of them the three worst-starved. |
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

## 2. Where the taint actually sits

ADR-0028 §8.1's shape — *0.06% of sites causing 83.7% of the effect, by position rather than rate* —
reproduces, and then goes further than that document had to.

### 2.1 One file is the whole story on the worst repo

`scripts/probe-taint.ts` ranks every unsound node by **blast subjects poisoned** (never by unresolved
count — those are different orderings and only the first decides a deck).

| repo | tainted subjects | unsound nodes | **nodes reaching 50% of the taint** | nodes reaching 90% | worst five together |
|---|---|---|---|---|---|
| typeorm | 1,921 | 276 | **1** | **1** | 99.7% |
| excalidraw | 388 | 65 | **1** | **1** | 97.7% |
| vue-core | 220 | 60 | **1** | 3 | 95.9% |
| nest | 249 | 1,123 | **1** | 113 | 64.7% |

typeorm's single worst file is `src/platform/PlatformTools.ts`, carrying **one** `require(<expression>)`,
and it poisons **1,912 of 1,921** tainted subjects. That is **one import site of 13,805 — 0.007% —
causing 99.5% of the starvation** on a 3,704-node repository.

The two orderings disagree exactly as predicted. typeorm's most unresolved *file* carries 7
specifiers and poisons **0** subjects; the file that poisons 1,912 carries **1**.

### 2.2 The causes, weighted by subjects poisoned

`scripts/probe-causes.ts` classifies every unresolved specifier. Two of the classes are resolver
defects this session found while doing it:

- **`dottedSegment`** — `extensionOf('./x.interface')` returns `.interface`, so `resolve.ts`'s
  `candidatesFor` treats the specifier as already carrying an extension and **never appends `.ts`**.
  `x.interface.ts` is on disk and is never a candidate. nest's whole naming convention is
  `*.interface`, `*.enum`, `*.service`, `*.hook`: **1,942 specifiers across 976 files**.
- **`rootSelfPath`** — `require('../')` from `test/` normalises to base `''`, and `candidatesFor('')`
  builds `/index.ts` with a **leading slash**, which can never match a repo-relative node key. This
  is ADR-0026's cobra defect — *a path prefix and a node key are not the same string* — living in the
  ES resolver, unnoticed. express carries **96 of them in 96 files**.

**A gate on the instrument, and it fired.** The first run of `probe-causes.ts` reported vue-core's
starvation as `undeclaredBare` at 99.5%. `node.unresolved` records a CJS site as the **whole call
expression** (`scan.ts`'s `raw` is `require('./x')`, not `./x`), so reading the field verbatim files
every dynamic and CJS site under "bare specifier declared nowhere". Unwrapped, vue-core's top cause
is `missingFromTree` at 99.1% — `require('./dist/shared.cjs.js')`, a relative path to a build
artifact. The wrong reading pointed at a fixable cause; the right one points at an unfixable one.

### 2.3 The finding that decides every candidate: taint is **overdetermined**

On typeorm, `computed` poisons 99.6% of tainted subjects **and** `dottedSegment` poisons 99.4% —
because both sit in the same hub cluster that everything reaches. So *"this cause poisons N
subjects"* is **not a fix's ceiling**. The ceiling is how many subjects it un-taints *with the other
causes left in place*.

`scripts/probe-marginal.ts` computes that by re-running `taintedRefs`'s reverse walk with one cause's
sites withheld. **What it holds fixed**: the graph, the deck cap, the generator, every other cause.
One knob.

| repo | blast subjects | tainted today | best single fix | **freed** | **all four resolver fixes together** | perfect resolution (unbuildable) |
|---|---|---|---|---|---|---|
| **typeorm** | 2,221 | 1,921 | workspaceSelfReference | 4 | **5 (0.2%)** | 1,921 (86.5%) |
| **excalidraw** | 479 | 388 | siblingManifestDep | 3 | **6 (1.3%)** | 388 (81.0%) |
| **vue-core** | 254 | 220 | workspaceSelfReference | 1 | **1 (0.4%)** | 220 (86.6%) |
| **express** | 36 | 24 | rootSelfPath | 17 | **17 (47.2%)** | 24 (66.7%) |
| **rxjs** | 295 | 141 | workspaceSelfReference | 125 | **127 (43.1%)** | 141 (47.8%) |
| **apollo-client** | 348 | 217 | workspaceSelfReference | 192 | **192 (55.2%)** | 217 (62.4%) |
| **nest** | 286 | 249 | dottedSegment | 74 | **215 (75.2%)** | 249 (87.1%) |

**The corpus splits in two, and the split is not the one the starvation ranking suggests.**

- **Group A — resolver work buys nothing.** typeorm, excalidraw and vue-core are the three *worst*
  starved repos in the survey, and every resolver fix combined frees **12 subjects between them**
  (5 + 6 + 1) out of 2,529 tainted. Their taint is `computed` (`require(<expression>)`) and
  `missingFromTree` (`./dist/*` build output) — the two classes a resolver structurally cannot
  address, because resolving them requires running the code (pillar 6) or building it (pillar 6).
- **Group B — resolver work is large.** rxjs 43.1%, express 47.2%, apollo-client 55.2%, nest 75.2%
  of *all* their blast subjects.

The last row is worth reading on its own: **even perfect resolution leaves typeorm, excalidraw and
vue-core exactly where they are**, because "perfect" is the row that cannot be built. What is
buildable is the second-to-last column, and on the three worst repos it is 0.2%, 1.3% and 0.4%.

---

## 3. Candidate A — resolving workspace self-references

### 3.1 The refusal's stated reason is repo-dependent, and nothing had checked it

`resolve.ts` refuses a specifier naming a package the repo itself defines, and gives a reason:

> *a package's entry point is its `exports` or `main`, and in a monorepo those name **built** output
> that is gitignored and not on the map.*

Measured across the corpus's monorepos, that sentence is true of some repos and false of others:

| repo | root/package `exports` for `.` | the comment is |
|---|---|---|
| apollo-client | `./src/core/index.ts` | **false** — source, on disk, build-free |
| nest | *(none, and no `main`)* | **unaddressed** — `packages/common/utils/x.util.ts` is right there |
| rxjs | `./dist/esm/index.js` | true — but `packages/*/src/` resolves anyway |
| vue-core | `./dist/*.esm-bundler.js` | **true** |
| typeorm | *(names `dist`)* | **true** |

So the honest rule is *try, and keep the refusal when nothing lands on an indexed file*. Scored
before implementing (`scripts/probe-workspace.ts`), in priority order — the `exports` entry, then
`D/S`, then `D/src/S`:

| repo | workspace specifiers | via `exports` | via `D/S` | via `D/src/S` | **still unresolved** |
|---|---|---|---|---|---|
| apollo-client | 1,197 | 1,176 | 12 | 0 | **9 (0.8%)** |
| rxjs | 1,536 | 1 | 0 | 1,509 | **26 (1.7%)** |
| nest | 564 | 0 | 493 | 0 | **71 (12.6%)** |
| vue-core | 15 | 2 | 1 | 11 | **1 (6.7%)** |
| excalidraw | 18 | 0 | 2 | 0 | **16 (88.9%)** |
| typeorm | 247 | 0 | 0 | 0 | **247 (100%)** |

### 3.2 Built, measured on all 20 repos, reverted

Three resolver changes were implemented together, because §2 found three fixable causes and
measuring one at a time would price each against a baseline the others had already moved (the
landmine ADR-0019's counterfactual table hit): workspace resolution as above, the `dottedSegment`
extension append, and the `rootSelfPath` leading slash.

**What the counterfactual holds fixed**: the same 20 pinned commits, the same deck cap, the same
generator, the same gate, the same everything downstream of resolution. One knob — `resolve.ts` and
the config index feeding it.

| repo | res% | subjects tainted% | **blast boards** | verdict |
|---|---|---|---|---|
| apollo-client | 60.9 → **98.8** | 62.4 → **16.8** | 46 → **108** *(at cap)* | **+62** |
| nest | 60.1 → **99.0** | 87.1 → **70.4** | 7 → **120** | **+113** |
| rxjs | 51.7 → **99.0** | 47.8 → **18.8** | 75 → **150** *(at cap)* | **+75** |
| express | 74.2 → **98.5** | 66.7 → 67.6 | 2 → **2** | — |
| date-fns | 93.0 → 99.9 | 0.3 → 0.0 | 226 → 226 *(at cap)* | — |
| excalidraw | 97.0 → 98.0 | 81.0 → 81.4 | 21 → **21** | — |
| typeorm | 97.6 → 97.9 | 86.5 → 86.5 | 58 → **58** | — |
| vue-core | 96.3 → 96.5 | 86.6 → 86.5 | 7 → **7** | — |
| kysely | 92.1 → 92.9 | 3.6 → **7.2** | 75 → 75 *(at cap)* | — |
| hono, ark, graphql-js, hugo, prometheus, webpack, cobra, django, flask, system-design-primer | ±0.7 | ±0.2 | unchanged | — |

**+250 blast boards, 0 lost.** `test:unit` 878 passed, `test:atlas` 112 passed, `test:determinism`
byte-identical.

### 3.3 Does it ship a wrong answer key? Measured from outside the atlas — no

`scripts/probe-wrongkey.ts`. ADR-0026 §6.1's rule applies: an atlas-derived check structurally
cannot see a missing edge, so the only atlas input is the board itself (subject, candidates, truth)
and each node's path. Everything else is the file text and the filesystem, read with the probe's
**own** regex lexer rather than `scan.ts`, because ADR-0028 §8.1's defect survived two instruments
that shared one blindness.

**The gate.** `--plant` moves one member of each board's key into the distractor set. It catches 20
of ark's and 33 of hono's — so a zero from this probe is a measurement rather than a silence.

| | wrong-answer slots | **violations** |
|---|---|---|
| original resolver, 15 repos | 42,584 | **0** |
| **with all three fixes, 15 repos** | **46,373** | **0** |

So the change adds 3,789 wrong-answer slots and **zero** wrong answer keys, on a probe that
demonstrably fires.

**The instrument needed three corrections, and every one made ark look worse than it was** — which
is the direction that gets believed, so each is named:

1. **24 violations on webpack** were JSDoc `/** @typedef {import("./util/fs").X} */` — type
   references inside comments, which `scan.ts` masks and correctly makes no edge from.
2. **1 on hugo** was `golang.org/x/text/transform` matched against hugo's own top-level `transform/`
   by an unanchored suffix. An external package read as an internal edge. Anchoring on the `go.mod`
   module path fixes it — ADR-0026's *a path prefix and a node key are not the same string*, now in
   the probe rather than the product.
3. **2 on webpack** were `require.main.require('./file')`, a different function whose specifier
   resolves against the main module. The regex matched its trailing `.require(`.

The residue of #1 is a real finding and not a defect: webpack states type dependencies in JSDoc,
which is a **dependency that is not an import** — ADR-0024 decision 5's class, in JavaScript.

### 3.4 The prediction that was wrong, and why

§2's marginal probe predicted **express +17 subjects**. Measured: express gained **0 boards** and its
subject-taint share **rose**, 66.7% → 67.6%. Three more repos rose too — kysely 3.6% → **7.2%**,
excalidraw +0.4, prometheus +0.2.

The mechanism is the one §2's counterfactual could not model, and it is worth stating because it
bounds every future estimate of this kind: **resolving a specifier does not delete it, it turns it
into an edge** — and an edge carries taint *out of its target's closure* into the importer. §2
withheld sites without adding the edges they would become, so **every figure in §2.3 is an upper
bound**, and on the repos where the newly-reachable code is itself unsound the realised value is
zero.

That is also why apollo-client and rxjs land exactly on their caps (108 and 150) rather than above
them: past the cap, more supply buys nothing at all.

### 3.5 What it is worth

Three repos of twenty move. **None of them is one of the three worst-starved** — typeorm, excalidraw
and vue-core gain 0, 0 and 0 boards, exactly as §2 predicted and for the reason §2 gave. The
candidate is real, it is safe, and it is **not the answer to the starvation question**; it is the
answer to a different and smaller question about monorepo resolution.

---

*Phases 4–7 follow.*
