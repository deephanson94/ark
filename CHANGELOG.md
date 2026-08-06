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
