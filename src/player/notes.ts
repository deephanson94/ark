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

import type { Graph, NodeId, VerbId } from '../atlas/index.js';
import { byteCompare, dependents, idOf, nodeAt } from '../atlas/index.js';
import { indexCoChange } from '../verbs/companion/index.js';
import type { Liveness, Progress } from './progress.js';
import { livePasses } from './progress.js';

export interface ProvedFile {
  readonly path: string;
  /**
   * How far this file sits from the subject, in the unit its verb measures in:
   * import hops for Blast Radius, shared commits for Companion. At least 1.
   *
   * One field rather than two because a note only ever renders one verb's
   * claim, and `noteProse` says which unit it is in. Two nullable fields would
   * make every reader ask which one is populated.
   */
  readonly weight: number;
}

export interface FieldNote {
  readonly verb: VerbId;
  readonly subject: NodeId;
  readonly subjectPath: string;
  /** Sorted by weight, then path. Never empty — an empty note is dropped. */
  readonly proved: readonly ProvedFile[];
  /** The largest `weight` among `proved`. */
  readonly farthest: number;
  /**
   * The size of the subject's full population **today** — its transitive
   * dependents, or its co-change partners.
   *
   * This is *revealed*, not proved, and the prose has to say so. It is
   * recomputed rather than stored, because it is a property of the current
   * atlas and the player's claim is about the files, not the count.
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
/**
 * How far each node sits from the subject, in the unit this verb measures in.
 *
 * The two verbs have genuinely different rulers and neither can be expressed in
 * the other. Before M4 this was a bare `dependents()` call, and a Companion pass
 * reaching it would have found no import distance for any of its members and
 * been **silently dropped** — the note would simply not appear, with nothing to
 * say it had gone.
 */
function weightsFor(graph: Graph, verb: VerbId, subjectRef: number): Map<NodeId, number> {
  const weights = new Map<NodeId, number>();
  if (verb === 'companion') {
    const row = indexCoChange(graph.atlas).rows.get(subjectRef);
    for (const [ref, count] of row ?? []) weights.set(idOf(graph, ref), count);
    return weights;
  }
  for (const [ref, distance] of dependents(graph, subjectRef, Infinity)) {
    weights.set(idOf(graph, ref), distance);
  }
  return weights;
}

export function fieldNotes(graph: Graph, progress: Progress, liveness: Liveness): FieldNote[] {
  const notes: FieldNote[] = [];
  for (const pass of livePasses(progress, liveness)) {
    const subjectRef = graph.refById.get(pass.subject);
    if (subjectRef === undefined) continue;
    const weights = weightsFor(graph, pass.verb, subjectRef);

    const proved: ProvedFile[] = [];
    for (const member of pass.proved) {
      const ref = graph.refById.get(member);
      const weight = weights.get(member);
      // Both guards are **unreachable in practice**, and that is deliberate:
      // `livePasses` has already dropped every member the current atlas no
      // longer supports, using the same verb's own rule, so a surviving pass is
      // non-empty and each member has a weight. Mutation testing confirmed it —
      // disabling either changes no test. They stay because the types demand
      // them and because `Math.max()` of an empty list is `-Infinity`, not
      // because there are two filters. The rule lives in `livePasses` and only
      // there.
      if (ref === undefined || weight === undefined) continue;
      proved.push({ path: nodeAt(graph, ref).path, weight });
    }
    if (proved.length === 0) continue;
    // Ascending for hops (nearest first) and for counts alike: the ordering is
    // only there to make the sentence read the same way twice, and `farthest`
    // states which end carries the claim.
    proved.sort((a, b) => a.weight - b.weight || byteCompare(a.path, b.path));
    notes.push({
      verb: pass.verb,
      subject: pass.subject,
      subjectPath: nodeAt(graph, subjectRef).path,
      proved,
      farthest: Math.max(...proved.map((file) => file.weight)),
      radius: weights.size,
    });
  }
  notes.sort(
    (a, b) =>
      b.radius - a.radius ||
      byteCompare(a.subjectPath, b.subjectPath) ||
      byteCompare(a.verb, b.verb),
  );
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

  // Each verb's sentence states its own relation in its own unit. A single
  // template would have had to describe a co-change count as a distance.
  const claim =
    note.verb === 'companion'
      ? `You proved ${count} ${plural(count, 'file', 'files')} that ` +
        `${plural(count, 'changes', 'change')} with ${note.subjectPath} — ${names} — ` +
        `the strongest sharing ${note.farthest} ${plural(note.farthest, 'commit', 'commits')}.`
      : `You proved ${count} ${plural(count, 'file', 'files')} that ` +
        `${plural(count, 'depends', 'depend')} on ${note.subjectPath} — ${names} — ` +
        `${note.farthest === 1 ? 'all of them direct importers' : `the farthest ${note.farthest} hops away`}.`;

  // The gap between what was proved and what the map shows is exactly the
  // sampled part of the answer key (ADR-0008). Naming it as *revealed* is what
  // keeps the sentence above honest; collapsing the two would restore §9's
  // unprovable example.
  const revealed =
    note.radius > count
      ? note.verb === 'companion'
        ? `It has changed with ${note.radius} ${plural(note.radius, 'file', 'files')} in all — the other ${note.radius - count} revealed to you, never proved.`
        : `Its full radius — ${note.radius} ${plural(note.radius, 'file', 'files')} — is revealed on your map.`
      : null;
  return { claim, revealed };
}
