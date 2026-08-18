/**
 * What drawing the **proved chain** on the map would give away, and the gate
 * that closes it.
 *
 * ADR-0049 decision 3 permits exactly one of round 5's four "make the map the
 * scoreboard" requests — *"keep each proved chain drawn"* — on the argument that
 * passing a board already unlocks the cone the chain lies inside, so the chain
 * *"adds no node and no edge the map is not already drawing"*. It then requires
 * whoever builds it to *"re-measure against band A first, and state what the
 * counterfactual holds fixed"*. This is that measurement, and **the permission
 * was granted on an incomplete argument**: the sentence is true about nodes and
 * edges and false about **direction**, which is the thing decisions 1 and 2 of
 * the same document exist to refuse. A route drawn from a truth member to the
 * subject, with the subject marked as the subject, states which way every edge
 * on it points however undirected the ink is — and decision 2 says in as many
 * words that *"a hover-scoped arrow is the same leak paid for in instalments"*.
 * A chain is a run of arrows.
 *
 * A chain into subject S that runs `M → X → Q → S` also states that M and X
 * depend on **Q**, so the leak is not confined to boards already passed, and one
 * walk measures both halves.
 *
 * **What the counterfactual holds fixed**: the atlas, the deck, every answer key
 * and every candidate set. The only thing varied is *which edges have a known
 * direction*. Nothing else moves, so a difference between rows is the chain's
 * own contribution and not the deck's. Note what the invariant does to the
 * metric: everything the walk reaches is in `truth` by ADR-0008, so precision is
 * **1.000 in every row** and F1 here is a pure recall measurement — "beat A"
 * means the map handed the player 64% of an answer key with no wrong picks.
 *
 * Rows:
 *   - `none` / `all` — the self-gate. The walk with no edge directed and with
 *     every edge directed; these must read 0.000 and 1.000 (ADR-0049's own
 *     table) or the instrument is measuring nothing, which is the failure mode
 *     that reads as good news.
 *   - `all`  — every other Blast Radius board passed with a perfect score. An
 *     upper bound no real playthrough reaches, and the one to refuse on.
 *   - `half` — the first half of the deck in `id` order: a point inside a real
 *     session rather than a bound.
 *   - `gated` — the same accumulation under the proposed rule: **a chain edge
 *     `u → v` is drawn only when `v` carries no unanswered Blast Radius board.**
 *     Every walk out of an open board `Q` must take an edge whose head is `Q`,
 *     so the rule empties that walk by construction — and the row is here to
 *     check the construction rather than to trust it. `kept` is what survives
 *     the gate, because ADR-0016's vanishing wires were a layer that passed
 *     every suite while withdrawing 79% of what it promised.
 *
 *   npx tsx scripts/probe-chain.ts [repo …]
 */
import { join } from 'node:path';
import { buildGraph } from '../src/atlas/graph.js';
import { dependentRoutes, isNodeId, routeTo } from '../src/atlas/index.js';
import type { Challenge, Graph } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

const BAND_A = 0.78;

/** Every directed edge the chains of one board would put on the map, as `from>to` refs. */
function chainEdges(graph: Graph, board: Challenge): string[] {
  const ref = graph.refById.get(board.subject);
  if (ref === undefined) return [];
  const routes = dependentRoutes(graph, ref);
  const edges: string[] = [];
  for (const id of board.truth) {
    if (!isNodeId(id)) continue;
    const from = graph.refById.get(id);
    if (from === undefined) continue;
    const hops = routeTo(routes, from);
    for (let i = 0; i + 1 < hops.length; i++) edges.push(`${hops[i]}>${hops[i + 1]}`);
  }
  return edges;
}

const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const graph = buildGraph(atlas);
  const blast = atlas.challenges
    .filter((c) => c.verb === 'blastRadius')
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (blast.length === 0) {
    console.log(`${repo}: no Blast Radius deck`);
    continue;
  }

  const perBoard = new Map<string, string[]>();
  for (const board of blast) perBoard.set(board.id, chainEdges(graph, board));
  const totalEdges = graph.out.reduce((n, list) => n + list.length, 0);
  /** ref → the board about that node, when it has one. */
  const boardAt = new Map<number, Challenge>();
  for (const board of blast) {
    const ref = graph.refById.get(board.subject);
    if (ref !== undefined) boardAt.set(ref, board);
  }

  type Mode = 'none' | 'full' | 'accum' | 'gated';
  const rows: [string, Mode, (b: Challenge) => Challenge[]][] = [
    ['none ', 'none', () => []],
    ['full ', 'full', () => []],
    ['all  ', 'accum', (b) => blast.filter((o) => o.id !== b.id)],
    ['half ', 'accum', (b) => blast.slice(0, Math.floor(blast.length / 2)).filter((o) => o.id !== b.id)],
    ['gated', 'gated', (b) => blast.filter((o) => o.id !== b.id)],
    ['g/half', 'gated', (b) => blast.slice(0, Math.floor(blast.length / 2)).filter((o) => o.id !== b.id)],
  ];

  for (const [label, mode, passedOf] of rows) {
    let sum = 0, beat = 0, exact = 0, scored = 0, coverage = 0, emitted = 0, kept = 0, openSum = 0;
    for (const board of blast) {
      const passed = passedOf(board);
      const open = new Set(blast.filter((o) => !passed.some((p) => p.id === o.id)).map((o) => o.id));
      openSum += open.size;
      const known = new Set<string>();
      for (const other of passed) {
        for (const edge of perBoard.get(other.id) ?? []) {
          emitted += 1;
          if (mode === 'gated') {
            const head = Number(edge.slice(edge.indexOf('>') + 1));
            const at = boardAt.get(head);
            if (at !== undefined && open.has(at.id)) continue;
          }
          kept += 1;
          known.add(edge);
        }
      }
      coverage += known.size;

      const subjectRef = graph.refById.get(board.subject);
      if (subjectRef === undefined) continue;
      const seen = new Set<number>();
      const stack = [subjectRef];
      while (stack.length > 0) {
        const at = stack.pop() as number;
        if (mode === 'none') break;
        for (const edge of graph.in[at] ?? []) {
          if (seen.has(edge.from)) continue;
          if (mode !== 'full' && !known.has(`${edge.from}>${at}`)) continue;
          seen.add(edge.from);
          stack.push(edge.from);
        }
      }
      const picked = board.candidates.filter(
        (id) => isNodeId(id) && seen.has(graph.refById.get(id) ?? -1),
      );
      const f1 = scoreSet(picked as never, board.truth.filter(isNodeId) as never).score;
      sum += f1;
      scored += 1;
      if (f1 >= BAND_A) beat += 1;
      if (f1 >= 0.999) exact += 1;
    }
    const share =
      mode === 'full'
        ? '100.0'
        : ((coverage / Math.max(1, scored) / Math.max(1, totalEdges)) * 100).toFixed(1);
    // **Survival is only meaningful beside the number of boards still open.**
    // Measured with one board open it reads ~99% on every repo, which is the
    // bound rather than the session — the same shape as measuring a gate by
    // what it emits.
    const survival =
      emitted === 0
        ? ''
        : ` · kept ${((kept / emitted) * 100).toFixed(1)}% of chain ink with ` +
          `${(openSum / Math.max(1, scored)).toFixed(0)} boards open`;
    console.log(
      `${repo} [${label}]: ${scored} boards · mean F1 ${(sum / Math.max(1, scored)).toFixed(3)}` +
        ` · beat A ${beat} · exact ${exact} · directed edges known ${share}%${survival}`,
    );
  }
}
