# ADR-0042 — Blast Radius is taint-limited on 7 of 16 gradeable repositories, and the reference set could not see it

- **Status**: **accepted** — decisions 2 and 5 taken by the owner on 2026-08-14; the rest stand as
  measurements and refusals
- **Date**: 2026-08-14
- **Bears on**: ADR-0003 (an unresolved import produces no edge), ADR-0008 (truth is unbounded),
  ADR-0024 (a language ships on its deck, not its map), ADR-0026 (a check about a missing edge must
  come from outside the atlas), ADR-0028 (Python is mapped and never graded), ADR-0038 (a budget is
  a rate);
  NORTH-STAR §6.1 (the v1 verb), §13 M2 (the kill point), guardrail 4
- **Code shipped by this ADR**: §7's two fixes, and §3's workspace resolution — **with the two
  defects a review found inside it closed first** (§3.6). Candidates B and C ship nothing.

## Progress

| phase | state | headline |
|---|---|---|
| 0 — pre-flight | **done** | **19** repos, full depth, pinned; baseline 878 unit / atlas / determinism green |
| 1 — the survey | **done** | **7 of 16** gradeable repos are taint-limited. **All 4 reference repos are cap-limited.** |
| 7 — synthesis + adversarial review (PR #54) | **done** |
| 8 — backlog (b: the other three verbs) | **done** | **Archaeology is supply-limited on 10 of 19**, more than Companion. §10. |
| 8 — backlog (c: own the invariant) | **done** | `npm run check:keys` ships and **runs in CI**. It gates itself: an inert detector **fails** instead of reporting a clean zero. §13. |
| 8 — backlog (a: five more repos) | **done** | The distribution moved to **12 cap-limited / 5 taint-limited of 24**, and a *predictive* rule appeared: starvation is `(1 − taint) × subjects < cap`, right on **18 of 20**. §12. | Four reviewers, **~50 findings, most reproduced**. One was a **wrong answer key in shipped code** (§7.1) and is fixed; the rest are corrected in place with the reviewer's measurement beside mine. |
| 2 — where the taint sits | **done** | Taint is **overdetermined**. Every resolver fix combined frees **5 of typeorm's 1,921** tainted subjects, 6 of excalidraw's 388, 1 of vue-core's 220 — and **192 of apollo-client's 217, 215 of nest's 249, 127 of rxjs's 141**. The corpus splits in two. |
| 3 — candidate A (workspace specifiers) | **done** | Built, measured, reverted. **+250 boards net, 0 directly-visible wrong answer keys** — on **3 repos of 19**, one of them the corpus's worst-starved (nest, 7 → 120). Three limits in decision 5. |
| 4 — candidate B (taint stops at first unresolved edge) | **done** | **REFUSED.** Largest ceiling in the session — typeorm +1,902 subjects — and it puts a real dependent in the wrong-answer pool of **30 of nest's 68** and **18 of apollo-client's 47** unlocked subjects (corrected from 99% / 47%). |
| 5 — candidate C (bounded depth) | **done** | **REFUSED on arithmetic, no code written.** A d=3 bound creates **29,840 eligible wrong-answer slots across typeorm's board-carrying subjects** (542,282 across all of them). ADR-0008's supporting figure — *"**on this repo**, depth-3 truth equals unbounded truth for every node"* — is now false on ark itself. |
| 6 — two smaller findings | **done, and these ship** | A subdirectory index went from **1 challenge to 121** — and the first version of that fix **invented renames and shipped a wrong lineage as `certain`**, found by review and fixed with `--no-renames`. The CLI names an oversized atlas; **1 of 19** repos. |
| 7 — synthesis + adversarial review | pending | |

---

## 1. The survey

Nineteen repositories, cloned at **full depth** and pinned to a named commit
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
is two packages with one import edge between them, so there is nothing to predict, which is ADR-0024 §5's diagnosis and not a defect.

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

Three of the four worst-starved repos resolve better than 96%, and the two worst *resolvers* ship
3.0× to 9.8× the share of their subjects.

**The fourth is `nest`, and an earlier draft of this document left it out of every list.** Ranked by
boards ÷ subjects, the order is **nest 2.4%**, typeorm 2.6%, vue-core 2.8%, excalidraw 4.4% — so
nest is the *worst-starved repo in the corpus* and resolves at **60.1%**, which is the opposite of
this section's claim. The trio named throughout the first draft (typeorm, excalidraw, vue-core) was
the set that made the argument, chosen after the argument. Two independent reviewers found it. The
surviving claim is narrower and is the one the data supports: **resolution rate does not order
starvation** — three of the four worst resolve above 96% and the fourth at 60.1%, while ark (100%)
and hugo (99.2%) are unstarved and rxjs (51.7%) ships a quarter of its subjects.

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

*(ADR-0024 decision 4 and ADR-0028 §4 both report **means**, and the column above is a median — a
different instrument wearing the same name, which this repo has a landmine about. The mean column
is in §1.1's source data (`closure.mean`) and tells the same story: nest **41.4**, vue-core **28.2**
against hono's 17.2 and hugo's 19.8, so a 1.6–2.4× spread cannot explain a 62× difference in taint.
The refutation stands under either instrument; the first draft quoted only the one that made it
starkest.)*

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

- **Group A — resolver work buys nothing.** typeorm, excalidraw and vue-core are three of the four
  worst-starved repos in the survey, and every resolver fix combined frees **12 subjects between
  them** (5 + 6 + 1) out of 2,529 tainted.

  Two of the three are unfixable by cause: typeorm's taint is `computed` (`require(<expression>)`,
  99.6%) and vue-core's is `missingFromTree` (`./dist/*` build output, 99.1%), and resolving either
  needs running the code or building it — both barred by pillar 6. **excalidraw is not**: its
  joint-largest class is `siblingManifestDep` at 98.2% (a hoisted monorepo dependency declared in a
  sibling package's manifest), which is fixable in principle. It is in Group A anyway, and for the
  reason this section exists — **overdetermination**. Fixing it frees **3 subjects**, because
  `computed` poisons 98.2% of the same set. An earlier draft wrote "the two classes a resolver
  structurally cannot address" over all three repos, which is a claim about *causes* standing in for
  a measurement about *marginal value*, and it is false of excalidraw.
- **Group B — resolver work is large.** rxjs 43.1%, express 47.2%, apollo-client 55.2%, nest 75.2%
  of *all* their blast subjects.

The last column says the opposite of what an earlier draft claimed for it, and says something more
useful: **perfect resolution frees every tainted subject on every repo, tautologically** — it is the
definition, not a finding. The point is that it **cannot be built**, because the causes it would have
to remove are `require(<expression>)` (needs running the code) and `./dist/*` (needs building it),
both barred by pillar 6. What *is* buildable is the second-to-last column, and on typeorm,
excalidraw and vue-core it is **0.2%, 1.3% and 0.4%**.

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
| typeorm | `./index.js` — a build artifact at the repo root, untracked and absent from a clean clone | **true** |

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

### 3.2 Built, measured on all 19 repos, reverted

Three resolver changes were implemented together, because §2 found three fixable causes and
measuring one at a time would price each against a baseline the others had already moved (the
landmine ADR-0019's counterfactual table hit): workspace resolution as above, the `dottedSegment`
extension append, and the `rootSelfPath` leading slash.

**What the counterfactual holds fixed**: the same 19 pinned commits, the same deck cap, the same
generator, the same gate, the same everything downstream of resolution. One knob — `resolve.ts` and
the config index feeding it.

*(“Boards” below is a **count**. Ark's decks are re-rolled by any change to the graph, so an
unchanged count is not an unchanged deck: comparing challenge ids, **86 boards disappear** across the
ten atlases — 26 on apollo-client, 25 on hono, 21 on rxjs, 13 on prometheus, 1 on kysely. hono's
count is identical and **46% of its Blast Radius deck is about different subjects**. "0 lost" in the
first draft was `Σ max(0, −Δcount)` per repo, which is a different quantity and was quoted as if it
were board identity.)*

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
| hono, ark, graphql-js, hugo, prometheus, webpack, cobra, django, flask, system-design-primer | ≤ +0.7 | ≤ ±0.31 | unchanged | — |

**+250 blast boards, net.** All suites green, determinism byte-identical.

### 3.2.1 The taint-share column is computed over a denominator that moved, and two reviewers caught it

Resolving specifiers creates edges, and an edge gives a previously-dependentless node its first
dependent — so it becomes a **blast subject**. The population is not held fixed, which the column
above does not say:

| repo | blast subjects A → B | **tainted subjects A → B** | share as reported |
|---|---|---|---|
| **nest** | 286 → **1,168** (4.1×) | **249 → 822** | 87.1% → 70.4% |
| rxjs | 295 → 372 | 141 → **70** | 47.8% → 18.8% |
| apollo-client | 348 → 382 | 217 → **64** | 62.4% → 16.8% |
| kysely | 331 → 345 | 12 → 25 | 3.6% → 7.2% |
| typeorm | 2,221 → 2,248 | 1,921 → 1,945 | 86.5% → 86.5% |
| excalidraw | 479 → 499 | 388 → 406 | 81.0% → 81.4% |

**nest's "87.1% → 70.4%" is 249 → 822 tainted subjects**: the absolute count guardrail 4 refuses
*rose by 573*, reported as a 16.7-point fall. rxjs and apollo-client improve on both instruments and
are unaffected by the correction; nest, kysely, typeorm and excalidraw do not.

**The board counts are unaffected** — they are absolute outputs of the generator, and +250 is +250.
It is the *share* column that has two populations in it.

### 3.3 Does it ship a wrong answer key? Measured from outside the atlas — no

`scripts/probe-wrongkey.ts`. ADR-0026 §4.1's rule applies: an atlas-derived check structurally
cannot see a missing edge, so the only atlas input is the board itself (subject, candidates, truth)
and each node's path. Everything else is the file text and the filesystem, read with the probe's
**own** regex lexer rather than `scan.ts`, because ADR-0028 §8.1's defect survived two instruments
that shared one blindness.

**The gate, and its reach.** `--plant` moves one member of each board's key into the distractor set;
the probe catches **20 of ark's 40 boards and 28 of hono's 54**. It fires — but the denominators are
the finding, and the first draft printed only the numerators.

The probe matches a specifier that **names the subject's own path**, so it detects *direct*
importers only, while the answer key is the *transitive* dependent set. Measured share of truth
members that are direct importers: **hugo 12%, kysely 17%, prometheus 31%, hono 32%, ark 41%,
webpack 74%**. And it skips non-relative specifiers entirely, which is the whole class candidate A
creates: against every internal edge in the atlas, its lexer cannot see **64% of apollo-client's,
63% of rxjs's and 63% of express's** — the three repos the +250 boards are on.

**So the honest claim is narrower than the first draft's.** Not *"zero wrong answer keys"* but
**zero directly-visible wrong answer keys**, on an instrument blind to most of the transitive
relation and to the specifier form the fix introduces. It is a real regression detector and a weak
safety proof, and the difference matters because §3's whole safety argument rested on it.

| | wrong-answer slots | **violations** |
|---|---|---|
| original resolver, 15 repos | 42,585 | **0** |
| **with all three fixes, 15 repos** | **46,099** | **0** |

So the change adds 3,514 wrong-answer slots and **zero directly-visible** wrong answer keys. Both
rows are 0, so the change introduces none *by this instrument*; neither row certifies the transitive
half.

**A second direction is unchecked entirely.** The probe only asks *is a distractor really a
dependent?* It never asks *is a truth member really a dependent?* — and candidate A's second and
third arms (`D/S`, `D/src/S`) are heuristics rather than resolution rules that invent **1,509 edges
on rxjs and 493 on nest**, every one of which feeds a `truth` set. Nothing here checks them. A
reviewer did check the shape by hand across eight repos and found the patch removes 0 edges,
downgrades 0 `certain` edges to `probable`, and mis-targets none it inspected — but that is an
inspection, not a measurement, and it is the gap decision 5 has to be read against.

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

The mechanism is the one §2's counterfactual could not model: **resolving a specifier does not delete
it, it turns it into an edge** — and an edge carries taint *out of its target's closure* into the
importer. §2 withheld sites without adding the edges they would become, so **every figure in §2.3 is
an upper bound**, and on the repos where the newly-reachable code is itself unsound the realised
value is zero. That is exactly express: all 17 subjects `probe-marginal` frees gain an edge to
`index.js`, which is itself unsound, so 17 of 17 are still tainted in B.

**The three *other* rises have a different cause, and a reviewer separated them.** Diffing the
subject sets by path across A and B: on kysely, excalidraw, prometheus and express, **not one
existing subject became tainted** — kysely's 3.6% → 7.2% is 13 new tainted subjects among 14 *new*
subjects, with zero degradations. Those rises are §3.2.1's denominator arithmetic, not taint
propagation. One sentence was explaining two phenomena; the upper-bound rule survives on express,
which is where it was derived, and the evidence offered for the *rises* showed something else.

That is also why apollo-client and rxjs land exactly on their caps (108 and 150) rather than above
them: past the cap, more supply buys nothing at all.

### 3.5 What it is worth

Three repos of nineteen move. **One of them is the worst-starved repo in the corpus** — nest goes
7 → 120 boards, the largest single gain in the table — while typeorm, excalidraw and vue-core gain
0, 0 and 0, exactly as §2 predicted and for the reason §2 gave.

*(An earlier draft said "none of them is one of the three worst-starved", which was true only of a
trio picked after the argument and excluding nest. §1.3 has the correction.)*

So the candidate is real, it is safe as far as §3.3's instrument reaches, and it is **not a general
answer to the starvation question** — it is a monorepo-resolution fix that happens to rescue one
badly-starved monorepo completely and leaves three others untouched.

---

## 3.6 What shipped, and the two defects closed first

The owner accepted candidate A on 2026-08-14. The patch was **not** shipped as measured — a reviewer
found two defects inside it, both of them ADR-0026's *a path prefix and a node key are not the same
string*, and both are closed:

- **The fallback arms were dead for a manifest at the repository root.** `` `${pkg.dir}/src` `` is
  `/src` when `pkg.dir` is `''`, and `normalizeJoin` keeps the leading empty segment, so every
  candidate began with a slash no node key can match. **8 of the 12 corpus repos with a root
  manifest self-import their own name**, which is exactly that shape. There is a `joinDir` helper
  now, and §3.1's *"via `D/src/S`"* column could not have been reproduced by the patch as written.
- **A declared-but-unresolvable `exports` subpath fell through to the package directory** — which at
  a root manifest is the repository root. A package mapping `./utils` to a build artifact compiled
  from `src/utils.ts`, with a root-level `utils.ts` decoy present, resolved to **the decoy**,
  `certain`. Under ADR-0008's invariant that is a wrong answer key. Fixture-proven, corpus-clean, and
  now barred by construction: a subpath the package *declared* falls back only to the source mirror
  `<dir>/src/<rest>`, never to `<dir>/<rest>`.

The three arms and the gaps between them are in `resolve.ts`'s comment; **the gaps are the safety
argument**, so four mutants exercise them — including one that restores the original patch's
two-arm loop, which fails two assertions.

**Closing the dead arm made the change better, not merely safer**: typeorm's resolution goes
97.6% → **99.6%** (it read 97.9% with the arm dead), graphql-js 96.1% → **99.8%**, and kysely's
subject-taint share now **falls** 3.6% → 2.0% where the first measurement had it rising to 7.2%.
Board counts are unchanged at **+250** — apollo-client 46 → 108, nest 7 → 120, rxjs 75 → 150.

**And §3.3's probe was widened before being believed a second time.** It skipped every non-relative
specifier, which is *the whole form* this change resolves — blind to 62–64% of the dependency
relation on the three repos that move. It now resolves workspace specifiers through the same package
map. The plant gate is much stronger for it: **127 plants caught on 111 of rxjs's boards and 85 on
84 of nest's**, where the narrow probe caught **none** on either. Re-run against the shipped
resolver: **0 violations across 15 repos and 46,067 wrong-answer slots.**

889 unit, 116 atlas, determinism byte-identical, budgets within ceiling.

---

## 4. Candidate B — taint that stops at the first unresolved edge. **Refused.**

ADR-0003 refuses a board when any candidate **or anything on its outgoing side** carries an
unresolved import. Candidate B keeps only the candidate's own imports (depth 0). It is by far the
largest lever available.

### 4.1 The ceiling is enormous

`scripts/probe-shallowtaint.ts`, recomputing the taint walk at bounded depths on the shipped atlases:

| repo | blast subjects | tainted ∞ (today) | tainted d=3 | tainted d=1 | tainted d=0 | **subjects unlocked at d=0** |
|---|---|---|---|---|---|---|
| typeorm | 2,221 | 1,921 | 1,851 | 82 | 19 | **1,902** |
| django | 981 | 821 | 819 | 279 | 51 | **770** |
| excalidraw | 479 | 388 | 386 | 191 | 30 | **358** |
| vue-core | 254 | 220 | 220 | 191 | 14 | **206** |
| rxjs | 295 | 141 | 141 | 121 | 34 | **107** |
| nest | 286 | 249 | 249 | 237 | 181 | **68** |
| prometheus | 288 | 57 | 44 | 25 | 14 | **43** |
| apollo-client | 348 | 217 | 217 | 211 | 170 | **47** |
| flask | 32 | 30 | 30 | 17 | 8 | **22** |
| hono / ark / graphql-js / kysely | | 3 / 0 / 2 / 12 | | | | **2 / 0 / 0 / 1** |

typeorm alone gains more subjects than §3's fix gains boards across the whole corpus. **Note that
`d=3` buys almost nothing** — 1,921 → 1,851 on typeorm, and **no change at all on nine of the thirteen rows**. The taint is not
deep, it is *central*, which is §2's finding arriving from the other side: a bound only helps if it
cuts below the hub, and the hub is one or two hops from everything.

### 4.2 The cost, measured from outside the atlas

The fear ADR-0003 states is *"a candidate we are presenting as a distractor might reach the subject
through an import we could not resolve."* That cannot be checked against the atlas that has the
missing edge (ADR-0026 §4.1), so `scripts/probe-shallowcost.ts` compares **two atlases built from
the same source at the same commit**: A, the shipped resolver; B, the shipped resolver plus §3's
three fixes, which cut the unresolved sites on three of these repos by 96.8% / 97.5% / 98.0% (apollo-client 1,227 → 39, nest 2,523 → 63, rxjs 1,774 → 35).

A node in `dependents_B(S) \ dependents_A(S)` is a **real dependent of S that A's graph cannot see**.
ADR-0008's invariant is computed on A, so A does not put it in `truth` and the distractor generator
is free to offer it as a wrong answer. B proves it is a dependent without any appeal to A.

**The gate**: `--plant` deletes every 20th edge from A, making dependents invisible by construction.
It finds 6,257 on apollo-client, 9,802 on nest, 5,058 on excalidraw. The probe fires.

| repo | subjects d=0 unlocks | **with an invisible real dependent** | invisible slots | **mean share of the wrong-answer pool that really depends on the subject** |
|---|---|---|---|---|
| **nest** | 68 | **67 (99%)** | 8,439 | 7.8% |
| **rxjs** | 107 | **99 (93%)** | 3,184 | 2.7% |
| **excalidraw** | 358 | **321 (90%)** | 1,450 | 1.3% |
| **express** | 3 | **2 (67%)** | 226 | **80.4%** |
| **apollo-client** | 47 | **22 (47%)** | 7,159 | **38.1%** |
| vue-core | 206 | 65 (32%) | 65 | 0.2% |
| prometheus | 43 | 7 (16%) | 448 | 13.0% |
| typeorm | 1,902 | 293 (15%) | 349 | 0.1% |
| kysely / hono | 1 / 2 | 0 / 0 | 0 / 0 | 0.0% |

**Any wrong answer key refuses the option.** On the repos where the instrument can see, a large
share of the subjects candidate B unlocks have at least one real dependent sitting in the pool the
board would draw wrong answers from.

**The headline figures above are an upper bound, and a post-draft review measured the corrected
ones.** The probe applies candidate B's own rule to the *subject* and to nothing else: an invisible
dependent usually **carries the newly-resolved specifier itself**, so it is unsound in A and
candidate B would refuse to offer it. Filtering the pool to nodes candidate B could actually place —
eligible under `canGradeImports`, and not themselves unsound:

| repo | subjects with an invisible real dependent, **unfiltered** | **corrected** | invisible slots, unfiltered → **corrected** |
|---|---|---|---|
| nest | 67 (99%) | **30 (44%)** | 8,439 → **452** |
| apollo-client | 22 (47%) | **18 (38%)** | 7,159 → **767** |
| rxjs | 99 (93%) | **7 (7%)** | 3,184 → **39** |
| excalidraw | 321 (90%) | **1 (0.3%)** | 1,450 → **471** |
| express | 2 (67%) | **2 (67%)** | 226 → **34** |
| vue-core | 65 (32%) | **0 (0%)** | 65 → **0** |

apollo-client's `38.1%` pool share likewise counts Markdown, JSON and tainted nodes as eligible
wrong answers; against the real pool it is **16.8%**.

**The refusal stands on the corrected numbers** — nest's 30 subjects and apollo-client's 18 are real
boards that would mark a real dependent wrong, and one is enough under guardrail 4. What does not
stand is *"it is the population"*, which was measured over a population candidate B cannot serve.

`src/link/core/empty.ts` would ship a board with **462** real dependents sitting in its distractor
pool. `packages/common/index.ts` on nest, 466. `packages/excalidraw/drawShapeTrail.ts`, 508.

**Candidate B is refused.** Guardrail 4 is not a preference to be traded against deck size, and here
the trade is not even close: the largest supply win available in this session is also the one that
would put a right answer in the wrong-answer column on nearly every board it creates.

### 4.3 Two things this measurement is not

- **It is a lower bound, and typeorm's 15% is the proof.** B still cannot resolve
  `require(<expression>)`, which is typeorm's entire story (§2.1) — so on the repo with the biggest
  ceiling the instrument is nearly blind. Read that row as *"B could not see many"*, never as
  *"there are few"*.
- **A pool is not a board.** These counts are eligible wrong-answer *slots*, not boards that would
  ship one; a board draws exactly 20 candidates, of which 14–18 are wrong-answer slots. That is what the last column exists to convert, and at
  38.1% and 80.4% a 19-slot draw is overwhelmingly likely to contain one. At excalidraw's 1.3% it is
  not — but 321 of its 358 unlocked subjects still have the exposure, so the deck-wide expectation is
  still many boards.

---

## 5. Candidate C — bounded-depth truth. **Refused on arithmetic, and nothing was built.**

ADR-0008 chose unbounded truth deliberately and named the defect a bound reintroduces: at
`n = maxDepth`, §8.3's *"distance n±1"* distractor is a **real dependent presented as a wrong
answer**. That objection is checkable straight off the shipped atlases — for a bound `d`, everything
in `dependents(S, ∞) \ dependents(S, d)` becomes eligible as a distractor while genuinely depending
on the subject. `scripts/probe-bounded.ts`:

| repo | blast subjects | subjects where d=2 ≠ ∞ | **d=3** | d=4 | **real dependents beyond d=3** | worst subject |
|---|---|---|---|---|---|---|
| ark | 88 | 46 | **15** | 1 | **280** | `src/verbs/rank.ts` (48) |
| hono | 218 | 86 | **72** | 54 | **2,086** | `src/utils/crypto.ts` (180) |
| kysely | 331 | 250 | **239** | 237 | **17,834** | `src/operation-node/common-table-expression-name-node.ts` (126) |
| graphql-js | 220 | 149 | **133** | 75 | **9,146** | `src/utilities/astFromValue.ts` (199) |
| apollo-client | 348 | 101 | **36** | 6 | **76** | `src/core/QueryInfo.ts` (8) |
| rxjs | 295 | 96 | **56** | 34 | **203** | `packages/rxjs/src/util/ctor-helpers.ts` (13) |
| nest | 286 | 249 | **244** | 241 | **52,204** | `packages/common/file-stream/interfaces/index.ts` (784) |
| excalidraw | 479 | 436 | **415** | 398 | **126,912** | `.../TTDDialog/mermaid-lang-lite.ts` (504) |
| typeorm | 2,221 | 596 | **521** | 405 | **542,282** | `src/persistence/SubjectTopologicalSorter.ts` (2,980) |
| vue-core | 254 | 172 | **142** | 97 | **5,181** | `.../compat/instanceChildren.ts` (136) |
| prometheus | 288 | 231 | **181** | 148 | **1,987** | `web/ui/react-app/src/pages/graph/ColorPool.ts` (46) |
| date-fns | 1,258 | 292 | **91** | 68 | **1,295** | `pkgs/core/src/constructFrom/index.ts` (114) |
| hugo | 197 | 179 | **177** | 171 | **8,396** | `resources/resource_transformers/cssjs` (137) |
| webpack | 4,250 | 891 | **730** | 687 | **354,170** | `lib/logging/truncateArgs.js` (565) |

**The column is (subject, dependent) *pairs*, not nodes**, and the first draft quoted it as nodes —
typeorm has 3,704 nodes and cannot have 542,282 dependents. ark's row proves it by eye: **280**
against 226 nodes. Read correctly: a d=3 bound would create **542,282 eligible wrong-answer slots
across typeorm's subjects**, 354,170 across webpack's, 126,912 across excalidraw's.

Restricted further to subjects that actually **ship a board today** — the only ones a player meets —
it is **29,840 on typeorm, 31,978 on webpack, 4,988 on excalidraw, 378 on nest, 100 on ark**. Those
are the reachable figures and they are still decisive; the unrestricted ones are 18× and 138× larger.

`SubjectTopologicalSorter.ts` alone has **2,980** dependents past hop 3. On hugo and excalidraw,
**90% and 87% of subjects** have a bounded truth set that differs from the real one. Candidate C is
dead, it cost twenty minutes, and no code was written.

### 5.1 ADR-0008's *supporting* measurement has gone stale, and it is now false on ark itself

That ADR recorded *"on this repo depth-3 truth equals unbounded truth for **every** node"*, measured
on a 69-node atlas. On ark at `9b86d12b` — 226 nodes — **15 of 88 subjects differ at d=3**, and 280
real dependents sit beyond the bound.

The decision is unaffected and is in fact **more** justified than when it was taken: the ADR chose
unbounded truth *anyway*, calling the bound a landmine that "protected nothing". The stale half is
the reassurance, not the reasoning.

**And the charge is narrower than an earlier draft of this section made it.** That draft said the
sentence "reads as a general property of import graphs"; it does not — ADR-0008 scopes it *"on this
repo"* in as many words, NORTH-STAR §6.1's amendment repeats the scope, and the quotation four lines
above carries it. What went stale is a figure about **one repo, on that same repo**, five milestones
later. That is `CLAUDE.md`'s measured-constant landmine in its least harmful form, and worth
recording precisely because nothing was wrong with how it was written down. *(The Progress table at
the top of this document quoted the sentence with `on this repo` trimmed out, which is what made the
stronger charge look supportable — the trimming was the error, not the ADR.)*

## 6. The null option, priced

If nothing changes, this is what the product is, over the 19 repositories measured:

| what a player gets | repos | share |
|---|---|---|
| **Four verbs, Blast Radius fully supplied** (the cap is what bounds it) | 8 — ark, hono, kysely, graphql-js, date-fns, hugo, prometheus, webpack | **42%** |
| **Three history verbs plus a thin Blast Radius deck** (2.4%–25.4% of subjects) | 7 — rxjs, apollo-client, express, excalidraw, typeorm, vue-core, nest | **37%** |
| **Three history verbs, no Blast Radius at all** | 3 Python — django, flask, system-design-primer | **16%** |
| **Nothing to predict** (two packages, one edge) | 1 — cobra | **5%** |

So **Blast Radius — NORTH-STAR §6.1's v1 verb, the one M2's kill point is about — is fully supplied
on fewer than half the repositories in this corpus**, and on 21% it does not exist.

The three git-graded verbs are unaffected on almost all of them (§1.5). The product on a majority of
real repositories is *already* a history product; what is missing is any document that says so. Every
one of `README.md`'s four ✅ verb rows, the deployed player's own map, and NORTH-STAR §6.1's framing
of Blast Radius as **the** v1 verb describe the 42%.

---

## 7. Two smaller findings — both fixed, and these are the only `src/` changes in this ADR

### 7.1 Indexing a subdirectory silently kept zero commits

Point the CLI at `packages/rxjs/src` of the rxjs monorepo and it reports `history 0/5976`. All three
git-graded verbs ship nothing; the atlas carries **1 challenge**.

**The cause.** `git log` runs with `cwd` set to the directory being indexed, but reports paths
relative to the **repository** root regardless. So every commit's file list reads
`packages/rxjs/src/every.ts` while every node is keyed `every.ts`, no commit intersects any node,
and `commits.ts` drops all of them for `touched.size === 0`. The one signal is a truncation line
saying `commits: kept 0, dropped 5976`, which reads as a budget cap rather than as a defect.

This is ADR-0026's cobra defect a third time — *a path prefix and a node key are not the same
string* — this time between git and the walk rather than inside either.

**The fix** is `--relative`, which makes diff output relative to `cwd` *and* drops files outside it:
both halves of what a subtree index needs, in one flag.

| `packages/rxjs/src` of rxjs `54796b38` | before | after |
|---|---|---|
| commits retained | **0** / 5,976 | **244** / 5,976 |
| challenges | **1** | **121** |
| blast / companion / placement / archaeology | 1 / 0 / 0 / 0 | 1 / **40** / **40** / **40** |

### 7.1.1 The first version of this fix shipped a wrong answer key, and a reviewer found it

`--relative` restricts the tree diff to the prefix **before rename detection runs**, so git re-pairs
adds with deletes *inside* the subtree and reports renames the repository does not contain. Measured
on `honojs/hono`: at the root git pairs `src/adapter.ts → deno_dist/helper/adapter/index.ts`; from
`src/` it pairs `adapter.ts → helper/adapter/index.ts` — **a different rename graph**, six pairs on
that one subtree.

`applyRenames` writes those as `lineage: 'certain'`, and it cannot do otherwise: the invented source
path is dead, so `alias.has(from)` is false and the `contested` branch never fires. A synthetic
fixture turns one into a Placement answer key naming a file the commit never touched. `commits.ts`
documents exactly one lineage limit — *"certified against the rename history git detected"* — and
this is outside it, because git **did** detect the rename and `--relative` replaced it.

**The guard is `--no-renames` in a subtree**, so rename detection runs only where git can see the
whole tree. In a subtree a rename reports as delete + add: churn is split across the two paths and
lineage is lost, which is the documented cost of no rename detection and is the **safe** direction —
a missing lineage costs a challenge, an invented one costs trust. It is reported rather than
absorbed: `GitHistory.subtree` is non-null exactly when this happened.

**`--no-renames`, not merely dropping `-M`.** git has detected renames by default since 2.9, so
removing the flag changes nothing: the first version of this guard did that and `hono/src` still
reported **30** rename records. Only `--no-renames` takes it to 0.

A known cost stays on the record: a rename **into** the subtree is an `A` and its lineage is lost —
231 such renames on `rxjs/packages/rxjs/src`, 112 on `apollo-client/src`. That under-counts churn and
`firstSeen`; it invents nothing.

**It is a no-op at a repository root, and that is checked against `master` rather than asserted.**
Atlases for ark, hono, kysely, graphql-js, hugo, prometheus, django and flask hash
**byte-identically** between `origin/master`'s `git.ts` and this branch's — the acceptance test a
frozen layout demands (ADR-0038). Four tests in `tests/atlas/git.test.ts` assert on the **paths** and
the **rename list** rather than on counts; three mutants (drop `--relative`, drop `--no-renames`,
make the subtree guard never fire) each go red.

*(Left alone deliberately: a subdirectory index and a whole-repo index of the same repository share
a `repo.root`, so ADR-0011 keys their saved progress together. That is a real wrinkle, it predates
this change, and deciding it is not this ADR's business.)*

### 7.2 The CLI printed two budgeted measurements and neither ceiling

`atlas 9399.5 KiB in 56400 ms` was the whole story, because the ceilings lived only in
`scripts/budget.ts` — which `src/` cannot import, and which a user of the packaged CLI does not
have. They now live in `src/atlas/budget.ts` and both readers share them, per *never define the
shape twice*.

**What ships is one line: the atlas is over the 5 MiB total.** It is a pure function of bytes, so it
is deterministic, and it is the fact that matters — *the player loads the whole atlas in one
request*. Measured, it fires on **1 of 19** repos (webpack, 9,399.5 KiB) and is silent on the other
eighteen.

**Three richer versions were built first and every one was wrong.** Two reviewers found them, and
the first draft of this section asserted the opposite of the measurement:

- **A per-file *rate* breach**, taking ADR-0038's lesson at face value. The draft said it "fires on
  no repo in this corpus" and used that as the justification for adding an absolute branch. **It
  fires on two** — cobra at 2,801 B/file and flask at 3,200 — because the rate is dominated by fixed
  per-atlas overhead at small `N`. cobra's atlas is **145 KiB, 2.8% of the ceiling**, reported as
  `OVER BUDGET`. That is ADR-0038's error pointed the other way, and the premise the feature was
  designed on was simply false.
- **An index-time verdict.** Not reproducible: express tripped `5.21 ms/file` on a cold run and was
  silent on five afterwards. `scripts/budget.ts` marks `index ms/file` `hard: false` *for exactly
  this reason* — *"a budget that fails at random teaches people to ignore budgets"* — and the first
  version dropped that distinction and printed the same words for both.
- **A second denominator.** `scripts/budget.ts` divides by `atlas.nodes.length` and the CLI divided
  by `Σ fileCount`, so one repo got two rates from two tools (cobra 7,814 vs 2,801 B/file) under a
  comment claiming they shared a rule.

Enforcement stays in `scripts/budget.ts`, which has the scale context and the hard/soft distinction
a one-line CLI verdict cannot carry. Five assertions, and the two that matter are **silences** —
cobra and flask must produce no line.

---

## 8. Decision

**Proposed. Every item below is a recommendation to the owner; §7 is the only `src/` change made.**

1. **The hypothesis holds and the finding is the survey, not a fix.** Blast Radius is fully supplied
   on **8 of 19** repositories, thin on **7** (2.4%–25.4% of subjects), refused by language on **3**
   and empty for want of anything to predict on **1** — two different zeroes, kept apart because a
   count of zero has more than one cause. NORTH-STAR §6.1 calls it *the* v1 verb and `README.md`
   marks it ✅ beside three others; on a majority of real repositories the product is already a
   history product. **The documents should say so.** This is the null result and the main
   deliverable.

2. **Add a taint-limited repository to the reference set.** All four repos this project measures
   itself against — ark, hono, kysely, graphql-js — are cap-limited, as are both of
   `docs/experiments/0001`'s matched pair. Every "the cap is the binding constraint" measurement in
   the repository (ADR-0039's `retain` work, ADR-0040's progression, ADR-0012's dedupe costs) was
   taken where the cap binds. **`typeorm` `df07bf1e` is the recommended addition**: 2,221 blast
   subjects, 58 boards, and the cap 8× away from biting.

3. **Candidate B — taint that stops at the first unresolved edge — is refused.** It has the largest
   ceiling measured tonight (typeorm +1,902 subjects) and ships wrong answer keys on **90–99%** of
   the subjects it unlocks on three repos (§4.2). Guardrail 4 is not tradeable against deck size.

4. **Candidate C — bounded-depth truth — is refused on arithmetic**, at a cost of twenty minutes and
   no code (§5). A d=3 bound makes 542,282 of typeorm's real dependents eligible as wrong answers.
   ADR-0008's decision stands and is better supported than when it was taken; its **supporting**
   figure has gone stale and is now false on ark itself (§5.1).

5. **Candidate A — workspace resolution — ships** (owner's call, 2026-08-14), with the two defects
   a review found inside the patch closed first and the certifying probe widened to see the class it
   creates. See §3.6. **It is a real win on three repos, and its safety was established more weakly
   than the first draft claimed.** +250 boards net, **0 directly-visible
   wrong answer keys** across 46,099 wrong-answer slots, all suites green and determinism
   byte-identical (§3). It moves **3 repos of 19**, one of which is the corpus's worst-starved repo
   (nest, 7 → 120).

   **Read it against three limits before shipping it.** §3.3's probe cannot see 63–64% of the
   dependency relation on exactly those three repos and never checks whether a *truth* member is
   really a dependent; §3.2.1's taint-share improvements are partly a moved denominator, and nest's
   absolute tainted count **rises** 249 → 822; and a reviewer found the patch's third arm is **dead
   for a manifest at the repo root** (`normalizeJoin('/src', …)` builds a leading slash no node key
   can match), which is the `rootSelfPath` defect reappearing inside the patch that fixes it —
   affecting 8 of the 12 corpus repos with a root manifest. The patch is
   `docs/decisions/0042-resolver.patch` as first measured; **§3.6 is what actually shipped**.

   Two of its three parts are plain defects rather than features, and would be the cheaper half to
   take: **`dottedSegment`** (a specifier whose last segment carries an unknown dot-extension never
   has `.ts` appended — 1,942 sites on nest) and **`rootSelfPath`** (a specifier naming the repo root
   builds `/index.ts`, a leading slash no node key can match — 96 sites on express).

6. **Do not use resolution rate, and do not use `rate × mean closure depth` either.** ADR-0024
   decision 4 retired the first; this retires the second. Three of the four worst-starved repos
   resolve above 96% and the fourth at 60.1%; vue-core and nest carry ~87% subject taint at mean
   closures of **28.2 and 41.4** against hono's 17.2. What predicts starvation is **where the
   unresolved sites sit** — typeorm's single `src/platform/PlatformTools.ts` poisons 1,912 of 1,921
   tainted subjects with **one** import site of 13,805.

7. **Before pricing any future resolver work, compute the *marginal* ceiling, and treat it as an
   upper bound.** Taint is overdetermined: a cause can poison 99% of a repo's tainted subjects and be
   worth **zero** because another cause poisons the same set (§2.3). And the marginal figure itself
   over-predicts, because resolving a specifier turns it into an **edge** that carries taint out of
   its target's closure — express was predicted +17 subjects and gained **0 boards** (§3.4).

---

## 9. What would change this

- **Candidate B** would need an instrument showing the invisible-dependent rate is near zero on
  repos that matter. §4.2 measures the opposite, and §4.3 says why its figures are a floor rather
  than a ceiling.
- **Two of candidate A's three movers are bounded by the deck cap**, not by resolution:
  apollo-client and rxjs land exactly **on** their caps (108, 150) afterwards, so raising the cap
  would make the fix worth more than 250 boards. **nest is not** — it lands at 120 against a cap of
  252 and is still 70.4% tainted, so 113 of the 250 boards are supply-bounded and raising the cap
  buys that repo nothing.
- **The three worst-starved repos** would need `require(<expression>)` resolved — which needs
  running the code, barred by pillar 6 — or `./dist/*` build output on the map, which needs a build,
  barred by the same pillar. ADR-0024's *"what would change this"* said the same of Python's
  computed sites, and this is that finding arriving in TypeScript.
- **A per-file escape hatch** — *"this one import is dynamic, treat the rest of the file as known"* —
  is the one lever this session did not price. ADR-0024 already named it and said it *"would need
  its own ADR, because it weakens ADR-0003 at exactly the point ADR-0003 exists."* §2.1 sharpens the
  case for looking: on typeorm it is **one site in one file**.

  **Its marginal value is unmeasured, and decision 7 forbids assuming it.** `PlatformTools.ts` is
  one of two independently-sufficient causes on typeorm — `computed` poisons 99.6% of tainted
  subjects and `dottedSegment` 99.4% — so removing one need not free 1,912 subjects, or any. It is
  also the case §4 just refused in a more general form, so the bar is the same: measure the wrong
  answer keys from outside the atlas first, and expect them.



---

## 10. The other three verbs are not uniformly safe either — Archaeology least of all

Nobody had asked the starvation question of the git-graded verbs. Classifying all four the same way
(*cap-limited* = the deck cap bit; *supply-limited* = it did not):

| verb | cap-limited | **supply-limited** | supply-limited on |
|---|---|---|---|
| Companion | 13 | **6** | cobra, django, flask, nest, system-design-primer, webpack |
| Placement | 11 | **8** | + date-fns, hugo, typeorm |
| **Archaeology** | 9 | **10** | + prometheus, rxjs |
| Blast Radius | 8 | 11 | — |

**Archaeology is supply-limited on 10 of 19 repos, more than Companion's 6** — and on four repos
where Blast Radius is *fully* supplied: hugo ships **23 boards against a cap of 156**, webpack 113
against 1,579, date-fns 71 against 226, prometheus 55 against 63. Its refusals are dominated by
`disclosed` (ADR-0019 decision 7 yielding to Placement) rather than by taint, so it is a different
mechanism from everything else in this document and is not fixed by anything proposed here.

**Companion is the most robust verb in the product**, cap-limited on 13 of 19. §1.5's claim that the
history verbs ship "a full or capped deck" while Blast Radius does not is true of Companion, and
only sometimes true of the other two — it is asserted there over eighteen decks and holds for
fifteen.

*(Measured from the same `_all.json` as §1. A probe defect a reviewer found is fixed in passing:
`probe-supply.ts` read `subjectsConsidered` only, and Placement's report names it
`commitsConsidered` because its subject is a commit (ADR-0018) — so that column read 0 for that verb
on all 19 repos.)*

---

## 12. Five more repositories, and the rule that predicts starvation

Added with reasons stated before any number was taken: **`angular/angular`** (the largest TS monorepo
in common use — does the workspace fix hold at 10× nest?), **`apache/airflow`** (a Python monorepo
with `providers/` packages — Python *and* monorepo, which nothing else in the corpus had),
**`etcd-io/etcd`** (a Go **multi-module** repo, the shape ADR-0026 §4.1's nested-`go.mod` wrong key
came from), **`tokio-rs/tokio`** (Rust — ark reads none of it, so this checks ADR-0025 refuses
cleanly), and **`sveltejs/svelte`** (named in `CLAUDE.md` as the repo whose 4,462 `.svelte` files are
unmapped while it ships anyway).

| repo | sha | nodes | res% | subjects | tainted | boards | cap | verdict |
|---|---|---|---|---|---|---|---|---|
| angular | `d3d3bc62` | 8,394 | 96.7 | 3,275 | **50.4%** | **1,050** | 1,050 | **cap-limited** |
| airflow | `2aef6b1c` | 9,499 | 97.0 | 3,301 | 59.6% | 552 | 1,188 | mixed — see below |
| etcd | `0836b69e` | 278 | **100.0** | 142 | **0.0%** | 40 | 40 | cap-limited |
| svelte | `20b341f1` | 4,060 | 99.1 | 424 | 7.8% | 165 | 508 | nothing to predict |
| tokio | `625954f3` | 30 | — | 0 | — | **0** | 40 | **deck refused** (ADR-0025) |

**The distribution moved**, and the shipped fix moved it as much as the new repos: **12 cap-limited,
5 taint-limited, 2 neither** of 24, against 8 / 7 / 1 of 19 — apollo-client and rxjs crossed from
taint-limited to cap-limited when their workspace specifiers resolved.

### 12.1 Starvation is `(1 − taint) × subjects < cap`, and that is right on 18 of 20

**angular carries 50.4% subject taint and is not starved at all**, because 3,275 subjects leave
**1,625** clean ones against a cap of 1,050. The whole document to this point treats taint share as
the thing to watch; it is not, on its own. What decides is whether the *clean* subjects outnumber
the cap:

| | clean subjects | cap | at cap? |
|---|---|---|---|
| angular | 1,625 | 1,050 | **yes** |
| webpack | 3,503 | 1,579 | yes |
| typeorm | **303** | 463 | no — starved |
| vue-core | **35** | 74 | no — starved |
| excalidraw | **93** | 98 | no — starved |

Applied to all 20 gradeable repos it predicts at-cap correctly on **18**. This is a better instrument
than anything earlier in this document: ADR-0024 decision 4's `rate × depth` and §1.3's *"position,
not rate"* both explain **where** the taint comes from, and neither says **whether a repo will
starve**. This does, from two numbers already in the atlas.

**Both misses are informative and neither is noise.**

- **nest** has 346 clean subjects against a cap of 252 and ships 120. `taintedRefs` marks a node
  tainted when its own dependency closure is unsound, while `isChallengeable` refuses a **board**
  when the subject *or any candidate* is — so a clean subject with a dirty candidate pool is still
  refused (980 `uncertain` against 822 tainted subjects). The rule is a **lower bound on refusals**,
  and the residue is `duplicateKey` (52) and `ctrlF` (16).
- **airflow is the corpus's first genuinely mixed-language repository** — `go, js, json, md, mjs,
  py, ts, tsx` — and **7,729 of its subjects are refused `ungradedLanguage`** while 552 TS/JS boards
  ship. `blastSubjects` counts every node with a dependent; the gradeable subject count is a
  different and smaller number, and no earlier corpus repo forced the distinction. §1.1's
  classification rule cannot express this row, which is why the table above says *mixed* rather than
  picking one of its buckets.

### 12.2 Three confirmations, cheaply

- **`tokio` gets a map and no deck** — 30 nodes, 0 edges, **0 challenges**, `mapped` 0.0%. ADR-0025's
  refusal fires exactly as designed on a language ark cannot read at all, which had never been
  checked on Rust.
- **`etcd` resolves at 100.0% with 0 tainted subjects** across a **multi-module** Go repo, which is
  the shape ADR-0026 §4.1 found two wrong answer keys in on prometheus.
- **`svelte` ships 165 boards at `mapped` 43.7%** — the known gap in `README.md`'s Known gaps,
  reproduced. It is *not* taint-limited: it is refused by `duplicateKey`, which is ADR-0012 saying a
  compiler's generated-looking tree has fewer distinct questions than files.

---

## 13. `npm run check:keys` — the invariant is owned now, and it gates itself

*"Does any board mark a real dependent as a wrong answer"* is worth owning, so §3.3's probe is a
permanent check and **runs in CI on every push**. It is the only check in this repository that reads
the **repository's source** rather than the atlas, which is the one way a *missing* edge can be seen
at all (ADR-0026 §4.1).

**Its design point is the self-gate.** The narrow version of this probe reported a clean `0` on rxjs
and nest while being blind to 63% of their dependency relation — a zero that looked exactly like good
news. So the check **plants first**: one member of each board's key is moved into the distractor set,
and the run **fails** if that catches nothing. Two mutants confirm it — a lexer that matches nothing
and a plant that does not plant both exit 1 with *"the detector is inert, so a clean run would mean
nothing"*, rather than passing.

It also prints its own reach, because the number is the honest qualifier on the zero:

```
check:keys: gate ok — the plant was caught on 21 of 40 board(s) (53%; the rest are
                      transitive-only, which this instrument does not see)
check:keys: ok — 582 wrong-answer slot(s) across 40 board(s), none of which names its subject
```

**What it is not.** It matches a specifier naming the subject's own path, so it sees *direct*
importers, and the share of key members that are direct runs 12% (hugo) to 74% (webpack). It does not
read tsconfig `paths` aliases or `baseUrl`. It is a **regression detector on the classes it covers**,
not a proof of ADR-0008's invariant — and the exit code means only the first.

---

## 11. What the adversarial review changed

Four reviewers were run against the finished draft with the corpus and both atlas sets on disk, each
told to refute rather than confirm. They raised roughly fifty findings and **most reproduced**. The
draft's *machinery* held — §1.1's nineteen rows, §2.1, §2.3, §3.1, §3.2's board counts, §4.1, §5's
full table and §7.1's counts were re-run independently and reproduce to the digit — and the defects
were almost all in **sentences written next to the tables**, which is this repository's most
frequently-repeated failure and the reason the review is worth its cost.

The four that changed a conclusion rather than a number:

1. **A wrong answer key in shipped code.** `--relative` re-runs rename detection inside the prefix,
   inventing renames the repository does not contain and writing them `certain` (§7.1.1). Found by a
   reviewer with a synthetic fixture, confirmed on hono, fixed with `--no-renames`. **This is the
   finding that justifies the whole exercise**: it was in `src/`, all suites were green, and the
   session that wrote it had checked byte-identity at repository roots — which is exactly the case
   the defect does not touch.
2. **The trio named throughout was chosen after the argument.** `nest` is the worst-starved repo in
   the corpus under every metric the document supplies, resolves at 60.1%, and is **75.2% fixable**
   by ordinary resolver work — so §1.3's headline, §2.3's group split and §3.5's "none of the three
   worst-starved" were each wrong, in the direction that made the null result look cleaner. Two
   reviewers found it independently.
3. **§4's headline was measured over a population candidate B cannot serve.** Filtering the pool to
   nodes candidate B could actually place takes 99% / 93% / 90% to **44% / 7% / 0.3%**. The refusal
   survives on 30 and 18 real subjects; *"it is the population"* does not.
4. **The budget feature's justification was false.** *"A rate-only check fires on no repo"* — it
   fires on two, and calls cobra's 145 KiB atlas `OVER BUDGET`. The feature is cut back to the one
   arm that is correct (§7.2).

And the shape worth keeping for next time: **the reviewers' own instruments needed correction too**
— one ran `git log --format='C'`, which git rejects while exiting 128 and printing nothing, so four
"0 invented renames" rows were vacuous until it gated on a known positive. It said so unprompted.
That is the same discipline this document applies to its own probes in §2.2 and §3.3, arriving from
the other side.