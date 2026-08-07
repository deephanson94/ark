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
  fixed startup cost and would flake on a shared runner. Fixed one portability bug found by reading
  for the Windows leg: `GIT_CONFIG_GLOBAL` was hard-coded to `/dev/null`, which does not exist on
  Windows, so git would have silently fallen back to the user's real global config — now
  `os.devNull`. Added `.gitattributes` pinning `eol=lf` so checkouts agree across platforms.
  **Next**: M1 — the map render. Every node carries `layout` and `region` and nothing draws them.
