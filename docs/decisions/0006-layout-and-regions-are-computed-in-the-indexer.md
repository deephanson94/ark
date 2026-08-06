# ADR-0006 — Layout and regions are computed in the indexer, with portable arithmetic

- **Status**: accepted
- **Date**: 2026-08-06
- **Extends**: NORTH-STAR §7 ("layout is computed in the indexer"), §7.1 (`nodes[].layout`, `nodes[].region`)

## Context

`nodes[].layout` and `nodes[].region` are required fields in the north star's atlas sketch, so M0
cannot emit a schema-valid atlas without producing both. NORTH-STAR §7 also fixes *where* layout
runs — the indexer, not the player — so that the same repo yields the same map on every machine.

Neither is UI work, and neither is in this milestone's stated scope beyond "the indexer emits a
valid atlas". Both are implemented here at the minimum size that makes the field honest.

CLAUDE.md names force-directed layout as a landmine: *"Force-directed layout is nondeterministic by
default. Seed the PRNG, fix the iteration count, never call `Math.random()`."*

There is a second, quieter version of that landmine. `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`
and `Math.log` are **implementation-defined** in ECMAScript — engines may differ by an ulp, and do.
A layout built on them is deterministic on one machine and subtly different on another, which is
precisely the failure `test:determinism` cannot see, because it runs both passes on the same
machine.

## Decision

### Layout (`src/indexer/layout.ts`)

A small force-directed layout: neighbourhood repulsion over a uniform grid, spring attraction along
edges, weak gravity toward the origin, 300 iterations with linear cooling and per-step clamping.

- **No `Math.random()`.** Initial positions come from a lattice; the jitter that breaks its
  symmetry comes from a seeded 32-bit LCG.
- **No transcendental functions.** Only `+ - * /` and `Math.sqrt` appear, and IEEE-754 specifies
  all five exactly. Coincident nodes are separated along an axis derived from their index
  difference rather than a random direction.
- Coordinates are rounded to 2dp, which keeps the serialised form short and stable.
- `tests/unit/layout.test.ts` asserts run-to-run equality, and greps the function source for the
  forbidden `Math.*` calls as a canary — a comment saying "don't use `Math.sin`" is not a control.

`d3-force` was the north star's suggestion and is not used: its `jiggle()` calls `Math.random()` for
coincident nodes, which is the exact landmine, and the layout here is ~150 lines with no dependency.

### Regions (`src/indexer/regions.ts`)

Label propagation over the undirected import graph: fixed visiting order, ties broken by lowest
label, bounded passes. Regions are named after the deepest directory their members share, and the
id is a slug of that with a numeric suffix on collision.

Files with **no import edges** — standalone markdown, config — are the honest exception. Topology
says nothing about them, so they are grouped by directory instead. Pillar 4 says a node is never
moved for aesthetic reasons; it does not say we should invent a topological claim where there is
none.

## Alternatives rejected

**Leave `layout` and `region` out of v1 and add them at M1.** Then the schema's required fields are
not required, the player has nothing to render, and — worse — the determinism test never covers the
single most likely source of nondeterminism in the whole project. The landmine list names force
layout explicitly; shipping the canary without the thing it is watching for is the wrong order.

**Compute layout in the player.** Directly contradicts NORTH-STAR §7. Same repo would mean a
different map per machine, per browser, and per session.

**Use directories as regions.** Cheaper, deterministic, and a pillar-4 violation: it makes the map
a picture of the filing system rather than of the dependency structure. The interesting fact about
a codebase is exactly where those two disagree.

**Barnes-Hut quadtree instead of a uniform grid.** Better asymptotics, ~120 more lines. The grid
holds 2,000 nodes inside the index budget today (this repo: 40 nodes, 90 ms end to end). Revisit
when a real repo makes it hurt.

## Consequences

- The atlas is renderable the moment a player exists; M1 is a rendering problem, not a data one.
- Layout is bit-identical across conforming engines, not just across runs on one machine — which is
  a stronger property than `test:determinism` can verify, and the reason the arithmetic constraint
  is written down here rather than left as a habit.
- Layout quality is untuned. On this repo the import graph collapses into a few large regions,
  which is true but not yet especially *legible*. Improving that is an M1 concern with a map to
  look at; doing it now would be tuning against a number instead of a picture.
