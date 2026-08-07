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
