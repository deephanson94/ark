/**
 * How far the map turns between challenges, and how it gets there.
 *
 * ## Why the map turns at all
 *
 * `docs/prior-art.md` §4.4, which has called this the highest-leverage,
 * lowest-cost item in the whole writeup for three sessions. **Map-derived
 * spatial memory is orientation-specific**: after learning a layout from a map,
 * judgments are easy when the test aligns with the learned orientation and
 * measurably harder when it does not (Presson & Hazelrigg; Shelton & McNamara;
 * König et al. report the same north-alignment effect). Navigation-derived
 * memory does not have this property, but Ark teaches from a map.
 *
 * Ark's map was north-up and fixed forever, and both verbs pick an arbitrary
 * subject each time — so every question was answered from the one orientation
 * the evidence says will not transfer. That is NORTH-STAR risk #1, the risk
 * that decides whether this is a skill-builder or a per-repo novelty.
 *
 * **Pillar 4 is not in play.** `node.layout` is computed in the indexer and
 * frozen (ADR-0006); no node moves relative to any other, ever. A bearing is a
 * property of the viewer, exactly as `scale` is.
 *
 * ## Why the golden angle, and not a round number
 *
 * The step has to be **irrational as a fraction of a full turn**, or the deck
 * cycles through a handful of alignments and re-locks the thing it was supposed
 * to break. Over a full clear of this repo's 80-question deck — counting the
 * heading each question is *answered from*, which includes the first, answered
 * north-up on arrival by design:
 *
 * | step | distinct headings | answered from exactly north | within 15° of it |
 * |---|---:|---:|---:|
 * | 90° | **4** | **20** | 20 |
 * | 72° | **5** | 16 | 16 |
 * | golden (137.5°) | **80** | **1** | 7 |
 *
 * A 90° step spends a whole playthrough on four alignments and puts a quarter
 * of the deck back at north — which is the defect wearing a rotation. The
 * golden angle is the canonical maximal-spread constant and it behaves like
 * one: every heading distinct, none repeated, and the near-north share falls to
 * roughly what an even spread would give (7/80 against 30/360 = 6.7/80).
 *
 * A hashed heading — FNV-1a over `challenge.id`, mod K — was the other candidate
 * and measured worse on the property that matters: at K = 8, **12 to 14 of 80
 * consecutive pairs shared a bucket** (a range because the deck is regenerated
 * at every commit and ark indexes itself), so the map did not turn at all
 * between them. A fixed irrational step cannot produce a turn that is not a
 * turn.
 *
 * ## What is *not* here
 *
 * No counter, and deliberately. The heading advances from wherever the camera
 * is now, so the state is the camera's own bearing and there is no position in
 * a sequence — nothing cursor-shaped to be tempted into the save, which
 * ADR-0011 decision 2 forbids. Nothing here is persisted: every session arrives
 * north-up, at the canonical map (ADR-0009's D1 overview), and turns from
 * there.
 */

/**
 * The golden angle, in radians — one full turn less the golden-ratio share of
 * it, ≈ 137.508°.
 *
 * Written as arithmetic on φ rather than as a decimal so that what it *is*
 * survives being read: the irrationality is the whole argument, and a rounded
 * literal would eventually be "tidied" into 137.5 and then into 135.
 */
const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_TURN = Math.PI * 2 * (1 - 1 / PHI);

/**
 * How long a turn takes.
 *
 * Long enough that the eye can follow a region round — the point of animating
 * rather than snapping is that the player keeps the correspondence between the
 * map they knew and the map they now have — and short enough that it is over
 * before anyone reaches for the next landmark.
 */
export const TURN_MS = 620;

/**
 * Smoothstep, clamped. Eases in and out so the turn has no visible start or
 * stop, which is what makes it read as the world turning rather than as the
 * screen redrawing.
 */
export function easeTurn(t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The bearing partway through a turn.
 *
 * Interpolates along the signed difference, so a turn of +137° goes one way and
 * a snap back to north goes the short way — the caller decides the direction by
 * choosing `to`, and this never re-derives it.
 *
 * A non-positive duration lands immediately, and that is the
 * `prefers-reduced-motion` path **because the player passes a duration of zero**
 * — not because it takes a different route. Some people should not be shown a
 * spinning world at all, and the honest way to serve them is a turn of no
 * length rather than a second branch that skips this function. It *was* that
 * second branch for one commit, which left this case dead in the product while
 * the test exercised it under exactly that name: the same defect this file's
 * own easing assertion exists to catch, one function along.
 */
export function bearingDuring(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * easeTurn(elapsed / duration);
}
