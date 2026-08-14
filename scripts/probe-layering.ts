/**
 * Bounding tier 2's **third** question before building anything.
 *
 * ADR-0043 §5's table has three tier-2 questions. Two are the depth-1 graph and
 * are unaskable while ADR-0008 decision 1 stands. The third — *"where's the
 * layering violation?"* — is **not** a depth-1 relation, so hover and the
 * inspector do not touch it, and §7 of that document explicitly *"does not clear
 * it and does not condemn it; it was not measured"*.
 *
 * NORTH-STAR §6.2's Layering verb is *"arrange these modules into layers"*,
 * which ADR-0043 §7 objects to on two grounds: it is not a set-selection shape,
 * and a DAG has many valid layerings so the ground truth is not unique. Both
 * objections are about **assigning layer numbers**. Two reformulations dodge
 * them, because reachability itself is unique:
 *
 *  - **cycle** — *"which of these are in a dependency cycle with `X`?"* Truth is
 *    `X`'s strongly connected component. A cycle is the canonical layering
 *    violation, and mutual reachability is unique.
 *  - **upstream** — *"which of these does `X` depend on, directly or through a
 *    chain?"* Truth is `X`'s transitive **dependencies** — Blast Radius's
 *    relation read along its other axis, which is the confusion §8.3 strategy 1
 *    calls *"a real tier-2 mistake"*.
 *
 * ## What this measures, and why `cycle` is measured first
 *
 * ADR-0034 §4 already proved that **every SCC-mate of a subject is a transitive
 * dependent**, so a cycle key is a *subset* of that subject's Blast Radius cone.
 *
 * **The first version of this comment then said the Blast Radius reveal
 * therefore states the cycle key entirely, and the measurement below refutes
 * it.** The cone is not the key: ADR-0008 samples truth to a cap of 6, so
 * containment is the *ceiling* and the shipped reveals state **3% on hugo, 7%
 * on kysely, 12% on graphql-js, 33% on hono**. The refusal in ADR-0045 §2 does
 * not rest on that direction; it rests on the direction ADR-0034 measured, where
 * naming the component decides 111 of hugo's 114 fired boards.
 *
 * This re-derives that containment with **its own** SCC pass rather than quoting
 * it, and counts the supply. Ten minutes of arithmetic that can refuse a verb is
 * worth more than three hours of implementing one.
 *
 *   npx tsx scripts/probe-layering.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph, dependents } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

const TRUTH_CAP = 6;
const CHOICE = 20;

/**
 * Tarjan, iterative.
 *
 * Iterative because django is 3,035 nodes and typeorm 3,704, and a recursive
 * walk over a graph with a 131-node tangle is a stack this process does not
 * have. Deterministic: nodes are visited in ref order and successors in the
 * edge order the atlas already sorted.
 */
function componentsOf(graph: Graph, count: number): number[] {
  const index = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const component = new Array<number>(count).fill(-1);
  const stack: number[] = [];
  let next = 0;
  let components = 0;

  for (let root = 0; root < count; root += 1) {
    if (index[root] !== -1) continue;
    const work: { node: number; at: number }[] = [{ node: root, at: 0 }];
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = true;

    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: number; at: number };
      const edges = graph.out[frame.node] ?? [];
      if (frame.at < edges.length) {
        const to = (edges[frame.at] as { to: number }).to;
        frame.at += 1;
        if (index[to] === -1) {
          index[to] = low[to] = next++;
          stack.push(to);
          onStack[to] = true;
          work.push({ node: to, at: 0 });
        } else if (onStack[to] === true) {
          low[frame.node] = Math.min(low[frame.node] as number, index[to] as number);
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) {
        low[parent.node] = Math.min(low[parent.node] as number, low[frame.node] as number);
      }
      if (low[frame.node] === index[frame.node]) {
        for (;;) {
          const member = stack.pop();
          if (member === undefined) break;
          onStack[member] = false;
          component[member] = components;
          if (member === frame.node) break;
        }
        components += 1;
      }
    }
  }
  return component;
}

function f1(picked: ReadonlySet<string>, truth: readonly string[]): number {
  const key = new Set(truth);
  if (picked.size === 0 || key.size === 0) return 0;
  let hit = 0;
  for (const id of picked) if (key.has(id)) hit += 1;
  if (hit === 0) return 0;
  const precision = hit / picked.size;
  const recall = hit / key.size;
  return (2 * precision * recall) / (precision + recall);
}

console.log(
  '| repo | nodes | SCCs > 1 | sizes | in one | `cycle` subjects | SCC ⊆ cone | **stated by a shipped reveal** | **open before any blast pass** | ADR-0034 leak reproduced |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);
  const component = componentsOf(graph, atlas.nodes.length);
  const idOf = (ref: number): string => atlas.nodes[ref]?.id ?? '';

  const members = new Map<number, number[]>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const id = component[ref] as number;
    const bucket = members.get(id);
    if (bucket === undefined) members.set(id, [ref]);
    else bucket.push(ref);
  }
  const tangles = [...members.values()].filter((group) => group.length > 1).sort((a, b) => b.length - a.length);
  const inOne = tangles.reduce((sum, group) => sum + group.length, 0);

  const blast = new Map(
    atlas.challenges.filter((c) => c.verb === 'blastRadius').map((c) => [c.subject, c]),
  );

  let carriable = 0;
  let checked = 0;
  let contained = 0;
  // Of a subject's cycle key, how much does the Blast Radius reveal for that
  // same subject actually **state**? The cone is not the key: ADR-0008 samples
  // truth to a cap of 6, so set containment is the ceiling and this is the
  // shipped figure.
  let statedNumer = 0;
  let statedDenom = 0;
  // The gate that could make it safe, priced: a cycle board is servable only
  // when no member of its SCC still carries an unanswered Blast Radius board
  // (ADR-0030's twin shape, ADR-0020's withhold-by-class rule). How many are
  // open at the start of a session, before any blast board is answered?
  let openAtStart = 0;

  for (const group of tangles) {
    const groupIds = group.map(idOf);
    const anyBlast = groupIds.some((id) => blast.has(id));
    for (const subject of group) {
      const key = group.filter((mate) => mate !== subject).slice(0, TRUTH_CAP).map(idOf);
      if (key.length === 0) continue;
      if (atlas.nodes.length - group.length < Math.min(key.length * 3, CHOICE - key.length)) continue;
      carriable += 1;

      checked += 1;
      const cone = dependents(graph, subject, Number.POSITIVE_INFINITY);
      if (group.every((mate) => mate === subject || cone.has(mate))) contained += 1;

      const board = blast.get(idOf(subject));
      if (board !== undefined) {
        const stated = new Set(board.truth);
        statedDenom += key.length;
        for (const id of key) if (stated.has(id)) statedNumer += 1;
      }
      if (!anyBlast) openAtStart += 1;
    }
  }

  // ADR-0034 §4's leak, in the other direction, with this file's own SCC pass:
  // *"tick the candidates in the same component as the subject"*, scored on the
  // shipped Blast Radius deck. A cycle verb teaches exactly that set.
  let fired = 0;
  let beats = 0;
  for (const board of blast.values()) {
    const subject = atlas.nodes.findIndex((node) => node.id === board.subject);
    if (subject < 0) continue;
    const mates = new Set(
      (members.get(component[subject] as number) ?? [])
        .filter((mate) => mate !== subject)
        .map(idOf)
        .filter((id) => board.candidates.includes(id)),
    );
    if (mates.size === 0) continue;
    fired += 1;
    if (f1(mates, board.truth) >= 0.78) beats += 1;
  }

  const sizes = tangles.slice(0, 6).map((group) => group.length).join(', ');
  const statedShare = statedDenom === 0 ? 0 : statedNumer / statedDenom;
  console.log(
    `| ${repo} | ${atlas.nodes.length} | ${tangles.length} | ${sizes === '' ? '—' : `[${sizes}]`} | ${inOne} | ` +
      `**${carriable}** | ${contained} of ${checked} | ${statedDenom === 0 ? '—' : `${(statedShare * 100).toFixed(0)}% of ${statedDenom}`} | ` +
      `**${openAtStart}** of ${carriable} | ${beats} of ${fired} fired, ${blast.size} boards |`,
  );
}
