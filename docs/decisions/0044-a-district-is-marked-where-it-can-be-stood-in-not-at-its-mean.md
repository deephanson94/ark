# ADR-0044 — A district is marked where it can be *stood in*, not at its mean

**Status**: accepted · built · 2026-08-14
**Supersedes**: nothing. **Closes**: [ADR-0032](./0032-the-world-is-a-city-and-the-atlas-is-its-plan.md) §9.6.
**Measured on**: clean clones of `ark` (`da8a276`), `honojs/hono` `7075369e`, `django/django`
`c9eb16a87e`, `gohugoio/hugo` `44da0860`, `kysely-org/kysely` `f24018c7`,
`graphql/graphql-js` `9c245018`. Reproduce with `npx tsx scripts/probe-arches.ts /tmp/ark-corpus <repo>…`.

---

## 1. What was refused, and what half of it actually died

ADR-0032 §3.2 wanted *"a named arch marking a district"*. §9.6 refused it, and — this is the part
that matters — refused it on **two** measurements:

1. for **118 of django's 175 regions** the node nearest the centroid belonged to a *different*
   region, so the arch would stand in someone else's street;
2. **24 django centroids sat within 3 units of a node**, i.e. inside a monolith.

> *"Marking a district needs a derivation that is a place, not an average."*

A later session re-measured **only the first** under ADR-0041's clustering — `scripts/probe-centroids.ts`,
**0 of 100** across six repos — and `README.md` recorded *"the blocker is gone; the work is not
done."* That sentence was half true, and the half it dropped is the one still live. Measured with
the shipped footprints: **20 of the 61 topology centroids** on those six repos land inside a tower's
drawn box.

This is the repo's own *fix-written-for-one-field* landmine with the fix being a **measurement**
rather than a line of code: re-checking one clause of a two-clause refusal reads exactly like
re-checking the refusal.

## 2. Decision

**Decision 1 — an arch stands on the nearest ground to the centroid that is *standable*, where
standable is one predicate carrying both of §9.6's conditions.**

A point is standable for region *R* when

- every tower's drawn box is at least `ARCH_HALF` away (§9.6's concern 2), and
- the nearest tower is a member of *R* **by at least `ARCH_HALF`** (§9.6's concern 1).

Both clauses live in one function on purpose. A rule that satisfied one and not the other is
precisely how the first came to be re-checked and the second forgotten for a milestone.

**Decision 2 — the margin in the second clause is load-bearing and was found by a fixture, not by
reasoning.**

Written as the bare inequality *"the nearest building is a member"*, the rule is satisfied by an arch
sitting **on the Voronoi boundary** — because `standingPlace` returns the *nearest* standable point,
which is exactly where the inequality first flips. The unit fixture put one **0.14 units** inside its
own district: true under the square metric the rule uses and **false under a Euclidean one**, which
is what a claim holding by a rounding error looks like. On hugo the thinnest real margin was **0.53
units** out of a 34-unit nudge.

Requiring a whole arch-width takes the thinnest margin to **6.28** (django) and **15.05** (hugo), and
costs **one district of 61** its name.

**Decision 3 — the search is bounded by the district's own extent, so *unmarked* means something.**

Not a constant. A fixed 40 units is nothing on django and off the edge of a small district; bounding
by the distance from the centroid to the furthest member makes *"no arch"* mean **there is no
standable ground inside this district** rather than *the search gave up*. It is also strictly better:
at a fixed 40 the six repos lose 4 arches, at the district's extent they lose 1.

**Decision 4 — sample spacing is held constant along a ring, not the sample count.**

A fixed 16 samples a ring is 0.4 units apart at radius 1 and 28 units apart at radius 72 — blind
exactly where the search is working hardest. The symptom is not a wrong arch but an arch further
from its mean than it needed to be, which **no invariant can see**. django's worst nudge went
**72 → 46** and graphql-js's **50 → 17**.

**Decision 5 — terrain regions get no arch.**

ADR-0010: a terrain lump is *"files the graph has nothing to say about"*, drawn in one shared grey
precisely so the map does not claim it is a neighbourhood. An arch reading `docs` would make exactly
that claim, at eye level, in the one view where a claim is a physical object. On this repo that is
4 of 10 regions holding 60 of 246 files — a real absence, and the honest one.

**Decision 6 — the structure is four pillars and a lintel ring, in the region's own hue, and its
height is the district's tallest roof plus a clearance.**

- **Four pillars, not two.** §3.2's word is *arch*, and a two-pillar arch has a **facing**. Nothing
  in the atlas supplies one — a region is a set of nodes, not a direction — so orienting it would be
  invented geography, which is the objection §9.1 already sustained against the featureless plane.
  Axis-aligned, exactly like every tower.
- **The middle is open.** A slab across the top is a roof, and a roof hides the skyline behind it
  from anyone standing near, which is the one thing risk #4 asks the world to keep showing.
- **The region's hue is the whole point.** The world has drawn region colour since it shipped — the
  ground wash and every tower body — and has never said what any of those colours *mean*. The flat
  map answers that with a legend the world does not have. This is the legend, standing in the place
  it describes.
- **Height is derived.** A fixed 26 units put the first version *below* the skyline it was meant to
  name; the screenshots showed a gateway swallowed by its own district. `max(member height) +
  ARCH_CLEARANCE` keeps ADR-0013 intact: the arch makes no height claim of its own, it quotes the
  claims it stands among.

**Decision 7 — a district's name is pinned into view rather than dropped, with a chevron.**

An arch that clears its district's tallest roof puts its head far above the screen from underneath —
exactly when knowing which district you are in is most useful. Dropping the label there would make it
appear only at middle distance, which is the fixed-height defect moved from the geometry into the
text. The chevron is what stops a row of pinned names reading as chrome: it says *that way*, not
*here*.

District names go through the **same collision pass** as file names, placed first. Two passes would
let a district's name land on top of the file name of the tower it stands beside.

**Decision 8 — there is no rule keeping two districts out of one doorway, and the absence is
measured.**

One was written. Then it was measured, and it cannot fire in the band that matters: if arches for A
and B stand `s` apart, each is `ARCH_HALF` deeper into its own territory than the other's, and the
triangle inequality over the same metric gives `ARCH_HALF ≤ s` outright — they can never
interpenetrate. On six repos the **closest pair is 59.3 units** (django) against an 11.2-unit
collision width, 5.3× headroom. A branch that cannot fire is code, comment and test surface asserting
a behaviour the product does not have, so it is gone and this paragraph is what replaces it.

## 3. What it costs, stated

| repo | topology regions | centroid inside a building | arches placed | max nudge | mean nudge | worst nudge / extent | wrong district | thinnest margin | closest pair |
|---|---|---|---|---|---|---|---|---|---|
| ark | 6 | 3 | 6 | 26 | 11.5 | 37% | 0 | 45.65 | 103.9 |
| hono | 11 | 4 | 11 | 21 | 6.8 | 23% | 0 | 19.07 | 76.9 |
| django | 15 | 7 | **14** | 46 | 12.4 | 31% | 0 | 6.28 | 59.3 |
| hugo | 9 | 2 | 9 | 34 | 11.8 | 44% | 0 | 15.05 | 72.2 |
| kysely | 9 | 2 | 9 | 18 | 6.8 | 34% | 0 | 26.47 | 101.9 |
| graphql-js | 11 | 2 | 11 | 17 | 5.8 | 19% | 0 | 17.18 | 69.5 |

**60 of 61 districts are marked.** The one that is not is django's `around django/core/__init__.py`
(67 files): no ground inside its own extent clears every building *and* stands a whole arch-width
inside its own territory. That is a district going unnamed on a repo where 14 others are named, and
it is reported here rather than rescued by a relaxed second pass — a fallback that fires once in 61
is a fallback nothing tests.

The **nudge** is the honest cost of the rest. An arch moves a mean of 5.8–12.4 units and at worst
half a district's extent, so it marks the district's *nearest standable ground*, not its centre.
`Arch.nudge` records how far, so the claim is checkable rather than implied.

## 4. What was checked, and what a suite could not see

Eight mutants of `placeArches`, each reverted by copying the file back rather than with
`git checkout` (this repo has a landmine about that). **All eight die**, and two of them only after
the test that should have caught them was rewritten:

| mutant | killed by |
|---|---|
| clearance check deleted | *stands every arch clear of every building* — **after** the fixture changed |
| membership margin deleted | *stands in its own district's street, by a whole arch's width* |
| margin reduced to a bare inequality | the same test — **after** the margin was written into it |
| terrain skip deleted | *marks no terrain region, however big it is* |
| height replaced by a constant | *clears the tallest roof in its own district and no other* |
| search bound replaced by 4,000 | *gives up rather than leaving the district it is naming* |
| never nudges | four tests |
| fixed samples per ring | *finds the nearest standable ground in any direction* |

Two of those rewrites are the finding, not the housekeeping.

**The clearance assertion was vacuous over the mixed fixture.** The membership margin already pushes
an arch away from *foreign* buildings, so deleting the clearance check changed nothing and the mutant
lived. It takes a district whose own centroid sits inside *its own* monolith to exercise it — the
degenerate-fixture landmine, and the fixture in question was written to reproduce §9.6 faithfully,
which is exactly what made it blind to this.

**The isotropy assertion has no invariant behind it.** Decision 4 is a quality knob: a coarser search
still satisfies every invariant above and simply parks the arch further out. The property that *does*
bite is that the answer must not depend on which way the fixture is facing — rotate it about the
centroid and the nudge should barely move. Measured over fifteen rotations: **spread 4** at constant
sample spacing, **spread 7** at eight samples a ring. The bar sits in that gap with both neighbours
named, per ADR-0025's rule.

## 5. What this does not claim

It does not claim the world teaches better than the map. `docs/experiments/0001` is unrun and
ADR-0033's S1 gate stands; the flat map is still the arrival state. It does not touch `node.layout`,
the atlas, or any verb — `placeArches` is player-side, derived from coordinates the indexer froze,
and `test:determinism` is byte-identical across it.

It also does not disclose anything. An arch states `Region.label` at a position derived from
`Region.centroid`, and the flat map has drawn region labels at their centroids, ungated by fog, since
M1. No verb's answer key mentions a region.
