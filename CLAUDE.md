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
| [`README.md`](./README.md) | **Where we are**: architecture, and a done/ongoing/todo status for every milestone, verb and subsystem | On pickup; **update at every close-out** |
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

1. **Read** `NORTH-STAR.md`, this file, `README.md`'s **Status** section, and the last few lines of
   `CHANGELOG.md`. The first two say what and how, the last says when — `README.md` is the only one
   that says *where we are*.
2. **Pick one thing.** One clear objective per session. Not three.
3. **Implement it end to end** until it is actually usable — not scaffolded, not stubbed.
4. **Verify** (see testing strategy below).
5. **Close out**: bring `README.md`'s **Status** into line with what is now true, append one line to
   `CHANGELOG.md` — what you did, and what you'd do next — then commit and push.

If you discover a second thing worth doing, write it in the CHANGELOG "next" note. Don't do it.

### The README's status is a live claim, not a release note

`CHANGELOG.md` is append-only history and `README.md` is the **current** state, so they rot in
opposite ways: a changelog entry is wrong only if it was wrong when written, while a status table is
wrong the moment the code moves past it — and it goes on *reading* as current, which is worse than
having none. So it is maintained **progressively**, in the commit that changes the thing, not batched
at the end of a milestone:

- A subsystem or verb starts work → **⬜ → 🟡** in the same commit as the first code.
- It becomes usable → **🟡 → ✅**, and that transition needs the **same evidence as any other "done"
  claim in this file** — end to end, verified, not scaffolded. *A decision is not a delivery*: this
  repo has a milestone that read "delivered" for two sessions while one of its three verbs existed.
- A gap is found → it goes in **Known gaps** with its measurement, whether or not anyone fixes it.
  That section is the honest half of the document and the reason a reader can trust the rest.
- The **Next** line moves with `CLAUDE.md`'s Next action. Two places, one fact — check them against
  each other, because this file has a landmine about a rule that lives twice.

**Any figure in it names the commit it was measured at.** Ark indexes itself, so an unstamped number
is false by the next commit. Prefer the invariant to the count wherever one exists.

This obligation stands while the project is under development. If a session ever finds the tables
already correct, that is a one-line check, not an exemption.

---

## Testing strategy

The pyramid, fastest first. It will grow; keep it ordered by cost.

| Command | Covers | Target time | When |
|---|---|---|---|
| `npm run test:unit` | Verb `grade()` functions, F1 scoring, graph queries, distractor generator | < 5 s | **Every change** |
| `npm run test:atlas` | Indexer produces a schema-valid atlas for this repo; no dangling edges; every `challenge.truth ⊆ candidates` | < 15 s | Every change touching the indexer |
| `npm run test:determinism` | Index this repo twice → **byte-identical** output | < 30 s | Every change touching the indexer |
| `npm run build` | TS compile + bundle + emit the CLI | < 5 s | Every change |
| `npm run test:pack` | Pack the tarball, install it **outside this checkout**, run `ark index` and `ark play` | ~30 s | Every change to packaging, the CLI, or the player's build. *CI runs it on every push* |
| `npm run test:e2e` | Headless playthrough: load atlas, render map, answer a challenge, see a grade | minutes | Big changes only — **ask first locally.** *CI runs it on every push* (the `player smoke test` job), so it is never actually unrun on a pushed commit |

**Rules:**

- **Ask before running the slow suite** on a small change. Offer "full / fast only / none." **This
  governs *you*, not CI** — `ci.yml`'s `player smoke test` job is `npm run test:e2e` and runs
  unconditionally on every push, so a pushed commit has always had it. A session read this row, did
  not open `ci.yml`, and told the human three times that e2e was unrun and awaiting their decision.
  A rule about your own behaviour is not a fact about the project's.
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
  ask *which verb's claim is this?* **And ask it of the members, not just the subject.** The
  verb-keyed replacement still returned the files picked correctly *inside someone else's question*,
  so proving that D depends on S drew D's own cone — which by ADR-0008's own invariant *is* D's
  answer key, byte-exact, on 26 of this repo's 40 boards. It survived two reviews as "settled fine"
  and was reclassified as a defect by a third. The decision of record had said the right thing all
  along (*"unlocked by passing that node's challenge"*); nobody had checked the code against it.
  **When an ADR states a rule in words, grep for the code that implements it** — a divergence reads
  exactly like a design choice once it has been in the tree for a milestone.
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
- **`.first()` in a UI assertion is an ordering assumption, and it will be wrong on a repo that
  changes.** The e2e checked the *first* field note against the *first* challenge it played. Notes
  are sorted by descending radius (`notes.ts`), which has nothing to do with the order you proved
  them in, so this was comparing an arbitrary pass's note against another pass's answer key — and it
  passed for four milestones because the two happened to coincide. What exposed it was a commit that
  changed **only prose**: ark indexes itself, so the deck moved, the grid scan landed on a different
  first subject, and an assertion nobody had touched went red. Select the row by something it
  *claims* (here, the subject path), and assert the property over *every* row rather than over the
  top one. **Reading `[0]` to check a ranking is the same bug with no UI in it**: a test for
  Placement's new `coChange` ordering read `picked[0]`, but `candidates` is sorted by **node id**, so
  the assertion was checking the id sort and would have passed against any ranking that happened to
  agree with it. Assert the picked *set* against the top of the ranking instead — a list's order is
  a claim about the list you are reading, not about the code that filled it.
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
- **A payoff that appears and then withdraws is a lie the tests cannot see.** The co-change layer
  first shipped with two gates: an ungated flash of every pair the open reveal named, over a gated
  persistent layer. It reads perfectly in the moment and the reveal said *"now drawn on the map"* —
  and **79% of those wires vanish when the panel closes** (6 promised, 1 kept, and 4 of 40 boards
  keep nothing at all). Every suite passed, because a suite checks a state and this defect lives in
  the *transition* between two. It surfaced only from asking "how many of the things I just promised
  are still there one click later" and computing it. So when a rendering is gated, **count what
  survives the gate, not what the gate emits** — and prefer one rule to two, since every one of
  ADR-0014's leaks was a rule that lived twice.
- **A measured constant written into prose is false by the next commit, and ark measures itself.**
  A review spot-checked ADR-0016's figures against the data: the structural ones reproduced *to the
  digit*, and two did not — "all 174 pairs" (the matrix was 173, then 180, then 200) and "24 of 27
  qualify" (it was 22 of 24). Neither was ever true; both were transcription drift from an atlas that
  had moved. The same rot hid "49 KiB of JS" and "31 companion challenges" in this file's own Current
  state for two sessions. The fix is not more care: it is **preferring the invariant to the count** —
  "every pair the matrix records is sampleable" holds forever where "all 174 pairs" holds for one
  commit — and, where a number really is the point, **naming the commit it was measured at**.
- **A subject is not necessarily a node, and for two milestones nothing in the player knew that.**
  `Challenge.subject` was typed `NodeId`, which is `string`, so when Placement's subject became a
  commit the compiler saw **nothing** — and nine separate places had baked in the assumption. Three
  were the field notes (ruler, sentence *and* label), which would have dropped every Placement note
  in silence or claimed a sha had direct importers. The worst was `save.ts`, where `asPass` required
  `isNodeId(subject)`: a pass it rejects is dropped at parse and erased by the next write, so every
  Placement pass would have died on the second session — **the identical failure that file's own
  comment describes for `VERB_IDS`, one field down and unnoticed**. The others put a commit id in
  `surveyed`, decayed every Placement pass at restore, keyed a deck bucket no node can resolve, made
  the guide's button look live and do nothing, and counted "questions left" off the map's *ring* set
  so the HUD read *"36 questions ringed on the map"* over a map with none. None of these was findable
  by type-checking or by any existing test. What found them was grepping every read of
  `challenge.subject` and `pass.subject` and asking *what am I assuming this names?* — so **when a
  type is an alias for `string`, the alias is a comment, and the assumptions it licenses live in
  every reader.**
- **A counterfactual is only as good as the thing it holds fixed.** ADR-0018's first draft claimed
  the churn gate refused *"25 of 37 commits, leaving a deck of 8"* without `busy` distractors. Run
  through the real generator it is 10 and 31, and deleting the strategy *alone* moves the number from
  1 to 3 — because the `distant` padding walks the churn ordering busiest-first, so high-churn wrong
  answers reach the board anyway. The prototype that produced the original figure filled boards with
  the **lowest**-churn files it could find, which manufactured the effect it then measured. It
  changed two knobs and named one. The same ADR did it a second time in the same session — "+0.36 s
  of index time on hono", from comparing the branch against `master`, two trees with different file
  counts; measured properly the cost is inside the noise. Measuring first is not enough on its own:
  **say what the counterfactual holds fixed, and check that it holds it.**
- **The soft spot is where the change is proudest.** ADR-0018 spent more words on one paragraph than
  on anything else — the argument that Placement certifies a wrong answer from a commit's *positive*
  file list, so absence cannot hurt it — and that paragraph is where the wrong answer key was. It was
  correct about the walk window and then applied to a shallow clone, which is a different mechanism:
  a `--depth N` clone's oldest commit has no parent, so git diffs it against the empty tree and
  `--name-status` calls it *an add of the entire worktree*. A repo of 8 files grown to 38 and cloned
  at depth 2 shipped a board whose key held three files predating the commit by eight commits. Nothing
  in the type system or the suite could see it; a reviewer told to attack the argument found it in one
  step. **When a decision record leans hard on one paragraph, that paragraph is the thing to hand
  someone and say "break this".**
- **Two true facts in two different files can be a pillar-3 leak that neither file can see.** The
  Placement prompt prints a commit's date. The inspector prints every node's *last seen*. Neither is a
  disclosure; together they are "tick the candidates whose dates match", which beat band A on **16 of
  hono's 54 shipped boards** and on **none** of ark's 37. Every existing gate heuristic came from
  asking *what does this board invite?* inside one verb; this one needed asking *what else is on
  screen at the same time?* The three-way alignment ADR-0014 decision 7 describes — map giveaway,
  naive guess, gate heuristic — is a checklist to run against **every** field the UI prints, not only
  the one the verb is about.
- **CI indexes a commit that does not exist on your branch.** GitHub Actions checks out
  `refs/pull/N/merge` — master merged with your head — so the repo ark indexes there has a *different
  git history* from the one on your machine, and every history-derived field moves with it: churn,
  co-change, the retained commit list, and therefore **which questions exist at all**. Any test that
  depends on the shape of the deck can pass locally and fail in CI, deterministically, on an input
  you never ran. Two did in one run: a **cross-verb duplicate answer key** that only the merge
  history produced, and an e2e step whose `.find()` landed on the board another step had already
  answered. `test:determinism` structurally cannot see this — it indexes one commit twice, and this
  is two different commits. Reproduce before pushing with
  `git checkout -b x origin/master && git merge <branch>`, which is the exact tree CI builds.
- **A test can assert more than the contract, and get away with it until the data catches up.** The
  atlas test read *"no two challenges with the same key"* while `docs/atlas-format.md` §3.6 and
  ADR-0014 both say uniqueness is **within-verb**, in as many words — *"two different verbs may
  honestly share an answer set, because they are asking different questions about the same files."*
  It passed for two verbs because a cross-verb collision never happened to occur. The third verb made
  one, and the pair is not a repeat but the best pair of questions in the deck: a Companion key, and
  the Placement board for the commit that *caused* that coupling. The failure looked exactly like a
  generator bug for as long as it took to read the two documents. **When a test goes red, check it
  against the contract before you change the code** — the stricter assertion is the more likely
  suspect, because nothing was ever checking it.
- **"CI is green" is a claim about *every* workflow, and there was more than one.** `pages.yml` had
  failed on every run it ever had — before M4 landed and after it — while a session reported CI green
  three separate times, because it only ever opened `ci.yml` runs on its own branch. The human
  spotted it, not the agent. The mechanism is worth naming because it is not simple carelessness: a
  check that is *permanently* red gets normalised into background noise, the mirror image of the
  instrument that always reads good and therefore gets believed. So **list the workflows before you
  claim they passed**, and check them on the branch the commit actually landed on. The failing
  workflow is deleted (ADR-0015) precisely so that a red X on this repo means something again.
- **Two verbs can be the two projections of one relation, and then the second one's answer key is
  already sitting in the first one's reveals.** Placement asks *commit → which files?* and
  Archaeology asks *file → which commits?* — the same incidence matrix read along its two axes. So
  every Placement reveal, which names the files a commit touched, states an atom of some file's
  Archaeology key outright: **55.6% of this repo's key members, and 15 of 66 boards disclosed
  entirely** (16.0% and 1 of 172 on hono). Nothing inside either verb can see it, `test:atlas`'s
  `(verb, truth)` uniqueness check *structurally cannot* — one key holds node ids and the other
  commit ids, so a collision is not even expressible — and the direction it runs in is the one
  nobody looks at, since the offending reveal was written a milestone earlier. Note the shape of the
  asymmetry too: it is worst on the **bootstrap repo**, because a small commit count means the
  earlier verb's deck covers nearly all of it (39 of 46 eligible commits here, 54 of 475 on hono), so
  the repo pillar 6 says must work is the one where the leak is largest. **Before adding a verb, list
  the atomic facts every existing reveal already states, and check whether your answer key is made of
  them.** ADR-0012's uniqueness rule is about a *set*; this is about the facts inside it, and the
  rule that covers it did not exist until ADR-0019 decision 7.
- **The throwaway probe is not exempt from the invariant it is measuring.** The measurement that
  justified that exclusion filtered a file's toucher list *before* computing membership, so every
  excluded toucher fell into the distractor pool — **a board offering a commit that really did touch
  the file and marking it wrong.** A wrong answer key, inside the counterfactual that was about to
  justify the rule. It never shipped because it was never code, which is exactly why nothing would
  have caught it: no suite runs a scratch script, and its output is prose in a decision record.
  Re-measured, the conclusion held — which is luck, not method. And in the same document the
  counterfactual table's first draft measured every row with one decision switched **off**, so it
  described a shape the document did not propose: as decisions accumulate, **the baseline moves, and
  rows measured before the last decision are measuring a dead design.** Re-run the whole table
  against the final baseline before quoting any of it.
- **An error message's suggested remedy is a hypothesis, not a fix, and taking it is the
  impossibility landmine inverted.** `actions/configure-pages` failed with *"verify that the
  repository has Pages enabled … or consider exploring the `enablement` parameter"*, so `enablement:
  true` was set, shipped, and written into ADR-0031 as a **decision** in the same commit. It cannot
  work: *creating* a Pages site is an `administration: write` operation and the workflow
  `GITHUB_TOKEN` cannot be granted that permission at all — `pages: write` deploys to a site and does
  not create one, a distinction the suggestion does not make. This repo's usual failure is an
  unchecked claim that something **cannot** be done; this is the same shape pointed the other way,
  and it is easier to fall for because the source is the tool's own error text. One question would
  have caught it — *which permission does this need, and can the token hold it?* What did catch it
  was reading the next run, which is a slower instrument than a question.
- **A different instrument is not drift.** ADR-0019 "corrected" a recorded 0 to 16 — issue numbers on
  this repo's commits — and cited the measured-constant landmine while doing it. The 0 was right. The
  sixteen `#N` references are all `Merge pull request #N` subjects, and `git log --name-status`
  without `-m` emits **no file list for a merge commit**, so `touched.size > 0` fails and not one of
  them is ever retained; the atlas says 0, and *retained* is the only sense in which a commit is verb
  supply. The same paragraph reported hono as 364 carrying / 368 distinct, which the atlas cannot
  represent — `issue` keeps only the first `#N` of a subject, so distinct can never exceed carrying;
  both figures came from counting tokens in `git log` output. **When a recorded number looks wrong,
  first check that you are measuring it with the instrument that decided it** — here `atlas.json`,
  not the log the atlas is built from. Drift is what happens when the same measurement moves; this
  was a different measurement wearing its name. (It did pay for itself once: the merge-commit fact
  above is real, and means every merge is invisible to a commit-membership verb.)
- **The bug you already fixed is still there, one line down, in the same function.** ADR-0018 found
  `notes.ts` resolving a *subject* through `refById` and `continue`ing on the miss, which would have
  dropped every Placement note in silence; it fixed that field and left the loop directly below
  resolving each **member** the same way. A milestone later Archaeology's members became commits and
  the identical defect was live again — same file, same function, same `continue`, four lines apart.
  The same session found `cli.ts` carrying a comment explaining why a commit *subject* must be
  filtered out of a coverage count, sitting above a loop that did not filter the *members*. **A fix
  written for one field is evidence about its neighbours, not a fence around itself**: when you
  repair a shape assumption, grep the enclosing function for every other read of the same shape
  before you close the file.
- **A gate heuristic measured on a prototype can be exactly backwards.** ADR-0019 decided its Ctrl+F
  set from a throwaway probe that scored `oldestK` beating 24 of hono's boards and `recentK` beating
  none — so it shipped the first and excluded the second, in writing, with the exclusion justified by
  the measurement. Run through the real generator the two swap: **`oldestK` fires 0/0 and `recentK`
  refuses 3 hono boards.** Nothing about the reasoning was wrong; the prototype simply had a different
  distractor mix, and the guess a board invites depends on what else is on the board. The ADR's own
  hedge — *"it is dead under this configuration"* — is the sentence that saved it. So **a heuristic
  excluded on a measurement must be re-scored when the thing it was measured against is replaced**,
  and "we measured it and shipped it anyway" is the sentence to avoid in both directions.
- **A fixture can be so regular that every assertion passes vacuously.** Archaeology's first unit
  fixture gave each commit its own date, which looks like tidiness and is a degenerate case: a file
  touched exactly twice has a key of `{first, last}`, which is precisely what the `endpoints` guess
  picks, so the gate refused every 2-toucher board and the fixture shipped **one**. Twelve assertions
  about choice sets, windows and distractor mixes ran against that single board and passed. Nothing
  was red, nothing was wrong, and nothing was being tested. Real repos land several commits a day.
  **Check the size of the population your fixture actually produces before trusting a suite over it**
  — the count is one line and it is the difference between a suite and a decoration.
- **An upstream fix is a claim with a measurement attached, exactly like the fix itself — and the
  reason it fails is a second claim, which is where the error will be.** ADR-0022 gated a co-change
  guess downstream and recorded that the honest fix was probably upstream: put the partners on the
  board as wrong answers and the guess stops being precise at the source. Measured board-fixed, the
  strategy removes **zero** verdicts on ark and 6 of 14 on hono — so the lever is real on one repo,
  dead on the other, and *"not a gate"* is the right conclusion. **The explanation shipped in the
  first draft was wrong, in the paragraph the document spent the most effort on**: it argued a
  distractor anchored on the answer key *cannot reach* a seed that is not adjacent to the key, which
  is false set logic — `partners(key) ∩ partners(S) ≠ ∅` does not need `S ∈ key` — and false in fact,
  since **4 of the 6 hono removals are seeded off the board**, the class it called unreachable. A
  post-ship review found it by diffing the verdict facts the document's own control row isolates. Two
  lessons: an impossibility argument is worth less than the measurement it decorates, and **when a
  measurement and an explanation ship together, the explanation is the one nothing tested**.
- **A strategy named after a conjunction will enforce the first clause and skip the second, and the
  label will still look right.** §8.3's best class is *"files that co-change **but don't import**"*.
  Placement's implementation consulted the matrix and never the graph, so a file that both imported a
  changed file and moved with it shipped under a purely-historical label: 9 of this repo's 98 rows and
  **67 of hono's 141 — 48% of the second repo's**. Nothing was red; the class *exists*, its rows are
  genuine co-change pairs, and the one repo a session looks at hardest was the one where it barely
  fired. Enforcing the second clause cost **1 row here and 2 there**, because supply was never the
  constraint. So: **when a class name contains an "and" or a "but", write one assertion per clause**,
  and measure each on the second repo — the label-versus-description landmine has now bitten a witness
  sentence, a docstring, a guard, and a strategy's own selection rule.
- **Withholding a class hides it only while another class is also silent.** ADR-0020's rule is
  withhold by class, never by row, because a per-row guard makes the absence say which row it was on.
  It is quieter about what happens when the silent *set* has one member with supply: Placement's
  `distant` ships **0 rows on both repos**, so an unexplained row is now uniquely a co-change pick and
  the silence states the disjunction the sentence would have. The rule still holds — an implied
  relation is accepted where a stated atom is refused (ADR-0019) — but *"we withheld it"* is not the
  same as *"the player cannot get it"*, and which one you have depends on a count nobody was taking.
  Take it: how many classes are silent, and how many rows does each ship?
- **Adding the fourth of something reveals the first three never had it.** Writing Archaeology's
  invariant into `tests/atlas/` showed that **Placement's had never been checked on the real atlas**
  — `candidates ∩ files(commit) = truth` lived only in a unit fixture, for a whole milestone, in a
  verb whose ADR is mostly an argument about that exact certification. The suite looked complete
  because every verb had *a* test. When you add a peer to an existing family, list what the family is
  checked for and check the list against each member, not against the newcomer.

- **Reading a requestAnimationFrame-driven value without waiting for a frame is a race that only
  loses on someone else's machine.** The e2e asserted the map's board-marker count straight after
  `waitForSelector('.console-panel')` — but the panel appearing is synchronous DOM and the count is
  written inside the rAF loop. Locally a frame had always landed first; **CI reported `0 marks` on a
  board that draws six**, so the suite was green here and red there on identical code, and the
  failure text (*"a companion board marked 0 places"*) reads exactly like the feature being broken.
  Poll with a deadline rather than reading once — the deadline is what keeps a genuinely dead layer
  failing instead of hanging. Note this is *not* the merge-commit landmine below even though it wears
  its clothes: the tree was identical and the machine was slower.

- **The obvious fix for a leak can close none of it, and the arithmetic is what says so.** The
  select-all farm — tick everything, read the annotated key, reopen, score 100% — looks like it is
  fixed by *withholding the answers the player did not pick*. Under select-all there **are** none:
  every truth member is a `correct` note, so the filter matched zero rows and the reveal named the
  key exactly as before. Keeping the `spurious` rows as the mitigation fails one step later, because
  `picks = correct ∪ spurious` and naming one names the other **by complement**. And the narrow
  version — keep the rows when coverage is low — dies to `f1(1, recall) ≥ 0.5 ⟺ recall ≥ 1/3`, so
  learning which of your picks were right passes next time from a third of the key. Three drafts,
  two killed by a unit test on its first run and one by four lines of algebra. **When a fix withholds
  information, write down what the remaining information determines** — and note that the surviving
  rule cost a *shipped feature* part of its reach (ADR-0020's witness now speaks only above the bar),
  which surfaced as a red e2e step rather than as a decision anyone took.

- **A suite that checks the shape of a sentence never checks whether it is true, and three cold
  playtesters found what 780 assertions could not.** Every prompt ended with *"Wrong picks cost you
  nothing"*, which §8.2 makes **false** — a spare pick lowers precision, so the right file plus two
  plausible wrong ones scores 50% where the right file alone scores 100%. Archaeology told the player
  a commit message *"names this file"* on the strength of **one shared token** (`"Refactoring and test
  changes"` naming `extensions-test.ts`), which is **87% of graphql-js's firings, 82% of kysely's,
  54% of hono's** — not an edge case. And a grade showed `1 of 1` beside `33% · not yet` with nothing
  on screen naming precision or recall. `reveal.test.ts` and `notes.test.ts` assert which note exists
  and which class it carries; **no test anywhere held a sentence to being true**, so all three
  survived four milestones with the suite green. The strategies were right in every case and the
  *glosses* were separate claims nobody checked, which is the class-label landmine arriving in a
  prompt, a witness line and a score. **When you write a sentence the player can check against what
  is on screen beside it, write the assertion that checks it too** — and note the shape of the
  cheapest fix: hold the strong claim to the rows that earn it and give the rest a weaker sentence
  that is true, rather than narrowing the strategy and starving the class.

- **The shallow-clone landmine has a version where the shallow clone is *yours*.** Every warning in
  this file about `--depth` is about a repo you cloned to measure. But a cloud session's own checkout
  of ark can be shallow too — this one was, at 148 commits — and then `npm run test:atlas` fails
  **12 of 111** assertions the moment you touch anything, because `src/verbs/commits.ts` refuses the
  history deck on a shallow repo and all three history verbs ship zero boards. The failures name
  Companion, Placement and Archaeology invariants, so they read as *"your change broke the
  generator"*, and the change in hand was in the player and could not have. `git fetch --unshallow`
  fixes it; **`git rev-parse --is-shallow-repository` before you believe a red suite** is the habit,
  and it is the same one line the standing constraints already ask for before believing a *number*.
  Note which way this one errs: a shallow checkout makes the suite look **broken**, where a shallow
  clone in a measurement makes the number look **fine**. And `ci.yml` has set `fetch-depth: 0` since
  M0, under a comment saying precisely this — so the knowledge was in the repo, on the one machine
  that was never going to be caught by it.

- **A figure about this repo is measured on the tree that does not yet contain it.** The session that
  built Archaeology re-measured ADR-0019's tables — the ADR's own instruction — and wrote every ark
  figure down wrong: node counts included an untracked probe script, and commit counts predated the
  commit the section claimed to be measured at. **The hono column reproduced perfectly**, which is
  the only reason the cause was findable at all. This is not the measured-constant landmine (a number
  going stale); it is narrower: **the act of recording a measurement about a self-indexing repo
  changes the thing measured**, so a figure taken from the working tree is false the moment it is
  committed. Measure on a clean clone of a *named* commit — `git clone . /tmp/x && git -C /tmp/x
  checkout <sha>` — and put the sha in the prose. Then the number stays checkable forever instead of
  for one commit.
- **Two individually-honest panels can state contradictory facts, and no suite can see it.** The
  Archaeology reveal computed "how many commits touched this file" from the *eligible* set and the
  field note computed it from the *retained* set. Each surface was internally consistent, each had
  passing tests, and they disagreed on **21 of 26 boards** — with the reveal printing *"that is every
  commit in this window that touched X"* over a record that held more, which is **false and
  falsifiable by the player with one `git log`**. A test asserts a state; this defect lives *between*
  two states, exactly as ADR-0016's vanishing wires did between two frames. When two surfaces
  describe the same population, assert that they **agree**, not that each is individually right.
- **A threshold named for its English is a threshold nobody measured, and one row can kill it.**
  ADR-0025's clause 2 was first written as *the map must hold a **majority** of the repository's
  source* — chosen precisely because majority is the only value on `[0,1]` with a name instead of a
  number, which felt like the opposite of arbitrary. It **refuses `sveltejs/svelte`**, whose 4,462
  `.svelte` files outnumber the 3,467 its compiler is written in: a JavaScript tool refusing the
  Svelte repo. Sorted, the mapped share of the ten repos that clause decides reads 99.7,
  99.1, 97.0, 95.7, 43.7 │ 2.5, 1.5, 0.0, 0.0, 0.0 — the gap is 2.5% → 43.7% and a majority rule sits
  *outside* it, 1.14× from the nearest ship. (The eleventh, `awesome`, is *also* 0.0% and ships,
  which is what the other clause is for — so quoting this axis as if it separated eleven repos would
  itself be the error one row down.) **Put the bar in the largest gap and name both neighbours**; the roundness of the
  number is a tie-break, never the argument. And note which way the error ran: the semantic bar was
  *stricter* than the data supports, so it would have withdrawn a working deck, which is the failure
  a session congratulating itself on being conservative will not notice.
- **A conjunction is only justified by the row each clause alone gets wrong.** Asserting both halves
  separately (the landmine below) catches a clause that stops firing; it does not catch one that
  never needed to exist. ADR-0025's rule is *body of unreadable source* **and** *map holds under a
  tenth of it*, and the check that earned the "and" was running each half alone over eleven repos:
  clause 1 alone is wrong on three (react, next.js, svelte), clause 2 alone is wrong on one
  (`awesome`), together zero. Before that measurement clause 2 changed **no** verdict on the eight
  repos then in hand, and would have read as decoration. **Count the verdicts each clause flips, not
  the times it evaluates true.**
- **A candidate signal can be refuted outright, and that is cheaper than preferring another.** Two
  rules were on the table for the same job. The first — *no scanned-language nodes ⇒ refuse* — is
  wrong in **both** directions on the same table: 24 stray JavaScript files save hugo and 45 save
  django, the two worst offenders, while `sindresorhus/awesome` is refused for being what it says it
  is. The second — `unsupported / onDisk` — needs no taste at all: refusing hugo requires a bar
  ≤ 58.7% and `awesome` sits at **69.6%**, so the shipping and refusing sets *overlap* and **no
  threshold exists**. Two cells settle it forever. Look for the pair of rows that makes a candidate
  impossible before arguing about where its bar should go.
- **A count of zero has more than one cause, and the panel that reads it merges them.** With the deck
  refused, the guide said **"every question answered"** — over a repo that was never asked one — and
  the HUD said it again **141 lines down the same file**, in different words off a different
  variable, because both ultimately derive their sentence from a deck count of zero. Neither was wrong when it was written; a second cause for the same
  number arrived later. This is the verb-blind-state family with no verb in it: **when you add a new
  way for a quantity to reach its extreme, grep every reader of that quantity and ask what it thinks
  the extreme means.**
- **A margin under a bar is a deferral with a timer on it, and on a self-indexing repo the timer is
  the next commit.** ADR-0021 measured a structure-blind hint at **0.769** against a 0.78 gate bar,
  called it accepted, and shipped a canary to hold it there. That is a margin of **0.011** — and this
  file already had the landmine saying a lower bound quoted as a margin is how a knife edge gets
  recorded as a plateau. Three milestones later an ordinary commit — two test files and a comment —
  re-rolled the Placement deck and the union hit **0.800**. Nothing about the change touched the deck;
  ark indexes itself, so *any* commit re-rolls it. **When a measured exposure sits inside a few
  hundredths of a threshold, the honest options are close it or state the date it will fail** — not
  accept it and write a test that will one day fail on somebody else's unrelated work.
- **When a guard is refused as "too costly", price the cost in the unit the player feels.**
  Withholding that class silences **171 of this repo's 626 spoken witness rows**, which reads as a 27%
  regression to the negative-witness feature and is why a cheaper guard was hunted first. But
  `discloses` never calls the reveal and neither does any generator, so **the deck is byte-identical
  and not one question is lost** — 171 *explanations* go, zero *questions*. The scary number was
  counting rows in the wrong ledger, and the two cheaper guards it sent me hunting were both refuted
  by measurement (by-board bounds 0.667 against a 0.800 union; narrowing the class scores 0.800 too).
- **A rule about your own behaviour is not a fact about the project, and the testing table reads like
  both.** The row for `test:e2e` said *"Big changes only — **ask first**"*, which is an instruction to
  the agent; a session read it as a statement that the suite had not run, told the human three times
  that e2e was outstanding and awaiting their decision, and was wrong every time — `ci.yml`'s `player
  smoke test` job **is** `npm run test:e2e` and runs unconditionally on every push. The Definition of
  done's *"no console errors in the player"* had been satisfied continuously by a job nobody looked
  at. Both halves are this repo's own landmines arriving together: a claim about code checked against
  a document instead of against the code, and *"list the workflows before you claim they passed"* run
  in reverse — never having asked what they *do*. The table now says so; when a document tells you
  what to do, it is not thereby telling you what has happened.
- **A list has a failure mode a rule does not, and "we excluded that on purpose" is the sentence that
  hides it.** ADR-0025 refuses a deck by counting *program source ark recognises and cannot read*,
  which sounds like a rule and is a **table of 64 extensions**. Three commits after it shipped, a
  Terraform repo — 77 `.tf` files, 24 Markdown — produced **64 challenges about the documentation with
  `report.unreadable` empty**: the original defect, intact, with every new surface silent, because
  `.tf` was not on the list. The Known-gaps row made it worse by naming the *deliberate* exclusions
  (ambiguous extensions, an Objective-C repo) as the residual gap, so the accidental omissions —
  `.tf`, `.el`, `.nix`, `.vim`, `.proto` — read as covered. **A decision not to include something and
  a failure to think of it look identical in a table**, and only the first one is honest to write
  down. When a mechanism is a whitelist, say so in the words a reader will check it against, and test
  it on a repo in a language nobody on the team uses.
- **The band you called empty is where the next repo lands.** The same ADR placed its threshold in
  the largest gap in a measured distribution — 2.5% → 43.7% — and wrote that no repo sits between
  2.5% and 10%. The **first** repo cloned to test that afterwards, `prometheus/prometheus`, came in at
  **25.0%**: a Go time-series database that ships 48 Blast Radius boards about its React UI. The bar
  did not move and did not need to; the sentence that needed to move was *"there is none in this
  set"*, which is a fact about the set being quoted as a fact about the world. **A gap in eleven
  samples is a gap in eleven samples.**
- **The wording of a claim is a claim, and it goes stale when the *thing* changes rather than when the
  sentence does.** Package granularity shipped with 0 wrong answer keys and 0 invariant violations —
  and every board a Go repo served said *"which of these **files** depend on it"* about a list of
  directories. Nothing in the generator, the grader or the atlas was wrong; the noun was, on 100% of
  a Go repo's boards, and no suite could see it because no suite asserted on a sentence. **When you
  change what a node *is*, grep the user-visible strings for the old word** — not the readers of the
  field, which the compiler finds, but the prose, which it cannot. And the honest fix has a shape:
  the caller supplies the *fact* and the verb keeps writing the *sentence*, because moving the
  sentence to the caller is the cheap fix the panel landmine already forbids.
- **A vocabulary needs a word for the case you assumed was the exception.** *"Name the kind"* looks
  complete until you count: a commit touches whatever it touches, so **151 of hugo's 156 Companion
  boards and 118 of its 121 Placement boards hold two kinds at once** — mixed is the majority, not a
  fallback. Blast Radius is the one verb that is reliably uniform, and for a structural reason (only
  Go imports Go), which is exactly the kind of accident that makes a rule look total when it is not.
  **Count the shapes before choosing the words.**

- **Two checks that read the atlas cannot see a hole in the atlas, and the third one found two wrong
  answer keys.** M5's Go work shipped with three verifications: no two nodes for one package (0 — and
  *unreadable* as anything but 0, since node paths are unique and a board never holds its subject);
  no same-package distractor slot (0, same tautology); and `candidates ∩ dependents = truth` with 0
  violations. All three read `atlas.json`, and the defect ADR-0024 §6.1 is *about* is a **missing
  edge**, which no atlas-derived check can see. The instrument that was not vacuous read the repo's
  **source** — does a candidate marked wrong contain an import naming the subject's package? — and
  found **2 of prometheus's 34 Go boards** marking as wrong a package whose `server.go` imports the
  subject outright. Cause: a nested `go.mod` that `require`s its own repo's root module, so *whose
  repo is this path in* was answered with the *nearest* module's require list. **When a rule is about
  something the atlas might be missing, the check has to come from outside the atlas** — and note
  which repo caught it: not the big one, not the bootstrap, but the one added late because another
  ADR had named it.
- **The sentence excusing a mechanism from inspection is the one to check first.** ADR-0026 §2.1
  closed with *"no Go repo in this set moved a package inside the retained commit window, so this is
  argued from the mechanism rather than from a repo where it fired."* Measured: **69 split votes
  across 316 packages, 15 of them ties**, and the collision fallback firing too. So the plurality
  rule, its byte-order tie-break and the fallback had all decided real node identities, dozens of
  times, entirely unexamined — and a 1–1 tie flips the moment either side gains a file, which changes
  the id and drops the player's saved passes. A strict majority cannot tie. The shape is the
  proudest-paragraph landmine inverted: not the claim the document defends hardest, but the one it
  uses to stop looking.
- **Adding a language to `SCANNED` moves its unreadable files out of every tally there is.** A `.go`
  file over the size cap is no longer `unreadable` (right — the extension is scanned) and is not
  `unsupported` either (it is `tooLarge`), so it vanishes from both sides of ADR-0025's ratio *and*
  is never parsed. Harmless at file granularity, where it simply never becomes a node; a **silent
  missing edge** once a node stands for a directory, because the package survives without it.
  ADR-0025 §9.3 had written down that this was the dangerous direction, and the change that took it
  made no connection to that paragraph. **When you move an extension between the walk's tables, walk
  every path a file of that extension can take afterwards** — not just the one the change is about.
- **A test that predicts which board the shell will serve is a `.first()` in disguise, and this repo
  has now paid for it three times in the same file.** The e2e's board-playing step asserted Blast
  Radius's wording over *any* verb that was not Companion — a two-armed conditional standing in for a
  four-verb enum — and matched the board through `pathById`, which covers only half of `AtlasId`.
  Adding two source files re-rolled ark's own deck onto an **Archaeology** board, and the step
  reported the wrong prompt and then hung **30 s on a Submit that was correctly disabled**, because
  nothing had been clicked. Both fixes were already in the file: `labelById` — the both-arms map — is
  built 300 lines above, and the comment directly over the broken line describes this exact landmine
  being *"fixed there and left standing here, four hundred lines apart."* Underneath sat a third bug
  neither fix reaches: **`innerText` returns rendered text**, so `commitLabel`'s two-space separators
  arrive collapsed to one and a commit row can never equal the string the code built. That one is
  invisible on three verbs out of four, which is why it survived a milestone. **Compare rendered text
  to rendered text, enumerate every verb rather than defaulting, and never predict the board.**
  A **third** instance in the same file surfaced only from reproducing the CI merge commit: the field
  notes step selects its note with `claims.find(t => t.includes(subject))`, and a claim reads
  *"You proved N files that change with SUBJECT — member, member, …"* — so a note about somebody
  **else** that merely lists this subject as a member matches, and `find` takes the first. The comment
  two lines above it already said *"find the note by its subject, never by its position"*. **A
  substring is a position.** Match against the part of the sentence that is a claim about the
  subject, not against the sentence. **A fourth followed immediately**, in the Archaeology step, and
  its predicate had *two* substring traps at once: `claim.includes(subjectPath) &&
  claim.includes('commit')` matched a **Blast Radius** note because the subject was listed among its
  members *and* because that note's own subject path was `src/verbs/commits.ts`. Both halves of an
  `and` were substrings, and both were wrong. There is one `claimAbout` helper now, because a rule
  that lived three times had already diverged twice. **The instrument that found #3 and #4 is the
  merge-commit reproduction** — neither was reachable on the branch's own tree, and both would have
  been a red CI.
- **An arm no second instrument covers is not verified, however many instruments the table has.**
  Python's scanner was scored against tree-sitter *and* against Python's own `ast` — 0 of 3,011 files
  disagreeing, three instruments, the same counts to the digit — and the arm that was **wrong** was
  the one none of them looked at. `IMPORT_CALL` matched `importlib.import_module(` and missed the
  bare `import_module(` that follows `from importlib import import_module`, which is **django's house
  style**: 79 call sites where 9 were recorded, 49 missing taints and **30 missing edges**. ADR-0024's
  probe used the same prefixed shape, so the probe and the shipped scanner agreed *by sharing one
  blindness*, and the control repo passed because flask's two computed sites happen to be
  `__import__(`. Worse, the missing unresolveds **flattered the resolution rate**, so the ADR's
  proudest sentence — *"the shipped resolver is better than the probe that decided the verdict"* —
  was manufactured by the defect it was hiding. **When a comparison covers one arm of a union, say so
  in the sentence that quotes it**, and treat the uncovered arm as unmeasured rather than as agreed.
- **A function returning a list has an outcome nobody declares: the empty one.** `resolvePyImport`
  had three documented verdicts and a fourth undocumented behaviour — return `[]` — which
  `build.ts`'s `for (const verdict of …)` turned into *silence*: no edge, no external, no
  `unresolved`. The absolute branch guarded it and the branch four lines up did not, which is this
  repo's *the bug you already fixed is still there* shape with no fix having preceded it. **If a
  verdict function returns a collection, assert it is non-empty at the source**, not at each caller.
- **A corpus of 3,011 real files is not a substitute for adversarial fixtures, and the direction runs
  both ways.** Python's scanner was scored against tree-sitter and against Python's own `ast` on
  flask and django — 0 files disagreeing — and a unit fixture then found a live defect the corpus
  could not: a backslash-continued `from pkg import \` read as an import of nothing. Re-running the
  whole comparison after the fix changed **no** file on either repo. That is the *count how many
  times a branch fires* rule met from the other side: a branch nothing exercises can still be wrong,
  and the corpus that proves a scanner correct proves it correct **only about the shapes the corpus
  contains**. The mirror finding is in the same measurement: the *comparison harness* needed three
  corrections to tree-sitter's side before it agreed (a node identity check, a
  `future_import_statement` node type, and that node spelling its module in the grammar), and every
  one of them made **tree-sitter** look wrong. **An instrument built to judge your code is not
  exempt from being judged first.**
- **A test that asserts an absence passes whether or not the rule exists.** The end-to-end check for
  *"a Python repo ships no Blast Radius board"* was written over a five-file fixture, which has too
  few candidates to build a choice set **in any language** — so deleting `canGradeImports` reddened
  one assertion out of two and this one sat there reading as evidence. The fix is a counterfactual
  rather than a measurement: build the **same 19-file dependency shape twice**, once in `.py` and
  once in `.ts`, and assert the TypeScript tree ships boards while the Python one ships none. When
  you assert that something does not happen, **make something else that does happen prove the
  apparatus was running.**
- **A path in a language you have just added can be dead in a way the language's own shape hides.**
  Go's masker skipped recording rune-literal bodies as string literals, with a comment explaining that
  a rune can never be an import path. True, and the branch is unreachable: the import scan only ever
  looks up an offset after a `"` or a backtick. The masking of runes *is* load-bearing — an unmasked
  `'"'` opens a string that swallows real code — but the test written for it asserted on `imports`,
  where Go's grammar makes the damage impossible because imports come first, and the mutant survived.
  The cost lands on `exports`, which is scanned over the whole file. **Two mutants of three survived
  the first draft of that suite**, and the fix in both cases was to move the assertion to the surface
  the defect actually reaches.
- **A path prefix and a node key are not the same string, and the difference is one repo's entire
  edge list.** Go's module path resolves `github.com/x/y` to the module's directory, which at the
  repo root is `''` — while the root package's node key is `.`, because the validator refuses an empty
  path. `spf13/cobra`'s `doc/` package imports the module path itself, so cobra's **only** internal
  edge matched no node, and the file that should have carried it was tainted for guardrail 4 instead.
  It surfaced as *"edges 0, unresolved 1"* on a repo with two packages — small enough to read, which
  is the only reason it was caught before hugo's 1,275 edges buried it. **When two subsystems name the
  same thing, normalise at the boundary and test the degenerate case first.**

- **A relation over a set of one is an identity.** A reveal that deliberately says *"it changed a file
  that usually moves with this one"* rather than naming the file — because the name is another verb's
  answer key — names it anyway whenever the subject has exactly one co-change partner. Measured at 4
  such notes on hono, 2 naming a shipped Placement key member. The rule looked safe because the
  *sentence* contains no path; safety actually rested on the set being big enough to be ambiguous,
  which nothing asserted. **When you replace an identity with an existential to avoid a leak, bound
  the size of the set you are quantifying over.**

- **A guardrail whose cost is transitive is priced by the graph, not by the rate.** ADR-0003 refuses a
  challenge when any candidate *or anything on its outgoing side* carries an unresolved import, so its
  cost is the unresolved rate **times the closure depth** — and nothing about the rate predicts the
  product. hono and django have near-identical direct taint (3.8% and 3.3%) and amplify to **5.9% and
  68.8%**, because django's mean dependency closure is 164.8 nodes against hono's 17.3. django resolves
  **98.6%** of its import sites and ships **16 Blast Radius boards of 976 subjects**; flask resolves
  93.8% and ships **zero of 30**. A session that measured only "does the language resolve" would have
  shipped a parser and found the deck afterwards. **When a rule walks a closure, measure the closure.**
  **And then measure *where* the taint sits, because that is the real story and the rate-times-depth
  version is a comfortable half of it.** A post-ship review made this session compute the
  counterfactual it had skipped: solving Python's import roots **and** its dist-name-to-module gap —
  the two causes this repo's own ADR first named as the things that would change the verdict — moves
  django from 84.0% to **83.7%**. The whole effect is **7 computed `import_module(expr)` sites out of
  12,000**, sitting in `django/conf/__init__.py` and friends, which everything reaches. 0.06% of sites
  taint 83.7% of subjects. **Position beats rate by two orders of magnitude**, and a revisit condition
  written from the rate would have sent the next session to build something worth 0.3 points.
- **ADR-0003's safety rests on a sentence that is not true of every language: *an import we cannot
  resolve is recorded*.** Where a dependency is not an import at all, there is no specifier, nothing
  lands on `unresolved`, and guardrail 4 is blind by construction. Go's intra-package references are
  the structural case — files in one package see each other's identifiers with no import — so
  `treeSibling`, which picks *same-directory files that are not dependents*, picks them as **wrong
  answers**: ≤71 slots across **≤46 of hugo's 244 boards**. Python's is the idiomatic case,
  modules named by string literals in settings and registries: **562 pairs on django, 3 on flask** —
  repo-dependent where Go's is universal. **Before adding a language, enumerate its dependencies that
  are not imports**, and note that the first count of the Go leak was 153 because the test counted
  *method* names, which live in a receiver's namespace rather than the package's; restricting to
  package-level declarations cut it to 80. The looser test overstated by 91%.
- **A suite can pass for a reason nobody wrote down, and the reason is the step before it.**
  `npm run test:unit` fails 2 of 586 on a fresh clone — `serve.test.ts` serves `dist/player`, which
  does not exist until `npm run build` has run — and CI has been green on every run it ever had
  because `ci.yml` orders `build` before `test:unit`. The testing table lists them as independent rows
  at different frequencies (*"every change"* for both), so following the table in the other order goes
  red for a reason the table denies. This is the *pages.yml* landmine's mirror image: there, a
  permanently-red check got normalised into noise; here, a permanently-green one hides an ordering
  constraint. **Run the fast suite on a clean clone before trusting what it says about a clean clone.**
- **Precision is not a grade, and a leak reported in the wrong units is not comparable to any bar.**
  ADR-0020 measured Archaeology's subtree hint against the Placement board it weakens and reported it
  **100%-precise on 9 of this repo's boards**, which reads as decisive and was carried forward for a
  whole session as the next thing to fix. Scored with `scoreSet` — the metric the player is actually
  graded by — the same hint **fires zero times on both repos**: it picks one or two of a four-to-six
  file key, so recall caps the F1 near 0.5 however clean the picks are, and the best score on either
  repo is 0.727 against a 0.78 bar. Nothing was wrong with the measurement; it was in units the
  product does not grade in. **Report an exposure in the units of §8.2, or you have measured
  something no threshold can be applied to** — and note which direction the error ran, because a
  precision figure always flatters the leak and therefore always gets believed.
- **"The alternative cannot be built" is a claim needing evidence, exactly like the alternative
  working.** ADR-0021's first draft rested on a second leg beside its real argument: that no
  by-board guard could ever see a guess assembled from hints on two different boards, so the leak was
  structurally unclosable. It reads well and it is **false** — measured, every firing on both repos is
  visible to a *single* board, a by-board guard would close all six, and it would cost one class going
  silent on 3 of 32 boards here. The decision was right and one of its two legs was invented. The
  shape is the repo's own landmine about the proudest paragraph, one step earlier: when a document
  argues *"and anyway we could not have fixed it"*, that sentence is doing the work of an excuse and
  is the first thing to measure. Measure the fix you are declining before you decline it.
- **When a decision invites a re-measure, the invitation expires against verbs that do not exist yet.**
  ADR-0016 scoped the wire gate to Companion boards, *measured* the Blast Radius case, and closed with
  *"re-measure if a repo's two decks overlap much more than this one's"*. Two verbs later a third with
  node candidates shipped and nobody re-ran it — and the gate that was right for its day was leaking on
  3 of 40 boards. ADR-0021 then compounded it by reading the gap as a **rule-versus-code divergence**,
  which is the landmine one row down and was flatly wrong: the code implemented what the ADR decided.
  Two lessons. A conditional instruction in an ADR has no trigger unless something re-reads it, so
  **when you add a verb, grep the decision records for the conditions it might satisfy** — not just
  the code. And **before calling a gap a divergence, read what the ADR actually decided**; "the code
  diverged" is a heavier charge than "the decision was scoped to what existed", and only one of them
  was true here.
- **The lever that names the leak is not always the lever that fixes it.** The obvious fix for a
  leak *rendered* on the map is to change the rendering, and here that closes it completely and takes
  the history layer from **175 wires to 1**, because one verb's candidates cover 74% of the repo. The
  fix that worked is upstream, in the disclosure record, and costs 36 verdicts and no deck. **Measure
  the obvious fix's cost before building it**, and when a rendering gate looks like the answer, check
  what fraction of the thing it gates is still drawn afterwards — the vanishing-wires failure, met
  from the other side.
- **A claim about what the *player* can do is not checkable in the verb — go and read the player.**
  ADR-0021 accepted a measured exposure on the argument that running the guess needs a relation the
  player must have **learned**, so it was reasoning rather than lookup. Nobody opened `src/player/`.
  `main.ts` builds `openBoards` from `channelOf(verb) === 'coChangeTies'` alone, so an open
  **Placement** board suppresses no wire and `ties.ts` draws every pair an answered Companion reveal
  named — beside the open board, over the map §9 keeps visible behind the scrim. Measured with only
  the wires a player can actually see, the guess still beats band A on **3 of this repo's 40 boards**
  (measured on a clean clone of `a063f01`).
  The refutation was already written in the repo: `ties.ts`'s own comment says *"a wired answer is the
  map's `Ctrl+F`"*. Two lessons, and the second is the sharper one: a sentence of the form *"a player
  would have to know X"* is a claim about the **UI**, and belongs to whoever renders X — and when a
  decision quotes a rule from an ADR (*"no board open"*), **grep for the code that implements it**,
  because `main.ts` implemented that rule for one channel and the divergence read as a design choice
  for a whole milestone.
- **Scoring one row at a time measures a player holding one board.** The same ADR scored its
  structure-blind hint per row, got 0.600 against a 0.78 bar, and called the margin a plateau. Several
  boards hint about the same commit; the **union** of the subtrees they name is still nothing but
  string prefixes, and it reads **0.769** at `a063f01` — 0.011 under, on the one class the decision rests on
  staying below. A per-row measurement is not wrong, it is a *lower bound*, and quoting a lower bound
  as a margin is how a knife edge gets recorded as a plateau. Ask what a player accumulates across
  boards before you quote a maximum. (The vacuous half is worth naming too: *"nothing sits between the
  best score and the bar"* is true of every distribution ever measured.)
- **A class label is not a class description, and the gloss is where the lie gets in.** Every §8.3
  distractor strategy starts at its textbook bucket and **widens** when that bucket runs dry —
  `treeSibling` walks outward through shared path prefixes, Placement's `structural` is an unbounded
  BFS, Archaeology's `sibling` reads a `byDirPrefix` bucket that is the whole *subtree* because
  `analyse()` registers every node under every prefix of its directory. So a witness sentence
  glossing the class with §8.3's *definition* is false of exactly the rows the fallback reached:
  *"a directory sibling"* on **100 of this repo's 231 Blast Radius rows and 193 of hono's 297**,
  *"this file's own directory"* on 14 and 40. The label was right every time; the sentence explaining
  it was a **separate claim nobody checked**, and it is falsifiable by a player reading the two paths
  in one row. Three further traps sat inside the same five lines: a **root-level subject**'s bucket is
  the entire repo, so the existential is true of everything and worth nothing (24 rows here, 25 on
  hono); the guard counted a *third* population, so strategy, guard and sentence quantified over three
  different sets; and the strategy's own docstring ("the deepest bucket only") was wrong about what
  the deepest bucket contains. **Test the claim, not the wording — and hold each sentence to the
  strongest relation it asserts**: a first version of that test checked only the weaker shared-segment
  property, and a mutant restoring *"a directory sibling"* survived it.
- **The order a deck is stored in is not the order the player is served.** The e2e's witness step
  picked its board from `atlas.challenges`, which is sorted by **id** — so `archaeology-…` sorts
  before everything — while `challengeFor` serves a node's bucket in **tier** order, blast radius
  first. Measured, the two disagree on **20 of the 27 subjects carrying more than one board**, and the
  step passed only because that day's guide suggestion happened to carry exactly one. Ark indexes
  itself and CI plays a different merge commit, so this is the `.first()` landmine's exact mechanism
  one level up: not "which row" but "which *board*". Read what is on screen and match it; never
  predict what the shell will serve.

- **A declaration and the sentence that uses it can describe different populations, and only the
  declaration is checkable.** `placement.discloses` yields `touchedFact` for `challenge.truth`, which
  is all it *can* do — it takes a challenge and no atlas. Its reveal searched `commit.files`, the
  whole membership, for a neighbour to name. So the panel stated *"commit C touched F"* for an F the
  ADR-0019 accumulator had never heard of, and 20 of those atoms on this repo are members of a
  shipped Archaeology answer key (4 on hono). No suite could see it: each side is internally correct,
  and the *gap between what a function may declare and what its prose says* is not a state any test
  asserts. **When a verb declares what it gives away, check the declaration against every sentence
  the verb can print, not against the field the declaration reads.** Note the second half too:
  narrowing the search made the fall-through's *"no import edge to anything else in the commit"*
  **false**, because the commit may still have touched an unsampled neighbour. A sentence that
  survives a change to what it quantifies over was not really about the quantifier.
- **A per-row guard on a leak converts it into a leak by omission with the same content.** Companion's
  `structural` is safe on the direct ring and states an undrawn cone edge beyond it, so the obvious
  repair is to withhold the deep rows. Do that and the *absence* of a witness line means "this row is
  a deep structural pick" — precisely the fact being withheld, now on 219 rows instead of 10. The
  rule ADR-0020 settles on is **withhold by class or by board, never by row**, which forces every
  guard to be a property of the *subject* (how many neighbours, how many siblings, how many
  partners), never of the candidate. The corollary is worth keeping: **you cannot hide one member of
  a labelled set by removing its label**, only by removing the labelling.
- **`git checkout <file>` is not how you undo a mutation.** Mutation-testing three reveals, each
  mutant was reverted with `git checkout` — which restored the file to **HEAD**, throwing away that
  session's uncommitted work on all three. The next two mutants then ran against a tree with the
  feature half-deleted and produced *more* failures than expected, which reads like over-detection
  rather than like damage; the real signal was an assertion failing with `undefined` where the code
  could only produce `null`. Copy the file aside and copy it back. And when a mutant kills more tests
  than it was aimed at, **check the tree before believing the result** — a mutation harness that has
  silently changed something else is measuring a different program.

- **Four of seven review findings were a sentence contradicting a number in the same document.** Not
  a wrong measurement — a right one, written up backwards: a paragraph that measured a leak on 5 of
  27 boards and closed by calling it a leak "the product does not have"; a justification resting on
  the play order that the decision three paragraphs later reverses; 37 per-heuristic firings quoted
  as 37 refused boards when four boards lose to two guesses; a superlative the document's own table
  falsifies. No suite can see any of these and no amount of extra measuring prevents them, because
  the measurements were already right. **Re-read the prose against the table, not against the
  intention** — and treat any sentence of the form "the product does not have X" as a claim needing
  the same evidence as "the product has X".
- **A probe that samples produces a table where the small rows are exact and the large ones are
  fiction.** ADR-0032's §3.1 measured nearest-neighbour spacing across four repos with a loop capped
  at `Math.min(N, 400)` nodes. ark (171) and hono (425, barely) reproduced **to the digit**; hugo's
  maximum was 45% low and django's minimum — the cell §3.3 reasons from — was wrong in the direction
  that made the design look safer. **The exactness of the small rows is what makes the large ones
  believable**, which is the always-reads-good instrument in a new costume, and the cap was a
  performance guard nobody remembered writing. A table over repos of different sizes is a claim that
  the instrument scaled; say what it sampled, or do not sample.
- **A phenomenon defined against a distribution inherits every other phenomenon in the repo.**
  ADR-0034's `hub` was *cone ≥ 10× the median cone* and read **0.0% on hugo** — the same
  unreachable-threshold artifact the same session had just caught in `hotspot` (a bar of 30 where the
  maximum possible churn is 29), one row up, in the table it was about to write an ADR from. The cause
  is the interesting half: hugo's median cone is **140 against a maximum of 152**, because its
  131-node tangle puts 131 nodes at a cone of at least 130. **The tangle destroyed the hub detector's
  denominator.** So detectors calibrated independently against one distribution are not independent,
  and *"check the bar against the achievable range"* has to be re-run whenever any other detector
  changes what the distribution looks like.
- **A phenomenon is a property; a *rank* measures nothing.** "Top 2% by churn" fires on exactly 2% of
  every repo ever indexed, so it cannot distinguish a repo with a hotspot from one without. And count
  **instances, not members**: hugo's *"tangle 60.4% of nodes"* is **131 members of one instance**
  (`[131, 2]`), which turns *"hugo's package graph is one giant tangle"* — true, teachable,
  transferable — into a number that makes the norm look like a phenomenon.
- **An absent detector and an absent phenomenon are the same cell.** `barrel` reads **0.0% on flask**,
  which is not flask's architecture: `kind: 'reexport'` is emitted only by `src/indexer/scan.ts`, so
  `goscan` and `pyscan` cannot produce one and `src/flask/__init__.py` is a textbook barrel the
  detector cannot see. Hugo's two "barrels" are `docs/assets/js/…/index.js` — stray documentation
  JavaScript, presented as a cell about a Go repo. The `UNREAD`-list landmine with a different
  whitelist. Its sibling: `entry` (no dependents) reads 3.2%–55.4% across five repos and is really a
  **test-file detector** — 52 of ark's 54, 140 of hono's 149, 45 of flask's 46 are test or script
  paths, and this file's own landmine already says a zero-dependent file *may be an entry point,
  check the manifest*.
- **A shallow clone silently poisons every history-derived measurement, and `--depth` is what a
  session reaches for.** ADR-0034's first table measured `hotspot`, `fossil`, `churny leaf`,
  co-change and `shotgun` on four repos cloned at `--depth 400`; `src/verbs/commits.ts` refuses the
  entire history deck there, so hono and prometheus shipped **zero** history boards and the rows read
  as findings. Re-cloned at full depth, hono's `fossil` moved **6.5% → 1.3%** and its co-change row
  52.1% → 76.7%. Clone the whole history when the number is about history — and check
  `git rev-parse --is-shallow-repository` rather than remembering how you cloned it.
- **Count the branch before you trust the reason you built it.** The world drew nothing past its view
  distance, which violates NORTH-STAR risk #4's *"always show the silhouette of unexplored regions"*
  — so a distant skyline was built to fix the empty frames a playtest reported. Sampling 121 standing
  positions then showed **no position on either repo has nothing in full view** (0 of 121, both), so
  the empty frames were the **frustum** — the player at the shore facing away from the map — and not
  the cull at all. The layer is worth keeping on its own merits (mean **10 silhouettes on ark, 112 on
  hono**, so real on a repo twice the bootstrap's size and nearly dead on the bootstrap) but the
  *stated reason* was wrong, and the honest response to "there is nothing out there" was **less out
  there**, not scenery. A bug report tells you what was on screen, never why.
- **The best idea for a new layer is often the one that hands over an existing layer's answer key.**
  The obvious way to make a walkable world teach something the flat map does not is to show **which
  way each dependency points** — the map draws every edge undirected, and NORTH-STAR §5's tier 2 is
  literally *"which way do dependencies point?"*. Measured through `scoreSet`, walking backwards along
  those arrows scores **1.000 exact on 100% of both repos' Blast Radius boards**, because ADR-0008's
  invariant makes a directed road network *the answer set by construction* rather than a good guess.
  The attraction and the danger were the same property. **Before adding a channel to a new surface,
  ask which existing verb's key that channel reconstructs** — and note that the probe's first run said
  **0.000 on 94 boards** (it iterated `graph.in[ref]`, which holds edges rather than refs, so the walk
  never left depth 0). A mean of exactly zero across two repos is an instrument measuring nothing, and
  it errs in the direction that makes shipping look safe.
- **A glyph radius is not a ground area, and nothing in the type system knows the difference.** The
  world took `radiusFor(loc)` — the flat map's disc radius, drawn at whatever screen scale the camera
  holds — as the footprint a building occupies on the ground. Measured, that leaves **88.5% of this
  repo's towers and 52.2% of hono's with no body-width gap to their nearest neighbour**: the city is
  one solid mass, the camera stands inside a wall, and the first screenshots were a green rectangle.
  Both quantities are "how big is this file" in world units, both are `number`, and one is a symbol
  while the other is a place you cannot walk. The fix is a **uniform** scalar, which keeps the only
  thing the size channel actually claims (the ordering) — but the lesson is the unexamined step:
  **when you reuse a number in a new dimension, ask what it was measuring in the old one.**
- **A design document for a new layer is not covered by the landmines the old layers paid for.**
  ADR-0032 designed a walkable world in which *"a lit stone you can interact with"* is a node with an
  open board — and **Placement's subject is a commit**, which has no `layout` and nowhere to stand:
  25% of ark's deck, 77% of django's. That is the *subject-is-not-a-node* landmine, the one that
  produced nine defects across the player when Placement shipped, arriving in prose a milestone later
  with nothing to type-check it. Design documents are where this class of defect is **cheapest** to
  find and where nothing will find it for you: before writing a layer, walk this list and ask which
  entries are about a shape the new layer also has.

---

## Subagents and parallelism

- **Research in parallel** (prior art, library evaluation, format investigation) — safe and fast.
- **Code writing serially.** Parallel writers collide on files. One implementation agent at a time.
- **Give every implementation agent a full brief**: current state, objective, how to verify, and what
  it must not touch.
- **Parallel agents must never edit `CLAUDE.md`, `NORTH-STAR.md`, `README.md` or `CHANGELOG.md`.** The
  orchestrator owns those. `README.md` is on the list for the same reason as the others *and* one of
  its own: its status tables are a claim about the whole tree, which no single agent is in a position
  to make.

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
- [ ] `npm run index` still works on **this repo** — the bootstrap fixture must never break.
- [ ] If packaging, the CLI or the player's build changed: `npm run test:pack`. **This line used to
      say `npx ark index .` and that had never worked** — `package.json` had no `bin` and `build`
      typechecked the indexer with `--noEmit` — so a checklist item nobody could literally satisfy
      got ticked from memory for four milestones, which is the failure mode this whole list exists
      to prevent. It works now (ADR-0029), and the fix is not that the box became tickable: it is
      that **the box is a script**. `test:pack` packs the real tarball, installs it outside this
      checkout and runs `ark index` and `ark play` there, because every path bug this catches is
      invisible from inside a repo that has a `dist/player` sitting at its working directory. CI runs
      it on every push.
- [ ] No console errors in the player.
- [ ] `README.md`'s **Status** reflects what is now true — milestone, verb, subsystem, Known gaps and
      Next — and ideally moved in the commit that changed it rather than here. It is the only
      document that says *where we are*, and a status table nobody updates is worse than none: it
      goes on reading as current. See the session rhythm for how a row moves; any figure in it names
      the commit it was measured at.
- [ ] One line appended to `CHANGELOG.md`: what changed, what's next.

---

## Command reference

```bash
npm run dev                # player dev server (pick a free port; don't assume)
npm run play -- <path>     # index ANY repo and serve it — needs `npm run build` once
ark index <path>           # the packaged CLI, once installed (ADR-0029). **Not `npx ark`** —
ark play  <path>           #   the package is private and unpublished; `npm pack` then install it
npm run index              # index this repo → atlas.json  (the bootstrap fixture)
npm run build              # typecheck + bundle + emit the CLI
npm run test:unit          # fast — every change
npm run test:atlas         # schema + integrity of the generated atlas
npm run test:determinism   # index twice, assert byte-identical
npm run test:pack          # ~30 s — pack, install outside the repo, run `ark index` and `ark play`
npm run budget             # print measured budgets, fail over ceiling
npm run raster             # slow — frame time at 2,000 nodes in a real browser (ADR-0009 P3).
                           #   Has never been pointed at the walkable world (ADR-0033 §9).
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

**`ark` runs as an installed command** (**[ADR-0029](./docs/decisions/0029-npx-ark-is-a-script-not-a-checkbox.md)**)
— `bin` → an emitted `dist/cli/`, the built player in `files`, and `npm run test:pack` packs the real
tarball, installs it **outside this checkout** and runs `ark index` and `ark play` there. That last
clause is the design: both real defects were invisible from inside a repo. npm installs a `bin` as a
**symlink**, so the entry-point test `pathToFileURL(argv[1]) === import.meta.url` was false for every
installed copy and `main` never ran — silently, exiting **0**; and `dist/player` was a bare relative
path resolved against *your* working directory. **`npx ark` off the registry is still not a thing**:
the package is `private` and `ark` is a placeholder with four known collisions, so what is left is a
naming decision rather than packaging work, and the documents say *"pack it and install it"*.

**M5 is delivered.** Its Python half ships
(**[ADR-0028](./docs/decisions/0028-python-is-mapped-and-never-graded.md)**) as ADR-0024 decision 2
decided it: a **history** language — the map and the three git verbs and **never Blast Radius**.
`pallets/flask` `6a2f545b` is **91 nodes, 193 edges, 17 regions, 11 peaks and 118 challenges of
which zero are Blast Radius**; `django/django` `c9eb16a87e` is 3,035 nodes and 10,162 edges;
`donnemartin/system-design-primer` ships 57. Both scanners are hand-rolled and tree-sitter has now
been scored against **two** languages and bought **zero measured points** on either: identical site
counts to tree-sitter *and* to Python's own `ast` (flask 675, django 12,052), **0 of 3,011 files
disagreeing**, 7.1× faster, no runtime dependency. **That comparison is about import *statements*
and the qualifier is load-bearing** — the `import_module(…)` *call* arm was covered by no second
instrument, because ADR-0024's probe shared the same regex shape, and it was wrong (ADR-0028 §8.1). **If a third language comes out level, it is
NORTH-STAR §7.2's strategy that needs rewriting, not the exception.**

The mechanism is a **predicate split**, and it is the thing to understand before touching any of it.
`canImport` answered two questions — *is this mapped source?* (`coverage.ts`) and *may this grade an
answer key?* (`blastRadius/generate.ts`) — which are the same question for TypeScript and Go and
**opposite answers for Python**. Merge them again and you either withdraw every Python repo's deck
(`mapped` reads 0, ADR-0025 clause 2 refuses it, and the HUD says *"None of this repository's 84
source files are on this map"* over a **full** map) or ship the Blast Radius deck ADR-0024 measured
as dead. `GRADED_IMPORT_LANGS` is the strict subset, it gates the **subject** as well as the
candidate pool, and it refuses by **language rather than by taint** on purpose — 30 of flask's 32
subjects and 819 of django's 976 would be refused by guardrail 4 anyway, so leaving it to taint
would make *whether a language has a deck* depend on how dynamic one repo is.

**The kill point was re-measured with the shipped instrument and the verdict held.** django resolves
at **98.58%** against the probe's 98.6%, and the share of blast subjects whose closure is tainted is
**83.7%** against 84.0%. Position beats rate, confirmed by a second instrument.
**A language ships on its deck, not on its map, and not on its resolution rate.** *This paragraph
first said 99.1% and called the shipped resolver better than the probe — which was the blind spot in
§8.1 flattering the rate, in the sentence the change was proudest of.*

**All five repos ADR-0025 refused now ship** — Go returned hugo and cobra, Python returns django,
flask and system-design-primer — so that document's *"the refusal will resolve itself as languages
land"* is closed. None of the 315 withdrawn questions came back; what the five ship instead is
**1,048** questions about their own source.

**`django/django` breaches the index budget and it is said out loud: 17.6–18.6 s at 3,035 nodes
against a 10 s ceiling.** It is **not** the Python scanner (1.2 s of it) — the force-directed layout
is **~7.1 s, ~40%**, and hugo's is ~40% of its ~6.8 s at half the scale. Every figure there is a
range, because this container's run-to-run spread on them is ±25%. `README.md` Known gaps carries it with
the phase breakdown; fixing it is a `layout.ts` change with its own determinism risk and wants its
own ADR.

**M5's Go half ships.** A Go node is a **package** — the directory, not the file
(**[ADR-0026](./docs/decisions/0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md)**) —
and the scanner is **hand-rolled**, against NORTH-STAR §7.2's *"v2: tree-sitter"*, on a measurement
rather than on taste: both instruments find **6,013 import sites on hugo and 190 on cobra**, the same
counts ADR-0024 got from Go's own `go/parser`, and disagree on **no file at all** out of 942;
tree-sitter is 6.2× slower and would be this project's **first runtime dependency**. The refusal is
scoped to Go and the condition that reverses it is written down — *a language where the two disagree
on real files* — so **score the next language the same way before writing its scanner.**
`gohugoio/hugo` `44da0860` is **193 packages holding 906 files, 6.61 edges each, 456 challenges,
6,733 ms** (ADR-0024 §7 predicted 193 / 1,275 / 6.61, and this reproduces it to the digit from the
shipped code); `spf13/cobra` is 2 packages, 1 edge and **no Blast Radius deck**, which is the honest
reading of a library that is one package. Python is decided and unbuilt: a **history** language, the
map and the three git verbs and never Blast Radius (ADR-0024 decision 2).

The class package granularity was bought for is **gone and checked rather than assumed**: 0
same-package distractor slots on hugo's 156 boards, prometheus's 63 and cobra's, against ADR-0024
§6.1's ≤71 wrong answer keys on ≤46 of 244 file-granular boards — plus 0 violations of ADR-0008's
`candidates ∩ dependents(subject, ∞) = truth` across 187 Go boards. **The bootstrap deck did not
move**: old indexer against new on clean clones of ark `837970f2` and hono `7075369e`, `challenges`
is **byte-identical** and so is everything else bar the new `fileCount` field.

**A board is asked in the noun its members actually are**
(**[ADR-0027](./docs/decisions/0027-a-board-is-asked-in-the-noun-its-members-are.md)**) — `files`,
`packages`, `commits`, or `places` where a board holds more than one kind, which on the history verbs
is the **majority** shape rather than a fallback (151 of hugo's 156 Companion boards, 118 of its 121
Placement ones). `Verb.prompt` has no atlas, so the caller supplies the fact and the verb keeps
writing the sentence — putting it in the console is the cheap fix ADR-0020 forbids. All 160 of ark's
prompts and 216 of hono's are **character-identical** to before, gated on 160 and 216 rendered rows
after the first version of that comparison passed vacuously on two identical validator errors.

**M2, M3 and M4 are delivered; the first three rungs toward the third-person world are shipped.**
§13's M4 is *Companion, Placement, Archaeology* and **all three ship**, with
[ADR-0019](./docs/decisions/0019-archaeology-asks-a-place-what-happened-to-it.md) built rather than
merely accepted. This line said "M4 delivered" for two sessions while one verb existed, which is
exactly how a milestone gets skipped: the roadmap lives in `NORTH-STAR.md` §13 and a session reads it
first, but it reads *this* line for what is already done. **A decision is not a delivery** — the next
edit of this paragraph must not turn an ADR into a shipped verb. **M5 is next by the roadmap**
(tree-sitter, 3–4 more languages), and the negative witness — the last rung, which improved every
existing board rather than adding a fifth verb — is done.
Run it: **`npm run play -- /path/to/repo`** indexes any repo and serves the player; `npm run dev`
plays this one. Best third-party repo to try is **`honojs/hono`** (425 nodes, 2.51 edges/node at
`7075369e` — and the only outside repo where the generator had more supply than the deck cap
allowed). Ark itself is **3.40** at `e6fe5e4`, measured on a clean clone. *This line said 2.66 for
five milestones and that figure reproduces nowhere* — 2.57 at `0fac922`, the commit whose CHANGELOG
recorded it, and 2.54–2.59 across the window around it, under the only denominator that reproduces
hono's 2.51 (edges ÷ **all** nodes; code-only reads 3.25 there). The hono half of the same sentence
was exact, which is what made the ark half diagnosable. The scanner reads **ES modules and Go**; a Python or Rust
repo still produces a map with no edges of its own — and, since ADR-0025, **no deck either** when
that map is a sliver, said out loud with the count of what is missing rather than filled in with
questions about the Markdown.

Press **`o`** for the orbit view: every file a column standing on its 2D footing, height =
`elevation`, drag to turn the world. `o` again returns to the flat map, and straight down reproduces
it to the pixel *at the same heading*. Still zero runtime dependencies.

**Press `g` to walk it** (**[ADR-0033](./docs/decisions/0033-the-roads-are-the-edges-and-a-commit-stands-at-the-chronicle.md)**)
— a third-person hero in a city where a file is a building, its height is `elevation`, and **the
roads on the ground are the import edges**, which is the decision that supersedes ADR-0032's
*"featureless plane"* and answers its §9.1. A commit-subject board has no `layout` and is answered at
**one chronicle** outside the map, because putting its marker among the files it touched would be
Placement's answer key drawn on the ground. Walking past a building **surveys** it, through the map's
own recorder. Three views over one atlas now, and X,Y are still frozen. **The world is a mode, not
the arrival state, and that is S1 rather than taste** — `docs/experiments/0001` is unrun, so nothing
here may claim walking teaches better. **P4 was released by the owner** and ADR-0009 carries the
dated note; the sequence there is the point, since it was first proposed against a description of
half the gate.

**The map turns between challenges**, by the golden angle, as the console closes
(**[ADR-0017](./docs/decisions/0017-the-map-turns-between-challenges.md)**) — because map-derived
spatial memory is orientation-locked and a north-up-forever map trains exactly the alignment-specific
knowledge risk #1 says will not transfer. There is **one heading and it lives on the camera**:
`Orbit` has no `yaw`, `rotate()` turns and `tip()` tips, and rotation is applied to coordinates
rather than to the canvas, so labels never turn. It is never persisted — every session arrives
north-up — and `n` and the HUD compass are the ways back to north, with shift-drag to turn by hand.
**`f` is not one of them**: it fits at the current heading on purpose, because a fit that also
straightened the map would undo the turn every time a player used the most ordinary control there
is.

**Four verbs ship.** `src/verbs/blastRadius/` asks what depends on a file;
`src/verbs/companion/` asks what *changes with* it — the first verb graded on git rather than on
imports, and the one that reaches the edgeless files the import graph structurally cannot;
`src/verbs/placement/` shows a real commit's message and asks which files it changed
(**[ADR-0018](./docs/decisions/0018-a-subject-is-a-place-or-an-event.md)**); `src/verbs/archaeology/`
shows a file and asks which commits landed on it
(**[ADR-0019](./docs/decisions/0019-archaeology-asks-a-place-what-happened-to-it.md)**). Together
they leave 25 of this repo's 147 nodes unprovable where Blast Radius alone leaves 61; on hono 142
against 269. (Measured at `e6fe5e4` on a clean clone — ark indexes itself, so a figure about this
repo is only checkable if it names the commit it was taken at, and the commit carrying the sentence
is always one later than the one it describes.)

**Both halves of the id union are now real in every role.** Placement's *subject* is a commit and
Archaeology's *members* are — `Challenge.subject`, `.candidates` and `.truth` are all `AtlasId`,
discriminated by the id's own prefix (`n:` a node, `c:` a retained commit), and the shell asks
*whether* an id is placeable and *what it is called* without ever asking what it is about. The type
was `SubjectId` until it had two roles. **Neither widening produced a single compiler error** —
`NodeId` and `CommitId` are both aliases of `string` — so both were found by grepping every read; the
landmine below is the list.

The two history verbs are the two projections of one incidence relation, so they share
`src/verbs/commits.ts`'s eligibility rule entirely, and both certify a wrong answer from a commit's
own **positive** file list rather than from absence — which is why neither needs ADR-0014's
truncated-walk refusal, and why both do need its shallow-clone one for a different mechanism.
Archaeology adds the one rule no other verb has: **a commit an earlier verb's reveal has already
placed here is not an answer**, off the board entirely rather than merely out of the key.

**Every wrong answer now carries the reason it was offered**
(**[ADR-0020](./docs/decisions/0020-a-wrong-answer-carries-the-reason-it-was-offered.md)**).
`Challenge.witness` is one space-separated token per candidate, aligned with `candidates`, `-` on an
answer; the format is `src/atlas/witness.ts` (beside the schema, because the validator cannot import
from the verbs) and the *names* stay in each verb's `distractors.ts`. It is **recorded rather than
re-derived** because the two disagree: the reason a reveal reconstructs from the graph names the
strategy that actually chose the candidate on 53.9% of this repo's distractor slots and 47.9% of
hono's, and **seven of the seventeen (verb, strategy) pairs are re-derived correctly zero times
on either repo**. A candidate
satisfies several predicates at once and which one *chose* it was settled by a quota.

**The direction ADR-0020 left open is scored**
(**[ADR-0021](./docs/decisions/0021-a-gate-heuristic-is-a-guess-that-needs-no-graph.md)**), **and the
answer moved the problem rather than closing it.** Scoring Archaeology's subtree hint as a guess on
the **Placement** board — the work that ADR left behind — is not implementable as written: `build.ts`
runs Placement first (ADR-0019 decision 7 needs it to), so neither verb can see the other at the
moment it would have to. Scored off `atlas.json` anyway, **on a clean clone of `a063f01`** and of
hono at `cf78528`: the subtree hint **fires zero times on both repos** — best 0.600 / 0.727 single-row
and **0.769 / 0.526** for the union of every hint about one commit, so the margin under the bar is
**0.011**, not the 0.18 the single-row number suggests. ADR-0020's "100%-precise on 9 boards" was not
a grade: recall is what F1 weighs and a subtree picks one or two of a six-file key. All three arms
were scored, not only the new one — `neighbour` fires zero too, and **pooled hints decide 3 of this
repo's 40 Placement boards and 3 of hono's 54** (`companion` alone: 3 and **1**). A canary in
`tests/atlas/` holds the structure-blind arm under the bar, scoring the single row *and* the union.

**That exposure is closed** (**[ADR-0022](./docs/decisions/0022-a-verb-declares-what-would-beat-it.md)**),
and not where it looked. Widening ADR-0016's wire gate to Placement was built and measured: it closes
the leak completely and takes this repo's history layer from **175 drawn wires to 1** until the tier-6
deck is cleared, because Placement's candidates cover 74% of the nodes. So the lever is the
*disclosure* record, not the rendering — `Verb.decidedBy` lets Placement score the guess against its
own key and declare a verdict, and Archaeology never offers that commit. **3 boards decided → 0**,
36 verdicts over 16 of 40 boards here and 22 over 15 of 54 on hono, and the Archaeology deck *grew*
33 → 36. The residual best is 0.750 and is **bounded by the threshold by construction**, which is the
difference between it and the variant whose identical number was a coincidence.

**Accepting the co-change arm rested on a premise the player's own code refutes, and a post-ship
review found it.** The argument was that running the guess needs a relation the player must have
*learned*. It does not: `main.ts` builds `openBoards` only from `coChangeTies` challenges, so an open
**Placement** board suppresses no wire, and `ties.ts` draws every pair an answered Companion reveal
named — over a map §9 keeps visible behind the scrim, in the file whose own comment calls that *"the
map's `Ctrl+F`"*. Measured with **only the wires a player can see**, the guess still beats band A on
**3 of this repo's 40 boards** (0 of hono's, whose subjects carry no Companion board). So on the
bootstrap repo it is a lookup. **The exposure was in ADR-0016's wire gate, not in `gate.ts`.** ADR-0021 called
that a rule-versus-code divergence; **that claim is withdrawn** — ADR-0016 scoped the gate to
Companion boards deliberately, measured the Blast Radius case, and asked for a re-measure if a repo's
decks ever overlapped more. Placement arrived later and nobody re-ran it. A decision correctly scoped
to the verbs of its day is not the same defect as a rule the code never implemented.

**Two classes are recorded and never spoken**, and one of them is the trap this rung walks into:
naming Blast Radius's `coChange` is the sentence `blastRadius/reveal.ts` deleted, in the file that
documents why. Companion's `structural` is withheld on a weaker, stated argument. The rule the rest
falls out of is **withhold by class or by board, never by row** — a per-row guard makes the *absence*
of a line say which class the row was in, which is the fact being withheld. `distant` says nothing
because it is padding, not a strategy.

§8.3's distractor strategies pick the wrong answers for each verb — Placement adds `mentioned`, a
file the message names and the diff does not; Archaeology adds its mirror, a commit whose message
names the subject and whose diff does not — and since
**[ADR-0023](./docs/decisions/0023-the-best-wrong-answer-is-a-board-improvement-not-a-gate.md)**
**every verb carries §8.3's *historically-coupled-but-not-structurally* class**, which that section
calls the best wrong answers and which Placement was the last without: a file the matrix records
moving with a file the commit changed, that does **not** import one, and that the commit did not
change — both halves of that class name enforced, because the version review caught enforced one and
put 48% of hono's rows under a label false of them. It is a **board improvement and nothing more** —
the claim it was built to test, that it would lower ADR-0022's exposure at the source, was measured
first and holding the board fixed it removes **not one verdict on this repo** (26 → 27 over 30 shared
boards) and 6 of 14 on hono, over 4 of its 38 shared boards. Its class is **withheld**, on the refusal
`blastRadius/reveal.ts` makes about the same relation — a silence narrower than it looks, since the
map draws 49 of those 97 pairs as wires once the naming Companion board is answered. Difficulty is computed per §8.4, and the player has a
challenge console over the map with partial credit, a derived per-member reveal, and fog that lifts
on what you prove. **The map has a history channel**: co-change pairs draw as ember arcs
over the straight import lines, gated by
**[ADR-0016](./docs/decisions/0016-a-history-wire-is-drawn-only-where-no-board-is-open.md)** — a wire
appears only where *neither* of its files still carries an open Companion board, which is pillar 3
rather than a disclosure rule, because ink on the map is a lookup where text in a closed panel is a
memory test. **Progress survives a
reload**, keyed on the repo's root commit, and a **"Where next?" panel** walks you through the deck.
**Field notes** record what you proved — never what you were shown, and the *verb* writes the
sentence. **112 KiB of JS** (95 before the walkable world), zero runtime dependencies, first paint
**332 ms** measured by `test:e2e`. `npm run index` produces a valid **338.5 KiB** atlas in **691 ms**
(measured at `1827ff93`, the commit this branch was cut from).
**Every number in this section is a measurement of one commit and ark indexes itself**, so they all
drift — the two above were stale by 16 KiB and 9 challenges before anyone noticed. Re-measure rather
than quote.

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
turns the world and fails on any console error. **There is no Pages deploy yet** — `pages.yml` is
deleted, not disabled, and **[ADR-0015](./docs/decisions/0015-pages-is-not-deployed-while-the-repo-is-private.md)**
says why and gives the one-line restore: it failed on every run it ever had, because the repo is
private and Pages there needs a paid plan. **[ADR-0031](./docs/decisions/0031-the-repo-goes-public-and-what-that-changes.md)
closed it**: the repo is public, it has the `LICENSE` `package.json` claimed since M0 and no file
granted, and the player deploys to **<https://deephanson94.github.io/ark/>** from `master` on every
push. Four Pages runs to get there and **every one was read**, which is the only reason none was
reported as a success: not enabled, then a fix that could not work, then the revert, then green. The
one that could not work is the lesson — `enablement: true` was taken from the failing action's own
suggested remedy without asking whether `GITHUB_TOKEN` could act on it, and *creating* a Pages site
needs `administration: write`, which it can never hold. `pages: write` **deploys to** a site and does
not **create** one. Its zero-challenge guard was not migrated because
`test:atlas` (`> 20` on a fresh build) and `test:e2e` (which actually plays a question) already hold
it more strongly — checked by mutation, not assumed.

The M2 kill-point caveat — several pairs of subjects with identical answer keys — is **closed at the
source**. **[ADR-0012](./docs/decisions/0012-an-answer-key-is-issued-once.md)**: the generator issues
each answer key once, re-asking a colliding subject with a disjoint window of its own dependents
where the cone allows and refusing it as `duplicateKey` where it does not. Measured on four repos, no
repo loses a *distinct* question — svelte's deck was 61% repeats and is now 153 distinct questions
where it had 138. The cost is reported rather than absorbed: `report.unprovableNodes` says how many
nodes no question can ever lift the fog from.

**The Markdown-map defect is fixed**
(**[ADR-0025](./docs/decisions/0025-a-deck-is-refused-when-the-map-is-not-of-the-repository.md)**),
so ADR-0024 decision 3's precondition is met and **M5 is unblocked**. A Go or Python repo used to
index into *a map of its Markdown with a full deck of questions about it* — cobra 17 nodes and **48
challenges**, hugo 1,049 nodes of which 1,016 Markdown and **144** — and now indexes into the map
with **no deck**, the count, and the reason. **315 questions withdrawn across 5 of 11 measured
repos**; ark, hono and `sindresorhus/awesome` are untouched.

The rule is two clauses over what the **walk skipped**, refined by language: refuse when there are
≥ 5 recognised-but-unreadable source files **and** the map holds less than a tenth of the
repository's source. Both are load-bearing and each rescues a repo the other gets wrong — the floor
saves `awesome` (seven Markdown files and one shell script), the tenth saves react, next.js and
svelte. **The obvious rule is wrong in both directions**: *no scanned-language nodes ⇒ refuse* ships
hugo and django, the two worst offenders, on the strength of 24 and 45 stray JavaScript files, and
refuses `awesome`. And `unsupported / onDisk` **provably cannot work** — refusing hugo needs a bar
≤ 58.7% and `awesome` sits at 69.6%, so the sets overlap and no threshold exists.

Next action: **run `docs/experiments/0001`.** ADR-0030's twin surface is **built** — `src/player/twins.ts`,
one inspector line in the *revealed* register, gated on *no member of the class still carrying an
unanswered Blast Radius board*, both halves checked in a browser. That was ADR-0034's priced pilot
and the price is now known: **~250 lines, one module, one gate, two suites** for one catalogue entry.
The catalogue itself stays **deferred** — fifteen detectors were measured before anything was
designed and the honest size is ~5 entries rather than 30–60. The walkable world ships (ADR-0033), which turns S1 from
a gate on a thing that does not exist into a gate on a thing that does — and **nothing in the product
may claim the world teaches better until it runs**, which is why the flat map is still the arrival
state. **The three structural blockers in that document's §8 are closed** and it is *runnable*: the
matched repos are named with commits (`graphql/graphql-js` `9c245018` and `kysely-org/kysely`
`f24018c7`, chosen from a measured slate of 31 — and node count alone, the criterion as written,
picks a pair 2.2× apart on density), the arms are **staged** (map vs orbit, the world gated on that
result — the owner's decision, and ADR-0009's own ordering made executable), and the quiz is a fixed
**held-out** item set carrying the generator's certifications. ADR-0033 §4's minimap confound is
resolved by a measurement that **refuted the obvious account of it**: the cull is not the mechanism —
the world's own view reaches 98.7% / 99.0% of the edge set from a standing position — the
*projection* is, so the world arm contains a small instance of the map arm, and its inset now keeps
everything but its roads. What is left is §9: **the hold-out split script** (and it must check the
removed keys against the served deck's `discloses`, or the instrument ships with a known leak),
**M2's instrumentation** (attempts are session state; nothing persists them, and §3 claimed
otherwise until this session), and **twelve participants**, which is owner-only. Then **region arches
in the world**, which are unbuilt because ADR-0032 §9.6 refuses the obvious derivation. The
**phenomenon catalogue** is **deferred rather than queued**
(**[ADR-0034](./docs/decisions/0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md)**):
fifteen candidate detectors were measured on five repos *before* anything was designed, and the
honest size is **~5 entries, not the ~30–60 this line used to claim** — the rest measure the scanner
(`barrel` is emitted only by `scan.ts`, so a Go or Python repo's 0 is ark's blindness), the norm
(co-change-without-import is 44–85% of pairs), test files (52 of ark's 54 `entry` nodes are test or
script paths), or an unreachable bar. Its best entry is an **answer key**: ticking the subject's
strongly connected component decides **109 of hugo's 156 Blast Radius boards** at precision 1.000.
The twin surface is that catalogue's entry #1 and its priced pilot. Then **django's index budget** — 17.6–18.6 s against a 10 s ceiling, ~40% of
it the force-directed layout (ADR-0028 §6), which is a `layout.ts` change with its own determinism
risk and wants its own ADR.

**Three narrower gaps replace it in `README.md`, each with its measurement.** Two are sharper than
they first read, because a post-ship review measured them (ADR-0025 §9). **`UNREAD` is a list, and
anything not on it is invisible — silently**: a Terraform repo shipped **64 challenges over 24
Markdown files with `report.unreadable` empty**, three commits after the fix, which is the original
defect intact. `.tf`, `.el`, `.nix`, `.vim` and `.proto` are on the list now; the next language
nobody thought of is not. And the tenth bar has a mainstream witness inside the band this repo called
empty — **`prometheus/prometheus` at 25.0%** ships 48 Blast Radius boards about the React UI of a Go
time-series database. The third gap is unchanged: a Go or Python repo still gets no *source* on its
map, which is M5.

**Two long-standing gaps are closed, both of them small and both overdue.** `npm run test:unit` no
longer depends on `npm run build` — `serve.test.ts` served `dist/player` and now writes its own temp
directory, so a fresh clone goes green instead of failing 2 of 617 for a reason unrelated to the
change in front of you. And **`RevealNote.route` is gone rather than wired up**: the console never
drew it because `whyYes` already spells the chain into the sentence the console *does* draw, so the
field was a second encoding of a fact the player already had, and the two tests whose real claim was
*a history-graded verb shows no import evidence* now assert that against the prose — which the empty
array could never have caught.

**M5's kill point is measured and decided** —
**[ADR-0024](./docs/decisions/0024-a-language-ships-on-its-deck-not-on-its-map.md)**, on flask
`6a2f545b`, django `c9eb16a87e`, cobra `adbc881` and hugo `44da08608`, with each language's *own*
parser so the figure is a ceiling tree-sitter would have to earn. **Both languages resolve, and that
turned out not to be the question.** Go: 0.0% / 0.2% of import sites unresolved. Python: 6.2% / 1.4%.
Yet **flask ships 0 Blast Radius boards of 30 subjects and django 16 of 976** — because ADR-0003's
taint is *transitive*, so the cost is the unresolved rate **times the closure depth**: hono and django
have near-identical direct taint (3.8% / 3.3%) and amplify by **1.55× and 21×**, django's mean closure
being 164.8 against hono's 17.3. **Resolution rate is not the kill-point metric; `rate × mean closure`
is.** Go ships at **package** granularity and only there — at file granularity, `treeSibling` offers a
same-package file as a wrong answer on 172 of hugo's 244 boards and **up to 71 of those slots, across
46 boards (18.9%), are wrong answer keys**, because an intra-package reference is not an import and
leaves guardrail 4 nothing to refuse. (That count went 153 → 80 → **71** across three instruments;
the ADR's §6.1 has the three false-positive classes and why the second correction shipped inside the
paragraph boasting about the first.) Package granularity takes hugo from 1,955 nodes / 13.04
edges-per-node / a 16.2 s index (ceiling 10 s) to **193 / 6.61** and makes the class unrepresentable.
Python ships as a **history** language: the map and the three git verbs, never Blast Radius.

Two things are on the record now and neither is a nit. **`RevealNote.route` is rendered nowhere**:
Blast Radius has computed the import route since M2, three unit tests assert its shape, and the
console has never drawn it — infrastructure with no consumer, which this file has a landmine about,
found while adding a field beside it and deliberately not fixed in passing. And **the unit fixtures
produce two of Archaeology's four distractor classes** — its boards carry only `neighbour` and
`distant`, because the fixture's `src/core/` holds nothing that is not also an import neighbour, so
`neighbour` claims those commits first and `sibling` never gets supply. Its reveal tests hand the
class in deliberately and say so; widening the fixture would test the allocator rather than the
reveal.

**Four things about Archaeology a later session will want.** `oldestK` fires **zero times on both repos** where ADR-0019 predicted 24 on hono, and it is
kept as a canary rather than a live gate — the reasoning and the counterfactuals that revive it are
in that ADR's *Re-measured* section, and **the honest reading is that it is one distractor-mix change
away from mattering**, not that it is dead — with the caveat that document now records: decision 6's
written rule ("fires on neither repo → out") condemns `oldestK` exactly as it condemned `recentK`,
and keeping it means the operative rule is really "keep a guess the board invites when scoring it is
free". That is defensible and it is not what was written down.

`recentK` is in the set *because* the re-measurement
found it refusing 3 hono boards after the ADR excluded it for firing zero times; that is the ADR's
own criterion applied to better data, and it is the only place the implementation changed a decision.
And **`uncertain` is not a refusal this verb can make** — `commitSupply` refuses every commit
touching a barred node, so a contested file has no eligible touchers at all; the branch was
unreachable and is gone — and so was **`tooFewCommits`**, a *second* dead refusal in the same
six-row table, found only when a review checked the table against the code rather than against the
argument. And the reveal's *"relations, never identities"* rule is guarded by a **set-size check**:
over a set of one, the existential names the file. Do not simplify either guard away.

**M5 is what the roadmap says next** (tree-sitter, 3–4 more languages, NORTH-STAR §13) and it is the
larger bet: the scanner is ES-modules-only, so a Python or Go repo still produces a map with no edges
and no questions. The negative witness is argued for first only because it is small, it improves
every existing board rather than adding a fifth verb, and pillar 5's distractor subsystem is the one
§8.3 calls "a real subsystem, not a helper function". If a session would rather open M5, that is a
defensible call and not a deviation.


**ADR-0021's accepted exposure is closed, and the canary is what closed it.** The structure-blind
`sibling` hint — *"a commit that touched this file's own corner of the tree"* — is **withheld**, the
third class to be. It sat 0.011 under the gate bar for three milestones; an ordinary commit re-rolled
this repo's own Placement deck and the per-commit union reached **0.800**. By-board cannot bound it
(best single board **0.667**, the 0.800 is a union of **three**) and narrowing the class to the exact
directory scores **0.800 too**, so ADR-0020's escalation runs out at *by class*. The cost is 171 of
626 spoken rows here and 101 of 734 on hono — **and no deck change at all**, because no generator
calls a reveal. The canary now asserts the silence rather than a score, which has no bar to drift
across.

The `tracedRadius` member leak ADR-0016 recorded as open is **closed**: the radius set is
`subjectsPassed` and returns subjects only, so a file unlocks its own cone by passing its own
question and by nothing else. It was a divergence from ADR-0008 decision 1 rather than an open
question — measured at 26 of 40 boards exposable, all recovering their key byte-exact, before.

**The twins are decided and unbuilt** (**[ADR-0030](./docs/decisions/0030-a-twin-is-named-once-its-whole-class-is-cleared.md)**),
which is a different state from the one this paragraph described for four milestones. `cone(A) =
cone(B)` is the import graph's version of NORTH-STAR §2's *"one module wearing two hats"* and it is
**common** — 15.5% of ark's blast-eligible subjects, 15.2% of hono's, **32.3% of prometheus's**,
whose largest class is 25 interchangeable `discovery/*` packages — so the hypothesis that it might not
earn a surface is retired. Naming a twin is a **Ctrl+F-grade leak in the direction nobody looks**:
the keys provably cannot overlap (ADR-0012 tiles the windows, measured 0 overlaps), but a passed
board certifies its *distractors* as non-dependents of the twin, which decides **4 of the 12 twin
pairs that could carry it** — best 0.923 against a 0.78 bar. The rule is *name a class only when no
member still carries an unanswered board*, in the inspector, never on the map. **No surface was
built, and this paragraph must not be edited into saying one was.** And one measurement only a human can take: **`npm run raster` on real hardware** —
45/33/43 fps is a headless software floor, ADR-0009's P1′ gates the renderer on it, and it should now
be measured on a *turned* map, since oblique headings are the normal case and were never what it
sampled.

The verb seam was the real work of M4, and the third verb measured what it is worth. `difficulty.ts`,
`gate.ts` and `paths.ts` live at `src/verbs/` rather than inside a verb; `reveal`, the reveal's
summary sentence, the grade's phrasing, the button label, `stillHolds` and — since Placement —
`subjectLabel`, `noteWeights` and `noteProse` are all on the `Verb` contract. Nothing in the console,
the notes or the map names a verb. `(verb, subject)` is the key everywhere `subject` used to be —
saves, the deck, the selector's attempt counter — and **each of those was a live defect, not
tidying**: keyed by subject, a full playthrough of this repo served 60 of its 71 questions and called
the deck finished.

**What the seam did and did not buy, measured on verb #3.** It bought everything about *asking*: the
console, map, grader, deck and selector needed no edit to hold a third verb, and `VERBS` gained one
line. It bought nothing about *what a subject is* — see the landmine below — and the field notes,
which M4 never revisited, still chose their ruler and their sentence with a verb name and an `else`.
So: adding a verb whose subject is a file is now genuinely cheap. Adding one that changes a shape the
shell reads is exactly as expensive as the number of readers that shape has.
