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
 * proven you know, not facts you were shown). At M1 nothing can move a node
 * into `understood`, because challenge generation lands at M2 — so the counter
 * reads `0 understood` and that is the truthful number, not a stub.
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

export const CLEAR_FOG: Fog = { surveyed: new Set(), understood: new Set() };

export function survey(fog: Fog, id: NodeId): Fog {
  if (fog.surveyed.has(id)) return fog;
  return { surveyed: new Set([...fog.surveyed, id]), understood: fog.understood };
}

/**
 * Promote nodes the player has proven they understand. Understanding implies
 * having surveyed — you cannot know a file you have never seen named.
 */
export function understand(fog: Fog, ids: Iterable<NodeId>): Fog {
  const understood = new Set(fog.understood);
  const surveyed = new Set(fog.surveyed);
  for (const id of ids) {
    understood.add(id);
    surveyed.add(id);
  }
  return { surveyed, understood };
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
 * Ranked by in-degree, then size, then id, so the choice is derived from the
 * graph and identical on every machine.
 */
export function landmarks(
  ranked: readonly { readonly id: NodeId; readonly dependentCount: number; readonly radius: number }[],
  fraction = 0.12,
  minimum = 3,
): NodeId[] {
  const count = Math.min(ranked.length, Math.max(minimum, Math.ceil(ranked.length * fraction)));
  return [...ranked]
    .sort(
      (a, b) =>
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
