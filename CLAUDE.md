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
  top one.
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
- **Adding the fourth of something reveals the first three never had it.** Writing Archaeology's
  invariant into `tests/atlas/` showed that **Placement's had never been checked on the real atlas**
  — `candidates ∩ files(commit) = truth` lived only in a unit fixture, for a whole milestone, in a
  verb whose ADR is mostly an argument about that exact certification. The suite looked complete
  because every verb had *a* test. When you add a peer to an existing family, list what the family is
  checked for and check the list against each member, not against the newcomer.

- **Four of seven review findings were a sentence contradicting a number in the same document.** Not
  a wrong measurement — a right one, written up backwards: a paragraph that measured a leak on 5 of
  27 boards and closed by calling it a leak "the product does not have"; a justification resting on
  the play order that the decision three paragraphs later reverses; 37 per-heuristic firings quoted
  as 37 refused boards when four boards lose to two guesses; a superlative the document's own table
  falsifies. No suite can see any of these and no amount of extra measuring prevents them, because
  the measurements were already right. **Re-read the prose against the table, not against the
  intention** — and treat any sentence of the form "the product does not have X" as a claim needing
  the same evidence as "the product has X".

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

**M2, M3 and M4 are delivered; the first three rungs toward the third-person world are shipped.**
§13's M4 is *Companion, Placement, Archaeology* and **all three ship**, with
[ADR-0019](./docs/decisions/0019-archaeology-asks-a-place-what-happened-to-it.md) built rather than
merely accepted. This line said "M4 delivered" for two sessions while one verb existed, which is
exactly how a milestone gets skipped: the roadmap lives in `NORTH-STAR.md` §13 and a session reads it
first, but it reads *this* line for what is already done. **A decision is not a delivery** — the next
edit of this paragraph must not turn an ADR into a shipped verb. M5 is next by the roadmap
(tree-sitter, 3–4 more languages); the Next action below argues for one smaller thing first.
Run it: **`npm run play -- /path/to/repo`** indexes any repo and serves the player; `npm run dev`
plays this one. Best third-party repo to try is **`honojs/hono`** (425 nodes, 2.51 edges/node —
Ark itself is 2.66 — and the only outside repo where the generator had more supply than the deck cap
allowed). The scanner is **ES modules only**, so a Python or Go repo produces a map with no edges and
no questions until M5.

Press **`o`** for the orbit view: every file a column standing on its 2D footing, height =
`elevation`, drag to turn the world. `o` again returns to the flat map, and straight down reproduces
it to the pixel *at the same heading*. Still zero runtime dependencies.

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
they leave 20 of this repo's 140 nodes unprovable where Blast Radius alone leaves 54; on hono 138
against 269.

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

§8.3's distractor strategies pick the wrong answers for each verb — Placement adds `mentioned`, a
file the message names and the diff does not; Archaeology adds its mirror, a commit whose message
names the subject and whose diff does not — difficulty is computed per §8.4, and the player has a
challenge console over the map with partial credit, a derived per-member reveal, and fog that lifts
on what you prove. **The map has a history channel**: co-change pairs draw as ember arcs
over the straight import lines, gated by
**[ADR-0016](./docs/decisions/0016-a-history-wire-is-drawn-only-where-no-board-is-open.md)** — a wire
appears only where *neither* of its files still carries an open Companion board, which is pillar 3
rather than a disclosure rule, because ink on the map is a lookup where text in a closed panel is a
memory test. **Progress survives a
reload**, keyed on the repo's root commit, and a **"Where next?" panel** walks you through the deck.
**Field notes** record what you proved — never what you were shown, and the *verb* writes the
sentence. ~89 KiB of JS, zero runtime dependencies, first paint ~400 ms. `npx ark index .` produces
a valid ~250 KiB atlas in ~455 ms (measured at the commit that added Archaeology).
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

Next action: **the negative witness.** Every wrong pick on every board already has a *known reason
class* — the generator chose it as a sibling, a name-alike, a structurally-near non-dependent, a
co-change ghost, or a commit whose message names the file it never touched — and no reveal says
which. The reveals explain a wrong pick by re-deriving a reason from the graph, which is honest and
is not the same thing: the generator knows why it offered that answer, and throwing that away means
the sharpest lesson on the board is reconstructed rather than stated.

**Decide the one design fork before writing anything**, because it decides whether this is a schema
change: strategy provenance either ships in the atlas — `Challenge` gains a per-candidate strategy
label, so `ATLAS_VERSION` 7 → 8 and `docs/atlas-format.md` in the same commit (guardrail 5) — or is
re-derived player-side from the graph, which needs no bump and no migration but can disagree with
what the generator actually did. The second is cheaper and is the one that can go quietly wrong; the
first is the honest record and costs schema surface on every challenge. Measure the byte cost against
the 5 MB ceiling before choosing, and note that `report.distractorMix` already carries the aggregate,
so this is about *which* wrong answer rather than *how many*.

Then the **overlapping Companion answer keys** in the generator, and after those the **phenomenon
catalogue** — a repo-independent vocabulary of ~30–60 structural phenomena, the atom that would let
anything *transfer* to another repo, which is the other half of risk #1.

**Three things about Archaeology a later session will want, all measured at the commit that built
it.** `oldestK` fires **zero times on both repos** where ADR-0019 predicted 24 on hono, and it is
kept as a canary rather than a live gate — the reasoning and the counterfactuals that revive it are
in that ADR's *Re-measured* section, and **the honest reading is that it is one distractor-mix change
away from mattering**, not that it is dead. `recentK` is in the set *because* the re-measurement
found it refusing 3 hono boards after the ADR excluded it for firing zero times; that is the ADR's
own criterion applied to better data, and it is the only place the implementation changed a decision.
And **`uncertain` is not a refusal this verb can make** — `commitSupply` refuses every commit
touching a barred node, so a contested file has no eligible touchers at all; the branch was
unreachable and is gone.

**M5 is what the roadmap says next** (tree-sitter, 3–4 more languages, NORTH-STAR §13) and it is the
larger bet: the scanner is ES-modules-only, so a Python or Go repo still produces a map with no edges
and no questions. The negative witness is argued for first only because it is small, it improves
every existing board rather than adding a fifth verb, and pillar 5's distractor subsystem is the one
§8.3 calls "a real subsystem, not a helper function". If a session would rather open M5, that is a
defensible call and not a deviation.


The `tracedRadius` member leak ADR-0016 recorded as open is **closed**: the radius set is
`subjectsPassed` and returns subjects only, so a file unlocks its own cone by passing its own
question and by nothing else. It was a divergence from ADR-0008 decision 1 rather than an open
question — measured at 26 of 40 boards exposable, all recovering their key byte-exact, before.

Still open, and it is a design question rather than a defect: **the twins a duplicate answer key
drops are never mentioned to the player**. `cone(A) = cone(B)` is a true derived fact and by ADR-0011
decision 3 it must be *shown*, never proved — so it wants a decision about where it is shown before
any code. And one measurement only a human can take: **`npm run raster` on real hardware** —
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
