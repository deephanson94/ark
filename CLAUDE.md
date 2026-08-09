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
- **A relation over a set of one is an identity.** A reveal that deliberately says *"it changed a file
  that usually moves with this one"* rather than naming the file — because the name is another verb's
  answer key — names it anyway whenever the subject has exactly one co-change partner. Measured at 4
  such notes on hono, 2 naming a shipped Placement key member. The rule looked safe because the
  *sentence* contains no path; safety actually rested on the set being big enough to be ambiguous,
  which nothing asserted. **When you replace an identity with an existential to avoid a leak, bound
  the size of the set you are quantifying over.**

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
      (**Not `npx ark index .`**, which this line said for four milestones and which has never
      worked: `package.json` has no `bin`, and `build` typechecks the indexer with `--noEmit` rather
      than emitting it, so there is nothing for `npx` to resolve. `npx ark` is NORTH-STAR §10's
      intent — *"ships as `npx ark`, zero install friction"* — and it is **unbuilt**, not broken;
      packaging the CLI is real work nobody has done. A checklist item nobody can literally satisfy
      gets ticked from memory, which is the failure mode this whole list exists to prevent.)
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
edit of this paragraph must not turn an ADR into a shipped verb. **M5 is next by the roadmap**
(tree-sitter, 3–4 more languages), and the negative witness — the last rung, which improved every
existing board rather than adding a fifth verb — is done.
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
they leave 19 of this repo's 140 nodes unprovable where Blast Radius alone leaves 52; on hono 138
against 269. (Measured at `11c92c0` on a clean clone — ark indexes itself, so a figure about this
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

**Accepting the co-change arm rested on a premise the player's own code refutes, and a post-ship
review found it.** The argument was that running the guess needs a relation the player must have
*learned*. It does not: `main.ts` builds `openBoards` only from `coChangeTies` challenges, so an open
**Placement** board suppresses no wire, and `ties.ts` draws every pair an answered Companion reveal
named — over a map §9 keeps visible behind the scrim, in the file whose own comment calls that *"the
map's `Ctrl+F`"*. Measured with **only the wires a player can see**, the guess still beats band A on
**3 of this repo's 40 boards** (0 of hono's, whose subjects carry no Companion board). So on the
bootstrap repo it is a lookup. **The exposure is in ADR-0016's wire gate, not in `gate.ts`** — that
gate asks whether a node carries an open board *of one verb* while the rule it states is about open
boards — and it is the Next action.

**Two classes are recorded and never spoken**, and one of them is the trap this rung walks into:
naming Blast Radius's `coChange` is the sentence `blastRadius/reveal.ts` deleted, in the file that
documents why. Companion's `structural` is withheld on a weaker, stated argument. The rule the rest
falls out of is **withhold by class or by board, never by row** — a per-row guard makes the *absence*
of a line say which class the row was in, which is the fact being withheld. `distant` says nothing
because it is padding, not a strategy.

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
sentence. ~89 KiB of JS, zero runtime dependencies, first paint ~400 ms. `npm run index` produces
a valid ~250 KiB atlas in ~455 ms (measured at `11c92c0`).
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

Next action: **widen the wire gate past one verb.** ADR-0016 says a co-change wire is drawn only
where neither of its files still carries an open board; `main.ts` implements that as *an open
**Companion** board*, so a Placement board suppresses nothing, and ADR-0021 measured the consequence
— **3 of this repo's 40 Placement boards are decided at band A by wires visible beside them**, 0 on
hono. This is the rule-stated-in-words landmine again: the ADR said "open board" and the code asks
about one channel. The work is to include every open board's candidates in `openBoards`, and the
thing to measure before shipping it is **how much of the history layer survives** — a gate that
suppresses every wire whenever any board is open would delete the layer rather than gate it, which
is ADR-0016's own vanishing-wires failure from the other side. Count what survives, not what the gate
emits.

Then, in rough order of size — the **overlapping Companion answer keys** in the generator; a
**co-change distractor strategy for Placement**, which §8.3 calls the *best* class of wrong answer
and which Placement is the only verb without, and which would lower ADR-0021 decision 3's exposure at
the source rather than gating it (it changes a shipped deck, so it wants its own measurement);
packaging **`npx ark`** (NORTH-STAR §10's stated intent, unbuilt — see the Definition of done); the **phenomenon
catalogue**, a repo-independent vocabulary of ~30–60 structural phenomena, which is the atom that
would let anything *transfer* to another repo and the other half of risk #1; and **M5**, which is what
the roadmap says (tree-sitter, 3–4 more languages) and is the largest bet — the scanner is
ES-modules-only, so a Python or Go repo still produces a map with no edges and no questions.

**M5 needs a kill-point stated before a parser is written**, and it is the reason it is last here
rather than next: ADR-0003 turns an unresolved import into no edge and guardrail 4 turns an uncertain
cone into no challenge, so a language whose imports resolve poorly yields a sparse map and an empty
deck **while every suite passes**. That is the instrument-that-measures-nothing landmine one level up:
it will not look like a failure, it will look like a small repo. Measure resolution rate, edges/node
against ark's 2.66 and hono's 2.51, and `report.unprovableNodes` on a real repo *first*, and be
willing to write the ADR that says the language does not ship.

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
