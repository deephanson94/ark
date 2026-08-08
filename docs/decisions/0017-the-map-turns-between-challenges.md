# ADR-0017 — The map turns between challenges, and the heading is the camera's

- **Status**: accepted
- **Date**: 2026-08-08
- **Implements**: `docs/prior-art.md` §4.4, which has named this the highest-leverage, lowest-cost
  item in the writeup for three sessions
- **Extends**: ADR-0006 (layout is computed in the indexer and frozen), ADR-0009 (third person is a
  presentation layer), ADR-0011 (a cursor is never persisted)
- **Bumps**: nothing. No schema change, no `ATLAS_VERSION` change, and **the indexer is not touched**
  — `test:determinism` is out of scope by construction, and stays byte-identical.
- **Reviewed by**: Fable, before implementation. It killed the schedule this started from, named the
  failure mode the proposed test suite could not see, and was measurably wrong about the replacement.
  All three are recorded below.

## Context

NORTH-STAR risk #1 is **transfer**: does mapping repo A make you better at repo B, or only at repo
A? `docs/prior-art.md` closed risk #6 and came back with an answer nobody was looking for.

> **Map-derived spatial memory is orientation-specific; navigation-derived memory is not.** After
> learning a layout from a map, judgments are easy when aligned with the learned orientation and
> measurably harder when misaligned (Presson & Hazelrigg; Shelton & McNamara; König et al. found the
> same north-alignment effect).

Ark teaches from a map. That map was north-up and fixed forever — §7 puts layout in the indexer
precisely so it never moves — and both verbs pick an arbitrary subject each time. So **every question
this product has ever asked was answered from the one orientation the evidence says will not
transfer.** That is not a rough edge in the mechanic; it is the mechanic training the wrong thing.

## Decision 1 — the map turns by the golden angle after every grade

> After a challenge is graded, the map turns **`2π(1 − 1/φ)` ≈ 137.5°**, animated over 620 ms, and
> the turn happens **when the console closes** rather than when the grade lands.

**Why an irrational fraction of a turn, measured rather than argued.** The step has to be irrational
in units of a full turn or the sequence *closes*, and a closed sequence hands the player back the
alignment the whole change exists to break. Over 80 headings — a full clear of this repo's deck at
`0334d3e`:

| step | distinct headings | consecutive turns of 0° | questions answered from exactly north |
|---|---:|---:|---:|
| hashed into 8 buckets | 8 | **14** | 10 |
| 135° (3 of 8 — the reviewed alternative) | 8 | 0 | **10** |
| 90° | 5 | 0 | **20** |
| **golden, 137.5°** | **80** | **0** | **0** |

Two different defects, and each candidate has one. A **hashed** heading — a pure function of
`challenge.id`, which was this ADR's first proposal — collides on consecutive grades once every K
grades: the console closes, the animation runs, and the map does not move. That is the
machinery-that-never-fires landmine wearing the feature's own clothes. A **round-number step** fixes
that and fails the other way: 135° is three eighths of a turn, so it visits eight headings and
repeats, putting one question in eight back at exactly north-up.

The golden angle is the canonical maximal-spread constant and behaves like one: every heading in a
full playthrough distinct, no turn smaller than 137.5°, and the near-north share falls to what an
even spread gives (6 of 80 within 15°, against 6.7 expected).

There is a second argument for the continuum, and it comes from the review that recommended the
discrete step. **Shelton & McNamara found that multi-view learning sometimes stores *two*
orientations rather than producing orientation-free knowledge.** Eight headings are eight things a
player could store. Eighty are not.

**Why on close, not on grade.** Behind the scrim a turn is worth nothing — the player would close the
console onto a world that had silently moved, which is disorientation without the correspondence that
makes it teachable. Turning as the map comes back means the reveal is on screen while it happens, so
there is a shape to follow round.

**Why on every grade, pass or fail.** Exactly as the reveal already does. Guardrail 6 says a wrong
answer never costs anything, and a heading that advanced only on a pass would make the turn a reward
and the flat map a punishment.

**Why it pivots about the subject.** The turn is anchored on the file just graded, at wherever it
stood on screen, so its disc does not move while the world swings around it (`pivotAround`). This is
the difference between the intervention reading as *this place has more angles than you thought* and
reading as *the tool shuffled the map*. When the subject is off screen there is nothing to anchor on
and the viewport centre is used instead; pivoting about a point beyond the edge is a camera flying
sideways rather than a world turning.

## Decision 2 — one heading, on the camera, for both views

> `Camera` gains a required `bearing`. **`Orbit` loses its `yaw`.** Turning is `rotate()` on the
> camera; tipping is `tip()` on the orbit.

The orbit had a heading of its own, which was correct while the flat map could not turn and wrong the
moment it could: two headings for one world means `o` snaps the view back to whatever the orbit
remembered, and the same concept is implemented twice — the shape of nearly every defect this repo
has had to fix. The test that already existed says why this is the right merge rather than a tidy
one. `tests/unit/orbit.test.ts` asserts that **looking straight down reproduces the flat map to the
pixel**, and that assertion now runs at four headings instead of at north alone. One number, two
projections, and an equality where they meet.

**The renderers stay separate.** `draw.ts` keeps two functions and its reason is untouched: the flat
map is what the product rests on, and threading a projection through it would put the overview one
bad conditional away from breaking. What is shared is a *value*, not a pipeline.

**ADR-0009's S1 is not tripped, and this is the reasoning rather than an assurance.** S1's breach
note blocks further third-person rungs from merging while the recall-experiment design does not
exist. This ships no third-person capability: `orbit.ts` *loses* state, gains nothing, and the
intervention is 2D work that `docs/prior-art.md` §4.4 explicitly says "needs no 3D at all". One
player-visible consequence is stated here so a later session does not read it as a quiet merge:
**turning in the orbit now leaves the flat map at that heading.** D1's overview survives as a
readable whole-map view one keystroke away, with `n` for the canonical north-up one.

**Pillar 4 is not in play and this is not a loophole.** `node.layout` is computed in the indexer and
frozen; no node moves relative to any other, in the atlas or on screen. A bearing is a property of
the viewer in exactly the sense `scale` is. Runtime `sin`/`cos` are fine for the same reason
`orbit.ts` already says they are: ADR-0006 forbids transcendentals in **layout**, because the atlas
must be byte-identical across machines, and nothing here reaches the atlas.

## Decision 3 — the heading is session state, and is never persisted

ADR-0011 decision 2 forbids storing a cursor, and an orientation into the rotation is one. But the
stronger reason is what persistence would *do*: restoring the last heading would anchor a returning
player to one alignment, which is the thing this ADR exists to break. **Every session arrives
north-up** — the canonical map, the one every previous session learned, and ADR-0009's D1 overview —
and turns from there.

There is no counter, either. The heading advances *from wherever the camera is now*, so the state is
the camera's own bearing and nothing cursor-shaped exists to be tempted into the save.

## Decision 4 — the player can always get out

Guardrail 6 says a wrong answer never costs anything. A map that turned with no way back would cost
something on every answer, right or wrong. So:

- a **compass** in the HUD says where the atlas's north now points, and clicking it faces north;
- **`n`** does the same from the keyboard, turning the short way rather than unwinding;
- **shift-drag** turns the flat map by hand — the same gesture the orbit uses, on the same value;
- **`f`** fits the whole map *at the current heading*, never back to north. A fit that also
  straightened the map would quietly undo the turn every time the player used the most ordinary
  control there is. `fit` therefore takes a bearing and has **no default**, the same discipline
  `blastRadius` uses for its depth;
- `prefers-reduced-motion` **arrives without the motion** rather than losing the feature.

## What this cost elsewhere

**The cull changed algorithm, and that was measured too.** `visibleNodes` took a world-space
axis-aligned rectangle, which is the wrong shape once the map can turn: a turned viewport is a
diamond in world space, and its bounding box admits far more than is on screen. On a 2,000-node
cloud at street zoom the box lets through **2.17× the nodes the viewport actually holds at 45°** —
and every heading between the axes is oblique, so that would have been the normal case on a renderer
already measured under its frame budget. It now culls in screen space through the same projection
that draws, which is exact at every bearing and cannot disagree with the drawing about where a node
is. `visibleBounds` and `contains` are deleted; the cull was their only caller.

## How this is kept honest

**The single load-bearing assertion is in `npm run test:e2e`**: with the turn landed, hash the
canvas, press `n`, hash again, and require the two to differ. That one comparison proves the *map*
turned — not a state variable, and not the compass, which is CSS-rotated independently and would
happily keep spinning over a dead map. If the grade had turned nothing, the map would still be
north-up, `n` would be a no-op, and the hashes would match. Verified by severing the turn and
watching it fail before it was allowed to pass.

This mattered because **every consistency test in the first proposed suite passes with the bearing
ignored everywhere** — the round-trip inverse, the flat≡overhead identity, the zoom anchor. All of
them hold when both directions ignore the heading. What they needed alongside them was a liveness
test (turning moves an off-centre point), a rigidity test (it is a rotation, not a scale), a
**semantic anchor** stating the sign convention in a form a human can check against a screenshot
(at a quarter turn, north points right and east points down), and a check that the compass needle
lands where the projection actually puts north. Sixteen mutations, sixteen caught — one only after
an assertion was added: linear interpolation instead of the easing passed everything, which would
have left `easeTurn` a tested function the product never called.

## What this is not

**This is the bet `docs/prior-art.md` §4.4 calls it, not a validated fix.** The cited studies
demonstrate the *deficit* — that map-learned knowledge is orientation-locked — not that rotating a
map cures it. Nobody in this literature has measured retained structural knowledge after the tool
was taken away, which is §2's closing point and applies to us too. If the recall experiment is ever
run (ADR-0009's S1, owner-only), the heading schedule is a variable in it.

## Rejected

**A heading derived from `challenge.id`.** Measured above: 14 zero-turns in 80. It also gives a
specific question a canonical view, which sounds like consistency and is the orientation lock at
finer grain — a failed question is re-served, and it would come back at the identical orientation
every time.

**A round-number step (90°, 72°, 135°).** Closes into a cycle of 4–8 headings; see the table.

**Making the flat map the orbit at maximum pitch.** One projection instead of two, and the tested
identity says they agree there — but it makes the overview a rendering of the third-person layer,
which is both an S1 question and the thing `draw.ts` deliberately refuses.

**Persisting the heading.** Rejected twice over: ADR-0011 decision 2, and it would restore the
alignment lock it is meant to break.

**Growing the cull's bounding box instead of changing algorithm.** Correct and strictly worse: the
same cull for twice the drawing, at exactly the headings the schedule favours.
