@NORTH-STAR.md

# CLAUDE.md — Ark working agreement

> This is the **how we work** document. The **what we're building** document is
> [`NORTH-STAR.md`](./NORTH-STAR.md) — read that first, every session.
>
> When the two conflict, `NORTH-STAR.md` wins. When this document and a clever idea conflict,
> this document wins until someone changes it deliberately.

---

## Document map

| File | Contains | When to read |
|---|---|---|
| [`NORTH-STAR.md`](./NORTH-STAR.md) | North star: pillars, core loop, verbs, grading contract, atlas format, roadmap | **Every session, first** |
| `CLAUDE.md` (this file) | Working agreement, guardrails, testing strategy, conventions, landmines | **Every session, second** |
| `CHANGELOG.md` | One line per iteration: what changed, what to do next | Read the last few on pickup; append on close-out |
| `docs/atlas-format.md` | The versioned atlas schema (the contract between indexer and player) | Before touching either side |
| `docs/decisions/` | ADRs for anything that contradicts or extends the north star | When you're about to make a call the spec doesn't cover |

---

## /goal — the standing objective

> **Build and keep improving Ark: a game that teaches you the shape of an unfamiliar codebase
> by making you map it, graded entirely against ground truth extracted from the repo itself.**

This is a **long-running goal with no end state**. Each session: pick the single highest-leverage
improvement, take it end to end until it's actually usable, verify it, record it, stop.

Direction is open — visual style, verb wording, map interaction, progression curve are all yours to
propose and change. Only the guardrails below are fixed.

Every iteration should move at least one of these forward:

1. **Truer grading** — more of the repo's real structure and history turned into gradeable ground truth.
2. **More legible maps** — a developer should be able to look at the map and form a correct mental model faster.
3. **Better questions** — sharper distractors, better-calibrated difficulty, questions that transfer to unseen repos.
4. **Broader reach** — more languages, larger repos, repos with no git history.
5. **Better feel** — responsiveness, feedback, the moment of "oh, *that's* how this fits together."

---

## Guardrails — non-negotiable

These are the pillars from `NORTH-STAR.md` expressed as things an agent must never do.

1. **Never send source code over a network.** Not for analysis, not for "just this once", not
   encrypted. The indexer is local-only. If a feature needs remote processing, it doesn't ship.
   *This is a security promise, not a preference.*
2. **Never author repo-specific content.** No hand-written challenge text for a particular project,
   no hard-coded file paths in the generator. If it doesn't generalise, it doesn't ship.
3. **Never put a model in the grading path.** Every `grade()` is a pure, deterministic function of
   `(challenge, answer)`. An optional labelled "explain this node" side panel is acceptable; the
   grade must never depend on it.
4. **Never generate a challenge whose ground truth is uncertain.** If the analysis is
   low-confidence (dynamic dispatch, unresolved re-export, generated code), skip the challenge.
   A wrong answer key destroys trust permanently; a missing challenge costs nothing.
5. **Never break the atlas contract silently.** Schema changes bump `version` and ship a migration
   or an explicit "reindex required" error. The player must never guess at a shape.
6. **Never punish a wrong answer.** Wrong picks teach. No score penalty, no fail state, no lockout.
7. **Never leave the build broken.** Every delivery: indexer runs on this repo, player loads the
   atlas, no console errors.

---

## Session rhythm

1. **Read** `NORTH-STAR.md`, this file, and the last few lines of `CHANGELOG.md`.
2. **Pick one thing.** One clear objective per session. Not three.
3. **Implement it end to end** until it is actually usable — not scaffolded, not stubbed.
4. **Verify** (see testing strategy below).
5. **Close out**: append one line to `CHANGELOG.md` — what you did, and what you'd do next — then
   commit and push.

If you discover a second thing worth doing, write it in the CHANGELOG "next" note. Don't do it.

---

## Testing strategy

The pyramid, fastest first. It will grow; keep it ordered by cost.

| Command | Covers | Target time | When |
|---|---|---|---|
| `npm run test:unit` | Verb `grade()` functions, F1 scoring, graph queries, distractor generator | < 5 s | **Every change** |
| `npm run test:atlas` | Indexer produces a schema-valid atlas for this repo; no dangling edges; every `challenge.truth ⊆ candidates` | < 15 s | Every change touching the indexer |
| `npm run test:determinism` | Index this repo twice → **byte-identical** output | < 30 s | Every change touching the indexer |
| `npm run build` | TS compile + bundle | < 5 s | Every change |
| `npm run test:e2e` | Headless playthrough: load atlas, render map, answer a challenge, see a grade | minutes | Big changes only — **ask first** |

**Rules:**

- **Ask before running the slow suite** on a small change. Offer "full / fast only / none."
- **Don't re-verify what a subagent already verified green.** Spot-check with the fast suite.
- **Make a new assertion fail before you make it pass.** A test that never failed proves nothing.
- **Beware vacuous passes.** Assert on real measured values, not on the absence of an error. If you
  assert on a rendered element, confirm it's actually measurable first.

### The determinism test is the important one

`test:determinism` is this project's equivalent of a canary. Index the repo twice, diff the bytes.
It catches, in one assertion: accidental `Date.now()` / `Math.random()`, unsorted `Map`/`Set`
serialisation, filesystem walk order dependence, unseeded force-layout, and locale-dependent git
output. **Every one of those would silently break spatial memory across sessions**, which is the
mechanic the whole product rests on.

If it fails, fix the nondeterminism. Never fix it by loosening the test.

---

## Budgets — measured by script, not estimated

Add a `npm run budget` check that prints these and fails over the ceiling.

| Budget | Ceiling | Notes |
|---|---|---|
| Atlas size | 5 MB @ 2,000 files | Above this, move history to a side-file loaded on demand |
| Index time | 10 s @ 2,000 files | Pillar 6: ten minutes to first insight includes this |
| Player first paint | 1.5 s | Static file, no excuses |
| Map interaction | ≥ 50 fps @ 2,000 nodes | Below this, switch Canvas → WebGL, not before. *Performance* is not the only reason a renderer may change — see [ADR-0009](./docs/decisions/0009-third-person-is-a-presentation-layer-over-the-same-atlas.md) — but nothing else licenses it either. **Measured 2026-08-07 by `npm run raster`: 45 / 33 / 43 fps at p95 (territory / district / street) — BELOW the 50 fps target at every zoom level.** Headless, software-rasterised, in a container — so this is a *floor*, not the number a GPU desktop sees. Re-measure on real hardware before acting on it. |
| Runtime deps (player) | ≤ 3 | The player is a graph renderer and some DOM. It does not need a framework. |

When a budget is exceeded, say so out loud in the CHANGELOG. Silent truncation reads as success.

---

## Conventions

- **TypeScript, strict.** `strict: true`, `noUncheckedIndexedAccess: true`. The atlas format and verb
  contracts are exactly what a type system is for — don't `any` your way past them.
- **The atlas schema lives in one place** and is the single source of truth for both sides. Generate
  types from it or hand-write them once and validate at load. Never define the shape twice.
- **Verbs are self-contained.** One directory per verb: `generate()`, `grade()`, fixtures, tests.
  Adding a verb must not require editing the console, the grader, or the map.
- **Pure core, imperative shell.** Graph queries, scoring and generation are pure functions with no
  I/O. Filesystem and git access live at the edges. This is what makes the fast suite fast.
- **Sort before you serialise.** Every array in the atlas has a defined order. Insertion order is not
  an order.
- **Comment the *why*, especially the scars.** When you fix a subtle bug, leave the reason in the
  code. `// LC_ALL=C because git localises --numstat headers` saves the next session an hour.

---

## Landmines

Seeded with the ones we can predict. **Append every time one bites you.**

- **Git output is locale-dependent.** Set `LC_ALL=C` on every git subprocess or `--numstat` and
  `--porcelain` headers will vary by machine and break the determinism test.
- **`git log --numstat` reports renames as delete+add** unless you pass `-M`. Rename-blind churn
  counts are wrong in exactly the files that matter most.
- **Force-directed layout is nondeterministic by default.** Seed the PRNG, fix the iteration count,
  never call `Math.random()`. Same repo must equal same map, forever.
- **Exclude `node_modules`, `.git`, `dist`, and symlinks from the walk** — and follow `.gitignore`.
  A symlink loop will hang the indexer.
- **Re-exports break naive import graphs.** `export * from './x'` means a dependent of the barrel is
  a dependent of `x`. Resolve barrels or mark the edge low-confidence (guardrail 4).
- **Dynamic imports and string-built paths are unresolvable.** Detect and mark; don't guess.
- **A file with zero dependents is not necessarily dead** — it may be an entry point. Check the
  manifest before implying anything.
- **Telling a regex from a division needs a real parse.** The scanner guesses from the last
  significant token plus a keyword list. A division read as a regex (`return width / height`)
  swallows to end of line; a regex read as code leaks its body into the token stream. Both are
  narrow, neither is impossible — do not write "can never" in a comment about a heuristic.
- **A silently dropped import is worse than a wrong one.** `require(expr)` once produced no
  reference at all while `import(expr)` produced an unresolved one, so a file could hide a
  dependency and still look fully resolved to guardrail 4. Every unparseable specifier must emit
  something.
- **`git log --date=short` renders each commit in its *own* recorded timezone.** So a repo with
  contributors in two zones produces dates that do not decrease along the log, and two commits made
  at the same instant get different dates. Use `--date=short-local` with `TZ` pinned.
- **`git log` orders by *commit* date; `%ad` is the *author* date.** Even in one timezone they
  disagree after a rebase or a mailed patch, so "the log is newest-first" is not a claim you can
  make about the dates you kept. Sort explicitly and tiebreak on sha.
- **Label propagation has no objective function, so it gets patched.** It has been patched twice
  already (connector hold-out, small-region absorption). If a *third* structural patch looks
  necessary, stop and write deterministic Louvain/Leiden instead — fixed visit order and
  ascending-label tiebreaks make it deterministic, and it is ~150 lines. Patching further is how you
  end up with an algorithm nobody can reason about.
- **Regions are stable for a commit, not across commits.** Determinism guarantees same commit ⇒ same
  regions. It does not guarantee that a small change to the graph leaves regions alone — label
  propagation can reshuffle wholesale. Spatial memory across a repo's *evolution* is unaddressed in
  the spec and will need a decision by M3.
- **Dates are not the only thing git renders per-commit.** If a field comes from `--format`, ask
  what it depends on besides the commit.
- **An instrument that measures nothing looks exactly like good news.** `npm run raster`'s first two
  versions reported plausible frame times — 33/49/35 fps — against a map that was not moving at all:
  once because synthetic `PointerEvent`s did not drive the drag, once because wheeling out drove the
  scale into `clampScale`'s floor where 2,000 nodes are a sub-pixel smudge and panning changes no
  pixels. Nothing in the numbers looked wrong. **Any measurement of "how fast is X" needs a gate
  proving X happened** — here, hashing the canvas before and after and refusing to print timings
  when they match. Note both failures produced *better* numbers than the truth, which is the
  direction that gets believed.
- **`page.evaluate` bodies may not contain `const f = () => …`.** tsx transpiles this repo with
  esbuild's `keepNames`, which wraps named inner functions in a `__name` helper that does not exist
  in the page; the evaluate fails at runtime with `ReferenceError: __name is not defined`. Inline the
  function, or pass the body as a string.
- **Verb-blind state read by verb-specific code is how one verb leaks another's answer key.** The
  fog's `understood` set is deliberately verb-blind — proving anything about a file is a real reason
  to know its name — but the map reads it to decide whether to draw a node's *full import radius*,
  and the inspector read it to print the transitive count. With one verb both are ADR-0008 decision 1
  working. With two, a Companion pass printed the answer to the open Blast Radius question about the
  same file. **Both instances were the same one-line rule and only one was found by review**; the
  other surfaced in an e2e screenshot, and a third — the inspector button still reading "Map its
  blast radius" — in the same image. When you add a verb, grep every read of shared player state and
  ask *which verb's claim is this?*
- **Anything a verb says about its own question belongs on the `Verb` contract, not in the panel.**
  The console was verb-blind and the inspector was not, so the seam held in one file and failed in
  the one nobody had thought about. Wording, the reveal, the summary sentence, the grade's phrasing
  and the button label are all verb-supplied now. Templating a verb's `title` into a fixed sentence
  is not a fix — it produced *"Map its companion"*.
- **Do not tokenise or split paths inside a per-subject loop.** `blastRadius/distractors.ts` has
  documented this since M2 ("cost 8 s of a 10 s index budget") and M4's Companion did it anyway:
  **29.7 s on svelte against Blast Radius's 0.6**, pushing a full index from 22.5 s to 47.8 s. The
  generator asks for a choice set once per subject, so per-node work happens V² times. Precompute a
  corpus and invert the indexes; a documented landmine in one file does not protect the next one.
- **`innerText` returns *rendered* text.** An e2e assertion comparing a verb's title against
  `.console-verb` failed because the CSS is `text-transform: uppercase` and the DOM said
  `COMPANION`. The element's text and the string the code put there are not the same value.
- **A second opinion catches reasoning, not liveness. Measure whether new machinery fires.** The
  Ctrl+F gate's repair pass was designed by a Fable consult *before* it was written, reviewed as
  sound, tested, and rescued **zero** boards on either repo. No amount of earlier consulting would
  have found that — a reviewer can tell you a design is coherent, not whether the branch is ever
  taken on real data. The mutation test found it: disabling the loop changed no test result. So when
  you add a fallback, a retry, a repair or any other "and if that fails, try harder" path, **count
  how many times it fires on a real repo before you write tests around it.** A path that never
  executes is worse than no path: it is code, comments and test surface asserting a behaviour the
  product does not have.
- **"CI is green" is a claim about *every* workflow, and there was more than one.** `pages.yml` had
  failed on every run it ever had — before M4 landed and after it — while a session reported CI green
  three separate times, because it only ever opened `ci.yml` runs on its own branch. The human
  spotted it, not the agent. The mechanism is worth naming because it is not simple carelessness: a
  check that is *permanently* red gets normalised into background noise, the mirror image of the
  instrument that always reads good and therefore gets believed. So **list the workflows before you
  claim they passed**, and check them on the branch the commit actually landed on. The failing
  workflow is deleted (ADR-0015) precisely so that a red X on this repo means something again.

---

## Subagents and parallelism

- **Research in parallel** (prior art, library evaluation, format investigation) — safe and fast.
- **Code writing serially.** Parallel writers collide on files. One implementation agent at a time.
- **Give every implementation agent a full brief**: current state, objective, how to verify, and what
  it must not touch.
- **Parallel agents must never edit `CLAUDE.md`, `NORTH-STAR.md`, or `CHANGELOG.md`.** The orchestrator
  owns those.

---

## Never touch

- The user's running dev server. Pick your own port for anything you start, and kill the whole
  process group when you're done — orphaned processes hold ports and break the next run.
- `NORTH-STAR.md`, without saying explicitly that you're changing the north star and why.
- `docs/atlas-format.md` version numbers, without a migration path.

---

## Definition of done

- [ ] The objective is complete end to end and **actually usable**, not scaffolded.
- [ ] `npm run test:unit` and `npm run build` pass.
- [ ] If the indexer changed: `test:atlas` and `test:determinism` pass.
- [ ] `npx ark index .` still works on **this repo** — the bootstrap fixture must never break.
- [ ] No console errors in the player.
- [ ] One line appended to `CHANGELOG.md`: what changed, what's next.

---

## Command reference

```bash
npm run dev                # player dev server (pick a free port; don't assume)
npm run play -- <path>     # index ANY repo and serve it — needs `npm run build` once
npm run index              # index this repo → atlas.json  (the bootstrap fixture)
npm run build              # typecheck + bundle
npm run test:unit          # fast — every change
npm run test:atlas         # schema + integrity of the generated atlas
npm run test:determinism   # index twice, assert byte-identical
npm run budget             # print measured budgets, fail over ceiling
npm run raster             # slow — frame time at 2,000 nodes in a real browser (ADR-0009 P3)
npm run test:e2e           # slow — ask first. Screenshots land in artifacts/ — look at them.
```

**If `test:e2e` reports `Executable doesn’t exist at .../chromium_headless_shell-NNNN/...`**, the
installed Playwright wants a different browser build than the machine already has. Do **not** run
`playwright install` in an environment that ships one — point at the existing binary:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # Claude Code cloud sessions
```

CI installs its own Chromium and needs no variable.

---

## Current state

**M2, M3 and M4 delivered, and the first three rungs toward the third-person world are shipped.**
Run it: **`npm run play -- /path/to/repo`** indexes any repo and serves the player; `npm run dev`
plays this one. Best third-party repo to try is **`honojs/hono`** (425 nodes, 2.51 edges/node —
Ark itself is 2.66 — and the only outside repo where the generator had more supply than the deck cap
allowed). The scanner is **ES modules only**, so a Python or Go repo produces a map with no edges and
no questions until M5.

Press **`o`** for the orbit view: every file a column standing on its 2D footing, height =
`elevation`, drag to turn the world. `o` again returns to the flat map, and straight down reproduces
it to the pixel. Still zero runtime dependencies.

**Two verbs ship.** `src/verbs/blastRadius/` asks what depends on a file (40 challenges here);
`src/verbs/companion/` asks what *changes with* it (31 here, 54 on hono, 508 on svelte) — the first
verb graded on git rather than on imports, and the one that reaches the edgeless files the import
graph structurally cannot. Together they leave 27 of this repo's 113 nodes unprovable where Blast
Radius alone leaves 35; on hono 178 against 269, on svelte 3,283 against 3,776. The four §8.3
distractor strategies pick the wrong answers for each, difficulty is computed per §8.4, and the
player has a challenge console over the map with partial credit, a derived per-file reveal, and fog
that lifts on what you prove. **Progress survives a
reload**, keyed on the repo's root commit, and a **"Where next?" panel** walks you through the deck.
**Field notes** record what you proved — never what you were shown. 49 KiB of JS, zero runtime
dependencies, first paint ~240 ms. `npx ark index .` produces a valid ~101 KiB atlas in ~270 ms.

The semantics are **[ADR-0008](./docs/decisions/0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)**
and are not open: truth is the unbounded transitive dependent set, the generator maintains
`candidates ∩ dependents(subject, ∞) = truth`, the prompt promises dependence rather than required
change, and the map shows direct importers only until a node is in `fog.understood`.

The save's shape is **[ADR-0011](./docs/decisions/0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)**
and is likewise settled: `Progress` is the state and `Fog` is a view of it, the key is `repo.root`
(identity) and never `repo.head` (staleness), a pass is keyed by `(verb, subject)` and never by
`challenge.id`, and every restored claim is re-checked against the live graph before it renders as
knowledge.

The third dimension is **[ADR-0013](./docs/decisions/0013-height-is-the-transitive-dependent-count.md)**
and is frozen: `elevation` is the bit length of a file's transitive dependent count, one layer up is
twice as depended-upon, and the meaning does not change in a later rung — X,Y are frozen because a
re-layout scrambles learned maps, and vertical memory has the identical argument. Height means
*load-bearing*, never "importance": under it an **entry point sits at sea level**, which tier 1's
first question needs and which a separate glyph will have to serve.

Why the world is orbited and not walked is **[`docs/prior-art.md`](./docs/prior-art.md)**, which
closed risk #6 and ADR-0009's P1: no tool in the category died of 3D legibility, but the evidence
splits on **viewpoint** rather than dimension — 3D wins from outside a structure with motion
parallax, and loses from inside it. **P4 stands: the walkable avatar waits for the Trace verb (M6).**

CI runs every suite on push and PR, including a three-platform check that the same commit yields a
byte-identical atlas, and a headless browser smoke test that plays a challenge, reloads the page,
turns the world and fails on any console error. **There is no Pages deploy** — `pages.yml` is
deleted, not disabled, and **[ADR-0015](./docs/decisions/0015-pages-is-not-deployed-while-the-repo-is-private.md)**
says why and gives the one-line restore: it failed on every run it ever had, because the repo is
private and Pages there needs a paid plan. Its zero-challenge guard was not migrated because
`test:atlas` (`> 20` on a fresh build) and `test:e2e` (which actually plays a question) already hold
it more strongly — checked by mutation, not assumed.

The M2 kill-point caveat — several pairs of subjects with identical answer keys — is **closed at the
source**. **[ADR-0012](./docs/decisions/0012-an-answer-key-is-issued-once.md)**: the generator issues
each answer key once, re-asking a colliding subject with a disjoint window of its own dependents
where the cone allows and refusing it as `duplicateKey` where it does not. Measured on four repos, no
repo loses a *distinct* question — svelte's deck was 61% repeats and is now 153 distinct questions
where it had 138. The cost is reported rather than absorbed: `report.unprovableNodes` says how many
nodes no question can ever lift the fog from.

Next action: **draw the co-change relation on the map.** Companion asks about a coupling the player
is never shown — the map has no history channel at all — so the reveal does all the teaching, and
§4's "fog lifts around what you proved" is only half kept: a Companion pass lifts fog on what it
proved and changes nothing else on screen. It is the one change that would make the new verb's
payoff match Blast Radius's, and the data is already in the atlas.

**A measured correction to the brief this session inherited**: `maxCommitFiles` does **not** limit
the git verbs' co-change signal. The matrix is accumulated from `touched` *before* that truncation,
and over every walked commit rather than the 500 retained — verified against `git log`, where hono's
`context.ts`/`context.test.ts` pair scores 72 and the newest 500 commits contain about 5 of them.
What actually bounds Companion is `maxCommitsWalked` (20,000), `wideCommitFiles` (25) and
`maxCoChangePairs` (8,000, which has never bitten on any repo measured). `maxCommitFiles` limits
**Placement and Archaeology**, whose ground truth *is* a retained commit's file list — which is one
reason neither of them was the verb to build first.

Then, in evidence order: **map rotation between challenges** (`docs/prior-art.md` §4.4 — map-derived
spatial memory is *orientation-locked*, ours is north-up forever, and it is the highest-leverage
lowest-cost item in the whole writeup); **the negative witness** (a wrong pick already has a known
reason class — sibling, name-alike, distance n±1, co-change ghost — and we never say it); and **the
phenomenon catalogue**, a repo-independent vocabulary of ~30–60 structural phenomena that would give
the product an atom that *transfers* to another repo, which is risk #1.

Smaller and still open: the twins a duplicate answer key drops are never mentioned to the player
(`cone(A) = cone(B)` is a true derived fact and must be *shown*, not proved — ADR-0011 decision 3);
node labels near the top edge draw underneath the inspector and HUD; the orbit does not re-fit on
entry and has no frustum cull. And one measurement only a human can take: **`npm run raster` on real
hardware** — 45/33/43 fps is a headless software floor, and ADR-0009's P1′ gates the renderer on it.

The verb seam was the real work of M4 and it is worth knowing what it now costs to add a third:
`difficulty.ts`, `gate.ts` and `paths.ts` live at `src/verbs/` rather than inside a verb, and
`reveal`, the reveal's summary sentence, the grade's phrasing, the button label and `stillHolds` are
all on the `Verb` contract. Nothing in the console, the notes or the map names a verb any more.
`(verb, subject)` is the key everywhere `subject` used to be — saves, the deck, the selector's
attempt counter — and **each of those was a live defect, not tidying**: keyed by subject, a full
playthrough of this repo served 60 of its 71 questions and called the deck finished.
