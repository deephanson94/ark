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
| Map interaction | ≥ 50 fps @ 2,000 nodes | Below this, switch Canvas → WebGL, not before |
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
- **`git log --date=short` renders each commit in its *own* recorded timezone.** So a repo with
  contributors in two zones produces dates that do not decrease along the log, and two commits made
  at the same instant get different dates. Use `--date=short-local` with `TZ` pinned.
- **`git log` orders by *commit* date; `%ad` is the *author* date.** Even in one timezone they
  disagree after a rebase or a mailed patch, so "the log is newest-first" is not a claim you can
  make about the dates you kept. Sort explicitly and tiebreak on sha.
- **Dates are not the only thing git renders per-commit.** If a field comes from `--format`, ask
  what it depends on besides the commit.

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
npm run index              # index this repo → atlas.json  (the bootstrap fixture)
npm run build              # typecheck + bundle
npm run test:unit          # fast — every change
npm run test:atlas         # schema + integrity of the generated atlas
npm run test:determinism   # index twice, assert byte-identical
npm run budget             # print measured budgets, fail over ceiling
npm run test:e2e           # slow — ask before running
```

---

## Current state

**M0 delivered.** `docs/atlas-format.md` (schema v1), `src/atlas/` (types, validation, graph
queries), `src/indexer/` (walk, scan, resolve, git, history, layout, regions), `src/verbs/`
(contracts + F1 scoring). `npx ark index .` produces a valid 27.5 KiB atlas for this repo in ~110 ms.
`challenges` is `[]` — generation lands with the Blast Radius verb at M2.

Next action: `npm run budget` as a real script, then M1 — every node already carries `layout` and
`region`, and nothing renders them.

Roadmap kill point is **M2** — if the Blast Radius verb isn't engaging on a repo we wrote ourselves,
stop and rethink the verb rather than adding a second one.
