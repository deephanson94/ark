/**
 * Fog of war.
 *
 * NORTH-STAR §4 is emphatic that this is not a game mechanic bolted on: the
 * revealed fraction of the map is an honest measure of how much of the codebase
 * the player can actually reason about. So the state here distinguishes two
 * things that are easy to conflate and must not be:
 *
 *   surveyed    you looked at it. You were shown its name and its numbers.
 *   understood  you proved you knew something about it, by being graded
 *               against ground truth.
 *
 * That distinction *is* the product (§9: field notes accumulate facts you have
 * proven you know, not facts you were shown).
 *
 * **This module owns the vocabulary, not the state.** A `Fog` is derived from
 * the player's stored record by `progress.ts` — there is one source of truth
 * and it is the record, because `understood` stored alongside the passes that
 * justify it would be two representations of one fact, and after a reindex they
 * would disagree (ADR-0011).
 *
 * Risk #4 says fog must never read as "the tool is hiding things from me", so
 * an unsurveyed node is still drawn — position, size and region shape are all
 * visible. What is withheld is its identity, which is the thing you have not
 * earned yet.
 */

import type { NodeId } from '../atlas/index.js';

export type Visibility = 'silhouette' | 'surveyed' | 'understood';

export interface Fog {
  readonly surveyed: ReadonlySet<NodeId>;
  readonly understood: ReadonlySet<NodeId>;
}

export function visibilityOf(fog: Fog, id: NodeId): Visibility {
  if (fog.understood.has(id)) return 'understood';
  if (fog.surveyed.has(id)) return 'surveyed';
  return 'silhouette';
}

export interface Coverage {
  readonly surveyed: number;
  readonly understood: number;
  readonly total: number;
  /** Fraction of the map the player can reason about. 0..1. */
  readonly fraction: number;
}

/**
 * The nodes a newcomer can see from the shore.
 *
 * NORTH-STAR §4 opens the loop with "see the map, mostly fogged → **pick a
 * landmark**", and you cannot pick a landmark you cannot see. A map where every
 * name is withheld is not fogged, it is blank — 64 identical grey discs, with
 * hovering each one in turn as the only way in. That is risk #4 exactly: fog
 * that reads as the tool hiding things.
 *
 * So the most depended-upon files start named. This is the honest kind of
 * head start: a hub with thirty dependents is visible from anywhere in a
 * codebase, the way a mountain is. It tells you the file exists and what it is
 * called. It tells you nothing about what depends on it — which is the question
 * the game is going to ask, and which still has to be earned.
 *
 * **Ranked by `elevation` first** — ADR-0013's transitive dependent count —
 * then by in-degree, size and id, so the choice is derived from the graph and
 * identical on every machine.
 *
 * Elevation rather than in-degree, because in-degree is a proxy and it is wrong
 * in exactly the interesting places. A *chokepoint* is a file few things import
 * directly but nearly everything reaches through a barrel: `src/atlas/identity.ts`
 * has **2 direct importers and 60 transitive dependents**, `hono`'s
 * `src/utils/mime.ts` has 5 and 245. Measured, ranking by elevation replaces
 * **8 of this repo's 13 landmarks** and 23 of hono's 51 — and those are the
 * files a newcomer most needs named, because their importance is the thing you
 * cannot see by looking.
 *
 * `limit` exists because a fraction does not scale. At 12% svelte would name
 * **488** landmarks, and a skyline of 488 peaks is a plateau: the prior-art
 * writeup's §4.3.5 says three or four globally visible landmarks outperform any
 * amount of terrain, so the count is capped rather than grown.
 */
export function landmarks(
  ranked: readonly {
    readonly id: NodeId;
    readonly elevation: number;
    readonly dependentCount: number;
    readonly radius: number;
  }[],
  fraction = 0.12,
  minimum = 3,
  limit = 24,
): NodeId[] {
  const count = Math.min(
    ranked.length,
    limit,
    Math.max(minimum, Math.ceil(ranked.length * fraction)),
  );
  return [...ranked]
    .sort(
      (a, b) =>
        b.elevation - a.elevation ||
        b.dependentCount - a.dependentCount ||
        b.radius - a.radius ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, count)
    .map((node) => node.id);
}

export function coverage(fog: Fog, total: number): Coverage {
  const understood = fog.understood.size;
  return {
    surveyed: fog.surveyed.size,
    understood,
    total,
    fraction: total === 0 ? 0 : understood / total,
  };
}
