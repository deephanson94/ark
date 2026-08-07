/**
 * Field notes: what the player has *proved*, written down.
 *
 * NORTH-STAR §9 calls this the codex equivalent and says it "accumulates facts
 * you have **proven** you know, not facts you were shown. That distinction is
 * the whole product." This module is where that promise is either kept or
 * quietly broken, so every claim below is narrower than it could be.
 *
 * ## What a note may say
 *
 * §9's own example — *"You know that `engine.ts` has 14 dependents"* — is not
 * provable and is amended by ADR-0011 decision 3. Under ADR-0008 a hub's answer
 * key is a deterministic **sample** of its dependents: a player who passes has
 * proved some of them, never the count. The number was *shown* to them in the
 * reveal, which is the `surveyed` side of the very line §9 says is the product.
 *
 * So a note claims the members, and states the radius **only as revealed**:
 *
 *   claim     "You proved 4 files that depend on engine.ts — a, b, c, d —
 *              the farthest 3 hops away."
 *   revealed  "Its full radius — 39 files — is unlocked on your map."
 *
 * Correct *exclusions* get no note either. `progress.ts` already declines to
 * promote a box you left unticked, and a note must not claim more than the fog.
 *
 * ## Prose is derived, never stored
 *
 * The stored `passes` *are* the notes; the sentences are built here from
 * templates that mention no repo. Names resolve `NodeId → path` through the
 * atlas currently loaded, which is what makes a note follow a rename — ADR-0002
 * doing the job it was written for.
 *
 * ## Facts decay
 *
 * Provenance is immutable: you did prove it. The claim about *today* is not, so
 * every member is re-checked against the live graph by `livePasses`, and a pair
 * the graph no longer supports is dropped rather than shown stale. A subject
 * that no longer exists goes dormant — retained in storage, absent here.
 */

import type { Graph, NodeId } from '../atlas/index.js';
import { byteCompare, dependents, idOf, nodeAt } from '../atlas/index.js';
import type { Liveness, Progress } from './progress.js';
import { livePasses } from './progress.js';

export interface ProvedFile {
  readonly path: string;
  /** Hops from this file to the subject. At least 1. */
  readonly distance: number;
}

export interface FieldNote {
  readonly subject: NodeId;
  readonly subjectPath: string;
  /** Sorted by distance, then path. Never empty — an empty note is dropped. */
  readonly proved: readonly ProvedFile[];
  /** The furthest hop among `proved`. */
  readonly farthest: number;
  /**
   * The subject's full transitive dependent count **today**.
   *
   * This is *revealed*, not proved, and the prose has to say so. It is
   * recomputed rather than stored, because it is a property of the current
   * graph and the player's claim is about the files, not the count.
   */
  readonly radius: number;
}

/**
 * Every note the record supports against the atlas currently loaded.
 *
 * Ordered by radius descending, then subject path — biggest thing you know
 * first, and derived from the graph, so two machines showing the same save show
 * the same page.
 */
export function fieldNotes(graph: Graph, progress: Progress, liveness: Liveness): FieldNote[] {
  const notes: FieldNote[] = [];
  for (const pass of livePasses(progress, liveness)) {
    const subjectRef = graph.refById.get(pass.subject);
    if (subjectRef === undefined) continue;
    const cone = dependents(graph, subjectRef, Infinity);
    const distanceById = new Map<NodeId, number>();
    for (const [ref, distance] of cone) distanceById.set(idOf(graph, ref), distance);

    const proved: ProvedFile[] = [];
    for (const member of pass.proved) {
      const ref = graph.refById.get(member);
      const distance = distanceById.get(member);
      // Both guards are **unreachable in practice**, and that is deliberate:
      // `livePasses` has already dropped every member the graph no longer
      // supports, so a surviving pass is non-empty and each member is in the
      // cone. Mutation testing confirmed it — disabling either changes no test.
      // They stay because the types demand them and because `Math.max()` of an
      // empty list is `-Infinity`, not because there are two filters. The rule
      // lives in `livePasses` and only there.
      if (ref === undefined || distance === undefined) continue;
      proved.push({ path: nodeAt(graph, ref).path, distance });
    }
    if (proved.length === 0) continue;
    proved.sort((a, b) => a.distance - b.distance || byteCompare(a.path, b.path));
    notes.push({
      subject: pass.subject,
      subjectPath: nodeAt(graph, subjectRef).path,
      proved,
      farthest: Math.max(...proved.map((file) => file.distance)),
      radius: cone.size,
    });
  }
  notes.sort((a, b) => b.radius - a.radius || byteCompare(a.subjectPath, b.subjectPath));
  return notes;
}

export interface NoteProse {
  /** What the player proved. Safe to state as knowledge. */
  readonly claim: string;
  /** What they were shown. Null when there is nothing beyond the claim. */
  readonly revealed: string | null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A note in words. Repo-agnostic templates (guardrail 2) — every specific
 * string in the output came out of the atlas.
 */
export function noteProse(note: FieldNote): NoteProse {
  const count = note.proved.length;
  const names = note.proved.map((file) => file.path).join(', ');
  const reach =
    note.farthest === 1
      ? 'all of them direct importers'
      : `the farthest ${note.farthest} hops away`;
  const claim =
    `You proved ${count} ${plural(count, 'file', 'files')} that ` +
    `${plural(count, 'depends', 'depend')} on ${note.subjectPath} — ${names} — ${reach}.`;

  // The gap between what was proved and what the map shows is exactly the
  // sampled part of the answer key (ADR-0008). Naming it as *revealed* is what
  // keeps the sentence above honest; collapsing the two would restore §9's
  // unprovable example.
  const revealed =
    note.radius > count
      ? `Its full radius — ${note.radius} ${plural(note.radius, 'file', 'files')} — is revealed on your map.`
      : null;
  return { claim, revealed };
}
