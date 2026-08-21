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
[`docs/decisions/`](./docs/decisions/) — 46 ADRs, each carrying the measurement that decided it, plus
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
| `src/player/world/` | The walkable world (ADR-0033): a perspective camera, a body and its collisions, the fold from atlas to city — towers, roads, the chronicle and the district arches (ADR-0044) — one painter's list, the minimap. |
| `tests/unit/` | Pure functions: grading, graph queries, distractors, gate, save/restore. **< 5 s.** |
| `tests/atlas/` | Indexes *this* repo and asserts the result is sound — the bootstrap fixture and the integration test. |
| `docs/decisions/` | 46 ADRs. Anything that contradicts or extends the north star lands here **with its measurement**. |

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
**orbit view** (press `o`), a **walkable world** (press `g` — a hero, the roads are the import
edges, and every district carries its name on an arch in its own colour, ADR-0033 and ADR-0044),
**map rotation on request** (press `r` — ADR-0017, decision 1 amended by
[ADR-0051](./docs/decisions/0051-the-turn-is-the-players.md): a grade turned the map until round 6's
testers named that the product's single biggest problem, two of ten unprompted and one of them the
round's only 8/8. The mechanism is kept whole — `r` walks the same 80-distinct-heading golden
sequence — and the cost is stated rather than assumed, since a player who never presses it learns the
orientation-locked map that ADR was written against), a **co-change layer** on the map
(ADR-0016), and the **negative witness** — every wrong answer carries the reason it was offered
(ADR-0020).

### Verbs

| Verb | Question | Ground truth | Tier | Status |
|---|---|---|---|---|
| **Blast Radius** | *"Which of these files depend on this one?"* | Transitive dependents, unbounded | 3 | ✅ — but **fully supplied on 8 of 19 measured repos**, token on 7, absent on 4 ([ADR-0042](./docs/decisions/0042-blast-radius-is-taint-limited-on-half-the-real-repositories.md)) |
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
| Deterministic layout + regions + elevation | ✅ | Byte-identical atlas across three platforms, checked in CI. Regions are **deterministic Louvain at γ = 1** since [ADR-0041](./docs/decisions/0041-the-legend-was-most-of-the-complaint-and-louvain-is-the-rest.md), which replaced label propagation under an **owner-licensed layout epoch** — every node moved, once. Measured at `decc8a2` on full clones of named commits, region counts land at **9–22** across eight repos (django 175 → 22, hono 57 → 20) and modularity rises on all eight. |
| Distractor generation (§8.3) | ✅ | Per-verb strategies; a real subsystem, not a helper. Every verb now carries §8.3's *historically-coupled-but-not-structurally* class, **both clauses of it** — Placement was the last without one (ADR-0023). |
| Which subjects a capped deck is spent on | ✅ | The cap bites on every repo measured, so `retain` decides more about a deck than any strategy — and it shipped for two milestones **with no tests**. It now bands the difficulty-sorted list and spends each band on its most **load-bearing** subject (`elevation`, ADR-0013 — which is also the map's vertical channel, so the deck agrees with the picture). Measured on clean clones, the 15 most-imported files carrying any board go **6 → 12 on hono `7075369e` and 7 → 9 on kysely `f24018c7`**, deck sizes unchanged; `src/context.ts` (76 importers), `src/hono.ts` (72) and `src/util/object-utils.ts` (183) had none. Flat importance reproduces the old deck **byte-identically**, which is checked on both repos and over 49 shapes — the first implementation claimed that identity in a comment and moved 3 and 7 Placement boards ([ADR-0039](./docs/decisions/0039-a-capped-deck-spends-each-band-on-its-most-load-bearing-subject.md)). |
| Ctrl+F gate (pillar 3, made computable) | ✅ | Nine heuristics; admission rule stated in ADR-0021. Its one *accepted* exposure is now closed rather than held under the bar — the structure-blind subtree hint is withheld, since a margin of 0.011 on a self-indexing repo lasted three milestones. |
| Fog, progression, field notes, save | ✅ | Save keyed on the repo's root commit; claims re-checked at render. The guide ascends through **each verb's own** difficulty range, not through a shared number ([ADR-0040](./docs/decisions/0040-a-progression-ascends-through-each-verbs-own-range.md)) — §8.4's difficulty is computed per verb, so comparing the values raw served every Blast Radius board below 0.49 before hono's first Companion one and a player met the second verb at board **25 / 19 / 9 / 17** (hono / graphql-js / kysely / ark). Now **7 / 8 / 7 / 5**, and the first fifteen boards' mean subject elevation rises on three repos of four — crossing from below the deck's mean to above it on two of them, hono and kysely.<br><br>**The fog is a three-state ramp and the map drew two.** `understood` shared `surveyed`'s fill and differed by a stroke width of 2.5px against 1.4px, so the reward for the whole core loop was one pixel; a cold playtester rated the loop 5/10 and could not say what passing had changed. `regionKnown` is the third rung, stated as measured contrast rather than three HSL numbers that look spaced — **1.49 : 2.16 : 3.75** against the ground, steps of 1.45× and 1.73× (`npx tsx scripts/probe-ramp.ts`).<br><br>**The guide has a way past a board** — "not this one" skips for the session, and `noteSkip` clears the list once every *unanswered* board is on it, so the guide can never say "every question answered" over a HUD saying "158 left". Session-only; a skip is a preference, not a claim about knowledge.<br><br>**No three boards of one verb in a row — where two verbs share a tier.** Longest same-verb run in the first fifteen was 3 / 4 / 4 / **5** (ark / hono / kysely / graphql-js) and is now **2** on all four. The qualifier is load-bearing and was missing from the first version of this row: `sameVerb` sits *below* `tier`, so it can only interleave verbs at the same tier — and on a repo whose deck holds no two such verbs it is **inert**. Measured: `flask` opens with **fifteen** companion boards in a row and `django` with fifteen archaeology, unchanged. Those are M5 repos with no Blast Radius deck at all, so the complaint this term answers is intact there; moving the term above `tier` would fix it and would let a verb-variety rule outrank §5's curriculum, which is a decision worth its own measurement rather than a line changed under a merge. The cap is two rather than one because forbidding any repeat is strict alternation, which on a starved verb spends its hardest board **fourth** where a cap of two puts it sixth. |
| Map: semantic zoom, orbit, rotation | ✅ | Canvas 2D, zero runtime deps. |
| Map typography and panel composition | ✅ | A graphic-design study over **57 browser screenshots on ark and hono**, at two viewport sizes, scored the product **6.5/10** and named the type layer as the most expensive absence: derived paths set as display type over discs that lose their names at the zoom you go to for names. Names are cartography now — a ground-colour halo under every glyph, four anchor positions per label (below first, so a name that fits under its own disc keeps that slot — **not** *"nothing that could already be placed moves"*, which this row claimed until a review ran it: a dodged label is a new blocker and can displace a lower-priority one, or spend its slot under a tight budget), region names paler and desaturated, and a basename shared with another node keeping one directory of context (**29 of ark's 259 nodes** shared one; `index.ts` ×7). Measured on a fresh page at `54d9888`: district **19 → 27** names, street **9 → 18** over 68 nodes, orbit **12 → 15**. A label the viewport edge would cut is dropped rather than sheared — a **cost**, not a rearrangement: `continue` does not spend budget, so under the node pass's binding budget the slot passes on, but the *region* pass runs with an infinite budget where a dropped name is simply a name fewer. The `ots` and `les` that motivated it are region labels, so the example was the case the free-of-charge claim was false about. Closing a board **returns the pan it took** (287 of 287 world units), the inspector and guide stand down instead of peeking out above and below the console's edges, and the console panel is measured into the label chrome it was the only panel missing from. **Refused**: capping summit rings at two, because the ring count *is* the elevation (ADR-0013) and halving it deletes two layers of a frozen channel to tidy a texture; the contrast ramp ends at 0.10 instead of 0.18 instead. |
| Map: co-change history wires | ✅ | Drawn and gated. The gate is scoped to Companion boards deliberately (ADR-0016); the exposure that scope left is closed upstream, in the disclosure record (ADR-0022). |
| Map: proved chains | ✅ | **The map is the scoreboard.** Every hop of the route from a file you proved to the subject you proved it about, drawn in violet over the import lines it lies on — round 5's *"keep each proved chain drawn"*, and the one of that round's four map requests [ADR-0049](./docs/decisions/0049-edge-direction-is-the-answer-key-and-can-never-be-drawn.md) permits. **Its §4.3 permitted it on an argument that is wrong**: *"adds no node and no edge"* is true about nodes and edges and false about **direction**, which decisions 1 and 2 of that document refuse. Measured by `scripts/probe-chain.ts` at `bc3f039`, precision 1.000 throughout by ADR-0008's invariant so these are pure recall — ungated with half the deck answered the map hands over band A or better on **5 of ark's 40 boards, 8 of hono's 54, 6 of kysely's 75**, and 3 / 5 / 5 of those *exactly*. The gate is one rule — a link `u → v` is drawn only where `v` carries no unanswered Blast Radius board — and it takes every one of those columns to **0** by construction rather than by threshold. It keeps **72.8 / 81.8 / 93.0%** of the ink with half the deck still open; the first version of that figure read 99% on all three because it was measured with *one* board open, which is the bound and not a session. On this repo a full clear draws **138 links over 860 edges**, a half-clear 74, a tenth 23 (`npx tsx scripts/shot-chains.ts`). The hop count the same request asked for is in the **inspector**, not beside every glyph — 79 of ark's 279 nodes carry one at a full clear (120 of hono's 425, 140 of kysely's 600), and it is measured **over drawn links only**, so it can never count a hop the gate withheld. Pointing at a node brightens the routes through it. |
| Every wrong answer is accounted for | ✅ | **A wrong answer you did not pick is explained too** ([ADR-0050](./docs/decisions/0050-a-wrong-answer-you-did-not-pick-is-explained-but-never-labelled.md)). The reveal's rows were `truth ∪ picked`, so a **perfect** answer was told nothing about the candidates it was right to skip — measured at `19b571a`, **2,411 wrong-answer slots on ark and 3,474 on hono, 77.5% and 78.4% of them carrying a recorded reason** (ADR-0020) nobody ever heard, and the one way to see them all was the select-all farm. A fourth `NoteKind`, `avoided`, sorted last and grouped by sentence — the count that decided grouping is **distinct sentences, not rows**: archaeology averages 15.6 rows carrying **2.2** sentences and blastRadius 3.3, against companion's 10.1 and placement's 11.9, so a row each would be eight times longer and say two things. **The witness is withheld from those rows and that is measured, not cautious**: three of the four verbs have exactly one silent class *on both repos*, so a witness everywhere would name it by complement — scored at **0.857 against a 0.78 bar** on one of hono's Blast Radius boards, and **0.500 on ark**, which is why the bootstrap repo could not have decided it. The sentence is safe where the label is not: the purest note shape mapping onto a silent class is 89% and states a **depth-1** edge ADR-0008 already draws, and `whyNot`'s deep arm scores **0.667 / 0.667 / 0.500** with 0 boards beating band A. |
| Cross-verb disclosure accounting | ✅ | Both channels ship: `discloses` (what my reveal states) and `decidedBy` (what would beat me). ADR-0019 decision 7, ADR-0022. |
| `ark` as an installed command | ✅ | `bin` → an emitted `dist/cli/`, `files` carries the built player, and **`npm run test:pack` packs the tarball, installs it outside this checkout and runs it** — because both real defects (an entry-point test false for every installed copy, and `dist/player` resolved against the working directory) are invisible from inside a repo. CI runs it. **Not published**: the package is `private` and the name is a placeholder, so `npx ark` off the registry is a naming decision away. ADR-0029. |
| Phenomenon catalogue (transfer across repos) | ⬜ | **Deferred with findings** ([ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md)). Fifteen detectors measured on five repos before designing anything: the honest size is ~5 entries, not 30–60, and its best entry — naming a cycle — is a **proof of Blast Radius's key**, deciding 109 of hugo's 156 boards at precision 1.000. ADR-0030's twin surface is its priced pilot. |
| The board on the map | ✅ | Opening a challenge marks its **subject** and every placeable **candidate** on the map, with the tick state, and a click on a marker answers the board. The panel is docked and the scrim pointer-transparent, so the map stays readable and clickable — it used to be a dimmed, unmarked backdrop that discarded the board when clicked. **No edge is drawn between subject and candidate**: that relation is the answer and stays gated on `subjectsPassed` (ADR-0008). Half a deck's ids have no place (a Placement subject, an Archaeology candidate) and are dropped rather than positioned. |
| Proof is what the first answer earned | ✅ | **Every answer gets its full reveal**, and `proved` is minted only by a board's **first** graded submission; a later pass is recorded as `shown` and its field note says so ([ADR-0047](./docs/decisions/0047-proof-is-what-the-first-answer-earned.md), **reverses owner-decided ADR-0035; ratified 2026-08-14**). The gate it replaces withheld the reveal below 0.5 precision and could not work: a single pick scores above zero exactly when it is in the key, so the *score* is a membership oracle — **952 of 952 boards on four repos** — and its own showcase case *was* the exploit (pick one file right → precision 1.0 → the whole annotated key and the drawn cone, without passing → reopen and type it back). `understood` reads the proved register only; the deck, the cone and the note read either. A `graded` key **decays with the pass it certifies**, or a re-rolled board would come back permanently unprovable. |
| Experiment harness (`?arm=`) | ✅ | `?arm=map\|orbit\|world` fixes the mode a session starts in and refuses the keys that would leave it — `docs/experiments/0001` is between-subjects and every view was one keystroke from every other, so an arm could not be held. The world arm's minimap drops its **road layer** and keeps everything else (ADR-0033 §4.1). **No query string is the ordinary player, unchanged**, which the deployed page has none of. |
| M2's instrumentation (`arkTally()`) | ✅ | `docs/experiments/0001` §3's engagement measure, in its own `localStorage` record and **only inside `?arm=`**, so the ordinary player stores nothing and ADR-0011 decision 2 is untouched rather than argued with ([ADR-0037](./docs/decisions/0037-m2-is-instrumented-inside-an-arm-and-nowhere-else.md)). The datum did not exist before, and not only unpersisted: `selector.attempts` increments **only on a non-pass**, so it counts failures and would have answered *"challenges attempted"* with a number that falls as participants do better. The first draft put it in `Progress` and **three independent reviewers refuted it**; the shipped shape is theirs. `test:e2e` plays a board in an arm, reloads and asserts the reading survived — deleting the write reddens both assertions. |
| Hold-out split (`npm run holdout`) | ✅ | Cuts a built atlas into the atlas both arms play and the fixed quiz they are scored on (`docs/experiments/0001` §4.4). `Verb.keyFacts` is the third disclosure direction — *what would state my own key* — and it returns **`null` rather than `[]`** where the vocabulary cannot express one, so the two verbs of the discriminating tier print `unchecked` instead of a clean zero. Refuses **0 on ark `75b6117`, graphql-js `9c245018`, kysely `f24018c7` and hono `7075369e`**; the swap loop is proved by a hand-built collision in `tests/unit/holdout.test.ts`, because on a generated atlas ADR-0019 decision 7 makes one impossible. |
| Third-person walkable world | ✅ | **Press `g`.** A hero you walk through the repo: a file is a building at its map position, its height is `elevation`, **the roads on the ground are the import edges**, an unanswered board is a teal beacon, **a district is a four-pillar arch in its own hue carrying its own name** (ADR-0044 — the world had drawn region colour since it shipped and never said what a colour meant), and a north-up minimap keeps the survey view co-present with the walk. Walking past a building surveys it. Shipped as a **mode** — the flat map is still the arrival state, because **S1 is unrun** and nothing may claim the world teaches better until it runs (ADR-0033; P4 released by the owner, recorded in ADR-0009). |

### Known gaps — things this project does *not* do

Kept deliberately, because a checklist item nobody can satisfy gets ticked from memory.

- **A one-file answer key can still be guessed from the paths, on 2 of kysely's 150 boards.**
  `gate.ts`'s `partition` heuristic refuses any board whose key is selected exactly by a path prefix
  of the size the prompt states — the guess a round-7 tester used to score a grade S with no
  reasoning. It carries one carve-out: when the key is **one file** and several prefix groups are
  that size, picking one singleton out of ten is luck rather than reading, so the guess is declined.
  kysely ships two boards where exactly one group matches a one-file key, which is a genuine
  residual: `blast-179e2ca8e038` (`scripts/`) and `placement-5b79e88d2e93`
  (`site/src/components/SectionFeatures/`), measured at `384568f` by `npm run probe:prefix`. Every
  other row reads zero — 12 of 12 verb × repo across ark, hono, kysely and graphql-js.
- **The first ten minutes score 7.4 visual and 6.8 "would you keep playing", against a goal of 8.**
  Ten personas from different technical backgrounds, one fixed build each round, each told only what
  a new player is told, scoring off screenshots they looked at. Seven rounds:
  **7.11 / 6.22 → 7.00 / 6.90 → 7.20 / 6.80 → 6.20 / 6.70 → 6.75 / 6.40 → 7.5 / 7.0 → 7.4 / 6.8**
  (round 7 measured on a frozen snapshot of `4c201cb`, five testers; rounds 1–4 were told *"wrong
  picks cost you nothing"*, which §8.2 makes false, so only rounds 5–7 are comparable to each other).
  **Round 7 was flat against round 6**, which is the useful part of it: the three fixes round 6
  bought moved the number by nothing, so what caps this at 7 is not what was being fixed. What it
  found instead is above — a board answerable by sorting the filenames — plus two open items: three
  testers report **Archaeology and Placement as word-matching rather than structural** (one scored
  0%, *"I had no basis for that at all"*), and a **failed board is permanently dead** three lines
  under copy promising *"answer as often as you like, nothing is lost"*.
  **Round 4's dominant complaint is closed and round 5 replaced it.** Four of ten had said the game
  had no arc; all ten now describe one, and every one names the same thing — *the map lighting up*,
  not the medals (*"my knowledge had a shape and a location"*, *"that single moment is the best thing
  in the product"*, *"that's why I'd have kept clicking"*). What replaced it was **verb sameness**,
  5 of 10, which was a bug rather than taste and is fixed at `662de0f`.
  Every round closed the defects the previous one named and the complaints changed rather than
  shrank, which is the honest reading of a flat score.
  **Round 4's visual fell a full point and the cause was a change made to raise it**: the arrival
  card, named by 8 of 10 as the single thing holding the score down, printed through a dozen map
  labels in the opening frame. Fixed, along with the edges (an effective 11% opacity, so 3 of 10 read
  the map as a bubble chart) — and round 5 measured the result: **visual +0.55**, with the highest
  single visual score in five rounds (8/10) and the arrival card named by nobody.
  **The instrument carried a false sentence for four rounds.** Every brief told the tester *"wrong
  answers cost you nothing"*, which §8.2 makes false and which this repo had already deleted from its
  own prompts — a backend engineer caught it as a contradiction against what the board says. The last
  four personas of round 4 got a corrected brief; the first six did not, so that round is not a clean
  single sample either.
- **Answering is a checkbox list, and the map is a picture of it** — 6 of 10 testers in the third
  round, from four different backgrounds. The map already boxes every candidate when a board opens
  and a click on one already ticks it; what is missing is that nothing says so, so nobody uses it.
  *"The one moment that matters most is the least spatial part of the experience."* This is the
  single most-requested change in the panel and the one that would make NORTH-STAR §9's
  spatial-memory claim true of the **interaction** rather than only of the picture.
- **Label crowding at the arrival zoom** — 6 of 10 in the third round and **10 of 10 in the fourth**,
  on the one frame everyone sees first. Dodging and a wider gap (ADR-pending, `labels.ts`) took
  district names from 19 to 29 and stopped every box overlap, but the densest region still reads as
  stacked text to a newcomer. A rank cut at fit zoom is the obvious lever and it has never been
  measured. **The density also runs backwards with zoom**: 3 testers reported more labels at
  `district` (29 of 266 nodes) than at `street` (8 of 59), where the budget is `Infinity` and
  collision rejection is doing all the work — so zooming *in* names fewer files than zooming out.
- **A name lies across other people's discs, and then it answers for them.** `placeLabels` blocks a
  new label against the other labels and the chrome and **never against the nodes**, while `pickAt`
  consults nameplates before discs — so a file whose disc sits under somebody else's name reports
  that name to the inspector. Measured through the real pointer path by
  **`npx tsx scripts/probe-nameplate.ts . <repo>`** at `4e39701`, hovering every node's own screen
  centre: **35 of ark's 273 discs and 33 of hono's 425 name a different file**, 31 and 21 of those to
  a drawn name rather than to another disc, and **6 and 6 answer nowhere within 20 px in any
  direction** — no handle at all. All three candidate fixes were built and measured, and each one
  pays somewhere worse: putting bodies first drops the discs to 4 and 14 but makes **9 of ark's 15
  drawn names and 5 of hono's 12** point at someone else; making the discs blockers closes it
  completely (0 by name on both) and takes ark from **15 drawn labels to 2**, which spends the map's
  scarcest channel to buy its second-scarcest. **It is a rendering conflict, not a pick-order bug**,
  and the honest lever is probably a label with a *background* — text that occludes what it covers is
  text that may answer for it. Unfixed on purpose; the probe is what keeps the three numbers
  checkable. It cost a whole milestone of e2e silence first: the map step surveys the nodes it found,
  surveying draws their names, and the challenge step then re-used the scan's coordinates — which by
  then meant different nodes.
- **The medals are the weakest part of the arc they were built for, and that is measured.** Eleven
  ship on this repo (`src/player/medals.ts`), all derived, none authored — and round 5's panel put
  them last: three of ten called the shelf *"a chore list, not an arc"*, *"~80% medal grid and ~20%
  actual notes"*, *"eleven mostly-empty shields dominate the panel above the single earned
  sentence"*. What all ten *did* name as the arc is **the map lighting up**, which shipped in M3.
  Four independently asked for the same next step — *"make the map itself the scoreboard"*, *"keep
  each proved chain drawn"*, *"put the region fraction on the map, not in a list"*. The shelf is
  fixed where it was broken (notes lead it, the first rung is reachable inside ten minutes, names
  break at path separators) but **the lesson is that the arc wanted to be spatial and I built a
  panel**.
- **A wrong answer you did not pick is still never explained**, and round 5 did not change it: the
  reveal's rows are `picked ∪ truth`, so a candidate that is neither picked nor in the key gets no
  line, and ADR-0020's witness — which exists to say *why a wrong answer was offered* — is never
  shown for it. On a perfect score the best players learn the least.
- ~~**The most-requested visual change is one that can never ship.**~~ **Written down**
  ([ADR-0049](./docs/decisions/0049-edge-direction-is-the-answer-key-and-can-never-be-drawn.md)),
  which is what it needed: the top ask two rounds running is **edge direction**, and walking
  backwards along drawn arrows scores F1 **1.000 exact on all 40 of ark's and all 54 of hono's Blast
  Radius boards** (`npx tsx scripts/probe-direction.ts`, measured at `66f13d7`) — ADR-0008's
  `candidates ∩ dependents = truth` makes a directed graph the answer key by construction, so none of
  the four escalations this project has for a disclosure reaches it. The ADR is **permanent, with no
  revisit condition**, and carries the list of what the player can have instead. It exists because the
  refusal was correctly re-derived twice by sessions with no record of the previous one, and each
  derivation is a chance to get it wrong in the direction of shipping.
- **A per-board difficulty "level" is refused; a per-region one is not** (`scripts/probe-band.ts`).
  Banding on difficulty puts 9/9 of ark's and 16/16 of hono's bottom band above band A for the free
  ring guess, because `surprise` is defined *against* that ring. The marginal information over what
  the player already has — the prompt states the key size, the ring is drawn — is **3 boards per
  repo**, which is the magnitude ADR-0021 measured and ADR-0022 closed. A per-region level adds
  **0 on both repos** and is the shippable shape, with one caveat: as banded by value it fires on
  **0 of hono's boards**, so equal-count terciles are needed before anything is built on it.
- **A wrong answer you did not pick is never explained.** Two of ten, and one of them scored 100% and
  said so: the reveal builds its rows from `correct ∪ missed ∪ spurious`, which is `picked ∪ truth`,
  so a candidate that is neither picked nor in the key gets no line at all — and ADR-0020's witness,
  which exists precisely to say *why a wrong answer was offered*, is never shown for it. On a perfect
  score the best players therefore learn the least. The prompt's *"every answer is explained"* is
  read by a player as a claim about the twenty rows on screen, and under that reading it is false.
- **The walk's first frame is a wall, and it is the target's own height.** Seven of ten testers in
  round 4 named the walk, three as *the* thing dragging their score, all describing one image: a flat
  untextured wall filling the frame, no horizon, "spawned inside a building". **It is not a
  collision** — `npx tsx scripts/probe-spawn.ts` reports **0 of ark's 227 and 0 of hono's 381 real
  spawn positions** putting the eye inside any tower, agreeing with `probe-eye`'s 1 in 11,880 over
  the walkable grid. You are stood at the foot of the building you were sent to, facing it, and a
  challenge subject is by ADR-0013 tall: a sixty-unit tower subtends ~98% of the vertical field of
  view from the rig's resting position. Spawns where the target fills ≥90% of frame height are
  **3.5% on ark and 3.9% on hono** at `e86573b`, worst case 119%. The standoff cannot fix it —
  framing a tall tower means standing outside `INTERACT_RANGE`, where the board will not open — so
  the fix is a rig that considers what is **ahead** as well as behind, and it is not built.
  `world.spawn` still faces the city from outside the north edge with it small on the horizon, which
  is the separate half three testers across three rounds have called the worst first impression.
  Two testers noted the world *"is actually the best-looking thing in the build"* once you turn away
  from the wall, so this is framing rather than rendering. **Mouse-look is not bound at all.**

- **A board's title is a 74-character slug set as display type.** The subject's path is embedded
  inside the question sentence and the sentence belongs to the verb, so pulling the path onto its
  own monospace line is a change to `Verb.prompt`, not to the panel — and putting the sentence
  together in the console is the cheap fix ADR-0020 and ADR-0027 both forbid. Visible on every
  board of every repo whose paths are long; worst on this one, whose decision records are 60+
  characters.
- **A region named after its hub prints the whole path on the map.** `around src/indexer/build.ts
  (55)` is honest, derived and the longest thing on the frame. Shortening it for the map alone
  would make the map and the legend disagree about a region's name, so this belongs to the naming
  rule — the same one Next already names as blocking NORTH-STAR §5 tier 1 — rather than to the
  renderer.
- **The orbit's fit leaves about 45% of the frame empty**, where the flat map's fills it.
- **Ark's own walkable world is mostly void**: two seconds' walk from the spawn leaves the hero
  alone on an empty plane. hono at 425 nodes does not do this, so it is a density floor rather than
  a rendering fault — but the bootstrap repo is the one every session and every playtester sees.
- **The world's constants are tuned against a moving target, and one of them expired.**
  `FOOTPRINT_SCALE` is fixed while the layout is not, so as a repo grows into the same bounds its
  towers weld together: ark's blocked share climbed **3.3% → 12.4%** at an unchanged 0.4, and the
  atlas test's 0.15 bar — written when the margin was 4.5× — went red on a commit that added one
  script file. Closed at `16c68e4` by lowering the scalar to **0.25** rather than moving the bar, on
  `npx tsx scripts/probe-walkable.ts` over five repos, which also showed 0.4 leaving **graphql-js at
  18.4% and prometheus at 17.2%** — under-tuned on repos the ark-only test cannot see. What is *not*
  closed is the shape of the problem: `RISE`, `ROAD_WIDTH`, `ARCH_SPAN` and the rest are constants
  chosen against one or two repos at one moment, and nothing measures any of them across the
  reference set or over time. This one was caught by a bar it happened to cross.

- **A meaningful share of the history verbs' answer keys is documentation, and on this repo it is
  most of some boards.** A cold playtester's objection is pillar 3's — *teach coupling, not trivia*:
  a Companion key made of `CHANGELOG.md` says only that the author updates the changelog every
  session, which is true, derived, gradeable and worth nothing. Measured by
  `npx tsx scripts/probe-prose.ts`: Blast Radius is **0.0%** prose on both repos, because nothing
  imports Markdown; Companion is **34.4%** of ark's key members and 5.6% of hono's; Placement is
  **42.4%** and 8.9%, and **8 of ark's 40 Placement boards are prose end to end** — all measured on
  a clean clone of `4c7ded5`. *(This row first said 35.6% for Companion, which is the figure at the
  parent commit: measured on the tree that does not contain the change, which is this repository's
  own named landmine, in a row about measurement.)* Concentrated on
  the bootstrap repo, which is the one every session and every playtester sees.
  **Refusing a board whose key is entirely prose is a change to what a verb refuses, which is an
  owner decision** — it would cost **9 boards here and 4 on hono** — the rule is verb-blind and one all-prose *Companion*
  board exists on each, so the Placement-only count of 8 and 3 undercounts it — and the deck cap would backfill from
  a supply of 46 eligible commits against a retained 40, so the deck would shrink slightly. Measured
  and put up rather than taken.

- **A quarter of the deck is unreachable by clicking the map, and on `django` it is three
  quarters.** A Placement board's subject is a **commit** (ADR-0018), which has no square on the flat
  map and therefore no marker to click. The guide reaches them — it labels the control *"Open the
  next question"* and opens them directly — but the guide is one of two ways in, and a player
  exploring by clicking meets only the other. A cold playtester never found Placement at all.
  Measured by `npx tsx scripts/probe-placeless.ts`: **25.0%** of ark's, hono's, kysely's and
  graphql-js's decks, **26.5%** of hugo's and **76.5%** of django's — django's because guardrail 4
  starves its Blast Radius deck, so the history verbs are nearly all of it. The world has a
  **chronicle** for exactly this (ADR-0033), standing outside the map because putting a commit's
  marker among the files it touched would draw Placement's answer key on the ground; the flat map,
  which is the arrival state, has no equivalent. That is the shape of the fix and it is not built.

- **Blast Radius is starved on half of real repositories, and the reference set could not see it**
  ([ADR-0042](./docs/decisions/0042-blast-radius-is-taint-limited-on-half-the-real-repositories.md),
  **accepted — decisions 2 and 5 taken by the owner on 2026-08-14, and both shipped**). Measured on
  **19 repositories at pinned commits**: the v1 verb is fully supplied on **8**
  (the deck cap is what bounds it), ships a token deck on **7** (2.4%–25.4% of subjects), and does not
  exist on **4**. `typeorm` `df07bf1e` ships **58 boards of 2,221 subjects at 97.6% resolution**;
  `vue-core` 7 of 254; `nest` 7 of 286. The three git-graded verbs are unaffected on almost all of
  them, so **on a majority of real repositories the product is already a history product** — which no
  document said before this row.

  **All four reference repos — ark, hono, kysely, graphql-js — are cap-limited**, as are both of
  `docs/experiments/0001`'s matched pair, so every "the cap is the binding constraint" measurement in
  this repository (ADR-0039's `retain` work, ADR-0040's progression, ADR-0012's dedupe costs) was
  taken where the cap binds. **ADR-0042 decision 2 closed that**: `typeorm` `df07bf1e` is in the
  reference set, and ADR-0043 already measures on it by name.

  **Resolution rate is anti-predictive and `rate × mean closure depth` is not the metric either** —
  ADR-0024 decision 4's successor is *position*: typeorm's single `src/platform/PlatformTools.ts`
  carries **one** `require(<expression>)` of the repo's 13,805 import sites and poisons **1,912 of
  1,921** tainted subjects. Two candidate fixes were refused with measurements: relaxing guardrail
  4's transitive walk puts a real dependent in the wrong-answer pool of **30 of nest's 68** and 18 of
  apollo-client's 47 unlocked subjects, and a depth bound creates **29,840 eligible wrong-answer
  slots across typeorm's board-carrying subjects**. A third — monorepo workspace resolution —
  is +250 boards across **3 repos of 19**, one of them the corpus's worst-starved (nest, 7 → 120),
  with **0 directly-visible wrong answer keys** over 46,099 slots. It is measured, reverted and left
  as the owner's call with three stated limits, patch at `docs/decisions/0042-resolver.patch`.

  **Starvation is `(1 − taint) × subjects < cap`, and that predicts it on 18 of 20 gradeable
  repos** — the sharpest instrument this project has for the question, and it was found only after
  the corpus reached 24. `angular/angular` carries **50.4% subject taint and is not starved at all**,
  because 3,275 subjects leave 1,625 clean ones against a cap of 1,050. Taint share alone does not
  decide; taint × size against the cap does. The two misses name the second constraint: a clean
  *subject* still needs a clean *candidate pool* (nest), and a mixed-language repo's subject count is
  not its gradeable subject count (`apache/airflow`, the corpus's first — 7,729 subjects refused by
  language while 552 TS/JS boards ship). With 24 repos and the resolver fix shipped the split is
  **12 cap-limited / 5 taint-limited / 2 neither**.

  **Archaeology is supply-limited on 10 of 19 repos, more than Companion's 6** — and on four where
  Blast Radius is *fully* supplied (hugo 23 boards against a cap of 156, webpack 113 against 1,579).
  Its refusals are dominated by `disclosed` — ADR-0019 decision 7 yielding to Placement — so it is a
  different mechanism and nothing proposed above fixes it. Companion is the most robust verb in the
  product, cap-limited on 13 of 19.

  **Four adversarial reviewers raised ~50 findings against the draft and most reproduced** — one of
  them a **wrong answer key in shipped code**: the first version of the subdirectory fix below made
  git re-run rename detection inside the prefix, inventing six renames on `hono/src` and writing them
  `lineage: 'certain'`. ADR-0042 §10 records what the review changed.

- **A cycle is an answer key, and nothing may name one without a gate**
  ([ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md) §4).
  Strong connectivity is mutual reachability, so every SCC-mate of a subject *is* a transitive
  dependent and ADR-0008's invariant forces it into the key: precision **1.000 by construction**,
  `impure = 0` on every firing of every repo. Measured, ticking the subject's SCC decides **109 of
  hugo's 156** Blast Radius boards, 11 of prometheus's 63 and 7 of hono's 54. Nothing draws or names
  cycles today; this is a standing constraint on anything that would.

- **Tier 2 is not a backlog item, it is blocked — and the map is what blocks it**
  ([ADR-0043](./docs/decisions/0043-tier-2-is-unaskable-while-the-map-gives-away-depth-1.md)). A
  **Direction** verb (*"which of these does `X` import?"* — tier 2's own headline question) was
  designed and refused. Not on supply, which is enormous: typeorm has **3,385 subjects whose imports
  are fully understood** against the 58 Blast Radius boards it ships, because a *direct* claim needs
  only the subject to be clean where a transitive one must walk its whole closure. It was refused
  because **hovering a candidate answers the board exactly** — `depthFor` gives an un-understood node
  `DIRECT_ONLY` and `blastRadius()` returns *dependents*, so `X ∈ dependents(Y, 1) ⟺ X imports Y`.
  Measured on real generated boards: **1.000 exact on 869 of 869** across eight repos.

  That is not a leak: **ADR-0008 decision 1 gives the depth-1 graph away on purpose**, so that §8.4's
  `surprise` is measured against a baseline the player already has. But two of tier 2's three
  questions (*which way do dependencies point*, *what is a hub*) **are** the depth-1 graph, so the
  curriculum and the map's most settled decision are in direct conflict. Unblocking it means amending
  ADR-0008 decision 1, which is an owner's call. *(The third — layering violations — is not a
  depth-1 relation and was not measured.)*

  **The most promising route is now measured, and it is three changes rather than one**
  (ADR-0043 §9). Hover reveals *direction*, which the canvas does not — `draw.ts` strokes lines with
  no arrowhead — so an **undirected** highlight is a repair rather than an amendment, and it closes
  the exploit outright: **0 of 1,436 boards** beat band A on five repos, best 0.769 against the
  admission rule's ceiling. But the inspector's `imported by` count then reopens it on **800 of
  1,436**, exact on four of five repos; and re-scoring `surprise` against the new baseline **replaces
  45–79% of the Blast Radius deck** on four repos, through *two* generator paths — `surprise` and
  ADR-0012's `nonObvious`, which on graphql-js partially cancel. Still nobody's decision but the
  owner's; it is now made against numbers.

  **The route that costs the map nothing was bounded next, and it is two questions**
  ([ADR-0045](./docs/decisions/0045-tier-2s-third-question-is-two-questions-and-only-one-survives.md),
  proposed, nothing built). Tier 2's third question — *where is the layering violation* — is **refused
  as `cycle`**: naming a component decides **111 of hugo's 114 fired Blast Radius boards** (ADR-0034's
  proof, re-derived by an independent Tarjan pass, 1,326 of 1,326 containments), the only gate ADR-0020
  allows leaves **0 of ark's 2 and 0 of hugo's 133** boards open at session start, and ark has one
  2-node component. A second reformulation — **`upstream`**, *which of these does `X` depend on* —
  looked like it survived and **is refused too**, by a review on the same day (§5). Every table in that
  document reproduces; the conclusion did not, because **the benefits were measured on the ungated deck
  and the costs per board**. Through its own two gates and the product's own cap the shipped deck is
  **the same size as Blast Radius's on four repos, 22 against 40 on ark, and 9 against 58 on typeorm** —
  the one repo the structural supply argument was for. The *"3–7× supply"* headline crossed its units
  (uncapped supply against a capped deck; in like units 1.4–1.8×, and **kysely is less**), and the fog
  win survives on one repo of five.

- ~~**No ordering rule can give Blast Radius an easy opening.**~~ **Closed for the symptom, open for
  the cause** ([ADR-0046](./docs/decisions/0046-the-opening-is-a-rank-term-and-it-has-to-be-a-list.md)).
  The structural finding below stands — you cannot fix it *inside* Blast Radius — so the fix is one
  rank term that **demotes** a board about a fixture, benchmark, example, script or manifest. Measured
  through `scripts/probe-opening.ts`: test-pathed boards in the served first fifteen go **4 → 0 on
  hono, 8 → 0 on graphql-js, 2 → 0 on kysely, 1 → 0 on ark**, and the second verb arrives *earlier*
  (hono 6 → 2, graphql-js 8 → 2), because the demoted boards were the ones crowding the interleave
  out. ark's opening is character-identical, which is the acceptance criterion for a repo that was not
  broken. **It is a path list in the product** — ADR-0025's landmine — and demotion-only is the whole
  argument for allowing one: a missing pattern costs one junk board served early, an over-firing one
  costs a good board served late, and nothing is ever lost. **Known gap, unpatched**: graphql-js still
  opens on `resources/strip-private-declarations.ts`, because `resources/` is a plausible real-source
  directory elsewhere and adding it blind is the failure this decision is meant not to repeat.

- **The structural finding underneath it.** On all four
  reference repos **15 of 15** of the easiest blast boards have a subject with zero non-leaf dependents,
  and there are **zero** boards at difficulty ≤ 0.30 whose subject has even one — §8.4 makes a real
  subject a hard question, which is ADR-0040's ρ = 0.96 read from the other end. So the current openings
  are `jsr.json`, `package.json`, `keys.test.json` and eight `__testUtils__` files. The easy-and-real
  boards already exist in the *other* verbs: Companion's easiest fifteen are **0 of 15** test-shaped on
  all four repos. The measured proposal is one selector rank term — a blast board whose subject has zero
  non-leaf dependents sorts last — ordering only, no board lost, no atlas change
  ([ADR-0045](./docs/decisions/0045-tier-2s-third-question-is-two-questions-and-only-one-survives.md) §5.6).

- **The deck has no tier 1 content, and that is what the opening still needs.**
  NORTH-STAR §5's six tiers are the curriculum and say tiers 1–3 "should ship first"; the four verbs
  emit tiers 3, 3, 5 and 6, so **Orientation** (*where does execution start? what are the top-level
  regions?*) and **Topology** (*which way do dependencies point? what is a hub?*) have no questions
  at all. ADR-0040 reached the easy landmark questions that already existed, and the measurement
  that motivated it also bounds it: Blast Radius's difficulty correlates with how load-bearing its
  subject is at Spearman **ρ = 0.96 / 0.84 / 0.38 / 0.84** (hono / graphql-js / kysely / ark),
  because `breadth` is a term in §8.4 — so **its easy end is its peripheral end by construction** and
  no ordering can make it otherwise. About half of the first fifteen boards are still benchmarks,
  fixtures and `__testUtils__`. Two related facts: **no entry point is recorded in the atlas**
  (every TypeScript manifest points into an excluded `dist/`, so tier 1's first question has
  uncertain ground truth and guardrail 4 refuses it), and Archaeology and Placement still first
  appear at board **70–150** and **119–221** (ark at `c35e38a`; it indexes itself, so its two move
  with every commit), so a first session never reaches the git-graded verbs. Ranking the progression
  band above `tier` is the obvious lever and **does not deliver all four verbs early** — measured, it
  leaves hono without a Placement board in its first twelve and graphql-js and kysely with two verbs
  apiece (ADR-0040 §6). It is still an owner's call about what the curriculum is, not a selector's.
- **Some landmarks are still mute, and the cap is why.** ADR-0039 changed *which* subjects a capped
  deck spends itself on; it did not raise the cap. On hono `7075369e` three of the fifteen
  most-imported files still carry no board — `benchmarks/routers/src/tool.mts` (23 importers),
  `src/http-exception.ts` (20), `src/utils/types.ts` (16) — and six of kysely `f24018c7`'s. Each
  loses its band to something taller or is refused by guardrail 4. The measured alternative is
  instructive and is **not** the fix: ranking by importance alone gets **14 of 15** on hono and
  **22 of 22** of the top elevation decile, and raises the deck's difficulty floor from 0.03 to
  **0.55** — a repo's hubs are hard questions, so that deck has no easy end and a new player's first
  board is a mid-difficulty transitive-closure question about the most connected file in the repo.
  Whether the cap itself (`max(40, ⌈n/8⌉)` per verb) is the right size is unmeasured.
- **Five independent playtests now, and the walkable world still teaches nothing the flat map does
  not.** The first two rated it **3/10** then **5/10** (ADR-0033 §8.1, §8.4). Three more, run cold at
  `f370a55` on `graphql-js` and on ark, rated the product **4/10 · 5/10 · 4/10** on first-contact
  intuitiveness, the core loop, and controls — and the views tester's verdict on the world was that
  *"orbit already delivers height, for all 186 nodes at once, without occlusion"*. That agrees with
  `docs/prior-art.md` §2, and **no further polish can settle it**: it is what
  `docs/experiments/0001` measures, and that is unrun.
- **What those three found that is still open**, beyond the falsehoods, the inert map and the
  select-all exploit fixed at `HEAD`: **the fog is dashed-vs-solid outlines** and no tester noticed it existed; the **legend
  clips silently** at 17 of 36 regions with five of them the same grey — both now measured and
  mechanised in ADR-0041: 36 is graphql-js's region count to the digit, and the identical greys are
  terrain regions sharing `scene.ts`'s one `TERRAIN_INDEX`, one legend row apiece (13 of them on
  prometheus); **Placement is unreachable
  from the map** — 25% of a deck whose only entry point is the chronicle, in walk mode; the guide
  **serves the four lowest-difficulty boards first** and has no skip; and there is **no help key and
  no keyboard pan or zoom**. Each is recorded with the measurement that found it in this session's
  `CHANGELOG.md` entry.
- **Nothing has measured whether the walkable world teaches better, and it now exists.**
  `docs/experiments/0001` is **designed, runnable and unrun**, so ADR-0033 ships the world as a mode
  and the flat map stays the arrival state. Its three structural blockers closed at `HEAD`: the
  matched repos are named — **`graphql/graphql-js` `9c245018` and `kysely-org/kysely` `f24018c7`**,
  549/600 nodes, 3.70/4.13 edges each, 69/75 Blast Radius boards, picked from a measured slate of 31
  — the arms are **staged** (map vs orbit first, the world gated on that result, owner's decision of
  2026-08-11), and the quiz is a **fixed held-out item set**. ADR-0033 §4's minimap confound is
  resolved by a measurement that refuted the obvious account of it: the world's own view already
  reaches **98.7% / 99.0%** of the edge set from a standing position, so the inset is not showing
  more, it is showing the same graph exocentrically — the world arm therefore contains a small
  instance of the map arm, and in that arm the inset keeps everything but its roads (`?arm=world`).
  **Both pieces of that document's §9 now ship** — the hold-out split (`npm run holdout`, ADR-0036)
  and M2's instrumentation (`arkTally()`, ADR-0037) — so what is left is **twelve participants**.
- **The hold-out split's disclosure check refuses nothing, and the two zeroes underneath it are not
  the same fact.** Measured at k=6 per verb over all four verbs, on full clones of named commits —
  ark `75b6117`, `graphql/graphql-js` `9c245018`, `kysely-org/kysely` `f24018c7`, `honojs/hono`
  `7075369e` — the check refuses **0 on every repo** and the swap loop runs **once**. On Placement
  and Archaeology that is a *measurement*: their keys are expressible as disclosed facts and
  ADR-0019 decision 7 already excluded the overlap at generation time. **How much that zero proves is
  bounded by deck coverage, and the first draft of this paragraph overstated it.** On hono only
  **52 of 332 key atoms** across both decks sit where the cross-verb channel could fire at all — a
  Placement board covers 54 of 500 retained commits and an Archaeology board 54 of 425 nodes — so
  decision 7 is confirmed on those 52 and the k=6 sample contains almost none of them. It is a
  regression detector on decision 7 rather than a hold-out safety property. On Blast Radius and Companion it is **blindness**: their keys relate files
  and every disclosable fact names a commit, so no accumulated fact can state one and the check
  cannot fire. Those are §4.4's *entire discriminating tier*, so the specified check is structurally
  vacuous on precisely the items the experiment is scored on, and the script prints `unchecked`
  rather than `0` for them. The channel that can fire there is mutual membership — two boards of one
  verb naming each other — which reads **1 on kysely** (`src/dialect/dialect-adapter.ts` ⇄
  `src/parser/expression-parser.ts`, a cycle, which is ADR-0034 §4's finding arriving from the other
  side) and 0 on the other three. It is reported and **not** refused on.
- **Removing a board opens ADR-0030's twin gate on its own answer key — the hold-out *created* a
  leak, and it is closed.** `main.ts` gates the twin class on *"no member still carrying an
  **unanswered** Blast Radius board"* and asks it as `challengesById.get(id) ?? []`, so a held-out
  board is not unanswered but **absent**: the bucket is empty and the guard passes vacuously. Since
  `cone(S) = cone(T)` defines a twin and ADR-0008's invariant makes `candidates ∩ dependents(subject,
  ∞) = truth`, the inspector's sentence hands back the key **byte-exact** — measured at **4 of
  kysely's 6** held-out boards at F1 1.000 (19 of 19 under leave-one-out, 25.3% of that deck) and 3
  of graphql-js's 6. `HoldoutBar` now refuses to hold out a board whose subject shares a cone with
  anything else: it bars **11 of ark's 40, 24 of graphql-js's 69, 26 of kysely's 75, 6 of hono's
  54**, costs no repo its k=6, and leaves **0 of 6** held-out subjects in a twin class on all four.
- **A served Placement reveal assembles a held-out Companion key, and it beat band A on kysely.** A
  Placement reveal names the files a commit touched, so any two are co-commit partners — and *changed
  in the same commit* is the relation Companion grades, reached without the co-change matrix. It beats
  band A on **1 of 6** held-out boards on ark (best F1 0.800) and **1 of 6 on kysely (best 0.909)**,
  one of the two repos the experiment runs on; 0 of 6 on graphql-js and hono. Barred: **0 of 6 on all
  four**, best ≤ 0.500, costing 2 / 2 / 5 / 1 boards. This is the `unchecked` cell with a body —
  `placement.discloses` declares these atoms honestly, but they name a **commit** while a Companion
  key relates **files**, so `keyFacts` cannot connect them.
- **A board the map already answers is not a quiz item, and 2 of 6 were.** Hovering paints a node's
  direct importers for everyone in every arm (ADR-0008 decision 1); on the easy end that is the
  answer rather than a hint — mean F1 **0.890** below difficulty 0.50 against **0.095** above 0.80
  (ρ = −0.826), beating band A on 17 of hono's 54 boards. In the held-out set it decided **2 of 6**
  on graphql-js and hono, 1 of 6 on kysely, at **best F1 1.000**. Barred with the product's own bar
  and metric: **0 of 6 on all four**, best 0.667–0.750. The product ships those boards on purpose
  (`gate.ts` declines to refuse the guess; the progression needs easy rungs) — a quiz is not a
  progression, and that is the whole difference.
- ~~**Region clustering fails in two opposite directions, and the legend was most of the reported
  harm.**~~ **Both fixed** ([ADR-0041](./docs/decisions/0041-the-legend-was-most-of-the-complaint-and-louvain-is-the-rest.md),
  accepted, carrying a layout epoch). The two failures were opposite and the count hid the worse one:
  hono `7075369e` had **57 regions for 425 nodes** and django `c9eb16a8` **175 for 3,035**, while hugo
  `44da0860` put **161 of 204 linked nodes — 78.9% — in one region** at **Q = 0.089** and showed the
  *healthiest* region count in the set. Deterministic Louvain at γ = 1 takes all eight repos to
  **9–22 regions**, raises modularity on every one, and takes hugo's blob to **20.1%**. Two rendering
  defects sat on top and neither was the clustering's fault: the legend was ordered by region **id**
  (alphabetical, so what clipped was arbitrary — the visible 17 accounted for 36% of graphql-js and
  14% of django), and `.legend` carried `overflow-y: auto` **and** `pointer-events: none` in one rule
  block, so clipped rows were *unreachable* rather than below the fold. **Together the two changes
  account for 100% of the map from the legend on all eight repos**; neither alone does — Louvain
  still overflows 17 rows on four of them.

  **A review of this change found two false claims of the same kind, and both are corrected.**
  `absorbSmallRegions` was recorded in five places as firing on hono, graphql-js and kysely; those
  were communities below the floor — the pass's *precondition* — and it performs **0 merges on all
  eight repos**, the terrain fold being what removes them. And `splitDisconnected`, the module's
  advertised Leiden guarantee, was executed by **no test at all**: a no-op body passed the whole
  suite. `tests/unit/louvain.test.ts` now exists, 6 of 7 mutants die, and the `.inspector` panel —
  which carried the identical `overflow-y: auto` + `pointer-events: none` contradiction one rule
  block away — is fixed too.

  **The costs are on the record rather than absorbed.** Every player's spatial memory of every map is
  gone, once; no saved progress was lost, because `nodeIdFor` hashes `originPath` and nothing in
  `save.ts`, `progress.ts`, `notes.ts` or `fog.ts` reads a region. And Louvain is **less stable
  across adjacent commits** — worst single commit moves **38 of hono's 425 nodes against label
  propagation's 4** — which an earlier 25-commit-jump measurement had called a dead heat before the
  granularity was corrected.

- ~~**A region's *name* is still the weak half.**~~ **Fixed in the same epoch**
  ([ADR-0041](./docs/decisions/0041-the-legend-was-most-of-the-complaint-and-louvain-is-the-rest.md)
  §12), because renaming **moves no node** (0 on ark, hono and django, while 2,685 of django's nodes
  changed region id) but **recolours every map** — so doing it later would have spent a second
  standalone recolour. The old rule took the deepest directory *every* member shares and fell back to
  the busiest file's directory; measured, **39 of 74 topology regions carried a label naming a
  directory holding under half their members**, several at 0% (`root/hugolib` names a directory that
  does not exist). A region is now named after the directory maximising **F1** against it, deepest
  wins ties, and **below a half no directory is claimed at all** — the region takes `around <hub>`
  instead, which is a different fact and equally checkable. That bar is *not* placed in the largest
  measured gap, because ADR-0025's rule was applied and there is none: the F1 distribution runs
  0.21–1.00 with a largest gap of 0.043. It is the truth condition of the sentence. **Result: 0 of
  74**, 26 using the hub form, and ark's own map now reads `tests`, `src/verbs`, `src/player`,
  `src/atlas` and `around src/indexer/build.ts` — the last being an honest fallback, since
  `src/indexer` covers only 45% of it. Six mutants die, three of which survived the first draft.

- ~~**Districts are unmarked at street level.**~~ **Closed** —
  [ADR-0044](./docs/decisions/0044-a-district-is-marked-where-it-can-be-stood-in-not-at-its-mean.md).
  **And the entry that stood here was half wrong, which is the part worth keeping.** It said ADR-0032
  §9.6's blocker *"is gone"* on the strength of `scripts/probe-centroids.ts` reading 0 of 100. §9.6
  refused the arch on **two** measurements and that probe re-ran one of them: the *other* — a centroid
  landing **inside a monolith** — was live on **20 of the 61 topology centroids** across six repos.
  Re-checking one clause of a two-clause refusal reads exactly like re-checking the refusal.
  An arch now stands on the nearest ground to the centroid that clears every building *and* sits a
  whole arch-width inside its own district: **142 of 147 districts marked across twelve repos** at
  `da8a276`, **0 in the wrong district**, thinnest margin 5.62 units. The five unmarked (django's
  `around django/core/__init__.py` at 67 files, three typeorm test directories, one rxjs region) have
  no such ground inside their own extent, and are reported rather than rescued. `scripts/probe-arches.ts`.
- ~~**`src/player/ties.ts`'s header records a leak at a figure that predates the fix.**~~ **Closed.**
  It said mutual Companion carrying reaches *"up to 6 of 6 on this repo, measured"* and prescribed
  generator-side work; that work shipped as `companion/generate.ts`'s `claimed` set — one matrix cell,
  one question — so `T ∈ truth(S) ⟹ S ∉ truth(T)` deck-wide and the measured value is **0 on ark,
  hono, kysely and graphql-js**. The header now says so.

  **What that leaves ADR-0016's endpoint gate doing is measured rather than assumed**: it still
  **fires** — 16 / 28 / 26 / 43 suppressions across those four repos — and on **none** of them could
  the withheld wire have disclosed anything, because `claimed` keeps the subject out of the partner's
  key and the candidate pool keeps every matrix partner off the partner's board entirely. **0 wires
  naming a key member, 0 naming a candidate.** It is **kept**, as defence in depth for an invariant
  two files away, and the reasoning is in the header — the precedent for deleting it (`selector.ts`'s
  `sameTruth`) removed a flag that could no longer *fire*, where this one fires and is merely
  ineffective. `tests/atlas/atlas.test.ts` now pins the invariant on the **real deck** rather than on
  a hand-built fixture; disabling `claimed` produces **22 mutual pairs** here and the test goes red.
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
- ~~**`django/django` breaches the index budget.**~~ **Closed** — **4.44 ms/file against the 5.00
  ms/file hard ceiling**, from 5.27 (**[ADR-0038](./docs/decisions/0038-the-index-budget-is-a-rate-the-layout-may-not-move-to-meet-it-and-the-sort-was-the-cost.md)**,
  medians of three interleaved rounds through `scripts/budget.ts` on a full clone of `c9eb16a87e`).
  Absolute, 16.0 s → **13.5 s** at 3,035 files; the 10 s figure this entry used to lead with is quoted
  by `CLAUDE.md` **at 2,000 files**, so the rate is the row to read and the breach was never the 76%
  it looked like.

  **Every change is byte-identical on five repositories** — django, ark, hono, kysely, graphql-js —
  because NORTH-STAR §7 freezes the layout and a speedup that moves a coordinate is a *re-layout*, not
  a performance change. Nothing checked that before: eleven layout tests asserted *properties* and not
  one pinned a value. There is a **golden layout** now, and two mutants die on it.

  **The cost was not where the record said.** The layout is 35.4% and 98% of that is one repulsion
  loop whose 3×3 neighbourhood holds **937 nodes** at django's shape — but the obvious fix (a finer
  grid) reorders a floating-point sum and moves nodes, so only constant-factor work is allowed there
  (8.4 s → 6.4 s). The rest came from the walk's ~6,000 sequential `stat`/`readFile` round trips, and
  from **a sort**: `placement/distractors.ts` ordered **1,136,093 candidates** to keep 19 apiece, 792 ms
  of it. `src/verbs/rank.ts`'s `topBy` keeps a bounded shortlist instead.

  **A prefix-trie rewrite of that strategy was built, verified, and reverted** — it was justified by
  the scan being `anchors × candidates`, and it left the strategy at 1,138 ms against 1,094. The scan
  was never the cost. Recorded in the ADR rather than deleted quietly.
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
- ~~**Duplicate-answer-key twins are never mentioned to the player.**~~ **Built** — the inspector
  names a class once no member still carries an unanswered Blast Radius board, in the revealed
  register. Re-measured at `3cda64a`: ark has 8 classes / 20 members, 1 nameable at load and 8 once
  the deck is cleared, against the 5 / 0 ADR-0030 recorded. Both halves of the gate are checked in a
  browser. The row that follows is the decision it was built from (**[ADR-0030](./docs/decisions/0030-a-twin-is-named-once-its-whole-class-is-cleared.md)**).
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

**The world's remaining constants, measured across the reference set.** Round 5 is **closed**: the
region wash shipped at `66f13d7`, the proved chain at `bc3f039`, its hop count at `19b571a`, and the
reveal now accounts for every candidate (ADR-0050). *This line used to say the walk's framing was
**retired by measurement**, and that was wrong — a reviewer caught it.* What `scripts/probe-frame.ts`
retires is the **cull** and the **frustum** theories: it drives the shipped renderer at every position
the product can put you in and finds **0 empty frames** on both repos. The rig item is the *opposite*
failure — the target **filling** the frame — and its own instrument, `scripts/probe-spawn.ts`, reads
**11 of ark's 243 spawns (4.5%) at ≥90% of frame height, worst 122%**, so it is **live**. Counting the
clauses in the thing you are re-opening is this repo's own rule and I did not run it. A third account
did fail measurement: 1–2 labels in a frame of 205 towers is fog doing what risk #4 asks, since the
same positions read 22 (the cap) under a surveyed map. The class `FOOTPRINT_SCALE` turned out to be in is
**checked and holds**: `scripts/probe-city.ts` measures `RISE` and `ROAD_WIDTH` against the invariants
their own comments claim, over nine repositories from 285 to 12,626 towers (at `b1ba3c6`). A road fan
is 0.0–3.3 units at the median against streets 7.7–13.0 wide, with **2.2%–22.2%** of hubs carrying one
wider than their own nearest street (worst: django) — *that figure was 0.5%–9.0% in the first draft,
which paired each fan against the repository median while the sentence said "nearest"; a reviewer
caught it. It was then briefly written as 17.8%, quoted off a run that had not finished.* The
6:1 canyon `RISE` was set to fix reads 0.4:1 to 2.4:1 everywhere. One margin is recorded as a margin: *"the eye clears most of the
skyline"* is 5.9%–32.8% on eight repos and **49.2% on kysely**, which satisfies "most" by 0.8 points —
and the outlier is **not** the biggest repo, since webpack is the lowest at 5.9%, so this is a fact
about dependency depth rather than size · **bind mouse-look**, which is unbound
· then **a truth-direction arm for `npm run check:keys`** — ADR-0042's workspace
resolver shipped and a post-ship review then found **two real wrong answer keys on webpack**, closed by
the two-condition rule; but `check:keys` asks only whether a *distractor* imports the subject, never
whether a **truth member really is a dependent**, which is the direction those two failed in. That arm
is guarded today by unit fixtures alone. *(This line used to say "decide what ADR-0042 proposes" and
quoted "0 wrong answer keys" — both items were decided by the owner on 2026-08-14 and shipped, and that
figure is one the ADR itself withdrew. Three places in this file said "proposed" while a fourth said it
had happened.)* · then **run `docs/experiments/0001`** — its three structural blockers are closed and it is **runnable**,
though **[ADR-0040](./docs/decisions/0040-a-progression-ascends-through-each-verbs-own-range.md) is a
reason to look at the opening first**: on both of that experiment's matched repos a participant's
first fifteen boards were one verb at the difficulty floor, and seven of graphql-js's first ten were
`src/__testUtils__/*`. That is fixed as far as ordering can fix it; the residue is the missing tier
1–2 content in Known gaps, and twelve recruited participants are the least repeatable resource in
the plan. The blockers themselves are closed: the matched repos are named with commits, the arms are
staged with a stop rule, and the quiz is a fixed held-out item set (owner's decisions of 2026-08-11,
recorded in ADR-0009). **The hold-out split
ships** — `npm run holdout <repo> --out <dir>` writes the played atlas and the quiz and checks every
removed key against the served deck's `discloses` output, which refuses **0 across four repos** for
two different reasons the script keeps apart (see Known gaps). **M2's instrumentation ships too**
(ADR-0037), so **both** pieces of that document's §9 are done and what is left is **twelve
participants from outside the project**, which is owner-only and the wall S1 was always going to hit
· ~~then **region arches in the world**~~ — **built** (ADR-0044): 142 of 147 districts marked across
twelve repos, 0 in the wrong district. §9.6's refusal had two clauses and only one had been
re-measured; the live one — a centroid inside a monolith, **31 of 147** — is what the placement rule
answers
· **a naming rule for cross-directory regions**, which is what still blocks NORTH-STAR
§5 tier 1 now that region *count* no longer does, and which ADR-0041 §7 shows is separable from the
clustering · the **phenomenon catalogue** is **deferred** (ADR-0034), not queued: fifteen candidate detectors
were measured before anything was designed, and the honest size is ~5 entries rather than the 30–60
this line used to claim — the rest measure the scanner, the norm, or an unreachable bar. Its best
entry is an answer key: naming a cycle decides **109 of hugo's 156** Blast Radius boards with
precision 1.000 · and one measurement
only a human can take: **`npm run raster` on real hardware**, on a *turned* map — and now also on the
walkable world, whose frame cost has never been measured anywhere.

*(Eight items left this list rather than being done here. **`django`'s index budget** closed as
ADR-0038 — at **4.44 ms/file against a 5.00 hard ceiling**, the 10 s absolute being quoted at 2,000
files where django has 3,035 — and the cost was not where this line said: the layout's obvious fix
moves a coordinate, which NORTH-STAR §7 forbids, and the biggest single win was **a sort**; **ADR-0030's
twin surface** is built (`src/player/twins.ts`, one gated inspector line, exercised by `test:e2e`). **Overlapping Companion answer keys** closed
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
npm run check:keys         # does any board mark a real dependent wrong? reads SOURCE, not the atlas
                           #   — gates itself on a plant and fails if the detector is inert
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
index budget (see gaps). **`graphql/graphql-js` `9c245018`** (549 nodes, 3.70 edges/node, 276
challenges) and **`kysely-org/kysely` `f24018c7`** (600, 4.13, 300) are the densest third-party maps
measured, and are experiment 0001's matched pair.

**`typeorm/typeorm` at `df07bf1e` is the reference set's taint-limited member**, added because every
other repo named here is one where the **deck cap** is the binding constraint, and that made a whole
class of behaviour invisible for five milestones
([ADR-0042](./docs/decisions/0042-blast-radius-is-taint-limited-on-half-the-real-repositories.md)
decision 2). It is 3,704 files, 11,988 edges (3.24 each), 54 regions, 962 challenges — and **58 Blast
Radius boards of 2,248 candidate subjects**, with 2,120 refused by guardrail 4 and the cap 8× away
from ever biting. One `require(<expression>)` in `src/platform/PlatformTools.ts` accounts for 1,912
of its 1,921 tainted subjects. Point a supply measurement at this one before believing it
generalises. Ark indexes **itself** as its first level, which is deliberate: every
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
| [`docs/decisions/`](./docs/decisions/) | **Why**: 40 ADRs, each with the measurement that decided it | Before making a call the spec doesn't cover |
| [`docs/prior-art.md`](./docs/prior-art.md) | Why ~30 years of code visualisers never verified comprehension | Before proposing a presentation change |

> **How this file stays true.** The status above is a **live claim**, not a release note, so it moves
> in the commit that changes the thing rather than being batched at the end of a milestone: ⬜ → 🟡
> when work starts, 🟡 → ✅ only on the same evidence as any other *done* claim, and anything found
> broken goes into **Known gaps** with its measurement whether or not it gets fixed. `CLAUDE.md`'s
> session rhythm and Definition of done both carry it, and it stands while the project is under
> development. Numbers here name the commit they were measured at, because ark indexes itself and any
> figure that does not is false by the next one — prefer the invariants to the counts.
