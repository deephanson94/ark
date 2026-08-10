# ADR-0032 — The walkable world is a city on a plane, and the plane is deliberately empty

- **Status**: **proposed.** No code. This is the design ADR-0009's rung 3 requires before any
  third-person work, and it exists to be attacked before it is built.
- **Date**: 2026-08-10
- **Implements**: [ADR-0009](./0009-third-person-is-a-presentation-layer-over-the-same-atlas.md) rung
  3, under its invariant, design constraints D1–D3 and ship criterion S1; NORTH-STAR §9's *Direction*
  note (*"a third-person world you explore … Zelda and Assassin's Creed"*)
- **Bears on**: pillar 4 (geography is topology), pillar 6 (ten minutes to first insight),
  ADR-0006 (deterministic layout), ADR-0013 (elevation), the runtime-dependency budget
- **Bumps**: nothing yet. §7 says what a build would bump and why not to bump early.
- **Reference implementation**: `romanticamaj/promptasy` — MIT, same author, a shipped third-person
  world. Read rather than imagined; §2 is what it cost and §3 is where ark must diverge from it.

---

## 1. The one question that can kill this, and it is not the renderer

A walkable world over ark is not blocked by graphics. Three.js is mature, ADR-0009 already budgeted
the dependency, and the reference implementation exists and is liftable. The question that decides
it is narrower and nobody has asked it:

> **Ark's layout was computed to be read from above. Does it read as a *place* at eye level, or as a
> field of poles?**

`layout.ts` is a seeded force simulation tuned for legibility in a fitted frame. Nothing in it knows
about sightlines, streets, approach, or the horizon. It has never been looked at from inside. If the
answer is *a field of poles*, then no character controller, no lighting pass and no amount of
Three.js fixes it — the fix would be a re-layout, and a re-layout is forbidden by ADR-0009's
invariant because it destroys every map anyone has learned.

**So this ADR's staging (§6) puts that question first, before a body exists**, and everything else is
contingent on it.

---

## 2. What the reference implementation costs, measured rather than guessed

ADR-0009 priced rung 3 as unknown. `romanticamaj/promptasy` at `245652d6` is the answer, from the
same author, MIT-licensed:

| | |
|---|---|
| runtime dependencies | **`three@0.170`, `howler`** — two |
| total source | ~32,000 lines |
| the walkable layer specifically | `engine` 590 + `player` 476 + `character` 504 + `world` 3,302 + `props` 2,312 + `handles` 875 + `reactive` 861 ≈ **8,900 lines** |
| locomotion | `MOVE_SPEED = 11.5` units/s, run ×1.75, damped follow camera, FOV widening under run |
| ground | `PlaneGeometry` with per-vertex colour, plus a `heightAt(x, z)` terrain field |
| districts | **hand-placed**: `{ id: 'grounding', x: 95, z: -95, radius: 46, flat: 34 }` |

**8,900 is the wrong number to quote at ark, and this paragraph said it was the headline until the
alternatives section at the bottom of the same document contradicted it.** Recorded rather than
silently fixed, because *prose contradicting a number in the same document* is the defect class this
repo's reviews find most often, and the draft committed it inside the section whose whole job is
costing the thing.

Split by what ark can actually use:

| | lines | ark's fate |
|---|---:|---|
| `engine` + `player` + `character` | **1,570** | **liftable as-is** — presentation-independent, MIT, same author |
| `world.js` + `props.js` | **5,614** | **unusable** — authored geography, hand-placed districts, lore props |
| `handles` + `reactive` | 1,736 | interaction affordances; partly applicable, unpriced |

Ark replaces the 5,614 with a **fold over the atlas** — monoliths from nodes, arches from region
centroids, no props and no lore — which is a much smaller program than a hand-built place. A
defensible estimate is **~2,500–3,500 new lines** against a `src/player/` that is **4,811 today**: a
50–70% increase in the player, not a tripling of the product. Still the largest single change this
project would have made, and roughly a third of what the headline implied.

**The dependency is affordable and was already earmarked.** `npm run budget` prints
`player runtime deps 0` against a ceiling of 3, and ADR-0009 says *"a 3D renderer is one. It fits,
and it should be spent knowingly."* `howler` is not needed.

---

## 3. Where ark must diverge, and it is the last line of that table

`{ id: 'grounding', x: 95, z: -95, radius: 46, flat: 34 }` is a district placed where it reads best.
Promptasy is entitled to that and ark is not — NORTH-STAR §9 already says why: *"Promptasy could
impose arbitrary geography because a curriculum has no natural shape; a codebase does."*

Ark's X,Y are frozen by ADR-0009's invariant, and the reason is not fastidiousness: a re-layout is a
one-time destruction of the spatial memory the whole product is built to create.

**That is the constraint. What follows is the design that satisfies it.**

### 3.1 The measurement that decides the form

Taken from the shipped atlases of four repos:

| repo | nodes | layout span | nearest-neighbour min / median / max | elevation distribution | regions |
|---|---|---|---|---|---|
| ark | 171 | 475 × 455 | 11.8 / **18.6** / 113.4 | **98 of 171 at 0**, rest 1–7 | 16 |
| hono | 425 | 763 × 748 | 10.3 / **18.0** / 93.9 | 207 of 425 at 0, rest 1–8 | 57 |
| hugo | 1,242 | 723 × 748 | 8.2 / **13.0** / 21.2 | **1,045 of 1,242 at 0**, then 175 at 8 | 18 |
| django | 3,035 | 1,049 × 1,095 | 6.5 / **12.3** / 24.1 | 2,054 of 3,035 at 0, rest to 12 | 175 |

Two facts fall out and they settle the whole shape of the world:

**The world does not grow the way the repo does.** 171 nodes span 475 units and 3,035 span 1,049 —
18× the nodes for 2.2× the span. The force layout holds density roughly constant, so **node spacing
is the invariant, not world size**: a median gap of 12–18 units on every repo measured, and a
minimum of 6.5.

**Elevation is bimodal, not a landscape.** 57–84% of every repo sits at elevation 0, with a thin tail
running to 7–12. ADR-0013 makes elevation the *bit length* of the transitive dependent count, so it
is logarithmic by construction: most files are load-bearing for nothing, a few carry everything.

Put together: ark's entire map is roughly the size of **three or four Promptasy districts**, and its
nodes sit closer together than Promptasy's props do. It is not a landscape with regions scattered
across it. **It is a dense city on flat ground, with a handful of towers.**

### 3.2 Decision: the ground is a plane, and that is the pillar-4 answer

The instinct — and the thing this ADR set out to design — was *derive terrain from the layout so
walking is reading the graph*. That is the wrong answer and the elevation histogram is why: a field
that is 57–84% zero derives a flat plain with spikes, which is not terrain, it is a plain with
spikes. Deriving hills from something else (churn, region membership, distance from a centroid) would
be **inventing geography and calling it derived**, which is precisely the failure pillar 4 names.

> **The ground is a featureless plane. It carries no information, and that is the point.**

A plane is not a claim about the repository. It is the *absence* of one, and it is the only ground
that cannot be wrong. Every vertical thing standing on it is derived and already computed:

| thing in the world | derived from | already in the atlas |
|---|---|---|
| a monolith you can walk up to | one node | `layout` (X,Y frozen), `elevation` for height, `loc` for footprint |
| its colour | `region` | `regions[].id`, and the player's palette |
| a named arch marking a district | one region | `Region.label` + `Region.centroid` — **already computed and already drawn as text on the flat map** |
| a lit stone you can interact with | a node carrying an unanswered challenge | the deck; the HUD already counts them (*"88 ringed on the map"*) |
| a grade badge over a cleared one | the band from `scoreSet` | S / A / B / C, already computed |
| darkness over what you have not been to | fog | `Fog`, already a view of `Progress` |

Nothing in that table is authored, and nothing needs a coordinate the atlas does not already carry.
**`Region.centroid` doing duty as the arch position is the load-bearing one**: it is the only reason
districts can be marked without placing anything by hand, and ADR-0009 already flagged it as the
atlas's second 2D point, so it is a known cost rather than a discovery.

### 3.3 Decision: scale the body, never the world

A median 18-unit gap is a street if the character is human-sized against a 3–5 unit monolith
footprint, and impassable if the footprint is 10. So **one atlas unit is one world unit, forever, and
the character and camera are sized to fit the measured spacing.** The alternative — scaling the world
up so it feels like Promptasy's — multiplies django's 1,049-unit span into something that takes a
quarter of an hour to cross, and pillar 6 is ten minutes to *first insight*.

Consequences, both measured:

- **Footprint must be capped**, because `loc` is unbounded and the closest pair on django is 6.5
  units apart. A radius that exceeds half the local nearest-neighbour distance welds two nodes into a
  wall. The cap is a rendering choice and touches no coordinate, so pillar 4 is untroubled.
- **Crossing time is bounded and small.** At Promptasy's 11.5 units/s, django's diagonal is ~91
  seconds and a typical traverse ~40. That is walkable, and it is why the plain must stay at native
  scale.

### 3.4 Decision: the flat map is the map, and it is also fast travel

ADR-0009's **D1** already requires that an instant whole-repo view stays one keypress away and
remains the arrival state. This design does not merely comply with it — it depends on it. Walking
across django to reach a specific file is not exploration, it is commuting.

So the overview key does two jobs: it is the survey view *and* the travel screen. The **"Where next?"**
panel already chooses a target; the compass and a distance readout (Promptasy's `約 85 步`) point at
it while you walk; the map takes you there when you would rather not.

---

## 4. What is missing from the model, and it is one thing

Nearly every element of Promptasy's HUD has an ark counterpart already computed — grades, codex
(field notes), fog, target selection, district labels, heights. **The exception is progression as a
felt quantity**: Promptasy has `10 / TRAVELLER / 200 / 640 XP · 共 3260`, and ark has a deck count.

That is a real gap and it is *not* a rendering concern, so it can be built and tested in 2D before
any of this. It must obey guardrail 6 — **never punish a wrong answer** — which rules out anything
that subtracts, and ADR-0011's rule that a claim is either *proved* or *shown*, never blurred.

---

## 5. What this does not decide

- **The Trace verb (M6).** ADR-0009's **P4** gates the avatar on it, because *"before Trace, the
  product asks no question that walking answers better than orbiting."* This ADR does not open P4;
  only the owner can, and §8 is where that would be recorded.
- **Whether it beats the flat map.** ADR-0009's **S1** is unchanged in force. `docs/experiments/`
  carries the design; this document does not pre-empt its result, and *"if the fly-through does not
  beat the flat map on S1, the avatar never happens"* is still the operative sentence.
- **P1′.** `npm run raster` on real hardware is still unmeasured and still gates a renderer change.
  45/33/43 fps is a headless software-raster floor and **no claim about interaction performance may
  be made from it.**

---

## 6. Staging — the cheap falsifying test comes first

The order is chosen so that the question in §1 is answered before the expensive part is built.

**Stage A — the world with no body in it (a day, not a milestone).** Flat plane, derived monoliths at
frozen X,Y with `elevation` height and capped footprint, region arches at centroids, existing palette.
Viewed with the *current* orbit camera dropped to eye height. No Three.js, no character, no
locomotion — `orbit.ts` already projects and depth-sorts, and 238 lines of Canvas 2D is enough to
answer *does this read as a place*.

**This stage is designed to be able to fail**, and its failure is cheap and informative: if ark's
force layout reads as a bollard field from eye level, we have learned that for a day's work instead
of 8,900 lines, and the honest response is that rung 3 stops there.

**Stage B — the renderer.** Three.js, lifting Promptasy's `engine`/`player`/`character`. Gated on
Stage A reading as a place, on P1′ being measured on real hardware, and on the S1 design being
committed.

**Stage C — the world.** Interaction (`E`), the challenge console over the world rather than the map,
the compass and distance readout, arches, grade badges, fog at ground level.

**Stage D — S1 is run.** Not before, and its result decides whether any of this ships.

---

## 7. Costs, stated before anything is built

- **A runtime dependency**: 0 → 1 of 3.
- **Two budgets, not one.** ADR-0009 names the quiet one: **first paint ≤ 1.5 s**, currently ~400 ms.
  WebGL context creation and shader compilation are exactly what breaks it.
- **CI.** The smoke test fails on any console error and headless WebGL is commonly software-rendered
  and flaky. Expect time here that has nothing to do with the feature.
- **A schema change, and not yet.** `layout` and `Region.centroid` both gain a third coordinate,
  `asPoint` stops asserting two, `ATLAS_VERSION` bumps. ADR-0009: *"cheap when it is actually done —
  do not bump early."* **Stage A needs none of it**, because `elevation` is already a per-node
  integer and the third coordinate is derived at render time.
- **D3 carries forward**: no transcendental functions in any Z derivation, and
  `tests/unit/layout.test.ts`'s source-grep canary extends to cover it — engines differ by ulps in
  ways only the three-platform check can see.

---

## Alternatives rejected

**Derive terrain from the graph.** The design this ADR set out to write. Refused on §3.1's
measurement: elevation is 57–84% zero, so it yields a plain with spikes rather than a landscape, and
any *other* field pressed into the role would be geography invented and labelled derived — pillar 4's
named failure. A flat plane asserts nothing and cannot be wrong.

**Re-layout for walkability — sightlines, streets, plazas.** This is what would actually make the
best world, and it is forbidden by ADR-0009's invariant for a reason that outranks the world: every
map anyone has learned is destroyed once, permanently. If §1's test fails, the answer is that rung 3
fails, not that the layout moves.

**Scale the world up to Promptasy's proportions.** Node spacing is the invariant, not world size
(§3.1), so this multiplies traverse time without adding room — django becomes a quarter-hour walk
against pillar 6's ten minutes to first insight.

**Build the character first because it is the fun part.** It is, and it answers nothing. §1's
question is the one that can kill this, and a character controller is the most expensive possible way
not to ask it.

**Lift Promptasy's world wholesale.** Refused, and §2's table is the split: `world.js` and
`props.js` are authored geography and are exactly what ark may not have. What transfers is the
engine, the character and the locomotion.

---

## 8. Who decides, and what is still open

ADR-0009: *"the human, in a dated note appended to this ADR. An agent session may propose that a
precondition is met; it may not decide it."* This document is a proposal in exactly that sense.

Open, and the owner's to settle:

1. **P4** — the avatar is gated on the Trace verb (M6), which does not exist.
2. **S1** — recorded as in breach since the orbit merged without a committed experiment design. The
   design is now written (`docs/experiments/0001-…`), which clears the *merge* half; the *ship* half
   needs the experiment run.
3. **P1′** — `npm run raster` on real hardware. Owner-only; no session can take it.
