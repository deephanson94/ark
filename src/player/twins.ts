/**
 * Twins: files nothing in the repository can tell apart.
 *
 * `cone(A) = cone(B)` — the same transitive dependent set, reached by the same
 * paths — is the import graph's version of NORTH-STAR §2's *"one module wearing
 * two hats"*, and [ADR-0030](../../docs/decisions/0030-a-twin-is-named-once-its-whole-class-is-cleared.md)
 * measured it as **common**: 15.5% of ark's blast-eligible subjects, 15.2% of
 * hono's, 32.3% of prometheus's, whose largest class is 25 interchangeable
 * `discovery/*` packages.
 *
 * ## The gate, and why it is on the class
 *
 * Naming a twin is a Ctrl+F-grade leak in the direction nobody looks. The keys
 * provably cannot overlap — ADR-0012 tiles the windows — but a **passed board
 * certifies its distractors as non-dependents of the twin too**, which decides
 * 4 of the 12 twin pairs that could carry it, best 0.923 against a 0.78 bar.
 *
 * So a class is named only when **no member still carries an unanswered Blast
 * Radius board**. The unit is the class, never the pair and never the row:
 * ADR-0020's rule, load-bearing here rather than stylistic, because a per-row
 * guard would make the *absence* of a twin line say *"this one's sibling still
 * has a board open"* — a stronger hint than the sentence it replaced, and one
 * that points at a specific node.
 *
 * **Answered, not passed** (ADR-0030 decision 2): what the leak needs is the
 * other board's *reveal*, which a player sees whatever they scored, and ark
 * never punishes a wrong answer.
 *
 * ## Derived, not carried
 *
 * Computed from `edges` in the player rather than stored in the atlas — a
 * `twins: NodeId[][]` field would be a second encoding of something the graph
 * already determines, which is the ground ADR-0025's alternatives section
 * refuses. One sweep of `dependents`, once, at load.
 */

import type { Graph, NodeId, NodeRef } from '../atlas/index.js';
import { dependents } from '../atlas/index.js';

export interface TwinClass {
  /** Every member, sorted by node id so the sentence reads the same every time. */
  readonly members: readonly NodeRef[];
  /**
   * How many places reach all of them. The whole content of the claim: a class
   * whose cone is one node is thin and true, and the count is what tells a
   * reader so (ADR-0030 decision 5).
   */
  readonly coneSize: number;
}

export interface Twins {
  /** Class index per member, or `undefined` for a node with no twin. */
  readonly classOf: ReadonlyMap<NodeRef, number>;
  readonly classes: readonly TwinClass[];
}

export const NO_TWINS: Twins = { classOf: new Map(), classes: [] };

/**
 * Group nodes by identical transitive dependent set.
 *
 * **Over the full cone, not the sampled key.** Two subjects can share an answer
 * *key* and differ in cone — ADR-0012 calls that cause B, and svelte had six
 * such groups — which is a sampling artifact and is not this fact.
 *
 * A node with an empty cone is not a twin of every other leaf: "nothing depends
 * on either of us" is a statement about the absence of a relation, and the claim
 * this makes is that two files are *reached identically*. Empty cones are
 * skipped.
 */
export function findTwins(graph: Graph, ids: readonly NodeId[]): Twins {
  const byCone = new Map<string, NodeRef[]>();
  for (let ref = 0; ref < ids.length; ref++) {
    const cone = dependents(graph, ref, Number.POSITIVE_INFINITY);
    if (cone.size === 0) continue;
    // Sorted numerically, so the key is a property of the set rather than of
    // the traversal order that produced it.
    const key = [...cone.keys()].sort((a, b) => a - b).join(',');
    const bucket = byCone.get(key);
    if (bucket === undefined) byCone.set(key, [ref]);
    else bucket.push(ref);
  }

  const classes: TwinClass[] = [];
  const classOf = new Map<NodeRef, number>();
  // Sorted by the first member's id, so two runs over the same atlas produce
  // the same class order — the same reason every array in the atlas is sorted.
  const buckets = [...byCone.entries()]
    .filter(([, members]) => members.length > 1)
    .sort((a, b) => {
      const left = ids[(a[1][0] ?? 0) as number] ?? '';
      const right = ids[(b[1][0] ?? 0) as number] ?? '';
      return left < right ? -1 : left > right ? 1 : 0;
    });
  for (const [key, members] of buckets) {
    const index = classes.length;
    const sorted = [...members].sort((a, b) => {
      const left = ids[a] ?? '';
      const right = ids[b] ?? '';
      return left < right ? -1 : left > right ? 1 : 0;
    });
    for (const member of sorted) classOf.set(member, index);
    classes.push({ members: sorted, coneSize: key === '' ? 0 : key.split(',').length });
  }
  return { classOf, classes };
}

/**
 * The class this node belongs to, **if it may be named**.
 *
 * `null` covers both "no twin" and "the gate is closed", deliberately: a caller
 * that could tell those apart would be able to render the difference, and the
 * difference is the fact being withheld.
 */
export function nameableClass(
  twins: Twins,
  ref: NodeRef,
  hasOpenBoard: (member: NodeRef) => boolean,
): TwinClass | null {
  const index = twins.classOf.get(ref);
  if (index === undefined) return null;
  const found = twins.classes[index];
  if (found === undefined) return null;
  for (const member of found.members) {
    if (hasOpenBoard(member)) return null;
  }
  return found;
}
