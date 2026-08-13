/**
 * Sizing and sampling, shared by every verb that ships a *sample* of an answer.
 *
 * All three functions below existed as byte-identical copies in
 * `blastRadius/`, `companion/` and `placement/` — and `placement/generate.ts`
 * said so out loud about one of them (*"the same expression appears in
 * `companion/generate.ts` for the same reason"*). A fourth verb would have made
 * four copies of each, so they moved here on exactly the precedent
 * `src/verbs/index.ts` records for `difficulty.ts`, `gate.ts` and `paths.ts`:
 * self-contained means a verb owns its *semantics*, not that it hoards shared
 * machinery.
 *
 * Nothing here has verb semantics. `truthCap` is arithmetic on ADR-0007's
 * sizing rule, `spread` is order-agnostic by construction, and `retain` sorts by
 * a field every challenge has.
 */

import type { Challenge, Graph } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';

/**
 * The largest answer key that still satisfies ADR-0007's 3:1 rule at a given
 * choice-set size.
 *
 * Arithmetic rather than a policy: selecting everything scores
 * `2t/(t+c)`, which is below the 0.5 pass threshold exactly when `c > 3t`.
 */
export function truthCap(candidateCount: number): number {
  return Math.max(0, Math.floor((candidateCount - 1) / 3));
}

/**
 * `size` members of `items`, spread evenly across the list.
 *
 * Indices are strictly increasing whenever `size <= items.length` (they are
 * `round(i·(L−1)/(size−1))` over a list at least as long as the sample), so the
 * result never collapses to fewer than `size` entries.
 *
 * **Order-agnostic on purpose: the caller decides what "evenly across" means by
 * choosing the ordering, and that choice is a decision each time.** Placement
 * spreads over a *path* ordering, because a commit's file list arrives in an
 * FNV-1a hash shuffle and spreading over noise is stable and meaningless
 * (ADR-0018 decision 4). Archaeology spreads over a *date* ordering, because the
 * meaningful axis for a file's history is time — a sample spread across it is
 * the arc of the file's life rather than its six busiest weeks (ADR-0019
 * decision 3).
 */
export function spread<T>(items: readonly T[], size: number): T[] {
  if (size >= items.length) return [...items];
  const out: T[] = [];
  for (let i = 0; i < size; i++) {
    const at = size === 1 ? 0 : Math.round((i * (items.length - 1)) / (size - 1));
    const item = items[at];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * Drop to `max` while keeping the difficulty range — and spend each slot on the
 * most load-bearing subject in its band.
 *
 * Evenly spaced samples of the difficulty-sorted list keep both ends and the
 * middle, so the progression curve survives the cut rather than the deck
 * becoming whichever questions sorted first. That part is unchanged and is why
 * this function exists.
 *
 * **What changed is what happens inside a band, and it is the fix for a measured
 * product defect.** The old rule took the entry at one computed *index*, so
 * which subject survived the cap was decided by where it happened to fall in a
 * difficulty sort. The cap bites on every repo measured — `honojs/hono`'s Blast
 * Radius considered 218 subjects and shipped 54, `capped = 95` against
 * `uncertain = 7` — and what it cut was the thing a player is most likely to
 * click:
 *
 *   src/context.ts   76 importers   — no board
 *   src/hono.ts      72 importers   — no board
 *   src/router.ts    32 importers   — no board
 *
 * Six of hono's fifteen most-imported files carried any board at all, and seven
 * of kysely's — whose `src/util/object-utils.ts` has **183 importers** and no
 * question. A cold playtester found it from the other end and stopped playing
 * there: *"the map begs you to click landmarks and the landmarks are mute."*
 *
 * So the bands are now contiguous and each contributes its **most important**
 * member. The difficulty range is preserved exactly as before — one pick per
 * band, bands partition the whole list — and the slot goes to the subject worth
 * asking about.
 *
 * **`importance` is the caller's to define and every caller passes one**, rather
 * than defaulting, because a default here is a decision nobody made: the right
 * measure is `elevation` for a verb whose subject is a file (ADR-0013 — the bit
 * length of the transitive dependent count, which is also the map's vertical
 * channel, so the deck agrees with the picture) and there is no such thing for a
 * verb whose subject is a commit.
 *
 * **The tiebreak is three-deep and the middle step is the load-bearing one**:
 * highest importance, then *nearest the band's anchor*, then lowest challenge
 * id. Each band's anchor is the index the old rule took, so a band whose members
 * are all equally important yields exactly the entry it yielded before — which
 * is what makes this a generalisation of the previous behaviour rather than a
 * replacement for it, and is why `placement`, whose subjects are commits and are
 * therefore uniformly unimportant here, ships a **byte-identical deck**. That
 * identity is asserted on the real atlas rather than argued: drop the anchor and
 * every band falls through to its lowest id, which silently discards the *ends*
 * of the difficulty range — the property this function exists for. The id step
 * decides only between entries equidistant from the anchor, and exists so the
 * result is total and deterministic.
 */
export function retain<T extends { challenge: Challenge }>(
  entries: readonly T[],
  max: number,
  importance: (entry: T) => number,
): T[] {
  if (entries.length <= max) return [...entries];
  if (max <= 0) return [];
  const ordered = [...entries].sort(
    (a, b) =>
      a.challenge.difficulty - b.challenge.difficulty || byteCompare(a.challenge.id, b.challenge.id),
  );
  // **The anchors are the indices the old rule took**, and the bands are built
  // around them rather than the other way round. That ordering is the whole
  // trick, and getting it backwards is a real defect this function shipped for
  // an afternoon: evenly-spaced *anchors* are `(L−1)/(max−1)` apart while evenly
  // -spaced *bands* are `L/max` wide, so the anchors drift forward and by the
  // last few bands the drift exceeds a whole band — on hono's 183 Placement
  // entries in 54 bands, band 52's anchor lands in band 53. Clamping it back
  // moved the pick, so "flat importance reproduces the old deck" was false on 3
  // of hono's boards and 7 of kysely's. Anchored bands make it true.
  const anchors: number[] = [];
  for (let band = 0; band < max; band++) {
    anchors.push(max === 1 ? 0 : Math.round((band * (ordered.length - 1)) / (max - 1)));
  }
  // Strictly increasing, because `entries.length > max` above makes the spacing
  // greater than 1. (The old implementation collected these into a `Set` and
  // then padded from index 0 if any two collided — that padding was unreachable
  // for the same reason, and is not carried over.)
  const kept: T[] = [];
  for (let band = 0; band < max; band++) {
    const anchor = anchors[band] as number;
    // Half-open, splitting each gap between neighbouring anchors at its
    // midpoint: contiguous, partitioning, and every band contains its own
    // anchor, so no band is empty and every entry is considered exactly once.
    const from = band === 0 ? 0 : Math.ceil(((anchors[band - 1] as number) + anchor) / 2);
    const to =
      band === max - 1 ? ordered.length : Math.ceil((anchor + (anchors[band + 1] as number)) / 2);
    let best: T | undefined;
    let bestScore = 0;
    let bestGap = 0;
    for (let at = from; at < to; at++) {
      const entry = ordered[at];
      if (entry === undefined) continue;
      const score = importance(entry);
      const gap = Math.abs(at - anchor);
      if (
        best === undefined ||
        score > bestScore ||
        (score === bestScore &&
          (gap < bestGap ||
            (gap === bestGap && byteCompare(entry.challenge.id, best.challenge.id) < 0)))
      ) {
        best = entry;
        bestScore = score;
        bestGap = gap;
      }
    }
    if (best !== undefined) kept.push(best);
  }
  return kept;
}

/**
 * How load-bearing this challenge's subject is, for `retain`'s band pick.
 *
 * `elevation` is ADR-0013's bit length of the transitive dependent count — one
 * layer up is twice as depended-upon — and it is the map's vertical channel, so
 * a deck ranked by it agrees with the picture the player is looking at. A
 * subject the graph cannot place (a commit) scores 0, which is why the verb
 * whose subject is a commit passes its own flat function rather than this.
 */
export function elevationOf(entry: { challenge: Challenge }, graph: Graph): number {
  const ref = graph.refById.get(entry.challenge.subject);
  return ref === undefined ? 0 : (graph.atlas.nodes[ref]?.elevation ?? 0);
}
