# ADR-0013 — Height is the transitive dependent count, and it is frozen

- **Status**: accepted
- **Date**: 2026-08-07
- **Extends**: ADR-0006 (layout is computed in the indexer), ADR-0009 (third person is a
  presentation layer), ADR-0008 (truth is the unbounded dependent set)
- **Bumps**: `ATLAS_VERSION` 3 → 4. `AtlasNode` gains `elevation`.
- **Reviewed by**: Fable, which disagreed with three things. Two are adopted below and the third is
  recorded with the reason it was not.

## Context

ADR-0009 fixes one invariant about a third dimension — it must be **derived from the graph** and
**additive, preserving today's X,Y** — and then leaves the actual quantity open, listing "depth in
dependency order, upstream is up" as a candidate.

That gap is dangerous in a specific way. X,Y are frozen because a re-layout scrambles every map
anyone has learned. **Vertical memory has the identical argument and nobody had written it down.**
If the 2D map teaches "tall = many things depend on this" and a later rung switches to "tall =
far upstream", every learned height *inverts* — the two quantities are near-opposites, since an
entry point has maximal depth and zero dependents. So the quantity is decided once, here, before
any pixel ships.

## Decision

> **`elevation` = the bit length of `|dependents(node, ∞)|`.**
> 0 dependents → 0, 1 → 1, 2–3 → 2, 4–7 → 3, 8–15 → 4. One layer up is twice as depended-upon.
> Computed in the indexer, stored per node, and **the meaning does not change in any later rung.**

### Why this quantity

It is what Blast Radius already grades on (ADR-0008), so the landscape and the questions describe
the same thing. And the map is currently silent about it. Measured across four repos, restricted to
the nodes that actually have dependents, cone size correlates with what the map already draws at:

| | vs `loc` (disc radius) | vs direct in-degree (label priority) |
|---|---:|---:|
| ark | −0.19 | **−0.03** |
| svelte | 0.07 | **0.07** |
| hono | 0.32 | 0.77 |
| vite | 0.56 | 0.75 |

NORTH-STAR §4 says a session should end with the player able to name *the most-depended-upon
module*, and nothing on the map helps. On this repo the peak is `src/atlas/schema.ts` — 271 lines,
61 dependents — and its disc is indistinguishable from any other mid-sized file.

> **A trap for whoever re-measures.** Over *all* nodes, cone-vs-in-degree reads 0.91–1.00 and
> elevation looks redundant. That is an artifact: 50–90% of nodes have no dependents *and* no
> importers, and that single tie drives the statistic. Restrict to non-empty cones first.

### Why quantised, and why by bit length

Quantised because `docs/prior-art.md` §4.3.4 imports a measured constraint: spatial memory for item
locations degrades **monotonically** as freedom in a third dimension grows (Cockburn & McKenzie, CHI
2002, n=69, in physical environments as well as virtual), and Patchworks' navigation gains came
where placement was *constrained*. Spatial memory is this product's core mechanic.

Bit length rather than a per-repo rank or percentile, because **a rank is a function of every other
node's cone.** One new file would restack the whole landscape, and the save is keyed to the repo
rather than to the commit (ADR-0011) — so the player would return to a world that had rearranged
itself vertically for reasons they cannot see. This is the same defect this session already removed
from `dedupe`'s representative rule. Bit length depends on the node's own cone and nothing else, and
it means the same thing in every repo: layer 8 is 128–255 dependents, here and anywhere.

`32 - Math.clz32(n)`, never `Math.log2` — ADR-0006 forbids transcendentals in layout and the same
rule carries here.

### What follows from it, stated so nobody rediscovers it

- **A cycle is a mesa.** Every member of an SCC has the identical dependent set, so a ring of files
  renders as a plateau of equal height. That is true — a cycle is one quasi-module — and it is the
  same root cause as ADR-0012's duplicate answer keys. Being able to *see* it from a distance is a
  feature.
- **The distribution is lumpy, and that is the terrain.** 56% of this repo, 74% of vite and 90% of
  svelte sit at layer 0. Svelte's top layer holds 339 files that all reach ~3,000 others through one
  barrel. A repo shaped like a cliff should look like a cliff; smoothing it into rolling hills would
  be moving nodes for aesthetics, which pillar 4 loses.
- **Every edge kind counts**, including `type` and `probable`. This is the shape of the place, not
  an answer key. Guardrail 4 governs what may be *asked*, never what may be *drawn*, and a
  silhouette that dropped uncertain edges would misdraw the terrain in exactly the districts a
  player most needs to distrust.
- **It loosens ADR-0008's presentation rule, on purpose.** The map shows direct importers only until
  a node is `understood`; a height channel states every node's transitive reach bucket from first
  paint, silhouettes included. That is accepted — risk #4's own logic is that you should always see
  *that* there is a mountain without seeing what it is, and `truth` ships in plaintext anyway so it
  is not a grading leak. Recorded because it is a change to what the fog withholds, not a side
  effect.

### The caveat, adopted with eyes open

**Entry points sit at sea level.** Under this Z a file nothing imports is flat ground, and tier 1's
first curriculum question is *"where does execution start?"* — so height anti-serves it. The
landmine list already warns that zero dependents does not mean dead. This is accepted rather than
solved: height means load-bearing and **must not be marketed as "importance"**. Entry points get
their own manifest-derived glyph in a later rung; one scalar will not serve both questions.

## Rejected

**Rank or percentile within the repo.** Restacks on every commit; degenerate where most nodes tie at
zero; and it flattens a power law into rolling hills, which is the pillar-4 violation above. §8.4's
per-repo normalisers are not a precedent — they rank *within a deck* to spread a progression,
whereas this is a claim about a file.

**A third entry in `layout`.** `layout` is the force simulation's output: continuous, `round2`
floats, whole-graph, iterative, with ADR-0006's stability argument behind it. Elevation is an
ordinal integer from a per-node graph query. Folding them into one tuple invites consumers to
compute 3D distances across incommensurate units — and a 2D cohesion assertion in the test suite
already does exactly that in 2D — then forces `Region.centroid` to grow a third component whose
value would be a mean of log buckets, which is not a meaningful statistic. A separate field leaves
`asPoint` and `centroid` untouched.

**Computing it in the player instead of the indexer.** *This is Fable's recommendation and it is not
taken.* The argument for it is strong: elevation is a pure function of `edges`, the arithmetic is
integer-exact on every engine so ADR-0006's float-divergence reason does not apply, it costs ~7 ms,
and **ADR-0009 explicitly warns "do not bump early — carrying a dead Z coordinate through several
milestones with no renderer to use it is worse than the change itself."** Three things outweigh it.
(1) The renderer arrives in the *same* session, not several milestones later, so the coordinate is
never dead. (2) In the atlas it falls under `test:determinism`, the canary this project treats as
its most important assertion; in the player it would be covered by nothing. (3) The atlas is the
contract, and a derived fact that both sides need should be computed once by the side that already
holds the graph. Recorded rather than quietly overridden, because if rung 2 does *not* land, this
decision was wrong and the next session should revert it.

## Consequences

- `ATLAS_VERSION` 3 → 4; `docs/atlas-format.md` §3.2 in the same commit. The v3 → v4 migration is
  computable from a v3 atlas without a reindex, since elevation is a pure function of `edges`.
- The renderer clamps, the schema does not. Data keeps full resolution (0–12ish); a view that cannot
  discriminate twelve ordinal steps collapses them in `palette.ts`, which is a presentation constant
  changeable without a reindex.
- **Not** named `depth`: `evidence.depth` already means something else.
