# ADR-0009 — Third person is a presentation layer over the same atlas, and it is gated

- **Status**: accepted, **gated** — see "The gates" below. No implementation work before M4.
- **Date**: 2026-08-07
- **Amends**: NORTH-STAR §9 ("v1 is 2D") and Appendix B ("3D world — why not"). Both now point here.
- **Extends**: ADR-0006 (layout and regions are computed in the indexer)

## Context

The human asked for a third-person point of view — a camera behind a figure moving through the
codebase — and asked whether the work so far is wasted. Two separate questions, and they have
different answers.

This ADR exists because `CLAUDE.md` forbids changing the north star quietly. §9 says *"v1 is 2D"*
and Appendix B lists a 3D world under what we are **deliberately not** borrowing from Promptasy.
Shipping a third-person view without writing this down would leave the spec contradicting the
product, which is exactly how ADR-0001's `indexedAt` came back and what ADR-0008's amendment note
was written to prevent.

## Is the work so far wasted? No — and here is the measurement rather than the reassurance

Counted at the commit that shipped M2:

| | lines | fate under a third-person view |
|---|---:|---|
| `src/atlas`, `src/verbs`, `src/indexer` (minus layout) | **5,292** | untouched |
| `src/player/camera.ts`, `draw.ts`, `labels.ts`, `zoom.ts` + `src/indexer/layout.ts` | **741** | rewritten or extended |
| `src/player/fog.ts`, `progress.ts`, `challenge.ts`, `ui.ts`, `scene.ts` | ~740 | mostly kept; `scene.ts` gains a Z |
| `tests/` | 3,662 | ~90% untouched — almost none of it renders anything |

**88% of the code is presentation-independent, and that is not luck.** NORTH-STAR §7 put a hard wall
between the indexer and the player and made the player "a pure function of `atlas.json`". Everything
expensive — the import scanner, rename-following identity, the co-change matrix, guardrail 4, the
F1 grader, the four distractor strategies, computed difficulty, the reveal — sits on the atlas side
of that wall and cannot tell what is drawing it. The one renderer-shaped thing in the atlas is
`node.layout`, which is two numbers.

What *is* at risk is the 2D canvas renderer: roughly 740 lines, the smallest and cheapest layer in
the project. And M1's real deliverable was never those lines — it was the answers to "is a derived
map legible", "does fog read as honest or as withholding", "does a fixed layout build spatial
memory". Those answers survive the renderer that produced them.

So the honest position is: **the pillars and the seam were designed for exactly this, and they
held.** That is a point in favour of the architecture, not a reason to change the presentation.

## Is third person a good idea? Genuinely arguable, and the arguments cut both ways

This section is the ADR. Recording only the decision would waste it.

### For

1. **Spatial memory is the mechanic the whole product rests on**, and embodied navigation is a much
   stronger device for it than pan-and-zoom. §7 already sacrifices flexibility for it — "layout is
   computed in the indexer… same repo ⇒ same map, every session, on every machine" — on the grounds
   that spatial memory of a codebase must persist. The method of loci works because you *walk* the
   palace. A third-person view is the strongest available version of the thing §7 is already paying
   for.
2. **The framing is already spatial and already embodied.** §4 opens *"You are not a tourist. You
   are a cartographer arriving at a shore that already exists."* Fog of war is a first-person device
   wearing a top-down coat. The product's own language has been describing a place you go to, not a
   diagram you look at.
3. **It may be the answer to risk #2 (scale).** A 10,000-file monorepo is an unreadable hairball
   from above and that is a stated, unsolved risk. You cannot read a 10k-node graph in one frame,
   but you can stand in one district of it. Embodiment converts an unreadable overview into a
   legible local view — which is the same trick semantic zoom is attempting, done more forcefully.
4. **It may be the answer to risk #4 (fog frustration).** "Always show the silhouette of unexplored
   regions" is a compromise on a flat map. On a horizon it is just true: you can see the shape of
   the district ahead and not read its signs yet.

### Against

1. **Pillar 4, which is the one that matters.** *"The map's layout is derived from the real graph.
   If a visual choice makes the picture prettier but less true, it loses. Violated when: a node is
   moved for aesthetic reasons."* A walkable world has affordances a graph does not: a ground plane,
   a gravity direction, walls, a horizon. Every one of those is geography the topology did not ask
   for, and each is an invitation to move a node so the world reads better. This is not a
   hypothetical — it is the specific failure Appendix B named.
2. **Pillar 6, ten minutes to first insight.** Tier 1 of the curriculum is *Orientation*: "what are
   the top-level regions?" A single fitted frame answers that in one glance. A walkable world
   answers it only after you have walked, and the fastest way to answer it inside a 3D world is to
   fly up and look down — i.e. to rebuild the 2D map at runtime. Any third-person design that does
   not keep an instant overview has made the product slower at its own first tier.
3. **Occlusion is a real cost, not a rendering detail.** The information in this product is in the
   *edges*. In 3D, nodes hide behind nodes and edges cross in depth, and 3D graph layouts are
   reliably harder to read than 2D ones for exactly the questions Blast Radius asks. Trading edge
   legibility for immersion trades away the thing being taught.
4. **Prior art is evidence and it is not encouraging.** NORTH-STAR risk #6 names **CodeCity** — a
   3D city metaphor for codebases — among adjacent projects that are dead. Risk #6 also says to do
   that research *before* betting against the failure mode. We have not done it. Building a 3D view
   before reading why the 3D one died is the exact mistake the risk register warns about.
5. **The kill point just told us the content is not proven.** M2 shipped a working loop and a
   caveat: 30 of 37 answer keys are the same size, five pairs of subjects have identical answer
   keys, and the co-change distractor strategy has fired zero times because this repo has fourteen
   commits. **The open question is whether the questions stay interesting, and no camera answers
   it.** Spending the next milestone on presentation would be answering the question we can see
   instead of the one we cannot.

## Decision

**Third person is accepted as a presentation layer, subject to four gates and one hard invariant.**

### The invariant

> **The world is a rendering of the atlas. The atlas is never a rendering of the world.**

No position, no adjacency and no region membership may be chosen because it makes the world
navigable. If a layout is nicer to walk through and less true to the graph, it loses — pillar 4 is
not suspended by this ADR, it is the thing this ADR is constrained by. Concretely: the third
dimension must be **derived**, exactly as `layout` is today (ADR-0006), computed in the indexer,
deterministic, and defensible as a graph property. A plausible derivation is depth in the dependency
order — leaves low, entry points high, so "upstream" is literally up — but that is a candidate, not
a decision.

### The gates

Third-person work does not start until all four are met.

1. **Prior art, done properly.** Risk #6, closed: write up why Sourcetrail, CodeSee, CodeCity and
   Gource failed, and state in writing whether the failure mode was *3D* or *generality*. If it was
   3D, this ADR is superseded and we say so.
2. **The content question is answered first.** M3 (progression) and M4 (git-derived verbs) ship, and
   Ark is pointed at a large repo with real history — the one that will finally exercise the
   co-change strategy. If the loop is not interesting in 2D on a real codebase, a camera will not
   rescue it, and we would be polishing something that does not work.
3. **The overview survives.** Pillar 6 is non-negotiable: an instant, readable, whole-repo view must
   remain one keypress away and must be the arrival state. The third-person view is a *mode*, not a
   replacement. If the design cannot keep both, the flat map wins.
4. **It is measured, not felt.** Risk #1 already demands a transfer playtest. This gets the same
   treatment: map a repo in each mode, then measure cold recall of entry point, top-level regions
   and the most-depended-upon module. **Third person ships only if it beats the flat map on recall.**
   "It feels more immersive" is not a result — CLAUDE.md's own rule is that a threshold which cannot
   fail is not a test.

### What this costs, stated up front

- **A runtime dependency.** The player has zero today against a budget of three; a 3D renderer is
  one. That fits, and it should be spent knowingly rather than discovered.
- **The interaction budget gets harder.** "≥ 50 fps @ 2,000 nodes" is currently met by Canvas 2D
  with culling. `npm run budget` still reports map interaction as **UNMEASURED** for raster cost —
  that hole must be closed *before* a 3D renderer arrives, or we will not be able to tell whether it
  regressed something we never measured.
- **A schema change.** `layout: [number, number]` becomes 3D. That bumps `ATLAS_VERSION` and ships a
  migration or an explicit "reindex required" error (guardrail 5). Cheap now, and it is the only
  atlas change this whole direction needs — which is itself the evidence for the "not wasted"
  answer above.

## Alternatives rejected

**Reject it outright and keep §9 as written.** The arguments *for* are real, particularly the
spatial-memory one, which engages pillar 4 rather than overriding it. A flat refusal would also
throw away the observation that risk #2 has no other proposed answer.

**Build it now, at M3.** This is what the request most naturally reads as, and it is the one thing
the M2 result argues against. The kill point produced a caveat, not a clean pass; the honest next
move is to find out whether the questions hold up on a real codebase. Presentation is the cheapest
thing to change later and the most expensive thing to be wrong about now.

**First person instead.** Strictly worse here. The player's proxy is a cartographer, and a
cartographer needs to see themselves *in* the terrain to place anything relative to anything else.
Third person keeps the surveying stance; first person is a corridor.

**A 3D fly-through with no avatar** (an orbit camera over an extruded map). Cheaper, keeps the
overview for free, and gets most of the depth cue. Kept explicitly on the table as the fallback if
gate 3 proves impossible — it is the version of this that cannot violate pillar 4, because there is
nothing to walk on.

## Consequences

- NORTH-STAR §9 and Appendix B carry an amendment note pointing here. Neither is deleted: their
  reasoning is still the reasoning, and this ADR is the conditions under which it is revisited.
- `npm run budget`'s unmeasured map-interaction row becomes a blocker for this direction rather than
  a known gap. Closing it is small and should happen at M3.
- The roadmap does not change. M3, M4 and M5 stand as written; this is a **new M7**, after the
  generalisation milestone, and it is conditional on the four gates.
