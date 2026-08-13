# Changelog

One line per iteration: what changed, and what to do next.

---

- **M0 — atlas format, indexer, verb contracts.** Wrote `docs/atlas-format.md` (schema v1) and the
  types behind it in `src/atlas/`; built the ES-module indexer in `src/indexer/` (gitignore-aware
  walk, comment/string-masking import scanner, `.js→.ts` resolution, `git log -z -M` history with
  rename lineage, seeded transcendental-free layout, label-propagation regions); added the `Verb`
  and `Grade` contracts plus F1 set scoring in `src/verbs/`; wired `test:unit` (122), `test:atlas`
  (57) and `test:determinism` (two independent processes, byte-diffed — verified failing first
  against an injected timestamp and an unseeded layout). Indexes this repo in ~110 ms to a 27.5 KiB
  atlas, 49 nodes, 78 edges, **zero unresolved imports**. Seven ADRs in `docs/decisions/` cover the
  calls the north star did not: no wall-clock time in the atlas, identity by rename origin,
  unresolved-means-no-edge, indices vs ids, the history budget, layout in the indexer, and the 0.5
  pass threshold. **Next**: `npm run budget` as a real script (the ceilings are currently asserted
  inside `test:atlas`, which is the wrong place for them), then M1 — the atlas has `layout` and
  `region` on every node and nothing renders them yet.

- **CI and budgets.** Added `.github/workflows/ci.yml` — typecheck, all three suites and `npm run
  budget` on every push and PR — plus a three-platform job that indexes this repo on Linux, macOS
  and Windows and requires the atlas fingerprints to match. That last one checks the claim
  `test:determinism` structurally cannot: it runs both passes on one machine, so it proves nothing
  about ADR-0006's "bit-identical across engines". Wrote `scripts/budget.ts` as a real measured
  report (verified failing against a lowered ceiling) and moved the size and time assertions out of
  `test:atlas`, which conflated correctness with means. Size is enforced **per file** as well as
  absolutely — 5 MB against a 28 KiB atlas would pass forever; 577 B/file against a 2,621 B ceiling
  will not. Index time stays advisory: at 4.2 ms/file against a 5 ms ceiling it is dominated by
  fixed startup cost and would flake on a shared runner. Added `.gitattributes` pinning `eol=lf` so
  checkouts agree across platforms. **The platform check found a real bug on its first run**: Linux
  and macOS agreed, Windows produced an atlas 2,478 bytes smaller with the same 51 nodes and 82
  edges — the same graph with its git history missing. Cause was `GIT_CONFIG_GLOBAL` pointing at a
  null device; `/dev/null` does not exist on Windows and `os.devNull` (`\\.\nul`) is not read as a
  config file either, so git fell back to the user's real global config, reintroducing exactly the
  machine dependence that setting removes. It now points at a real empty file in a temp directory,
  which means the same thing everywhere. All three platforms now emit byte-identical atlases, so
  ADR-0006's "bit-identical across engines" is checked rather than asserted. **Next**: M1 — the map
  render. Every node carries `layout` and `region` and nothing draws them.

- **M1 — the map.** Built the player: `src/player/` (camera, semantic zoom, fog of war, label placement,
  scene culling, canvas renderer, DOM overlay), served by vite as a static bundle — **23 KiB of JS,
  zero runtime dependencies**, first contentful paint 100 ms against a 1.5 s ceiling. Three zoom
  levels (territory → district → street), pan/zoom that holds the point under the cursor, and hover
  that lights up a file's **blast radius** in gold, which puts the M2 question on the map before the
  verb that asks it exists. `tsconfig.player.json` re-checks the player with `types: []`, so a Node
  import anywhere in it — or in `src/atlas` — is now a compile error rather than a promise: pillar 5
  enforced by the compiler. `test:e2e` builds the real bundle, drives it in Chromium, fails on any
  console error and screenshots the result; wired into CI, which is the only way "no console errors
  in the player" is checkable at all. **Looking at the first screenshot changed the design three
  times**: regions were one 36-of-64-file blob (barrels make label propagation conclude a repo is one
  community, so high-degree connectors are now held out of the vote and undersized regions are folded
  into their strongest neighbour — regions are now real modules, and each groups a test with the code
  it tests); the layout scattered every region across the map (added a cohesion force, so geography
  matches topology as pillar 4 requires); and every unsurveyed node was the same grey, which hid the
  regional structure entirely — silhouettes now carry their region's hue, drained almost to the
  background, which is what risk #4 actually asks for. Also: the most depended-upon files start named,
  because §4's loop opens with "pick a landmark" and you cannot pick one you cannot see; lockfiles are
  excluded as generated (`package-lock.json` was the largest node on the map and taught nothing).
  195 unit tests. **Next**: M2, the kill point — Blast Radius generation and the distractor
  subsystem. The graph query and the challengeability rule are already written and tested; what is
  missing is `generate()`, the four distractor strategies from §8.3, and difficulty from §8.4.

- **M1 review fixes (Fable).** Second opinion on the M1 tradeoffs found one real bug and several
  half-finished decisions. **`require(expr)` was silently dropped by the scanner** while
  `import(expr)` four lines away correctly recorded an unresolved reference — so a file doing
  `require(name)` looked fully resolved and could carry an answer key built on a dependency it was
  hiding, which is precisely the failure guardrail 4 exists to prevent. Fixed, with a regression
  test that fails first. **The `offMap` extension check was an allowlist**, so `.vue`/`.svelte`/
  `.astro` — formats full of imports — counted as inert; inverted to a denylist of known-inert
  extensions, so an unknown extension now costs a challenge rather than an answer key. Tightened
  ADR-0003's prose: "anything already traced really is a dependent" holds only over `certain` edges,
  and the truth half's soundness depends on the validator's `truth ⊆ candidates` rule. **Amended
  NORTH-STAR §7.1** to drop `indexedAt` and add `headDate`, since leaving the spec contradicting
  ADR-0001 invited a future session to "fix" the indexer back into nondeterminism. Wrote down that
  the layout's cohesion force is ~19× the distance to the centroid and therefore saturates the
  temperature clamp — the constant tunes late-iteration behaviour, not the force balance it appears
  to — and replaced "it looked right" with a measured floor: mean intra-region spread over
  inter-region spacing, **0.090 with cohesion and 0.356 without**, asserted below 0.20. The first
  version of that assertion used 0.75 and passed with cohesion disabled; a threshold that cannot
  fail is not a test. **Next**: M2, and two things to settle *before* writing `generate()` — the
  map's hover preview currently reveals a node's exact blast radius, which is a walking answer key
  once challenges exist; and §8.3's "distance n±1" distractor strategy will select real dependents
  one hop past the depth bound and grade excluding them as correct, so "dependent, to what depth,
  worded how" needs pinning down first.

- **ADR-0008 — M2 semantics, decided before writing M2.** The two collisions the M1 review flagged
  are now settled, by a second-opinion review the human asked to be treated as binding.
  **Truth becomes unbounded** and the prompt promises *dependence*, not required change: "A breaking
  change lands in X. Which of these files depend on it — directly, or through a chain of imports?"
  Both problems were the same defect — the prompt promising something the answer key does not hold —
  so they get one answer, not two patches. The depth bound turned out to protect nothing measurable
  (**depth-3 truth equals unbounded truth for every one of this repo's 69 nodes**) while planting a
  landmine: §8.3's "distance n±1" strategy would present real dependents at hop n+1 as correct
  exclusions. **The map now shows direct importers only**; the full radius renders only for nodes in
  `fog.understood`, revealed when a grade lands and unlocked by passing. Depth-1 is the right thing
  to give away because §8.4 defines `surprise` against exactly that naive guess — the map hands you
  the baseline, the grade measures what you know beyond it, and on this repo 23 of 30 answerable
  subjects have a full radius that differs from their direct importers. Hub subjects (`schema.ts`:
  4 direct, 39 transitive) ship a deterministic distance-stratified sample with every unsampled
  dependent banned from the candidate pool, which is the escape ADR-0007 already anticipated.
  **Amended NORTH-STAR §6.1** — its sample prompt and depth-bounded ground truth are both replaced,
  with a note pointing at the ADR, because leaving the spec disagreeing is how a future session
  "fixes" the generator back into over-promising. **Next**: M2 itself. ADR-0008 lists the algorithm,
  the invariant `candidates ∩ dependents(subject, ∞) = truth`, and every existing file that has to
  change. Nothing is implemented yet.

- **M2 — the Blast Radius verb.** The kill point, and the first iteration where the thing is a game.
  `src/verbs/blastRadius/` ships `generate()`, the four §8.3 distractor strategies, computed
  difficulty per §8.4, and a `reveal()` that turns a grade into the reason each pick was or was not
  in the radius. `npx ark index .` now emits **37 challenges, one per subject with a non-empty
  radius**, and the player has a challenge console over the map: partial credit, derived evidence,
  and `understand()` finally doing the job it was written for at M1 — passing a question lifts the
  fog on the subject and on the files you actually got right, and unlocks its full radius on the map.
  Everything ADR-0008 fixed is implemented as written: unbounded truth, the invariant
  `candidates ∩ dependents(subject, ∞) = truth`, a prompt that promises dependence rather than
  required change, and direct-importers-only on hover until you have earned the rest.
  **Kill-point verdict: continue, with a caveat.** The strongest part is the reveal — being told
  that `tests/unit/ignore.test.ts` reaches `src/atlas/serialize.ts` in three hops *through
  `src/atlas/index.ts`* is a true, non-obvious, useful fact about this repo, and it is the moment
  §4 promises. The distractors carry it: on a question about `src/atlas/schema.ts`, `order.ts` and
  `identity.ts` sit in the same directory, are imported by the same files, and import nothing from
  it — you have to reason to reject them. The caveat is that **the evidence is thin and partly
  negative**. 30 of 37 answer keys are exactly 6 files, which is a tell an attentive player would
  learn; 5 pairs of subjects have byte-identical answer keys because their cones genuinely are
  identical; and two of the four strategies are nearly dry here (`nameSimilar` found 2 wrong answers
  in 37 questions, `coChange` found **0**, because 14 commits produce no co-change signal and
  because files with confusable names in a small disciplined repo usually really do import each
  other). 96% of the wrong answers came from two strategies. So the loop works, but *this repo
  cannot tell us whether it stays interesting* — that needs a bigger codebase with real history,
  which is also the only thing that will exercise §8.3's best strategy.
  **Three things measurement caught that reading would not.** (1) Ranking a hub's sampled answer key
  by in-degree — "hubs are memorable" — produced seven groups of subjects with identical answer keys,
  every `src/indexer/` module answering the same five files plus its own unit test, which collapses
  the question into "which test shares this name": pillar 3's Ctrl+F failure reached from the other
  side. Ranking by *smallest transitive dependency set* instead — prefer the dependent that
  discriminates — cut that to five. (2) Generation took **15.3 s on a 2,000-file fixture** while
  scoring a comfortable 2.93 ms/file on this one, because it is superlinear and the budget script
  only extrapolated linearly; certifying every considered subject rather than the shortlist cost 7 s
  of that, and tokenising filenames inside the per-subject loop cost the rest. Now **1.8 s**, and
  `npm run budget` measures it on a synthetic 2,000-node graph rather than projecting it. (3) Two
  regions were both labelled `src/verbs/index`, so the legend claimed two different colours were the
  same place — refinement now uses the hub's path below the shared name, and an atlas test asserts
  labels are unique. Atlas grew 40 → 83 KiB (1067 B/file against a 2621 B ceiling). 266 unit tests,
  62 atlas tests. Every new assertion was checked by breaking the thing it claims to check: three of
  them could not fail and were rewritten — the flagship-distractor test passed with the flagship
  disabled, the sampling test used an even sample size where round-robin is direction-blind, and the
  inert-file test put its `.md` files where no strategy would have offered them anyway.
  **Next**: M3 — progression, field notes and localStorage — and the first thing it should fix is
  the repetition above: never serve two near-identical answer keys in a row, and rank by difficulty
  rather than by whatever the player clicks. Also worth doing before M4: point the indexer at a
  large repo with real history and re-read this entry, because `coChange` has still never fired.

- **ADR-0009 and the first real-repo test.** Two things, one session.
  **ADR-0009 — third person is a presentation layer, and it is blocked.** The human asked for a
  third-person POV, which NORTH-STAR §9 and Appendix B forbid, so it needed an ADR rather than a
  quiet edit. Accepted *in principle*, blocked, and deliberately **not** on the roadmap: three
  preconditions (risk #6's prior-art writeup, finally; M3/M4 plus a large real repo answering the
  content question; the unmeasured map-interaction budget closed), three design constraints (the
  overview survives; the world renders the atlas and never the reverse; ADR-0006's no-transcendentals
  rule carries forward), and one ship criterion that only the human may sign off. If the gates open,
  **the orbit fly-through is built first and the walkable avatar is gated behind its measured
  results** — it preserves X,Y by construction and has no ground to invent, so it cannot violate
  pillar 4. A Fable review demolished the first draft and was right three times: the "88%
  presentation-independent" figure dropped `main.ts` and `palette.ts` from its own denominator (it is
  **74%**), `node.layout` is *not* the only 2D thing in the atlas (`Region.centroid` is another, and
  `asPoint` hard-asserts two coordinates), and the method-of-loci argument was backwards — the
  map-learning literature says map study beats navigation for exactly the *survey* knowledge this
  product teaches, so the strongest "for" argument predicts the flat map wins its own experiment.
  All three corrections are in the ADR rather than edited out.
  **Then we pointed it at real repos, and it broke in four measurable ways.** `vllm` first, at the
  human's suggestion: **918 nodes, 0 edges, 0 challenges** — it is 4,108 Python files and the v1
  scanner is ES-modules only (§7.2), so 5,494 files were skipped as unsupported. Not a scale test, a
  language test, and Ark fails it. It did reveal that **the walk (4.1 s) and `git log` (2.4 s)
  dominate index time on any real repo** — 6.5 s of a 10 s budget before a single import is parsed.
  Then `vitejs/vite`: 2,025 nodes, 3,730 commits, **9.7 s to index against a 10 s ceiling**. Findings,
  in order of severity. (1) **97% of the questions are about the wrong thing.** 197 of 254 subjects
  are `playground/` demos and 49 are test fixtures; **7 are about vite's actual source**, because 54%
  of `packages/` is refused by guardrail 4 (762 unresolved imports — workspace aliases and tsconfig
  paths the resolver does not know) while the playground's tiny self-contained fixtures resolve
  perfectly. The guardrail is working exactly as designed and is systematically selecting the least
  interesting part of the repo. (2) **The map is unreadable** — 771 regions for 2,025 nodes, and
  `draw.ts` renders every region label with no collision pass (node labels get one, region labels do
  not), so the screenshot is a solid smear of overlapping text. Risk #2, confirmed. (3) **A real
  defect in M2's generator**: truth was sampled from the dependent set without filtering by taint, so
  a tainted answer-key member dragged its unsound cone onto the board and `isChallengeable` refused
  the whole question — **14 of 40 shipped challenges lost for no reason**. Fixed by sampling from the
  certain dependents only, which is free because unsampled dependents are banned from the board
  anyway. vite went **26 → 254 challenges**, and `coChange` produced its first distractors ever (12).
  (4) **`maxChallenges: 40` was the wrong shape** — 26 questions for a 2,025-file repo. Now
  `maxChallengesFor(n) = max(40, ⌈n/8⌉)`; ark is unchanged at 37.
  **A cold playtest on vite scored 80% over five questions, and that is the bad news.** Four of the
  five were answerable by "which file in this directory is called `index.js`" — pillar 3's stated
  Ctrl+F failure. The fifth scored 0% and was worse: difficulty **0.91**, a synthetic 24-deep chain
  `a24 → … → a0` that exists only to exercise vite's bundler, whose reveal printed a 24-hop route as
  a wall of text. **§8.4's `surprise` term cannot tell "surprising because the architecture is
  subtle" from "surprising because it is a generated chain"**, and it ranked the most worthless
  question in the deck top. That is the sharpest thing this session learned.
  **Next**: not M3. The content question is now answered and the answer is no — on a real repo the
  questions are about the wrong files. Fix that first: teach the resolver tsconfig `paths` and
  workspace packages (it converts 54% of vite's source from unaskable to askable), decide what to do
  about repos that are mostly fixtures, cap the reveal's route rendering, and give region detection
  and region labels a collision pass. Then M3.

- **M3a — make it work on a real repo.** Three fixes the vite run demanded, in the order the
  dependencies forced. **ADR-0010** records the design; a Fable consult rejected two of the three
  framings I started from and was right both times.
  **1. Resolution reads the manifest nearest the importing file.** `loadProjectConfig` read only the
  repo root, which is correct for one package and wrong for every monorepo — vite has 299
  `package.json` and 55 `tsconfig.json` files, and 762 unresolved specifiers traced to three causes,
  all of them "we looked in one directory": `~utils` ×126 declared in `playground/tsconfig.json`,
  614 bare specifiers declared in `packages/vite/package.json`, and 81 `#types/*` declared in that
  file's `imports` map. Now: dependencies **union up the tree** (Node's `node_modules` walk), `#`
  imports resolve at **the nearest package boundary only** (Node's rule), and `paths`/`baseUrl` come
  from the **nearest tsconfig** with relative `extends` followed (TypeScript's). vite: unresolved
  **762 → 399**, edges 1745 → 1885, `packages/` refused by guardrail 4 43% → 36%, challenges about
  the real source **7 → 21**.
  **2. A workspace sibling is never `external` — a soundness bug, not a coverage gap.** vite's root
  manifest declares `"vite": "workspace:*"`, so `import 'vite'` from a playground file resolved as
  `external`, whose contract says *"no risk: nothing outside the repo can import back into it"* — of
  an import that reaches 332 files **inside** it. The file looked fully resolved and was hiding a
  dependency, which is the false negative guardrail 4 exists to catch, and the same class as the
  `require(expr)` bug found at M1. It is now `unresolved`, which taints and costs a challenge. We
  cannot do better: a package's entry point is its `exports`/`main`, and in a monorepo those name
  *built* output that is gitignored — **you cannot map cross-package edges without a build, and
  pillar 6 forbids requiring one.** Two more resolver bugs fell out: wildcard `paths` targets lost
  their separator (`@app/*` → `src`, so `@app/foo` resolved to `srcfoo`) — **broken since M0**,
  invisible because Ark declares no `paths` and the unit test hand-wrote its target with the
  separator already attached; and `tsconfig.base.json` was not recognised as a manifest, so an
  `extends` chain silently dropped its inherited `paths`.
  **3. Terrain, islands, and a collision pass.** 56% of vite's nodes have no edge at all, and the old
  fallback grouped them by *exact* directory — which alone manufactured ~500 of the 771 regions, and
  `draw.ts` then printed every region label with no collision test. **Not** a label-propagation
  failure, so `CLAUDE.md`'s Leiden tripwire does not fire: propagation never sees a degree-0 node.
  Edgeless files and sub-floor components now aggregate into `terrain` regions by top-level segment
  (`Region.kind`, **ATLAS_VERSION → 2**), share one desaturated wash instead of eating palette slots,
  and region labels go through the same `placeLabels` node labels already used — with node labels now
  reserving the boxes regions took. vite: **771 → 123 regions**. No cap on region count: the bound
  `regions ≤ n/3 + topLevelDirs` is a theorem from the floor, asserted in `test:atlas`.
  **4. The Ctrl+F gate.** Pillar 3 says a challenge is violated when it is "answerable by Ctrl+F
  rather than by reasoning about structure", and a cold playtest had just demonstrated it: four of
  five vite questions fell to *"which file here is called `index.js`"*. Two structure-blind
  strategies — select-the-directory, select-the-name-alikes — are now scored with the real
  `scoreSet`, and a board either beats them or is refused. **The bar is band A, not the pass
  threshold**: in a directory-aligned codebase "these files are coupled" is cheap but *true*, and at
  0.5 the deck fell 254 → 57 taking two thirds of the real-source questions with it; at 0.78 it keeps
  163, and 0.70 and 0.78 keep the identical count so the threshold sits on a plateau. Ark keeps all
  39 of its challenges; vite sheds 139. **A repair pass was written, measured, and deleted** — it
  rescued **zero** boards on both repos, because §8.3's 25%-siblings/20%-name-alikes mix already *is*
  the repair, so a board that still loses is one where that supply does not exist. The synthetic
  `a24 → … → a0` chain that §8.4 ranked hardest dies exactly where it should: at the chain's *end*,
  where every file in the directory is a dependent. A subject in the *middle* survives, because the
  files it imports are same-directory non-dependents — ADR-0008's flagship distractor, doing its job.
  **Budgets, and one breach stated out loud.** `npm run budget` only ever measured Ark — 86 files,
  292 ms, 4% of the reference scale — which has now hidden two regressions. It takes
  `ARK_BUDGET_REPO` and reports a real clone: **vite indexes in 10.6 s against a 10 s ceiling**, an
  advisory breach. The cost is not in anything this rung added — profiled, it is `computeLayout`
  (seconds, grid-bucketed force sim at 300 iterations) and `git log --numstat` (4.4 s for 3,730
  commits). 353 unit tests, 64 atlas tests. Every new assertion was mutation-checked; two could not
  fail and were rewritten, and one of those is how the dead repair loop was found.
  **Next**: index time. `computeLayout` and `git log` own the 10 s budget and neither has ever been
  optimised. Then M3 proper — progression, field notes, localStorage.

- **Index time: one flag, 11.9 s → 7.0 s, byte-identical output.** The budget row added last rung
  said vite indexed in 10.6 s against a 10 s ceiling. Profiled per phase rather than guessed at:
  `git log` **4.3 s (42%)**, `computeLayout` **3.9 s (38%)**, walk 1.6 s, everything else under
  350 ms combined. The git half turned out to be free money. `parseLog` read the *third*
  tab-separated field of each `--numstat` line and threw the first two away — and nothing downstream
  ever wanted them, because churn, authorship, co-change and rename lineage all need only *which*
  files a commit touched. But `--numstat` makes git diff the content of every file in every commit
  to produce those numbers. `--name-status` carries the same information, plus the rename similarity
  score, and needs no content diff: **4,027 ms → 308 ms on vite's 3,730 commits**, for a payload
  that is actually 3% smaller. Full index **11,881 → 6,957 ms**, and the resulting atlas is
  **byte-identical** — verified by `cmp`, which is the strongest claim available that a performance
  change altered nothing. The parser rewrite was checked the same way: a differential harness parsed
  both formats over **5,251 commits across ark, vite and vllm** and found **0 file-list mismatches
  and 0 rename mismatches**. Two behaviours the old format could not express are now explicit and
  tested: a `C` copy touches the new path but is **not** a rename (feeding it into the lineage would
  make two live files claim one origin path, which is the ambiguity ADR-0002 throws on), and a `D`
  delete still counts as churn.
  **Layout is now the ceiling risk, and it is measured, not guessed.** 3.9 s of the remaining 7.0 s.
  The bookkeeping is not the problem — the per-iteration grid rebuild costs 35 ms across all 300
  iterations and the 9-cell lookups 95 ms. The cost is the physics: **300 iterations × 2,025 nodes ×
  533 neighbours within the cutoff = 324 million distance computations**, because the layout
  converges into a blob dense enough that a cutoff radius covers a quarter of the map. **Every lever
  that would reduce it — a smaller cutoff, fewer iterations, Barnes-Hut — changes layout output**,
  and NORTH-STAR §7 puts layout in the indexer precisely so that the same repo gives the same map
  forever. So it is not a tack-on: it needs its own rung and probably its own ADR about what we are
  willing to trade. It is not urgent — 7.0 s against a 10 s ceiling — but it is what breaks first.
  **Next**: M3 — progression, field notes, localStorage. We now know what progression has to fix,
  because it was measured rather than assumed: order by difficulty, and never serve two
  near-identical answer keys back to back.

- **M3 rung 1 — progress survives a reload, keyed on the repo's identity rather than its state.**
  Answering a question and pressing F5 no longer resets the map. `ADR-0011` settles the whole stored
  shape first, because all three M3 rungs write into the same object and deciding it three times
  would guarantee three different answers.
  **The key is `repo.root`, a new atlas field — the sha of the first commit on HEAD's first-parent
  chain.** NORTH-STAR §10 said "keyed by repo + HEAD", and that cannot stand next to ADR-0002 (node
  identity survives renames *so that* fog and field notes survive a refactor): HEAD moves on every
  commit, so a HEAD-keyed save is wiped by every reindex. `root` is identity, `head` is staleness;
  the north star row is amended and points at the ADR. `--first-parent` is not decoration —
  `--max-parents=0` alone lists *every* root, and a subtree merge adds one, so a "pick one from the
  list" rule can change its mind and rotate every player's save. **It is null for a shallow clone**,
  where the oldest reachable commit is a graft boundary that moves on every fetch: not a corner
  case, since both large repos measured in the last two rungs were `--depth` clones. That falls back
  to `ark:name:<name>`, which is documented as weaker rather than hidden — `NodeId` hashes
  `originPath` and is therefore repo-*independent*, so two repos under one key would share
  `understood` promotions, and an `understood` node unlocks its full radius on hover, silently
  reopening the leak ADR-0008 closed. `ATLAS_VERSION` 2 → 3, `docs/atlas-format.md` §3.1 in the same
  commit.
  **`Progress` is now the state and `Fog` is a view of it.** Only `{surveyed, passes}` is stored;
  `understood` is derived at load, because storing it alongside the passes that justify it would be
  two representations of one fact that disagree after a reindex. A pass is keyed by `(verb, subject)`
  — never by `challenge.id`, which the format promises is stable only *within* an atlas. That
  collapses the restore path into the live path: the same function that renders a fresh session
  renders a restored one, so a save that restored wrongly would break a test the session already runs
  hundreds of times. Two passes on one hub union rather than replace, because answer keys are sampled
  and guardrail 6 forbids the second attempt taking away what the first earned.
  **A restored claim is re-checked before it is rendered as knowledge.** Provenance is immutable —
  you did prove it — but each proved member is re-validated against `dependents(subject, ∞)` on load,
  and a pair the graph no longer supports is dropped; a fully decayed pass demotes its subject and
  the map re-fogs. Stored ids that name nothing are ignored at render and **kept in storage**, so
  reverting a deletion restores your map.
  **Two defects, found two different ways, neither by reading the code.**
  *Mutation testing* (16 mutations, each reverted after) found the harness itself was lying first:
  `--reporter=basic` is not a vitest 4 flag, so every run exited non-zero and every mutation read as
  "caught". With that fixed, two survived — `--first-parent` was untested because the fixture repo
  had one root, and the root-sha shape check had no test at all. Both now have one: a repo with a
  vendored second root dated *later* than the mainline, so a naive `rev-list` returns the wrong sha
  first, and a validator case for each half of the head/root nullability rule (they are deliberately
  **not** symmetric — a shallow clone has a head and no root).
  *Looking at an e2e screenshot* found the other: the HUD read **38 questions after one pass**, not
  39. Deriving the deck from `fog.understood` retired a question nobody had answered — picking a file
  correctly in someone else's question proves you know it sits in that radius, and proves nothing
  about its own. The deck now reads `answeredSubjects()`, which is the subjects of surviving passes.
  The assertion that catches it fails against the old rule.
  **`survey()`, `understand()` and `CLEAR_FOG` are deleted.** With the fog derived, they were reached
  only by their own tests — the landmine about code and test surface asserting a behaviour the
  product does not have. `fog.ts` now owns the vocabulary and none of the state.
  Verified: 319 unit + 72 atlas tests, byte-identical atlas across two runs, all hard budgets inside
  ceiling (index 271 ms, generate@2000 2.9 s, 0 runtime deps), e2e clean with first paint 148 ms —
  and the e2e now **reloads the page**, asserts the key is the root sha and not HEAD, and fails if
  either the fog or the deck comes back empty. That assertion was itself checked by breaking
  `loadProgress`.
  **Next**: M3 rung 2 — the progression selector, per ADR-0011 decision 4: ascending
  `(tier, difficulty, id)`, skipping a challenge whose truth is byte-equal to the last served, then
  one whose region matches. Both constraints were measured on ark and vite before being written; (a)
  fixes the repetition defect, (b) buys the tour. Then rung 3, the field-notes panel — which is why
  `livePasses()` already returns the narrowed pass rather than just a boolean.

- **M3 rung 2 — the progression selector, and the deck stops repeating itself.** A "Where next?"
  panel offers the next question by ADR-0011 decision 4's rule. It **takes you to a landmark; it
  does not open a question** — §4's loop is "pick a landmark", and the ADR calls suggested-next an
  affordance rather than a mode, so the button pans the map, selects the subject and leaves the
  existing "answer this" control one keystroke away. Sending the player straight into a modal is the
  first step towards the quiz deck nothing in the spec licenses.
  **The rule is unchanged in behaviour and is now one lexicographic minimum over
  `(attempts, sameTruth, sameRegion, tier, difficulty, id)`.** Three measurements forced that
  shape, and ADR-0011 decision 4 is amended with all of them. (1) Written literally as a relaxation
  ladder, the *drop-the-truth-constraint* rung **never executed** on either repo under any player
  model — the landmine about machinery that never fires, arriving on schedule. As a ranking there is
  no such rung: the key is total. (2) "A session-scoped attempted set" was one sentence hiding a
  defect — as a hard filter it falls through to "serve the first unanswered" the moment every open
  question has been tried, which is routine in the endgame: **79 consecutive identical answer keys
  out of 120 servings** for an always-failing player on this repo. As the outermost rank component
  the deck rotates instead, every question served equally often. (3) A least-recently-attempted
  rotation was the reviewed alternative and measured **worse** — it drops both constraints once
  everything has been tried, and that costs 4 consecutive identical keys on ark and 3 on vite
  against 1 for the ranking. A perfect player gets the same result under all three, which is why the
  ADR's original table still stands.
  **A surviving mutation, reported rather than papered over.** Swapping `attempts` and `sameTruth`
  in the key changes **no choice at all** — 0 divergences across full playthroughs of both repos at
  two failure rates — so there is deliberately no test pinning it, and the code says why. A test
  asserting a distinction the product never exhibits is the same mistake as a fallback that never
  fires. `attempts` above `sameRegion` *is* load-bearing and is tested: below it, the selector
  re-serves a question the player already failed in order to move region, spending a fresh question
  to buy variety it could have had free. That mutation was caught only after the first attempt at a
  discriminating test failed to discriminate.
  **`tests/atlas/selector.test.ts` is the permanent instrument**, playing this repo's real 40-card
  deck through three player models. It asserts the defect is *present* — the plain sort must still
  produce consecutive identical keys here — so the constraint below it can never pass vacuously.
  One repeat survives a half-failing playthrough and is not a defect: with one question left and
  just failed, every possible rule re-serves it, so the test asserts the honest property, no repeat
  *while an alternative exists*.
  **Two unrelated things surfaced.** Adding `selector.ts` pushed the repo to 24 commits and the
  **co-change distractor strategy fired for the first time** (5 wrong answers) — the caveat recorded
  at the M2 kill point is now closed. And the Ctrl+F gate declined its first subject on this repo,
  which broke `atlas.test.ts`'s "every subject with a radius ships a question". That assertion was
  too strong — the guardrails are *allowed* to refuse. It now asserts what actually matters: nothing
  goes missing silently, so shipped + refused = subjects with a radius, and `noDependents` is
  separated out as "no radius to ask about" rather than counted as a refusal.
  Verified: 336 unit + 81 atlas tests, byte-identical atlas, e2e clean — the browser run now clicks
  the suggestion, fails if it opens a modal, if it lands somewhere the name is not drawn, if it
  offers the question just answered, or if the caption still points elsewhere after arriving.
  **Next**: M3 rung 3 — the field-notes panel, over `livePasses()`, honest about sampled keys per
  ADR-0011 decision 3. Also noticed and *not* fixed: node labels near the top edge draw underneath
  the inspector and HUD panels. `placeLabels` already accepts `occupied` boxes for exactly this, so
  the fix is feeding it the overlay rects — it needs main.ts to measure DOM for the canvas, which is
  a real change and its own rung.

- **M3 rung 3 — field notes, which claim only what was proved.** §9's codex, over the map on the
  same scrim the challenge console uses, so reading what you know never costs the spatial context
  you built it from. A note reads: *"You proved 6 files that depend on
  `src/verbs/blastRadius/difficulty.ts` — …, …, … — the farthest 5 hops away."* and, in a dimmer
  second line, *"Its full radius — 24 files — is revealed on your map."*
  **That split is the whole rung.** §9's own example — "You know that `engine.ts` has 14
  dependents" — is not provable and ADR-0011 decision 3 amends it: under ADR-0008 a hub's answer key
  is a deterministic *sample*, so a player who passes has proved some members, never the count. The
  count was **shown** to them in the reveal, which is the `surveyed` side of the very line §9 calls
  the product. So the claim names the files; the radius appears only in a line labelled *revealed*,
  visually and grammatically apart. Correct exclusions get no note at all — `progress.ts` already
  declines to promote a box you left unticked, and a note must not claim more than the fog does.
  **Prose is derived at render, never stored**, from templates that mention no repo (guardrail 2) —
  a test tokenises the output and asserts every `/`-containing word came from the atlas. Names
  resolve `NodeId → path` through the atlas currently loaded, so a note follows a rename, which is
  ADR-0002 doing the job it was written for. Nothing is cached: a claim can decay between sessions,
  and a cached sentence would go on asserting something the graph stopped supporting.
  **Two mutations survived and both said the same thing**: `notes.ts`'s own "drop a decayed member"
  and "skip an empty note" guards are *unreachable*, because `livePasses` already applied that rule
  upstream. Rather than delete guards the types need, or keep two implementations of one rule, the
  code now says which layer owns it and why the guards remain — and the tests say they assert an
  end-to-end property enforced a layer up, so a future reader does not mistake `notes.ts` for the
  filter. Five other mutations were caught, including the one that matters: claiming the radius
  instead of the proved count.
  **A class-name collision, found by looking at the screenshot.** The new panel's `.note` picked up
  the challenge console's existing `.note { display: flex }`, so the revealed line rendered *beside*
  the claim instead of beneath it. Renamed to `.field-note*`, and the e2e's reveal assertion is now
  scoped to `.console-notes .note` — it had silently become ambiguous between the two lists.
  Verified: 348 unit + 81 atlas tests, byte-identical atlas, build clean, e2e clean — the browser
  run opens the notebook, fails if a note does not start "You proved", if its count disagrees with
  the answer key just proved, or if the radius is stated as knowledge rather than as revealed.
  **M3 is complete**: progression, field notes and a localStorage save that survives a reload.
  **Next**: the honest choice is between two things, and the CHANGELOG should not pretend otherwise.
  (a) **Generator-side dedupe** — identical answer keys are ultimately a *generation* artifact, those
  pairs are arguably one question wearing two subjects, and the selector only stops them being
  adjacent. (b) **Labels versus the overlay panels** — node labels near the top edge draw underneath
  the inspector and HUD, which is a legibility defect on the pillar the map exists for;
  `placeLabels` already accepts `occupied` boxes, so the work is feeding it the panel rects, which
  needs main.ts to measure DOM for the canvas. (a) is worth more; (b) is more visible.

- **Direction recorded, and ADR-0009's precondition P3 closed — the interaction budget is measured,
  and it is missed.** The human stated that a **third-person explorable world** (Zelda, Assassin's
  Creed) is the intended final form of the product, not merely an allowed one. That is a north-star
  change and is written into `NORTH-STAR.md` §9 and the head of ADR-0009 as such. It changes the
  destination and therefore the standard every 2D decision is held to — a choice that reads well
  flat but cannot survive being walked through is now the worse choice. It changes **none** of
  ADR-0009's gates: the invariant, three preconditions, three design constraints and the recall
  experiment all stand, and the roadmap still has no slot for it. A destination is not a schedule,
  and the honest way to serve it is to close the preconditions — work with its own payoff in 2D.
  So: **P3**, which ADR-0009 assigns to M3 and M3 shipped without. `npm run raster` drives the built
  player in a real browser against a 2,000-node atlas positioned by the *real* layout — a grid of
  evenly spaced dots would understate overdraw, which is the cost being measured — and reports frame
  time at three zoom levels. **45 / 33 / 43 fps at p95 (territory / district / street), against a
  ≥ 50 fps target. Below target at every level.** Stated plainly per CLAUDE.md: a silently blown
  budget reads as success.
  **What that does and does not license.** It closes P3 — the number is no longer unknown, so a
  future renderer can be compared against something. It does **not** on its own license WebGL: the
  run is headless and software-rasterised in a container with no GPU, so it is a *floor*, not what a
  desktop sees. The right next step is re-measuring on real hardware, not rewriting the renderer
  against a container's numbers.
  **The instrument is worth more than the number, and it caught itself lying twice.** Version one
  reported a confident 33 / 49 / 35 fps — measured against a map that **was not moving at all**,
  because synthetic pointer events did not drive the drag in that harness. Version two, after
  switching to real input, still measured nothing: wheeling out to reach the `territory` zoom drove
  the scale into `clampScale`'s floor, where 2,000 nodes render as a sub-pixel smudge and a pan
  changes no pixels. Both were caught by a liveness gate that hashes the whole canvas before and
  after the drag and **refuses to print timings when they are identical**. A third bug — three
  `requestAnimationFrame` chains accumulating into one buffer after the recorder was re-installed
  per level — showed up as p50 deltas of 0.0 ms. Without the gate, P3 would have been recorded as
  met on fiction, which is worse than leaving it open.
  Also recorded, twice bitten: `page.evaluate` bodies must contain no `const f = () => …`, because
  tsx transpiles this repo with esbuild's `keepNames` and the injected `__name` helper does not
  exist in the page.
  **Next**: unchanged from the previous entry — generator-side dedupe of identical answer keys is
  worth more; labels drawing underneath the overlay panels is more visible. Ahead of both, if this
  is to be a world you walk: **re-measure `npm run raster` on real hardware**, because every renderer
  decision after this one leans on that number.

- **Generator-side dedupe — an answer key is issued once, and the deck stops asking the same
  question twice.** M3's selector kept byte-identical answer keys apart; this removes them at the
  source, where they are made. `ADR-0012` records it.
  **Measured on four repos before deciding anything, and the numbers moved the decision twice.**
  ark 40 challenges / 35 distinct keys; vite 163/122; **svelte 350/138 — 61% of the deck was
  repeats**; vue/core 7/7. The causes were separated first, because they want opposite treatment:
  *identical cones* (one question wearing two subjects) versus *different cones whose six-file
  sample collided*. Every duplicate on ark, vite and vue is the first; svelte has 6 of the second in
  23 groups. So diversifying the sampling — one of the three options on the table — could not have
  fixed 41 of the 46 redundant challenges on ark+vite, and skipping alone would have thrown away
  real content where the cone has room to spare. Both, then: **a colliding subject is re-asked with
  the next disjoint window of its own ranked dependents; if the cone is entirely inside the key
  there is no second question to ask and it is refused as `duplicateKey`.** Windows tile rather than
  slide, because a key differing by one file is the same thing taught twice and byte-equality would
  not even see it. Result: **no repo loses a distinct question.** ark 35 → 39 distinct, vite 122 →
  122, svelte 138 → 153; redundant keys 5/41/212 → **0/0/0**. Re-asking fires 3 times here, 15 on
  svelte, 0 on vite, and `report.reasked` prints the count on every run so the branch cannot quietly
  die.
  **I supplied Fable a wrong number and it built a whole objection on it, which is worth recording.**
  The first reading measured *raw* cones and found svelte classes of 63 subjects sharing a
  2,745-file cone — vast spare supply. The generator may only sample **certain** dependents, and
  those classes have cones of **3, 19 and 115**. The review's sharpest point ("62 disjoint windows of
  one cone rebuilds the defect one level up") was answering a repo that does not exist. `generate.ts`
  and the ADR both carry the correction in-line rather than quietly using the right number.
  **Three things the review got right that measurement then decided.** (1) *The representative was
  picked on `difficulty`, which is normalised by repo-wide maxima* — so an edit anywhere could swap
  which twin survives, and since the save is keyed by `(verb, subject)` a swap re-serves a question
  the player already answered wearing the other name. It is now an unnormalised local count: how many
  answer-key files are **not** direct importers, i.e. how many answers the map's hover has not already
  given away. The flip is derivable but **not observed** — the two rules agree on ark and svelte and
  differ on one vite group — so a test pins the rule's direction and nothing pins the choice of
  quantity, deliberately. (2) *Refusing a duplicate costs coverage, silently.* `progress.ts` promotes
  a node only as a subject or a picked answer, so a dropped twin in nobody else's key can never leave
  the fog: **ark 69 → 68 provable nodes, vite 245 → 213, svelte 391 → 282**. `report.unprovableNodes`
  now carries it and the CLI prints it. (3) *Exact dedupe fixes the metric, not the whole defect* —
  true, and only on this repo: pairwise J ≥ 0.5 falls 14.6% → 2.6% on svelte and 1.5% → 0.45% on
  vite, but barely moves here, 12.6% → 11.2%.
  **So ADR-0011 decision 4 loses its first constraint and gains a better one.** `sameTruth` was a
  byte-equality flag guarding against something the generator now cannot emit — a branch that can
  never be taken, arriving by the usual route of fixing a cause and leaving the symptom fix behind.
  It is replaced by a **continuous overlap term with no threshold**, which is why this is not the
  Jaccard cutoff that ADR refused: nothing has to decide how much sharing is too much, and identical
  keys score 1.0 as the limiting case. **Its placement was measured, not argued.** Above `difficulty`
  it wins its own metric and loses the product — mean served overlap 0.001 on svelte, but the served
  difficulty *falls* 39 times in 152 against 4, a tour rather than a curriculum. Below it, the
  progression is untouched and it still fires constantly, because difficulty is rounded to two
  decimals: it changed the actual pick 2 times in 39 here, 3 in 122 on vite, 41 in 153 on svelte.
  **Mutation testing found four assertions that proved nothing, and two of them were mine from this
  session.** The stability test I wrote for the representative rule passed with the rule reversed *and*
  with it replaced by difficulty, because both twins in its fixture tied — it is now a gadget where
  two subjects are reached by the same six files at different distances, and it catches the reversal.
  Two selector tests picked the right challenge by **alphabetical id order** rather than by overlap,
  passing with the whole overlap term deleted and with it collapsed back to a boolean; the fixtures
  now name the most repetitive option so it sorts *first*. Two mutations survive and are reported
  rather than papered over: pre-reserving every canonical key instead of only the uncontested ones
  changes **zero** keys across three repos, and the representative quantity is unpinned as above.
  Both say so in the code, neither has a test.
  Also, one existing test was pinning the wrong thing: `gate.test.ts` named `a12` as its chain middle,
  and in a chain every subject shares the same tail, so dedupe now re-asks all but three of them out
  of existence. It asserts over *whichever* middles survive — and the synthetic chain that used to
  generate sixteen near-identical questions now generates three with disjoint keys.
  Verified: 354 unit + 82 atlas tests, byte-identical atlas across two runs, build clean, all hard
  budgets inside ceiling (vite indexes in 5.2 s of 10 s), e2e clean with first paint 244 ms.
  **Next**: the twin that gets dropped is never mentioned to the player, and `cone(A) = cone(B)` is a
  true, derived, non-obvious fact — on vite's fixture clusters, arguably worth more than the nine
  questions it replaces, since each of those has a depth-1 answer the map hover already gives away.
  It would be a *shown* fact: named in the reveal, no field note, no `understood` promotion, and it is
  the natural mitigation for the coverage cost above. Still open and more visible: node labels near
  the top edge draw underneath the inspector and HUD panels — `placeLabels` already takes `occupied`
  boxes, so the work is feeding it the overlay rects from `main.ts`. Ahead of both, if this is to be
  a world you walk: **re-measure `npm run raster` on real hardware.**

- **P1 closed — the prior art, four milestones late, and it says the direction is right and the
  destination was two different things.** `docs/prior-art.md`; ADR-0009's P1 is struck through with
  the verdict, risk #6 is closed in `NORTH-STAR.md`. Four parallel tracks: why the tools died, what
  the empirical literature says about 3D, what Promptasy actually does as a *game*, and a Fable
  design consult on the world. **Caveat recorded at the top of the writeup and repeated here: the
  egress proxy blocked ACM, IEEE, ScienceDirect, Springer, arXiv, and the vendors' own sites**, so
  almost every figure reached us through a search engine that read the page for us. The shape of the
  literature is well attested; the decimal places need re-verifying from an unblocked machine.
  **P1 is not triggered, and P1 was the wrong gate.** No tool in the category died of 3D
  legibility — category (a) has no members. Sourcetrail was the flagship **2D** tool, exactly what
  you would build if you thought 3D was the problem, and it died of maintenance burden and weak
  demand after giving itself away because *"not all developers saw the value"*. CodeSee died of
  business. CodeCity, Code Park, CodeMetropolis and Softwarenaut were research prototypes that
  decayed. Gource is a viewer by choice. CodeCharta — a 3D city metaphor — is alive and commercial.
  So the historically attested killer is **maintenance burden**, which a 3D layer multiplies. P1 is
  replaced by **P1′** (re-measure raster on real hardware, state the CI/platform cost, weigh against
  a *measured* comprehension gain).
  **The finding that changes the destination: the evidence splits on viewpoint, not dimension.**
  *Exocentric* 3D — rotating a structure you stay outside of — wins, and wins on **Ark's exact
  task**: path tracing in node-link graphs, Ware 1996 (~55 → ~160 comprehensible nodes at fixed
  error; **motion parallax +120% beat stereo +60%**, so no headset), replicated 2005, and a
  **preregistered** 2023 study that beat a 2D baseline carrying edge routing *and* interactive
  highlighting. *Egocentric* 3D — inside it — is the condition that **lost** in the two studies
  closest to the walkable proposal: spatial memory for item locations degraded **monotonically** with
  dimensional freedom (Cockburn & McKenzie, n=69, in *physical* environments too, so not a rendering
  artifact), and traversing a virtual building was the worst of map / real navigation / VE. **Spin
  the repo is supported; walk the repo is not**, and new gate **P4** says the avatar additionally
  waits for the Trace verb, because before Trace the product asks no question walking answers better.
  Also corrected: **CodeCity's +24%/−12% does not license 3D** — its control was Eclipse plus a
  spreadsheet, not a 2D visualization, and the gain concentrated on *overview* tasks.
  **The differentiator survives, and the irony is sharp.** No tool in ~30 years verified
  comprehension as a product feature — yet Wettel, Code Park and Merino all built exactly that
  instrument to publish a paper and then shipped the tool without it. Retrieval practice is the
  best-evidenced thing in the document (g = 0.51 vs restudy, and **multiple-choice practice 0.70 beat
  short-answer 0.48**, endorsing the select-a-subset format), and Karpicke & Blunt is pointed at a
  product whose one-liner is *learn it by mapping it*: **being tested on structure beat building a
  diagram of it, including on inference.** Transfer is **d = 0.40** — that is the number risk #1's
  playtest must be powered for, not the headline.
  **Three measurements this session changed decisions.** (1) **The coverage metric was wrong.**
  "91% of svelte can never appear on a board" weights every file equally against a power law where
  hotspots are 2–3% of code and 25–70% of defects. By *mass*: svelte's 6.9% of files carry **63.9% of
  transitive-dependent mass** and 90.2% of the top hubs; ark's 70.8% carry **98.9%**. Two real
  problems survive the reframing — **vite is genuinely uniform** (10.5% files, 11.1% mass, 3.9% LOC,
  2.4% of churn hotspots), and **churn hotspots are missed on all three** (0% / 64.6% / 2.4%), which
  is a measured argument that the git verbs cover *complementary* ground rather than more of the
  same. (2) Every node on all three repos has churn > 0, so the git verbs' ceiling is 100% and what
  limits them is **our own `maxCommitFiles` cap**, not the repos. (3) The phenomenon catalogue has
  supply: cycles 0/29/6, hubs 4/41/92, barrels 2/14/3, **co-change ghosts 62/717/98**, churn hotspots
  7/116/341, broken piers 0/305/125 — and ark having *zero* cycles is itself a teachable fact.
  **The Promptasy read produced the sentence this project needed: its atom is a *concept*, ours is a
  *node*.** A concept has a name, a definition, prerequisites, named misconceptions; it is collected,
  it gates, and it **transfers to another repo**. A node has a path and a degree and can only be
  asked about. That is why our answer keys keep colliding — Promptasy hit the identical wall at v1.0
  (*"`assignsTask` in 26 of 26 levels"*) and fixed it with a 130-skill authored catalogue, which
  pillar 2 forbids us copying. The available substitute is a **repo-independent catalogue of
  structural phenomena** — hub, cycle, barrel, layering violation, god-file, co-change ghost, frozen
  core, broken pier — ~30–60 entries, authored **once**, never per repo. It is vocabulary, not
  content, and it attacks risk #1 head on: a codex of phenomena transfers; *"`engine.ts` has 14
  dependents"* does not.
  **A correction I made mid-session and should keep in the record**: I claimed the world's skeleton
  was already in the atlas because Ark derives what Promptasy hand-places. True of the schema,
  misleading about legibility — Promptasy is walkable because its geography is a hand-drawn tree of
  **12** buckets with 7 bridges; we derive **82–123** regions from a real graph. I overstated it.
  **Next**, in the order the evidence supports and not the order that sounds most exciting.
  (a) **Rotate the 2D map between challenges** — map-derived spatial memory is *orientation-locked*
  (Presson & Hazelrigg; Shelton & McNamara; König), our map is north-up forever, and Blast Radius
  picks an arbitrary subject each time, so we want orientation-flexible knowledge. One session,
  testable, no 3D, and it is the highest-leverage lowest-cost item in the whole writeup. (b) **The
  negative witness** — a wrong pick already has a known reason class (sibling, name-alike, distance
  n±1, co-change ghost) and we never say it; Promptasy hand-wrote 713 of these and we get ours for
  free. (c) **The phenomenon catalogue**, which is the real fix for the repeated-question problem.
  Then **orbit**: derived Z over frozen X,Y, quantised (freedom in the third dimension is what
  Cockburn measured degrading), survey view one keystroke away, landmarks over terrain. The avatar
  stays behind P1′ and P4.

- **Rung 0 — `ark play <repo>`, and the player is deployable.** The gap was not playability, it was
  hand-off: trying Ark meant cloning it, knowing an internal CLI path and starting a dev server,
  which spends most of pillar 6's ten minutes before the map draws. Now one command indexes any repo
  and serves it: `npm run play -- /path/to/repo`. A **`.github/workflows/pages.yml`** publishes the
  player with Ark's own atlas — the bootstrap fixture, a public repo whose map we can vouch for —
  and **refuses to publish an atlas with zero challenges**, because a map with no game on it should
  fail the deploy rather than go up quietly. Nothing in the workflow can index anything else; a
  workflow that took a repo URL would be the first crack in pillar 5.
  **The server is 60 lines of `node:http`, not a dependency.** The player's runtime-dependency budget
  is three and it has spent none; serving four files is not where the first one goes. It binds
  loopback only. `vite.config.ts` gains `base: './'` so one build works both at the root (where
  `ark play` serves it) and under `/<repo>/` (where Pages does) — verified by actually serving the
  build under a subpath and fetching the html, the bundle and the atlas.
  **Three real defects, all found by tests that failed before they passed.** (1) `listen(port, host,
  cb)` registers `cb` as a **one-time 'listening' listener**, so a callback that never fired stays
  attached: after an `EADDRINUSE` the stale one fires when the retry succeeds and resolved the
  promise with the port we *failed* to get — `ark play` would print a url nothing was listening on.
  (2) We bound `127.0.0.1` and printed `localhost`, which resolves to `::1` first on a dual-stack
  machine; browsers fall back, `fetch` does not. (3) The first draft of the traversal tests asserted
  `toBeNull()` and **three of them failed** — not because the guard was weak but because `normalize`
  clamps `..` at an absolute path's root, so `/../../etc/passwd` lands harmlessly inside the served
  directory. They were asserting an implementation detail; they now assert the property (never
  resolves outside the root) plus the case the guard is genuinely load-bearing for, a **relative**
  request path, where `join` walks straight out.
  **And one piece of over-engineering deleted on measurement.** The port bug had two independent
  fixes — remove the stale listener, and read the port from `server.address()` — and with both in
  place **each mutation survived, because the other masked it**. Two defences, neither verifiable.
  The `address()` one is kept (it is the measured value rather than the assumed one, and it is what
  makes an OS-assigned port work at all); the listener removal is gone; both mutations are now
  caught. Also noted in the test: `fetch` hangs against a local server inside a vitest worker while
  working fine from a plain script, so the assertion uses `node:http` — the same module the server
  is written in.
  Verified: 362 unit + 82 atlas tests, byte-identical atlas, budgets inside ceiling, e2e clean.
  Measured on the way past — **`honojs/hono` is the best third-party repo to play**: 425 nodes at
  2.51 edges/node (Ark itself is 2.66), 18 unresolved imports of 1,067, and the only outside repo
  where the generator had *more* supply than the deck cap allowed (95 `capped`). **Promptasy is a
  poor subject and interestingly so** — it resolves perfectly, 0 unresolved, but **52 of its 70
  askable files produce a duplicate answer key** because its graph is a flat hub-and-spoke around
  `main.js`. Ark rewards layered codebases; a deliberately flat one has nothing to predict.
  **Next**: rung 1 — `layout` gains a derived, quantised Z (height = transitive dependent count),
  rendered first as contours in the existing 2D map.

- **Rung 1 — the map finally says which files are load-bearing.** `AtlasNode` gains `elevation`
  (**ATLAS_VERSION 3 → 4**), the bit length of a file's transitive dependent count: 0 dependents →
  0, 1 → 1, 2–3 → 2, one layer up is twice as depended-upon. **ADR-0013** fixes the semantics and
  freezes them, which is the point of writing it before any pixel: X,Y are frozen because a
  re-layout scrambles learned maps, and *vertical* memory has the identical argument that nobody had
  recorded. ADR-0009 lists "depth in dependency order, upstream is up" as a candidate Z — the
  near-opposite of this one, since an entry point has maximal depth and **zero** dependents — so a
  later rung switching quantity would invert every height the player had learned.
  **The map was measurably silent about this.** Restricted to nodes that actually have dependents,
  cone size correlates with what the map already draws at rho **−0.19 to 0.56 against `loc`** (the
  disc radius) and **−0.03 to 0.77 against direct in-degree** (the label priority) — ≈ 0 on this
  repo and on svelte. NORTH-STAR §4 says a session should end with the player able to name the
  most-depended-upon module, and nothing on screen helped. A trap for whoever re-measures, recorded
  in the code: over *all* nodes those correlations read 0.91–1.00 and elevation looks redundant —
  an artifact of 50–90% of nodes tying at zero dependents *and* zero importers.
  **The rendering is landmarks, not contours, and that was a review's correction.** Contours need a
  *field* and an atlas has *points*: interpolating height into the space between files asserts
  terrain where no file exists, which is inventing geography, which pillar 4 loses. A hypsometric
  tint has no free channel either — fill already carries region hue, fog state and dimming. So
  `fog.landmarks()` now **ranks by elevation instead of in-degree** and the picks are drawn as
  summits: concentric rings, one per layer, visible at every zoom and drawn even on silhouettes,
  which is risk #4's own mitigation read literally — you can always see *that* there is a mountain,
  and its name is still withheld until you survey it.
  **Ranking by elevation changes 8 of this repo's 13 landmarks**, and 23 of hono's 51. The reason is
  *chokepoints* — files few things import directly but nearly everything reaches through a barrel.
  `src/atlas/identity.ts` has **2 direct importers and 60 transitive dependents**; hono's
  `src/utils/mime.ts` has 5 and 245; vite's `shared/constants.ts` has 10 and 178. Under in-degree
  none of them was a landmark. They are exactly the files whose importance you cannot see by
  looking, which is the whole product. Counted per repo: 32 / 118 / 245 / 367 chokepoints.
  **A cap was added because a fraction does not scale**: at 12% svelte named **488** landmarks, and
  a skyline of 488 peaks is a plateau.
  **The schema bump is against a review's recommendation, and the reasoning is in ADR-0013 rather
  than hidden.** Fable argued for deriving elevation in the player — it is a pure function of
  `edges`, integer-exact on every engine so ADR-0006's float argument does not apply, ~7 ms — and
  quoted ADR-0009's own warning: *"do not bump early. Carrying a dead Z coordinate through several
  milestones with no renderer to use it is worse than the change itself."* Overridden for three
  reasons, the first of which is a bet: the renderer arrives in the same session rather than several
  milestones later; in the atlas it falls under `test:determinism` and in the player it would be
  covered by nothing; and the atlas is the contract. **If rung 2 does not land, this was wrong and
  the next session should revert it.**
  **ADR-0009 gains a dated owner's note**, because the rung ladder and the ADR disagreed and the ADR
  says a session may propose a gate is met but never decide it. It records what the owner authorised
  (rungs 0–2), what it costs (rung 2 lands ahead of P2's M4, so the first walkthrough is of a sparse
  world — a stated cost, not an oversight), what stays deferred (**P1′** — raster is still a headless
  floor, so no interaction claim may be made), and what stays shut: **P4 stands, the walkable avatar
  waits for Trace (M6)**, on evidence rather than caution.
  Liveness, per the landmine about measuring whether new machinery fires: the HUD reports
  `peaksDrawn` and the e2e **fails if it is zero** — a "how many X" number needs a gate proving X
  happened. Three mutations caught on `computeElevations`, one of them by non-termination (deleting
  the visited check hangs on a cycle, which is its own kind of caught). Two caught on the landmark
  ranking. Verified: 374 unit + 82 atlas tests, byte-identical atlas, budgets inside ceiling
  (1,064 B/file, 261 ms), e2e clean with 13 peaks drawn and `src/atlas/schema.ts` the tallest.
  **Next**: rung 2 — extruded scene, orbit camera. The measured 3D win is exocentric and this is it.

- **Rung 2 — the world stands up, and it turns.** `o` tips the map into an orbit view: every file is
  a column standing on its own 2D footing, its height ADR-0013's `elevation`, wires running roof to
  roof, and dragging turns the whole world. `o` again returns to the flat map. **Zero runtime
  dependencies still.**
  **The shape of this rung is the evidence, not a compromise.** `docs/prior-art.md` §2 found that the
  literature splits on *viewpoint*, not on dimension: every result where 3D beat 2D came from motion
  parallax over a structure the viewer stayed **outside** of — and the strongest is about this
  product's exact task, path tracing in a node-link graph (~55 comprehensible nodes in 2D against
  ~160 with parallax, replicated 2005, **preregistered** 2023 against a 2D baseline that had edge
  routing *and* interactive highlighting). Parallax beat stereo in the study that separated them,
  which is why this needs a mouse and not a headset. Every result where 3D *lost* put the viewer
  inside. So orbiting is not a stepping stone toward the real thing — on the evidence it **is** the
  intervention, and ADR-0009's P4 keeps the avatar behind the Trace verb.
  **Straight down is the flat map, to the pixel** — asserted, not promised. ADR-0009's invariant is
  that a third dimension preserves today's X,Y, and the strongest form of that is making the flat map
  a *position of this camera*: at `pitch = π/2` the projection reduces to `worldToScreen` exactly,
  and a unit test pins the equality. The overview is one keystroke away, which is D1.
  **Canvas, not WebGL, and that is a measured position rather than thrift.** Columns standing on a
  plane never interpenetrate, so painter's order is *exact* — a sort and some strokes, the work the
  flat map already does. WebGL earns its place when per-frame reprojection stops fitting in a frame;
  ADR-0009's P1′ says measure on real hardware before buying it, and that measurement still has not
  happened. Runtime trigonometry is fine here and would not be in the indexer: ADR-0006 forbids
  transcendentals in **layout** because the atlas must be byte-identical across machines, and nothing
  in this view reaches the atlas.
  **Liveness is a canvas hash, because this is exactly where `npm run raster` lied twice.** The e2e
  hashes the pixels, presses `o`, hashes again, drags in eight small steps and hashes a third time,
  and **fails if any pair is identical** — a map that did not tip, or a drag that turned nothing,
  both used to look like success. One console warning is now suppressed and the suppression says
  why: `getImageData` makes Chromium advise `willReadFrequently`, which is advice aimed at the test,
  and setting that flag on the real canvas would move it off the GPU and change the very rendering
  the gate exists to measure.
  **Two tests were wrong before they were right.** A mutation run found nothing checked that pitch
  *foreshortens* — the overhead test passes either way, because `sin(π/2)` is 1 — so a scene with no
  tilt at all would have shipped green. And the "camera centre stays fixed" test failed the moment
  headroom was added, correctly: it was pinning where the camera points as well as what turning does
  to it, when the real property is **independence from yaw**. Headroom itself is proportional to
  `cos(pitch)`, the same factor the lift uses, so it vanishes at overhead and the flat-map equality
  survives — mutating it to a constant breaks two tests.
  Verified: 384 unit + 82 atlas tests, byte-identical atlas, budgets inside ceiling, e2e clean with
  the orbit gate green. Known rough edges, stated rather than hidden: the scene is not re-fitted on
  entering orbit so a steep tilt can still crowd the top edge; only peaks are labelled in orbit (by
  design — `docs/prior-art.md` §4.3.5); and there is no frustum cull, which is the first thing to add
  when a raster run says so.
  **Next**: rung 3 is the walk and **it is gated** — ADR-0009's P4 holds it behind the Trace verb
  (M6), on evidence rather than caution. The honest next rungs are the ones that make a world worth
  moving through: **M4's git verbs** (measured to reach the churn hotspots the import graph misses
  entirely — 0% / 64.6% / 2.4% of the top 2%), the **phenomenon catalogue**, and **map rotation
  between challenges**, which `docs/prior-art.md` §4.4 calls the highest-leverage lowest-cost item in
  the whole writeup. Also unresolved and now more visible: `npm run raster` on real hardware.

- **Rungs 0–2 reviewed after shipping, and one of the findings was a defect that corrupted saved
  state.** A Fable review of the merged code, not the plan. Five things it found, ranked as it
  ranked them.
  **1. Every interaction in the orbit view targeted the wrong file — and persisted it.** Hover and
  click still ran the *flat* inverse (`screenToWorld` → `pick`) while the screen showed rotated,
  foreshortened, lifted positions. So the inspector described one file while the cursor sat on
  another, and clicking wrote **that wrong file** into the player's saved `surveyed` set: a stored
  falsehood, keyed to the repo, surviving reload, in the one structure whose entire claim is that it
  records only what you actually did. Nothing tested a click in orbit — the e2e drags past the
  threshold, so `endDrag` bailed before picking, and the pixel hash was happy. **`pickColumn` hit-
  tests the column *tops* in screen space** rather than inverting the projection, because the top
  disc is what a player can see and aim at and an inverse would have to choose a height to invert
  *at* — the ground gives one answer, the roof another. Nearest wins a tie, which is painter's order
  read backwards. Both pointer paths now go through one `pickAt`, so they cannot disagree about
  which projection is in force, and wheel-zoom anchors on the viewport centre in orbit rather than
  sliding the map out from under the cursor.
  **2. Binding loopback does not stop DNS rebinding.** `serve.ts` was open to it: a page you are
  browsing points `evil.example` at 127.0.0.1 and reads `atlas.json` same-origin, and the port is a
  sequential probe from 4180. The atlas of a private repo is paths, export names, commit subjects
  and co-change pairs — derived-from-source data, which is exactly what pillar 5 says never leaves
  the machine. This is the hole that bit Vite and webpack-dev-server. `isLocalHost` now checks the
  name the client used and returns **421** otherwise, with cases for the subdomain bypass
  (`127.0.0.1.evil.example`), the wildcard-DNS bypass (`a.127.0.0.1.nip.io`), the IPv4-mapped IPv6
  literal, and a right name on a wrong port.
  **3. Three assertions proved nothing, and one was mutation-verified as dead by the reviewer.**
  The `cos(pitch)` factor on the lift was untested: `OVERHEAD` sets `rise: 0`, so *"height
  contributes nothing from overhead, however tall"* was testing `0 × anything`, and deleting the
  factor passed all ten orbit tests. The state a player actually reaches — pitch dragged to the
  clamp with `rise` still 26 — was covered by nothing. The e2e's "tallest" check computed a filename
  and then asserted the canvas was visible. And `serve.test.ts`'s *"binds loopback only"* checked a
  URL string the code fabricates, so binding every interface passed it; it now reads
  `server.address().address`. All three now fail when the thing they name is broken.
  **4. `peaksDrawn` was counting in a view that draws no peaks.** The orbit incremented it per
  peak-set member while drawing nothing peak-specific — a "how many X" with no gate that X happened,
  which is the exact landmine the field was added to satisfy. It now reports summits actually
  *named*, which is the only thing that view can honestly claim.
  **5. The rendering contradicted the evidence it cites.** Wires were drawn under every column, so a
  wire between the two nearest ones vanished behind any far column overlapping it — an occlusion cue
  fighting the parallax cue, which is worse than no cue. The **traced radius now draws over
  everything**, unoccludable, because path tracing along edges is the measured win this whole view
  exists for. And the stalk — whose *length* is the only claim the view makes — had 0.55 alpha at
  half width under an opaque LOC-sized disc, so the salient channel described the wrong quantity and
  the scene read as "the flat map with faint sticks". Stalks are now opaque and full width.
  **Two documents were lying.** `docs/atlas-format.md` still said "Schema version: 3" in its
  headline, `"version": 3` in its example and *"`version` is `2`"* in §4, against `ATLAS_VERSION = 4`
  — and one of those was already stale before tonight. And **ADR-0009's status line still read
  "blocked, and not scheduled… cannot be earlier than after M5"** two hundred lines above a note
  opening rungs 0–2: the "two paragraphs disagree" failure the ADR names in its own rejected-
  alternatives section.
  **The S1 correction, which is the one worth reading.** My owner's note claimed *"the ship criterion
  is untouched"*. It was not. S1 says a written experiment design is committed **before any
  third-person code merges**, and the orbit view merged without one. That is now recorded as a
  **breach, not a waiver** — S1's own wording is that it is failed rather than waived — with the
  consequence stated: the orbit view **may not be described as having met S1 anywhere**, it is
  unmeasured, and the experiment design is a blocking precondition on the next rung of this
  direction. The review found this; the session that caused it did not.
  Also fixed: `o` was undiscoverable, so the HUD now prints `f fit · o orbit · enter ask`. Verified:
  394 unit + 82 atlas tests, byte-identical atlas, budgets inside ceiling, e2e clean. Every fix
  above was mutation-checked, and one new test was rewritten when a mutation survived it — the
  overlap case hedged with a conditional instead of *constructing* an overlap, so it asserted
  nothing; it now solves `Δy = Δelevation · rise / tan(pitch)` and checks the premise first.
  **Still open and now written down**: `ark play` resolves `dist/player` against the CWD, so it works
  only from an Ark checkout; a private repo's atlas is left at rest in `dist/player/` until the next
  build; `computeElevations` is O(N·E) and only ever measured on repos of this shape; and elevation
  leaks answer-key *size buckets* from first paint on low-elevation subjects, which ADR-0013 recorded
  generically but not in that sharp form.

- **The orbit costs 1.31× the flat map, measured.** `npm run raster` gains a fourth pass: the orbit
  view at the same district zoom the third pass just measured, on the same synthetic 2,000-node
  scene, back to back on the same machine. **The ratio is the part that survives a software
  rasteriser** — the absolute figures remain a floor and ADR-0009's P1′ still says they may not
  decide anything, but "orbit costs N× flat" is a property of the draw work rather than of the GPU.
  At 1.31× the orbit is not a performance cliff: whatever real hardware does for the flat map, it
  does within a third of that for the orbit, so **nothing planned needs a frustum cull or WebGL**,
  and P1′'s real-hardware measurement gates a renderer *change* rather than any next rung. The flat
  map itself measured 45/49/50 fps at p95, unchanged by rung 1's summit rings — a regression check
  worth having taken.

- **M4 — Companion, and the seam learns to hold two verbs.** `git` is the rubric now, not just the
  import graph. A file's question can be *"which of these files have changed alongside it in at
  least N separate commits?"*, graded against the co-change matrix, and the answer keys are worth
  what NORTH-STAR §2 said they would be: on `honojs/hono` the deck reaches **27 files with no import
  edge at all**, and the share of the map any question can ever un-fog goes from **156 nodes to 247**
  there, **283 → 776** on `sveltejs/svelte`, 78 → 86 here. `docs/prior-art.md` §4.2 measured that the
  import graph and the churn hotspots are nearly disjoint populations; this is that prediction
  cashed.
  **The verb was chosen for a structural reason as well as a measured one.** Placement's subject is a
  *commit*, and `Challenge.subject` is a `NodeId` — so it would have meant changing the atlas shape,
  the save key, the selector and the map's click path before a single question could be asked, which
  is exactly what CLAUDE.md says adding a verb must not require. Its ground truth is also already
  lossy in the atlas (`maxCommitFiles` truncates a retained commit's file list). Companion's subject
  is a file and its ground truth is complete.
  **The semantics are [ADR-0014](./docs/decisions/0014-companion-truth-is-a-gap-not-a-threshold.md)
  and the interesting half is what is *not* on the board.** The obvious construction — truth is
  partners at or above N, distractors are partners below N — reproduces the exact mistake ADR-0008
  removed: a candidate one under the bar is a trap for the player who *does* know the repo, marked
  wrong over an integer nobody could have known. So the band between "certified never" and "in the
  answer key" is not graded, it is **kept off the board**: every candidate is either in `truth` or
  provably co-changed at most once, and `evidence.minCount` is *measured* — the weakest coupling that
  actually made the key — exactly as `importGraph.depth` is. Keys rest on 2–3 shared commits here,
  2–7 on hono, 2–613 on svelte.
  **Absence from the matrix is not evidence of absence, and that is the whole guardrail-4 argument.**
  Three rules drop pairs — the noise floor, the wide-commit exclusion, the 8,000-pair cap — so a
  verb reading absence as zero would offer a genuine companion as a wrong answer. The bound is
  derived rather than chosen: the matrix is sorted count-descending, so everything the cap threw away
  is at or below the last kept pair's count, and a companion must clear that to be sampled.
  **The raised branch of that bound fires on none of the three repos** and the ADR says so rather
  than letting a later session read it as live code — it is a correctness bound, not a retry that
  never retries, and deleting it would make the verb wrong on the first repo big enough to trip the
  cap.
  **A pre-writing review found the defect that would have been the worst thing here, and it was in
  code I had not written yet.** `deriveFog` promotes every pass's subject into a **verb-blind**
  `understood` set, and the map reads that set to decide whether to draw a node's full transitive
  dependent radius on hover. With one verb that is ADR-0008 decision 1 working correctly. With two, a
  Companion pass on X **prints the answer to the still-open Blast Radius question about X** — the M1
  hover leak, re-entered from a direction no test looks at. `provedThrough(progress, liveness, verb)`
  is the narrower set the radius rule now reads; `understood` stays verb-blind on purpose, because
  proving *anything* about a file is a real reason to know its name. It is the radius, not the label,
  that has to be earned in the verb that asks about it.
  **A second instance of the same leak was found in an e2e screenshot and by nothing else.** The
  inspector's `blast radius: N files` field was gated on the same verb-blind flag, so a Companion
  pass printed the count as well as unlocking the drawing. Two panels, one rule, one of them fixed;
  looking at `artifacts/` is what caught the other. The same screenshot showed the inspector button
  reading **"Map its blast radius"** above a Companion question — the console's verb-blindness held
  and the inspector's did not, so `Prompt` gained an `action` field and each verb writes its own
  label. Templating the verb's title into the old sentence was the first fix and it produced *"Map
  its companion"*.
  **Guardrail 4 grew a git-side clause, because "deterministic" stopped being enough.**
  `applyRenames` resolves a contested historical path arbitrarily — two live files both claiming the
  same old path — and its comment said *"arbitrary but deterministic, which is the property that
  matters"*. True while co-change only ranked Blast Radius's distractors; false the moment those
  counts enter an answer key. `AtlasNode.lineage` records it and Companion refuses such a node as
  subject, as answer **and as distractor**, since certifying an exclusion on history we know is
  misattributed is the same defect. Measured before building it: **0 on this repo, 0 on svelte across
  18,240 renames, 7 nodes on hono** — a pair renamed to each other's paths and back, so each live
  file claims the other's history.
  **Four things moved up out of `blastRadius/` and the seam is where the work actually was.**
  `difficulty.ts` (§8.4 is one formula for every verb — the fields are now `breadth`/`reach`/
  `surprise` because `fanOut`/`depth` described one *reading* of it), `gate.ts` (with a per-verb
  heuristic set), `paths.ts`, and `reveal` + the summary sentence + the grade's phrasing onto the
  `Verb` contract. The console had been importing `revealOf` straight out of `blastRadius/`, so a
  second verb's grade would have been explained in the first verb's terms — "reached the subject by a
  path you did not select" is a claim about imports and Companion would be lying if it said it.
  Blast Radius's numbers are byte-identical across the move, which `hopReach` exists to guarantee.
  **`(verb, subject)` is now the key everywhere it was `subject`**: `answeredKeys`, the selector's
  `answered` and its `attempts`, and `Liveness.holds`. Each was a real defect, not tidying — held as
  subjects, a full playthrough of this repo served **60 of 71 questions** and called the deck
  finished, and an all-failing player stopped cycling evenly. Liveness is the sharpest: checked
  against the import graph, a Companion claim would be dropped for 67% of hono's answer-key members
  and 89% of svelte's, because those pairs never import anything. Each verb now says what its own
  claim means (`Verb.stillHolds`). `save.ts`'s second hand-kept `VERBS` list is gone — it is the
  dangerous place to keep one, because a pass naming a verb missing from it is dropped at parse and
  erased by the next write.
  **The naive guess is churn, and it was already free.** §8.4's `surprise` needs a baseline the map
  actually hands over. For Blast Radius that is depth-1 importers, drawn on the canvas by design; for
  Companion it is the **commit count the inspector already prints for every node**, which leaks no
  pair. So map giveaway, `surprise` baseline and the new `churn` gate heuristic are the same
  strategy, and closing that loop needed no map work at all. The gate refuses **8 subjects here, 48
  on hono, 14 on svelte** — machinery that fires, counted before tests were written around it.
  **I repeated a mistake this repo had already written down.** Companion's distractors scanned the
  whole pool and called `nameTokens` — a regex and two splits — on every node for every subject.
  `blastRadius/distractors.ts` documents that exact failure in its header ("cost 8 s of a 10 s index
  budget"); mine cost **29.7 s on svelte against Blast Radius's 0.6**, and pushed a full index from
  22.5 s to 47.8 s. An `analyse()` corpus and two inverted indexes bring it to **1.37 s** with
  byte-identical output on hono, and svelte back to 22.8 s. The lesson is written into the new file's
  header rather than left as a paragraph in the other verb's.
  Verified: **414 unit + 86 atlas tests**, byte-identical atlas, budgets inside ceiling (1,346 B/file
  against 2,621 — the second deck costs 26% more per file and sits at half the ceiling), e2e clean
  and now playing a Companion question end to end. **10 targeted mutations, 10 of 10 caught** — and
  two fixtures had to be rebuilt to get there: the pool ban survived mutation at churn 3 and again at
  churn 99, because the sampled-away companions were never attractive enough to be *picked* as
  distractors, so the assertion could not tell a correct exclusion from a ranking that happened never
  to reach them.
  **A post-ship review of the finished code found a third instance of the leak class, running in the
  direction nobody was watching.** Blast Radius's own reveal said *"changed with the subject in N
  commits, but never imports it"* about a distractor `coChangeStrategy` had picked from the matrix
  **ranked count-descending** — the strongest member of Companion's answer key for that subject,
  handed over with its count, while that question was still open (Blast Radius is served first,
  because `blast-` sorts before `companion-`). Free when it was the only verb; not free now. The
  sentence is gone and the lesson is not lost — Companion asks about that coupling directly. The same
  review found `onGraded` drawing the full import cone after *any* grade instead of through
  `depthFor`. **Both were true statements rendered to a player who had not earned them, which is why
  neither the type system nor 414 tests could see either.**
  **It also found a fourth loss channel the guardrail-4 argument had not modelled.** `maxCommitsWalked`
  stops the walk at 20,000 commits, and the ceiling argument reasons only about pairs the *matrix*
  dropped — so a pair coupled solely in older history is absent for a reason no bound covers, and
  would ship as a certified exclusion. There is nothing to derive, so the verb now refuses the whole
  repo and says so. It fires on none of ark, hono or svelte; it would fire on TypeScript. Two smaller
  corrections from the same pass: `evidence.atMost` now carries what an excluded candidate is
  actually certified at, because the instruction said *"at most once"* unconditionally and that is
  **false whenever the pair cap bit** — a bound that raises correctly while its sentence does not is
  half a fix; and the comment beside `ASSUMED_MIN_CO_CHANGE` had the safe direction **backwards**,
  claiming a raised indexer floor "costs questions rather than correctness" when it is exactly the
  direction that reopens the banned middle band. A test now pins the two constants equal, and another
  pins the truncation tag the two sides string-match on — rename it either side and every suite stayed
  green while the bound silently dropped to 2.
  Six more mutations on the new code, six caught, for **16 of 16** across the session.
  **And then the fix for the leak turned out to have its own defect, in the opposite direction.**
  Routing `onGraded` through `depthFor` closed the Companion case — and broke Blast Radius, because
  `depthFor` reads a set only a *passed* challenge writes to. So a Blast Radius answer that came
  apart stopped drawing the radius on the map while the panel went on saying *"now drawn on the
  map"*: a false sentence and a guardrail-6 breach (a wrong answer takes nothing away), from one line
  meant to close a leak. The rule is now on the `Verb` contract as `Reveal.unlocks`, so the verb says
  what its reveal put on the map and the score does not enter into it. **Four instances of one class
  now**, and the through-line is the same every time: a judgement about one verb's answer being made
  somewhere that is not that verb. Two more mutations, two caught — 18 of 18.
  Known and stated rather than hidden: **a Companion pass changes nothing on the map** beyond lifting
  fog on what it proved — there is no co-change link drawn, so the verb's fog payoff is thinner than
  Blast Radius's; the choice sets on *this* repo are heavily `.md`, which is true of a 36-commit
  documentation-dense repo and reads as a doc quiz; and the `wide` limit is absolute (25 files) where
  the thing it approximates is relative, so it admits a commit touching a quarter of this repo and
  excludes an ordinary feature landing on svelte.
  **Next**: the honest next step is **drawing the co-change relation on the map** — the verb asks
  about a coupling the player is never shown, so the reveal is doing all the teaching and §4's "fog
  lifts around what you proved" is only half kept. After that, in evidence order: **map rotation
  between challenges** (`docs/prior-art.md` §4.4 still calls it the highest-leverage lowest-cost item
  in the whole writeup, and it is still not done), the **negative witness** (a wrong pick already has
  a known reason class and we never say it), and the **phenomenon catalogue** for risk #1. Still open
  and only the owner can close them: `npm run raster` on real hardware (ADR-0009's P1′) and S1's
  recall-experiment design, which ADR-0009 records as a breach and which gates the next rung of the
  third-person direction.

- **Deleted `pages.yml`, so a red check means something again.** Not a feature — a correction. The
  Pages workflow had failed on **every run it ever had**: run #1 on `626513c` (master before M4) and
  run #2 on `a50462b` (master after it), both at `actions/configure-pages@v5` with
  *"Get Pages site failed ... Error: Not Found"*. The build half was fine — the step before the
  failure printed `publishing ark @ a50462bcbc4a / 113 nodes, 328 edges, 80 challenges` — and the
  deploy was impossible: **the repo is private**, Pages there needs a paid plan, and the workflow
  passed `enablement: false` so it would not enable Pages even where it could. The premise had been
  wrong since the workflow was written, *and was written down in it*: its header said "it is a public
  repo, so its atlas may be shared (§7)". A comment that states a fact is not evidence of it.
  **The cost was never the missing demo.** A demo nobody can reach costs nothing; a check that has
  never once been green teaches every future session that a red X here is background noise — and it
  already did. Last session reported "CI green" three separate times while only ever opening `ci.yml`
  runs on its own branch, and the human found it. That is the mirror of the `npm run raster` landmine:
  an instrument that always reads good gets believed, and one that always reads bad stops being read.
  Guardrail 7 says never leave the build broken, and a permanently failing workflow is a broken build
  everyone has agreed to ignore. Both the mechanism and "list the workflows before you claim they
  passed" are now landmines in CLAUDE.md.
  **Its zero-challenge guard was not migrated, because it is already held twice and more strongly** —
  `tests/atlas/atlas.test.ts` asserts `> 20` challenges on a freshly built atlas, and `scripts/e2e.ts`
  carries the identical `=== 0` refusal *and then* builds the real bundle, serves it, answers a
  question and reads back a grade. **Checked by mutation rather than by reading**: forcing the deck to
  `[]` turned 11 tests red across two files, including the one carrying the count. Deleted rather than
  disabled (`if: false` rots silently against `actions/*` bumps and the build commands it duplicates)
  and rather than made non-fatal (`continue-on-error` would turn an honestly red check into a green
  one deploying nothing — the exact landmine, on purpose). **[ADR-0015](./docs/decisions/0015-pages-is-not-deployed-while-the-repo-is-private.md)**
  records the reversal trigger — the repo going public — and the one-line restore from git, so the
  next session finds a decision instead of an oversight to helpfully undo.
  **Next** is unchanged and is the real work: **draw the co-change relation on the map.** Companion
  asks about a coupling the player is never shown, so its reveal does all the teaching and §4's "fog
  lifts around what you proved" is only half kept. Then, in evidence order: **map rotation between
  challenges** (`docs/prior-art.md` §4.4, still the highest-leverage lowest-cost item in the writeup),
  the **negative witness**, and the **phenomenon catalogue** for risk #1. Still owner-only:
  `npm run raster` on real hardware (ADR-0009's P1′) and S1's recall-experiment design.

- **The map has a history channel: co-change draws as wires, and the gate is pillar 3.** Companion
  shipped asking about a coupling the player was never shown — every edge on the map was an import —
  so its reveal did all the teaching and §4's "fog lifts around what you proved" was half kept for the
  one verb whose whole argument is reaching what the import graph structurally cannot see. Named pairs
  now draw as shallow ember arcs (`src/player/ties.ts`), no schema change, `history.coChange` was
  already there. **[ADR-0016](./docs/decisions/0016-a-history-wire-is-drawn-only-where-no-board-is-open.md)**
  is the disclosure rule and almost none of it survived first contact with a measurement.
  **There is no free tier and the reason is structural.** ADR-0008 could give away depth 1 because
  Blast Radius's question lives *above* it; Companion's key is sampled count-descending, so any count
  tier is the *top* of the answer, pre-sorted. Measured `|truth| / |row|` over the shipped deck:
  **median 1.00** — for the median subject the key *is* the whole row. A visible threshold would also
  repaint the middle band ADR-0014 exists to ban.
  **Three gates simulated over the real deck**, counting drawn pairs that belong to a still-open
  answer key. `provedThrough` — the helper `tracedRadius` already uses, and the obvious reuse —
  exposes **89 open-key members in one frame across 28 of 40 subjects**, because it includes members
  proved in someone *else's* question and co-change has none of the containment that bounds an import
  cone. That would have been the fifth instance of ADR-0014's bug class, this time inside the correct
  verb. Named-pairs-with-both-boards-closed exposes **0, ever**.
  **The rule is pillar 3, not disclosure.** Every drawn pair was already named in a reveal, in words.
  But text in a closed panel is a memory test and ink on the map is a lookup, concurrent with the
  board §9 keeps visible behind the scrim — measured, an ungated layer assembles **5 of a 6-member
  key** beside an open question. The principle that also explains why Blast Radius never has this
  problem while drawing every import edge always: **the map may aggregate what it already draws; only
  a reveal may introduce a primitive.** A cone is aggregation and the aggregating is the tested skill;
  reading a wire is not a skill.
  **The thing I got wrong, kept because it is the useful part.** I built the recommended shape — an
  ungated flash at the grade over a gated layer — and it passed everything. Then measured what
  survives one click: **79% of the promised wires vanish** (6 promised / 1 kept on the board the e2e
  plays, nothing at all on 4 of 40), so the reveal's *"now drawn on the map"* was false immediately —
  verbatim the defect `onGraded` records shipping once already, from the other direction. One gate
  now, and the summary claims the record rather than the rendering: *"become history wires, drawn once
  both files' questions are answered."* New landmine in CLAUDE.md: a suite checks a state, and this
  defect lived in the transition between two.
  **Verified**: 435 unit (13 new in `tests/unit/ties.test.ts`), 86 atlas, determinism byte-identical,
  e2e clean with screenshots. **10 mutations, 10 caught — after one survived.** The dedup assertion
  was vacuous: an unnormalised pair key *drops* the second direction rather than duplicating it, so
  the count still read 1 and "expect 1 wire" passed against broken code. Rewritten to assert each
  direction alone produces a wire. Liveness is measured, not assumed: `tiesDrawn` is in the HUD for
  the same reason `peaksDrawn` is, and e2e fails if a Companion pass draws none — 3 wires on the real
  repo, 0 in the orbit, which is deliberate and commented rather than omitted.
  **Two things this leaves open, both named in the ADR so neither reads as solved.** Two Companion
  subjects can each carry the other in their key, so answering one discloses a member of the other's —
  up to **6 of 6**, in text, in the reveal. That is generator-side: ADR-0012 issues each key once and
  says nothing about keys that *overlap*, and the fix is to window mutual members the way 0012
  re-asks colliding subjects. And **`tracedRadius`'s member half is an open defect**, reclassified
  from "settled fine" during this work: `provedThrough` includes members, so a file proved inside S's
  question gets `FULL_RADIUS` while its *own* board is open, and by ADR-0008's invariant the lit set
  ∩ that board is the key byte-exact. Hovering S does not substitute — `cone(S)` overapproximates and
  never isolates it. **20 of 40 Blast Radius subjects, up to 12 at once.**
  **A second-opinion review after shipping found four defects, none of them in the logic.** The gate
  itself survived — no sequence draws a wire beside an open board. What it caught: two comments still
  describing the *deleted* two-gate design as current, which together were a rebuild kit for the 79%
  defect; `Reveal.unlocks: 'coChangeTies'` **read by nothing**, with the real licence hard-coded as
  `challenge.verb !== 'companion'` in two files — M4's "nothing outside a verb names a verb" seam
  quietly undone, so the licence is now `Verb.channel` and `channelOf()`; a **loop whose assertion ran
  zero times** in the very test the file calls its most important (a ternary repeating its own
  condition, so the leak check rested entirely on a length assertion); and an endpoint cull that drops
  a long wire exactly when you stand between its ends. Also measured on request: a wire beside an open
  *Blast Radius* board predicts blast-membership at **41% against a 27% base rate** — a §8.3 class-4
  distractor, not an answer, so the gate stays Companion-only. That the findings are all in comments,
  a dead contract value, an unrun loop and an unsimulated future is the point: the load-bearing
  decisions were measured before they were argued, and measurement does not reach those places.
  **A third review, of the merged diff, found the fix commit had reproduced its own first finding.**
  The corrected orbit bullet was *appended* to ADR-0016's Consequences without deleting the one it
  replaced, so the document of record carried two adjacent bullets contradicting each other about the
  same thing — a superseded description left standing as current, committed by the commit that fixed
  exactly that. It also spot-checked the ADR's figures against the data: the structural ones reproduce
  **to the digit**, and two did not — "all 174 pairs" (the matrix was 173, then 180, then 200) and
  "24 of 27 qualify" (22 of 24). The same rot was already sitting in CLAUDE.md's Current state ("49
  KiB of JS", "31 companion challenges"). The fix is not more care: **prefer the invariant to the
  count** — "every pair the matrix records is sampleable" holds forever where "all 174" holds for one
  commit — and name the commit where a number really is the point. New landmine. Also from that
  review: the generic `unlocks`-vs-`channel` pin (two literals asserted separately drift the moment a
  third verb exists), and `channelOf`'s docstring softened, because it claimed *no* code outside a
  verb names a verb while the import cone's restored-save licence is still
  `provedThrough(…, 'blastRadius')` — an overclaim in the exact comment written to fix an overclaim.
  **Next**: **map rotation between challenges.** `docs/prior-art.md` §4.4 has called it the
  highest-leverage lowest-cost item in the writeup for three sessions and it is still undone —
  map-derived spatial memory is orientation-locked, ours is north-up forever, and the verbs pick an
  arbitrary subject each time, so we are training precisely the alignment-specific knowledge the
  evidence says will not transfer. Then the **negative witness** (a wrong pick has a known reason
  class and we never say it) and the **phenomenon catalogue** for risk #1. Owner-only and still open:
  `npm run raster` on real hardware (ADR-0009's P1′) and S1's recall-experiment design.

- **The map turns between challenges.** `docs/prior-art.md` §4.4 has called this the
  highest-leverage lowest-cost item in the whole writeup for three sessions, and the reason it kept
  being next is that it is embarrassing: **map-derived spatial memory is orientation-specific** —
  after learning from a map, judgments are easy when aligned and measurably harder when misaligned
  (Presson & Hazelrigg; Shelton & McNamara; König et al.) — and Ark teaches from a map that was
  north-up forever while both verbs pick an arbitrary subject. Every question this product has ever
  asked was answered from the one orientation the evidence says does not transfer, which is risk #1
  wearing the mechanic's own clothes. Grading a challenge now turns the map by the golden angle,
  animated over 620 ms as the console closes, pivoting on the file just graded so its disc holds
  still and the world swings around it.
  **[ADR-0017](./docs/decisions/0017-the-map-turns-between-challenges.md)**. No schema change, the
  indexer untouched, `test:determinism` byte-identical.
  **The schedule was decided by measurement and both candidates I brought to it were wrong.** A
  heading hashed off `challenge.id` — the first design — fails to turn at all on **12 to 14 of 80**
  consecutive grades (the deck is regenerated at every commit, so it is a range and not a constant;
  the invariant is that uniform hashing collides once in K, forever): console closes, animation runs,
  map does not move, which is the machinery-that-never-fires landmine wearing the feature's clothes. A pre-implementation review
  killed that correctly and proposed a coprime step of 135°, which fixes the zero-turns and fails
  the other way: three eighths of a turn is a **closed cycle**, so it visits eight headings and puts
  **10 of 80 questions back at exactly north-up**. 90° puts back 20. The golden angle is irrational
  in units of a turn and closes nothing: 80 distinct headings, no turn under 137.5°, none at north.
  The review's own citation is the second argument — Shelton & McNamara found multi-view learning
  sometimes stores *two* orientations rather than orientation-free knowledge, and eight headings are
  eight things a player can store where eighty are not.
  **One heading, on the camera, and `Orbit` gave up its `yaw` to get it.** Two headings for one
  world would mean `o` snapping the view back to whatever the orbit remembered — a rule living
  twice, which is the shape of most of what this repo has had to fix. The pin was already written:
  `orbit.test.ts`'s "straight down reproduces the flat map to the pixel" now runs at four headings
  instead of at north alone. The renderers stay two functions; what is shared is a value. ADR-0009's
  S1 is not tripped — `orbit.ts` *loses* state and ships no third-person capability — and the
  player-visible consequence is stated rather than discovered: turning in the orbit now leaves the
  flat map at that heading.
  **Rotation is applied to coordinates, never to the canvas**, so labels are drawn upright at turned
  positions and there is no counter-rotation anywhere to forget — `docs/prior-art.md` §4.3's
  constraint 8 (text readability, one of Merino's four named defects) satisfied structurally, in a
  product whose nouns are file paths.
  **Every consistency test I first proposed passes with the bearing ignored everywhere** — the
  round-trip inverse, the flat≡overhead identity, the zoom anchor, all of them hold when both
  directions ignore the heading. That was the review's sharpest finding and it named the decoy
  exactly: the compass is CSS-rotated independently and would keep spinning over a dead map. So the
  suite gained a liveness test, a rigidity test, a **semantic anchor** stating the sign convention in
  a form a human can check against a screenshot (at a quarter turn, north points right and east
  points down), and a check that the needle lands where the projection actually puts north. 16
  mutations, 16 caught — one only after an assertion was added, because linear interpolation instead
  of the easing passed everything and would have left `easeTurn` a tested function the product never
  called. The single load-bearing assertion is in `test:e2e`: hash the canvas, press `n`, hash again,
  require them to differ. Severing the turn fails it, checked before it was allowed to pass.
  **The cull changed algorithm and that was measured too.** A world-space bounding box is the wrong
  shape once the map can turn — measured on a 2,000-node cloud at street zoom, it admits **2.17× the
  nodes actually on screen at 45°**, and every heading between the axes is oblique, so that would
  have been the normal case on a renderer already under its frame budget. `visibleNodes` now culls in
  screen space through the same projection that draws; `visibleBounds` and `contains` are deleted,
  the cull was their only caller.
  **Getting out is free** (guardrail 6): a compass in the HUD, `n` to face north the short way,
  shift-drag to turn by hand, `f` fits at the current heading rather than straightening the map, and
  `prefers-reduced-motion` arrives without the motion instead of losing the feature. The heading is
  **never persisted** — ADR-0011 decision 2 forbids a cursor, and restoring one would re-anchor the
  player to a single alignment, which is the thing this change exists to break. There is no counter
  either: the turn advances from wherever the camera is, so nothing cursor-shaped exists to store.
  **What this is not: a validated fix.** The studies demonstrate the deficit, not this cure, and
  §2's closing point — nobody in this literature has measured retained structural knowledge after
  the tool was taken away — applies to us. It is the evidence-directed bet §4.4 calls it.
  **CI went red on a commit that changed only prose, and the reason is worth the landmine.** The
  e2e checked the *first* field note against the *first* challenge it played; notes are sorted by
  descending radius, which has nothing to do with the order you proved them in. It had passed for
  four milestones because the two coincided. Then a documentation-only commit changed the deck — ark
  indexes itself — the grid scan landed on a different first subject, and the assertion compared one
  pass's note against another pass's answer key. The fix selects the note by the subject it *names*
  and asserts the property over every row instead of the top one, which is strictly stronger;
  mutation-checked by overstating a note's count. **`.first()` in a UI assertion is an ordering
  assumption, and on a repo that indexes itself it is a time bomb.**
  **A post-ship review found four defects and two false sentences, and one of them was the exact
  decoy this feature's testing story is built on.** `northDegrees` — the function whose docstring
  says "the compass reads this, and so does a test", written so the needle's sign could not become a
  second implementation — had **zero production callers**: `ui.ts` had the same expression written
  out inline, so a sign flip in the copy the player sees passed the unit test (which checks the
  function), passed the e2e (222° is not north either), and left the dial pointing the wrong way over
  a correctly turned map. Fixed by importing it, and the e2e now pins the *value* against
  `GOLDEN_TURN` rather than asserting "not north". Also found: grading from the orbit pivoted on the
  flat projection, so the turn anchored a point where nothing is drawn — the file's oldest scar in a
  new function; and a pivoted turn rewrites `camera.x/y` every frame, so pressing **"Where next?"
  within 620 ms of closing a console silently did nothing** while the survey record updated — every
  non-drag camera command now lands the turn first. `prefers-reduced-motion` was a second branch that
  skipped `bearingDuring` entirely, leaving its `duration <= 0` case dead in the product with a test
  exercising it under that name; it is now a turn of zero length through the same code. The ADR's own
  table said 90° visits 5 headings when it visits 4 — counting 360° and 0° as different — and its
  north column omitted the one question every session answers north-up on arrival, which is 1 for
  golden rather than 0.
  **Three ADR decisions had no test at all**, and the mutations proved it: "on close, not on grade",
  "only a grade turns", and whether the pivot ever fires. The first two are now e2e gates — and the
  first version of the scrim gate **survived its own mutation**, because it hashed the canvas 200 ms
  after the grade, by which time a grade-time turn had already finished; comparing the heading across
  the whole open-panel window instead is timing-independent and fails. The pivot is *counted* rather
  than asserted, per the landmine: over a real playthrough it anchors on **both** graded turns, with
  the centre path used once, by `n`, by design. The cull tests all ran at scale 1, where the old
  `radius / scale` and the new `radius * scale` agree — reverting the formula survived the whole
  suite until an assertion at scale 4 was added.
  **An adversarial review of the finished code then found four more**, and the shape of them is the
  usual one — none was findable by the type system or by any suite. The reveal and the field note
  described **different populations** (eligible touchers against retained ones), so they disagreed on
  21 of 26 boards and the reveal printed *"that is every commit in this window that touched X"* over
  a record that held more — **false, and falsifiable with one `git log`**, on 4 boards here and 4 on
  hono; each surface was internally consistent, which is why nothing could see it. **`tooFewCommits`
  was a second unreachable refusal** in the same six-row ADR table that already lost `uncertain`.
  **A relation over a set of one is an identity**: *"it changed a file that usually moves with this
  one"* names the file when the subject has exactly one partner — 4 such notes on hono, 2 of them
  naming a shipped Placement answer-key member. And **the re-measured figures themselves** were taken
  on the working tree rather than on the commit they named, which the hono column reproducing exactly
  is what isolated.

  The tests written for those fixes are worth recording too: **the first round of mutants all
  survived**, because the fixture had no wide commit, no co-change matrix, and graded with an empty
  answer so the wrong-pick explainer never ran. Three assertions that passed without executing the
  code they were about, in the session that had already written a landmine about exactly that.

  **Next**: the **negative witness** — a wrong pick already has a known reason class (sibling,
  name-alike, distance n±1, co-change ghost) and the reveal never says which, so the one moment the
  player is most ready to learn passes in silence. Then the **phenomenon catalogue**, a
  repo-independent vocabulary of ~30–60 structural phenomena, which is the atom that would let
  anything *transfer* to a second repo and is the other half of risk #1. Still open and smaller:
  ADR-0016's two recorded items (the `tracedRadius` member leak — 20 of 40 Blast Radius subjects
  draw their full cone while their own board is open — and overlapping Companion answer keys in the
  generator); the twins a duplicate answer key drops are never mentioned to the player; node labels
  near the top edge draw under the HUD; the orbit does not re-fit on entry and has no frustum cull —
  and now that the flat map has a screen-space one, it is the obvious next borrower. Owner-only:
  `npm run raster` on real hardware (ADR-0009's P1′, and it should now measure a turned map, not
  north-up), and S1's recall-experiment design.

- **The `tracedRadius` member leak is closed, and it was never an open question.** ADR-0016 had
  recorded it as an open defect with two candidate fixes — gate on whether the member's board is
  open, or accept and document it — and **ADR-0008 decision 1 forbids the first and rules out the
  second**, in as many words: *"the rule must not depend on whether a challenge is open"*, and the
  cone is *"permanently unlocked by passing that node's challenge"*. The member half was a
  **divergence from the decision of record**, not a design choice anybody made, which is why the fix
  needed no new decision. `provedThrough` becomes `subjectsPassed` and returns subjects only: a file
  unlocks its own cone by passing its own question and by nothing else.
  **Measured before, because the deck is regenerated at every commit and ADR-0016's figures had
  drifted**: at `e6f7e2f`, **26 of 40 blast boards were exposable and all 26 recovered their answer
  key byte-exact** — 9 of them in the deck's actual serving order, 6 at once at the worst frame,
  against the ADR's recorded 20 and 12. Afterwards the number is not smaller but **structurally
  zero**: a node is in the set only if its own board is passed, so its board is never open. The
  mechanism is worth keeping: proving that D depends on S drew D's *own* cone, and by ADR-0008's
  invariant `candidates ∩ dependents(D, ∞) = truth`, so the drawn set intersected with D's board is
  that board's key exactly. Hovering S never substituted — `cone(S)` overapproximates and can contain
  D's certified distractors, so it points at the answer where `cone(D)` *is* the answer.
  **The cost is stated rather than absorbed.** After a perfect clear, 41 files lose an unlock they
  had only through membership; **8 of them have any dependents at all** to draw, and none of the 41
  carries a Blast Radius question of its own — so those 8 join the population
  `report.unprovableNodes` already counts. A cone nobody can earn is the honest state under ADR-0008.
  New landmine: **when an ADR states a rule in words, grep for the code that implements it.** This
  survived two reviews as "settled fine" because a divergence reads exactly like a design choice once
  it has been in the tree for a milestone.
  **Next**: unchanged — the **negative witness** (a wrong pick has a known reason class and the
  reveal never says which), then the **phenomenon catalogue** for risk #1. The other half of
  ADR-0016's open pair — overlapping Companion answer keys, a *generator* defect that ADR-0012's
  once-per-key rule does not cover — is still open and is the natural companion to it.

- **M4's second verb — Placement, and a subject that is not a place.** *"On 2026-08-07 a commit
  landed: 'Rung 2: the world stands up, and it turns'. Which of these files did it change?"* —
  graded against `history.commits[].files`, the third verb and the second read off git. 36 questions
  here from 41 eligible commits, 54 on `honojs/hono` (capped from 232 distinct boards). The three
  verbs together leave **16 of this repo's 127 nodes** unprovable where Blast Radius alone leaves 39;
  on hono 142 against 269.

  Semantics are **[ADR-0018](./docs/decisions/0018-a-subject-is-a-place-or-an-event.md)**, and the
  invariant is ADR-0008's for the third time: `candidates ∩ files(commit) = truth`. Every candidate
  is either in the answer key or a file the commit **provably did not touch**; a twelve-file commit
  ships a six-file key and the other six appear nowhere on the board, so there is no boundary for
  the player to guess at. What is *different* is the direction of the certification, and it is the
  easy direction: both earlier verbs certify a wrong answer by **absence** — from a cone, from a
  matrix — and absence is only as good as the walk behind it, which is why ADR-0014 refuses an entire
  repo whose commit walk stopped short. A commit's file list is a positive record, complete for
  every commit the atlas kept, so **Placement needs neither that refusal nor the shallow-clone one**;
  what it does refuse is a `wide` commit (4 here), one whose list `maxCommitFiles` may have cut
  (0 here — and the limit is *recovered* from the truncation entry's `kept` rather than assumed),
  and any commit touching a node with contested lineage (0 here, 24 on hono).

  **`ATLAS_VERSION` 5 → 6**, `docs/atlas-format.md` in the same commit. `Challenge.subject` widens
  from `NodeId` to `SubjectId`, discriminated by the id's own prefix — `n:` a node, `c:` a retained
  commit — with no `subjectKind` field and without asking the verb, because *"can this subject be
  drawn?"* is a question about the id and every leak this repo has found came from verb-blind state
  being interpreted by verb-specific code. There is no migration and reindexing is the whole of it;
  a save survives untouched.

  **The seam held where M4 built it, and failed in the one place M4 never looked.** The console, the
  map, the grader, the deck and the selector needed no edit to know about a third verb: `VERBS`
  gained one line, and nothing outside `src/verbs/placement/` names it. But **nine** places assumed a
  subject is a node, each a live defect rather than a type error — `NodeId` is `string`, so the
  compiler saw nothing. Three of them were the **field notes**, which chose their ruler *and* their
  sentence with `verb === 'companion' ? … : …` and Blast Radius as the *else*, and resolved the
  subject through `refById` — so a Placement note would have been dropped in silence, and had it
  survived it would have read *"all of them direct importers"* about a sha. `subjectLabel`,
  `noteWeights` and `noteProse` are on the `Verb` contract now. The worst of the other six was
  `save.ts`: `asPass` required `isNodeId(subject)`, and a pass it rejects is dropped at parse and
  erased by the next write — **the identical failure that file's own comment describes for
  `VERB_IDS`, one field down**, which would have destroyed every Placement pass on the second
  session with nothing anywhere to say so. The HUD and the guide both counted "questions left" off
  the map's *ring* set, which a commit subject never joins: with only Placement left the HUD read
  *"36 questions ringed on the map"* over a map with none, and the guide's button looked live and did
  nothing.

  **A claim in the ADR was falsified by the measurement it cited, before anyone else read it.**
  `busy` — high-churn files the commit did not touch — leads the distractor mix at 35% because the
  churn guess is this verb's live threat, and the first draft said so with a number from a
  throwaway prototype: *"25 of 37 commits refused, a deck of 8"*. Run through the real generator it
  is **10 and 31**, and deleting the strategy alone changes almost nothing (1 → 3 refusals) because
  the `distant` padding walks the churn ordering busiest-first anyway. The prototype's fallback
  preferred the *lowest*-churn files it could find and so manufactured the effect it measured. Both
  the ADR and `distractors.ts` now carry the three-row table instead, and the lesson written down is
  narrower than "measure first": **a counterfactual is only as good as the thing it holds fixed.**
  The other measured choice went the other way and is recorded as a null result: sampling the key
  *spread* across a commit rather than sliced off its front changes **no** count on either repo —
  same deck, same refusals — so it is a choice about what the key teaches, not about supply.

  **A third figure went the same way and is worth the space.** The ADR first said the verb cost
  "+0.36 s on hono", from comparing this branch's index time against `master`'s — two trees with
  different file counts. Run properly, with the deck cap at 0 against its normal value on one tree,
  the cost is **not measurable**: 443–467 ms here against 458–470 ms without, 1690–1871 ms on hono
  against 1843–1876 ms without, the without-runs *slower*, which is how you know you are reading
  noise. The atlas grows 33.1 KiB here and 48.1 KiB on hono. Two bad counterfactuals in one document
  is what made this a landmine rather than a correction.

  Also measured rather than assumed, because the brief suspected it: **ADR-0005's `maxCommits` is not
  what bounds this verb.** On ark the cap never fires (45 retained against 500 — the 13 "dropped" in
  `report.truncations` are commits that touched no *indexed* file, which that entry conflates), and
  on hono, where it fires hard, the **deck cap binds first**: 500 commits yield 232 distinct boards
  and `maxChallengesFor` keeps 54. Raising it would make more boards for the deck cap to discard.

  §8.3's four strategies are re-anchored from the subject's neighbourhood onto the answer key's, and
  gain a fifth with no §8.3 analogue because §8.3's subject has no prose: **`mentioned`** — a file
  whose own name is in the commit message and whose contents are not in the diff, which punishes
  exactly the reading pillar 3 forbids serving. It fired 53 times here and 88 on hono. `gate.ts`'s
  subject generalises from a node to *what the prompt puts in front of the player*; `directory` is
  left out of the commit heuristic set because a commit has no directory and a guess the board cannot
  invite would delete questions for a strategy nobody could use. Placement is **tier 6** (§5's
  *"where does it go?"*, ground truth *"the actual commit that added it"*), so the selector serves
  every tier-3 question first — the progression working as specified, and worth knowing because a
  short session never reaches this verb.

  20 of 20 mutations caught, one only after the first version of its test had *survived*: the spread
  assertion checked that a key spanned two directories, which was true either way because the test
  fixture orders nodes by the **hash** of their path. It asserts both ends of the commit now.
  `test:e2e` plays a real Placement board through the guide — the only route in, since no node
  carries one — from a seeded save, and asserts the note it writes talks in neither hops nor
  dependence. One existing atlas test was rewritten rather than repaired: *"the region constraint has
  to be relaxed at least once"* now fails on a 116-question deck because the constraint always wins,
  which is the term working perfectly being read as the term being dead. It measures divergence
  against a neutralised rank instead (19 of 116).

  **A post-ship review found five things, and one of them was a wrong answer key.** Placement's whole
  guardrail-4 argument is that it certifies a wrong answer from a commit's own *positive* file list,
  so absence cannot hurt it — and the first version of that argument concluded it therefore needed no
  shallow-clone refusal either. **It does.** A `--depth N` clone's oldest commit has no parent, so git
  diffs it against the empty tree and `--name-status` reports it as *adding the entire worktree*.
  Reproduced end to end: a repo of 8 files grown to 38 and cloned at depth 2 shipped a board for
  *"wave one lands"* whose key held three files predating it by eight commits, over a `touched` of 23
  against a true 15. Refused whole now, on ADR-0014's own `repo.root === null` signal. The argument
  was right about the walk window and wrong about a mechanism it had filed under the same heading —
  which is a better description of how this class of bug happens than "we didn't think of it".
  Also found: **`truncated` was a branch that could never run** (`wideCommitFiles` 25 < `maxCommitFiles`
  64, and `wide` was tested first) in a file whose own header quotes the dead-path landmine; **the
  sample was never sorted** while decision 4 said "path-sorted" and reasoned from an alphabetical
  clustering the atlas's *hash* ordering does not have; **`commitOf` claimed a cost it did not have**,
  scanning `O(nodes × commits)` at save-restore rather than once per panel. And one nobody had paired:
  the prompt prints the commit's **date**, the inspector prints every node's **last seen**, so ticking
  the matching dates is as structure-blind as a guess gets — it beat band A on **16 of hono's 54
  shipped boards** and on **none** of ark's 37, which is the sharpest argument yet that measuring on a
  second repo is not optional. `recency` joins `COMMIT_HEURISTICS`; it refuses 63 more boards on hono
  and costs the deck nothing, because the cap backfills. 8 of 8 further mutations caught — one only
  after the replacement test *survived*, because with twelve files and a six-file key a hash ordering
  contains both path-extremes about a quarter of the time.

  **Next**: **Archaeology**, M4's third and last — and it **cannot be built as §6.2 states it**.
  *"This file was rewritten three times. What problem kept recurring?"* is not deterministically
  gradeable, so guardrails 3 and 4 both bite; it needs reshaping into something git answers exactly,
  and **revert detection is the strongest candidate**. That is an ADR before any code. Then the
  **negative witness** — a wrong pick has a known reason class (sibling, name-alike, structurally-near
  non-dependent, co-change ghost, and now *mentioned in the message*) and the reveal never says which;
  decide first whether strategy provenance ships in the atlas (schema bump) or is re-derived
  player-side (no bump). Then the **overlapping Companion answer keys**, and then the **phenomenon
  catalogue** for risk #1.

- **Three known bugs closed, each measured before it was touched.**

  **A co-change cell is one fact, so it gets one question.** ADR-0012 issues each answer *key* once
  and says nothing about keys that *overlap*; CLAUDE.md has carried that as the open half since M4.
  The sharp case turned out to be **symmetry**: the atlas stores a pair as `[a, b, count]` once, so
  "B changed with A" and "A changed with B" are one fact read from either end, and grading both means
  the reveal on the first board names a member of the second. Measured before the fix — **35 of ark's
  40 Companion boards held a mutual member, and 38% of every key slot in the deck (74 of 196) was
  handed over by another board's reveal**; one board gave away 4 of its 6. On hono, 6%. After: **zero
  on both**, deck size unchanged (the cap binds either way), at a cost of 6 more unprovable nodes on
  hono. Deliberately **not** applied to Blast Radius, where a mutual pair is an *import cycle* —
  "streaming reaches components" and "components reaches streaming" are two distinct reachability
  claims about two subjects, both true and both worth asking. Symmetry of the relation is the licence,
  and only co-change has it. One mutation survived the first three assertions: sizing the key off the
  full ranking while sampling from what is left makes `size` bigger than the key it produces, which
  spends the missing slots on nothing — the board comes up short of a full choice set and `reach` is
  divided by a size the key does not have. Pinned by asserting every board carries all 20 candidates,
  which is true of all 131 across this repo's three decks.

  **Labels stopped being drawn underneath the panels.** The HUD, the legend, the inspector and the
  guide are DOM siblings of the canvas, so the renderer could not see them and a label placed beneath
  one was drawn, counted, and invisible — a slot spent on nothing out of a budget of about 35. They
  now arrive as `occupied` boxes, which is the mechanism region labels have used since M1; the rects
  are measured by a `ResizeObserver` rather than per frame, because `getBoundingClientRect` forces a
  layout and the HUD's text is rewritten immediately above the draw call. Visible in the artifacts:
  three `docs/decisions/…md` names ran under the HUD's right edge before, none now. A mutation
  removing the chrome from the node pass **survived the whole suite**, because `labels.test.ts` pins
  the placer and nothing pinned the *wiring* — so the three call sites now go through one helper that
  closes over the chrome and cannot drop it, and `tests/unit/draw.test.ts` gates it with a stub 2D
  context.

  **The orbit culls, and re-fits on the way in.** It borrowed the flat map's screen-space cull
  (ADR-0017), and the subtlety is that only the *draw list* is cut: every node is still projected into
  the by-ref map, so an edge from an on-screen column to an off-screen one still draws the part the
  player can see — the same distinction `visibleEdges` makes on the flat map. Measured on a synthetic
  2,000-node grid before writing it, because a cull that never fires is a filter asserting a behaviour
  the product does not have: **0% culled at a fitted territory view** (nothing to drop — the old
  comment's "the sort dominates" was right about *that* view and only that one), **61% at district,
  93% at street**. Entering the orbit now re-fits, because lifting every column above its footing puts
  the tallest files off the top edge — you press `o` and the thing the view exists to show is the
  thing that leaves. Leaving does **not** re-fit: the flat map is where spatial memory lives and a
  camera the player moved is theirs. 6 of 6 mutations caught, two only after the first pass — the
  vertical cull had no test at all, since a column's extent is `[top.y, base.y]` and an x-only test
  cannot see the asymmetry.

  **CI went red on this and the reason is now a landmine.** Both failures were invisible on the
  branch and reproducible only on the merge commit, because GitHub checks out `refs/pull/N/merge` —
  **ark indexes a commit that does not exist on your machine**, so churn, co-change and the retained
  commit list all differ and *which questions exist* differs with them. `test:determinism` cannot
  see this: it indexes one commit twice, and this is two commits. The reproduction is
  `git checkout -b x origin/master && git merge <branch>`.
  What the merge history exposed was worth having. First, a **test asserting more than the
  contract**: it read "no two challenges with the same key" while `docs/atlas-format.md` §3.6 and
  ADR-0014 both say uniqueness is *within-verb* — *"two different verbs may honestly share an answer
  set"* — and it passed for two verbs only because a cross-verb collision never arose. With three it
  did, and the pair is not a repeat but arguably the best pair in the deck: a Companion key, and the
  Placement board for the commit that **caused** that coupling. Keyed by `(verb, truth)` now.
  Second, two `.find()` ordering assumptions in the e2e, the same class as the `.first()` landmine:
  the wire step picked the board the challenge step had already answered (so the inspector correctly
  hid its control and the click waited 30 s), and the next candidate was a file small enough to fall
  between the cursor grid's points. It takes a list sorted by `loc` now and falls through to the next
  candidate, so it depends on no single one.

  **Next**: unchanged — **Archaeology**, M4's third and last, which needs an ADR before any code
  because §6.2's wording is not deterministically gradeable and revert detection is the candidate
  reshaping. Then the **negative witness**. Still open and deliberately not touched here: the twins a
  duplicate answer key drops are never mentioned to the player — `cone(A) = cone(B)` is a true derived
  fact that ADR-0011 decision 3 says must be *shown* rather than proved, so it wants a decision about
  where before it wants code.

- **Measured Archaeology's supply before opening its ADR, and both named candidates are dead.** No
  code — this is the "measure before you argue" step, done first because the two candidates the
  earlier entries name were named from plausibility rather than from data.

  | signal, inside the retained window | ark (the bootstrap repo) | `honojs/hono` |
  |---|---|---|
  | retained commits / walked | 50 / 64 | 500 / 2,758 |
  | usable (not wide) | 45 | 499 |
  | **looks like a revert** | **0** | **1** |
  | **carries an issue number** | **0** | 358, but **355 distinct** |
  | issues with more than one commit | 0 | 3 |
  | files with churn ≥ 5 | 29 | 251 |

  **Revert detection** — which two earlier entries and CLAUDE.md all call "the strongest candidate" —
  finds **nothing** on the repo NORTH-STAR §11 makes the first level, and one commit in hono's
  window: 10 across its full 2,758-commit history, of which only 12 `This reverts commit <sha>` body
  references resolve to a commit the clone contains at all. A verb with no supply on the bootstrap
  repo is not a verb, and this is the second time in two sessions that the *named obvious answer*
  did not survive being counted.

  **Issue linkage** — NORTH-STAR §2's own example, *"git knows which file fixed issue #4412, because
  the commit says so"* — is 0 here (this repo puts no issue numbers in subjects) and degenerate on
  hono: 355 distinct issues across 358 commits, so "which commit closed #N" is a 1:1 lookup rather
  than a question. It would also need the commit **body**, which `history.ts` does not keep.

  What survives is the half of §6.2 that was already gradeable: **churn and the dates around it**,
  complete on every node regardless of ADR-0005's commit cap because it aggregates before it
  retains. So the design question the ADR has to answer is narrower and sharper than "how do we
  detect a revert": **what can be asked about a file's history that is not "which of these is
  busiest"** — a guess `gate.ts` already refuses as structure-blind and the inspector prints for
  free. With the same trap one field over: the inspector prints `first seen` and `last seen`, so any
  prompt quoting a date hands over a matching guess, which is what `recency` was added to
  `COMMIT_HEURISTICS` to refuse.

  **Next**: the Archaeology ADR itself, from these numbers rather than from the sentence they
  replace. Then the **negative witness**, then the **phenomenon catalogue** for risk #1.

- **ADR-0019: Archaeology asks a place what happened to it — the decision, and no generator.** §6.2's
  *"what problem kept recurring?"* is not gradeable, so the reduction is **recognition instead of
  generation**: subject a **file**, board **commits**, truth the commits whose own recorded file list
  names it. You are never asked to articulate the recurring problem; the answer key *is* it. That is
  the transpose of Placement, which is stated rather than glossed — it is where the remaining supply
  is, because every file→file history relation git supports is either co-change (Companion) or a date
  comparison the inspector prints for free.

  **Two decisions came out of measurement and neither was the plan.**

  **The date window is a pool filter, not a distractor strategy.** The inspector prints first-seen and
  last-seen; every candidate row shows a date; so "tick everything inside the range" has **recall 1.0
  by construction** and clears band A at precision 0.64. Unfiltered it is the dominant guess — best
  0.77 on hono with **17 boards scoring 0.70–0.78**, the edge of a cliff rather than a plateau.
  Constrain every candidate to the subject's own lifetime and the same guess selects the *whole
  board*: it becomes ADR-0007's select-everything exploit, measured max **0.46** against a 0.5
  threshold. **A gate heuristic retired by arithmetic** — one rule where there would have been two.

  **A fact an earlier reveal already stated is not an answer**, and this is the finding that changed
  the design. Placement's reveal names the files a commit touched, which is exactly a member of those
  files' Archaeology keys: **55.6% of this repo's key members were already disclosed, and 15 of 66
  boards were disclosed entirely** (16.0% and 1 of 172 on hono — the bootstrap repo is the worst case,
  because its Placement deck covers 39 of 46 eligible commits against hono's 54 of 475). Excluding
  them costs **13 boards here and none on hono**. The counter-argument nearly won — recall is not
  Ctrl+F, and remembering a reveal *is* learning the repo — and lost to §9's own line: a note claims
  what was **proved**, never what was **shown**. This generalises ADR-0012 from answer keys to the
  facts inside them, and it is the first time one verb's output constrains another's.

  Supply, measured on both repos as decided: **22 boards here** (supply binds) and **54 on hono**
  (the cap binds), keys of 2–6 commits, lifting 1 of this repo's 16 unprovable nodes and 14 of hono's
  154. Tier **5**, so it is served after tier 3 and before Placement.

  **An adversarial review before merge found seven things, and four of them were a sentence
  contradicting a number in the same document.** The worst was not in the proudest paragraph this
  time. Decision 6 measured a width leak on **5 of 27 boards** and then wrote, four lines later, that
  "the leak it prices is one the product does not have" — `broadKnown` is a gate heuristic now, at 5
  boards here and 0 on hono, taking the deck to 22. Decision 7's justification argued from a fact
  being *previously* shown, which **decision 8 falsifies three paragraphs later** — tier ascending
  serves this verb *before* Placement; the rule survives, rebuilt order-free, which is also what makes
  the width gate coherent, since the two paragraphs had been assuming opposite things about what the
  player had already seen. And the "correction" this entry's previous draft was proudest of was
  itself wrong: ark's retained commits carry **0** issue numbers, not 16 — all sixteen are `Merge pull
  request #N` subjects, merge commits get no file list from `--name-status`, so **none is ever
  retained**. The CHANGELOG's original 0 was right. The lesson is narrower than the landmine I cited:
  **a different instrument is not drift** — I measured the walked git log where the question was
  about verb supply. It did produce one fact nothing else in the document had: merge commits are
  structurally invisible to this verb.

  Also caught: 37 firings quoted as 37 refusals (it is 33 — four boards lose to two guesses); a false
  superlative about supply binding; the map's click path **inverting the tier order** by alphabetical
  accident, on the interaction `selector.ts` calls primary, against a `main.ts` comment stating the
  rule an `archaeology-` prefix breaks; and two of six disclosure directions unchecked — of which
  **Archaeology→Companion is a real 14-pair overlap here**, measured and deliberately not acted on,
  because Placement's reveal *states* its atom while two Archaeology reveals only *imply* theirs under
  combination, and combining two reveals is reasoning rather than lookup.

  **Next**: build it. First task is the verb-blind disclosure accumulator decision 7 needs — each verb
  declares the facts its reveal gives away, `build.ts` accumulates in generation order — because
  without it nothing else can be correct. Then the member widening: `candidates`/`truth` admit a
  commit id (`ATLAS_VERSION` 6 → 7, `docs/atlas-format.md` in the same commit), and six places assume
  a *member* is a file — the worst is `save.ts`'s `asIds`, whose own comment states the false rule in
  words, **the third instance of that class in that one file**.

- **M4 closes: Archaeology ships, and a member is now a place or an event.** NORTH-STAR §6.2's
  *"what problem kept recurring?"* is not gradeable, so the verb is
  [ADR-0019](./docs/decisions/0019-archaeology-asks-a-place-what-happened-to-it.md)'s reduction —
  **recognition instead of generation**: subject a **file**, board **commits**, truth the commits
  whose own recorded file list names it, `candidates ∩ touchedBy(subject) = truth` for the fourth
  time. Tier 5. `src/verbs/archaeology/`, plus the three things that had to move first.

  **The member widening (`ATLAS_VERSION` 6 → 7) produced zero compiler errors, exactly as ADR-0018's
  subject widening did**, because `NodeId` and `CommitId` are both aliases of `string`. Nine readers,
  found by grepping every read of `challenge.candidates`, `.truth`, `grade.correct` and `pass.proved`
  and asking *what am I assuming this names?* The worst was **`save.ts`'s `asIds`, whose own comment
  stated the false rule in words** — *"`proved` stays node-only, because a member is always a file
  whatever the subject is"* — and whose filter drops a member at load that the next write then
  erases: every Archaeology pass would have survived its own session and died on the second. Third
  instance of that class in that one file. The others: `deriveFog` putting commit ids in a set of map
  squares; `livenessOf.holds` building a verb's population from `atlas.nodes` alone, so every
  Archaeology claim would have decayed to nothing on restore; **`notes.ts` resolving each member
  through `refById` and `continue`ing on the miss — ADR-0018's own defect 1, in the same function,
  one line below the fix that was written for it**; the console rendering twenty rows of
  `c:1a2b3c4d5e6f`; the validator; `gate.ts`'s node-only scorer; and `cli.ts`'s unprovable count,
  where the comment one line up was right about the class and had been applied to half of it. The
  union is `AtlasId` now — it was named `SubjectId` for the one role it had.

  Step 1's disclosure accumulator — shipped last session with nothing consuming it — **finally has a
  consumer and a test that bites**: disconnect it and `test:atlas` goes red. Decision 7 measured at
  **52.2% of this repo's issued key members already stated by a Placement reveal, and 6 of 61
  candidate boards entirely**; excluding them costs 42 subjects here (deck 40 → 26) and 21 on hono
  (54, still capped). The order of two lines in the generator is the whole of that rule: membership is computed
  from the **unfiltered** toucher list, so an excluded commit leaves the board altogether rather than
  dropping into the distractor pool — which is the wrong answer key ADR-0019's own probe shipped
  inside the counterfactual that was about to justify the rule.

  **Re-running the ADR's tables against the real generator was the first task after building it, and
  one row inverted.** Structural figures reproduce; the window guess maxes at **0.480 here and 0.462
  on hono**, which decision 5 predicted in as many words (*"a 19-candidate six-key board — which the
  rule allows — would read 0.48"*), both below the 0.5 threshold because the sizing rule requires it.
  But the gate table swapped ends:
  `oldestK` fires **0 times on both repos** against a predicted 24 on hono, while `recentK` — left
  out *because* it measured zero — refuses **3 hono boards**. So `recentK` is in the set, on
  decision 6's own stated rule and on its own caveat that the exclusion held only *"under this
  configuration"*. `oldestK` stays as a canary rather than as a live gate: both are invited by the
  same structural fact (the key spans the date ordering, so it contains both ends), and it loses only
  because the distractor padding is spread across the window instead of ranked — ADR-0018's `busy`
  argument again, supply the board with the thing that makes the naive guess wrong. Measured, it is
  one design change from firing. **`broadKnown` costs 1 board here, not 5.**

  Two things the implementation found that no measurement predicted. **`uncertain` is not a refusal
  this verb can make**: `commitSupply` already refuses every commit touching a barred node, so a
  contested file has zero eligible touchers and never reaches the check — the branch was unreachable,
  confirmed by mutation, and is gone. And **a 2-toucher file's key *is* both endpoints**, so on a
  fixture with one commit per date `endpoints` refuses every such board; the first unit fixture did
  exactly that and shipped **one board** while every assertion about choice sets passed vacuously.
  Real repos land several commits a day, which is why keys of 2 exist on both.

  Shared machinery moved up to `src/verbs/` on the precedent `gate.ts` and `paths.ts` set:
  `commits.ts` (commit eligibility — the two history verbs read *the same record* from opposite
  sides, so a copy would have been two rules that can drift), `sample.ts` (`spread`, `truthCap` and
  `retain`, which existed as byte-identical copies in three verbs and would have been four), and
  `members.ts` (what an id is called on screen, dispatched on the id and never on the verb). The map
  orders a node's click bucket by **tier** explicitly now — `archaeology-` sorts before `blast-`, so
  the atlas's id order would have served the tier-5 question first on the path `selector.ts` calls
  primary, inverting the curriculum and falsifying `main.ts`'s own comment.

  Measured **at `11c92c0`, on a clean clone of that commit** — because the first draft of these
  figures was taken from the working tree that became the commit carrying them, which counted an
  untracked probe script as a node and missed a commit that did not exist yet, and got every ark
  figure wrong by exactly the act of writing it down. **26 boards here** (supply binds) and **54 on
  hono** (the cap binds), keys of 2–6 commits, lifting 1 of this repo's 20 unprovable nodes and
  **16** of hono's 154. Four verbs leave **19 of ark's 140** nodes unprovable where Blast Radius
  alone leaves 52. Atlas ~250 KiB in ~455 ms, all budgets inside their ceilings, byte-identical
  across two runs. The reveal states
  relations and never identities — *"it changed a file that imports this one"*, never which — because
  naming it would hand over that commit's Placement key, ADR-0014's finding 3 running the other way;
  and it never prints a commit's width, which is `broadKnown`'s input. Both pinned by tests that fail
  when mutated.

  Adding Archaeology's invariant to `tests/atlas/` revealed that **Placement had never had one on the
  real atlas** — it lived only in a unit fixture. Both are there now, with the cross-verb disclosure
  check, which is the one property neither verb can see and which the `(verb, truth)` uniqueness rule
  structurally cannot express, since one key holds node ids and the other commit ids.

  **An adversarial review of the finished code then found four more**, and the shape of them is the
  usual one — none was findable by the type system or by any suite. The reveal and the field note
  described **different populations** (eligible touchers against retained ones), so they disagreed on
  21 of 26 boards and the reveal printed *"that is every commit in this window that touched X"* over
  a record that held more — **false, and falsifiable with one `git log`**, on 4 boards here and 4 on
  hono; each surface was internally consistent, which is why nothing could see it. **`tooFewCommits`
  was a second unreachable refusal** in the same six-row ADR table that already lost `uncertain`.
  **A relation over a set of one is an identity**: *"it changed a file that usually moves with this
  one"* names the file when the subject has exactly one partner — 4 such notes on hono, 2 of them
  naming a shipped Placement answer-key member. And **the re-measured figures themselves** were taken
  on the working tree rather than on the commit they named, which the hono column reproducing exactly
  is what isolated.

  The tests written for those fixes are worth recording too: **the first round of mutants all
  survived**, because the fixture had no wide commit, no co-change matrix, and graded with an empty
  answer so the wrong-pick explainer never ran. Three assertions that passed without executing the
  code they were about, in the session that had already written a landmine about exactly that.

  **Next**: the **negative witness** — a wrong pick already has a known reason class (sibling,
  name-alike, structurally-near non-dependent, co-change ghost, message-mention), the generator
  *chose* it for that reason, and no reveal says which. Decide the one design fork first: strategy
  provenance either ships in the atlas (a schema change, so `ATLAS_VERSION` and
  `docs/atlas-format.md` in the same commit) or is re-derived player-side from the graph, which needs
  no bump. After that, the **phenomenon catalogue** — a repo-independent vocabulary of ~30–60
  structural phenomena, the atom that would let anything *transfer* to another repo, which is the
  other half of risk #1.

- **Two nits from the M4 close-out, both of the same kind: a document stating something the code
  does not do.** `npx ark index .` has been in the Definition of done for four milestones and **has
  never worked** — `package.json` has no `bin`, and `build` typechecks the indexer with `--noEmit`
  rather than emitting it, so there is nothing for `npx` to resolve. Corrected to `npm run index`,
  which exercises the same path; `npx ark` stays in NORTH-STAR §10 where it belongs, as the intent it
  is, now labelled **unbuilt rather than broken** — packaging the CLI is real work nobody has done,
  and it is not a nit. The lesson is narrower than "docs go stale": **a checklist item nobody can
  literally satisfy gets ticked from memory**, which is the one failure the Definition of done exists
  to prevent, so it was worse than a wrong command.

  And the Archaeology fixture's two doc comments stated the engine's toucher count in two different
  senses — "nine commits" (retained) in the header, "eight times" (eligible) beside the commit list —
  which is the *exact* ambiguity that produced the shipped defect the review caught a commit earlier,
  reproduced in the test file written to pin the fix. Both numbers are stated now, with the reason.

  No source and no schema changed — **though the atlas did**, which is worth saying rather than
  waving at: `CLAUDE.md`, `CHANGELOG.md` and the test file are all indexed nodes, and the commit
  itself joins the history, so the deck moves. Writing "no atlas change" here would have been the
  same species of imprecision this entry is about. **Next** is unchanged — the negative witness,
  with its one design fork (strategy provenance in the atlas and a version bump, or re-derived
  player-side with neither), or M5 by the roadmap.

- **The negative witness — a wrong answer now carries the reason it was offered.** Every distractor is
  chosen by a named §8.3 strategy and the label died at the generator's return statement:
  `report.distractorMix` kept the aggregate, nothing kept *which*. **The fork was decided by the
  measurement nobody had taken** — comparing the strategy that really chose each candidate against
  the reason today's reveal re-derives from the graph, read off the emitted *sentence* rather than by
  re-running the branch predicates. The reveal names the right class on **53.9% of this repo's 2,291
  distractor slots and 47.9% of hono's 3,524** (measured on clean clones of `4bb1996` and
  `cf78528`); 38% name a *different* class, and **seven of the seventeen (verb, strategy) pairs are
  re-derived correctly zero times on either repo** — Companion's and Placement's `treeSibling` and
  `nameSimilar`, swallowed by the churn arm that runs before them; Blast Radius's `nameSimilar` and
  `coChange`, which have no arm and fall to the generic sentence; and Archaeology's `sibling`, which
  has no arm either. Not a
  weakness of the re-derivation: a candidate satisfies several predicates at once and which one
  *chose* it was settled by a quota. So provenance ships in the atlas — `ATLAS_VERSION` 7 → 8,
  `Challenge.witness`, `docs/atlas-format.md` in the same commit
  ([ADR-0020](./docs/decisions/0020-a-wrong-answer-carries-the-reason-it-was-offered.md)). It costs
  **+27.0 KiB here (10.8%) and +40.5 KiB on hono (7.3%)**, measured through the real serialiser
  because `serialize.ts` line-expands long arrays and the obvious encodings cost 51–68 KiB for that
  reason; 1851 → 2050 bytes per file against a 2621 ceiling. **89.5% of wrong-answer rows carry a
  witness here, 87.6% on hono.**

  **The trap was written down in the file it would have broken**, and it holds:
  `blastRadius/reveal.ts` deleted its co-change sentence because `coChangeStrategy` ranks the matrix
  count-descending, which *is* Companion's key for the same subject — so a label saying so is that
  sentence wearing provenance. It is recorded in the atlas and never spoken; measured, 3 of ark's 12
  co-change distractors and 3 of hono's 53 are members of that subject's shipped Companion key. A way
  to keep it was designed and measured — Blast Radius declares the pair through ADR-0019's
  accumulator, Companion may not ask it back, costing 7 boards one key member here and 5 on hono,
  none falling below a two-member key — and **rejected**, because ADR-0014 faced that exact trade and
  kept the question rather than the sentence. Companion's `structural` is withheld too, on a weaker
  argument stated as the judgement it is: it walks the import graph unbounded, and where it is safe
  (the direct ring, 133 of 219 slots here) the note already says it.

  The rule the rest falls out of is **withhold by class or by board, never by row**, and it came from
  watching a per-row guard defeat itself: withholding only the unsafe `structural` rows makes silence
  mean *"deep structural"*, which is the fact being withheld. Every guard is therefore a property of
  the subject — Archaeology's three set-size guards fire 7/0/0 here and 5/2/3 on hono. `distant` says
  nothing, deliberately: it is padding, "offered because nothing sharper was left" is a confession
  rather than a lesson, and it is 2 of 2,291 slots here anyway.

  **A live defect fell out of building it.** Placement's reveal searched the commit's *whole*
  membership for a neighbour to name, while `placement.discloses` can only declare the sampled key —
  it takes a challenge and no atlas. So a sentence stated *"commit C touched F"* for an F the
  accumulator never heard of, which is an atom of F's Archaeology key: ADR-0019 decision 7 routed
  around by a sentence written a milestone earlier. **32 sentences across 16 of this repo's 40
  Placement boards, 20 of the atoms in a shipped Archaeology key**; 12 across 5 boards on hono, 4 in a
  key — and `whyYes` runs on every truth member of every board, so it was not conditional on a wrong
  pick. Narrowed to the answer key, which also made the fall-through's *"anything else in the
  commit"* false, so it reads *"anything else on this board"* now.

  Seven mutants on the atlas suite and seven on the unit suite, each killed by exactly the assertion
  it was aimed at — **after one survived**: the first Placement test built a commit whose sampled-out
  members had no import edge to anything on the board, so the sentence that used to name them never
  ran. And the e2e needed a new step for the same reason in a louder form: **every board it plays, it
  plays perfectly**, so the witness renders only under a wrong pick and the feature was invisible to
  it — infrastructure with the consumer present and never reached. It now picks a wrong answer the
  verb says it will explain, and `artifacts/witness.png` shows the two lines apart.

  **An adversarial review of the finished code then found nine things, and five were one class this
  entry did not have a name for: a witness *glosses* its class, and three glosses stated §8.3's
  **definition** of the strategy rather than the strategy that ships.** Each of those strategies
  starts at its textbook bucket and **widens** when the bucket runs dry, so *"a directory sibling"*
  was false on **100 of this repo's 231 Blast Radius rows and 193 of hono's 297**, and Archaeology's
  *"this file's own directory"* on 14 here and 40 on hono — falsifiable by a player reading the two
  paths in one row, or with one `git show --stat`. Archaeology's was worst and carried two more
  defects inside it: `byDirPrefix` is the whole **subtree** (its docstring says "the deepest bucket
  only" and does not say that), a **root-level subject**'s bucket is the entire repo so the sentence
  was true of every commit and worth nothing (24 rows here, 25 on hono, withheld now), and the guard
  counted a **third** population — so strategy, guard and sentence quantified over three different
  sets. The lesson is narrower than "check your wording": **a class label is not a class
  description**, and the sentence explaining one has to be true of every member the fallback reached.
  `tests/atlas/` checks the claim rather than the wording now, holding each sentence to the
  **strongest** relation it asserts — the first version checked the weaker property and a mutant
  restoring *"a directory sibling"* survived it; four mutants are killed now.

  The review also caught the e2e predicting which board the console would open from `atlas.challenges`
  order (id order, so `archaeology-` first) where `challengeFor` serves **tier** order — the two
  disagree on 20 of the 27 subjects carrying more than one board, and it passed only because today's
  guide suggestion carries exactly one. It reads the choice set off the screen and matches the board
  now. And three prose defects, all the same shape as the four already corrected this session: a
  clinching sentence in ADR-0020 falsified by its own table (*"states an undrawn cone edge"* is false
  of **76 of the 86 rows it condemns** — they are undirected proximity, in nobody's key), a test
  comment quoting a working tree that named no commit, and "32 sentences" for 40 sentences and 32
  distinct namings. **One direction is recorded and deliberately not acted on**: Archaeology's
  `sibling` sentence is a weakened atom of that commit's Placement key, and ticking the hinted subtree
  on the Placement board is 100%-precise on 9 boards here and 4 on hono. The same exposure predates
  this rung in the `neighbour` and `companion` arms; what ADR-0020 should not have implied is that the
  set-size guard is *the* guard these classes need.

  **Next**: the **phenomenon catalogue** — a repo-independent vocabulary of ~30–60 structural
  phenomena, the atom that would let anything *transfer* to another repo, which is the other half of
  risk #1 — or **M5** by the roadmap (tree-sitter, 3–4 more languages), which is the larger bet since
  the scanner is ES-modules-only and a Python or Go repo still produces a map with no edges. Two
  smaller things are now on the record and neither is a nit: **`RevealNote.route` is rendered
  nowhere** — Blast Radius has computed the import route since M2, three unit tests assert its shape,
  and the console has never drawn it — and **the unit fixtures produce two of Archaeology's four
  distractor classes**, so its reveal tests hand the class in deliberately and say so.

- **Tracking fix: the one open item a cold session would not have found.** ADR-0020 measured a
  disclosure direction and deliberately did not act on it — Archaeology's `sibling` witness is a
  weakened atom of that commit's Placement key, 100%-precise on 9 of this repo's boards and 4 of
  hono's — and recorded it in the ADR and in the CHANGELOG entry above. It was **not** in
  `CLAUDE.md`'s *Next action*, which is the line the session rhythm actually sends a reader to. Two
  of the four things left open were in three places each and this one was in two, which is exactly
  how a measured, deliberate deferral becomes an accidental one. It is the Next action now, with its
  numbers and a pointer to where the measurement lives.

  The same edit puts the remaining backlog in size order and gives **M5 the kill-point it needs
  stated in advance**: ADR-0003 makes an unresolved import produce no edge and guardrail 4 makes an
  uncertain cone produce no challenge, so a language whose imports resolve poorly ships a sparse map
  and an empty deck **while every suite passes** — the instrument-that-measures-nothing landmine one
  level up, where the failure looks like a small repo rather than like a failure. Resolution rate,
  edges/node against ark's 2.66 and hono's 2.51, and `report.unprovableNodes` get measured on a real
  repo before a parser is written, and "this language does not ship" is an acceptable ADR.

  Documentation only; no source, no schema, no atlas shape. **The atlas does move** — `CLAUDE.md` and
  `CHANGELOG.md` are indexed nodes and this commit joins the history — which is worth saying rather
  than waving at, for the reason the M4 close-out entry gives. **Next** is unchanged from what this
  entry installs: score the subtree hint on the Placement board.

- **ADR-0021: the subtree hint is scored, and it does not reach the bar — but something beside it
  does.** ADR-0020 measured Archaeology's `sibling` witness — *"a commit that touched this file's own
  corner of the tree"* — as a weakened atom of that commit's **Placement** key, found it 100%-precise
  on 9 boards, and left scoring it as the open work. **The obvious implementation does not exist**,
  and finding out why was the first task: `build.ts` runs Placement *before* Archaeology because
  ADR-0019 decision 7 needs it to, so when a Placement board is gated the hint has not been written
  yet, and when the hint is written, scoring it means reading another verb's deck. The question is
  therefore not "score it or don't" but *how does a later verb learn that a sentence would decide an
  earlier board without reading that deck* — and the measurement decides between the four answers
  rather than an argument.

  **Scored through the real generator on clean clones of ark `a063f01` and `honojs/hono` `cf78528`,
  the subtree hint fires zero times on both repos** — best **0.600** over 104 rows here and **0.727**
  over 29 there, against a 0.78 bar with nothing in the gap (the next scores are 0.500 and 0.600), so
  it sits on a plateau rather than at a cliff edge. **Precision was the wrong instrument and that is
  the finding**: a subtree hint picks one or two of a four-to-six file key, so recall caps the F1 far
  below any band however clean the picks are. The nine 100%-precise boards are real and they are not
  a grade.

  **All three arms were scored, not only the new one, and the asymmetry is the result.** `neighbour`
  fires zero times too. `companion` — which shipped in M4 and had never been scored either — beats
  band A on **3 of this repo's 40 Placement boards and 3 of hono's 54** once the hints one board
  states about one commit are pooled. Every firing runs through the co-change relation and none
  through a path. The counterfactual holds the board, the relation and the scorer fixed and varies
  only the seed: seeded from the board, or from whichever file in the repo covers most of it, **the
  same guess fires nowhere**, so the hint is genuinely load-bearing rather than a Placement-native
  exposure wearing a costume.

  **Decision: accepted, on a rule fitted to every prior call `gate.ts` has made.** All nine
  heuristics there are runnable with no knowledge of the repo — match a path, match a token, sort a
  printed column — and the one guess that file has ever declined, `directImporters`, is the only one
  of the ten that needs a relation to run. So: *a guess belongs in `gate.ts` when a player could
  execute it knowing nothing about the repo*. **That the rule was "already there unwritten" is the
  overclaim this entry refuses**, and a draft of the ADR made it: the file excludes `directImporters`
  for a *different* stated reason — it is given away on purpose and §8.4 already prices it — so this
  is a new articulation reproducing ten decisions, not a restatement of one. The arm that is structure-blind is the one that
  never reaches the bar; the arms that reach it need the matrix or the graph, and a board answered
  from the co-change matrix was answered by **reasoning about structure**, which is pillar 3's second
  half rather than a violation of its first. That is a judgement and ADR-0021 carries the
  counter-argument with it — this repo gated `broadKnown` at a *smaller* number, and the only thing
  separating the two is the rule above.

  **What the ADR does not claim, because a first draft claimed it and was wrong.** It argued that no
  by-board guard could see a guess assembled from two boards. Measured: **every firing on both repos
  is visible to a single Archaeology board**, a by-board guard would close all six, and it would cost
  a class going silent on 3 of ark's 32 boards and 4 of hono's 54 — cheap. So the decision rests on
  the line alone, and the guard that would close it is written down in full (a verdict-shaped
  `decidedFact(commit, seed, relation)` declared by the earlier verb) rather than left to be
  redesigned. Its real cost is that the earlier verb would have to **anticipate the relations a later
  verb might name**, and a fifth verb naming a fourth relation would get no verdict and leak silently.

  Shipped: a canary in `tests/atlas/` asserting the structure-blind hint stays under
  `CTRL_F_THRESHOLD` on every board it is spoken on, using the real scorer and the real bar so it
  moves if §8.2's bands move — **made to fail three ways before it was believed** (drop the bar to
  pass → red on 9 boards; point it at `companion` → red; empty its population → the vacuity guard
  fires). Plus `sibling`'s docstring, which still said *"the deepest bucket only"* — the population
  ADR-0020 had just corrected in the sentence and the guard one file over, left uncorrected in the
  strategy that reads it.

  **And ADR-0020's own hono precision pair does not reproduce, one half of it cannot be right, and
  the instrument is not in doubt.** It recorded *"100%-precise on 9 boards here and 4 on hono, and at
  least half-precise on 21 and 2"* — a fully-precise board is at-least-half-precise by definition, so
  4 and 2 contradict each other in one sentence. Re-measured at the same unchanged commit: 4 rows / 3
  boards, and 7 rows / 6 boards. The same probe reproduces that document's structural counts on hono
  **exactly** (91 spoken rows, 29 with a Placement board, against a recorded 91 and 29), which is what
  isolates it as transcription rather than method. Fourth instance of a sentence disagreeing with the
  table above it.

  Comments, one test and one ADR; no code path, no schema. **The atlas moves anyway** — a comment is
  bytes and `loc`, and this commit joins the history. **Next**: the backlog in size order —
  **overlapping Companion answer keys** in the generator; a **co-change distractor strategy for
  Placement**, which §8.3 calls the best class of wrong answer and which is the one verb without it
  (it would lower decision 3's table at the source rather than gating it); packaging **`npx ark`**;
  the **phenomenon catalogue**; and **M5**, which still needs its kill-point measured before a parser
  is written.

- **A README that says where we are, and the post-ship review that made its first entry a correction.**
  The repo had no README: `NORTH-STAR.md` says *what* we are building, `CLAUDE.md` *how* we work,
  `CHANGELOG.md` *when* things changed and `docs/decisions/` *why* — and nothing said **where we are**.
  `README.md` now carries the problem, the insight, the loop, the two-artifact architecture with a
  file-by-file map, and a done/ongoing/todo status for every milestone, verb and subsystem, plus a
  **Known gaps** section that names the things this project does *not* do (`npx ark` unbuilt, non-JS
  repos indexing to a silhouette, `RevealNote.route` rendered nowhere, fps below budget on headless
  raster). It is in the document map and in the **Definition of done**, because a status table nobody
  updates is worse than none — it reads as current.

  **And the adversarial consult on ADR-0021 came back with nine findings, two of which are real
  defects in the decision rather than in its prose.** Both were verified before acting:

  **The acceptance argument was refuted by the player's own code.** ADR-0021 accepted the co-change
  exposure because running the guess *"needs a relation the player has to have learned"*. Nobody had
  opened `src/player/`. `main.ts` builds `openBoards` from `channelOf(verb) === 'coChangeTies'`
  **alone**, so an open **Placement** board suppresses no wire, and `ties.ts` draws every pair an
  answered Companion reveal named — beside the open board, over the map §9 keeps visible behind the
  scrim, in the file whose own comment calls that *"the map's `Ctrl+F`"*. Measured with **only the
  wires a player can see**: the guess still beats band A on **3 of this repo's 40 Placement boards**
  (0 of hono's, whose subjects carry no Companion board). So on the bootstrap repo it is a lookup, and
  the exposure is in **ADR-0016's wire gate** — which asks about open boards *of one verb* while the
  rule it states is about open boards. That is the rule-stated-in-words landmine, and it is the Next
  action, with the thing to measure named: how much of the history layer survives a wider gate.

  **The structure-blind margin is 0.011, not 0.18.** The subtree hint was scored one row at a time —
  what a player does holding *one* board. Several Archaeology boards hint about the same commit, and
  the union of the subtrees they name is still nothing but string prefixes: **21 of this repo's
  commits carry such hints from two or more boards, and the union reaches 0.769** against a 0.78 bar
  (5 and 0.526 on hono). Still zero firings, so the decision stands — but the canary now scores the
  union as well as the row, and *"nothing sits between the best score and the bar"* was a sentence
  **vacuously true of every distribution ever measured**.

  Five prose defects fixed with them, four of the class this repo keeps finding: decision 3 quoted the
  **pooled** 3-and-3 as the `companion` arm's own score when its own table says 3 and **1**; the
  retracted "the rule was already there" claim was fixed in three files and **left standing in
  `CLAUDE.md`**, the document every session reads first; "the one guess this file has ever declined"
  is wrong — `window` and `directory` are declined too and both are structure-blind, so
  structure-blindness is **necessary and never sufficient**; the test comment said ark's second-best
  was 0.600 when it is 0.500; and the new CLAUDE.md figures named no commit, in the file whose own
  landmine mandates it. `gate.ts` also now engages the competing rule it states — *"a guess the verb's
  own board actually invites"* — which points the **other way** on this case.

  **Next**: widen the wire gate past one verb, counting what survives rather than what the gate emits.

- **The README is wired into the rhythm, so it stays true progressively rather than once.** The
  previous entry shipped `README.md` and put it in the Definition of done — which makes it a
  close-out chore and nothing more. Three places that decide whether a document survives were still
  missing it: the **read list** (a session arriving had no instruction to look at the one document
  that says where we are), the **close-out step** itself, and the **orchestrator-owned list** — so a
  parallel agent was free to edit it, which for a file whose tables are a claim about the *whole
  tree* is a collision waiting to happen, and one no single agent is placed to make correctly.

  The rule is now stated as what it is: **`CHANGELOG.md` is append-only history and `README.md` is
  current state, and they rot in opposite directions.** A changelog entry is wrong only if it was
  wrong when written; a status table is wrong the moment the code moves past it, and it goes on
  *reading* as current — which is the instrument-that-measures-nothing shape, one document over. So a
  row moves **in the commit that changes the thing**: ⬜ → 🟡 with the first code, 🟡 → ✅ only on the
  same evidence as any other "done" claim in this file (*a decision is not a delivery* — this repo
  has a milestone that read "delivered" for two sessions while one of its three verbs existed), and
  anything found broken goes to **Known gaps** with its measurement whether or not it gets fixed.
  Close-out is the backstop, not the mechanism.

  Two consistency fixes came with it, both of the kind this repo keeps finding: the README's own
  *"how this file stays true"* footer said **close-out** while the new rule says **progressively**,
  so the two documents would have described different obligations from day one — the
  two-honest-surfaces-that-disagree shape, caught before it shipped rather than after; and the
  README's **Next** and `CLAUDE.md`'s **Next action** are now explicitly one fact in two places, with
  the instruction to check them against each other.

  Documentation only. **The atlas moves anyway** — both files are indexed nodes and this commit joins
  the history. **Next** is unchanged: widen the wire gate past one verb, counting what survives.

- **The wire-gate exposure is closed, and not by fixing the wire gate.** The Next action was to widen
  ADR-0016's gate past one verb. Built both shapes and measured them first, which is what that action
  asked for — and the answer was to not ship either. Putting Placement's candidates into `openBoards`
  **closes the leak completely (3 boards decided → 0, best 0.000) and takes this repo's history layer
  from 175 drawn wires to 1** until the tier-6 deck is cleared, because Placement's candidates cover
  **74% of the nodes** (57% on hono). That is ADR-0016's entire payoff withheld from the verb it
  exists to serve, and the selector serves Companion *first*, so the reward would never arrive. The
  narrow variant — suppress only pairs with both ends on one board — keeps the layer and **does not
  close the leak**: best 0.750 against a 0.78 bar, under it by coincidence, because the decisive wire
  runs from an *off-board* seed. A gate whose correctness is a coincidence is not a gate.

  So the lever is the **disclosure record**, which ADR-0021 had already designed and declined to
  build. `Verb.decidedBy(graph, challenge)` is the mirror of `discloses`: that one says *what my
  reveal states*, this says *what would beat me*. Placement scores the co-change guess against its own
  answer key with the real scorer and the derived bar, declares `decidedFact(commit, seed,
  'coChange')` for each seed that reaches band A, and Archaeology — which generates later — **never
  offers that commit**. Off the board rather than a withheld sentence, in ADR-0019 decision 7's shape,
  because a candidate never offered cannot signal anything by its absence where a withheld class can.
  **3 boards decided → 0**, and the residual best of 0.750 is **bounded by the threshold by
  construction**, which is exactly what the coincidental 0.750 was not.

  It fires: **36 verdicts over 16 of this repo's 40 Placement boards, 22 over 15 of hono's 54** —
  counted before any test was written around it. It costs nothing: both Placement decks unchanged,
  and the Archaeology deck *grew* 33 → 36, because removing decidable commits from distractor pools
  changed which boards collide on `duplicateKey`.

  **ADR-0021's claim that ADR-0016 diverged from its own rule is withdrawn.** ADR-0016 scoped the gate
  to Companion boards deliberately, measured the Blast Radius case, and closed with *"re-measure if a
  repo's two decks overlap much more than this one's"*. Placement did not exist then. A decision
  correctly scoped to the verbs of its day is not a rule the code failed to implement, and calling it
  one was the heavier charge of the two.

  **And the e2e was predicting which board the shell would serve, four hundred lines from where that
  was already fixed.** `atlas.challenges.find(subject matches)` is *id* order — `archaeology-` sorts
  first — while the console serves a node's bucket in **tier** order; it passed while the two
  coincided and went red the moment a subject gained an Archaeology board, returning a board whose
  truth is commits so nothing matched and submit never enabled. The witness step below it has read the
  choice set off the screen since the last rung. Same file, same landmine, one step over.

  **Next**: the overlapping Companion answer keys, then a co-change distractor strategy for Placement
  — which would lower this exposure at the source rather than gating it.

- **Placement gets §8.3's best wrong answer, and it does not lower the exposure it was supposed to.**
  The Next action was a co-change distractor strategy for Placement — the one verb with no
  *historically-coupled-but-not-structurally* class, and the lever ADR-0022 named for closing its leak
  *"at the source rather than gating it"*. The strategy ships: a file the matrix records moving with a
  file the commit changed, that the commit did not change, ranked strongest coupling first. **98 wrong
  answers on this repo and 141 on hono**, where there were none. The upstream claim was measured
  first and it is **false here**. Holding the board fixed — same commit, same answer key, only the
  wrong answers differ — ADR-0022's verdicts go **26 → 27 on ark's 30 shared boards, falling on
  exactly none of them**, and 24 → 19 on hono's 40. The reason is structural rather than tuning:
  the guess is seeded at a file wired to a candidate, and **58% of this repo's deciding seeds and 68%
  of hono's are files the board never shows** (19 of 33 and 19 of 28), which a distractor anchored on
  the answer key cannot reach. The version that would reach them has to score the guess against the
  key to pick its wrong answers — which is `decidedBy` with a different return type, so *the upstream
  fix, executed, is the downstream gate wearing a hat*. **ADR-0022's gate stays, now measured rather
  than argued.** ADR-0023.

  **The mix is a budget and this one says who paid.** 0.05 each from `structural`, `treeSibling` and
  `nameSimilar` — §8.3's three anchors, in its own order of value — and **nothing from `busy`**, which
  is the counterweight to `gate.ts`'s `churn` heuristic and would have weakened a gate that refuses
  boards today. Measured: `busy` 244 → 242 here and 357 → 354 on hono, `ctrlF` refusals 4 → 5 and
  182 → 181. A middle row — the new mix with the strategy supplying nothing — is what separates the
  re-weighting from the picks, and it earned its place: hono's raw verdict total falls 28 → 20 on the
  **re-weighting alone**, which a naive before/after would have credited to the strategy.

  **The class is withheld**, on the refusal `blastRadius/reveal.ts` makes about the same relation.
  The sentence would be an existential over the answer key, and **52 of this repo's 98 rows hold a
  pair that is a member of a shipped Companion board's key** (29 of hono's 141) against the **11 of
  15** Blast Radius refuses the same relation at — 6.5× the rows and 4.7× the atoms of a class already
  refused at the smaller number. The argument the other way is stated rather than buried: Blast
  Radius's sentence is an *identity* where this one is an existential — except on a one-file key,
  where it collapses to one, 8 rows here and 25 on hono. Withheld by class, never by row. *(Blast
  Radius's own file recorded "3 of 12" from a commit it never named; re-measured and stamped here,
  which is the measured-constant landmine caught by needing the comparison.)* The cost is stated
  rather than hidden:
  `distant` ships 0 rows on both repos, so an unexplained row is now uniquely a co-change pick, which
  is paid on ADR-0019's line that a **stated** atom is refused where an **implied** relation is
  accepted.

  **The unit fixture had no co-change matrix at all**, so every assertion about the new class would
  have passed over an empty set — the degenerate-fixture landmine, arriving on schedule. It now
  carries four pairs, one of them to a file the commit *did* change, and every test counts the
  population before believing it. Four mutants killed, and one assertion was found reading `picked[0]`
  when `candidates` is sorted by id — an ordering claim asserting the id sort.

  **Also**: three documents still listed "the overlapping Companion answer keys" as open backlog. It
  closed at `01202ac`, where `companion/generate.ts` gained a generator-wide `claimed` set and a
  `pairsClaimed` refusal; ADR-0016's *"belongs to a later session"* now carries the CLOSED note with
  the measurement, and the sharp case was narrower than that paragraph guessed — symmetry, not
  overlap.

  **Next**: packaging **`npx ark`** (NORTH-STAR §10's stated intent, and the Definition of done has
  been unsatisfiable on it for four milestones), then the **phenomenon catalogue**, then **M5** — whose
  kill point still needs measuring before a parser is written.

- **Post-ship adversarial review of the above, and it found the argument rather than the code.** Six
  findings, every one in a category `CLAUDE.md` already names — which is the case for consulting on
  the categories rather than on the change. **Decision 2's impossibility argument was false**: it said
  a distractor anchored on the answer key *cannot reach* a deciding seed that is not adjacent to the
  key, and `partners(key) ∩ partners(S) ≠ ∅` does not need `S ∈ key`. Diffing the verdict facts the
  document's own control row isolates: **4 of the 6 verdicts the strategy removes on hono are seeded
  off the board**, the class the paragraph called unreachable. The measurement was right and the
  explanation nothing tested was wrong — in the paragraph the document spent the most effort on, which
  is the shape this repo has a landmine about and now has a sharper one.

  **The strategy was enforcing half of §8.3's class name.** *"Files that co-change **but don't
  import**"* — it consulted the matrix and never the graph, so **9 of this repo's 98 rows and 67 of
  hono's 141, 48% of the second repo's**, were graph-adjacent distractors wearing a purely historical
  label. Fixed: a partner with a direct import edge to a key member is refused. It cost **1 row here
  and 2 there** because supply was never the constraint, and it *strengthened* hono — verdicts 23 →
  **13**. Both new assertions were mutation-checked.

  Four more, all prose against tables: the **oracle-seed exposure the probe measured and the document
  did not print** (9 boards / best 0.909 → 0.923 here, the shape ADR-0021 rejected as "a strategy
  nobody can execute" — recorded because it bears on the central question and does not flatter the
  answer); the **map cost the withhold accounting omitted** (49 of the 97 withheld pairs are drawn as
  wires on 31 of 40 boards once the naming Companion board is answered, so the silence is narrower
  than "nothing is lost"); a **re-measurement that changed the instrument** — Blast Radius's
  co-change figures re-read pair-level as 11 of 15 where that file's own sentence says *"a member of
  **that** board's key"*, which is 7 of 15, the ADR-0019 landmine committed inside the fix for the
  one beside it; and *"5 of 24 over 2 of 10 boards"* fusing three different populations. The two
  unstamped figures one screen below in the same `WITNESS` map, whose denominators this change's
  re-weighting moved, are re-measured and stamped.

  **Next** is unchanged: packaging **`npx ark`**, then the **phenomenon catalogue**, then **M5**.

- **M5's kill point, measured — and the language that fails is not the one that fails to parse.**
  No production code: the deliverable is
  [ADR-0024](./docs/decisions/0024-a-language-ships-on-its-deck-not-on-its-map.md) and the numbers
  under it. Four repos, chosen for representativeness with the reasons written down *before* any
  measurement, spanning the axis that decides ADR-0003 resolution — how imports name their targets:
  flask `6a2f545b` (relative-heavy, the optimistic end), django `c9eb16a87e` (absolute intra-package,
  no JS analogue), cobra `adbc881` (the **correctly external** case, 93.7% stdlib), hugo `44da08608`
  (full-module-path internal). Imports were extracted with **each language's own parser** — Python's
  `ast`, Go's `go/parser` — so every figure is a **ceiling** tree-sitter would have to earn rather
  than a scanner's best effort. Three gates, because a probe that matches nothing reports 0/0 and
  looks exactly like a language that does not work: liveness against an independent crude count (677
  vs 695, 12,000 vs 12,099, 190 vs 200, 6,013 vs 6,151), a **partition** assertion that the three
  outcomes sum to the site count, and parse failures counted rather than swallowed (0 / 6 of 2,928 /
  0 / 0). The deck numbers come from ark's **real** generators through a scratch replay of `src/`
  which, with the replay off, produces a **byte-identical** atlas to production on `b9f4d33`.

  **Both languages resolve, and that was not the question.** Go 0.0% / 0.2% of import sites
  unresolved, Python 6.2% / 1.4%. Yet **flask ships 0 Blast Radius boards of 30 subjects and django
  16 of 976** — because ADR-0003's taint is *transitive*, so its cost is the unresolved rate **times
  the closure depth**. hono and django have near-identical direct taint, **3.8% and 3.3%**, and
  amplify by **1.55× and 21×**; django's mean dependency closure is **164.8** nodes against hono's
  **17.3**. Resolution rate is not the kill-point metric. Neither Python residue is parser-fixable
  either: **dist name ≠ import name** with no build-free mapping (`PIL`←Pillow, `yaml`←PyYAML) is 125
  of django's 170, and **import roots are a runtime `sys.path` fact** is the other 45.

  **Go ships at *package* granularity and only there.** At file granularity `treeSibling` — "same
  directory, not a dependent" — offers a same-package file as a wrong answer on 172 of hugo's 244
  boards, and **80 of those slots across 49 boards (20.1%) are verified wrong answer keys**: the
  sibling really does reference a package-level identifier the subject declares. Guardrail 4 cannot
  see it, because an intra-package reference is not an import and leaves no specifier to record —
  ADR-0003's safety rests on a sentence untrue outside JS. Python has the same class idiomatically
  rather than structurally: **562 string-named module dependencies on django, 3 on flask**. The first
  Go count was **153**, from a test that counted *method* names — those live in a receiver's
  namespace, not the package's, so `Close`/`Create`/`Write` matched across unrelated types.
  Restricting to package-level declarations cut it to 80; the looser test overstated by **91%**.
  Package granularity fixes the answer key, the fan-out and the budget at once: **1,955 nodes / 13.04
  edges-per-node / 16.2 s** (ark's own `budget.ts` warns; ceiling 10 s, at *under* reference scale)
  becomes **193 / 6.61**, and the invisible class is unrepresentable because the reference is inside a
  node. The alternative — intra-package cliques — reads 42,794 edges and 21.9 per node.

  **The defect that needed no parser, and is live on `master`.** Three documents said a Go or Python
  repo *"produces a map with no edges and no questions"*. The second half is **false**: cobra indexes
  to **17 nodes, all Markdown, and 48 challenges**; hugo to **1,049 nodes of which 1,016 are Markdown,
  and 144 challenges** — a confident, playable game about the repository's *documentation*, with no
  source on the map and `cli.ts`'s zero-challenge warning unable to fire. ADR-0024 decision 3 blocks
  any new language behind fixing it. The good news inside it: **three of four verbs are already
  language-agnostic**, so what M5 buys Python is a true map with the history deck attached to real
  code, not the import verb.

  **Step 0, and it was the bar M5 was about to be judged against.** `README.md` and `CLAUDE.md` both
  recorded ark at **2.66 edges/node** — including the very instruction to measure a new language
  against it. It reproduces **nowhere**: 2.57 at `0fac922`, the commit whose CHANGELOG recorded it,
  2.54–2.59 across the window, and under no denominator (code-only reads 3.25 there). Ark is **3.42**
  at `b9f4d33`; hono's 2.51 in the same sentence reproduces **to the digit** at `7075369e`, which is
  what made the ark half diagnosable. The error understated ark's density by 0.76, so a language
  scoring 2.7 would have read as *denser* than the bootstrap repo when it is 21% sparser.

  Also recorded in **Known gaps**, found and deliberately not fixed: **`npm run test:unit` has an
  undeclared dependency on `npm run build`** — 2 of 586 fail on a fresh clone because `serve.test.ts`
  serves `dist/player`, and CI has always been green because `ci.yml` orders `build` first. The
  testing table lists them as independent rows, which is what made this session read the red as its
  own doing and refute two hypotheses before reproducing it on a clean clone of `b9f4d33`.
  Verified: 586 unit + 99 atlas tests, byte-identical atlas, budgets inside ceiling, `npm run index`
  clean on this repo. No production code changed.

  **Next**: the **Markdown-map defect** (no parser needed, and ADR-0024 decision 3 gates M5 behind
  it), then packaging **`npx ark`**, the **phenomenon catalogue**, and **M5 itself — Go first**,
  because its verdict is unconditional where Python's is a smaller product than the roadmap implies.

- **Post-ship adversarial review of the above, and it found the instrument as well as the argument.**
  Six findings, every one in a category `CLAUDE.md` already names; all six independently reproduced
  before being accepted. **The headline leak number was wrong and its adjective was worse.** §6.1's
  *"80 verified wrong answers on 49 of 244 boards"* is **≤71 on ≤46 (18.9%)**, and "verified" is not a
  word it was entitled to: `refs_go.go` counted every `ast.Ident`, so the `Fs` of `afero.Fs` matched a
  subject declaring `Fs`, struct-field names and composite-literal keys matched, and **build-tag
  variants** matched their own declarations — `testenv_unix.go` and `testenv_notunix.go` legally
  declare the *same* package-level names, which **falsifies the uniqueness premise the fix was argued
  from**. The count went 153 → 80 → 71 across three instruments, and the middle correction shipped
  **inside the paragraph congratulating itself for testing the claim rather than the wording**, with
  three more false-positive classes untouched twelve lines away. *The bug you already fixed is still
  there, one line down* — in the showcase paragraph.

  **The Python causal story was half right and its revisit condition was actively misleading.** The
  document said the residue splits into two kinds — unrooted imports and the dist-name gap — and
  offered solving both as the thing that would change the verdict. There is a **third** kind it folded
  away, and that kind is the whole effect: **7 computed `import_module(<expression>)` sites out of
  django's 12,000**, in `django/conf/__init__.py` and friends. Solving roots **and** dist-mappings
  perfectly moves django from **84.0% to 83.7%** of blast-eligible subjects with a tainted closure;
  the computed sites alone produce 83.7%. **0.06% of sites taint 83.7% of subjects.** So decision 2 is
  *stronger* than the argument first given for it, §4 gains a §4.1, and the "what would change this"
  section no longer sends the next session to build something worth 0.3 points. Position beats rate by
  two orders of magnitude.

  Three more, all prose against tables. **`AtlasNode.kind` is `'file'`** — `schema.ts:92` — and the
  claim that the format "already" allowed `'dir' | 'symbol'` quoted **NORTH-STAR §7.1's sketch comment
  as if it were the code**, in a sentence asserting decision 1's schema cost was already paid; it
  needs an `ATLAS_VERSION` bump and a migration under guardrail 5. **Gating `treeSibling` would not
  close the Go leak**: read off the atlas's own witness tokens the 665 same-directory wrong-answer
  slots are `treeSibling` 389, `graphAdjacent` 129, `nameSimilar` 93, `coChange` 54, so gating it
  leaves **42% on the boards** — the rejected alternative's price flattered it, which is the direction
  that gets believed. And §7's pricing table **changes two knobs**, 13.04 being all-node and 6.61
  Go-only; held to one it is 28.13 → 6.61, so the printed pair *understated* the fan-out artifact by
  2.2×. Plus two arithmetic slips the tables themselves refute: "26 points" where §4 gives 22.0 direct
  and 16.9 closure, and "all within 3%" where cobra's liveness gap is 5.0%.

  **What survived attack, re-derived rather than assumed**: every row of §4's amplification table and
  §5's deck table to the digit — including that flask's 30 refusals are **all** `uncertain` rather
  than small-repo effects, and django's 949 of 976 likewise, so the closure story really is what
  refuses the deck; §8's Markdown-map figures on all four production atlases; §0's stale-baseline
  claim at every commit; and the harness's byte-identical inertness. **No decision flipped.**

  **Next** is unchanged: the **Markdown-map defect**, then `npx ark`, the **phenomenon catalogue**,
  and **M5 — Go first**.

- **One sentence of my own, corrected on a re-read: a live guard described as a dead one.** ADR-0024
  §8 and `README.md` both said `cli.ts`'s zero-challenge warning *"never fires"* — an unscoped
  universal where the measurement supports only *"did not fire on these four repos"*. It matters in
  the direction that gets things deleted: this repo has a landmine about paths that never execute
  being worse than no path, and a next session reading "never fires" could remove a guard that works.
  Checked against the code rather than from memory, it could not have fired for **two** independent
  reasons, and the second was not in the original finding at all: the predicate is
  `challenges.length === 0` (hugo's count is 144), **and** the branch sits on the `play` path only
  (`cli.ts:291`, past the `command === 'index'` return at :269), so `ark index` — every measurement in
  the document — never reaches it. Decision 3 must replace the predicate *and* lift it above the
  command split. `cli.ts:292–294`'s comment still asserts the "no edges and therefore no radius" claim
  §8 refutes; left in place deliberately, because it is production source and this session shipped
  none. **Next** is unchanged.

- **The Markdown-map defect, fixed: a deck is refused when the map is not a map of the repository**
  (**ADR-0025**, `ATLAS_VERSION` 8 → 9). `spf13/cobra` shipped **48 confident, correctly-graded
  questions about its README files** and `gohugoio/hugo` **144** about its docs tree; both now ship
  **0**, with the map, a count of what is missing and the reason. **315 questions withdrawn across 5
  of 11 repos**, every one of them correct and every one about the wrong repository. ADR-0024
  decision 3's precondition is met, so **M5 is unblocked**.

  **The signal is what the walk skipped, refined by language** — a third table beside `SCANNED` and
  `CARRIED`, and `report.unreadable` is a *refinement* of `skipped`'s `unsupported`, never a bucket
  beside it. **Both obvious alternatives were measured and both fail.** *No scanned-language nodes ⇒
  refuse* is wrong in **both** directions on one table: 24 and 45 stray JavaScript files ship hugo and
  django, the two worst offenders, while `sindresorhus/awesome` is refused for honestly being its
  Markdown. And `unsupported / onDisk` is refuted outright rather than merely beaten — refusing hugo
  needs a bar ≤ 58.7%, `awesome` sits at 69.6%, the sets overlap, **no threshold exists**.

  **The threshold came from the data only after the data refuted the version that came from the
  English.** Clause 2 was first *the map holds a **majority** of the source*, chosen because majority
  is the one value on `[0,1]` with a name instead of a number — and it **refuses `sveltejs/svelte`**,
  whose 4,462 `.svelte` files outnumber the 3,467 TypeScript files its compiler is written in. Mapped
  share of the ten repos clause 2 decides, sorted: 99.7, 99.1, 97.0, 95.7, 43.7 │ 2.5, 1.5, 0.0, 0.0,
  0.0 — `awesome` is the eleventh and is *also* 0.0%, which is why no bar on this axis alone can work.
  The bar is **one tenth**, in the middle of the only gap, ~4× clear on each side; a majority bar sits
  outside it, 1.14× from the nearest ship. The floor (**5**) is derived the same way over all eleven,
  from 1, 1, 1 │ 27, 36, 84, 136, 920, 1,042, 2,930, 4,462.

  **Both clauses were justified by the row each one alone gets wrong**, which is a stronger test than
  asserting both halves: clause 1 alone is wrong on react, next.js and svelte; clause 2 alone is wrong
  on `awesome`; together, zero errors on eleven. On the eight repos first in hand clause 2 flipped
  **no** verdict at all and would have read as decoration — react and next.js are why it exists.
  Mutation-tested: zeroing the floor reddens the two clause-1 assertions and no clause-2 assertion,
  and restoring the majority rule reddens the two clause-2 assertions and no clause-1 assertion.

  **The guard is fixed rather than deleted, both halves of it.** It moved above the `command ===
  'index'` return, so `npm run index` and `scripts/budget.ts` reach it for the first time, and its
  predicate is the refusal rather than `challenges.length === 0`. The old predicate is **kept as a
  second branch** and checked live: a one-file repo with no history reaches it, prints its own note
  and is not refused. `cli.ts`'s "no edges and therefore no radius" comment is gone with the branch
  that carried it.

  **The refusal creates a second cause for a number, and two panels had already merged them.** The
  guide said *"every question answered"* over a repo that was never asked one, and the HUD said it
  again 141 lines down the same file, in different words off a different variable. Both repaired from
  one value — and grepping the rest of the player for readers of an empty deck found a third, the
  field notes' *"answer a question and what you establish is written down here"*, which invites an
  action a refused repo does not have.
  What is missing is now said **on the map with no threshold at all** (`1 source file not on this map`
  here, `920` on hugo): labelling and refusing are separate mechanisms with separate triggers, and one
  sentence in `src/atlas/coverage.ts` serves the terminal and the player so they cannot drift.

  Refusing is also **cheaper** — generation is skipped, not run and discarded — so hugo indexes in
  4,328 ms against 4,829 and django 3,621 against 4,042, and their atlases shrink by 150 KB and 79 KB.
  A shipping atlas pays **+60 bytes**, bounded by languages rather than files.

  **Next**: **M5 — Go first**, unblocked and with its kill point decided (package granularity,
  `ATLAS_VERSION` bump with a migration under guardrail 5); then `npx ark`, then the phenomenon
  catalogue. Three narrower gaps replace the old one in `README.md` with their measurements: a non-JS
  repo's source is still not on its map (that is M5), `UNREAD` omits ambiguous extensions on purpose
  so an Objective-C repo still slips through, and the bar is a tenth rather than a majority so svelte
  keeps its deck with 4,462 files absent.

- **Post-ship adversarial review of ADR-0025, and the headline finding is that the fix was a list.**
  Ten findings, all independently reproduced before being accepted; four were prose contradicting a
  measurement in the same change. **The one that mattered was the defect still live in production:**
  `terraform-aws-modules/terraform-aws-vpc` — 77 `.tf` files, 24 Markdown — indexed to **25 nodes and
  64 challenges over nothing but documentation, with `report.unreadable` empty**, so every surface
  ADR-0025 added was silent. Three commits after the fix, on a repo nobody had tried. `.tf` is not
  ambiguous and no decision excluded it; it was not on the list. `UNREAD` gains Terraform, Emacs Lisp,
  Nix, Vim script and Protocol Buffers — the eleven repos' verdicts are **unchanged in every cell**
  and tfvpc is now refused — and the Known-gaps row says the true thing instead of the flattering one:
  **a list has a failure mode a rule does not.**

  **A mainstream repo sits in the band the ADR called empty.** `prometheus/prometheus` is 249 mapped
  against 747 unreadable — **25.0%**, inside the 2.5 → 43.7 gap — and ships 48 Blast Radius boards
  about the React UI of a Go time-series database. The bar does not move; *"there is none in this
  set"* was a fact about the set, and the first repo cloned to test it landed in the middle.

  **Three player surfaces had no test, and the review proved it rather than asserting it** — reverting
  the guide's refusal branch left 606 unit tests, 102 atlas tests and the build green with the panel
  back to *"every question answered"* over a refused deck. `vitest.config.ts` has no DOM, so a
  sentence assembled in a callback is unreachable by the fast suite; the three forks moved to
  `src/player/empty.ts` and both mutations are now caught.

  Corrections with the wrongness named rather than smoothed: svelte's 3,467 files are **JavaScript**
  (3,382 `.js`, 84 `.ts`, 1 `.mjs`) in six documents; a `toLowerCase()` at the `UNREAD` lookup
  reported `.C` — C++ by convention — as **C**, which is the one cost decision 5 refuses, so the fold
  is gone and upper-case spellings are rows; three `unreadable` entries cost **118 bytes**, not 60;
  the floor mutation reddens **three** assertions, not two; hugo's post-M5 map is ~193 **package**
  nodes, not 930 file nodes; and §6's header claimed four surfaces share one composed sentence when
  the fourth writes its own.

  **Next** is unchanged: **M5 — Go first**, then `npx ark`, then the phenomenon catalogue.

- **Three loose ends from the review, and one of them is a correction to this file's own testing
  table.** The table's `test:e2e` row said *"Big changes only — **ask first**"*, which is an
  instruction to the agent; a session read it as a statement that the suite had not run and told the
  human **three times** that e2e was outstanding and awaiting their decision. `ci.yml`'s `player
  smoke test` job **is** `npm run test:e2e` and runs unconditionally on every push, so the Definition
  of done's *"no console errors in the player"* had been satisfied continuously by a job nobody
  opened. The row now says so, and the landmine is that **a rule about your own behaviour is not a
  fact about the project** — the same shape as *"list the workflows before you claim they passed"*,
  run in reverse.

  The review's tenth finding is recorded rather than fixed: the `UNREAD` tally runs *before* the size
  and binary checks, so a 2 MB Go file counts as unreadable source while a 2 MB TypeScript file
  counts as neither. The bias runs toward refusing, it flips **no verdict on any of the thirteen**,
  and the alternative is worse — moving the tally after those checks would make a large Go file
  invisible, which is the defect ADR-0025 exists to stop. ADR-0025 §9.3.

  And *"2 of 617 on a fresh clone"* is now measured rather than inherited: cloned from the remote at
  `fb68c7f2`, `npm ci`, `npm run test:unit` with no build → **2 failed, 615 passed**, both in
  `serve.test.ts`. The first attempt at that measurement cloned the *local* repo and landed on
  `412cb18` because this machine's `master` ref was months stale — an ancient tree answering a
  question about the current one, caught only because its `package.json` still said `vitest run`.

  **Next** is unchanged: **M5 — Go first**, then `npx ark`, then the phenomenon catalogue.

- **Two small gaps closed before M5, and neither turned out to be the fix it looked like.**
  `npm run test:unit`'s undeclared dependency on `npm run build` is gone: `serve.test.ts` served
  `dist/player`, so three of its cases needed a build that the testing table never mentions. It now
  writes its own temp directory. Measured both ways — a clone of `fb68c7f2` fails **2 of 617** with
  no `dist/`, the fixed tree passes **617 of 617** with `dist/` moved aside — because "it should work
  now" is the claim this repo keeps catching itself making.

  **`RevealNote.route` is deleted, not rendered**, and the reason is the interesting half. The gap
  read *"infrastructure with no consumer"*, which invited wiring it up; the console never drew it
  because **`whyYes` already spells the chain into the note the console does draw** — *"reaches the
  subject in 2 hops through src/a/direct.ts"*. Rendering it would have put one fact on screen twice.
  Three tests asserted the field, and two of them — Companion's and Placement's `route: []` — were
  really claiming *a history-graded verb shows no import evidence*. **An empty array could never have
  caught that**: a verb could put a chain in the prose and leave the array empty, and the assertion
  would pass. Both now assert the sentence, and a mutation adding *"reaches it in 2 hops through
  src/x.ts"* to Companion's prose is caught where the old test slept through it.

  **Next**: **M5 — Go first**, unblocked and with its kill point decided; then `npx ark`, then the
  phenomenon catalogue.

- **ADR-0021's accepted exposure came due, and the canary it shipped is what caught it.** That ADR
  held Archaeology's structure-blind `sibling` hint *below* the Ctrl+F bar rather than closing it —
  a per-commit union of **0.769** against 0.78, a margin of **0.011**. Ark indexes itself, so an
  ordinary commit (two test files and a comment, nothing near the deck) re-rolled the Placement deck
  and the union reached **0.800** at `1220b9b`. The old canary's closing line had named the remedy
  three milestones in advance: *gate it, or withhold the class.*

  **Both cheaper guards were measured and both are refuted.** By board — where ADR-0021's own
  post-ship review left this, on the finding that every firing was visible to a single board — cannot
  bound it: the best single board reaches **0.667** and the 0.800 is the union of **three**.
  Narrowing the class to the subject's exact directory scores **0.800 too**, because the subject sits
  in a leaf directory and subtree and directory are the same set. ADR-0020's escalation therefore
  runs out at *by class*, and `WITNESS.sibling` is removed.

  **The price is 171 of this repo's 626 spoken witness rows and 101 of hono's 734 — and no deck
  change whatever.** No generator calls a reveal, so the wrong answers are still on the boards and
  every question still ships; what is gone is the sentence saying why. The scary-sounding 27% was
  counting rows in the wrong ledger, and it is the reason two cheaper guards got hunted first.

  The canary now asserts the **silence** — every `sibling` row unspoken, over a non-vacuous population
  of 20+ rows — which is stronger than a score under a threshold because there is no bar left to drift
  across. Mutation-checked both ways: restoring the class reddens the atlas canary and the unit test;
  a deck that stopped picking the class reddens the vacuity guard. The subtree set-size guard went
  with the class it guarded; the mechanism is still live for `adjacent` and `partners`.

  **Next**: **M5 — Go first**. The two small fixes of #32 rebase on top of this.

- **M5, Go half: a node is a package, and the parser is hand-rolled.** ADR-0024 decided the
  granularity and left two things unmeasured; both are now measured and the second changed a
  north-star answer. **The parser.** NORTH-STAR §7.2 says *"v2: tree-sitter"*, so tree-sitter and a
  hand-rolled scanner were run over the same corpus with a gate proving each returned something:
  **both find 6,013 import sites on hugo and 190 on cobra — the same counts ADR-0024 got from Go's
  own `go/parser`** — and disagree on **no file at all** out of 942, and on none of seventeen
  adversarial fixtures. tree-sitter is **6.2× slower** (1,619 ms against 261 on hugo, against a 10 s
  index budget) and would be this project's **first runtime dependency**, 8.8 MB installed against a
  `package.json` with no `dependencies` key at all. So it is refused **for Go**, on the measurement,
  and the condition that reverses it is written down: a language where the two disagree on real
  files. **The granularity.** hugo is 906 Go files beside 23 JavaScript ones, so one atlas holds both
  kinds of node and every derived field needed an answer — `churn` counts a commit **once** per
  package rather than once per file, `lineage` is contested if any member is, and a `dir` node's
  `originPath` is the plurality of its members' origin directories, because **git records renames of
  files and never of directories**. That last rule needed the throw removed: two nodes proposing one
  origin is a package *split*, an ordinary refactor, not a corrupt repo.

  **The class the granularity was bought for is gone, and it was checked rather than assumed.**
  ADR-0024 §6.1 measured up to 71 wrong answer keys across 46 of hugo's 244 file-granular boards,
  from `treeSibling` offering a same-package file as a wrong answer to an edge Go writes no import
  for. Measured on the shipped indexer: **0 same-package distractor slots on hugo's 156 boards, on
  prometheus's 63 and on cobra's**, no directory producing two nodes on any of the three, and **0
  violations of ADR-0008's `candidates ∩ dependents(subject, ∞) = truth`** across 187 Go boards.
  hugo: **193 packages, 1,275 Go edges, 6.61 per package — ADR-0024 §7's prediction to the digit**,
  now from the shipped code rather than a shim; **6,733 ms against 16,194** at file granularity, and
  a 1,337 KiB atlas against 3,804. Every Go repo's atlas is byte-identical across two runs.

  **ADR-0025's rule compared a count of nodes with a count of files**, which was exactly right while
  every node was a file. `AtlasNode.fileCount` fixes it and the validator pins
  `kind === 'file' ⇒ fileCount === 1`, so a JavaScript repo's numerator cannot drift. Re-measured:
  hugo **2.5% → 98.5%** and cobra **0.0% → 100.0%** flip from refused to shipping, **456 and 59
  challenges** where ADR-0025 withdrew 144 and 48; `prometheus/prometheus` — the repo ADR-0025 §9.2
  named as sitting inside the band it had called empty, shipping *"48 Blast Radius boards about the
  React web UI of a Go time-series database"* — now ships **35 of 63 about Go packages**. The other
  rows cannot move, and that is a proof rather than a re-measure: adding a language to `SCANNED`
  strictly increases the mapped share, so **no repo can go from shipping to refused**.

  **The bootstrap fixture and the third-party control did not move.** Old indexer against new on
  clean clones of ark `837970f2` and hono `7075369e`: `challenges` **byte-identical** (160 and 216),
  and nodes minus the new field, edges, regions, history and report likewise; the field costs +0.72%
  and +1.01% of the atlas. `ATLAS_VERSION` 9 → 10, reindex required.

  One thing found on the way, and it is the `.first()` landmine with a new face: **the e2e's
  board-playing step predicted a verb**. It asserted Blast Radius's wording over anything that was
  not Companion, and matched the board with a map covering only half of `AtlasId` — so when this
  change re-rolled ark's own deck onto an Archaeology board it reported the wrong prompt and then hung
  30 s on a Submit that was correctly disabled. Both the map it needed and the comment describing the
  mistake were already in the file, 300 lines up. A third bug sat under those two: `innerText` returns
  **rendered** text, so `commitLabel`'s double spaces arrive collapsed and a commit row can never
  equal the string the code built — invisible on three verbs out of four. The suite now plays an
  Archaeology board end to end, which it never had.

  **Next**: M5's Python half — ADR-0024 decision 2 makes it a *history* language, the map and the
  three git verbs and never Blast Radius, which is a smaller product than the roadmap implies and
  needs its own measurement. Then `npx ark` packaging, then the phenomenon catalogue.

- **A post-ship adversarial review of the above, and it found a wrong answer key.** Two of the three
  checks ADR-0026 shipped with read `atlas.json` — and the defect ADR-0024 §6.1 is *about* is a
  **missing edge**, which no atlas-derived check can see. The instrument that is not vacuous reads
  the repo's **source**: does a candidate marked wrong contain an import naming the subject's
  package? Answer: **2 of prometheus's 34 Go boards**, including one where the candidate's
  `server.go:23` reads `writev2 "github.com/prometheus/prometheus/prompb/io/prometheus/write/v2"` and
  the subject *is* that package. Cause: `documentation/examples/remote_storage/go.mod` `require`s its
  own repo's root module with no `replace`, so matching only the **nearest** module fell through to
  that require list and called the import external. *Whose repo is this path in* and *which `go.mod`
  carries the requires* are different questions; a specifier under any module declared in this repo
  now resolves against it, longest path first. **2 → 0**, and prometheus gains an edge and a board.

  **The sentence excusing a mechanism from inspection was the one to check.** §2.1 closed with *"no
  Go repo in this set moved a package inside the retained commit window, so this is argued from the
  mechanism rather than from a repo where it fired."* Measured: **69 split origin votes across 316
  packages, 15 of them ties** — `hugolib/versions` splitting 1–1, `langs` 2–2 — plus the collision
  fallback firing. A byte-order tie-break had been deciding real node identities, and the loser wins
  the moment either side gains a file, which changes the id and drops the player's saved passes. It
  is a **strict majority** now, which cannot tie; 7 of hugo's and 28 of prometheus's packages keep an
  inferred origin and they are plainly real moves (`resource` → `resources`, `pkg/rulefmt` →
  `model/rulefmt`). Two guards had mutants that **survived** the first suite and now have tests; a
  third turned out to be a no-op on every input and is deleted.

  **Adding `.go` to `SCANNED` moved its oversized files out of every tally there is** — no longer
  `unreadable` (right) and never `unsupported` (they are `tooLarge`), so invisible on both sides of
  ADR-0025's ratio *and* unparsed. Harmless while a node was a file; a silent missing edge once a
  node is a directory, because the package survives without its member. ADR-0025 §9.3 had named this
  as the dangerous direction. `WalkResult.dropped` now carries them and the owning node is marked
  `unresolved`, so guardrail 4 refuses instead of guessing. It fires zero times on the three repos
  and is fixed anyway.

  **Deliberately not fixed, and recorded instead: the player calls every Go package a "file"** — on
  all 153 hugo and 34 prometheus Go boards, and cobra renders its root package as `.` in a prompt.
  `Verb.prompt` has no atlas, so the fix is a contract change across four verbs and the console, and
  wording belongs to the verb rather than the console that would be the cheap place for it. The
  boards are correct; the noun is not. `README.md` Known gaps, with the counts.

  And a **third** e2e defect of the same family, found only by reproducing the CI merge commit before
  pushing: the field-notes step selected its note with `claims.find(t => t.includes(subject))`, which
  also matches a note about somebody *else* that lists this subject among its members. On the merge
  tree — a different commit, a different deck — it picked a note for `tests/unit/placement.test.ts`
  and compared its count against this challenge's key. The comment two lines above it already said
  *"find the note by its subject, never by its position"*; **a substring is a position.** A fourth
  followed it, in the Archaeology step, whose predicate had two substring traps in one `and`:
  `claim.includes(subjectPath) && claim.includes('commit')` matched a *Blast Radius* note because the
  subject was among its members **and** because that note's own subject was `src/verbs/commits.ts`.
  One `claimAbout` helper now serves all three steps. Both defects were reachable only on the merge
  commit, and both would have been a red CI.

  **Next**: the noun, then M5's Python half — a *history* language, the map and the three git verbs
  and never Blast Radius (ADR-0024 decision 2), scored against tree-sitter the way Go was.

- **A board is asked in the noun its members actually are.** ADR-0026 shipped Go at package
  granularity and left the player calling every package a *"file"* — *"A breaking change lands in
  `hugolib`. Which of these **files** depend on it?"*, where `hugolib` is 95 of them. The boards were
  correct; the noun was a false claim about the reader's own repo, which is the cost ADR-0025
  decision 5's whole mechanism exists never to pay.

  **`Verb.prompt` has no atlas**, so it cannot tell a package from a file, and the cheap fix — put
  the sentence in the console, which does — is what ADR-0020's landmine forbids. So the caller
  supplies the **fact** and the verb keeps writing the **sentence**: `Words` carries a label, a
  set-to-noun function and the repo-wide noun. It takes a *set* because a verb's sentences count
  different populations and only the verb knows which — Archaeology's question is about commits while
  its instruction is about its subject (*"inside this package's lifetime"*), and one noun per board
  would be wrong about one of them on every Archaeology board a Go repo ships.

  **A mixed board is the majority, not a fallback**, which is what decided the vocabulary: 151 of
  hugo's 156 Companion boards and 118 of its 121 Placement ones hold packages *and* files, because a
  commit touches both. So there is a fourth word and it is one the product already owns — **place**,
  from ADR-0018's *"a subject is a place or an event"*. `truth` sets are much more uniform (Blast
  Radius's are **100%** on both repos: only Go imports Go, so a package's cone holds packages), which
  is why a note carries two nouns and can honestly say *"you proved 4 packages"* out of a population
  of *places*. `.` now reads as `. (the root package)`, one label rule rather than a display
  exception.

  **All 160 of ark's prompts and 216 of hono's are character-identical to before** — every node there
  is a file, so every noun resolves to the word that was hard-coded. The first run of that comparison
  was a **vacuous pass**: both sides were the same v9-validator error, because the atlases predated
  ADR-0026's bump. It gates on 160 and 216 rendered rows now. And the atlas test written to guard the
  wording went red on a *filename* — `0026-a-go-node-is-a-package-….md` — which is this repo's own
  substring-is-a-position landmine, in the assertion written to check for false claims; it reads the
  noun slot now, not the sentence.

  **Next**: **M5's Python half** — a *history* language, the map and the three git verbs and never
  Blast Radius (ADR-0024 decision 2), scored against tree-sitter the way Go was (ADR-0026 decision 1).

- **M5's Python half: mapped and never graded.** ADR-0024 decision 2 decided the shape a session
  ago — Python is a *history* language, the map and the three git verbs and never Blast Radius — and
  left the mechanism open. There was no concept in this codebase of an **edge that shapes the map and
  cannot grade a question**, and there had to be: ADR-0024 §5 says what M5 buys Python is *"a true
  map with the history deck attached to real code"*, and a true map means layout, regions and
  elevation derived from real imports.

  **The mechanism is a predicate split, and the trap was live before a line was written.**
  `canImport` had exactly two readers and they were asking different questions —
  `blastRadius/generate.ts` asks *may this be a subject or a wrong answer?* and `coverage.ts` asks
  *is this mapped source?* Same question for TypeScript and Go; opposite answers for Python. Leave
  `py` out and `mapped` reads **0** on a pure-Python repo, so ADR-0025 clause 2 refuses the deck
  anyway *and* the HUD prints **"None of this repository's 84 source files are on this map"** over a
  full map of 83 Python files — the false-claim cost ADR-0025 decision 5 exists never to pay. Put it
  in and Blast Radius ships the deck ADR-0024 measured as dead. So `GRADED_IMPORT_LANGS` is the
  strict subset, it gates the **subject** as well as the candidate pool, and it refuses by *language*
  rather than by taint — because 30 of flask's 32 subjects and 819 of django's 976 would be refused
  by guardrail 4 anyway, and leaving it there would make *whether a language has a deck* depend on
  how dynamic one repo happens to be.

  **Tree-sitter was scored again, as ADR-0026 decision 1 obliges, and Python was the language most
  likely to flip it** — `from . import x`, `from ..pkg import y`, parenthesised lists, `\`
  continuations, four string prefixes, triple quotes, and no *imports come first* rule to bound the
  scan. It did not flip: **675 sites on flask and 12,052 on django from all three instruments**
  (tree-sitter, the hand-rolled scanner, and Python's own `ast` where it can parse), **0 of 3,011
  files disagreeing**, 7.1× faster, no runtime dependency. flask's 675 + 2 computed sites is
  ADR-0024 §3's 677 to the digit, and django's 12,000 reconciles as 11,991 `ast` statements + 9 call
  sites. Two languages scored, two refusals; a third coming out level is the point at which
  NORTH-STAR §7.2's *strategy* needs rewriting rather than another exception.

  **Which instrument found which defect is not what the table implies.** The comparison harness
  needed **three** corrections before it agreed and every one made *tree-sitter* look wrong; the one
  real scanner defect was found by **`ast`** — django imports a model called `Héllo` and JavaScript's
  `\w` is ASCII-only even under `/u`, so the name was dropped in silence, one file in 3,011. A
  **second** defect was found by neither, because no file in either repo exercises it: a
  backslash-continued `from pkg import \` read as an import of nothing, caught by a unit fixture,
  and re-running the whole comparison after the fix changed **no** file on either repo.

  **The kill point was re-measured with the shipped instrument rather than inherited, and the
  verdict held harder.** django resolves at **99.1%** where ADR-0024's probe got 98.6%, and the share
  of blast subjects whose closure is tainted moves **84.0% → 83.9%**. flask goes 6.2% → 4.87%
  unresolved and 93.3% → 93.8% tainted. Position beats rate, now confirmed by two instruments that
  disagree about the rate and agree about the deck. flask ships **118** challenges (0 blast) against
  ADR-0024 §5's predicted 118, and django **358** against its 374 minus the 16 blast boards decision
  2 withdraws.

  **All five repos ADR-0025 refused now ship** — Go returned hugo and cobra, Python returns django,
  flask and `system-design-primer`, the row that document called *"the one where a reasonable person
  could disagree"*. None of the 315 withdrawn questions came back; the five ship **1,048** questions
  about their own source instead. Everything else is byte-identical: **ark, hono, hugo, cobra and
  prometheus keep every section** — nodes, edges, regions, history, report *and* challenges — with
  only the `ATLAS_VERSION` 10 → 11 integer moving, which costs zero bytes.

  **A budget breach, said out loud**: `django/django` indexes in **16.3–17.7 s at 3,035 nodes**
  against a 10 s ceiling. It is not the Python scanner (1.1 s) — the force-directed layout is 6.9 s,
  39%, the same share as hugo's at half the scale. `README.md` Known gaps has the phase breakdown.
  And two testing lessons went into the landmines: a corpus of 3,011 real files does not replace
  adversarial fixtures **in either direction**, and the first draft of *"a Python repo ships no Blast
  Radius board"* passed **vacuously** — a five-file fixture has too few candidates to build a choice
  set in any language, so it now builds the same 19-file shape twice, in `.py` and in `.ts`, and
  asserts the TypeScript half ships boards.

  **Next**: packaging **`npx ark`** — NORTH-STAR §10's stated intent, unbuilt for five milestones,
  and the one item in the Definition of done nobody can literally satisfy.

- **`npx ark` is a script, not a checkbox.** NORTH-STAR §10 has sold the indexer as *"ships as `npx
  ark`, zero install friction"* since M0 and it had never worked: `package.json` had no `bin`, and
  `build` typechecks the indexer with `--noEmit` rather than emitting it. That part is ordinary
  unfinished work. What is not ordinary is that **the Definition of done listed it as a box to
  tick**, for four milestones — and a session ago it was *corrected* to say "this has never worked",
  which is honest and left the list one item shorter and still unverifiable. So the fix is not that
  the box became tickable. **The box is a script**, `npm run test:pack`, and CI runs it.

  **Three of the four changes were found by packing the tarball and running it, not by reasoning.**
  npm installs a `bin` as a **symlink**, so `pathToFileURL(process.argv[1]).href ===
  import.meta.url` — correct in every mode this repo had ever run — is false for every *installed*
  copy: `main` never runs, nothing prints, and the process exits **0**, which is a packaged CLI that
  looks like it worked and writes no atlas. And `PLAYER_DIST` was the bare relative `'dist/player'`,
  so `ark play ~/your/repo` looked for the player in **your** working directory. Both resolve
  properly now — `realpathSync` on both sides of the entry test, and the package root found by
  walking up to the nearest `package.json`, which is `src/indexer/` → the repo from source and
  `dist/cli/indexer/` → the installed package from the emitted tree. One rule, both modes.

  **The check is mutation-tested and its fixture's size is a gate.** Remove `bin`, remove
  `dist/player` from `files`, restore the naive entry-point compare, restore the relative
  `PLAYER_DIST` — each goes red. And the first fixture was four files, which indexes to a perfectly
  valid atlas with **zero** challenges, so asserting nodes and edges alone would have passed with
  the whole of `src/verbs/` missing from the tarball; it is a hub with nine dependents over five
  commits now, and asserts a real deck.

  **What is done is the packaging; what is left is the name.** `ark` collides with *ARK: Survival
  Evolved*, ARK Invest, ark.io and KDE's `ark`, and NORTH-STAR's own header says to check npm before
  anything public — so `private: true` stays and the documents say *"pack it and install it"* rather
  than `npx ark`. Writing the registry command into a README before that decision would be this
  session's own defect committed again, one layer out. Verified past `test:pack` the way a reader
  would: `npm pack`, `npm i -g`, then `ark index` and `ark play` from an unrelated directory.

  **Next**: the **duplicate-answer-key twins** — `cone(A) = cone(B)` is a true derived fact that by
  ADR-0011 decision 3 must be *shown* and never proved, so it wants a decision about where before
  any code, and it wants the count of how many twins each repo actually has first.

- **The Python half's post-ship review: the blind spot was in the arm the ADR was proudest of.** An
  adversarial pass found ten things; the two that mattered are both ADR-0028's decision 6 — *"every
  import site that does not place leaves something on `unresolved`"* — which is the sentence §1.1
  leaned on hardest.

  **`IMPORT_CALL` matched `importlib.import_module(` and missed the bare `import_module(`** that
  follows `from importlib import import_module`, which is **django's house style**: **79 call sites
  where 9 were recorded**, 49 missing taints and **30 missing edges**, including three real ones into
  `django/conf/locale/*/formats.py`. `django/apps/config.py` — the app-loading heart — carried six
  invisible sites and shipped with `unresolved: []`. Two things hid it: flask's two computed sites
  are `__import__(`, which the old regex *did* match, so the control repo passed; and **ADR-0024's
  probe used the same prefixed shape**, so §4's probe-versus-shipped agreement was two instruments
  sharing one blindness. And the missing unresolveds **flattered the rate**, so the sentence *"the
  shipped resolver is better than the probe that decided the verdict — 99.1% against 98.6%"* was
  manufactured by the defect it was hiding. Corrected: **1.42% unresolved against the probe's 1.4%**,
  and the deck number that decides M5 is **83.7% against 84.0%** — the same conclusion, taken level
  rather than ahead.

  **`fromTarget` could return an empty list** — a namespace package whose imported names are not
  modules placed nothing at all — and `build.ts`'s loop turned that into silence. The absolute branch
  guarded it and the relative branch four lines up did not.

  **Four legal statement forms the corpus does not contain**: `from a.b import(c)`,
  `from x import*`, `from a . b import c` and `if True: import os`. Zero instances in flask or
  django, so the 3,011-file comparison could not see them — and `import a . b` read as an import of
  `a`, a *wrong* target rather than a missing one. That is §1.1's own lesson arriving a second time.

  **A rule that lived twice had already diverged**: `docs/atlas-format.md` §3.6 and ADR-0028 both say
  a choice set is `GRADED_IMPORT_LANGS`, and `tests/atlas/` — the only integration test of that
  contract — still asserted the wider `canImport`. Unreachable on ark, which has no Python.

  **Ancestor `__init__.py` edges are now a decision rather than an omission.** Python executes every
  parent package on import, and §3's own argument for the submodule rule condemns dropping them.
  Priced — flask +7 pairs, **django +5,221 (×1.51)**, 3.35 → 5.07 edges/node — and **refused**,
  because every Python file transitively imports something under `django.`, so `django/__init__.py`
  becomes a node whose cone is the repository: true, true of every Python repo equally, and it would
  decide elevation, regions and layout. ADR-0026's objection to Go's clique edges, at a smaller
  multiple.

  Also: `git+https://…` parsed as a distribution called **git**, which would have called
  `import git` external and *removed* a taint; §6 divided one instrument's numerator by another's
  denominator and called the layout 39% (it is ~40%, and every figure there is now a range, because
  this container's spread is ±25%); and a doc comment describing `eligibleRefs` was left stacked on
  `ungradedRefs`. **ark, hono, hugo, cobra and prometheus are byte-identical throughout.**

  **Next**: the **duplicate-answer-key twins** — measured across five repos and **more common than
  anyone assumed**: 5 classes over 11 nodes on ark (15.5% of subjects with a cone), 8 over 33 on
  hono, 22 over 93 on prometheus (**32.3%**, largest class 25 — `discovery/*`, all interchangeable to
  the import graph). It earns a surface; what it needs first is the leak measurement, because naming
  a twin hands over the *non*-dependents a player already certified on its sibling's board.

- **The twins: measured, decided, and deliberately unbuilt.** `README.md` has carried *"duplicate
  answer-key twins are never mentioned to the player"* since M2 with the note that it *"needs a
  decision about where it is shown before any code"*, and nobody had taken the measurement that would
  decide it. **[ADR-0030](./docs/decisions/0030-a-twin-is-named-once-its-whole-class-is-cleared.md)**
  takes it.

  **The hypothesis the row was written under is wrong.** *Two on ark and none elsewhere* would have
  justified closing it as not worth a surface; measured, **15.5% of ark's blast-eligible subjects are
  in a twin class, 15.2% of hono's, 8.6% of hugo's and 32.3% of prometheus's** — whose largest class
  is **25** interchangeable `discovery/*` packages, every plugin behind one registry. And it is one of
  the better things this repo has to say: `cone(A) = cone(B)` is the *import graph's* version of
  NORTH-STAR §2's *"secretly one module wearing two hats"*, and a stronger claim than co-change's —
  not *these move together* but *nothing downstream can tell these apart*. ark's own best is
  `src/atlas/{coverage,serialize,graph}.ts`, cone **95** of 160 nodes, because all three go through
  one barrel.

  **Naming a twin is a Ctrl+F-grade leak, and not in the direction anyone looks.** The obvious worry
  — A's key hands over B's — is *impossible by construction*: ADR-0012 tiles the windows so
  `truth(A) ∩ truth(B) = ∅`, and ADR-0008's invariant keeps every unsampled dependent off the board,
  so `truth(A) ∩ candidates(B) = ∅`. Measured across four repos: **0 overlaps**, the gate saying the
  proof describes the code. The leak runs through the **wrong** answers — a passed board certifies its
  distractors as non-dependents of the twin as well — and scored with `scoreSet` it eliminates a mean
  of 7.5–13 of 20 candidates and **decides 4 of the 12 twin pairs that could carry it**, best
  **0.923** against a 0.78 bar. So the rule is ADR-0020's, by class: *name a class only when no member
  of it still carries an unanswered board*, gated on **answered** rather than passed (guardrail 6: a
  wrong answer still sees the reveal), in the inspector and never on the map, in ADR-0011's *revealed*
  register.

  **What the gate leaves is counted, not assumed** — ADR-0016's vanishing-wires lesson met from the
  other side, and it runs the opposite way: nothing is promised and withdrawn, the fact **arrives** as
  boards are answered. 0 of ark's 11 members are nameable at the first frame and all 11 eventually;
  hono 24 of 33 and prometheus 51 of 93 are nameable immediately, because their classes carry no board
  at all.

  **No surface was built and the ADR says so in its status line.** *A decision is not a delivery* —
  this repo has a landmine about a milestone that read "delivered" for two sessions while one of its
  three verbs existed. What is decided is where, under what gate, and in what register; what is
  unbuilt is the inspector line, the gate's wiring and its tests.

  **Next**: build it.

- **Prep for going public.** The trigger is GitHub's 2,000 CI/CD minutes, free for public repos —
  and the first thing worth doing was measuring where they go, because *"we are out of minutes"*
  without the table makes going public look like the only fix. Billed from a real run: **17 minutes
  for 3½ minutes of compute**, of which **10 — 59% — is one macOS job that runs for 15 seconds**,
  because macOS bills at 10× on a private repo and every job rounds up to a whole minute. Trimming
  the matrix would buy the same minutes; it was offered and **declined**, correctly, since the
  minutes go free anyway and ADR-0006's cross-platform guarantee is worth keeping at its tightest.
  Recorded in the ADR so a later session reading that table does not think the trim was forgotten.

  **The one real defect the prep found is that there was no `LICENSE` file.** `package.json` has said
  `"license": "MIT"` since M0, and a manifest field is metadata where the file is the grant — so the
  repo would have gone public reading *all rights reserved* to everyone who cloned it. Everything
  else was clean and was checked rather than assumed: no tracked file with a secret-shaped name, no
  added line across **130 commits** matching `ghp_` / `github_pat_` / `sk-…` / `AKIA…` / private-key
  headers / Slack or Bearer tokens, two author identities, and `.claude/settings.json` holding a
  model name and a hook path. What that does *not* cover is written down too: a pattern scan finds
  secrets that look like secrets.

  **`pages.yml` is deliberately not restored yet**, and that is the whole shape of
  **[ADR-0031](./docs/decisions/0031-the-repo-goes-public-and-what-that-changes.md)**. Restoring it
  while the repo is private puts a workflow on master that fails on every run — the permanently-red
  check that gets normalised into background noise, which is the exact defect ADR-0015 deleted the
  file to stop. So the flip is an **ordered checklist** (§5): visibility, then Pages → *GitHub
  Actions* (a separate switch that making a repo public does not throw), then the one-line restore,
  then **read the run on master for both workflows**, then move README's Known-gaps row. Written down
  rather than remembered, which is ADR-0029's lesson applied to somebody else's checklist.

  **Two costs are named rather than discovered later.** The name goes out before it is settled and
  NORTH-STAR's header says not to do that — accepted on ADR-0029's own distinction, since a public
  repo is weaker than an npm publish and `private: true` stays. And the documents name a prior
  project of the owner's **19 times across four files**, with details about its internals; that is
  theirs to publish or redact, and it is written down because *"nobody thought about it"* and *"we
  decided that was fine"* look identical afterwards.

  **Next**: the owner flips; then steps 3–5.

- **The repo is public and the player is live at <https://deephanson94.github.io/ark/>.** The trigger
  was CI minutes, and the first thing worth doing was measuring where they went: **17 billed minutes
  for 3½ minutes of compute**, of which **10 — 59% — was one macOS job that runs for 15 seconds**, at
  a 10× multiplier with per-job rounding-up. Trimming the matrix would have bought the same minutes
  and was declined, correctly, since they go free anyway and ADR-0006's cross-platform guarantee is
  worth keeping tight. **[ADR-0031](./docs/decisions/0031-the-repo-goes-public-and-what-that-changes.md)**.

  **The one real defect the prep found was that there was no `LICENSE` file.** `package.json` has
  said `"license": "MIT"` since M0; a manifest field is metadata and the file is the grant, so the
  repo would have gone public reading *all rights reserved*. The rest was clean and checked rather
  than assumed — no secret-shaped filenames, no added line across 130 commits matching the usual
  token patterns, two author identities — and what that does *not* cover is written down too.

  **Four Pages runs, and every one was read.** Not enabled → a fix that could not work → the revert →
  green. The middle one is the lesson and it is a new landmine: `enablement: true` was taken from the
  failing action's **own suggested remedy** without asking whether `GITHUB_TOKEN` could act on it.
  Creating a Pages site needs `administration: write`, which a workflow token can never hold;
  `pages: write` **deploys to** a site and does not **create** one. It is the impossibility-argument
  landmine inverted — not an unchecked claim that something cannot be done, but an unchecked claim
  that it can — and it is easier to fall for because the source is the tool's own error text. ADR-0031
  §6.1 records it rather than editing it out, and `pages.yml` carries a comment telling the next
  reader not to re-derive it from the same message.

  Step 4 of that checklist — *read the run, both workflows, on the commit that landed* — is the only
  reason none of the three failures was reported as a success. It is the step this repo added after
  reporting CI green three times over a workflow that had never once passed.

  **What is verified and what is not**: GitHub reported the deployment successful and evaluated the
  URL, which is the instrument that decides whether a deploy happened. The page has not been fetched
  from this container — the agent proxy refuses `github.io` — so *"the site serves the player"* rests
  on the same `dist/player` artefact that `test:pack` and `test:e2e` exercise directly. A strong
  chain, and not the same as having loaded the page.

  **Next**: build ADR-0030's twin surface. Also open, and recorded rather than fixed: both workflows
  target Node 20 on actions GitHub has deprecated, which is one change across `ci.yml` and
  `pages.yml`.

- **Rung 3, designed and then sent back.** ADR-0032 (the walkable world), `docs/experiments/0001`
  (the S1 design ADR-0009 has recorded as in breach since the orbit merged without one), and a dated
  owner's note on ADR-0009 quoting the owner's restatement of the destination. No code, by design.
  ADR-0032's central decision came from measuring rather than arguing — nearest-neighbour spacing is
  a median 12–19 units on all four measured repos while the span runs 475 to 1,049, so **spacing is
  the invariant and world size is not**, and ark is a dense city on flat ground rather than a
  landscape. That dissolves the pillar-4 problem: the ground is a featureless plane, which asserts
  nothing and cannot be wrong, and everything standing on it is already computed.

  **Then it was attacked, which is what "proposed" was for, and §9 is what did not survive.** Six
  figures corrected in place — three cells of §3.1's table were measured by a probe capped at
  `Math.min(N, 400)` nodes, so ark and hono reproduced to the digit and the two large repos did not,
  which is exactly how the bad column was findable. Three findings are **redesign**: the world model
  names monoliths, colour, arches, stones, badges and fog and **never an import edge**, so it would
  teach *near = coupled*, the fallacy `treeSibling` exists to punish; a **commit** subject has no
  `layout` and therefore nowhere to stand, on 25% of ark's boards and **77% of django's**; and stage
  A — the cheap falsifying test the whole staging was built around — cannot run, because `orbit.ts`
  is orthographic with `MIN_PITCH = 0.18` and an orthographic grazing view draws a field of poles
  whatever the layout is. The two paragraphs this ADR was proudest of are two of the three.

  **P4's proposed release is withdrawn.** It has two legs — the Trace verb *and* the orbit's own
  measured results — and all three documents, plus the session's own explanation to the owner,
  described only the first. No decision may be asked for on it until it is put accurately.

  §3.5 is the owner's minimap, adopted and marked as postdating the review: it is the only element
  that keeps a survey view co-present with the egocentric one, and it is the decision most entangled
  with §9.1 — a minimap that draws the edges the world lacks is a finding, not a fix.

  **Next**: close §9's three redesign items before any rung-3 code, then ADR-0030's twin surface.

- **Rung 3 built: a hero walks the repo.** Press `g`. ADR-0033, which supersedes ADR-0032's central
  decision and answers four of its nine review findings. The owner released **P4** — both legs, after
  it was put accurately — and **S1 is untouched**, so the world ships as a *mode*: the flat map is
  still the arrival state and nothing claims walking teaches better, because nothing has measured it.

  **The roads are the edges.** ADR-0032 said the ground carried nothing; §9.1 found that this left
  topology visible only as proximity, which is a spring-embedder artifact and the exact fallacy
  `treeSibling` exists to punish. A road is an import, same endpoints, same coordinates — asserted as
  an *equality* in both suites, because a world with extra roads invents geography and one with fewer
  is the defect coming back. **A commit stands at the chronicle**, one obelisk outside the map, since
  25% of ark's deck and 77% of django's has a subject with no `layout`; putting its marker among the
  files it touched would be Placement's own answer key drawn on the ground. **A perspective camera**,
  beside the orbit's orthographic one rather than replacing it — the suite asserts both directions,
  that doubling the distance halves the size here and changes a column's height by nothing there.

  **Three defects the pictures found that no assertion would have.** The hero was 11 units tall in a
  world whose median gap is 12–19 — a person taller than the city. It was drawn last, so walking
  behind a building pasted the figure on its wall. And the camera walked *through* buildings, because
  the footprint was `radiusFor(loc)` unchanged: measured, that is **88.5% of this repo's towers and
  52.2% of hono's with no body-width gap to their nearest neighbour**. A glyph radius is not a ground
  area. A uniform ×0.4 — the knee, both neighbours named — takes ark to 3.3% and keeps §9.7's
  monotonicity exactly.

  **Walking past a building surveys it**, through the same recorder the map's click uses, so the fog
  has one definition of "seen". Measured in the e2e: a 2.6 s walk takes ark from 66 to 69 surveyed.
  The minimap is **north-up**, against ADR-0032 §3.5 — a turning minimap is a route instrument and a
  fixed one is a survey instrument, which is what ark teaches. ~1,150 lines, zero new runtime
  dependencies, Canvas 2D.

  **Next**: run `docs/experiments/0001`. Its §8 has two blockers, and ADR-0033 §4 has the sharpest
  problem in the whole rung — the minimap draws the same edges the world does, so it must be in both
  arms or neither, and telling world from inset needs a third condition.

- **The world, made legible — and a playtest that found the defect the suite could not.** An
  independent agent played it and rated the walking layer **3/10**: *"a tech demo bolted onto a game
  that already exists and is better without it."* Three of its findings were real and are fixed.

  **One heading, two bases.** `hero.ts` walks along `(sin ψ, −cos ψ)`; `toView` projected onto a
  different axis. They agree exactly when `dx · sin ψ = 0` — heading 0° or 180° — and **every
  assertion ever written about that camera used one of them**, twenty-one of them, written the same
  day. At any other heading the hero walked out of its own view: at 90° a point ten units ahead
  computed as ten *behind*, the figure vanished, and the city receded as you walked toward it. The
  degenerate-fixture landmine, freshly made. Regression tests run at nine headings; the e2e now turns
  and *then* walks, and checks the world is still populated, because a pixel hash cannot tell an
  emptied frame from a changed one. Also fixed: a movement key held when the challenge panel opened
  kept the hero walking and surveying behind the scrim (a grade can be all mouse, so "release on the
  next keydown" never ran), and the world had no edge — twelve seconds of running reached `0 towers ·
  0 roads · 0 beacons` on an unbounded plane.

  **The visual pass**, all rendering constants, each preserving the ordering its channel claims. The
  rig moved from a chest-height 6.5/16 — which frames the inside of one wall in a quarter whose files
  sit 12–19 units apart — to 33 up and 46 back tipped 0.52 down, which puts the ground plan in frame,
  and the ground plan is where the import graph is drawn. `RISE` 14 → 6, because ark's tallest file
  stood 105 units over an 18-unit street. Roads 2.2 → 1.1 wide and quieter, because a dozen edges at
  a hub merged into one grey plate. A **district wash** on the ground under each file in its region's
  colour, so the flat map's colour-as-neighbourhood survives the trip into the world. The figure 1.9
  → 4.4 units drawn with a ground ring, since a person-sized marker is 26 pixels at that boom.
  Painter's order now keys on a tower's near face, not its centre.

  Recorded as a **non**-finding: this session convinced itself the pitch sign was inverted, changed
  it, and reddened its own new test — the code and the comment had agreed all along. The claim is
  withdrawn and the convention now has assertions.

  Unrelated, and fixed because it went red: the e2e's wires step predicted which node a 40×26 cursor
  grid would land on, and at fit scale a small node is about a pixel. It sweeps once and chooses from
  what it found now.

  **Next**: unchanged — run `docs/experiments/0001`. The playtest's two non-bug verdicts (you see
  only a local neighbourhood; walking taught nothing the flat map had not) are exactly what
  `docs/prior-art.md` §2 predicts, and exactly what S1 exists to measure.

- **Navigation in the world, and the idea it had to refuse first.** The playtest's flattest complaint
  was not a bug: *you cannot tell where to go*. Three things answer it now — a **waypoint** on the
  guide's next subject (a chevron over it on screen, an edge arrow when off, name and distance either
  way, bearing computed in **view space** so it stays right when the target is behind you); a **sight
  cone on the minimap**, which is what actually binds the egocentric view to the survey one and was
  the missing half of ADR-0033 §6; and **the guide's target winning any tie of proximity**, since a
  playtest walked to the building the guide named and was offered its neighbour.

  **Arrows on the roads are dead, and that is the interesting part.** Showing which way each
  dependency points is the most attractive answer to *"what does walking teach that the map does
  not"* — the flat map draws every edge undirected, and NORTH-STAR §5's tier 2 is literally that
  question. Scored with `scoreSet`: **1.000 exact on 100% of both repos' Blast Radius boards**,
  because ADR-0008's invariant makes a directed road network the answer set *by construction*. The
  first run of that probe said 0.000 on 94 boards — it iterated `graph.in[ref]`, which holds edges
  rather than refs — and a mean of exactly zero across two repos is an instrument measuring nothing,
  erring in the direction that makes shipping look safe.

  **Next**: unchanged — run `docs/experiments/0001`.

- **Re-playtested: 5/10, up from 3 — and the rating moved on stability, not on fun.** Same brief,
  same instruction not to be polite, run against the fixed build with the tree held still. All five
  fixes verified landed with evidence rather than eyeballing. Its verdict on the rest is the one to
  keep: *"walking is now a working, honest way to get to that modal. It is not yet a reason to prefer
  it"*, and on whether walking teaches more than the map, *"no, not that I could find"* — with the
  observation that **the minimap's existence is the admission**, since the north-up inset was added
  because the 3D view could not carry survey knowledge and now does most of the *where am I* work.

  Fixed from it: a **duplicate label** (the waypoint pill and the tower's own label stacked the same
  filename), and **`o` silently swallowed** in the world — a keypress that does nothing and says
  nothing reads as broken, so `o` now leaves for the orbit.

  **A skyline was built for the void, then the reason for it was refuted by counting.** NORTH-STAR
  risk #4 mandates showing the silhouette of unexplored regions; the flat map has since M1 and the
  world drew *nothing* past `VIEW_DISTANCE`. But sampling 121 standing positions on both repos found
  **no position with nothing in full view** (0 of 121, both) — the playtest's `0 towers` frames were
  the **frustum**, not the cull: it had run to the shore and was facing away. So the response is less
  shore (140 → 70) rather than scenery. The skyline is kept with its firing rate recorded — **10 on
  ark, 112 on hono** — real on a repo twice the bootstrap's size, nearly dead on the bootstrap, whose
  488-unit span fits inside one view distance. The e2e gates *"something is standing"* rather than
  *"the skyline fired"*, because the first version of that step measured exactly **1**.

  **Next**: stop polishing this rung and run `docs/experiments/0001`. Two independent playtests and
  `docs/prior-art.md` §2 agree walking does not teach more than the map, and no further bug-fixing
  can answer that — it is a measurement, it is designed, and it is unrun.

- **The phenomenon catalogue is deferred, and a cycle turns out to be an answer key**
  (**ADR-0034**). Fifteen candidate detectors were written and counted on five repos *before*
  anything was designed, which is the only reason this entry says what it says: **roughly half the
  table was measuring the instrument.** `barrel` reads 0.0% on flask because `kind: 'reexport'` is
  emitted only by `scan.ts`, so no Go or Python repo can produce one — flask's `__init__.py` is a
  textbook barrel the detector cannot see, and hugo's two "barrels" are stray documentation
  JavaScript. `entry` is a **test-file detector**: 52 of ark's 54, 140 of hono's 149. `hub` reads
  0.0% on hugo for the *same* unreachable-bar reason this session had just caught in `hotspot` — and
  the cause is sharper than the fix, because hugo's median cone is 140 against a max of 152 **only
  because its 131-node tangle drags the median up**. Detectors calibrated against one distribution
  are not independent.

  Five rows on four repos were measured over history the product itself refuses: those clones were
  `--depth 400`, so `commits.ts` had refused the entire history deck. Re-cloned at full depth, hono's
  `fossil` moved **6.5% → 1.3%**. And the ark column was off by one node because the probe files sat
  in `scripts/` while the probe indexed the repo — ark indexes itself, and the measurement included
  the measurement.

  **The finding that outlives the decision**: ticking the candidates in the subject's strongly
  connected component decides **109 of hugo's 156 Blast Radius boards**, 11 of prometheus's 63 and 7
  of hono's 54 — with `impure = 0` everywhere. That is not a heuristic that scores well; strong
  connectivity is mutual reachability, so ADR-0008's invariant forces every SCC-mate into the key.
  **Precision 1.000 by construction**, verified with two independent SCC algorithms. The entry's
  teaching value and its leak are the same property, at an order of magnitude past ADR-0030's twin.
  Nothing draws or names cycles today; this is now a standing constraint on anything that would.

  So the catalogue's honest size is **~5 entries, not 30–60**, and the sequence is inverted: build
  **ADR-0030's twin surface** first as the priced pilot — it is the catalogue's own entry #1,
  decided, leak-scored and unbuilt — and let one entry's real cost price the other thirty.

  **Next**: the twin surface, then `docs/experiments/0001`.

- **The twin surface is built** (ADR-0030, four milestones after it was decided). `src/player/twins.ts`
  groups nodes by identical transitive dependent cone, derived from the graph at load rather than
  carried in the atlas, and the inspector names a class in the *revealed* register: *"nothing in this
  repository can tell this apart from `reveal.ts`: 47 places reach both of them, by the same paths."*

  **Both halves of the gate are checked in a browser**, because either alone passes against a broken
  surface: on a fresh save `companion/reveal.ts` says nothing while its class carries a board, and
  with every Blast Radius board answered the line renders. Three mutants die, including the exact
  forbidden shape — gating per *row* instead of per class, which would make the absence of the line
  point at the member whose board is still open.

  **The first version of that browser check was the dead-path landmine wearing a test's clothes**: it
  looked only at the fresh save, found neither of the two nameable members fell under a 40×26 grid,
  printed *"skipping the render check"* and went green.

  Re-measured at `3cda64a`, ark has **8 twin classes / 20 members**, 1 nameable at load and 8 once
  the deck is cleared — against the 5 classes / 0 nameable ADR-0030 recorded, so its sentence *"on
  ark it arrives late"* is no longer true. ark indexes itself; the invariant survives and the count
  did not.

  This was ADR-0034's priced pilot, and **the price is now known: ~250 lines, one module, one gate,
  two suites for one catalogue entry.** The catalogue stays deferred.

  **Next**: run `docs/experiments/0001`.

- **S1's three structural blockers, closed — the experiment is runnable, and one of its own premises
  was refuted by measuring it.** `docs/experiments/0001` was designed, committed and unrunnable: its
  §8 listed the matched repos as a TODO, a two-arm design that cannot detect *"orbit beats both"*,
  and a per-participant quiz. All three are closed and the document says what is left.

  **The repos are named with commits**: `graphql/graphql-js` `9c245018` and `kysely-org/kysely`
  `f24018c7` — 549 / 600 nodes, 3.70 / 4.13 edges each, 69 / 75 Blast Radius boards, decks of 276 and
  300 that are *exactly balanced across the four verbs*, 500 retained commits each, 2.7 / 3.1 s to
  index. Chosen from **31 repositories cloned at full depth and indexed**, of which 9 cleared a first
  filter and 13 pairs sat inside §4's ~20% node bound. Three things the measurement settled that
  taste would not: **node count alone is not a match** — the criterion as written picks `hono / zod`,
  8.8% apart on nodes and **2.2× apart on density**, which is the quantity that decides how big a
  cone is; **Blast supply is implied by neither size nor density** — `elysia` is a near-exact
  structural twin of `h3` and ships **2 boards of 44 subjects**, the other 42 refused as `uncertain`;
  and the runner-up (`effector / execa`, better matched than anything but the pick on size *and*
  density) is demoted by **language**, at 80% against 25% TypeScript.

  **The arms are staged, and the minimap confound is closed by a measurement that refuted the obvious
  account of it.** Four structures went to the owner with their recruiting costs; the choice is
  *stage 1 = map vs orbit (12), stage 2 = a world arm of 6 scored against stage 1's map arm, not run
  if the orbit loses* — which is ADR-0009's own *"if the fly-through does not beat the flat map, the
  avatar never happens"* made executable, and it also produces the *"orbit's own measured results"*
  that P4 named and was released without. The cost of reusing a control across rounds is written down
  rather than absorbed.

  ADR-0033 §4 frames its minimap confound as a binary — the inset *"must be in both arms or in
  neither"* — on the implicit account that the inset shows a walker **more** than the world does,
  since `render.ts` culls roads at `VIEW_DISTANCE` and `minimap.ts` culls nothing. **Measured over
  121 standing positions per repo, that is false**: the world's own view already reaches a mean of
  **98.7%** and **99.0%** of the edge set, because the map spans are ~750 units against a view
  distance of 620. The cull is not the mechanism; the **projection** is — the same graph, exocentric,
  permanently on screen, which is where `docs/prior-art.md` §2 puts the entire measured 3D win. Stated
  properly the confound is that **the world arm contains a small instance of the map arm**, and the
  repair is neither of the two options the ADR named: the inset keeps everything but its **roads**.
  Dropping it whole would buy Richardson et al.'s disorientation confound instead.

  **The quiz is a fixed held-out item set** — k boards removed from the deck before recruiting, so
  the item set is identical across arms and overlap with played subjects is zero *by construction*,
  and the items keep the generator's certifications (guardrail 4, the Ctrl+F gate, ADR-0012,
  ADR-0008's invariant) instead of a hand-written item's none. The one hole a hold-out does not close
  is named: a served reveal can state an atom of a held-out key through ADR-0019's channel, so the
  split has to be checked against `discloses`.

  **Built**: `?arm=map|orbit|world` (`src/player/experiment.ts`) — because the design is
  between-subjects and **nothing held that**: `o`, `g` and Escape move between all three views, so a
  participant could put themselves in another arm with one keystroke and no record of it. It fixes
  the starting mode, refuses the keys that leave it, drops the world arm's minimap roads, and keeps
  the HUD from advertising a key it has disabled — which turned up that the HUD had never advertised
  `g` at all, under a comment saying a feature reachable only by reading the source does not exist.
  **No query string is the ordinary player, unchanged**, and the deployed page has none. Four mutants
  die, including the one that drops the whole inset rather than its edges.

  Also recorded: **§3 claimed M2 was "instrumented by the player" and it is not** — attempts live in
  `selector.ts`'s session state and nothing persists them — and a new landmine, because this session's
  own checkout of ark was **shallow**, which fails 12 of `test:atlas`'s 111 assertions with three
  history verbs' invariant errors that read exactly like a broken generator.

  **Next**: the two pieces of harness in that document's §9 — the hold-out split script (with the
  `discloses` check, or it ships with a known leak) and M2's counter — and then twelve participants,
  which is owner-only and the only thing S1 is now waiting on.

- **Three cold playtests, and the product was lying to the player in three places.** The world,
  the loop and first contact were each handed to an independent tester with the pitch a new user
  gets and an explicit instruction not to read the source, the README or `docs/` before playing.
  They rated it **4/10 · 5/10 · 4/10** and found, between them, three sentences on screen that are
  **false** — none of which any of the 780 assertions could see, because every existing test checks
  the *shape* of a note and none held one to being *true*.

  **1. "Wrong picks cost you nothing" was on every prompt and it is false.** Under §8.2 a spare pick
  lowers precision: the right file plus two plausible wrong ones scores **50% where the right file
  alone scores 100%**, and one tester re-ran the same board both ways to prove it. The sentence was
  reaching for guardrail 6 (*no penalty, no fail state, no lockout*) and instead denied the metric
  the whole anti-gaming argument rests on. It is now `keyRule()` — one function, all four verbs —
  and it **states the key size**: *"Exactly 6 of these 20 count, so extra picks lower the score.
  Nothing is locked by a wrong answer."* Stating the count is **free against the Ctrl-F gate**, which
  is why it is safe rather than a guess that it feels fair: `gate.ts` already hands every heuristic
  `truth.length`, so every board that ships has been scored against guesses sized exactly like the
  key. A player who knows the count knows nothing the gate did not already assume.

  **2. The grade asserted a number and never explained it.** A tester found **1 of 1** correct
  answers, was shown **`33% · not yet`**, and called it the worst moment of the session — two true
  facts on one screen that read as a contradiction. The evidence line now closes with the
  arithmetic: *"Scored 33% — 1 of your 3 picks is right, and there is 1 to find in all."*

  **3. Archaeology told the player a commit message "names this file" when it shared one word.**
  `"Refactoring and test changes"` was presented as naming `extensions-test.ts`, on the token
  `test`. Measured, that is not an edge case: **87% of graphql-js's 315 firings, 82% of kysely's and
  54% of hono's** are a single shared word. The strategy is right to cast that net — a message that
  sounds like this file is the confusion the class exists to punish — and the *sentence* was a
  separate claim nobody checked, which is this repo's class-label landmine in a witness line. Both
  the reveal and the witness text now hold to what is true, and the strong claim is kept for the
  rows that earn it (the stem verbatim, or every token).

  **Two more, both in code this session wrote.** The world's **"Where next?" panel was blank for an
  entire `?arm=world` session** — `guide.update` was called only in the map/orbit frame branch, so
  the recall experiment's own arm shipped with a dead next-step affordance, and the unlocked world
  showed *"160 left"* beside a HUD reading *"159 left"* in the same frame. And the **unlocked HUD
  advertised keys measured to be dead**: `f` and `n` in the world (canvas hash unchanged), `o orbit`
  while already in the orbit. `experiment.ts` wrote the rule *"a locked arm must not advertise a key
  that does nothing"* and applied it only to locked arms — so the ordinary player broke the rule the
  experiment arms enforced. The hint is now a function of `(arm, view)`.

  Also: the difficulty pips carried `title="… — NORTH-STAR §8.4"`, an internal spec reference in a
  user-facing tooltip; four phrasings disagreed with their own counts (*"1 of your picks do not
  reach"*); and **`npm run play` wrote to one shared path inside the installed package**, so two runs
  on one machine silently served each other's repository — which happened to all three testers
  mid-session. `play` now gets a private copy of the player per invocation, verified by running two
  servers at once and reading a different repo off each.

  **What the testers found that is *not* fixed** is in `README.md` Known gaps with its measurement,
  because a report this good deserves better than a quiet triage: the map is **inert during a
  challenge** (the largest of them, and the cold tester's single highest-leverage fix), select-all
  **hands over the annotated answer key**, the fog is invisible, the legend clips at 17 of 36
  regions, **Placement is unreachable from the map**, the guide serves the four easiest boards first
  with no skip, and there is no help key.

  Seven mutants die across the new assertions, including the two that matter: restoring *"wrong
  picks cost you nothing"* reddens two, and deleting the world's `refreshGuide` call reproduces the
  tester's observation exactly (`guide ""`) in the e2e.

  **Next**: the map should do work during a challenge — light the subject, mark the candidates,
  draw the edges the question is about, and let the player pan without losing the board. It collapses
  five of the open findings into one change and it is what makes the map the instrument you answer
  *with* rather than a background.

- **The map does work during a challenge now, which was the largest thing three cold playtests
  found.** Opening a board used to give you a 660px panel in the middle of the screen over a dimmed,
  blurred map with **nothing on it marked** — so a player who had never seen the repo could only
  pattern-match on filenames, which is what the `treeSibling` distractor class exists to punish, and
  clicking the map to look at the thing the question was about **silently discarded the board**.

  Four changes, one idea. The console publishes a `BoardView` — ids and tick state, never a verb,
  never a ref — and the shell resolves whichever of them have a place, which is where **both halves
  of `AtlasId` arrive and neither is assumed**: a Placement subject is a commit and an Archaeology
  candidate is, so `refById` returns `undefined` and those are dropped rather than given an invented
  position. `draw.ts` marks the subject with a double ring and every placeable candidate with a
  square that fills when ticked. **No edge is drawn between them** — that relation *is* the answer,
  and it stays gated on `subjectsPassed` where ADR-0008 put it. The scrim is pointer-transparent and
  the panel docked to one edge, so the map is a place you can look at and click; a click on a marked
  candidate **ticks it**, and a click anywhere else does nothing instead of throwing the board away.
  Opening a board pans its subject to 30% of the width, because a marker under the panel is the
  marking layer firing and the player seeing nothing.

  **The first version of the e2e gate passed for the wrong reason**, which is the third time this
  file has recorded that shape: the sweep covered the whole canvas and the panel is docked to the
  right of it, so a "map click" that ticked a *row* was scored as a map click that ticked a marker —
  on an Archaeology board, where the candidates are commits and no map click can ever tick anything.
  The panel's box is excluded now, the tick is required only where `marks > 1`, and a **run-level
  flag fails the suite if no board in the whole run ever exercised the path** rather than letting it
  skip quietly. That flag went red on the first run after it was added, which is how the false
  positive was found at all.

  Three mutants die on the marking layer: drawing markers regardless of board membership, dropping
  the layer when the subject has no place, and the two above.

  **Next**: close the select-all exploit — submit everything, read the annotated key, reopen, tick
  the named files, 100% and a field note in two clicks. The owner's decision is to withhold unpicked
  truth members when precision is low, which is withholding by *board* and so allowed by ADR-0020.
  The coupling to check first, found while scoping it: `unlocks: 'importRadius'` draws the full cone
  on **any** grade, deliberately, so withholding the names alone changes nothing — the summary
  sentence, the map unlock and the notes have to move together or the fix is theatre. It wants a
  measured threshold and its own ADR.

- **A reveal is earned now: select-all buys nothing**
  (**[ADR-0035](./docs/decisions/0035-the-board-explains-itself-to-an-answer-that-discriminated.md)**,
  owner's decision). The exploit a playtester found in two clicks: tick every candidate, score ~10%
  at no cost, read the whole annotated answer key off the reveal — with the full import cone drawn on
  the map — reopen, tick what it named, and take `S · 100% · exact`, a pass and a **field note**.
  NORTH-STAR §9 calls field notes *"facts you have proven you know, not facts you were shown"* and
  says that distinction is the whole product; every proof in the deck was obtainable without
  understanding anything. The *score* exploit was closed at M2 by `isGameable`; the *reveal* exploit
  had never been looked at.

  **Below 0.5 precision the reveal names no candidate**, states the counts, and does not unlock the
  map. `precision < 0.5` is *exactly* the sentence the player reads — **more of your picks were wrong
  than right** — so the prose is the condition rather than a gloss on it, which is this repo's
  class-label landmine designed out instead of guarded against. Select-all cannot reach the bar
  **structurally**: ADR-0007's three-to-one choice set puts its precision at ≈1/3, measured at a
  **maximum of 0.308 over 792 boards** on graphql-js, kysely and hono, with none above 0.4 — so the
  bar has 1.6× margin rather than ADR-0021's knife edge. Precision 1.0 with low recall, the teaching
  moment, is untouched and is unfarmable because reaching it means already knowing.

  **Two drafts of the rule were wrong and the tests caught both.** *Withhold the answers you did not
  pick* closes nothing — under select-all there **are** none, every truth member is a `correct` note
  — and the first run of `withhold.test.ts` failed on it. Keeping the `spurious` rows as the
  mitigation fails one step later: `picks = correct ∪ spurious`, so naming the wrong ones names the
  right ones **by complement**. The narrower rule does not survive the arithmetic either, and the
  ADR shows why rather than asserting it: knowing which of your picks were right passes next time
  whenever `f1(1, recall) ≥ 0.5`, i.e. **recall ≥ 1/3**, which is not an edge case.

  **The map unlock moves with the words, and that is the whole point of it being one change.**
  `unlocks: 'importRadius'` draws a superset of the key, so withholding the sentence while drawing
  the picture would have been theatre — the coupling this was scoped against last session.

  **Two costs, both stated rather than absorbed.** The player who reasons worst learns least. And
  ADR-0020's negative witness now speaks only to answers above the bar — a real narrowing of a
  shipped feature, which surfaced because the e2e's witness step went red: it had been picking a
  single wrong answer, precision 0, so it was measuring the new rule instead of the witness. It
  answers precisely now. What is **not** measured is how often honest play lands below the bar,
  because nothing instruments attempts (experiment 0001 §3) — a measured exploit against an
  unmeasured cost, said plainly so the 792-board figure does not lend its confidence to both halves.

  Four mutants die, including both wrong drafts of the rule, and the e2e plays the exploit for real
  against a fresh save and asserts no candidate label appears anywhere in the panel.

  **Next**: the rest of what the playtests found — the fog is invisible (dashed-vs-solid outlines
  nobody noticed), the legend clips silently at 17 of 36 regions, **Placement is unreachable from
  the map** (25% of the deck, reachable only at the chronicle in walk mode), the guide serves the
  four lowest-difficulty boards first with no skip, and there is no help key. Then S1.

- **The hold-out split ships, and its headline result is that it refuses nothing — which is two
  different facts wearing one number.** `docs/experiments/0001` §9's first piece of harness:
  `npm run holdout <repo> --out <dir>` cuts a built atlas into the atlas both arms play and the fixed
  quiz they are scored on, and checks every removed key against the served deck's `discloses` output.
  Measured at k=6 per verb across **all four** verbs, on full clones of named commits — ark
  `75b6117`, `graphql/graphql-js` `9c245018`, `kysely-org/kysely` `f24018c7`, `honojs/hono`
  `7075369e` — it refuses **0 on every repo** and the swap loop runs **once**.

  **The two zeroes are not the same and the script refuses to print them the same way.** On Placement
  and Archaeology the check *ran*: their keys are expressible as disclosed facts, and ADR-0019
  decision 7 already excluded the overlap at generation time. **How much that proves is bounded by
  deck coverage, and this paragraph's first draft overstated it** — a review of the measurement
  caught it. On hono only **52 of 332 key atoms** across both decks sit where the cross-verb channel
  could fire at all (a Placement board covers 54 of 500 retained commits, an Archaeology board 54 of
  425 nodes), so decision 7 is confirmed on those 52 and a k=6 sample contains almost none of them.
  The honest reading is *regression detection on decision 7*, not *the hold-out is safe*. On Blast Radius and Companion the
  check is **blind**: their keys are relations between *files* and every fact in `disclosure.ts` is
  keyed on a commit, so no accumulated fact can state one. Those two are §4.4's entire discriminating
  tier, so **the check §9 specifies is structurally vacuous on exactly the items the experiment is
  scored on** — the finding this session did not expect and the reason the split is not simply "done".

  So `Verb.keyFacts` returns **`null`, never `[]`**, and the shell prints `unchecked` where it would
  otherwise print `0 refused`. That is `CLAUDE.md`'s absence-assertion landmine met in the type
  system rather than in a comment: both spellings render as *no leaks found*, and only one of them
  means the instrument ran. It is a third direction and not `discloses` renamed — Placement's
  `discloses` also yields a `widthFact`, which names a *size* and no member, so reusing it would
  refuse a board because some reveal printed how big its answer is. A mutant that reuses it dies.

  **The channel that can fire on those two verbs is mutual membership** — two boards of one verb
  naming each other — stated structurally so it names no verb and therefore no relation: on Companion
  it is the symmetric co-change pair, on Blast Radius the same shape is a **cycle**, which is
  ADR-0034 §4's SCC finding arriving from the other side. It reads **1 on kysely**
  (`src/dialect/dialect-adapter.ts` ⇄ `src/parser/expression-parser.ts`) and 0 on the other three. It
  is **reported and not refused on**, and that is a judgement written down as one.

  **And then the fan-out found the leak the hold-out *creates*, which is the finding of this
  session.** ADR-0030's twin surface names a class *"only when no member still carries an unanswered
  Blast Radius board"*, and `main.ts` asks that as `challengesById.get(id) ?? []`. A held-out board is
  not *unanswered* — it is **absent** — so the bucket is empty, the guard passes **vacuously**, and
  the inspector volunteers `cone(S) = cone(T)` for a subject the participant is about to be quizzed
  on. With ADR-0008's invariant that is the key **byte-exact**: **4 of kysely's 6 held-out Blast
  Radius boards recover at F1 1.000**, 19 of 19 under leave-one-out (25.3% of that deck), and 3 of
  graphql-js's 6. The gate is real and the removal is what opens it — treating every blast board as
  open closes 4 of 4.

  The player is not wrong (a board that does not exist cannot be open), so the repair is in the thing
  that made it not exist: `HoldoutBar` refuses to hold out a board whose subject shares a cone with
  anything else. It fires **11 of ark's 40, 24 of graphql-js's 69, 26 of kysely's 75, 6 of hono's
  54** — and no repo goes short of k=6. After it, **0 of 6 held-out Blast Radius subjects sit in a
  twin class on any of the four**. `findTwins` is imported from `src/player/` rather than
  reimplemented, because two definitions of *twin* is worse than the leak.

  **A second bar, from the same fan-out: a board the map already answers is not a quiz item.**
  Hovering a node paints its direct importers for everyone in every arm (ADR-0008 decision 1), and on
  the easy end of the deck that is not a hint but the answer — mean F1 **0.890** below difficulty
  0.50 against **0.095** above 0.80, ρ = −0.826, beating band A on **17 of hono's 54** boards. In the
  quiz it decided **2 of 6** held-out boards on graphql-js and on hono and 1 of 6 on kysely, **best
  F1 1.000** — an item answerable by pointing, spending one of six slots. Barred, using the product's
  own bar (`CTRL_F_THRESHOLD`) and metric (`scoreSet`): now **0 of 6 on all four repos**, best 0.667
  / 0.667 / 0.667 / 0.750. Ranking the quiz by descending difficulty would also have closed it and
  was rejected — §6 names a floor and a ceiling as one instrument failure wearing two signs, so the
  bar removes the compromised items and leaves the spread. Both bars together take **19 of ark's 40,
  39 of graphql-js's 69, 31 of kysely's 75, 20 of hono's 54**, and no repo goes short of k=6.

  **What was measured and deliberately *not* called a leak**: a served Blast Radius board about `D`
  where `D` transitively imports `S` discloses `dependents(D) ⊆ dependents(S)`, covering part of the
  key on **29 of ark's 40** boards. Exploiting it requires knowing `D` depends on `S` and reasoning
  transitively, which is tier 3's construct in as many words — ADR-0019's rule is that an *implied
  relation* is accepted where a *stated atom* is refused. Recorded so the next session does not
  "fix" the thing being measured.

  Every branch of the new machinery is dead on all four repos, so the apparatus is proved by a
  **positive control** rather than by its own silence: `tests/unit/holdout.test.ts` hand-builds the
  collision a generated atlas cannot contain and asserts the swap happens (2 rounds). Six mutants
  die, including one that reddened nothing on its first draft because it mutated the map *builder*
  instead of the matcher — a bad mutant looks exactly like a robust one.

  **Next**: M2's instrumentation — nothing persists attempt counts, so the engagement half of S1
  cannot be read off a finished session. Note that `selector.ts`'s `attempts` counts only boards that
  did **not** pass, so it is not the datum §3 says it is even before persistence.

- **M2's instrumentation, and the datum that did not exist.** `docs/experiments/0001` §3 pre-registers
  engagement as *"challenges attempted within the fixed 20 minutes"* and said `noteAttempt` kept the
  count in session state. It did not: `main.ts` increments that map **only when the grade did not
  pass**, so `selector.attempts` counts **failures**, and persisting it would have answered
  *"challenges attempted"* with a number that **falls as participants do better** — anti-correlated
  with the quantity, on exactly the between-arm comparison §3 exists to make. Persistence was the
  second problem. The class-label landmine in a schema: the name says attempts, the docstring says
  failures, the experiment's prose says attempts.

  **The first draft was refuted by three independent reviewers and the shipped shape is theirs**
  (**[ADR-0037](./docs/decisions/0037-m2-is-instrumented-inside-an-arm-and-nowhere-else.md)**). It put
  a tally in `Progress`, arguing that a write-only field is not the cursor ADR-0011 decision 2 forbids
  because *"position in the progression is recomputed from the answered set on every load"*. That
  promotes the ADR's **reason** to its operative test — decision 2 says *"neither is a cursor"* and
  prints the record's schema as a literal, so any new key changes it. `selector.ts` had already
  classified this exact datum the other way, in code, citing the same ADR. And the proposed proof —
  *"delete the read path and nothing changes"* — is vacuous: it passes on every tree containing the
  field, including one where the next session wires it in.

  So: `src/player/tally.ts`, its own key beside the save, **written only when `?arm=` locked the
  session**. The ordinary player stores nothing, which leaves ADR-0011 decision 2 untouched rather
  than argued with. The field is `graded` and never `attempts`, and the shapes are deliberately
  incompatible with `SelectorState.attempts` — a sorted array against a `ReadonlyMap` — so wiring it
  into `suggestNext` is a rewrite, not a one-word edit. That is the enforcement a comment cannot give.
  `passedOn` latches which attempt first passed, which is the figure that prices any rule spending a
  player's first attempt.

  **And a readout, because a record with no reader is not an instrument.** §9 offered *"a counter in
  the save, or a facilitator's tally"* and missed the option that beats both: the count already
  existed in memory and what M2 lacked was a way to get it out. `arkTally()` exists in an arm only and
  is never shown to the participant, since showing someone their pre-registered measure changes it.

  **Proved to fire in a browser, because a unit suite structurally cannot see shell wiring** — this
  repo's scar is a mutant that deleted the guide's attempt-count seed and reddened no unit test at
  all. `test:e2e` plays a board under `?arm=map`, asserts the reading moved, reloads, asserts it
  survived; deleting the write reddens both. Writing that step also cost two rounds: `.guide-go` was a
  selector I invented (it is `.guide-action`) and the guide takes you to a landmark rather than
  opening a board — both invisible to `tsc` and both caught only by running it.

  **One pre-existing e2e step went red and it was mine indirectly.** The world's walking check held
  `w` for a fixed burst and asserted `surveyed` rose. Ark indexes itself, so adding two source files
  re-rolled the layout and the hero's straight line met only already-surveyed buildings — green on
  `origin/master`, red here, on a commit that changed nothing about walking. It now sweeps with a
  deadline, which keeps a genuinely dead surveyor failing.

  **Next**: `docs/experiments/0001` §9 is down to **twelve participants**, which is owner-only.
  Then region arches in the world (ADR-0032 §9.6), then django's index budget (17.6–18.6 s against a
  10 s ceiling, ~40% force-directed layout).

- **A review sweep found two defects in the split, both in this session's own decisions rather than in
  the code they describe.** `mutualMembership` printed **0 for Placement and Archaeology** — where a
  subject is a commit and its members are nodes, so the lookup misses **by construction** and the zero
  says nothing about the repo. That is the two-zeroes rule this module's docstring is mostly about,
  broken in the channel it added second, by the author of the paragraph forbidding it. It returns
  `null` now and the report prints `n/a`. And `shortfall = k − held` never fired at `k === eligible`,
  so `-k 40` on a 40-board verb removed **every** board of that kind, reported 0 short, and exited 0 —
  handing participants an atlas whose guide says *"every question answered"* over a deck that was
  taken from them (`empty.ts` forks a zero on two causes and a hold-out is a third). It exits 2 now.
  Neither was reachable by mutating a line; the sweep is a different instrument from the mutation run.

  **ADR-0016's wire gate has the same absent-versus-unanswered shape as the twin gate, and it was
  measured rather than assumed.** `openBoards` is built from *unanswered* Companion challenges, so a
  held-out board suppresses nothing. The leak reduces to mutual membership and is **0 atoms on all
  four repos**, because a wire needs a served board naming the held subject *and* that board's subject
  to be a candidate on the held one — which ADR-0014's certification turns back into mutual
  membership. Apparatus, since it is another zero: **172 / 329 / 348 / 194** wires drawn, 1–2 of 6
  held subjects carrying an incident wire, and 6 of 6 boards' candidates present in the wire graph.

- **The sweep also found a hazard in the instrumentation's own wiring, and an over-claim this session
  had just written.** `main.ts` tested `locked` **twice** — once to update the tally, once to write it
  — and the two drifting apart is not cosmetic: `tally` is `EMPTY_TALLY` in an unlocked session, so a
  write escaping the guard puts `{"entries":[]}` over a finished arm's record and **erases a
  participant's data**. One guard now. Its `store.getItem` was also the player's only unguarded one,
  where `save.ts` wraps the identical call because reading storage throws outright in some sandboxed
  frames.

  And §9 briefly said *"both pieces of harness are built"* while **§5's pre-registered "time to first
  correct answer" had no clock behind it** — a document claiming a behaviour the code does not have,
  which is this repo's most-repeated defect, committed by the session writing the note about it. Named
  now, with the two other gaps beside it: a board opened and abandoned is not an attempt (and the arms
  differ in what it costs to reach one), and the record does not reset between a dry run and the
  participant who follows it.

- **The completeness critic found a third channel, on the quiz's other verb, and it beat band A on one
  of the two experiment repos.** A served **Placement** reveal names the files a commit touched, so
  any two of them are co-commit partners — and *"changed in the same commit"* is the relation
  **Companion** grades, reached without the co-change matrix at all. Reproduced independently on all
  four repos: it beats band A on **1 of 6** held-out Companion boards on ark (best F1 0.800) and **1
  of 6 on kysely (best 0.909)**, and does not fire on graphql-js (0.500) or hono (0.286). Barred, it
  is **0 of 6 on all four**, best ≤ 0.500, costing 2 / 2 / 5 / 1 boards and no repo its k=6 — with the
  apparatus still live afterwards (722–866 co-commit pairs, 1–3 boards holding an atom).

  **This is what the `unchecked` cell was hiding.** `placement.discloses` declares those atoms
  honestly and the accumulator holds them; they name a **commit** while a Companion key relates
  **files**, so `keyFacts` cannot connect the two. Decision 1's blindness was not merely a missing
  string — it was covering a channel that fires on half the measured repos.

  **And a third kind of zero, named because two were not enough.** `mutual 0` against Companion is
  structural on *every* repo: `companion/generate.ts`'s `claimed` set is keyed on an **unordered**
  pair, so `T ∈ truth(S) ⟹ S ∉ truth(T)` deck-wide and mutual Companion membership is
  unrepresentable. The channel is live only on Blast Radius, where the shape is an import cycle.
  Which also makes **`src/player/ties.ts`'s header stale**: it records that leak at *"up to 6 of 6 on
  this repo, measured"*, a figure taken before the `claimed` set existed — same verb, same repo, two
  documents disagreeing, and the old number came from the pre-dedupe generator.

- **django's index budget: 5.73 → 5.25 ms/file, byte-identically, and the ceiling turns out to be a
  rate.** (**[ADR-0038](./docs/decisions/0038-the-index-budget-is-a-rate-the-layout-may-not-move-to-meet-it-and-the-sort-was-the-cost.md)**,
  on a full clone of `c9eb16a87e` — 3,035 nodes, 10,167 edges, reproducing ADR-0028's figures.)

  **The headline was the wrong number to lead with.** `README.md` said *"17.6–18.6 s against a 10 s
  ceiling"*, which reads as a 76% breach; `CLAUDE.md` writes that ceiling **at 2,000 files** and
  django has 3,035, so the honest measure is the hard `ms/file` row `scripts/budget.ts` already
  enforces. The rate was in the same paragraph, two sentences down. It is 15.9 s and **5% over**, from
  17.4 s and 15%.

  **And the prescription was wrong.** *"Fixing it is a `layout.ts` change"* — the layout is 35.4% of
  the index and **98% of it is one loop**, whose 3×3 grid neighbourhood holds **937 nodes** at
  django's shape (853M pair tests, growing superlinearly: 0.41 ms/node at 190 nodes against 2.78 at
  3,035). `layout.ts`'s claim that a uniform grid *"keeps this linear in practice"* is corrected in
  place. But **the obvious fix is forbidden**: a finer grid changes the order contributions are summed
  in, floating-point addition is not associative, and NORTH-STAR §7 freezes the layout. A speedup that
  moves a coordinate is a *re-layout*, which is an owner-level amendment to the north star.

  So: constant-factor only, with **byte-identity as the acceptance test** rather than a benchmark. A
  conservative squared-distance pre-filter (59.4% of pair tests are beyond the cutoff and every one
  paid a `Math.sqrt`; the padded bound means anything it rejects would certainly have failed the exact
  test, which still runs on every survivor), accumulation into locals, and an indexed inner loop —
  **8.4 s → 6.4 s**. Plus a concurrent prefetch in the walk, which was doing ~6,000 sequential
  `stat`/`readFile` round trips: idle **3.57 s → 2.85 s**, smaller than hoped and said so. The
  prefetch fires for every file (190 / 425 / 3,035) and its fall-back fires **0** times.

  **Byte-identical on five repositories** — django, ark, hono, kysely, graphql-js — compared with
  `cmp` over the same trees. **Nothing checked that before**: eleven layout tests asserted *properties*
  and not one pinned a value, so an optimisation moving every node by a hundredth passed them all. The
  freeze NORTH-STAR §7 describes was a promise nothing tested. There is a **golden layout** now, on
  both branches, and two mutants die on it — the tempting `squared > cutoff * cutoff` and a reordered
  accumulation.

  **Next**: the remaining ~1.5 s is not the layout. `placement/distractors.ts` is **1.43 s (8.9%)** and
  is roughly the size of the gap — and it already avoids the per-subject tokenisation landmine, so
  whatever it is doing wants measuring before it wants changing. The one layout lever left is
  parallelism across nodes, which preserves each node's accumulation order and therefore byte-identity;
  it wants its own decision rather than a paragraph in this one.

- **And the budget breach is closed: 4.44 ms/file against a 5.00 ceiling, byte-identically.** The
  entry above stopped at 5.25 and named `placement/distractors.ts` as the next lever. It was, and the
  first attempt at it is the finding worth keeping.

  `treeSibling` is **75.7%** of that file, and it scores `max` over the changed files of the shared
  directory prefix by widening outward per anchor — `anchors × candidates`, **1.73M steps** on django.
  So a prefix trie, giving the same maximum in `candidates × depth`. Built, verified byte-identical on
  five repositories, and it left the strategy at **1,138 ms against 1,094**. **The scan was never the
  cost**; the rewrite is reverted and lives only in ADR-0038.

  The cost is the line after it. `[...scored.keys()].sort(…).slice(0, limit)` orders **1,136,093
  candidates across django's deck** to keep 19 apiece — **792 ms**, 5% of the whole index, spent
  ordering candidates nobody looks at. `src/verbs/rank.ts`'s `topBy` keeps a bounded shortlist and is
  *exactly* sort-then-slice under a total order, which every caller has because each comparator ends
  on a unique node id. `nameSimilar` and `structural` share the pattern and were **not** converted —
  they were not measured hot, and converting an unmeasured caller is how the trie happened.

  Two smaller proven wins in the same file: `sharedPrefix(segments, …)` inside the widening walk **is
  always `depth`** (asserted over every pair on three repos — **0 mismatches in 1,971,833**), and the
  bucket walk is not worth restructuring (visits are **1.08×** unique refs).

  Measured with **interleaved** rounds through `scripts/budget.ts` after a discarded warm-up, because
  a batched before/after reads this container's ±25% drift as a result — an un-interleaved run of the
  same code produced 23.1 s and 26.5 s first-of-batch outliers. Three rounds, `topBy` ahead in all
  three: **16.01 s → 14.54 s → 13.48 s** across master, layout+walk, and this.

  **Two mutants of `topBy` survive its test file and both are equivalent** under the documented
  total-order precondition — recorded in the test rather than chased, since killing them would pin
  behaviour the module refuses to promise.

  **Next**: `docs/experiments/0001` needs twelve participants (owner-only). Then region arches in the
  world (ADR-0032 §9.6). The layout's remaining lever is parallelism across nodes, which preserves each
  node's accumulation order and therefore byte-identity; it wants its own decision.
