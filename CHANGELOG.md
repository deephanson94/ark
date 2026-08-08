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
  **58.9% of this repo's key members already stated by a Placement reveal, and 17 of 70 candidate
  boards entirely**; excluding them costs 41 subjects here (deck 40 → 27) and 21 on hono (54, still
  capped). The order of two lines in the generator is the whole of that rule: membership is computed
  from the **unfiltered** toucher list, so an excluded commit leaves the board altogether rather than
  dropping into the distractor pool — which is the wrong answer key ADR-0019's own probe shipped
  inside the counterfactual that was about to justify the rule.

  **Re-running the ADR's tables against the real generator was the first task after building it, and
  one row inverted.** Structural figures reproduce; the window guess maxes at **0.462** against a
  predicted 0.46, which is decision 5's arithmetic to the digit. But the gate table swapped ends:
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

  Measured: **27 boards here** (supply binds) and **54 on hono** (the cap binds), keys of 2–6
  commits, lifting 1 of this repo's 21 unprovable nodes and **16** of hono's 154. Four verbs now
  leave **20 of ark's 140** nodes unprovable where Blast Radius alone leaves 54. Atlas 249.8 KiB in
  ~455 ms, all budgets inside their ceilings, byte-identical across two runs. The reveal states
  relations and never identities — *"it changed a file that imports this one"*, never which — because
  naming it would hand over that commit's Placement key, ADR-0014's finding 3 running the other way;
  and it never prints a commit's width, which is `broadKnown`'s input. Both pinned by tests that fail
  when mutated.

  Adding Archaeology's invariant to `tests/atlas/` revealed that **Placement had never had one on the
  real atlas** — it lived only in a unit fixture. Both are there now, with the cross-verb disclosure
  check, which is the one property neither verb can see and which the `(verb, truth)` uniqueness rule
  structurally cannot express, since one key holds node ids and the other commit ids.

  **Next**: the **negative witness** — a wrong pick already has a known reason class (sibling,
  name-alike, structurally-near non-dependent, co-change ghost, message-mention), the generator
  *chose* it for that reason, and no reveal says which. Decide the one design fork first: strategy
  provenance either ships in the atlas (a schema change, so `ATLAS_VERSION` and
  `docs/atlas-format.md` in the same commit) or is re-derived player-side from the graph, which needs
  no bump. After that, the **phenomenon catalogue** — a repo-independent vocabulary of ~30–60
  structural phenomena, the atom that would let anything *transfer* to another repo, which is the
  other half of risk #1.
