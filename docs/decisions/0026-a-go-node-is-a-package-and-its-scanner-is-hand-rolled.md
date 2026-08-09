# ADR-0026 — A Go node is a package, and its scanner is hand-rolled

- **Status**: accepted
- **Date**: 2026-08-09
- **Implements**: [ADR-0024](./0024-a-language-ships-on-its-deck-not-on-its-map.md) decisions 1, 4, 5
  and 6 — *"Go ships at M5, at package granularity"*; NORTH-STAR §13 M5
- **Bears on**: NORTH-STAR §7.2 (language strategy — this **contradicts** its "v2: tree-sitter" for
  Go and says why), §10 (*"ships as `npx ark`, zero install friction"*); ADR-0002 (node identity),
  ADR-0003 (an unresolved import produces no edge), ADR-0013 (elevation), ADR-0025 (the deck refusal);
  guardrails 4 and 5
- **Bumps**: `ATLAS_VERSION` 9 → 10. `NodeKind` gains `dir`, `Lang` gains `go`, `AtlasNode` gains
  `fileCount`, `RepoMeta.fileCount` becomes `nodeCount`. No migration — see §7.
- **Code shipped**: `src/indexer/goscan.ts`, `src/indexer/gomod.ts`, the node-grouping layer in
  `build.ts`, `history.ts`'s node-keyed aggregation, the `SCANNED`/`UNREAD` move, and the coverage
  unit fix.

---

## 0. What this is measured on

| repo | commit | why this one |
|---|---|---|
| `spf13/cobra` | `adbc881` | ADR-0024's **correctly external** case — 93.7% of its imports are stdlib |
| `gohugoio/hugo` | `44da08608` | the central Go case: deep package tree, full-module-path internal imports |
| `prometheus/prometheus` | `5542b00b9` | added here, because ADR-0025 §9.2 named it as the repo sitting inside the band that document called empty |
| `ark` | `837970f2` | the bootstrap fixture — its deck must not move |
| `honojs/hono` | `7075369e` | the third-party TypeScript control — likewise |

Every ark figure is from a clean clone of `837970f2`, which is the commit **before** the one carrying
this file. Ark indexes itself, so a figure taken from a working tree is false the moment it is
committed.

---

## 1. The parser: tree-sitter loses to 200 lines, on a measurement

NORTH-STAR §7.2 says *"v2: tree-sitter. Gives cheap, build-free parsing for ~40 languages."*
ADR-0024 shipped no parser and used each language's **own** parser for its probe, to measure a
ceiling. So the parser question was open, and nobody had measured what tree-sitter costs this repo.

Both instruments were run over the same corpus, with the gate this repo insists on — *a measurement
of "how fast is X" needs a gate proving X happened*: nothing is reported unless both return more than
zero sites, and the two are compared **file by file**.

| instrument | hugo sites | cobra sites | hugo ms, three runs **in run order** | cobra ms | files disagreeing with tree-sitter |
|---|---|---|---|---|---|
| `go/parser` (ADR-0024 §3) | 6,013 | 190 | — | — | — |
| tree-sitter 0.25, WASM grammar | **6,013** | **190** | 1,621 / 1,589 / 1,648 | 162 | — |
| hand-rolled (`goscan.ts`) | **6,013** | **190** | 276 / 247 / 260 | 35 | **0 of 942** |

*(Run order, not sorted — the per-run ratios below pair by run, and a sorted pair of columns would
give three different ones.)*

Three independent instruments agree on the site count **to the digit**, on both repos, and the two
that can be compared per file disagree on **no file at all**. Seventeen adversarial fixtures — the
word inside a line comment, a block comment, an interpreted string, a multi-line raw string, a rune
literal holding a quote, a close paren inside a comment, an identifier prefixed with the keyword —
agree seventeen times.

So the accuracy argument for tree-sitter, on the only thing ark reads out of a Go file, is worth
**zero measured points**. What is left is cost:

- **6.2× slower** on hugo — 1,619 ms mean against 261, per-run ratios 5.88 / 6.43 / 6.33 in the same
  order as the table — plus 16–33 ms to initialise the runtime and load the grammar. hugo's whole
  index has to fit in 10 s (§5).
  *(This document first said 5.9×, which is the **smallest** of the three per-run ratios quoted
  as the headline while the mean sat two lines below it: the lower-bound-as-margin landmine, in the
  paragraph deciding the change. On cobra the ratio is 4.6×.)*
- **The first runtime dependency this project would have.** `package.json` has no `dependencies` key
  at all today; `npm run budget` prints `player runtime deps 0`. Installed, `web-tree-sitter` +
  `tree-sitter-go` is **8.8 MB**; the artefacts actually loaded are **572 KB**. NORTH-STAR §10 sells
  the indexer as `npx ark`, *"zero install friction"*, and that is the budget this would spend.
- **Determinism is a wash, and the honest version is narrower than the question asked.**
  `web-tree-sitter` is pure WASM, so the parse has no platform axis by construction — the native
  `tree-sitter` binding would, and is not what would be used. The residual axis is version
  resolution, pinned by `package-lock.json` exactly as every devDependency already is. **This could
  not be checked on three platforms from one container**, and it is not claimed to have been; what is
  claimed is that WASM removes the axis the three-platform fingerprint job exists to catch.

**Decision 1**: Go's scanner is hand-rolled, 200 lines, in the shape §7.2 says v1's ES-module scanner
already is.

This is a deviation from the north star and it is scoped to **one language**, not to the strategy.
§7.2's case for tree-sitter is *breadth* — one dependency buys forty grammars — and the crossover is
real: a hand-rolled scanner is ~200 lines **per language**, so four languages is 800. What would flip
this is a measurement, not a count: **a language where a hand-rolled scanner disagrees with
tree-sitter on real files.** Go's import grammar is unusually easy (§2); Python's `from . import x`
and its `__init__.py` semantics are not obviously so, and the next language should be scored the same
way before anybody writes its scanner.

### 1.1 Why Go is easy, stated so the next language is not assumed to be

Two properties, and both are the *reason* the numbers above came out level rather than luck:

1. **An import path is always a string literal.** There is no `import(expr)` in Go, so `GoImportRef`
   has no `null` arm — and therefore none of the *computed-specifier* failure that ADR-0024 §4.1
   found poisoning 83.7% of django's subjects from **seven sites**.
2. **Masking Go is unambiguous.** `mask.ts` has a documented landmine about telling a regex from a
   division; Go has no regex literals, so a quote is a quote. The one shape JavaScript does not have
   is the raw string — backticked, no escapes, spans lines — which is why Go gets its own masker
   rather than reusing `mask.ts`.

---

## 2. Mixed granularity, decided field by field

ADR-0024 decision 1 says *the node is the directory*. It does not say what a directory's `region`,
`elevation`, `loc`, `churn` or `originPath` are, and hugo is **906 Go files beside 23 JavaScript
ones** — so one atlas holds both kinds of node and every field needs an answer.

| field | for a Go package | why |
|---|---|---|
| `path` | the directory; `.` at the repo root | the validator refuses an empty path, and `.` is what a person calls it. `spf13/cobra` is exactly this case — one flat package at the root |
| `kind` | `dir` | the discriminator, and the only new arm |
| `fileCount` | `.go` files in it | §3 — a ratio needs both sides in one unit |
| `loc`, `bytes` | sums over the members | |
| `exports` | union of the members' exported package-level declarations | Go's visibility rule is an initial capital, and the package is the namespace |
| `unresolved`, `externals` | unions | guardrail 4 then acts on the package, which is the unit that has dependents |
| `churn`, `authors`, dates | commits touching **any** member — once per commit | a commit touching three files of one package touched that package once. Counting per file would triple a package's churn against a file node's |
| `lineage` | `contested` if **any** member is | the doubt is whether these counts are this node's; one uncertain member makes the sum uncertain |
| `region`, `layout`, `elevation` | unchanged — computed from the node graph | ADR-0013's meaning survives verbatim: *the bit length of the transitive dependent count*, now of packages. One layer up is still twice as depended-upon |

**A non-Go file in a Go directory keeps its own node.** `web/server.go` and `web/client.ts` are two
nodes, `web` and `web/client.ts`. Node paths stay unique because a file path and a directory path can
never collide.

**"A directory is a package" is Go's rule, and ark does not compile, so it was checked rather than
assumed.** Across hugo, cobra and prometheus: **318 directories, 0 with more than one package clause**
(ignoring the `_test` suffix) and **0 `.go` files with no clause at all**. The directory counts —
193, 2, 123 — are the package counts in §5.1 exactly, which is the gate saying this counted what the
indexer grouped. A repo that broke the rule (a `testdata/` fixture, a code sample) would merge two
packages into one node; that is a coarser node, **not a wrong answer key**, because whoever imports
the directory depends on all of it.

**`foo` and its external test package `foo_test` are one node.** They compile together, they move
together in git, and separating them would re-create at file level the distinction package
granularity exists to erase. The consequence is a *self-edge* — `foo_test` imports `foo` — which the
edge loop has always dropped.

### 2.1 Identity across a directory rename, which git does not record

ADR-0002 hashes `originPath`, the earliest path git knows a file by. **git records renames of files,
never of directories**: moving a package is N file renames, and the package has no lineage of its
own to read.

So a `dir` node's origin is the **plurality** of its members' origin directories. That follows the
case that matters (a package moved wholesale) and survives the one that breaks a unanimity rule (a
package moved, then given a new file whose origin is its current path).

**It is a strict majority, and the first draft's plurality decided real identities by coin flip.**
Measured across hugo and prometheus: **316 packages, 69 with a split vote, of which 15 are ties** —
`hugolib/versions` splitting 1–1 between itself and `hugolib/doctree`, `langs` splitting 2–2 with
`helpers`, `promql/promqltest` 2–2 with `promql`. A byte-order tie-break picks one, and **the other
wins the moment either side gains a file**, which changes the node's id and silently drops every pass
the player saved against it — the exact asset ADR-0002 exists to protect. A majority cannot tie. The
cost is 4 packages on hugo losing an inferred origin they should never have had; the survivors are
plainly real moves (`resource` → `resources`, `hugofs/glob` → `hugofs/hglob`, `pkg/rulefmt` →
`model/rulefmt`).

**And the collision must be resolved rather than thrown.** The old loop threw on two nodes proposing
one origin, which was safe while every node was a file — `applyRenames` guarantees two live *files*
never claim one historical path. A package **split** breaks that: carve `pkg/b` out of `pkg/a` and
every one of `pkg/b`'s files traces back to `pkg/a`, which is a live node. That is an ordinary
refactor, and an indexer that throws an exception on it is worse than one that picks. The rule is
ADR-0002's own — first claimant in a fixed order keeps it, the loser keeps its current path — plus
one clause a file node never needed: **a node's own key can never be taken from it**, so a rename can
never steal a live node's identity.

Seven cases, unit-tested: moved wholesale, moved-then-grown, a tie, no-majority, a split, two nodes
tracing to a dead directory, and one node trying to inherit an identity a live node is still using.
The last two exist because their guards' mutants **survived** the first draft of the suite — and a
third guard, a first pass settling self-claims, turned out to be a no-op on every input and is gone.

**How often this fires, since §2.1's first draft claimed it did not.** hugo: 193 packages, 149
unanimous on their own directory, 8 unanimous elsewhere, 36 split. prometheus: 123 packages, 70 / 20
/ 33. After the majority rule, **7 of hugo's and 28 of prometheus's dir nodes ship with an inferred
origin** — so the vote, the tie-break *and* the collision fallback all fired on real repos, dozens of
times. This document first closed §2.1 with *"no Go repo in this set moved a package inside the
retained commit window, so §2.1 is argued from the mechanism rather than from a repo where it
fired."* **That was false, and it was the sentence excusing the machinery from inspection.**

**The residual is stated rather than argued away**: a `dir` node's identity is *inferred* where a
file node's is *recorded*, so it can still move if membership changes enough to shift the majority.
That is a real cost of package granularity, it has no fix short of git recording directory renames,
and it is in `README.md`'s Known gaps.

### 2.2 A Placement answer key names packages, because a commit's file list is projected once

A commit's `files` are node refs. Nothing about that changed; what changed is that the projection
from a repo path to a node ref goes through the same grouping everything else does. A commit touching
`hugolib/site.go` and `hugolib/page.go` names **`hugolib`, once**. That is also what makes the
co-change matrix and the wide-commit cap read in package units, and it is why the aggregation had to
move *inside* `buildHistory` rather than being folded afterwards: churn is not a sum of its members'
churn.

---

## 3. ADR-0025's rule compared a count of nodes with a count of files

`sourceCoverage` weighs `mapped` against `unreadable`. `unreadable` has always been a count of
**files**. `mapped` counted **nodes** — which was exactly right while every node was a file, and is a
category error the moment one is not. On hugo it would have weighed **193 packages** against its
unreadable Shell and C; on a repo with Go packages and unreadable Python it would have compared 193
against 2,928 and refused a deck on a unit mismatch.

The fix is `AtlasNode.fileCount` and `mapped = Σ fileCount over nodes whose lang can import`. It is a
per-node field rather than one integer in `report` for two reasons: a package's `loc` is a sum and
saying so needs the count anyway, and a rule that has to be *remembered* at one call site is the
shape of half this repo's landmines. The validator asserts `kind === 'file' ⇒ fileCount === 1`, which
is what keeps the numerator on a JavaScript repo identical to the old node count — and `tests/atlas/`
asserts on the bootstrap repo that it still is, so grouping TypeScript would go red rather than
moving a deck quietly.

### 3.1 Re-measuring the eleven-repo table, and the proof that most rows cannot move

Adding a language to `SCANNED` moves its files from `unreadable` to `mapped`. That **strictly
increases** the mapped share and **weakly decreases** the unreadable count, so both clauses move the
same way: **no repo can go from shipping to refused.** Only refused → shipping is possible, and only
for a repo containing `.go` files.

| repo | `.go` files | mapped share before | after | verdict before | after |
|---|---|---|---|---|---|
| hugo `44da0860` | 906 | 2.5% | **98.5%** | REFUSE | **ship — 456 challenges** |
| cobra `adbc881` | 36 | 0.0% | **100.0%** | REFUSE | **ship — 59 challenges** |
| prometheus `5542b00b9` | 727 | 25.0% | **98.0%** | ship | ship |
| flask `6a2f545b` | 0 | 0.0% | 0.0% | REFUSE | REFUSE |
| system-design-primer `ae9bbd7` | 0 | 0.0% | 0.0% | REFUSE | REFUSE |
| django `c9eb16a87e` | 0 | 1.5% | 1.5% | REFUSE | REFUSE |
| awesome `7cb5c837` | 0 | 0.0% | 0.0% | ship | ship |
| ark `837970f2`, hono `7075369e` | 0 | 99.2% / 99.7% | unchanged | ship | ship |
| react, next.js, svelte | not re-cloned | 97.0 / 95.7 / 43.7% | ≥ that | ship | ship |

The Go counts are from the clones; the last row is the monotonicity argument rather than a
measurement, and is stated as such — those three ship, and Go can only push them further from
refusal.

**`prometheus/prometheus` is the row worth reading.** ADR-0025 §9.2 recorded it as the mainstream
repo sitting inside the band that document had called empty: 25.0% mapped, shipping *"48 Blast Radius
boards about the React web UI of a Go time-series database."* It now ships **35 of 63** Blast Radius
boards about Go packages, and the Known-gaps row it earned is retired by measurement rather than by
argument.

---

## 4. What the granularity was bought for: the class is unrepresentable, and that is checked

ADR-0024 §6.1's defect: files in one Go package see each other's package-level identifiers **with no
import statement**, so a file-granular atlas has no edge between them and `treeSibling` — *same
directory, not a dependent* — offers one as a wrong answer to the other. Measured there at 665
same-directory distractor slots on 172 of hugo's 244 boards, of which 596 were the same package and
**≤ 71 across ≤ 46 boards (18.9%) were genuinely wrong answer keys.**

Checked rather than assumed, on the shipped indexer:

| | hugo | prometheus | cobra |
|---|---|---|---|
| Blast Radius boards (of which Go) | 156 (153) | 63 (35) | 0 (0) |
| **distractor slots that are the same Go package as the subject** | **0** | **0** | **0** |
| two nodes standing for one package | none | none | none |
| same-*directory* slots (sibling **packages**) | 384 on 104 boards | 293 on 54 boards | 0 |
| ADR-0008's invariant `candidates ∩ dependents(subject, ∞) = truth` — violations | **0** | **0** | **0** |

The zero is by construction — a package is one node, and a board never contains its own subject — and
the construction is what was checked: no directory produced two nodes on any of the three repos. The
384 remaining same-directory slots are **sibling packages**, which are real non-dependents certified
by the same generator invariant as every other wrong answer, and are exactly the §8.3 class that is
supposed to exist.

`tests/atlas/` cannot see any of this, because it indexes ark and ark has no Go in it. The
end-to-end check — real walk, real build, real validator, over a temp Go repo — is
`tests/unit/gopackages.test.ts`, which is in `tests/unit/` only because it runs in 120 ms.

### 4.1 The row above is a tautology, and the instrument that is not found two wrong answer keys

**The same-package row cannot read non-zero.** A package is one node, node paths are unique, and a
board never holds its own subject — so that measurement confirms the construction and nothing more.
It is worth taking (the construction could have failed) and it is worth saying it is not evidence
about anything else. The invariant row above it has the same shape one level up: it compares
candidates against **the atlas's own edges**, so it is structurally blind to a *missing* edge —
which is precisely the class ADR-0024 §6.1 is about.

So the check that is not vacuous reads the repo's **source**: for every Go board, does a candidate
marked *wrong* contain an import naming the subject's package, through any module declared in this
repo? Direct dependence, read off the import block, which is what a player can do.

| | before | after |
|---|---|---|
| hugo, 153 Go boards | 0 | 0 |
| **prometheus, 34 → 35 Go boards** | **2** | **0** |

Both were real. `documentation/examples/remote_storage/go.mod` requires
`github.com/prometheus/prometheus v0.308.1` with **no `replace`**, so an import of
`github.com/prometheus/prometheus/prompb/…` matched the *nearest* module's require list, was called
external, drew no edge — and the package whose `server.go:23` reads
`writev2 "github.com/prometheus/prometheus/prompb/io/prometheus/write/v2"` was certified a
**non-dependent of that very package** and offered as a wrong answer, with a `coChange` witness
whose §8.3 gloss (*co-changes but does not import*) was false of it too.

The fix is that **whose repo a path is in** and **which `go.mod` carries the requires** are different
questions: a specifier under *any* module declared in this repo now resolves against that module,
longest path first, before any require list is consulted. Go's own toolchain is entitled to answer
differently — it would fetch the published v0.308.1 — but pillar 2 is *the repo is the level*, and
ADR-0008's prompt promises dependence *"directly, or through a chain of imports"*.

**None of the three checks ADR-0026 shipped with could have found this**, and that is the lesson
worth keeping: two of them read the atlas, and the defect was a hole in the atlas.

### 4.2 A member the walk could not read leaves its node incomplete

Adding `.go` to `SCANNED` takes it out of the `UNREAD` tally — correct — and means a `.go` file
dropped for **size or a NUL byte** is counted on neither side of ADR-0025's ratio *and* never
scanned. At file granularity that is harmless: it never becomes a node, so nothing can depend on it,
and an import pointing at it already resolves `unresolved` through `onDisk`. A **package** node keeps
existing without it, so its outgoing edges are silently incomplete — a 600 KiB generated `.pb.go`
would make its package a certified non-dependent of everything that file imports.

ADR-0025 §9.3 named this exact direction (*"moving the tally after those checks would make a large Go
file invisible"*) and adding Go to `SCANNED` did it. `WalkResult.dropped` now carries those files
with their language, and `build.ts` marks the owning node `unresolved` so guardrail 4 refuses rather
than guesses. **It fires zero times on the three repos** — their only dropped scannable files are two
hugo testdata fakes and a 10 MB prometheus testdata JSON — and it is fixed anyway, because a
wrong answer key that waits for the first repo with a big generated file is not a hypothetical.

---

## 5. The kill-point metric, recorded as ADR-0024 decision 4 requires

*"Resolution rate is not the kill-point metric. `unresolved rate × mean closure depth` is."*

| repo | import sites | unresolved | rate | mean closure | **packages whose closure is tainted** |
|---|---|---|---|---|---|
| cobra | 190 | **0** | 0.00% | 0.5 | **0 of 2** |
| hugo | 6,013 | **0** | 0.00% | 128.3 | **0 of 193** |
| prometheus | 6,511 | **0** | 0.00% | 24.1 | **0 of 123** |
| *(hono `7075369e`, the TypeScript control)* | 1,202† | 18† | 1.5%† | 19.1 | 25 of 425 (5.9%) |

† **A different instrument, marked rather than blended.** The Go rows are **raw** sites, counted by
running `scanGoModule` over every `.go` file, so they are directly comparable to ADR-0024 §3's
6,013 and 190. hono's are read off `atlas.json`, where `externals` and `unresolved` are **deduped per
node** — so 1,202 is not a site count and the two columns must not be subtracted from each other.
Nothing in the Go verdict rests on it: their unresolved count is **0**, which is a rate of zero under
any denominator.

The product is **0 on all three Go repos**, so guardrail 4 costs Go nothing at all — where it costs
Python its entire import verb (django 84.0% of subjects tainted). The rate is better than ADR-0024's
probe reported (0.2% on hugo, 11 sites): those eleven were `gocloud.dev`, a **real** `go.mod` require
that the probe's regex missed because it only read the block form. `gomod.ts` reads both, and there
is a unit test naming that specific miss.

hono's row reproduces ADR-0024 §4's 5.9% exactly, under the same denominator (all nodes), which is
the gate saying this is the same measurement rather than a new one wearing its name. The mean-closure
figures are **not** comparable to that document's: 128.3 is over 193 packages and its 217.7 was over
1,955 file nodes.

### 5.1 Budget

| | file granularity (ADR-0024 §7) | **package granularity** | ceiling |
|---|---|---|---|
| hugo nodes | 1,955 | **1,242** (193 packages holding 906 files, plus 1,049 terrain) | — |
| hugo edges, all | 25,500 | **1,289** | — |
| hugo edges per node, **all-node** | 13.04 | **1.04** | — |
| hugo edges per node, **Go-only** | 28.13 | **6.61** (1,275 Go edges over 193 packages) | — |
| hugo index time | 16,194 ms | **6,733 ms** | 10,000 ms |
| hugo atlas | 3,804 KiB | **1,337 KiB** | 5,120 KiB |

**Both density rows reproduce ADR-0024 §7 to the digit** — it predicted 193 packages, 1,275 edges,
6.61 Go-only and *"~1.04"* all-node — from the shipped code rather than from a shim. Two rows rather
than one because that section's own correction says so: its printed pair changed two knobs and named
one, and the Go-only row is the honest version.

`prometheus` indexes in ~6.4 s to an 873 KiB atlas. All three Go atlases are **byte-identical across
two runs**.

### 5.2 How often each new branch fires, counted before it was trusted

*"Count how many times a new path fires on a real repo before you write tests around it."* Across
hugo, cobra and prometheus — 3, 1 and 5 `go.mod` files, so the nested-module walk is live:

| branch | hugo | cobra | prometheus |
|---|---|---|---|
| `internal` / `external` | 2,184 / 3,829 | 12 / 178 | 1,726 / 4,785 |
| **root package** (`''` normalised to `.`) | 0 | **11** | 0 |
| **a module of ours other than the nearest** (§4.1) | 0 | 0 | **8** |
| `replace` into the repo | 0 | 0 | 0 |
| no `go.mod` in scope | 0 | 0 | 0 |
| relative or absolute specifier | 0 | 0 | 0 |
| `import "C"` | 0 | 0 | 0 |

Three things follow and all are acted on rather than noted.

**The root-package normalisation is cobra's whole story** — 11 of its 12 internal sites — and fires
nowhere else, which is why the bug it fixes (§2, `asPackage`) was findable only on the smallest repo
in the set.

**The cross-module row is prometheus's, and it is 8 sites** — none of them a `replace`, since no
`go.mod` in either repo has a local one. Eight sites out of 6,511, on one repo of three, and they
carried the wrong answer key in §4.1. The rate says nothing; **position does**, which is ADR-0024
§4.1's own finding arriving from the other direction.

**`import "C"` was deleted, and the other three dead branches were kept.** The cgo case returned
*exactly* what the line below it already returns — `C` has no dot, so Go's own standard-library rule
answers it — so it was a branch that could not change an outcome, which is worse than no branch. The
absolute-path guard looks like the same thing and is not: `/opt/x`'s first path element is **empty**,
hence domain-less, so removing it makes an absolute path read as the standard library. It is a guard
against an invented answer rather than a fallback claiming a behaviour, it is mutation-tested, and it
fires zero times. `replace`-into-repo and no-`go.mod` are likewise unit-tested and unexercised by
these three repos; a pre-modules Go tree would reach the second.

---

## 6. What did *not* move

The bootstrap repo and the third-party control are the alarm on a change this wide, and they are
silent. Indexed from clean clones of ark `837970f2` and hono `7075369e`, old indexer against new:

- **`challenges` byte-identical.** 160 and 216 boards, unchanged.
- **`nodes` byte-identical** once the new `fileCount` field is removed; `edges`, `regions`,
  `history` and `report` byte-identical as they stand.
- Cost of the new field: **+2,273 B (0.72%)** on ark, **+6,207 B (1.01%)** on hono.

---

## Decision

1. **Go's import scanner is hand-rolled, and tree-sitter is refused for Go on a measurement** — same
   site count as `go/parser` and as tree-sitter, zero per-file disagreements across 942 files, 6.2×
   faster, and no runtime dependency (§1). NORTH-STAR §7.2's *"v2: tree-sitter"* stands as the
   *strategy*; what is refused is applying it to a language where it was measured to buy nothing.
   **Score the next language the same way before writing its scanner.**
2. **A Go node is a directory** — `kind: 'dir'`, ADR-0024 decision 1 — and every derived field is a
   fold over its members, including churn, which counts a commit **once** (§2).
3. **A `dir` node's `originPath` is the plurality of its members' origin directories, and a collision
   is resolved rather than thrown** (§2.1). A package split is an ordinary refactor; an indexer that
   raises an exception on one is a bug, not a guard.
4. **Both sides of `sourceCoverage`'s ratio are counts of files.** `AtlasNode.fileCount` carries it
   per node, and the validator pins `kind === 'file' ⇒ fileCount === 1` so a JavaScript repo's
   numerator cannot drift (§3).
5. **A language ships when its wrong-answer classes are checked on real repos, not when it parses.**
   The measurement that mattered here was *same-package distractor slots: 0*, and it was taken on
   three repos rather than argued from the construction that guarantees it (§4).
6. **`repo.fileCount` is renamed `nodeCount`.** The validator has always asserted it against
   `nodes.length`, so the name described the data and not the field; package granularity would have
   made it quietly false.

---

## Alternatives rejected

**Adopt tree-sitter now, for Go and everything after.** The measurement is in §1 and the deciding
column is not speed — it is that ark has **zero** runtime dependencies and sells itself as
`npx ark`. Refusing it costs ~200 lines per language and buys nothing measurable on Go; the
condition that reverses this is written into decision 1 rather than left as taste.

**Keep file granularity and gate `treeSibling` on same-directory pairs.** Refused by ADR-0024's own
alternatives section, and it would not have worked: read off the atlas's witness tokens, only 389 of
hugo's 665 same-directory slots were `treeSibling` — the other 276 came from `graphAdjacent`,
`nameSimilar` and `coChange`. Gating the strategy leaves 42% of the leak on the boards. It is also a
per-row guard, which ADR-0020 forbids.

**Add intra-package clique edges and keep file nodes.** Sound, and it takes hugo to 42,794 edges at
21.9 per node — a hairball that fails pillar 4 while doubling an already-breached index budget.

**Give `report` a single `mappedSourceFiles` integer instead of a per-node `fileCount`.** Cheaper in
bytes and it is a second encoding of something derivable from the nodes, which ADR-0025's own
alternatives section refuses for the deck-refusal flag on exactly this ground. A package's `loc` is a
sum and the file count is what makes that legible anyway.

**Split `foo` and `foo_test` into two nodes.** They are two Go packages by the language's rules, and
ADR-0024 counted 68 of hugo's 665 same-directory slots as that pair. They are also compiled together,
released together and moved together in git — and the relation between them is an **import**, which
names a *directory*, so two nodes sharing one directory would need an edge whose endpoints are not
what a Go import can address. Splitting them buys a distinction the import graph cannot express and
gives it back a same-directory pair to get wrong.

**Treat a Go import we cannot resolve as external.** This is ADR-0003 and it is not reopened. A path
inside the module holding no indexed Go file is *ours and invisible*, which is `unresolved`; the cost
on these three repos is zero sites.

---

## Consequences

- **M5's Go half is done and its Python half is not started.** ADR-0024 decision 2 makes Python a
  *history* language — the map and the three git verbs, never Blast Radius — and that is a separate
  change with a separate measurement. Nothing here touches it.
- **ADR-0025's refusal resolved itself exactly as that document predicted**: cobra and hugo flip to
  shipping the moment Go is on the map. Its Known-gaps row about `prometheus/prometheus` is retired.
  The row about `UNREAD` being a **list** is not, and is untouched by this change.
- **`ATLAS_VERSION` is 10 and every saved atlas is stale.** The validator's "reindex required" error
  is the migration, as with every bump since ADR-0010. Progress in `localStorage` is keyed on the
  repo's root commit and independent of this number (ADR-0011).
- **A second `NodeKind` is now real, and before this change `AtlasNode.kind` had no reader at all
  outside the validator** — grepped, not assumed; it now has one, `cli.ts`'s node line. Nothing in
  `src/verbs/` or `src/player/` asks what kind a node is. That is the seam holding, and it is **not**
  a claim about the *next* kind: `symbol` would change what a node's `path` means, which `paths.ts`,
  the region labeller and every distractor strategy read.
- **The e2e's board-playing step predicted a verb**, and this change re-rolled ark's own deck onto an
  Archaeology board, where it asserted Blast Radius's wording and then hung 30 s on a Submit that was
  correctly disabled. It is fixed to read the verb it was served and to match a board by
  `labelById` — the both-arms map that already existed 300 lines above, and that this step alone did
  not use. Same landmine as the `.first()` one, one map along.
- **The player calls every Go package a "file", on every board, and nothing can currently say
  otherwise.** `blastRadius`'s *"Which of these **files** depend on it"*, Companion's *"Which of
  these **files** have changed alongside"*, and every *"You proved N **files**"* are false of all 153
  hugo and 34 prometheus Go boards; cobra additionally renders its root package as `.` in a prompt.
  `Verb.prompt(challenge, labelOf)` is pure over a challenge and a label lookup and has **no atlas**,
  so it cannot tell a package from a file — fixing it is a contract change across four verbs and the
  console, and wording belongs to the verb (ADR-0020), not to the console that would be the cheap
  place to put it. **Deliberately not done here**: it is a labelling defect on correct boards, it is
  measured, and rushing a contract change at the end of the session that shipped the language is how
  the next defect gets in. `README.md` Known gaps carries it. By ADR-0025 decision 5's own standard —
  *"the cost of a wrong name is ark printing a false claim about the reader's own repo"* — it should
  be the next thing fixed after Python.
- The probe scripts, the tree-sitter comparison harness and the measurement scripts are scratch and
  are **not** committed. What is committed is this document, the code, and the tests.

---

## What would change this

- **A language whose hand-rolled scanner disagrees with tree-sitter on real files.** That is the one
  measurement that reverses decision 1, and it has to be taken per language — Go's import grammar has
  no computed specifier and no regex-versus-division ambiguity, and neither property is general.
- **A Go repo whose packages are overwhelmingly single-file.** ADR-0024 named this as the granularity
  decision's only revisit condition; cobra is nearly that repo and ships **2** Go nodes, 1 edge and
  **0** Blast Radius boards, which is the honest reading of a library that is one package rather than
  a failure of the granularity.
- **A `dir` node whose majority moves.** The rule is now measured on real history (§2.1) and the
  residual is structural: 35 packages across two repos carry an *inferred* origin, and a package
  whose membership changes enough to shift the majority changes id and drops its saved passes. A fix
  would need something git does not record.
