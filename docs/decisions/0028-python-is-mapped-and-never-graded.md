# ADR-0028 — Python is mapped and never graded, and its scanner is hand-rolled too

- **Status**: accepted
- **Date**: 2026-08-10
- **Implements**: [ADR-0024](./0024-a-language-ships-on-its-deck-not-on-its-map.md) decisions 2, 4, 5
  and 6 — *"Python ships at M5 as a history language, and must not promise Blast Radius"*;
  [ADR-0026](./0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md) decision 1 — *"score the
  next language the same way before writing its scanner"*; NORTH-STAR §13 M5, §7.2, risk #3
- **Bears on**: ADR-0003 (an unresolved import produces no edge), ADR-0025 (the deck refusal),
  ADR-0027 (the noun a board is asked in); guardrails 4 and 5
- **Bumps**: `ATLAS_VERSION` 10 → 11. `Lang` gains `py`. No new field, no rename — see §7.
- **Code shipped**: `src/indexer/pyscan.ts`, `src/indexer/pyroot.ts`, the `SCANNED`/`UNREAD` move,
  the `canImport` / `canGradeImports` split, and Blast Radius's `ungradedLanguage` refusal.

---

## 0. What this is measured on

| repo | commit | why this one |
|---|---|---|
| `pallets/flask` | `6a2f545b` | ADR-0024's *optimistic* Python end — small, relative-import-heavy, `src/` layout |
| `django/django` | `c9eb16a87e` | the large framework, 2,928 files, absolute intra-package imports, and the repo that carries risk #3's payload |
| `donnemartin/system-design-primer` | `ae9bbd7b` | ADR-0025 §5's *"honest cost"* row — a book with a Python appendix, refused a deck and named as the one row a reasonable person could disagree with |
| `ark` | `abc8549` | the bootstrap fixture — its deck must not move |
| `honojs/hono` `7075369e`, `gohugoio/hugo` `44da08608`, `spf13/cobra` `adbc881`, `prometheus/prometheus` `5542b00b9` | the TypeScript and Go controls — likewise |

Every ark figure is from a clean clone of `abc8549`, the commit **before** the one carrying this
file. Ark indexes itself, so a figure taken from a working tree is false the moment it is committed.

---

## 1. The parser, scored again: tree-sitter loses to 300 lines, and this time it was close to a real test

ADR-0026 decision 1 refused tree-sitter **for Go**, on a measurement, and wrote down what would
reverse it: *"a language where a hand-rolled scanner disagrees with tree-sitter on real files."* It
also named the reason not to inherit the verdict — Go's import grammar has two properties Python's
does not (§1.1 there): an import path is always a string literal, and masking is unambiguous. Python
has `from . import x`, `from ..pkg import y`, parenthesised lists, `\` continuations, four string
prefixes, triple quotes, and **no "imports come first" rule** to bound the scan.

Three instruments over the same corpus, with the gate this repo insists on: nothing is reported
unless every instrument returns more than zero sites, and they are compared **file by file** rather
than by total.

| instrument | flask sites | django sites | flask ms | django ms | files disagreeing with the hand-rolled scanner |
|---|---|---|---|---|---|
| Python's own `ast` (ADR-0024's ceiling) | **675** | 11,991 † | — | — | **0 of 3,005** |
| tree-sitter 0.26, WASM grammar | **675** | **12,052** | 240 | 6,764 | **0 of 3,011** |
| hand-rolled (`pyscan.ts`) | **675** | **12,052** | 52 | 956 | — |

† **`ast` refuses six of django's 2,928 files** — Python 2 fixtures in the test suite — and the 61
sites in them are the whole of the 12,052 − 11,991 gap. On the 2,922 it parses it agrees with the
hand-rolled scanner on **every file**. ADR-0024 §3's *"12,000"* for django reconciles exactly:
11,991 statement sites plus the **9** `import_module`/`__import__` call sites §3 counts separately.
flask's 675 + **2** computed sites is that document's 677, to the digit, and the two files are
`cli.py` and `helpers.py` — the two §4.1 names.

So the accuracy argument for tree-sitter is worth **zero measured points on Python too**, and the
cost is the same as it was for Go: **7.1× slower** on django (6,764 ms against 956, against a 10 s
index budget), and the **first runtime dependency** this project would have.

**That table is about import *statements* and nothing else, which §8 shows was load-bearing.** The
other arm — `import_module(…)` and `__import__(…)` **calls** — is compared against no second
instrument at all, because ADR-0024's probe found them with the same regex shape this scanner used.
Two instruments sharing one blindness agree perfectly.

**Decision 1**: Python's scanner is hand-rolled, ~300 lines. The condition that reverses it is
ADR-0026's, unchanged, and it has now failed to be met twice.

### 1.1 Which instrument found which defect, because it is not the one the table implies

The comparison harness needed **three** corrections before it agreed, and the scanner needed **one**.
Every harness bug made *tree-sitter* look wrong:

- the module name leaked into the imported-names list, because `namedChildren` returns fresh node
  objects and an identity comparison against `module_name` never matched (2,126 django files);
- `from __future__ import annotations` has its **own node type** in the grammar (27 flask files);
- and that node spells `__future__` in the grammar rather than in a `module_name` field.

The one real disagreement was found by **`ast`, not by tree-sitter**: django's
`tests/admin_views/test_nav_sidebar.py` imports a model called `Héllo`, and JavaScript's `\w` is
ASCII-only even under `/u`, so the name was dropped in silence. One file in 3,011.

A second defect was found by neither, because **no file in either repo exercises it**: a
backslash-continued `from pkg import \` was read as an import of nothing. It came out of a unit
fixture, and re-running the whole comparison after the fix changed **no** file on either repo. That
is the mirror of this repo's *count how many times a new branch fires* rule — a corpus of 3,011 real
files is not a substitute for adversarial fixtures, in either direction.

---

## 2. What *"the map and not Blast Radius"* means mechanically

ADR-0024 decided the shape and left the mechanism open. There was no concept in this codebase of an
edge that shapes the map and cannot grade a question, and §5 of that document is explicit that what
M5 buys Python is *"a true map with the history deck attached to real code"* — which means layout,
regions and elevation derived from **real imports**.

### 2.1 One predicate answered two questions, and Python is where they come apart

`canImport(lang)` had exactly two readers in production:

| reader | the question it is asking |
|---|---|
| `blastRadius/generate.ts` | *may this node be a Blast Radius subject or a wrong answer?* |
| `coverage.ts` | *is this file **mapped source**?* — the numerator of ADR-0025's ratio |

For TypeScript and for Go those are the same question, which is why one predicate served both for
five milestones without strain. For Python they are opposite answers, and **both wrong answers are
bad in a way that has a name in this repo**:

- Leave `py` out and `mapped` reads **0** on a pure-Python repo. ADR-0025 clause 2 then refuses the
  deck — so flask still ships nothing — and the HUD prints *"None of this repository's 84 source
  files are on this map"* **over a full map of 83 Python files**. That is a false claim about the
  reader's own repo, which is the exact cost ADR-0025 decision 5 exists never to pay and the same
  shape as the noun defect ADR-0027 had just fixed.
- Put `py` in and Blast Radius ships a deck ADR-0024 measured as dead: 0 of 30 boards on flask, 16 of
  976 on django.

So the predicate splits. `IMPORTING_LANGS` keeps its name and its coverage reader and gains `py`;
`GRADED_IMPORT_LANGS` is the strict subset whose import graph may carry an **answer key**.

**It is a rule about a language**, which is the coarsest grain ADR-0020's *withhold by class, never
by row* admits — nothing about which node, which board or which row is consulted. And it gates the
**subject** as well as the candidate pool, before taint is considered, with a refusal reason of its
own (`ungradedLanguage`: 83 on flask, 2,928 on django). Leaving it to guardrail 4 would be an
accident that happens to hold — a Python file whose whole cone resolves *would* ship a board, so
whether the deck existed would depend on how dynamic that particular repo is. The end-to-end test
builds the same 19-file dependency shape twice, once in `.py` and once in `.ts`, and asserts the
TypeScript tree ships boards while the Python one ships none; **the first draft asserted only the
Python half and passed vacuously**, because a five-file fixture has too few candidates to build a
choice set in either language.

`ungradedLanguage` is a reason of its own rather than a fold into `uncertain` for the same
reason `IndexResult.generation` is nullable: *this cone has an unresolved import* and *no repo in
this language ever ships a board* are different facts with different remedies, and reporting them as
one number makes a language's absence read as a property of the repo in front of you. It is also
kept apart from terrain — a `.md` file is still `noDependents`, because nothing imports it, and
folding the two made flask report **91** refusals over 83 Python files.

### 2.2 What a Python repo's map is built from

Everything, and it is the ordinary path: `region`, `layout` and `elevation` are computed from the
node graph, and the node graph now has Python edges in it. Nothing in `regions.ts`, `layout.ts` or
`elevation.ts` changed or needed to.

`pallets/flask` at `6a2f545b`: **91 nodes, 193 edges, 17 regions, 11 peaks** — `src/flask/app` (12),
`src/flask/__init__` (30), `src/flask/globals` (8), `src/flask/cli` (3), `src/flask/helpers` (3),
`src/flask/json` (3), `src/flask/testing` (3), beside the examples and the test tree. The HUD reads
*"1 source file not on this map"* — the repo's one shell script. Rendered and looked at, not inferred
from the atlas: no console errors, and a canvas gate hashing the painted pixels before the claim.

**A Python node is a file**, and no new granularity was opened. Python's unit of import is the
module and a module is a file; `pkg/__init__.py` being the file an import of `pkg` resolves to is a
**resolution** question, answered in `pyroot.ts`, not a granularity one. ADR-0026 is not reopened,
and `memberNoun`'s `(kind, lang)` key needs no new row: a Python node is `kind: 'file'`, so every
board asks in the noun ADR-0027 already had.

---

## 3. Resolution, and the four things `sys.path` makes unknowable

Go's import path *is* a location. Python's is a name resolved against a runtime list. Ark cannot run
anything (pillar 6), so the roots are read off the repo's own layout: **the repo root, every
directory holding a `pyproject.toml`/`setup.py`/`setup.cfg`, and a `src/` beside one when the walk
actually saw Python under it.** flask discovers six — its own, `src`, **three** example projects
carrying their own manifests, and a `src/` beside one of those; django discovers one.

| form | how it resolves | fires on flask / django |
|---|---|---|
| `from . import x`, `from ..a.b import c` | the file's own directory, one level per extra dot | 176 / 1,121 |
| `import a.b`, `from a.b import c` | each root in turn | 499 / 10,933 |
| **`from X import y` where `y` is a submodule** | an edge to `X` **and** one to `X/y` | **16 / 1,490 extra edges** |
| a package with no `__init__.py` (PEP 420) | the module itself draws no edge; its submodules still do | 0 / 0 |
| two roots both answering | `probable`, per ADR-0003 | 0 / 0 |
| a relative import climbing above the repo root | `unresolved` | 0 / 0 |
| `importlib.import_module(…)`, `import_module(…)`, `__import__(…)` | a literal argument resolves; anything else is `unresolved`, always recorded | **2 / 79** (49 computed, 30 literal) |

**The submodule rule is the branch that earns its place** — 1,490 of django's 10,492 internal
resolutions, 14.2%. `from django.db import models` depends on `django/db/__init__.py` *and* on
`django/db/models/__init__.py`, and dropping either is a missing edge, which is the class ADR-0026
§4.1 established no atlas-derived check can see.

**Three branches fire zero times on all three repos and are kept**, on ADR-0026 §5.2's own rule that
a guard against an *invented* answer is not the same thing as a fallback claiming a behaviour. Delete
the multi-root loop and a two-root ambiguity is resolved by picking one arbitrarily; delete the
climb-out guard and `from .... import x` resolves against the repo root. Both invent. The namespace
branch is the one genuinely dead path kept on a different argument: PEP 420 packages are ordinary in
modern Python and both measured repos are old enough to put `__init__.py` everywhere, so the
condition that exercises it is named rather than the branch removed. All three are unit-tested and
mutation-checked.

**Two things stay unresolvable and neither is a parser problem** (ADR-0024 §3, reproduced):

- **`sys.path` roots that exist only at runtime.** django's `runtests.py` inserts `tests/` on the
  path, so `import admin_scripts.tests` is a real in-repo dependency no manifest declares.
- **A distribution name is not a module name.** `MySQLdb`←mysqlclient, `psycopg2`←psycopg2-binary.
  There is no build-free mapping, and these are django's residual by name.

**The standard library is a list, not a rule**, which is the one place Python is structurally worse
than Go: Go reserves domain-less first path elements, Python reserves nothing. `STDLIB` is 306 names
with a list's failure mode (ADR-0025 §9.1), pointed in the safe direction — a name missing from it
becomes `unresolved`, which costs a taint and never an invented edge. Its first draft filtered out
the underscore-prefixed names as private C accelerators and thereby dropped **`__future__`**, so
`from __future__ import annotations` — **27 of flask's 83 files** — was reported as an unresolved
import of an unknown package.

---

## 4. ADR-0024 decision 4's metric, re-measured with the shipped instrument — and the verdict holds *harder*

*"Resolution rate is not the kill-point metric. `unresolved rate × mean closure depth` is."*

| repo | files | sites | internal | external | **unresolved** | rate | mean closure | **blast subjects tainted** |
|---|---|---|---|---|---|---|---|---|
| flask `6a2f545b` | 83 | 677 | 309 | 335 | **33** | **4.87%** | 18.5 | **30 of 32 (93.8%)** |
| django `c9eb16a87e` | 2,928 | 12,061 | 9,002 | 2,951 | **108** | **0.90%** | 165.4 | **819 of 976 (83.9%)** |
| *ADR-0024's probe, for comparison* | 83 / 2,928 | 677 / 12,000 | 299 / 8,965 | 336 / 2,865 | *42 / 170* | *6.2% / 1.4%* | *16.9 / 164.8* | *28 of 30 (93.3%) / 818 of 976 (84.0%)* |

**This is the finding, and it is the strongest form of ADR-0024's argument that has been taken.** The
shipped resolver is **better** than the probe that decided the verdict — django's unresolved rate
falls from 1.4% to **0.90%**, a 99.1% resolution — and the number that decides the deck moves by
**0.1 points**. flask improves from 6.2% to 4.87% and moves by 0.5. Position beats rate, measured
twice, by two instruments that disagree about the rate and agree about the deck.

The structural figures reproduce ADR-0024 §4 to the digit where they can: django 3,035 nodes, **3.35**
edges/node against its 3.33, mean closure **165.4** against 164.8, **976** blast-eligible subjects
against 976. flask's 91 nodes are exact; its mean closure is 18.5 against 16.9 because this resolver
draws the 16 submodule edges the probe did not.

**These are site counts, not the atlas's `unresolved` totals**, which are deduped per node — flask's
33 sites are 28 entries and django's 108 are 108. The two must not be subtracted from one another;
ADR-0026 §5 has the same footnote for the same reason.

---

## 5. The deck, and ADR-0025's eleven-repo table

ADR-0024 §5 predicted what Python would ship, from a shimmed harness. Run through the shipped
indexer:

| repo | nodes | edges | blast | companion | placement | archaeology | **total** | ADR-0024 §5 predicted |
|---|---|---|---|---|---|---|---|---|
| flask | 91 | 193 | **0** | 38 | 40 | 40 | **118** | 0 / 38 / 40 / 40 = **118** |
| django | 3,035 | 10,162 | **0** | 0 | 274 | 84 | **358** | 16 / 0 / 274 / 84 = 374 |
| sdp | 49 | 0 | **0** | 9 | 35 | 13 | **57** | — |

flask reproduces **exactly**; django is that document's 374 minus the 16 Blast Radius boards decision
2 withdraws. django's Companion is 0 for the reason ADR-0024 §5 already recorded and which is **not**
Python's fault: 34,860 commits against `maxCommitsWalked: 20000`, so the walk truncated and absence
from the co-change matrix certifies nothing.

`system-design-primer` has **0 edges** — its map is 26 Python files and 23 Markdown ones, and the
Python is standalone example solutions that import nothing internal — so that is an honest map rather
than a failure. It ships 57 questions
about its own history, and ADR-0025 §5's *"the one row of eleven where a reasonable person could
disagree"* is resolved by the language arriving rather than by anyone changing the rule.

### 5.1 The eleven-repo table, and the proof that most rows cannot move

ADR-0026 §3.1's monotonicity argument holds verbatim and is restated because it is what makes
re-cloning eleven repos unnecessary: adding a language to `SCANNED` moves its files from `unreadable`
to `mapped`, which **strictly increases** the mapped share and **weakly decreases** the unreadable
count. Both of ADR-0025's clauses move the same way, so **no repo can go from shipping to refused**,
and only a repo containing Python can move at all.

| repo | mapped share before | after | verdict before | after |
|---|---|---|---|---|
| flask `6a2f545b` | 0.0% | **98.8%** | REFUSE | **ship — 118 challenges** |
| django `c9eb16a87e` | 1.5% | **99.9%** | REFUSE | **ship — 358 challenges** |
| sdp `ae9bbd7b` | 0.0% | **96.3%** | REFUSE | **ship — 57 challenges** |
| hugo, cobra, prometheus | 98.5 / 100.0 / 98.0% | unchanged | ship | ship |
| ark `abc8549`, hono `7075369e` | 99.1 / 99.7% | unchanged | ship | ship |
| awesome `7cb5c837` | 0.0% | unchanged | ship | ship |
| react, next.js, svelte | 97.0 / 95.7 / 43.7% | ≥ that | ship | ship |

The first three rows are measured; the rest are the monotonicity argument, stated as such. `next.js`
is the only other row with Python in it — ADR-0025 counted **1** file — so its unreadable count falls
by one and it goes on shipping.

**Every repo ADR-0025 refused now ships.** That document withdrew **315 questions across five
repos** — hugo 144, django 75, cobra 48, sdp 42, flask 6 — and predicted the refusal would *"resolve
itself as languages land"*. Go returned two of the five and Python returns the other three, so the
prediction is now closed rather than partially met. It is worth saying what that does **not** mean:
none of those 315 questions came back. They were questions about documentation, and what the five
repos ship instead is 1,048 questions about their source.

---

## 6. Budget: django breaches the index ceiling, and it is not the scanner

| repo | nodes | index | ms/node | ceiling |
|---|---|---|---|---|
| sdp | 49 | 267 ms | 5.4 | — |
| flask | 91 | 659 ms | 7.2 | — |
| hono | 425 | 1,768 ms | 4.2 | — |
| hugo | 1,242 | 6.4–7.8 s | ~5.7 | — |
| **django** | **3,035** | **17.6–18.6 s** | **~5.9** | **10,000 ms** |

**Every figure here is a range, because this container's run-to-run spread on them is ±25%** — three
`buildIndex` runs on django read 17,186 / 17,839 / 17,641 ms, `npm run budget` read 17,645 and
17,706, and one hugo run read 28,927 ms against a 6,786 ms neighbour and is discarded as contention.
Quoting a single one of those as *the* number is how the first draft of this section came to divide
one instrument's numerator by another's denominator. **Said out loud rather than absorbed**, per the
working agreement. Two things about it:

- **It is a scale breach, not a Python one.** Phase profile: walk 3,626 ms, `pyroot` context 16 ms,
  scan + resolve **1,155 ms**, git 2,148 ms, history 201 ms, regions 211 ms, **layout 7,056 ms**,
  elevation 20 ms, validate 45 ms, serialise 17 ms. The scanner is ~6% and the force-directed layout
  is ~40%. Those phases sum to **14.5 s of the ~17.6 s total**; the missing ~3 s is node
  construction, the origin vote, the commit projection and **generation over four verbs**, none of
  which the probe instruments — stated rather than left as an unexplained gap. hugo's layout is
  2,785 ms of ~6.8 s, which is also ~40%, so the shape is the same at half the scale.
- **The per-node rate is inside its own ceiling's intent and outside its number**: ~5.9 ms/node
  against the 5.00 ms/file row, on a repo 1.5× the 2,000-file reference scale the 10 s ceiling is
  written for. django is simply the largest repo ark has ever generated a deck for.

Not fixed here. It is a `layout.ts` change with its own determinism risk and it wants its own ADR;
it goes to `README.md`'s Known gaps with this measurement. The atlas is 2,981.6 KiB against a 5,120
KiB ceiling, so nothing else is close.

---

## 7. What did *not* move

The bootstrap fixture and the four controls are the alarm on a change this wide, and they are silent.
Old indexer against new, from clean clones:

- **ark `abc8549`, hono `7075369e`, hugo `44da08608`, cobra `adbc881`, prometheus `5542b00b9`:
  every section byte-identical — nodes, edges, regions, history, report *and* challenges.** Only the
  `version` integer changes. 160 / 216 / 456 / 59 / 242 challenges, unchanged.
- flask, django and sdp each index to a **byte-identical** atlas across two runs.
- `ATLAS_VERSION` 10 → 11 costs **zero bytes**: `Lang` gains a member and no field is added or
  renamed. The bump is still required, because an atlas carrying `"lang": "py"` is refused by a v10
  validator (guardrail 5).

---

## 8. Post-ship review — the blind spot was in the arm the document was proudest of

An adversarial pass against the merged commit, every finding re-derived before being accepted. The
through-line is this document's own decision 6 — *"every import site that does not place leaves
something on `unresolved`"* — which was the sentence §1.1 leaned on hardest and is where the defects
were, **on the repo this document measures, in the spelling that repo uses most**.

### 8.1 The canonical spelling of a computed import was invisible — 70 of django's 79 call sites

`IMPORT_CALL` matched `importlib.import_module(` and `__import__(` and **not** the bare
`import_module(` that follows `from importlib import import_module` — which is django's house style.
Measured with the shipped scanner: **79 call sites on django where 9 were recorded**, of which **49
are computed** (a missing taint each) and **30 carry a string literal** (a missing *edge* each,
including three real ones into `django/conf/locale/*/formats.py`). `django/apps/config.py` alone —
the app-loading heart — carried six invisible sites and shipped with `unresolved: []`.

It is the *silently dropped import* landmine, in the file whose header quotes it. Two things made it
survive: flask's two computed sites are `__import__(`, which the old regex **did** match, so the
control repo passed; and ADR-0024's probe used the same prefixed shape, so §4's probe-versus-shipped
agreement was **two instruments sharing one blindness**. The corrected figures are in §3 and §4, and
the correction runs against the direction that flatters — the rate got *worse*.

The bare spelling is only recognised when the file actually imports `import_module` from
`importlib`; one of django's 71 bare sites fails that test, and calling a locally-defined function an
unresolved import would be inventing a dependency.

### 8.2 A fourth outcome nobody declared: the empty verdict list

`fromTarget` returned `[]` when the base was a **namespace** package and none of the imported names
resolved to modules — no edge, no external, no `unresolved`, nothing for `build.ts`'s loop to record.
The absolute arm guarded it (`out.length > 0 ? out : [unresolved]`) and **the relative arm did not**,
which is this repo's *the bug you already fixed is still there, one branch down* shape. Latent on
both measured repos — flask's `src/flask/sansio/` is a PEP 420 package and every one of its names
happens to resolve — and reachable on the first namespace-heavy repo. `fromTarget` cannot return
empty now.

### 8.3 Four legal statement forms the 3,011-file corpus does not contain

`from a.b import(c)`, `from x import*`, `from a . b import c`, and a one-line compound
(`if True: import os`). All legal, all confirmed by `ast`, all read as **nothing** — and `import a . b`
read as an import of `a`, which is a *wrong* target rather than a missing one. **Zero instances in
flask or django**, so the comparison in §1 could not see any of them.

That is §1.1's lesson arriving a second time and pointing the same way: a corpus proves a scanner
correct **only about the shapes the corpus contains**. The suite-detected backslash continuation was
the first instance; these are the next four. The compound-statement rule names the seven suite
keywords rather than splitting on any depth-0 colon, because `x: int = 1` would otherwise export a
name called `int`.

### 8.4 A rule that lived twice and had already diverged

`docs/atlas-format.md` §3.6 and this document both say a Blast Radius choice set is
`GRADED_IMPORT_LANGS`; `tests/atlas/atlas.test.ts` — the only *integration* test of that contract —
still asserted `canImport`, the wider predicate. A Python node leaking into a choice set would have
passed it. Unreachable on ark, which has no Python, which is exactly how a stale assertion survives a
milestone. Fixed in the same commit as this section.

### 8.5 Ancestor `__init__.py` edges: a decision, now that it has a measurement

Python executes every parent package on import, so `from django.db import models` really does depend
on `django/__init__.py`, and §3's own argument for the submodule rule — *"dropping either is a
missing edge"* — condemns the omission one level up. This document did not mention it, which makes
it *a failure to think of it* rather than a decision. Priced: **flask +7 pairs (×1.04), django
+5,221 (×1.51)**, taking django from 3.35 to 5.07 edges per node.

**Refused, and recorded.** Not on the density — 5.07 is inside the range of every repo ark ships —
but because the edge carries no information: *every* Python file transitively imports something under
`django.`, so `django/__init__.py` becomes a node whose cone is the repository. That is true, it is
true of every Python repo equally, and it is what would decide elevation, regions and the layout on a
repo already 1.8× over the index ceiling (§6). It is the same objection ADR-0026 made to Go's
intra-package clique edges, at a smaller multiple. Python never grades, so nothing about an answer
key turns on it; what turns on it is whether the map reads truer, and a universal hub does not.
**What would reverse it**: a measurement showing the map reads better with them, or a language whose
ancestor packages are not universal.

### 8.6 The rest

- **`git+https://…` parsed as a distribution called `git`**, so `import git` — GitPython — would have
  been called *external* and had its taint removed. An undercount costs an `unresolved`; an
  over-count invents an external, and this was the second direction. No such line in flask or django.
- **§6 divided one instrument's numerator by another's denominator** — a layout time from the profile
  run over a total from the budget run — and called the result 39%. Corrected, with the container's
  ±25% spread stated, in §6.
- **"the four example projects that carry their own manifests"** is three manifests and a `src/`
  beside one. Six roots either way.
- A doc comment describing `eligibleRefs` was left stacked on `ungradedRefs` when the latter was
  added, leaving the former undocumented and the paragraph attached to the wrong function.
- On a pure-Python repo `tracedRadius` is empty forever — no Blast Radius pass can exist — so the
  full-import-radius unlock (ADR-0008 decision 1) is a mechanic no Python-repo player can ever fire.
  Nothing misrenders; it is a quantity newly pinned at an extreme, and it is written down here rather
  than discovered later.

**Ten findings, and the two that mattered were both decision 6.** Nothing in the suite, the atlas or
the three-instrument comparison could see either: one lived in the arm no second instrument covered,
the other in a branch no measured repo takes.

---

## Decision

1. **Python's scanner is hand-rolled**, scored against tree-sitter and against Python's own `ast` the
   way ADR-0026 decision 1 requires: identical site counts on both repos, **zero** per-file
   disagreements across 3,011 files, 7.1× faster, no runtime dependency (§1). The reversing
   condition is unchanged and has now failed twice.
2. **`canImport` and `canGradeImports` are two predicates.** *Is this mapped source?* and *may this
   grade an answer key?* were one question until Python and are now two, with the wider one keeping
   the name and the coverage reader (§2.1). Merging them again withdraws a Python repo's whole deck
   or ships a Blast Radius deck ADR-0024 measured as dead.
3. **Blast Radius refuses a language, not a node.** The gate is on the subject *and* the candidate
   pool, before taint, with its own refusal reason — so whether a Python repo has a Blast Radius deck
   never depends on how dynamic that particular repo happens to be (§2.1).
4. **A Python node is a file, and `pkg/__init__.py` is a resolution answer rather than a
   granularity.** ADR-0026 is not reopened and ADR-0027's noun mechanism needs no new row (§2.2).
5. **Import roots are read off the repo's layout and never guessed.** Manifest directories, a `src/`
   beside one, and the repo root. What only `sys.path` knows stays `unresolved` — including
   django's `tests/`, which is a real in-repo dependency ark declines to invent (§3).
6. **Every import site that does not place leaves something on `unresolved`**, including all three
   spellings of the computed arm Go does not have. A file that hides a dependency and still looks
   fully resolved is the one thing guardrail 4 cannot survive — and §8.1 and §8.2 are what this
   decision cost before a review measured it, so the decision now carries the shape of its own
   failure: **an arm no second instrument covers is not verified**, and a verdict function that can
   return an empty list has a fourth outcome nobody declared.
7. **A language's kill-point figure is re-measured with the shipped instrument, not inherited from
   the probe.** Here the shipped resolver beat the probe on rate and moved the deck by 0.1 points,
   which is ADR-0024 §4.1's finding confirmed by an independent instrument rather than restated
   (§4).

---

## Alternatives rejected

**Leave `py` out of `IMPORTING_LANGS` entirely — no edges, terrain only.** This is the cheapest
reading of *"a history language"* and it is wrong twice over. `mapped` reads 0, so ADR-0025 refuses
the deck and flask ships nothing at all — the outcome M5's Python half exists to end. And a map with
no edges has no layout, no regions and no elevation worth the name, which is not the *"true map"*
ADR-0024 §5 says this change buys. Measured on flask, the difference is 17 real regions against a
directory-shaped cloud.

**Keep one predicate and gate Blast Radius on taint alone.** It very nearly works — 30 of flask's 32
subjects and 819 of django's 976 are refused by guardrail 4 anyway — and that is the objection: the
remaining 2 and 157 would ship, so *whether a language has a deck* would be decided by how dynamic
one repo is. It is also the per-row shape ADR-0020 forbids, one level up.

**Relax guardrail 4's transitive walk for Python.** ADR-0024's alternatives section already refused
this and nothing here reopens it. It is the one change that would revive Python's Blast Radius, and
django's 562 string-named module references make ADR-0003's reasoning *more* true, not less.

**Parse `pyproject.toml` with a real TOML parser.** It would be this project's first runtime
dependency, to read three arrays. The regex reads PEP 621 arrays, `[project.optional-dependencies]`,
PEP 735 `[dependency-groups]`, poetry tables and `setup()` calls; what it misses becomes
`unresolved`, which is the safe direction. Its first draft consumed the `\n[` that terminates a
table instead of looking ahead, which made `[dependency-groups]` unmatchable when it followed
`[project.optional-dependencies]` — caught by a fixture written with both tables adjacent, because
that is how a real manifest reads.

**Map distribution names to module names.** `PIL`←Pillow, `yaml`←PyYAML. There is no build-free
mapping and a hand-kept table would be a list of the kind ADR-0025 §9.1 is about, in the *unsafe*
direction: a wrong entry invents an external and removes a taint. ADR-0024 §4.1 also prices it — this
and the `sys.path` roots together are worth **0.3 points** of django's blast deck.

**Fix the layout to bring django under the index budget.** Out of scope for the change that adds a
language, and it is a determinism-sensitive rewrite of `layout.ts`. Measured, reported, and left in
Known gaps (§6).

---

## Consequences

- **M5 is delivered.** Its Go half shipped as ADR-0026 and its Python half is this. NORTH-STAR §13's
  *"tree-sitter, 3–4 more languages"* has been read, twice now, as *"more maps"* — and the import
  verb arrives only for a language whose `rate × closure` is low. Two languages have been scored and
  **one** got the verb.
- **`ATLAS_VERSION` is 11 and every saved atlas is stale.** The validator's "reindex required" error
  is the migration, as with every bump since ADR-0010. Progress in `localStorage` is keyed on the
  repo's root commit (ADR-0011), so a reindex costs nothing a player has earned.
- **NORTH-STAR §7.2's *"v2: tree-sitter"* is now refused for two languages out of two scored.** It
  stands as the *strategy* — the case for it is breadth, and a third and fourth language would test
  that — but the crossover it predicts has not arrived: two hand-rolled scanners are ~500 lines
  against a dependency that is measurably slower and buys nothing on either. **The next language
  should be scored the same way, and if it too comes out level the strategy is what needs
  rewriting, not the exception.**
- **`report.unreadable` shrinks on every Python repo**, which is what ADR-0025's mechanism is for
  and is why three of its five refused repos now ship.
- **django is the first repo to breach the index budget while shipping a deck** (§6), and the cause
  is the layout at 3,035 nodes rather than anything about Python.
- The probe scripts, the tree-sitter harness and the measurement scripts are scratch and are **not**
  committed. What is committed is this document, the code, and the tests.

---

## What would change this

- **A language whose hand-rolled scanner disagrees with tree-sitter on real files.** Unchanged from
  ADR-0026, and it has now survived the language most likely to trigger it. Python's `from . import
  x` and `__init__.py` semantics were named there as *"not obviously"* easy; they are handled by a
  logical-line splitter and a resolver, and the *parse* was never the hard part.
- **A repo where the roots rule is wrong.** The measured shape is manifest-directory plus `src/`.
  A monorepo whose packages are pointed at by a tool config rather than by layout would resolve
  worse, and the failure is `unresolved` rather than a wrong edge.
- **Python's Blast Radius**, only if a way is found to resolve a computed `import_module(expr)` in a
  high-centrality file without executing it — barred by pillar 6 rather than by effort (ADR-0024's
  own revisit condition, and it is not import roots or dist-name mapping, which are worth 0.3
  points).
- **`maxCommitsWalked` rising above django's 34,860**, which is what its empty Companion deck is
  waiting on, and is a repo-age fact rather than a language one.
