# ADR-0024 — A language ships on its deck, not on its map: Go yes at package granularity, Python no for Blast Radius

- **Status**: accepted
- **Date**: 2026-08-09
- **Implements**: `CLAUDE.md` — *"M5 needs a kill-point stated before a parser is written … and be willing to write the ADR that says the language does not ship"*
- **Bears on**: NORTH-STAR §7.2 (language strategy), §13 M5, risk #3, risk #7; ADR-0003 (an unresolved import produces no edge); guardrail 4
- **Code shipped by this ADR**: none. This is a measurement and a decision. No parser was written.

---

## 0. The baseline was stale, and it was the bar M5 was about to be judged against

`README.md` and `CLAUDE.md` both recorded ark at **2.66 edges/node**, and `CLAUDE.md`'s own M5
instruction said to measure a new language *"against ark's 2.66 and hono's 2.51"*. Measured on clean
clones:

| repo | commit | nodes | edges | edges/node |
|---|---|---|---|---|
| ark | `b9f4d33` | 146 | 500 | **3.42** |
| hono | `7075369e` | 425 | 1,067 | **2.51** |

hono reproduces **to the digit**. Ark's 2.66 reproduces **nowhere**:

| commit | nodes | edges | edges/node |
|---|---|---|---|
| `0fac922` — the commit whose CHANGELOG recorded "2.66" | 100 | 257 | 2.5700 |
| `0dd1d96` | 103 | 262 | 2.5437 |
| `5039950` | 105 | 272 | 2.5905 |
| `1e9ad7a` | 105 | 272 | 2.5905 |

Nor is it a different instrument: the denominator that reproduces hono's 2.51 is edges ÷ **all**
nodes, and a code-only denominator reads 3.25 at `0fac922`, not 2.66 either. The figure was drift
from a working tree nobody named — this repo's own landmine about a self-indexing repo's figures,
with the diagnosis only possible *because* the hono half of the same sentence was exact.

The direction matters: the stale figure **understated ark's density by 0.76**, so a new language
scoring 2.7 would have read as "denser than the bootstrap repo" when it is in fact 21% sparser. Both
documents are corrected and stamped.

---

## 1. Context

ADR-0003 turns an unresolved import into **no edge**, and guardrail 4 turns an uncertain cone into
**no challenge**. Compose them and a language whose imports resolve poorly yields a sparse map and an
empty deck **while every suite passes**. `CLAUDE.md` names the shape: *it will not look like a
failure, it will look like a small repo.*

So M5's kill point is not "can we parse it". It is: **does a real repo in this language produce a
deck?**

---

## 2. What was measured, and what the measurement holds fixed

Repos were chosen for representativeness and the reasons written down **before** any number was
taken (scratch `SELECTION.md`, reproduced here). The axis each pair spans is *how imports name their
targets*, because that is what ADR-0003 resolution succeeds or fails at — not size, and explicitly
not import density.

| repo | HEAD | shape | why this one |
|---|---|---|---|
| `pallets/flask` | `6a2f545b` | small library, `src/` layout | relative-import-heavy — the case most like JS, the *optimistic* end |
| `django/django` | `c9eb16a87e` | large framework, 2,928 files | absolute intra-package imports, which have **no JS analogue**; carries the risk #3 payload |
| `spf13/cobra` | `adbc881` | small library, mostly stdlib | the **correctly external** case — measuring only this would say Go fails |
| `gohugoio/hugo` | `44da08608` | large app, deep package tree | full-module-path internal imports — the central Go case |

**What the probe holds fixed** (and each was checked, not assumed):

1. **The walk** — ark's rules plus ecosystem excludes (`__pycache__`, `.venv`, `site-packages`,
   `.tox`, `.mypy_cache`; `vendor/` already excluded; `testdata/` **kept**, being real repo content
   in Go). A walk that pulls in vendored code inflates node count in the flattering direction.
2. **The parse** — **the language's own parser**: Python's `ast`, Go's `go/parser`. This is the most
   important choice in the probe and it is deliberate: it measures the **ceiling**. Tree-sitter
   cannot read an import statement better than the language's own parser does, so a failure here is
   one a parser cannot fix, and a *pass* here is an upper bound M5's real parser would have to earn.
3. **The semantics** — ADR-0003 exactly: internal ⇒ edge; stdlib / declared dependency / URL ⇒
   external, no edge, no risk; anything else ⇒ **unresolved**, tainting the importing file.

**The gates.** *"Any measurement of how well X resolves needs a gate proving it resolved anything."*

- **Liveness**: nothing is reported unless import sites > 0 **and** the AST count agrees with an
  independent crude line-grep within a stated tolerance (the ratio of the smaller to the larger must
  exceed 0.5). Measured: 677 vs 695 (2.6%), 12,000 vs 12,099 (0.8%), 190 vs 200 (**5.0%**), 6,013 vs
  6,151 (2.2%). The gap is multi-line import blocks and specifiers inside strings; the first draft of
  this line said "all within 3%", which cobra is not.
- **Partition**: `internal + external + unresolved == sites`, asserted per repo, plus "no site
  escaped without a verdict". A throwaway probe is not exempt from the invariant it is measuring.
- **Parse failures are counted, never swallowed**: flask 0, django 6 of 2,928, cobra 0, hugo 0.
- **Harness inertness**: the deck numbers in §5 come from ark's *real* generators, via a scratch copy
  of `src/` whose only change replays the probe's resolution instead of calling `scanModule`. With
  the replay switched off that tree produces a **byte-identical** atlas to production on ark
  `b9f4d33`. Everything downstream — history, regions, layout, elevation, all four verbs — is ark's
  own and unmodified.

---

## 3. Resolution outcomes — and both languages pass this

Per import site, the three outcomes the brief demanded be told apart:

| repo | files | sites | internal | external | **unresolved** |
|---|---|---|---|---|---|
| flask | 83 | 677 | 299 (44.2%) | 336 (49.6%) | **42 (6.2%)** |
| django | 2,928 | 12,000 | 8,965 (74.7%) | 2,865 (23.9%) | **170 (1.4%)** |
| cobra | 36 | 190 | 12 (6.3%) | 178 (93.7%) | **0 (0.0%)** |
| hugo | 906 | 6,013 | 2,184 (36.3%) | 3,818 (63.5%) | **11 (0.2%)** |

cobra is the fork the brief warned about, and it resolves it: **6.3% internal is not a scanner
failure**, it is a small library whose imports are 93.7% stdlib. One number could not have told those
apart; three can.

The residue splits into **three** kinds, and none is fixable by a better parser:

| repo | unresolved | internal-but-unrooted | external-but-undeclared | **computed (`import_module(expr)`)** |
|---|---|---|---|---|
| flask | 42 | 17 | 23 | **2** |
| django | 170 | 45 | 118 | **7** |
| hugo | 11 | 0 | 11 | 0 |

**The third column is nine sites across two repos and it is the entire verdict.** §4 explains why;
the counterfactual is in §4.1. The first draft of this ADR listed only two kinds and named them as
the story, which was wrong in the direction that makes the problem look tractable.

- **external-but-undeclared** is Python's *dist name ≠ import name* problem: `PIL`←Pillow,
  `yaml`←PyYAML, `MySQLdb`←mysqlclient, `psycopg2`←psycopg2-binary. There is **no build-free mapping
  from a distribution name to the module names it provides**; JS has one for free because the
  package name *is* the specifier.
- **internal-but-unrooted** is Python's *import roots are a runtime `sys.path` fact*: django's test
  suite is run by a `runtests.py` that inserts `tests/` on the path, so `import admin_scripts.tests`
  is a real in-repo dependency that no manifest declares. Discovering it requires running something,
  which pillar 6 forbids.

hugo's 11 are one declared dependency (`gocloud.dev`) whose `go.mod` line the probe's regex missed —
a probe limitation, not a language one.

**Both are safe under ADR-0003** — that is the ADR working. Both cost coverage, which is §4.

---

## 4. The finding that decides it: taint is transitive, and it multiplies

ADR-0003 refuses a challenge when **any candidate, or anything on its outgoing side**, carries an
unresolved import. That rule is a walk over the transitive dependency closure, so its cost is not the
unresolved *rate* — it is the rate **times the depth of the graph**.

| repo | nodes | edges/node | mean closure | files tainted directly | **files whose closure is tainted** |
|---|---|---|---|---|---|
| ark `b9f4d33` | 146 | 3.42 | 13.7 | 0.0% | **0.0%** |
| hono `7075369e` | 425 | 2.51 | 17.3 | 3.8% | **5.9%** |
| cobra | 53 | 5.38 | 5.4 | 0.0% | **0.0%** |
| hugo | 1,955 | 13.04 | 217.7 | 0.4% | **0.5%** |
| flask | 91 | 2.02 | 16.9 | 25.3% | **85.7%** |
| django | 3,035 | 3.33 | 164.8 | 3.3% | **68.8%** |

**hono and django have almost the same direct taint rate — 3.8% and 3.3% — and amplify by 1.55× and
21×.** The difference is closure depth: django's mean is 164.8 against hono's 17.3. A Python
framework is deep and everything reaches `django.utils`; hono is shallow and modular.

This is the number that decides M5, and it is **not** the resolution rate. It is also the reason this
could not have been settled by reading: nothing about 98.6% resolution predicts a dead deck.

### 4.1 It is not the rate times the depth — it is *where* the taint sits

The paragraph above was the first draft's whole causal story, and a post-ship review showed it is
only half of one. Re-run over the probe's own graph, counting blast-eligible subjects (those with at
least one dependent) whose dependency closure is tainted:

| scenario | flask (30 subjects) | django (974 subjects) |
|---|---|---|
| as measured — every unresolved site taints | 28 (93.3%) | 818 (84.0%) |
| **import roots *and* dist-name mappings both solved perfectly** | 27 (90.0%) | 815 (83.7%) |
| **the computed sites alone** — 2 files here, 7 there | 27 (90.0%) | 815 (83.7%) |

Solving **both** of the problems §3 identifies — the two this document originally offered as the
things that would change the verdict — moves django by **0.3 points**. The killers are the nine
computed `import_module(<expression>)` sites, and they sit at the highest-centrality files in each
repo: `django/conf/__init__.py` (the settings loader, which nearly everything reaches),
`django/core/serializers/__init__.py`, `django/db/migrations/questioner.py`, and flask's `cli.py` and
`helpers.py`.

So the mechanism is sharper than "rate × depth": **one unresolvable import in a file everything
reaches poisons the repo.** 7 sites of 12,000 — 0.06% — taint 83.7% of django's subjects. Rate is
close to irrelevant; **position** is the whole thing. This makes decision 2 *stronger* than the
argument first given for it, and it retires the revisit condition that argument implied.

---

## 5. The deck — `report.unprovableNodes`, from the instrument that decides it

| repo | nodes | blast | companion | placement | archaeology | total | **unprovable** |
|---|---|---|---|---|---|---|---|
| ark `b9f4d33` | 146 | 40 | 40 | 40 | 40 | 160 | 24 (16.4%) |
| hono `7075369e` | 425 | 54 | 54 | 54 | 54 | 216 | 142 (33.4%) |
| cobra | 53 | **2** of 35 | 38 | 40 | 38 | 118 | 6 (11.3%) |
| hugo | 1,955 | **245** of 906 | 245 | 245 | 126 | 861 | 1,169 (59.8%) |
| flask | 91 | **0** of 30 | 38 | 40 | 40 | 118 | 21 (23.1%) |
| django | 3,035 | **16** of 976 | **0** | 274 | 84 | 374 | 2,624 (86.5%) |

- **flask ships zero Blast Radius challenges.** All 30 candidate subjects were refused `uncertain`.
- **django ships 16 of 976**, a 97% refusal rate, at 98.6% resolution.
- cobra's 2-of-35 is a *different* cause and not a language failure: 33 were refused `duplicateKey`,
  because cobra is essentially one flat package where every file has the same dependents. ADR-0012
  reporting "this repo has nothing to predict" is correct behaviour, and it is the same diagnosis
  Promptasy got.
- **django's Companion refusal is about repo age, not language.** django has 34,860 commits against
  `maxCommitsWalked: 20000`, so the walk truncated and absence from the co-change matrix certifies
  nothing. A 34k-commit JS repo would be refused identically. Do not read this row as Python's fault.
- `unprovableNodes` is dominated by the per-verb deck cap on large repos, so django's 86.5% is partly
  a 3,035-node repo meeting a cap sized for a smaller one. The comparison that survives that
  confound is the Blast Radius column.

---

## 6. Two invisible-edge classes, and only one is structural

ADR-0003's safety rests on a sentence that is true of JS and **not** of every language: *an import we
cannot resolve is recorded*. Both languages have dependencies that are not imports at all, so there
is nothing to record and guardrail 4 is blind by construction.

### 6.1 Go: intra-package references — structural, universal, and it produces a wrong answer key

Files in one Go package see each other's package-level identifiers **with no import statement**. So a
file-granularity Go atlas systematically omits every intra-package edge, and `treeSibling` — the
distractor strategy that picks *same-directory files that are not dependents* — picks them as **wrong
answers**.

Measured on hugo's 244 Go Blast Radius boards:

| | count |
|---|---|
| boards offering a same-directory file as a wrong answer | 172 of 244 (70.5%) |
| such distractor slots | 665 (664 of them `.go`) |
| — of which a *different* package (`foo_test`), correctly not a dependency | 68 |
| — same package | 596 |
| — **same package AND the sibling references a package-level identifier the subject declares** | **≤ 71** |
| **boards carrying at least one** | **≤ 46 of 244 (18.9%)** |

**That last row is an upper bound, and it took three tries to stop being wrong.** The count went
153 → 80 → 71, and the *first* correction is the cautionary one: it excluded **method** names (which
live in a receiver type's namespace, not the package's, so `Close`/`Create`/`Write` matched across
unrelated types) and shipped in a paragraph congratulating itself for testing the claim rather than
the wording — while three more false-positive sources sat untouched in the same twelve lines:

- **qualified selectors.** `ast.Inspect` visits both halves of `afero.Fs`, so the `Fs` matched a
  subject declaring `Fs`. That identifier belongs to another package.
- **field names and composite-literal keys.** `name:` in a struct or a literal is not a reference.
- **build-tag variants.** `testenv_unix.go` and `testenv_notunix.go` are mutually exclusive and
  legally declare *the same* package-level names, so the sibling's own declaration matched the
  subject's. This one also **falsifies the premise the fix was argued from** — a package-level
  identifier is *not* unique across a Go package once build constraints are in play.

Closing all three gives 71 slots on 46 boards. It is still an upper bound: a shadowing local needs
`go/types` to rule out, and this does not run the type checker. **The lesson is this repo's own —
*the bug you already fixed is still there, one line down, in the same function* — and it was
committed inside the paragraph proudest of having fixed it.**

Roughly one Go board in five still marks a player wrong for an answer that is right. That is the
outcome guardrail 4 exists to prevent, and no existing check can see it.

### 6.2 Python: modules named by string literals — idiomatic, and repo-dependent

Django's settings, app registry and URL routing name modules as strings. Counting string literals
that name an in-repo module with no corresponding import edge:

| repo | literals | distinct (file → module) pairs | files carrying one | vs. resolved edges |
|---|---|---|---|---|
| django | 1,007 | **562** | 241 of 2,928 (8.2%) | 10,117 |
| flask | 3 | **3** | 3 of 83 (3.6%) | 184 |

This is an **upper bound**: some matches are logger names or settings keys that merely look like
module paths (`django.request` is a logger). The mechanism is nonetheless real —
`django.template.backends.django.DjangoTemplates` appears 54 times and is a genuine dependency.

The asymmetry is the point. **Go's invisible class is structural and universal** — every multi-file
package has it, always, in every Go repo. **Python's is idiomatic and repo-dependent** — 562 on a
plugin-registry framework, 3 on a plain library.

---

## 7. Pricing the Go fix, before declining or accepting it

| model | nodes | edges | edges/node | invisible class |
|---|---|---|---|---|
| file granularity, fan-out (what a naive port gives) | 1,955 | 25,500 | 13.04 | on up to 18.9% of boards |
| **+ intra-package clique edges** | 1,955 | 42,794 | 21.9 | closed |
| **package as the node** | **193** | **1,275** | **6.61** | **cannot exist — the reference is inside a node** |

*(25,500 is the atlas total: 25,486 Go fan-out edges plus the 14 JS edges hugo already had. The
clique row adds 17,294 — the sum over packages of `n·(n−1)` — to that total. hugo's largest package
holds 95 files, which is where most of it comes from.)*

Fan-out is also a budget breach. Ark's own `scripts/budget.ts`, run against the shimmed hugo:

```
warn  index @ real repo    16194 ms  (hugo, 1955 files)    ceiling 10000 ms
```

— 1.6× over, at **less than** the 2,000-file reference scale the ceiling is written for. (A second
run read 19,145 ms; the variance is the container's, the breach is not.) The atlas is 3,804 KiB,
1,993 B/file against a 2,621 B/file ceiling: under, but on a repo of 906 Go files.

**The table changes two knobs between its first and last row**, and says so rather than being quoted
as a clean counterfactual: 13.04 is 25,500 Go edges over **1,955 nodes including 1,049 Markdown**,
while 6.61 is 1,275 Go package edges over **193 Go-only** packages. Held to one knob it is Go-only
**28.13 → 6.61**, or all-node **13.04 → ~1.04**. Package granularity wins under either instrument —
but the printed pair understates the fan-out artifact by 2.2×, and the honest version is the Go-only
row.

Package granularity fixes all three at once — the wrong answer key, the fan-out, and the budget — and
is the only one of the three that makes the map *more* legible rather than less.

**It is a schema change, not a free one.** This document's first draft said `AtlasNode.kind` was
already `'file' | 'dir' | 'symbol'` "so the format anticipated this". That is false:
`src/atlas/schema.ts:92` reads `export type NodeKind = 'file';`. The three-way union is a *comment in
NORTH-STAR §7.1's sketch*, quoted as if it were the code — the "claim about code not checked against
the code" landmine, in a sentence asserting the cost was already paid. Decision 1 therefore requires
`ATLAS_VERSION` to bump with a migration or an explicit reindex error under guardrail 5, which is
what the Consequences section prices as the M5 estimate's largest line item.

---

## 8. The defect that needed no parser at all, and is live on `master`

`README.md`, `CLAUDE.md` and `cli.ts`'s own warning all say a Python or Go repo *"produces a map with
no edges and no questions."* **The second half is false.** Indexed with the production indexer at
`b9f4d33`:

| repo | nodes | composition | edges | **challenges** |
|---|---|---|---|---|
| cobra | 17 | **17 Markdown** | 0 | **48** |
| hugo | 1,049 | **1,016 Markdown**, 23 js, 9 json, 1 mjs | 14 | **144** |
| django | 107 | 55 json, 45 js, 7 md | 4 | **75** |
| flask | 8 | 6 md, 2 json | 0 | **6** |

Not one line of Go or Python is on any of these maps. The three history verbs are graded on git
rather than on imports, so they cheerfully generate a full deck **about the repository's
documentation** — a confident, playable game about a shadow of the repo. `cli.ts`'s
`challenges.length === 0` warning did not fire on any of the four, and could not have, for **two**
independent reasons — each of which decision 3 has to fix.

1. **The predicate is wrong.** It guards `challenges.length === 0`, and hugo's count is 144. "This
   repo produced no questions" and "this repo produced questions about nothing but its documentation"
   are different failures, and only the first has a check.
2. **The branch is on the `play` path only** (`cli.ts:291`, after `serveDirectory`, past the
   `command === 'index'` return at :269). So `ark index` — which is what `npm run index`, the budget
   script and every measurement in this document use — cannot reach it at all.

The warning is not dead code; it is a live guard aimed at the wrong thing and reachable from one of
two commands. Decision 3 should replace the predicate and lift it above the command split, not delete
the branch. Its comment (`cli.ts:292–294`) also still asserts the "no edges and therefore no radius"
claim §8 refutes, and is left in place deliberately: it is production source, and this session
shipped none.

This is the instrument-that-measures-nothing landmine one level up, exactly as the brief predicted,
and it is **not M5 work**: it exists now and is a labelling defect, not a parser gap.

The good news is hiding inside it: **three of four verbs are already language-agnostic.** With real
source on the map, flask ships 118 challenges of which **zero** are Blast Radius, and django 374 of
which **16** are. That is what M5 buys Python — not the import verb, but a true map with the history
deck attached to real code.

---

## Decision

1. **Go ships at M5, at *package* granularity — the node is the directory, not the file.** File
   granularity is refused: it produces a wrong answer key on up to 18.9% of boards (§6.1), a 13.04
   edges/node fan-out artifact, and a budget breach at under reference scale (§7).
2. **Python ships at M5 as a history language, and must not promise Blast Radius.** Resolution is
   fine and the import verb is dead anyway (flask 0/30, django 16/976), for a reason no parser can
   fix (§4). Shipping the map and the three git verbs is worth it; advertising the fourth is not.
3. **No language ships until §8's Markdown-map behaviour is refused or labelled.** A deck generated
   over a repo whose source is entirely absent from the map is worse than no deck, because it reads
   as success. This is the first thing to fix and it is independent of M5.
4. **Resolution rate is not the kill-point metric. `unresolved rate × mean closure depth` is.**
   Record both for every candidate language, against §4's table, and expect the amplification rather
   than the rate to decide. A language that resolves at 98.6% shipped 16 of 976 boards.
5. **Before adding a language, enumerate its dependencies that are not imports.** ADR-0003's safety
   argument assumes every unresolved dependency leaves a specifier behind. Go's intra-package
   references and Python's string-named modules both violate it, and neither is visible to any
   existing test. This question belongs on the checklist beside "does it parse".
6. **Re-measure §4 and §6 per language, never per family.** cobra and hugo are the same language and
   disagree on every headline number; flask and django disagree on direct taint by **22.0** points
   (25.3% against 3.3%) and on closure taint by **16.9** (85.7% against 68.8%). Two repos per
   language is the minimum that would have caught either.

---

## Alternatives rejected

**Ship Go at file granularity and gate the `treeSibling` strategy on same-directory pairs.** Refused
on ADR-0020 grounds — it is a per-row guard, and the *absence* of a same-directory distractor would
itself say "this subject's package has more than one file". **And it would not work anyway**, which
the first draft asserted the opposite of. `treeSibling` is not the only strategy that reaches a
sibling: read off the atlas's own witness tokens, the 665 same-directory wrong-answer slots are
`treeSibling` 389, `graphAdjacent` 129, `nameSimilar` 93, `coChange` 54. **Gating `treeSibling`
leaves 276 of them — 42% — on the boards.** The claim that it "closes the measured leak" was a claim
about a strategy's label rather than about the measured slots, and it flattered the alternative it
was rejecting.

**Add intra-package clique edges.** Sound, and it takes hugo to 42,794 edges and 21.9 edges/node
(§7) — a hairball that fails pillar 4 while doubling an already-breached index budget.

**Relax guardrail 4's transitive walk for Python** (check only the candidate, not its closure). This
is the one change that would revive Python's Blast Radius, and it is refused: ADR-0003's reasoning
that *"a candidate might reach the subject through an import we could not resolve"* is exactly as
true in Python as in JS, and django's 562 string-named module references (§6.2) make it **more**
true, not less. Trading a wrong answer key for a fuller deck is the trade guardrail 4 exists to
refuse.

**Declare Python out of scope entirely.** Rejected on the numbers: flask ships 118 challenges and
76.9% of its nodes provable with Blast Radius dead. The history verbs are the ones NORTH-STAR §5
calls *"disproportionately high-value"*, and they work.

**Wait for tree-sitter before deciding.** The probe used each language's own parser precisely so this
would not be necessary. Tree-sitter cannot resolve a `sys.path` root or a distribution-to-module
mapping, and it cannot see an identifier that is not an import.

---

## Consequences

- M5 is **two decisions, not one**, and its Python half is a smaller product than the roadmap implies.
  NORTH-STAR §13's *"tree-sitter, 3–4 more languages"* should be read as "3–4 more maps", with the
  import verb arriving only for languages whose closure-times-taint number is low.
- Go at package granularity means `AtlasNode.kind = 'dir'` becomes real, which touches node identity
  (ADR-0002), the walk, elevation and every verb that assumes a node is a file. That is the M5
  estimate's largest line item and it was invisible before this measurement.
- §8's defect gets a `README.md` **Known gaps** row with its measurement, per the working agreement,
  whether or not the next session fixes it.
- The probe, its selection rationale and the replay harness are scratch and are **not** committed.
  What is committed is this document and the numbers in it.
- Every figure here names the commit it was measured at. The four probe repos were cloned at HEAD on
  2026-08-09 and their shas are in §2; ark's own figures are from a clean clone of `b9f4d33`, which
  is one commit behind the one carrying this file.

---

## What would change this

- **Go**: nothing about the *language* verdict; the granularity decision would change if a repo were
  found where packages are overwhelmingly single-file, making the fan-out and the invisible class
  both vanish. cobra is nearly that repo and it fails for a different reason (`duplicateKey`).
- **Python**: **not** import roots and distribution-to-module mappings. That was this document's
  first answer and §4.1 measures it as worth **0.3 points** — a future session could spend itself
  building both and revive nothing. The only thing that would change the verdict is resolving a
  computed `import_module(<expression>)` in a high-centrality file, which requires executing the
  module and so is barred by pillar 6 rather than by effort. A cheaper partial: if `django/conf`,
  `django/core/serializers` and flask's `cli.py`/`helpers.py` are the whole story on every Python
  repo — **9 sites across 2 repos is not enough evidence for that** — then a per-file "this one
  import is dynamic, treat the rest of the file as known" escape hatch would be worth pricing. It
  would need its own ADR, because it weakens ADR-0003 at exactly the point ADR-0003 exists.
- **Both**: if `maxCommitsWalked` rises above django's 34,860, its Companion row (§5) becomes
  measurable rather than refused, and the Python history deck gets materially larger.
