/**
 * Everything the generator needs about *commits*, inverted once.
 *
 * This module exists because of a landmine this repo has now been bitten by
 * twice. `blastRadius/distractors.ts` has documented since M2 that per-node work
 * inside a per-subject loop costs `O(V²)` — *"8 s of a 10 s index budget"* — and
 * M4's Companion did it anyway, at **29.7 s on svelte against Blast Radius's
 * 0.6**. Archaeology asks for a choice set once per *node* over a pool of every
 * eligible *commit*, so anything walked per commit inside that loop happens
 * `V · C` times: on hono that is 425 × 475.
 *
 * So every question the per-subject loop asks is answered here first, by one
 * pass over the commits and one over the co-change matrix:
 *
 *   touching[ref]       which commits touched this file
 *   byMessageToken      which commits' messages use this word
 *   partners[ref]       which files co-change with this one
 *
 * `analyse()` from `companion/distractors.ts` supplies the *node* side — path
 * segments, name tokens, the churn ordering — and is imported rather than
 * rebuilt, exactly as Placement imports it. A documented landmine in one file
 * does not protect the next one, so it is written down again here.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare } from '../../atlas/index.js';
import type { EligibleCommit } from '../commits.js';

/** An index into `TraceCorpus.commits`. Short-lived; never leaves this verb. */
export type CommitIndex = number;

export interface TraceCorpus {
  /** The eligible commits, in the atlas's own order (newest first). */
  readonly commits: readonly EligibleCommit[];
  /** Per node ref: the commits that touched it, as ascending indices. */
  readonly touching: readonly (readonly CommitIndex[])[];
  /** Per message word: the commits whose subject line uses it. */
  readonly byMessageToken: ReadonlyMap<string, readonly CommitIndex[]>;
  /** Per node ref: the files it has co-changed with, ascending. */
  readonly partners: readonly (readonly NodeRef[])[];
  /** Every commit index, oldest first then sha — the date ordering, once. */
  readonly byDate: readonly CommitIndex[];
}

/**
 * Split a commit subject the way `gate.ts` does — at punctuation and at
 * camel-case humps, so `parseConfig` in a message matches `parse-config.ts`.
 *
 * Duplicated in shape rather than imported because `gate.ts`'s version builds a
 * `GateSubject`; this one wants the bare list. The *rule* is what matters and it
 * is one line, but a divergence would make the `mentions` gate score a different
 * guess from the one the `mentions` distractor strategy assembles — so
 * `tests/unit/archaeology.test.ts` pins them equal rather than trusting the
 * comment.
 */
export function messageWords(message: string): string[] {
  return message
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function analyseCommits(graph: Graph, commits: readonly EligibleCommit[]): TraceCorpus {
  const nodeCount = graph.atlas.nodes.length;
  const touching: CommitIndex[][] = Array.from({ length: nodeCount }, () => []);
  const byMessageToken = new Map<string, CommitIndex[]>();

  for (const [index, commit] of commits.entries()) {
    for (const ref of commit.files) touching[ref]?.push(index);
    for (const word of new Set(messageWords(commit.subject))) {
      const bucket = byMessageToken.get(word);
      if (bucket === undefined) byMessageToken.set(word, [index]);
      else bucket.push(index);
    }
  }

  const partners: NodeRef[][] = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of graph.atlas.history.coChange) {
    partners[a]?.push(b);
    partners[b]?.push(a);
  }
  for (const row of partners) row.sort((x, y) => x - y);

  const byDate = commits
    .map((_, index) => index)
    .sort((a, b) => {
      const x = commits[a];
      const y = commits[b];
      if (x === undefined || y === undefined) return a - b;
      return byteCompare(x.date, y.date) || byteCompare(x.sha, y.sha);
    });

  return { commits, touching, byMessageToken, partners, byDate };
}
