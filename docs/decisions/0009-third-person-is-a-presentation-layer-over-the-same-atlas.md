# ADR-0009 — Third person is a presentation layer over the same atlas, and it is blocked

- **Status**: **accepted in principle — blocked, and not scheduled.** The decision is that this
  direction is *allowed* and on what terms. Nothing about it is on the roadmap, and no
  implementation work starts before the preconditions below are met, which cannot be earlier than
  after M5.
- **Date**: 2026-08-07
- **Amends**: NORTH-STAR §9 ("v1 is 2D"), §10 (render row), and Appendix B ("3D world"). All three
  point here. `CLAUDE.md`'s map-interaction budget row too.
- **Extends**: ADR-0006 (layout and regions are computed in the indexer), and inherits its hard
  arithmetic constraint — see "What this costs".
- **Reviewed by**: Fable, adversarially, at the human's request. The first draft of this document
  claimed 88% of the code was presentation-independent (it is 74%), claimed `node.layout` was the
  only 2D thing in the atlas (`Region.centroid` is another), and rested its strongest argument on a
  psychology claim that, checked, points the other way. All three are corrected below rather than
  quietly edited out, because an ADR that got its own measurements wrong is a useful warning to the
  session that reads it next.

## Direction update, 2026-08-07

**The human has stated that a third-person explorable world is the intended final form of the
product**, naming Zelda and Assassin's Creed as the reference. This ADR was written when the question
was "is this allowed?"; the answer to that is now moot, and the question is "when, and on what
terms?".

Nothing below is weakened by this. The preconditions exist because a third-person view built on an
unmeasured renderer, an unvalidated loop, or unexamined prior art would be built on nothing — and
that is *more* true when the view is the destination rather than an experiment. The status line
stays as it is: **accepted in principle, blocked, not scheduled.** What changes is the priority of
closing P1–P3, which is ordinary work with its own payoff, and the standard 2D decisions are held
to: a choice that reads well flat but cannot survive being walked through is now the worse choice.

## Context

The human asked for a third-person point of view — a camera behind a figure moving through the
codebase — and asked whether the work so far is wasted. Two questions, different answers.

`CLAUDE.md` forbids changing the north star quietly, and §9 currently says *"v1 is 2D"* while
Appendix B lists a 3D world under what we are **deliberately not** borrowing from Promptasy.
Shipping a third-person view without writing this down would leave the spec contradicting the
product — which is how ADR-0001's `indexedAt` came back, and what ADR-0008's amendment note exists
to prevent.

## Is the work so far wasted? No. Here is the count, and it is smaller than the first draft claimed

Counted at `c53fd9d`, the commit that shipped M2. Source only; `styles.css` excluded.

| | lines | fate under a third-person view |
|---|---:|---|
| `src/atlas`, `src/verbs`, `src/indexer` minus `layout.ts` | **5,292** | untouched, **except** the three files that define and validate `Region.centroid` (below) |
| `camera.ts`, `draw.ts`, `labels.ts`, `zoom.ts`, `indexer/layout.ts` | **741** | rewritten |
| `scene.ts`, `ui.ts`, `challenge.ts`, `fog.ts`, `progress.ts` | **753** | kept, except `scene.ts`'s geometry — `pick()` is 2D circle hit-testing and `visibleNodes` is 2D AABB culling, and both become ray-picking and frustum culling, which are different algorithms rather than an added field |
| `main.ts`, `palette.ts` | **371** | `main.ts` is the most presentation-coupled file in the project — canvas context, `screenToWorld`, wheel zoom, drag pan — and is largely rewritten; `palette.ts` survives |
| **total source** | **7,157** | |
| `tests/` | 3,662 | **81–85% untouched**. The 2D-coupled ones are `camera`, `layout`, `scene`, `labels`, the cohesion assertion in `atlas.test.ts` (2D `Math.hypot`), and `asPoint` cases — ≈560–700 lines |

**5,292 of 7,157 source lines — 74% — are presentation-independent, and that is not luck.**
NORTH-STAR §7 put a hard wall between the indexer and the player and made the player "a pure
function of `atlas.json`". Everything expensive sits on the atlas side of that wall and cannot tell
what is drawing it: the import scanner, rename-following identity, the co-change matrix, guardrail
4, the F1 grader, the four distractor strategies, computed difficulty, the reveal.

The first draft said 88%. It got there by leaving `main.ts` and `palette.ts` out of the denominator
entirely — 371 lines, including the single most presentation-coupled file in the repo. **In a
document whose thesis is "measurement rather than reassurance", a number that cannot be recomputed
from the repo is worse than no number.** The conclusion survives at 74%; the process that produced
88% does not.

### The atlas is not quite as clean as the first draft claimed

`node.layout` is not the only 2D thing in it. **`Region.centroid` is a second `[number, number]`**
(`src/atlas/schema.ts:131`), hard-asserted at exactly two coordinates by `asPoint`
(`src/atlas/validate.ts:117-120`), computed in `src/indexer/build.ts:228`, documented in
`docs/atlas-format.md`, and consumed in `src/player/scene.ts:87-88`. So the "untouched" row above
contains four files this direction *must* change — which is exactly the contradiction the first
draft carried between its table and its own cost section.

Two 2D points in a 200-line schema is still a very small blast radius for a change of presentation
paradigm. But it is two, not one, and the difference is the whole credibility of the claim.

## Is third person a good idea? Genuinely arguable, and weaker than it first looked

Recording only the decision would waste the analysis.

### For

1. **Spatial memory — an open question, and the checkable part currently points the *other* way.**
   Spatial memory is the mechanic this product rests on; §7 sacrifices flexibility to protect it
   ("same repo ⇒ same map, every session, on every machine"). The intuition is that embodied
   navigation strengthens it.

   The first draft asserted this via the method of loci — "it works because you *walk* the palace" —
   which is wrong. The classical technique uses *imagined* traversal of places you are *already*
   fluent in; its power comes from the pre-existing spatial knowledge, not from locomotion during
   encoding. Worse, the literature this gestures at (map learning vs navigation learning; survey vs
   route knowledge) generally finds that **studying a map produces better survey knowledge** —
   relative position, global layout, "which is the hub" — while navigating produces route knowledge.
   Survey knowledge is precisely what this product teaches and precisely what the ship criterion
   below measures. A desktop third-person camera also forfeits the vestibular and proprioceptive
   input that most embodiment results depend on.

   So this is not an argument *for* third person. It is the reason the ship criterion exists: the
   most plausible prediction from the nearest evidence is that **the flat map wins**, and the only
   honest way to find out is to measure it.

2. **The framing is already spatial and already embodied.** §4 opens *"You are not a tourist. You
   are a cartographer arriving at a shore that already exists."* Fog of war is a first-person device
   wearing a top-down coat. The product's own language describes a place you go to. This is a real
   argument about coherence; it is not evidence about learning.

3. **Scale (risk #2) — an untested hypothesis, not an answer.** A 10,000-file monorepo is an
   unreadable hairball from above. The hope is that you can stand in one district of it. But risk #2
   already proposes semantic zoom and region clustering, and `CLAUDE.md` proposes WebGL above ~5k
   nodes — so the claim that this has "no other proposed answer" was false. And embodiment is, by
   this ADR's own admission, *the same trick clustering is attempting*: if clustering fails at 10k,
   standing inside the failed clustering does not fix it, and occlusion is strictly worse at ground
   level than from above.

4. **Fog (risk #4) — same status, and it may reverse.** "Silhouettes on a horizon" reads well. But
   from inside a world you see *less* of the unexplored shape, not more: the horizon shows the
   districts adjacent to you and hides the rest, where the flat map shows all of them at once.

### Against

1. **Pillar 4, which is the one that matters.** *"If a visual choice makes the picture prettier but
   less true, it loses. Violated when: a node is moved for aesthetic reasons."* A walkable world has
   affordances a graph does not — a ground plane, a gravity direction, walls, a horizon — and every
   one is geography the topology did not ask for and an invitation to move a node so the world reads
   better. This is the specific failure Appendix B named.
2. **Pillar 6, ten minutes to first insight.** Tier 1 is *Orientation*: "what are the top-level
   regions?" One fitted frame answers that at a glance. A walkable world answers it only after you
   walk — and the fastest way to answer it from inside 3D is to fly up and look down, i.e. rebuild
   the flat map at runtime.
3. **Occlusion is a cost to the thing being taught, not a rendering detail.** The information here
   is in the *edges*. In 3D, nodes hide behind nodes and edges cross in depth. Trading edge
   legibility for immersion trades away Blast Radius.
4. **Prior art is unread, and risk #6 told us to read it before M1.** Risk #6 names Sourcetrail,
   CodeSee, CodeCity and Gource. We still have not done that work — two milestones overdue — and
   building 3D before reading why the 3D one died is exactly what the risk register warns about.
   (Note the evidence is likely to be messier than either side assumes: Sourcetrail was mostly a 2D
   graph UI and was archived for maintenance reasons; Gource is a history animation, not a
   comprehension tool, and is not meaningfully dead; CodeCity's controlled evaluations were broadly
   *positive* on task performance. The research may well return "none of them died of 3D".)
5. **The kill point has not been passed cleanly.** M2 shipped a working loop and a caveat: 30 of 37
   answer keys are the same size, five pairs of subjects have identical answer keys, and the
   co-change distractor strategy has fired zero times because this repo has fourteen commits. **The
   open question is whether the questions stay interesting, and no camera answers it.**

## Decision

**Third person is allowed as a presentation layer, under one invariant, three preconditions, three
design constraints and one ship criterion. It is not scheduled, and the roadmap does not change.**

### The invariant

> **The world is a rendering of the atlas. The atlas is never a rendering of the world.**

1. No position, adjacency or region membership may be chosen because it makes the world navigable.
   Pillar 4 is not suspended by this ADR; it is the constraint this ADR operates under.
2. The third dimension is **derived and additive**: computed in the indexer, deterministic
   (ADR-0006), defensible as a graph property — **and existing X,Y are preserved.** This clause is
   load-bearing and the first draft missed it. §7 puts layout in the indexer so that spatial memory
   of a codebase persists; a 3D *re-layout* would scramble every map anyone has ever learned, which
   is a one-time destruction of the exact asset the product exists to build. Preserving X,Y also
   makes the overview mode a top-down projection of the world *by construction*, so the two views
   cannot disagree.
3. A plausible Z is depth in the dependency order — leaves low, entry points high, so "upstream" is
   literally up. It is a candidate, not a decision, and it is **ill-defined under import cycles**;
   real graphs have SCCs and the derivation must say what it does with them.

### Preconditions — met before any implementation work

**P1. Prior art, done properly.** Risk #6, closed: write up why Sourcetrail, CodeSee, CodeCity and
Gource failed, classifying each primary cause among *3D legibility*, *generality before the loop*,
*absence of an assessment loop*, *business or maintenance*, *other*. **If 3D legibility is a primary
cause for any comprehension-focused tool, this ADR is superseded and we say so.** Any other outcome
passes P1 and is recorded. (The first draft posed this as a binary — "3D or generality" — which the
likely answer does not fit.)

**P2. The content question is answered.** M3 and M4 ship, and Ark is pointed at a large repo with
real history — the one thing that will finally exercise the co-change distractor strategy. If the
loop is not interesting in 2D on a real codebase, a camera will not rescue it.

**P3. The interaction budget is no longer unmeasured.** ~~`npm run budget` currently reports map
interaction as **UNMEASURED** for raster cost.~~ Closing that hole is small, belongs in M3, and must
happen *before* a new renderer arrives — otherwise we cannot tell whether 3D regressed something we
never measured.

> **MET, 2026-08-07 — and the answer is not the comfortable one.** `npm run raster` drives the built
> player in a real browser against a 2,000-node atlas laid out by the real layout, and reports
> **45 / 33 / 43 fps at p95** (territory / district / street) against a ≥ 50 fps target. That is
> **below target at every zoom level** — the budget is missed, not met.
>
> Two things this does and does not license. It **does** close P3: the number is no longer unknown,
> so a future renderer can be compared against something. It does **not** by itself license WBGL —
> the run is headless and software-rasterised in a container with no GPU, which makes it a *floor*
> rather than the number a desktop sees, and the right next step is re-measuring on real hardware
> rather than rewriting the renderer against a container's numbers.
>
> The instrument is worth more than the number. Its first two versions produced **plausible,
> confidently wrong** results — 33/49/35 fps measured against a map that was not moving at all,
> because synthetic pointer events did not drive the drag and, later, because wheeling out drove the
> scale into `clampScale`'s floor where 2,000 nodes are a sub-pixel smudge and panning changes no
> pixels. Both were caught by a liveness gate that hashes the canvas before and after the drag and
> refuses to report timings when they are identical. Without it this precondition would have been
> recorded as met on fiction.

### Design constraints — hold throughout, not checked once

**D1. The overview survives.** An instant, readable, whole-repo view stays one keypress away and
remains the arrival state. Third person is a *mode*, not a replacement. If a design cannot keep
both, the flat map wins.

**D2. The invariant above holds**, including X,Y preservation and pillar 4.

**D3. ADR-0006's arithmetic rule carries forward.** No transcendental functions in any Z derivation
or 3D layout — engines differ by ulps in ways `test:determinism` cannot see on one machine, and only
the three-platform CI check would catch it. `tests/unit/layout.test.ts`'s source-grep canary must be
extended to cover the new code.

### Ship criterion — met before anything merges

**S1. It beats the flat map on measured recall, or it does not ship.**

Stated honestly, because the first draft's version was not executable and a gate that cannot be run
is a gate that gets skipped: this needs participants who have never seen the test repos — **which
disqualifies the developer from every repo they would use** — and it needs a between-subjects
design, because once you have mapped a repo in one mode your recall of it is contaminated for the
other. Note that risk #1's transfer playtest, which this copies, has also never been run.

So: before any third-person code merges, a written experiment design is committed — n ≥ 6 recruited
from outside the project, two matched repos neither group has seen, counterbalanced mode order, a
fixed recall quiz administered a day later. Third person ships only if its mean recall is at least
the flat map's. The quiz must go **beyond** §4's stated single-session outcome (entry point, regions,
top-depended module), or both modes will hit the ceiling and the criterion will pass trivially.

**If participants cannot be recruited, S1 is failed, not waived, and this ADR is revisited rather
than reinterpreted.**

### Who decides a gate is met

**The human, in a dated note appended to this ADR.** An agent session may *propose* that a
precondition is met; it may not decide it. This project is run by sessions that read a status line
and act on it, and the failure mode this clause exists to prevent is a future session
self-certifying "gates basically met" from the word "accepted".

### The first experiment is the fly-through, not the avatar

If the preconditions open, **build the orbit-camera fly-through first** — a 3D camera over an
extruded map, no avatar, nothing to walk on. It preserves X,Y by construction, cannot violate pillar
4 because there is no ground to invent, reuses nearly everything, and tests the depth-cue and recall
hypotheses at a fraction of the cost. **The walkable avatar is gated behind the fly-through's
measured results.** If the fly-through does not beat the flat map on S1, the avatar never happens —
and everything in "Against" above says that is a real possible outcome.

## What this costs, stated up front

- **A runtime dependency.** Zero today against a budget of three; a 3D renderer is one. It fits, and
  it should be spent knowingly.
- **Two budgets, not one.** The obvious risk is *"≥ 50 fps @ 2,000 nodes"*. The quieter one is
  **player first paint ≤ 1.5 s**: WebGL context creation and shader compilation are exactly the kind
  of thing that breaks it, and today's measured figure is ~300 ms.
- **CI.** The headless-browser smoke test fails on any console error, and the three-platform check
  demands byte-identical output. Headless WebGL is commonly software-rendered and flaky. Expect to
  spend time here that has nothing to do with the feature.
- **A schema change**: `layout` and `centroid` both gain a third coordinate, `asPoint` stops
  asserting two, `ATLAS_VERSION` bumps, and a migration or an explicit "reindex required" error
  ships with it (guardrail 5). **Cheap when it is actually done — do not bump early.** Carrying a
  dead Z coordinate through several milestones with no renderer to use it is worse than the change
  itself.

## Alternatives rejected

**Reject it outright, keep §9 as written.** The coherence argument is real and risk #2 has no
*proven* answer. A flat refusal would also re-create the quiet spec-versus-intent divergence this
project has been bitten by before.

**Accept and schedule it at M3 or M7.** This is what the request most naturally reads as, and the M2
result argues against it: the kill point produced a caveat, not a clean pass. Presentation is the
cheapest thing to change later and the most expensive thing to be wrong about now. The first draft
of this ADR said "gated, not scheduled" in one paragraph and "this is a new M7" in another, which is
the same two-documents-disagree failure it was written to avoid. **The roadmap is unchanged. If the
preconditions open, this slots after M5.**

**First person instead.** Worse for this product — a cartographer needs to see themselves in the
terrain to place anything relative to anything else, and first person is a corridor. Not "strictly"
worse: it removes avatar occlusion and is cheaper. It is not worth a separate gate.

## Consequences

- NORTH-STAR §9, §10 and Appendix B carry amendment notes pointing here. None is deleted — their
  reasoning is still the reasoning, and this ADR is the conditions under which it is revisited.
- `CLAUDE.md`'s map-interaction row says "switch Canvas → WebGL, **not before**". That line means
  *performance* does not justify a renderer change earlier; it now also points here, so a future
  session doing gate-cleared work does not have to choose between violating `CLAUDE.md` and
  "fixing" this ADR.
- P3 turns the unmeasured map-interaction budget from a known gap into a blocker.
- The roadmap in §13 is unchanged and deliberately contains no M7.
