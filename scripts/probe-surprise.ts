/**
 * What route D costs Blast Radius: **`surprise` is calibrated against the guess
 * hover hands you, and route D changes that guess.**
 *
 * NORTH-STAR §8.4 makes difficulty half `surprise = |truth Δ naiveGuess| / |truth|`,
 * and `blastRadius/generate.ts` fills `naive` with *"the direct importers —
 * which is exactly what the map gives away on hover"*. Make hover undirected and
 * that sentence stops being true: the guess the map hands over becomes the
 * direct **neighbours**, either way, which is a worse guess. So every Blast
 * Radius board gets harder while its recorded difficulty stays put.
 *
 * Three things worth knowing before anyone agrees to that:
 *
 *  1. **how far difficulty moves** — the surprise term is clamped at 1, so a
 *     deck already saturated there would not move at all, and that would be the
 *     cheap answer;
 *  2. **whether the ordering changes**, because `sample.retain` spends the deck
 *     along the difficulty *order* — a uniform shift is free and a reordering is
 *     not;
 *  3. **whether the retained deck changes**, which is the only one of the three
 *     a player can see — and which **this probe cannot answer**. `atlas.challenges`
 *     is already `retain`'s output, so re-running `retain` over it returns the
 *     same list by construction and prints a cheerful `0 of 40`. That was the
 *     first version of this measurement, and it is the vacuous-pass landmine
 *     with a tautology in it. The real counterfactual needs the generator run
 *     twice with the baseline patched; `scripts/probe-deck.ts` does that.
 *
 * The ranks are the answerable proxy and they are worth reading as one: four of
 * these five decks sit **exactly at their cap**, so `retain` is binding on them
 * and a reordering it consumes is very unlikely to be free.
 *
 * The other terms are untouched, so `Δdifficulty = 0.5 · Δsurprise` exactly —
 * no need to recompute `breadth` or `reach` and risk disagreeing with the
 * shipped value over a rounding step.
 *
 *   npx tsx scripts/probe-surprise.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph } from '../src/atlas/graph.js';
import type { Challenge } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { WEIGHTS, surpriseOf } from '../src/verbs/difficulty.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

console.log(
  '| repo | blast boards | deck cap | surprise already 1.000 | mean Δsurprise | mean Δdifficulty | boards whose difficulty moves | **rank changes** |',
);
console.log('|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);
  const refById = new Map(atlas.nodes.map((node, ref) => [node.id, ref]));

  const boards = atlas.challenges.filter((challenge) => challenge.verb === 'blastRadius');
  if (boards.length === 0) {
    console.log(`| ${repo} | 0 | | | | | | |`);
    continue;
  }

  let saturated = 0;
  let moved = 0;
  const deltas: number[] = [];
  const rescored: { challenge: Challenge }[] = [];

  for (const board of boards) {
    const subject = refById.get(board.subject);
    if (subject === undefined) continue;
    const candidates = new Set(board.candidates);

    const directed: string[] = [];
    for (const edge of graph.in[subject] ?? []) {
      const id = atlas.nodes[edge.from]?.id;
      if (id !== undefined && candidates.has(id)) directed.push(id);
    }
    // Route D's baseline: everything with a line to the subject. The out-side is
    // what the current highlight withholds and an undirected one would not.
    const undirected = [...directed];
    for (const edge of graph.out[subject] ?? []) {
      const id = atlas.nodes[edge.to]?.id;
      if (id !== undefined && candidates.has(id)) undirected.push(id);
    }

    const before = surpriseOf(board.truth, directed);
    const after = surpriseOf(board.truth, undirected);
    if (before >= 1) saturated += 1;
    if (after !== before) moved += 1;
    deltas.push(after - before);

    const difficulty = Math.min(1, Math.max(0, board.difficulty + WEIGHTS.surprise * (after - before)));
    rescored.push({ challenge: { ...board, difficulty } });
  }

  const original = boards.map((challenge) => ({ challenge }));

  // Rank change, over the same tie-break the deck uses.
  const order = (list: readonly { challenge: Challenge }[]): string[] =>
    [...list]
      .sort(
        (a, b) =>
          a.challenge.difficulty - b.challenge.difficulty ||
          (a.challenge.id < b.challenge.id ? -1 : a.challenge.id > b.challenge.id ? 1 : 0),
      )
      .map((entry) => entry.challenge.id);
  const wasOrder = order(original);
  const nowOrder = order(rescored);
  let rankChanges = 0;
  for (const [index, id] of wasOrder.entries()) if (nowOrder[index] !== id) rankChanges += 1;

  const cap = Math.max(40, Math.ceil(atlas.nodes.length / 8));
  const mean = deltas.length === 0 ? 0 : deltas.reduce((a, b) => a + b, 0) / deltas.length;
  console.log(
    `| ${repo} | ${boards.length} | ${cap}${boards.length >= cap ? ' **(binding)**' : ''} | ${saturated} | ` +
      `${mean >= 0 ? '+' : ''}${mean.toFixed(3)} | ` +
      `${mean >= 0 ? '+' : ''}${(mean * WEIGHTS.surprise).toFixed(3)} | ${moved} | ` +
      `**${rankChanges}** of ${boards.length} |`,
  );
}
