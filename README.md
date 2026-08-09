# Ark

> A game that teaches you how an unfamiliar codebase is shaped — by making you map it.
> You are not a tourist. You are a cartographer arriving at a shore that already exists.

Point it at any repo. Learn its architecture by proving you understand it.

```bash
npm install
npm run build            # once
npm run play -- /path/to/repo
```

*(`ark` is a placeholder name with known collisions — see [`NORTH-STAR.md`](./NORTH-STAR.md).)*

---

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
| `src/indexer/` | Repo on disk → validated atlas: `walk` → `scan`/`resolve` (ES-module imports) → `git`/`history` → `regions`/`layout`/`elevation` → `build` orchestrates and generates. |
| `src/verbs/` | One directory per verb (`generate`, `grade`, `reveal`, distractors), plus what they share: `gate.ts` (the Ctrl+F gate), `difficulty.ts`, `score.ts` (F1), `disclosure.ts` (cross-verb facts), `sample.ts`, `paths.ts`. |
| `src/player/` | Map rendering, camera/orbit/heading, challenge console, grading UI, fog, field notes, save, selector. |
| `tests/unit/` | Pure functions: grading, graph queries, distractors, gate, save/restore. **< 5 s.** |
| `tests/atlas/` | Indexes *this* repo and asserts the result is sound — the bootstrap fixture and the integration test. |
| `docs/decisions/` | 25 ADRs. Anything that contradicts or extends the north star lands here **with its measurement**. |

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
| **M5** | Generalisation | tree-sitter, 3–4 more languages | ⬜ **kill point measured — [ADR-0024](./docs/decisions/0024-a-language-ships-on-its-deck-not-on-its-map.md)**: Go yes at *package* granularity, Python yes for the map and the git verbs, **no** for Blast Radius |
| **M6** | The expensive tier | Trace verb (real call graph) | ⬜ |

Shipped beyond the roadmap: **elevation** (a third dimension derived from the graph, ADR-0013), an
**orbit view** (press `o`), **map rotation between challenges** (ADR-0017), a **co-change layer** on
the map (ADR-0016), and the **negative witness** — every wrong answer carries the reason it was
offered (ADR-0020).

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
| ES-module import scanner | ✅ | Build-free, no language server. **TS/JS only** — see gaps. Go and Python resolution measured at 99.8–100% and 93.8–98.6% of import sites (ADR-0024); the blocker is not parsing. |
| Source-coverage refusal (ADR-0025) | ✅ | The walk counts source it recognises and cannot read; a repo whose map holds less than a tenth of its source gets the map and **no deck**. Measured on 11 repos: refuses 5, ships 6, does not fire on this repo or hono. |
| Git history, co-change, rename lineage | ✅ | Locale-pinned, capped by policy, every cap that bites is reported. |
| Deterministic layout + regions + elevation | ✅ | Byte-identical atlas across three platforms, checked in CI. |
| Distractor generation (§8.3) | ✅ | Per-verb strategies; a real subsystem, not a helper. Every verb now carries §8.3's *historically-coupled-but-not-structurally* class, **both clauses of it** — Placement was the last without one (ADR-0023). |
| Ctrl+F gate (pillar 3, made computable) | ✅ | Nine heuristics; admission rule stated in ADR-0021. |
| Fog, progression, field notes, save | ✅ | Save keyed on the repo's root commit; claims re-checked at render. |
| Map: semantic zoom, orbit, rotation | ✅ | Canvas 2D, zero runtime deps. |
| Map: co-change history wires | ✅ | Drawn and gated. The gate is scoped to Companion boards deliberately (ADR-0016); the exposure that scope left is closed upstream, in the disclosure record (ADR-0022). |
| Cross-verb disclosure accounting | ✅ | Both channels ship: `discloses` (what my reveal states) and `decidedBy` (what would beat me). ADR-0019 decision 7, ADR-0022. |
| `npx ark` packaging | ⬜ | **Stated intent, unbuilt** — see gaps. |
| Phenomenon catalogue (transfer across repos) | ⬜ | The atom that would let anything transfer; risk #1's other half. |
| Third-person walkable world | ⬜ | Intended destination, gated and unscheduled (ADR-0009). |

### Known gaps — things this project does *not* do

Kept deliberately, because a checklist item nobody can satisfy gets ticked from memory.

- **`npx ark` does not work.** `package.json` has no `bin` and `build` typechecks the indexer with
  `--noEmit` rather than emitting it. Use `npm run play -- <path>`. Packaging is real work nobody has
  done.
- **A non-JS repo's *source* is still not on the map** — that part is M5 and unchanged. What is fixed
  (**[ADR-0025](./docs/decisions/0025-a-deck-is-refused-when-the-map-is-not-of-the-repository.md)**)
  is that ark no longer generates a confident deck about the Markdown that is left: `spf13/cobra`
  shipped **48 challenges** about its README files and `gohugoio/hugo` **144** about its docs tree,
  and both now ship **0**, with the map, the count and the reason. 315 questions withdrawn across 5
  of 11 measured repos. **The remaining gap is what a Go or Python repo gets instead**: a map of its
  documentation, which is true but thin, until M5 puts its source on the map.
- **`UNREAD` undercounts on purpose, so a few repos still slip through.** Ambiguous extensions are
  excluded rather than guessed at (`.m`, `.pl`, `.v`, `.d`), so an Objective-C repo is invisible to
  the refusal and would still get a Markdown deck. ADR-0025 decision 5 — the safe direction, and a
  one-line fix per language.
- **A repo can keep its deck with most of its source missing.** The bar is a *tenth*, not a majority:
  `sveltejs/svelte` maps 3,467 TypeScript files and misses 4,462 `.svelte` ones, and ships. The HUD
  says so on every frame; the deck is not refused. ADR-0025 §4.2.
- **`npm run test:unit` has an undeclared dependency on `npm run build`.** On a fresh clone it fails
  2 of 606 tests: `serve.test.ts` serves `dist/player`, which does not exist until the player is
  built, so `atlas.json` 404s where the test expects 200. CI has always been green because `ci.yml`
  runs `build` (as "typecheck") before `test:unit`. Pre-existing at `b9f4d33` and reproduced on a
  clean clone of it. The testing table in `CLAUDE.md` lists the two as independent rows, which is
  what makes a cold session read the red as its own doing.
- **`RevealNote.route` is rendered nowhere.** Blast Radius has computed the import route since M2 and
  the console has never drawn it. Infrastructure with no consumer.
- **Map interaction is below its fps budget on headless software rasterisation** (45/33/43 fps at p95
  against a ≥ 50 target). That is a floor, not a desktop GPU number; it needs re-measuring on real
  hardware before anyone acts on it.
- **No Pages deploy.** Deleted rather than disabled, so a red X on this repo means something
  (ADR-0015).
- **Duplicate-answer-key twins are never mentioned to the player.** `cone(A) = cone(B)` is a true
  derived fact with nowhere to be shown yet.

### Next

**M5 — Go first**, now unblocked: ADR-0024 decision 3's precondition is met, its kill point is
decided (package granularity, `ATLAS_VERSION` bump with a migration under guardrail 5), and Go's
verdict is unconditional where Python's is a smaller product than the roadmap implies · then, in
rough order of size: packaging **`npx ark`** (see gaps — the Definition of done has been
unsatisfiable on it for four milestones) · the **phenomenon catalogue**.

*(Three items left this list rather than being done here. **Overlapping Companion answer keys** closed
at `01202ac` and three documents went on listing it for a milestone; the **co-change distractor
strategy for Placement** shipped as ADR-0023 — as a board improvement, not as the fix to ADR-0022's
exposure, which it was measured against and does not move; the **Markdown-map defect** shipped as
ADR-0025, and what remains of it is three narrower rows in Known gaps with their measurements.)*

---

## Commands

```bash
npm run play -- <path>     # index any repo and serve it (needs `npm run build` once)
npm run dev                # play this repo
npm run index              # index this repo → atlas.json (the bootstrap fixture)
npm run build              # typecheck + bundle

npm run test:unit          # fast — every change
npm run test:atlas         # schema + integrity of the generated atlas
npm run test:determinism    # index twice, assert byte-identical
npm run budget             # print measured budgets, fail over ceiling
npm run test:e2e           # slow — headless playthrough; screenshots land in artifacts/
```

**The determinism test is the important one.** Index the repo twice, diff the bytes. It catches
accidental `Date.now()`, unsorted `Map` serialisation, filesystem walk order, unseeded layout and
locale-dependent git output in one assertion — every one of which would silently break spatial memory
across sessions, which is the mechanic the whole product rests on.

## Try it on

**`honojs/hono`** is the best third-party target — **425 nodes, 1,067 edges, 2.51 edges/node** at
`7075369e`, 216 challenges, 142 of 425 nodes unprovable. Ark indexes **itself** as its first level,
which is deliberate: every feature added becomes a new level, and if the tool cannot make its own
architecture legible it does not work.

Measured on a clean clone of `e6fe5e4`: **147 files, 500 edges (3.40 edges/node), 160 challenges**
across four verbs, **25 of 147 nodes unprovable**, a **299.9 KiB** atlas in **~430 ms**. *(Ark
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
| [`docs/decisions/`](./docs/decisions/) | **Why**: 25 ADRs, each with the measurement that decided it | Before making a call the spec doesn't cover |
| [`docs/prior-art.md`](./docs/prior-art.md) | Why ~30 years of code visualisers never verified comprehension | Before proposing a presentation change |

> **How this file stays true.** The status above is a **live claim**, not a release note, so it moves
> in the commit that changes the thing rather than being batched at the end of a milestone: ⬜ → 🟡
> when work starts, 🟡 → ✅ only on the same evidence as any other *done* claim, and anything found
> broken goes into **Known gaps** with its measurement whether or not it gets fixed. `CLAUDE.md`'s
> session rhythm and Definition of done both carry it, and it stands while the project is under
> development. Numbers here name the commit they were measured at, because ark indexes itself and any
> figure that does not is false by the next one — prefer the invariants to the counts.
