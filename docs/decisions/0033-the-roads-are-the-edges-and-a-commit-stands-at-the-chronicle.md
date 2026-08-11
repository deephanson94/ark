# ADR-0033 — The roads are the edges, and a commit stands at the chronicle

- **Status**: **accepted and built.** Rung 3 ships as a mode: press `g`.
- **Date**: 2026-08-10
- **Supersedes**: [ADR-0032](./0032-the-walkable-world-is-a-city-on-a-plane.md) §3.2's central decision
  (*"the ground is a featureless plane. It carries no information, and that is the point"*), and
  answers §9.1, §9.2, §9.3 and §9.7. Everything else in ADR-0032 stands and is the design this
  implements.
- **Under**: [ADR-0009](./0009-third-person-is-a-presentation-layer-over-the-same-atlas.md) — the
  invariant, D1–D3, and S1. **P4 is released by the owner**, in their own words, and the release is
  recorded there rather than assumed here.

---

## 1. What the owner decided, and what it does not decide

> *"I think you can take fable findings and continue building the 3d world + hero view in this
> session."*

ADR-0009 reserves gate decisions to the human, and this is one. It releases **P4** — both legs, the
Trace verb *and* the orbit's own measured results, described in full before being released rather
than after (ADR-0032 §9.5 is the reason that sentence is here).

It does **not** release **S1**. `docs/experiments/0001` has not been run, so the world ships as a
*mode you enter*, never as the arrival state: the flat map is still what a player lands in, still
what `f` and `o` return to, and the world is one keystroke away in both directions. Nothing in the
product yet claims that walking teaches better, because nothing has measured it.

---

## 2. Decision 1 — the roads are the edges

ADR-0032 decided the ground carried nothing, reasoning that any atlas field pressed into terrain
would be invented geography wearing a derived label. That reasoning is still right about *terrain*
and was wrong about the ground: §9.1 found that the resulting model named towers, colour, arches,
badges and fog and **never an import edge**, so the only topology a walker could read was
*proximity* — a spring-embedder artifact, and precisely the fallacy the `treeSibling` distractor
class exists to punish. Pillar 4 is *geography **is** topology*. That world was geography minus it.

**A road is an edge.** Same two endpoints, same coordinates, no routing, no bundling, no smoothing.
`buildWorld` asserts the equality rather than an inclusion, in `tests/unit/world.test.ts` and again
over the real atlas: a world with extra roads is inventing geography and one with fewer is §9.1
coming back. The plane now carries exactly what the flat map's edge layer carries and not one claim
more — and walking along a dependency is the thing you do with your legs, which is what the rung was
for.

The e2e counts `roadsDrawn` on a real frame for the same reason the map counts `peaksDrawn`: a
liveness gate, because a rendering path that never fires is code and comments asserting a behaviour
the product does not have.

### 2.1 What this does *not* fix

It does not answer whether a walker reads the topology off the **world** or off the **minimap**,
which draws the same edges in 2D. That is §4's problem and it is a real one.

---

## 3. Decision 2 — a commit stands at the chronicle, and nowhere else

ADR-0032 §9.2: a "lit stone you can interact with" is *a node carrying an unanswered board*, and
**Placement's subject is a commit** — no node, no `layout`, nowhere to be. Measured: **40 of 160
boards on ark (25%), 54 of 216 on hono, 121 of 456 on hugo, 274 of 358 on django (77%)**. A world
that serves only nodes serves a quarter to three quarters of nothing.

The obvious fix is a **wrong answer key drawn as scenery**. Put a commit's marker among the files it
touched and you have rendered Placement's own truth on the ground, permanently, for anyone who walks
past. Guardrail 4's cousin: the board would still be gradeable and the answer would be free.

So there is **one chronicle**, an obelisk standing outside the map at
`((minX + maxX) / 2, minY − 90)`, and every board whose subject is not a node is answered there. Its
position is a function of the **bounds** and of nothing else, asserted in both suites, and it is
checked to stand clear of every tower. It says *commits are answered here* and says nothing whatever
about which files any of them touched.

**The cost, stated rather than absorbed**: commit boards have *a* place, not *their own* place. A
player learns where the chronicle is; they do not learn where a commit is, because a commit is not
anywhere. That is honest about what a commit is, and it is worse than what a node gets.

The shell selects these with `!isNodeId(challenge.subject)` rather than `isCommitId`, deliberately: a
future id kind with no `layout` lands at the chronicle instead of silently vanishing from the world.
That is the *subject-is-not-a-node* landmine met with the lesson learned rather than paid for again.

---

## 4. Decision 3 — a perspective camera, and the orbit keeps its orthographic one

ADR-0032 §9.3: `orbit.ts` is orthographic — `right * camera.scale`, `away * sin(pitch) * scale`, no
divide — and `MIN_PITCH = 0.18` clamps the tilt about ten degrees above horizontal. "Eye height" is
not a state that camera can express, and an orthographic grazing view draws every tower at
**identical width regardless of distance**, which is a field of poles whatever the layout is. Stage
A could have failed for a reason that had nothing to do with the map.

So `src/player/world/camera.ts` is a second projector with a real divide, and the orbit is untouched
— looking straight down still reproduces the flat map to the pixel, which only an orthographic
projection can do. The unit suite asserts the difference in both directions: doubling the distance
**halves** the on-screen size here, and changes a column's height by **nothing** there. Asserting the
new behaviour without the control would have left *"we replaced the camera"* unproven.

Clipping happens in **view space, before the divide**, because after it the information needed to
clip is exactly what the divide destroyed: a point behind the eye divides by a negative number and
lands on screen mirrored, as though in front. On a plane covered in roads that is not a corner case
— the road you are standing on has one end behind you almost always.

---

## 5. Decision 4 — the footprint is the map's radius times a constant, and the constant was measured

ADR-0032 §3.3 wanted a footprint cap keyed to **local** nearest-neighbour spacing. §9.7 refused it:
that makes rendered size a function of neighbourhood crowding, so two files of equal `loc` render at
different sizes and the flat map's size channel stops being monotone.

The first build therefore used `radiusFor(loc)` unchanged — and **that is not walkable**. Measured:

| | towers | ×1 | ×0.6 | ×0.5 | ×0.45 | **×0.4** | ×0.35 |
|---|---:|---:|---:|---:|---:|---:|---:|
| ark | 182 | **88.5%** | 40.7% | 20.9% | 14.3% | **3.3%** | 2.2% |
| hono | 425 | **52.2%** | 21.4% | 11.8% | 8.2% | **6.1%** | 3.3% |

*Share of towers with no body-width gap to their nearest neighbour, measured at `1827ff93` and hono
`7075369e`.* At ×1 the city is one solid mass with the camera inside it, which is exactly what the
first screenshots showed: a wall filling the frame and the hero invisible behind it.

A **uniform** scalar fixes it and satisfies §9.7 exactly — equal `loc` still gives equal size,
greater `loc` still gives greater size, and the *ordering* is the only thing the size channel claims.
0.4 is the knee with both neighbours named (14.3% → 3.3% on ark; flat below it on both repos), not a
number chosen by eye. The unexamined step in the first build was treating `radiusFor`, which is a
**glyph** radius the flat map draws at whatever screen scale it likes, as ground area.

---

## 6. Decision 5 — the minimap is north-up, against ADR-0032 §3.5

That section adopted the owner's minimap and said it turns with the player, naming the cost. Building
it settled the trade the other way.

A minimap that turns is a **route** instrument: it tells you what is ahead. A north-up one is a
**survey** instrument, and survey knowledge — relative position, global layout, which node is the hub
— is what ark teaches (`docs/prior-art.md` §2, §4.4). It also resolves the tension §9.8 raised with
ADR-0017: the **fixed frame lives on the minimap and the varied viewpoints live in the world**, so
the player gets both instead of losing one to the other. Heading is not lost; the hero's arrow
carries it, which is the standard way of showing a heading against a fixed frame.

It draws the edges, and §4 above is why that is stated rather than quietly done.

---

## 7. Decision 6 — walking past a building is looking at it

The flat map surveys a node when you click it. Fog withholds a **label** until a node is surveyed —
which is right, and which makes an unexplored world a city of unnamed shapes rather than a mystery.

So proximity surveys, through `recordSurvey`, the same recorder the click uses. Two definitions of
"seen" in one product is the shape of nearly every defect this repo has had to fix twice.

`SURVEY_RANGE` (22) is wider than `INTERACT_RANGE` (12) because seeing a name and answering a
question are different acts and the first should be cheaper — and narrow enough that crossing the map
does not survey the map. Measured in the e2e: a 2.6-second walk takes ark from **66 to 69 surveyed**,
which is the liveness gate on this decision.

**This makes exploration mean something mechanically**, which is the closest thing rung 3 has to an
answer for *"why walk?"* — and it is not evidence that walking teaches better. S1 is.

---

## 8. What is built, and what the first frames showed

`src/player/world/` — `camera.ts` (projection, clipping, the follow rig), `hero.ts` (a body and its
collisions), `build.ts` (the fold from atlas to world), `render.ts` (one painter's list, far to near),
`minimap.ts`, `index.ts` (the mode). ~1,150 lines, **zero new runtime dependencies**, Canvas 2D.

Three defects the pictures found that no assertion would have:

1. **The hero was 11 units tall** in a world whose median nearest-neighbour gap is 12–19 and whose
   elevation-0 building is 4.5 — a person taller than most of the city and as wide as the street. It
   is 1.9 now, and the numbers in `hero.ts` are sized against each other rather than chosen.
2. **The hero was drawn last**, so walking behind a building pasted the figure onto its wall. A body
   is an object in the world and sorts like one; it is a primitive in the same depth list.
3. **The camera walked through buildings.** The boom now shortens when a footprint stands between the
   eye and the hero, tested against the same circles `hero.ts` collides with — a camera that used a
   different shape from the body would clip on one and not the other.

Only the third was a design error; the other two were the kind of thing that is invisible until
somebody looks. ADR-0032 §6 called stage A *"a day's work to find out if this is worth doing"*, and
this is what that day produced.

---

## 8.1 What a playtest found, and what a suite could not

The world was handed to an independent agent with one question — *is this worth
playing?* — and instructions not to be polite. It rated the walking layer **3/10**, called it
*"a tech demo bolted onto a game that already exists and is better without it"*, and was right about
three defects. All three are fixed; the rating is recorded because it is the honest reading and
because §9's first bullet is the reason it cannot yet be answered properly.

**One heading, two bases — the defect that made every judgement about "does this feel good"
worthless.** `hero.ts` walks along forward `(sin ψ, −cos ψ)`; `toView` projected onto a *different*
axis, `flat = −(dx·sin ψ + dy·cos ψ)`. The two agree exactly when `dx · sin ψ = 0` — heading 0° or
180°, or a point straight down the Y axis — and **every assertion ever written about this camera used
one of those**. At any other heading the hero walked out of its own view: at 90° a point ten units
ahead computed as ten units *behind*, so the figure vanished and the city receded as you approached
it. Turning is the control you use most, so this fired within a minute of anyone playing.

That is this repo's degenerate-fixture landmine, freshly made, in a suite written the same day that
had *twenty-one* passing assertions about this module. The regression tests now run at nine headings
and assert the two bases agree; the e2e turns and then walks, and checks the world is still populated
afterwards, because a pixel hash cannot tell an emptied frame from a changed one.

**Two smaller ones, both real.** A movement key held when the challenge panel opened stayed held —
a grade can be entirely mouse-driven, so the "release on the next keydown" path never ran, and the
hero walked and *surveyed* behind the scrim (measured at 51 → 65 surveyed during one panel). And
there was no boundary: twelve seconds of running reached `0 towers · 0 roads · 0 beacons` on an
unbounded grey plane, which reads as a broken product rather than a finished one. The world has the
atlas's edges now, as a clamp rather than a fence.

**The two verdicts that are not bugs are the ones that matter**, and neither is fixable by a commit:
*you never see more than a local neighbourhood at once, where the flat map shows the repo's whole
shape in one frame*, and *walking a street did not teach anything a two-second glance at the flat map
had not*. `docs/prior-art.md` §2 predicted exactly that — 3D wins from outside a structure and loses
from inside it — and it is what S1 exists to measure. **This ADR does not claim otherwise.**

## 8.2 The visual pass, and what it cost to make the thing legible

The first build was unreadable, and the fixes are all *rendering* constants with the same shape of
argument: the ordering a channel claims is preserved exactly, and only the scalar moves.

- **The rig.** 6.5 units up and 16 back is a chest-height cinematic camera, and in a quarter whose
  files sit a measured 12–19 units apart it frames the inside of one wall. **46 back and 33 up, tipped
  0.52 rad down**, puts the ground plan in frame — and the ground plan is where the import graph is
  drawn. Still egocentric, still perspective, and further out than the phrase "hero POV" suggests;
  that is a compromise with legibility and is named as one.
- **`RISE` 14 → 6.** ADR-0013 froze what elevation *means*, not its world units. At 14, ark's tallest
  file stood 105 units over an 18-unit street: a 6:1 canyon nobody can read from inside.
- **Roads 2.2 → 1.1 units wide, and quieter.** At a hub a dozen edges converged into one grey plate
  the size of a square, which reads as pavement rather than as twelve dependencies.
- **The district wash** — a low-alpha disc of the region's own colour on the ground under each file,
  so overlapping members of one region pool into a quarter. It is the flat map's principal legibility
  device (colour as neighbourhood) surviving the trip into the world, and it is derived: a `Region`
  is label propagation over the same graph.
- **The figure**, 1.9 units → 4.4 drawn, plus a ground ring at its collision radius. At the new boom
  a person-sized marker is 26 pixels at the foot of a tower. Nothing in this product asserts human
  scale; the figure is a marker for *where you are standing* and has to be findable. The collision
  radius did not move, so what you can squeeze through is unchanged.
- **Painter's order by a tower's *near face*, not its centre**, since a wide tower's face stands a
  whole footprint closer than its middle — keying on the centre painted roads across buildings.

One thing worth recording as a **non**-finding: a session convinced itself the pitch sign was
inverted, "fixed" it, and reddened its own new test. `toView`, `horizonY` and the doc comment had
agreed all along. A wrong sign is a legal camera, so nothing but a picture or an assertion can see
it — there are assertions now, and the claim that it was broken was withdrawn rather than quietly
dropped.

---

## 9. What this does not answer, and what would

- **S1 is unrun.** `docs/experiments/0001` §8 lists two things still blocking it: the matched repos
  are a TODO, and a two-arm design cannot detect *"orbit beats both"*, which is what the evidence
  actually predicts. **No claim that the world teaches better may be made until it runs.**
- **§4's confound is live and is the sharpest thing here.** The minimap draws the edges the world
  draws. If a player reads topology off the inset, the honest conclusion is that the 2D map was doing
  the work — which is what S1 has to be able to see. The minimap must therefore be in **both arms or
  neither**, and if it is in both, a third condition (world without minimap) is the only way to tell.
- **ADR-0032 §9.4 stands.** Nothing here measures the orbit, and ADR-0009's *"the walkable avatar is
  gated behind the fly-through's measured results"* is now satisfied by the owner's release rather
  than by a measurement. That is a real weakening and it is named as one.
- **§9.6 is unbuilt.** Region arches are not in this build at all: 118 of django's 175 centroids have
  their nearest node in a *different* region, so an arch would stand in someone else's street.
  Districts are unmarked in the world, which is a legibility gap and a smaller lie than a misplaced
  landmark.
- **`npm run raster` has never measured this renderer**, and P1′ is owner-only. The world's frame
  cost is unmeasured on real hardware; django's 10,162 roads at `VIEW_DISTANCE` are the case to
  watch.
- **A playtest rates the walking layer 3/10 and says it teaches nothing the flat map does not**
  (§8.1). That is one tester, on one repo, with the defects above live for part of the run — but it
  is the same conclusion `docs/prior-art.md` §2 reaches from the literature, and the honest position
  is that **the burden is on the world to earn its place and it has not yet.** S1 is how it would.
- **`VIEW_DISTANCE` is 620 and was not measured.** It is a legibility and cost knob picked by eye,
  which is the thing this document spends §5 refusing to do — recorded so the next session does not
  read it as derived.

---

## 8.3 Navigation, and the idea that had to be refused to get there

The playtest's flattest complaint was not a bug: **you cannot tell where to go.** The flat map answers
that at a glance; the world could not answer it at all, so a walker's only strategy was to wander
until a beacon appeared — the opposite of the deliberate route the guide already computes. Three
things now answer it, and none of them states a fact the flat map does not already draw:

- **A waypoint** on the guide's next subject: a chevron over the place when it is on screen, an arrow
  pinned to the edge when it is not, carrying the name and the distance in paces either way. Its
  bearing is computed in **view space**, so it stays correct when the target is behind you — which is
  exactly when you most need telling, and the case a screen-space angle gets backwards. A *placeless*
  subject points at the chronicle, which also teaches where the chronicle is.
- **A sight cone on the minimap**, spanning the world camera's own field of view. The inset is the
  whole repo; what it lacked was the join — *which part of it is in front of me now*. Binding an
  egocentric view to a survey one is the mechanism §6 says the minimap exists for, and it was missing
  the one element that does the binding.
- **The guide's target wins any tie of proximity.** A playtest walked to the building the guide named
  and was offered its neighbour, because nearest-wins is blind to why you came.

### The idea that would have made walking teach something, and why it is dead

The most attractive answer to *"what does walking teach that the map does not"* is **direction**: the
flat map draws every edge as an undirected line (`draw.ts`, `moveTo`/`lineTo`, no arrowhead), so
*which way a dependency points* is information the world could add. Tier 2 of NORTH-STAR §5 is
literally *"which way do dependencies point?"*

It is an **exact** disclosure of Blast Radius's answer key, and this was measured rather than argued.
Walk backwards along the arrows from the subject and intersect with the choice set; score it with
`scoreSet`, the metric the player is graded by:

| | blast boards | mean score | beats band A | **exact** |
|---|---:|---:|---:|---:|
| ark | 40 | **1.000** | 40 | **40** |
| hono | 54 | **1.000** | 54 | **54** |

100% of both repos, byte-exact. That is not a heuristic that happens to score well — ADR-0008's
invariant is `candidates ∩ dependents(subject, ∞) = truth`, so a directed road network *is* the
answer, by construction, on every board that will ever be generated. Arrows are refused.

*The first run of that probe returned a mean of **0.000** on 94 boards, because `graph.in[ref]` holds
`AtlasEdge` objects rather than refs, so the walk never left depth 0. A mean of exactly zero across
two repos is the shape of an instrument measuring nothing — and note the direction the error ran: it
made the design look **safe**, which is the direction that gets believed by someone who wants to
ship. This repo's landmine about throwaway probes, met again.*

## 8.4 The re-playtest: 5/10, and where polish stops paying

The same brief, the same instructions not to be polite, run against the fixed build with the tree
held still. **5/10, up from 3.** All five fixes verified landed, each with evidence rather than
eyeballing — the heading fix checked at many headings with the waypoint distance falling 397 → 301 →
209 → 128 while walking off-axis; the held-key leak checked by holding `w` for two seconds over an
open panel and reading `surveyed` byte-identical before and after; the boundary checked by running
into it twice and getting the same clamped distance.

Its verdict on the rest is the one worth keeping: *"the rating moved on **stability**, not on fun …
walking is now a working, honest way to get to that modal. It is not yet a reason to prefer it."*
And on the question this whole rung exists to answer — does walking teach anything the flat map does
not — *"no, not that I could find"*, with the observation that **the minimap's existence is itself
the admission**: the north-up inset was added because the 3D view could not carry survey knowledge,
and it now does most of the *where am I in the repo* work.

Two rough edges it found are fixed: a **duplicate label** where the waypoint's pill and the tower's
own floating label stacked the same filename twice, and **`o` silently swallowed** in the world —
a keypress that does nothing and says nothing reads as a broken control, so `o` now leaves for the
orbit and the three views are reachable from each other.

### The void, and what it actually was

Its highest-leverage suggestion was to fill the empty space, ideally the way NORTH-STAR risk #4
already mandates: *"always show the silhouette of unexplored regions — you can see there's something
there, just not what."* The flat map has obeyed that since M1; the world drew **nothing at all** past
`VIEW_DISTANCE`. So a skyline was built — far towers as one flat shape in the region's silhouette
tint, two projections each, out to 2,400 units.

**Then it was counted, and the reason it was built turned out to be wrong.** Sampling 121 standing
positions across the walkable area of both repos:

| | towers | mean in full view | mean as silhouette | positions with **nothing** in view |
|---|---:|---:|---:|---:|
| ark | 182 | 172 | **10** | **0 of 121** |
| hono | 425 | 313 | **112** | **0 of 121** |

There is no standing position on either repo where the frame is empty — so the playtest's
`0 towers · 0 roads` frames were the **frustum**, not the distance cull: it had run to the shore and
was facing away from the map. Which is honest, because there is nothing out there. The response is
therefore *less out there* — `SHORE` cut from 140 to 70 — rather than scenery to fill it.

The skyline is kept, and its firing rate is recorded rather than assumed: **10 on ark, 112 on hono**,
which makes it a real layer on a repo twice the bootstrap's size and nearly dead on the bootstrap
itself, whose entire 488-unit span fits inside one view distance. The e2e gates *"something is
standing"* rather than *"the skyline fired"* — the first version of that step measured exactly **1**
on ark, which is a bar on a knife edge and this repo has a landmine about those.

### Where this stops

The re-playtest's own third option is the right one: *"stop treating this as a rung to keep polishing
and go run `docs/experiments/0001`."* Two independent playtests and `docs/prior-art.md` §2 now agree
that walking does not teach more than the map, and **no further bug-fixing can answer that** — it is
a measurement, it is designed, and it is unrun. §9's first bullet is the whole of what is left.

---

## Alternatives rejected

**Edges as arcs overhead, like the map's co-change wires.** Rejected because the ground is where a
walker looks and an arch you cannot walk under teaches nothing about where you may go. The ember-arc
channel stays available for co-change, which is not built here.

**A commit marker among the files it touched.** Refused as a wrong answer key rendered as scenery
(§3). This is the one alternative in this document that had to be refused rather than merely
weighed.

**One chronicle stone per commit, laid out by date.** More place-like, and it makes date order a
thing you can read off the ground — which is a `Ctrl+F` on a board whose rows already print dates.
The single obelisk claims nothing.

**Arrows on the roads, showing which way each dependency points.** Refused on a measurement: it
scores **1.000 exact on 100% of both repos' Blast Radius boards** (§8.3). It is the single most
attractive idea for making the world teach something the map does not, and it is the answer key.

**Mouse-look.** Not wired. It needs pointer lock, which is a decision about capturing the player's
cursor and belongs in its own change; the keyboard turn is enough to walk with.
