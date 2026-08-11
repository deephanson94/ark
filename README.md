# Ark

> A game that teaches you how an unfamiliar codebase is shaped — by making you map it.
> You are not a tourist. You are a cartographer arriving at a shore that already exists.

Point it at any repo. Learn its architecture by proving you understand it.

**[Play it in your browser →](https://deephanson94.github.io/ark/)** — ark's map of ark, rebuilt
from `master` on every push. No install, and nothing of yours is read.

To point it at your own code:

```bash
npm install && npm run build   # once
npm run play -- /path/to/repo
```

Or as an installed command — `npm pack` then `npm i -g ./ark-0.1.0.tgz`, and `ark play
/path/to/repo` works from anywhere. **Not from the npm registry**: the package is unpublished and
`ark` is a placeholder name with known collisions (see [`NORTH-STAR.md`](./NORTH-STAR.md)), so
publishing is a decision about the name rather than about the packaging.

---

**MIT licensed.** It is a research-shaped project rather than a supported one: there is no roadmap
promise, the name is a placeholder with known collisions, and the interesting reading is
[`docs/decisions/`](./docs/decisions/) — 34 ADRs, each carrying the measurement that decided it, plus
the ones recording what the measurement got wrong afterwards.

## The problem

Onboarding onto an unfamiliar codebase is one of the highest-frequency, lowest-support activities in
software. READMEs go stale, reading top-down gives you no idea where the top is, and an LLM will be
plausible, unverifiable, and confidently wrong about anything unusual. **There is no way to find out
whether you actually understand a codebase.** Reading feels like progress and isn't.

The only real test is prediction — *if I change this, what breaks?* That question is the product.

## The insight

**The repository is its own answer key.** The import graph knows exactly what breaks if you change a
module. Git history knows which files always move together, and therefore which ones are secretly one
module wearing two hats. Every challenge is graded against a fact mechanically extracted from the
repo, so there is an infinite supply of questions with objectively correct answers already sitting in
`.git` — and **no model anywhere in the grading path**.

## The loop

```
arrive at an unmapped repo  →  see the map, mostly fogged  →  pick a landmark
     →  a challenge tests one claim about its structure
     →  graded against ground truth, with partial credit + evidence
     →  fog lifts around what you proved you understand  →  pick the next landmark
```

Fog is not a mechanic bolted on: the revealed fraction of the map is an honest measure of how much of
the codebase you can actually reason about.

---

## Architecture

Two artifacts, one interface. The split is what makes local-first and static deployment
simultaneously possible.

```
┌────────────────────────────────┐               ┌──────────────────────────────┐
│  INDEXER  (Node CLI, local)    │               │  PLAYER  (static web app)    │
│                                │   atlas.json  │                              │
│   walk → scan → resolve        │ ────────────▶ │   render map (Canvas 2D)     │
│   git log / co-change          │               │   fog of war, semantic zoom  │
│   layout + regions + elevation │               │   serve + grade challenges   │
│   generate challenge decks     │               │   progression, notes, save    │
│                                │               │                              │
│   TOUCHES YOUR SOURCE          │               │  NEVER TOUCHES YOUR SOURCE   │
└────────────────────────────────┘               └──────────────────────────────┘
```

- The player is a **pure function of `atlas.json`** — no filesystem, no network, no framework, **zero
  runtime dependencies**.
- **Layout is computed in the indexer**, so the same repo yields the same map on every machine
  forever. Spatial memory of a codebase has to persist or the whole metaphor is worthless.
- Source code never leaves the machine. Not for analysis, not encrypted, not once.

### Where the code lives

| Path | What it is |
|---|---|
| `src/atlas/` | The schema, the validator, the graph queries, id identity, serialisation, and `coverage.ts`'s source-coverage rule. **The contract both sides share** — defined once, never twice. |
| `src/indexer/` | Repo on disk → validated atlas: `walk` → `scan`/`resolve` (ES modules), `goscan`/`gomod` (Go) and `pyscan`/`pyroot` (Python) → `git`/`history` → `regions`/`layout`/`elevation` → `build` orchestrates, groups files into nodes, and generates. |
| `src/verbs/` | One directory per verb (`generate`, `grade`, `reveal`, distractors), plus what they share: `gate.ts` (the Ctrl+F gate), `difficulty.ts`, `score.ts` (F1), `disclosure.ts` (cross-verb facts), `sample.ts`, `paths.ts`. |
| `src/player/` | Map rendering, camera/orbit/heading, challenge console, grading UI, fog, field notes, save, selector. |
| `src/player/world/` | The walkable world (ADR-0033): a perspective camera, a body and its collisions, the fold from atlas to city, one painter's list, the minimap. |
| `tests/unit/` | Pure functions: grading, graph queries, distractors, gate, save/restore. **< 5 s.** |
| `tests/atlas/` | Indexes *this* repo and asserts the result is sound — the bootstrap fixture and the integration test. |
| `docs/decisions/` | 34 ADRs. Anything that contradicts or extends the north star lands here **with its measurement**. |

### The grading contract

Every verb, however different its interaction, reduces to one `Grade`:

```ts
type Verb = { id; generate(atlas, opts): Challenge[]; grade(challenge, answer): Grade; … }
```

Set-selection verbs score with **F1**, which kills the "select everything" exploit by arithmetic
rather than by anti-cheat code. Adding a verb costs nothing downstream: nothing in the console, the
map, the field notes, the deck or the selector names a verb.

---

## Status

**Legend** — ✅ done and usable · 🟡 in progress or partially built · ⬜ not started

### Milestones ([`NORTH-STAR.md`](./NORTH-STAR.md) §13)

| | Milestone | Deliverable | Status |
|---|---|---|---|
| **M0** | Foundation | Atlas format + ES-module indexer | ✅ |
| **M1** | Legibility | 2D map, fog of war, semantic zoom | ✅ |
| **M2** | **Kill point** | Blast Radius + F1 grading + distractors | ✅ passed |
| **M3** | It's a game | Progression, field notes, localStorage save | ✅ |
| **M4** | Git as rubric | Companion, Placement, Archaeology | ✅ |
| **M5** | Generalisation | tree-sitter, 3–4 more languages | ✅ **Go** at *package* granularity ([ADR-0026](./docs/decisions/0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md)) and **Python** as a *history* language — the map and the git verbs, never Blast Radius ([ADR-0028](./docs/decisions/0028-python-is-mapped-and-never-graded.md)). Both scanners hand-rolled: tree-sitter was scored against each and bought **zero measured points** on either |
| **M6** | The expensive tier | Trace verb (real call graph) | ⬜ |

Shipped beyond the roadmap: **elevation** (a third dimension derived from the graph, ADR-0013), an
**orbit view** (press `o`), a **walkable world** (press `g` — a hero, and the roads are the import
edges, ADR-0033), **map rotation between challenges** (ADR-0017), a **co-change layer** on the map
(ADR-0016), and the **negative witness** — every wrong answer carries the reason it was offered
(ADR-0020).

### Verbs

| Verb | Question | Ground truth | Tier | Status |
|---|---|---|---|---|
| **Blast Radius** | *"Which of these files depend on this one?"* | Transitive dependents, unbounded | 3 | ✅ |
| **Companion** | *"Which files change with this one?"* | Co-change matrix | 3 | ✅ |
| **Placement** | *"This commit landed — which files did it change?"* | The commit's own file list | 6 | ✅ |
| **Archaeology** | *"Which of these commits changed this file?"* | Commits whose file list names it | 5 | ✅ |
| **Trace** | *"Order these calls from entry point to output"* | Call graph path | 4 | ⬜ M6 |
| **Layering**, **Owner** | see NORTH-STAR §6.2 | | | ⬜ backlog |

### Subsystems

| | Status | Notes |
|---|---|---|
| ES-module import scanner | ✅ | Build-free, no language server. TS/JS, one node per file. |
| Go scanner + `go.mod` resolution | ✅ | Hand-rolled, ~200 lines, **zero runtime dependencies** — same 6,013/190 import sites as tree-sitter *and* as `go/parser`, 0 of 942 files disagreeing, 6.2× faster (ADR-0026 §1). One node per **package**: hugo `44da0860` is 193 packages holding 906 files, 6.61 edges each, 456 challenges, 0 unresolved sites. |
| Python scanner + `sys.path`-free resolution | ✅ | Hand-rolled, ~300 lines, **zero runtime dependencies** — same 675/12,052 import **statement** sites as tree-sitter *and* as Python's own `ast`, 0 of 3,011 files disagreeing, 7.1× faster (ADR-0028 §1) — the *call* arm was covered by no second instrument and was wrong until a review measured it (§8.1). A node is a **file**. Roots are read off the repo's layout, never `sys.path`. A *history* language: `canGradeImports` refuses Blast Radius by **language**, so `pallets/flask` `6a2f545b` is 91 nodes, 193 edges, 17 regions and **118 challenges of which 0 are Blast Radius**. |
| Source-coverage refusal (ADR-0025) | ✅ | The walk counts source it recognises and cannot read; a repo whose map holds less than a tenth of its source gets the map and **no deck**. Both sides of that ratio are counts of **files** since ADR-0026 — `mapped` counted *nodes*, which is a category error once a node is a package. **All five repos ADR-0025 refused now ship**: Go returned hugo and cobra, Python returns django, flask and system-design-primer, and that document's *"the refusal will resolve itself as languages land"* is closed. Its reach is bounded by a **list** of languages — see gaps. |
| Git history, co-change, rename lineage | ✅ | Locale-pinned, capped by policy, every cap that bites is reported. |
| Deterministic layout + regions + elevation | ✅ | Byte-identical atlas across three platforms, checked in CI. |
| Distractor generation (§8.3) | ✅ | Per-verb strategies; a real subsystem, not a helper. Every verb now carries §8.3's *historically-coupled-but-not-structurally* class, **both clauses of it** — Placement was the last without one (ADR-0023). |
| Ctrl+F gate (pillar 3, made computable) | ✅ | Nine heuristics; admission rule stated in ADR-0021. Its one *accepted* exposure is now closed rather than held under the bar — the structure-blind subtree hint is withheld, since a margin of 0.011 on a self-indexing repo lasted three milestones. |
| Fog, progression, field notes, save | ✅ | Save keyed on the repo's root commit; claims re-checked at render. |
| Map: semantic zoom, orbit, rotation | ✅ | Canvas 2D, zero runtime deps. |
| Map: co-change history wires | ✅ | Drawn and gated. The gate is scoped to Companion boards deliberately (ADR-0016); the exposure that scope left is closed upstream, in the disclosure record (ADR-0022). |
| Cross-verb disclosure accounting | ✅ | Both channels ship: `discloses` (what my reveal states) and `decidedBy` (what would beat me). ADR-0019 decision 7, ADR-0022. |
| `ark` as an installed command | ✅ | `bin` → an emitted `dist/cli/`, `files` carries the built player, and **`npm run test:pack` packs the tarball, installs it outside this checkout and runs it** — because both real defects (an entry-point test false for every installed copy, and `dist/player` resolved against the working directory) are invisible from inside a repo. CI runs it. **Not published**: the package is `private` and the name is a placeholder, so `npx ark` off the registry is a naming decision away. ADR-0029. |
| Phenomenon catalogue (transfer across repos) | ⬜ | **Deferred with findings** ([ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md)). Fifteen detectors measured on five repos before designing anything: the honest size is ~5 entries, not 30–60, and its best entry — naming a cycle — is a **proof of Blast Radius's key**, deciding 109 of hugo's 156 boards at precision 1.000. ADR-0030's twin surface is its priced pilot. |
| Third-person walkable world | ✅ | **Press `g`.** A hero you walk through the repo: a file is a building at its map position, its height is `elevation`, **the roads on the ground are the import edges**, an unanswered board is a teal beacon, and a north-up minimap keeps the survey view co-present with the walk. Walking past a building surveys it. Shipped as a **mode** — the flat map is still the arrival state, because **S1 is unrun** and nothing may claim the world teaches better until it runs (ADR-0033; P4 released by the owner, recorded in ADR-0009). |

### Known gaps — things this project does *not* do

Kept deliberately, because a checklist item nobody can satisfy gets ticked from memory.

- **A cycle is an answer key, and nothing may name one without a gate**
  ([ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md) §4).
  Strong connectivity is mutual reachability, so every SCC-mate of a subject *is* a transitive
  dependent and ADR-0008's invariant forces it into the key: precision **1.000 by construction**,
  `impure = 0` on every firing of every repo. Measured, ticking the subject's SCC decides **109 of
  hugo's 156** Blast Radius boards, 11 of prometheus's 63 and 7 of hono's 54. Nothing draws or names
  cycles today; this is a standing constraint on anything that would.

- **Two independent playtests say the walkable world teaches nothing the flat map does not**, rating
  it **3/10** and then **5/10** after fixes — and the second notes that the rating moved on
  *stability*, not on fun. That agrees with `docs/prior-art.md` §2, and **no further polish can
  settle it**: it is what `docs/experiments/0001` measures, and that is unrun. ADR-0033 §8.1 and §8.4
  carry both reports.
- **Nothing has measured whether the walkable world teaches better, and it now exists.**
  `docs/experiments/0001` is designed and unrun, so ADR-0033 ships the world as a mode and the flat
  map stays the arrival state. The confound to design around is in ADR-0033 §4: **the minimap draws
  the same import edges the world does**, so a player may be reading the topology off a 2D inset
  drawn over a 3D scene — which would mean the map was doing the work all along. It has to be in both
  arms or neither, and separating the two needs a third condition.
- **Districts are unmarked at street level.** Region arches are designed (ADR-0032 §3.2) and
  deliberately not built: 118 of django's 175 region centroids have their nearest node in a
  *different* region, so an arch placed at a centroid would stand in someone else's street
  (ADR-0032 §9.6). A legibility gap, and a smaller lie than a misplaced landmark.
- **The world's frame cost is unmeasured.** `npm run raster` has never been pointed at it, P1′ is
  owner-only, and django's 10,162 roads inside `VIEW_DISTANCE` are the case to watch. `VIEW_DISTANCE`
  itself is 620 and was picked by eye, which ADR-0033 records rather than dressing up as derived.

- **`ark` is not on the npm registry**, so `npx ark` resolves to somebody else's package. The
  packaging works — pack the tarball and `ark index` / `ark play` run from anywhere — and what is
  left is a *naming* decision: `ark` collides with ARK: Survival Evolved, ARK Invest, ark.io and
  KDE's `ark`, and NORTH-STAR's header says to check npm before anything public. `private: true`
  stays until that is settled.
- ~~**`npx ark` does not work at all.**~~ **Fixed** (**[ADR-0029](./docs/decisions/0029-npx-ark-is-a-script-not-a-checkbox.md)**).
  It had never worked, and the Definition of done had carried it as a tickable box for four
  milestones — so the fix is not that the box became tickable, it is that **the box is a script**.
  Two real defects, both found by packing and running rather than by reasoning: npm installs a `bin`
  as a **symlink**, so the entry-point test `pathToFileURL(argv[1]) === import.meta.url` was false for
  every installed copy and `main` never ran — silently, exiting **0**; and `dist/player` was a bare
  relative path, resolved against *your* repo's working directory. Four mutations of the check each
  go red.
- **A Rust, Ruby or Java repo's *source* is still not on the map.** Go and Python are on it since
  **[ADR-0026](./docs/decisions/0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md)** and
  **[ADR-0028](./docs/decisions/0028-python-is-mapped-and-never-graded.md)** — the five repos
  ADR-0025 refused now ship **1,048** challenges about their own source between them — but every
  other language still gets a map of its documentation and, when that map is a sliver of the repo,
  no deck at all.
- **`django/django` breaches the index budget: 17.6–18.6 s at 3,035 nodes against a 10 s ceiling.**
  Measured at ADR-0028 §6 and **not** the Python scanner, which is 1.2 s of it: the force-directed
  layout is **~7.1 s, ~40%**, and hugo's is ~40% of its ~6.8 s at half the scale. The per-node rate
  is ~5.9 ms against a 5.00 ms/file row, on a repo 1.5× the 2,000-file reference scale the ceiling
  is written for. Every figure there is a range because this container's spread on them is ±25%.
  Fixing it is a `layout.ts` change with its own determinism risk and it wants its own ADR. The
  atlas is 2,985 KiB against a 5,120 KiB ceiling, so nothing else is close.
- **`UNREAD` is a list, and anything not on it is invisible — silently.** This is the residual half
  of the Markdown-map defect, and it is not hypothetical: a **Terraform** repo
  (`terraform-aws-modules/terraform-aws-vpc`) shipped **64 challenges over 24 Markdown files with
  `report.unreadable` empty**, three commits after ADR-0025 — no badge, no note, no refusal. `.tf`,
  `.el`, `.nix`, `.vim` and `.proto` are now on the list; the next language nobody thought of is not.
  A deliberate second undercount sits beside it: ambiguous extensions (`.m`, `.pl`, `.v`, `.d`) are
  excluded rather than guessed at, so an Objective-C repo still slips through. ADR-0025 §9.1 and
  decision 5 — the safe direction in both cases, and a one-line fix per language.
- **A repo can keep its deck with most of its source missing.** The bar is a *tenth*, not a majority:
  `sveltejs/svelte` maps 3,467 JavaScript files and misses 4,462 `.svelte` ones, and ships. The HUD
  says how much is missing on every frame; the deck is not refused. ADR-0025 §4.2 — the bar is
  measured to be safe, not measured to be tight. *(The sharper witness this row used to name,
  **`prometheus/prometheus` at 25.0%** shipping 48 Blast Radius boards about the React UI of a Go
  time-series database, is **retired**: with Go on the map it reads 98.0% and 34 of its 63 blast
  boards are Go packages. The gap is real and it now needs a new witness in a language ark cannot
  read.)*
- ~~**`npm run test:unit` has an undeclared dependency on `npm run build`.**~~ **Fixed.**
  `serve.test.ts` served `dist/player`, so on a fresh clone it failed 2 of 617 — measured on a clone
  of `fb68c7f2` before the fix, green with `dist/` absent after it. It now serves a temp directory it
  writes itself, which tests the same property (the url it prints answers; a rebound Host is refused)
  and depends on nothing.
- ~~**`RevealNote.route` is rendered nowhere.**~~ **Removed.** The field is gone, not wired up: the
  console never drew it because `whyYes` already spells the chain into the note the console *does*
  draw (*"reaches the subject in 2 hops through src/a/direct.ts"*), so it was a second encoding of a
  fact the player already had. The three tests that asserted its shape now assert the sentence
  instead — including the two whose real claim was *a history-graded verb shows no import evidence*,
  which the empty array could never have caught.
- ~~**The player calls every Go package a "file".**~~ **Fixed**
  (**[ADR-0027](./docs/decisions/0027-a-board-is-asked-in-the-noun-its-members-are.md)**). A board is
  asked in the noun its members actually are — `files`, `packages`, `commits`, or `places` where they
  are more than one kind, which on the history verbs is the **majority** shape (151 of hugo's 156
  Companion boards). The caller supplies the fact and the verb keeps writing the sentence; `.` now
  reads as `. (the root package)`. All 160 of ark's prompts and 216 of hono's are
  **character-identical** to before.
- **A Go package's identity is inferred where a file's is recorded.** git records renames of files,
  never of directories, so a `dir` node's `originPath` is the directory a **strict majority** of its
  members came from — measured, 7 of hugo's 193 packages and 28 of prometheus's 123 ship with one.
  A package whose membership changes enough to shift that majority changes its node id and drops the
  passes saved against it. There is no fix short of something git does not record. ADR-0026 §2.1.
- **Map interaction is below its fps budget on headless software rasterisation** (45/33/43 fps at p95
  against a ≥ 50 target). That is a floor, not a desktop GPU number; it needs re-measuring on real
  hardware before anyone acts on it.
- **GitHub Actions still targets Node 20 in both workflows.** `actions/checkout@v4`,
  `actions/setup-node@v4` and `actions/configure-pages@v5` are all being force-run on Node 24 with a
  deprecation warning. A warning today, and one change across `ci.yml` and `pages.yml` rather than a
  fix smuggled into whichever one is being touched — ADR-0031 §6, where it surfaced.
- **Duplicate-answer-key twins are still never mentioned to the player — but the decision is taken
  and it is now *unbuilt* rather than *undecided*** (**[ADR-0030](./docs/decisions/0030-a-twin-is-named-once-its-whole-class-is-cleared.md)**).
  `cone(A) = cone(B)` is the import graph's version of NORTH-STAR §2's *"one module wearing two
  hats"*, and it is **common**: 15.5% of ark's blast-eligible subjects are in a twin class, 15.2% of
  hono's, 8.6% of hugo's and **32.3% of prometheus's**, whose largest class is 25 interchangeable
  `discovery/*` packages. The hypothesis this row was written under — *two on ark and none elsewhere*
  — is retired. Naming a twin is a **Ctrl+F-grade leak** and not in the obvious direction: the answer
  keys provably cannot overlap (ADR-0012 tiles the windows), but a passed board certifies its
  *distractors* as non-dependents of the twin too, which decides **4 of the 12 twin pairs that could
  carry it**, best 0.923 against a 0.78 bar. So the rule is *name a class only when no member of it
  still carries an unanswered board*, in the inspector and never on the map. What is unbuilt is the
  line, the gate's wiring and its tests.

### Next

**Build ADR-0030's twin surface** — an inspector line in the *revealed* register, its gate wired to
the deck (*no member of the class still carries an unanswered board*), and its tests. It is small,
decided and leak-scored, and **[ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md)
makes it the priced pilot** for the phenomenon catalogue, which is now deferred: one entry's real
cost prices the other thirty · then **run `docs/experiments/0001`** — the world exists now, which makes S1 a thing that can be measured
rather than a thing that gates a thing that does not exist. Its §8 lists two blockers first: the two
matched repos are still a TODO, and a two-arm design cannot detect *"orbit beats both"*, which is what
`docs/prior-art.md` actually predicts. **The minimap draws the same edges the world does**, so it must
be in both arms or neither, and telling the world from the inset needs a third condition (ADR-0033 §4)
· then **region arches in the world** — districts are unmarked at street level, and ADR-0032 §9.6 is
why the obvious derivation (`Region.centroid`) cannot be used: 118 of django's 175 centroids have
their nearest node in a *different* region · then **build ADR-0030's twin surface**, whose decision,
gate and measurement are done and whose code is not: an inspector line, its wiring to the deck, and
its tests · the **phenomenon catalogue** is **deferred** (ADR-0034), not queued: fifteen candidate detectors
were measured before anything was designed, and the honest size is ~5 entries rather than the 30–60
this line used to claim — the rest measure the scanner, the norm, or an unreachable bar. Its best
entry is an answer key: naming a cycle decides **109 of hugo's 156** Blast Radius boards with
precision 1.000 · then **django's
index budget** (17.6–18.6 s against 10 s; the layout is ~40% of it, ADR-0028 §6) · and one measurement
only a human can take: **`npm run raster` on real hardware**, on a *turned* map — and now also on the
walkable world, whose frame cost has never been measured anywhere.

*(Six items left this list rather than being done here. **Overlapping Companion answer keys** closed
at `01202ac` and three documents went on listing it for a milestone; the **co-change distractor
strategy for Placement** shipped as ADR-0023 — as a board improvement, not as the fix to ADR-0022's
exposure, which it was measured against and does not move; the **Markdown-map defect** shipped as
ADR-0025; **Go's absence from the map**, the largest of the three rows that defect left behind,
shipped as ADR-0026; **M5's Python half** shipped as ADR-0028, which closes M5; and **`npx ark`**
shipped as ADR-0029.)*

---

## Commands

```bash
npm run play -- <path>     # index any repo and serve it (needs `npm run build` once)
ark index <path>           # the same, once the packed tarball is installed (ADR-0029)
ark play  <path>           #   — `npm pack && npm i -g ./ark-0.1.0.tgz`; not on the registry
npm run dev                # play this repo
npm run index              # index this repo → atlas.json (the bootstrap fixture)
npm run build              # typecheck + bundle + emit the CLI
npm run test:pack          # pack the tarball, install it outside the repo, run it

npm run test:unit          # fast — every change
npm run test:atlas         # schema + integrity of the generated atlas
npm run test:determinism    # index twice, assert byte-identical
npm run budget             # print measured budgets, fail over ceiling
npm run test:e2e           # slow — headless playthrough; screenshots land in artifacts/
```

### Keys, once the player is open

| | |
|---|---|
| `f` / `n` | fit at the current heading · turn back to north |
| `o` | the orbit view — every file a column, drag to turn the world |
| **`g`** | **walk it.** WASD move, Q/E turn, shift runs, enter opens the board you are standing at, `g` or escape returns to the map |
| `enter` | ask the selected node's question |

**The determinism test is the important one.** Index the repo twice, diff the bytes. It catches
accidental `Date.now()`, unsorted `Map` serialisation, filesystem walk order, unseeded layout and
locale-dependent git output in one assertion — every one of which would silently break spatial memory
across sessions, which is the mechanic the whole product rests on.

## Try it on

The deployed player at **<https://deephanson94.github.io/ark/>** is this repo indexed by itself — the bootstrap
fixture NORTH-STAR §11 makes v1's only target, and the one codebase whose map this project can vouch
for. It publishes from `master` on every push and it indexes **nothing else**: a workflow that
accepted a repo URL would be the first crack in pillar 5.

**`honojs/hono`** is the best third-party TypeScript target — **425 nodes, 1,067 edges, 2.51
edges/node** at `7075369e`, 216 challenges, 142 of 425 nodes unprovable. For **Go**, try
`gohugoio/hugo` at `44da08608`: **193 packages holding 906 files**, 6.61 edges each, 456 challenges,
and a 6.1 s index. `spf13/cobra` at `adbc881` is the honest small case — 2 packages, 1 edge, no Blast
Radius deck at all, because cobra is one package and there is nothing to predict. For **Python**,
`pallets/flask` at `6a2f545b` is 91 nodes, 193 edges, 17 regions and **118 challenges of which zero
are Blast Radius** — that verb is refused by language, not by taint (ADR-0028). `django/django` at
`c9eb16a87e` is the scale case at 3,035 nodes and 10,162 edges, and the one repo that breaches the
index budget (see gaps). Ark indexes **itself** as its first level, which is deliberate: every
feature added becomes a new level, and if the tool cannot make its own architecture legible it does
not work.

Measured on a clean clone of `abc8549`: **160 files, 532 edges (3.33 edges/node), 160 challenges**
across four verbs, **26 of 160 nodes unprovable**, a **320.3 KiB** atlas in **~535 ms**. *(Ark
indexes itself, so these move with every commit — hence the sha, and the commit carrying a figure is
always one later than the commit it describes. Prefer the invariants above to the counts.)*

*This block said ark was **2.66** edges/node for five milestones.* It reproduces at no commit and
under no denominator; hono's 2.51, recorded in the same sentence, reproduces to the digit. See
[ADR-0024](./docs/decisions/0024-a-language-ships-on-its-deck-not-on-its-map.md) §0 — the stale
figure was the bar M5 was about to be judged against.

---

## Design pillars

Six, and four of them forbid something — a pillar you cannot violate is decoration.

1. **Ground truth or nothing.** No opinion grading, no LLM in the core loop.
2. **The repo is the level.** Content is derived, never authored per-repo.
3. **Teach coupling, not trivia.** *Violated when a challenge can be answered by `Ctrl+F` rather than
   by reasoning about structure.*
4. **Geography is topology.** If a visual choice makes the picture prettier but less true, it loses.
5. **Local-first.** Source code never leaves the machine.
6. **Ten minutes to first true insight.** No config file, no language server, no successful build.

## Documents

| File | Contains | Read it when |
|---|---|---|
| [`NORTH-STAR.md`](./NORTH-STAR.md) | **What** we're building: pillars, loop, verbs, grading contract, roadmap, risks | Every session, first |
| [`CLAUDE.md`](./CLAUDE.md) | **How** we work: guardrails, testing strategy, budgets, conventions, landmines | Every session, second |
| `README.md` | **Where we are**: architecture and status — this file | Arriving, or checking what's built |
| [`CHANGELOG.md`](./CHANGELOG.md) | **When**: one entry per iteration, what changed and what's next | On pickup |
| [`docs/atlas-format.md`](./docs/atlas-format.md) | The versioned atlas schema — the contract between indexer and player | Before touching either side |
| [`docs/decisions/`](./docs/decisions/) | **Why**: 31 ADRs, each with the measurement that decided it | Before making a call the spec doesn't cover |
| [`docs/prior-art.md`](./docs/prior-art.md) | Why ~30 years of code visualisers never verified comprehension | Before proposing a presentation change |

> **How this file stays true.** The status above is a **live claim**, not a release note, so it moves
> in the commit that changes the thing rather than being batched at the end of a milestone: ⬜ → 🟡
> when work starts, 🟡 → ✅ only on the same evidence as any other *done* claim, and anything found
> broken goes into **Known gaps** with its measurement whether or not it gets fixed. `CLAUDE.md`'s
> session rhythm and Definition of done both carry it, and it stands while the project is under
> development. Numbers here name the commit they were measured at, because ark indexes itself and any
> figure that does not is false by the next one — prefer the invariants to the counts.
