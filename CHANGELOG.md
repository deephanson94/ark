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
