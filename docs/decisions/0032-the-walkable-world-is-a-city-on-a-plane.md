# ADR-0032 — The walkable world is a city on a plane, and the plane is deliberately empty

- **Status**: **proposed, and substantially wrong.** No code. It was attacked before being built,
  which is what it was for, and **§9 is what did not survive** — a measurement bug in §3.1, a world
  model with no edges in it, a staging plan whose cheap test cannot work, and a gate described as
  half of itself. Read §9 before acting on anything above it.
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

Measured on ark at **`fe1561f8`**, hono `7075369e`, hugo `44da08608`, django `c9eb16a87e`. Ark
indexes itself, so that sha is load-bearing: the same table at `e3a930f` reads 173 nodes.

| repo | nodes | layout span | nearest-neighbour min / median / max | at elevation 0 | regions |
|---|---|---|---|---|---|
| ark | 171 | 475 × 455 | 11.8 / **18.6** / 113.4 | 98 of 171 — **57.3%** | 16 |
| hono | 425 | 763 × 748 | 10.3 / **17.9** / 93.9 | 207 of 425 — **48.7%** | 57 |
| hugo | 1,242 | 723 × 748 | 8.2 / **12.8** / **38.9** | 1,045 of 1,242 — **84.1%** | 18 |
| django | 3,035 | 1,049 × 1,095 | **5.8** / **11.9** / **47.3** | 2,054 of 3,035 — **67.7%** | 175 |

> **Three of those cells were wrong in the first draft** — hugo's max read 21.2, django's min and max
> read 6.5 and 24.1 — because the probe that produced them sampled `Math.min(N, 400)` nodes. ark and
> hono are under that cap and reproduced **to the digit**; the two large repos did not, which is this
> repo's own landmine about a bad column being findable only because the good ones are exact. The
> minimum is what §3.3 reasons from, so it was wrong where it mattered.

Two facts fall out and they settle the whole shape of the world:

**The world does not grow the way the repo does.** 171 nodes span 475 units and 3,035 span 1,049 —
18× the nodes for 2.2× the span. The force layout holds density roughly constant, so **node spacing
is the invariant, not world size**: a median gap of 12–19 units on every repo measured, and a
minimum of **5.8**.

**Elevation is bottom-heavy, and on the large repos it is not a thin tail.** Between **48.7%**
(hono) and **84.1%** (hugo) of nodes sit at elevation 0 — the first draft wrote *"57–84% of every
repo"*, a range its own table excludes hono from. And *"a handful of towers"* is ark's shape read
onto everyone: hugo has **175 nodes at elevation 8**, its maximum, 14% of the repo standing at
identical height, and django has 212 at 12. On the large repos the skyline is a **plateau**, not a
few spires — almost certainly one large strongly-connected component sharing a dependent count.

Put together: ark is **not** small beside Promptasy, which the first draft asserted and got backwards
— Promptasy's `WORLD_RADIUS` is 150 on a 340 × 340 plane, so ark's 475 × 455 span is roughly **1.9×
its entire world by area**. What survives is the density claim: nodes 12–19 units apart on a span of
hundreds is **a dense city on flat ground**, and the towers are commoner and blunter than the phrase
suggested.

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

- **Footprint must be capped**, because `loc` is unbounded and the closest pair on django is **5.8**
  units apart. A radius that exceeds half the local nearest-neighbour distance welds two nodes into a
  wall. *The first draft closed this bullet with "the cap is a rendering choice and touches no
  coordinate, so pillar 4 is untroubled", which defends the wrong invariant — see §9.7.*
- **Crossing time is bounded and small.** At Promptasy's 11.5 units/s, django's **width** is 91 s
  and its **diagonal** — 1,049 × 1,095, so 1,517 units — is **132 s**. The first draft called 91 the
  diagonal, which is 45% under, in the flattering direction. Still walkable, and still why the plain
  stays at native scale.

### 3.4 Decision: the flat map is the map, and it is also fast travel

ADR-0009's **D1** already requires that an instant whole-repo view stays one keypress away and
remains the arrival state. This design does not merely comply with it — it depends on it. Walking
across django to reach a specific file is not exploration, it is commuting.

So the overview key does two jobs: it is the survey view *and* the travel screen. The **"Where next?"**
panel already chooses a target; the compass and a distance readout (Promptasy's `約 85 步`) point at
it while you walk; the map takes you there when you would rather not.

### 3.5 Decision: a persistent minimap, and it is the one element that is *not* free

**Proposed by the owner** — *"walkable version with a mini map is a good direction too"* — and adopted,
because it is a better answer than the one this document had. §3.4's overview is *modal*: one keypress
away, but away. A minimap is **continuously on screen**, and the difference matters for a
reason specific to this product rather than to game convention.

`docs/prior-art.md` §4.4's finding is that **map**-derived spatial memory is orientation-specific
while **navigation**-derived memory is not — which is ADR-0017's whole reason for existing, and note
that on that single axis it favours walking rather than the map. The finding that cuts the other way
is §2's: traversing a virtual building was the **worst** of three conditions (Richardson et al.) and
was *"distinctively prone to disorientation after rotation"*.

A minimap is the only element in this design that keeps the two encodings **co-present**, so the
player binds "where I am standing" to "where that is on the map" continuously rather than by recall
across a mode switch. That is the mechanism by which a walkable world could plausibly produce
map-like knowledge at all; without it the rung is betting entirely on the modality that lost.

**And it is the element that most sharpens §9.1's objection rather than answering it.** The honest
version of the minimap is one that carries the edges, because the world does not. But then the
topology is being taught by a 2D inset drawn over a 3D world — which is an argument that the 2D map
was doing the work all along, and it is the argument S1 has to survive. **The minimap must therefore
be in both arms of `docs/experiments/0001-…` or in neither**, or it confounds the measurement it was
introduced to help. It is not decided here whether it draws edges; that is downstream of §9.1's
redesign.

Three constraints fall out and are decided:

- **It is a rendering of the same `node.layout`**, at the same relative positions. Not a schematic,
  not a simplified graph, not a different clustering. Two maps of one place that disagree is worse
  than one map.
- **It turns with the player**, which is a real cost: a north-up minimap over a heading-locked world
  reintroduces the mode switch it exists to remove, and a turning minimap forfeits the fixed
  orientation ADR-0017 spent a rung establishing. §9.8's note that *"a world cannot rotate under a
  walking avatar"* is the same problem seen from the other end, and neither is solved here.
- **It shows fog**, on the same `understood` set the flat map uses — with the verb-blindness caveat
  ADR-0014 documents, since a minimap is one more reader of shared player state and this repo's
  landmine about that has bitten four times.

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

- **The Trace verb (M6) — and the orbit's own measured results.** ADR-0009's **P4 has two legs**,
  and the first draft of this document named only the first in every place it appeared (§9.5).
  *"Before Trace, the product asks no question that walking answers better than orbiting"* is one;
  the 08-07 owner's note adds *"and on the orbit's own measured results"*, which nothing in this plan
  produces. This ADR does not open P4; only the owner can.
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

1. **P4 — both legs.** The avatar is gated on the Trace verb (M6), which does not exist, **and** on
   the orbit's measured results, which no stage of this plan measures (§9.4, §9.5). The release
   proposed in ADR-0009's 08-10 note was argued against half of it and is withdrawn pending redesign.
2. **S1** — recorded as in breach since the orbit merged without a committed experiment design. The
   design is now written (`docs/experiments/0001-…`), which clears the *merge* half; the *ship* half
   needs the experiment run.
3. **P1′** — `npm run raster` on real hardware. Owner-only; no session can take it.

---

## 9. Post-review — what does not survive

An adversarial review of this document, the experiment and the owner's note, before any of it was
built. That is what "proposed" was for, and it worked: the two paragraphs this ADR was proudest of
are **§3.2's *the ground carries no information*** and **§6's *cheap falsifying test***, and both are
among the findings below. The proudest-paragraph landmine, walked into on the first draft.

Corrected in place above: §3.1's three wrong cells and their sampling-cap cause, the elevation range
its own table contradicted, "a handful of towers", the district-size comparison (backwards — ark is
1.9× Promptasy's world, not a quarter of it), django's diagonal, and the missing sha.

**§3.5 postdates the review and has not been through it.** The minimap is the owner's proposal,
adopted after the reviewer had already read the document, so it carries none of this section's
warrant. It is also the decision most entangled with §9.1 — if the minimap draws the edges the world
lacks, the topology is being taught by a 2D inset, which is a finding rather than a fix.

**What follows needs redesign, not correction. Nothing here is fixed yet.**

### 9.1 The world model has no edges in it, and that is the design, not an omission

§3.2's table names monoliths, colour, arches, lit stones, badges and fog. **It never mentions an
import edge.** The flat map's principal ink is exactly that — the direct-importer radius, and the
co-change ember arcs — and none of it has a counterpart here.

A city of coloured towers with no edges shows topology only as **spatial proximity**, which is a
spring-embedder artifact this product has never certified as meaning anything. Worse, it is the
fallacy the `treeSibling` distractor class exists to punish: *same folder ≠ coupled*, and near-on-the-
map ≠ coupled either. Pillar 4 is *geography is topology*; a world that drops the edges is geography
**minus** the topology, and it would teach the wrong lesson with the player's legs.

This is the largest hole in the design and it is not obviously easy — thousands of edges rendered at
ground level is the occlusion problem ADR-0009's "Against" §3 names.

### 9.2 A quarter to three-quarters of the deck has no place to stand

*"a lit stone you can interact with"* is *"a node carrying an unanswered challenge"*. **Placement's
subject is a commit** (ADR-0018), which has no node, no `layout`, and therefore nowhere to be.
Measured: **40 of 160 boards on ark (25%), 54 of 216 on hono (25%), 121 of 456 on hugo (27%), 274 of
358 on django (77%)** have a commit subject.

So §4's *"what is missing from the model, and it is one thing"* is false on its face, and on django
the walkable world would be unable to serve three quarters of the game. This is the
*subject-is-not-a-node* landmine — the one that produced nine defects across the player when
Placement shipped — arriving in a new layer that was designed as though it had never happened.

### 9.3 Stage A cannot answer the question it exists to ask

`orbit.ts` is an **orthographic** projector: `right * camera.scale`, `away * sin(pitch) * scale`, no
perspective divide, and `MIN_PITCH = 0.18` clamps the tilt about ten degrees above horizontal. "Eye
height" is not a state this camera can express, and — decisively — an orthographic grazing view draws
every monolith at **identical width regardless of distance**. That is what a field of poles looks
like *whatever the layout is*.

So the test conflates a property of the projector with the property of the layout it claims to
measure. It can fail uninformatively and it can pass uninformatively. The pass criterion was also
never operationalised — no judge, no stated discriminator between "bollard field" and "place" — which
is this repo's own rule about an instrument needing a gate proving it measured anything.

The day of work was costed correctly; the epistemic yield was not. A real Stage A needs a perspective
camera, which is the renderer change it was designed to avoid.

### 9.4 The staging deletes ADR-0009's fly-through-first rule while §5 says it is intact

ADR-0009: *"The walkable avatar is gated behind the fly-through's measured results. If the fly-through
does not beat the flat map on S1, the avatar never happens."* Its 08-07 owner's note gates rung 3 on
Trace **and on the orbit's own measured results**.

§6's staging is: build the avatar (B), build the world (C), then run S1 on the **world** (D).
`docs/experiments/0001-…` has two arms, map and world. **The orbit is never measured, at any stage,
by any document** — while §5 quotes the fly-through sentence and calls S1 *"unchanged in force"*.

The experiment also cannot detect the outcome `docs/prior-art.md` §2 actually predicts, which is
*orbit beats both*. A third arm is the obvious repair and it is not free: it is 50% more recruiting
on the constraint that already makes S1 hard.

### 9.5 P4 was described as half of itself, in all three places its release was proposed

P4 has two legs — the Trace verb **and** the orbit's measured results. Every description in this
document, in §8, and in ADR-0009's 08-10 owner's note names only Trace. **The owner was asked to
release a gate on a false description of it**, and the discharge argument (*"P4's concern is recall,
and 0001 measures recall"*) answers neither leg: half of P4 is content-shaped, and the recall
evidence it rests on is *comparative* — egocentric loses **to exocentric** — which two arms cannot
measure. Corrected in §5 and §8; the owner's note is corrected too and the decision is re-opened.

### 9.6 The centroid is a mean, not a place

*"a named arch marking a district"* at `Region.centroid`. Measured: for **118 of django's 175
regions**, the node nearest the centroid belongs to a **different region** — the arch would stand in
someone else's street — and 24 django centroids sit within 3 units of a node, i.e. inside a monolith.
On hono it is 2 of 57, which is why the idea looked sound.

Text on the flat map floats and goes through a collision pass; a physical arch on the ground is a
positional claim with no such escape. Marking a district needs a derivation that is a *place*, not an
average.

### 9.7 §3.3's cap defends the wrong invariant

*"The cap is a rendering choice and touches no coordinate, so pillar 4 is untroubled."* Pillar 4 is
*"if a visual choice makes the picture prettier but less true, it loses"* — it is about visual truth,
not about coordinates. A cap keyed to **local** spacing makes rendered size a function of
neighbourhood crowding, so two files with equal `loc` render at different sizes and the flat map's
size channel — `radiusFor(node.loc)`, a pure function of `loc` — stops being monotone. The world
would disagree with the map about which file is bigger.

### 9.8 Smaller, and recorded rather than fixed

- **The plane does carry information after all**: walking converts layout distance into *time paid*,
  which is a stronger claim about a spring-embedder coordinate than the flat map has ever made. §3.4
  fixes the inconvenience (fast travel) and not the epistemics.
- **Spawn point, orientation, plane extent, sky, horizon and lighting direction are all inventions**
  the design never mentions. The sharpest is a fixed sun or skybox: it re-anchors a global
  orientation, and **ADR-0017 turns the map between challenges precisely because orientation-locked
  spatial memory is the documented weakness**. A world cannot rotate under a walking avatar. Rung 3
  silently drops the one mechanism this project shipped out of its own prior-art review, and no
  document notices.
- **Labels at eye level** — `docs/prior-art.md`'s defect #4 is that ark is text-heavy — are nowhere
  in the design.
