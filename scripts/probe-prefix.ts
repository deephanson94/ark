/**
 * **Can a board be answered by sorting the paths?**
 *
 * NORTH-STAR pillar 3 is violated *"when a challenge can be answered by Ctrl+F
 * rather than by reasoning about structure"*. A round-7 cold tester scored a
 * grade S on their first board without reasoning about a single import:
 *
 *   "exactly 6 of 20 candidates counted, and exactly 6 candidates began
 *    `scripts/` while all fourteen others began `src/`. I ticked the block and
 *    got an exact match. It made the S feel worthless the moment I noticed."
 *
 * The guess needs no graph, no history and no knowledge of the repository — only
 * the choice set on screen. That is the cheapest possible Ctrl+F, so it is the
 * one worth measuring.
 *
 * Scored with `scoreSet`, the metric §8.2 grades in, against band A (0.78).
 * Every prefix of every candidate's directory is tried and the best reported —
 * a player scanning a list of twenty paths sees all of them at once.
 *
 *   npx tsx scripts/probe-prefix.ts [repo ...]
 */
import { join } from 'node:path';

import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

const BAND_A = 0.78;
const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const pathById = new Map(atlas.nodes.map((n) => [n.id, n.path]));

  for (const verb of ['blastRadius', 'companion', 'placement'] as const) {
    const boards = atlas.challenges.filter((c) => c.verb === verb);
    if (boards.length === 0) continue;
    let sum = 0;
    let beat = 0;
    let exact = 0;
    const examples: string[] = [];
    for (const board of boards) {
      const truth = board.truth.filter(isNodeId);
      if (truth.length === 0) continue;
      // Every prefix a scanning eye could group by, including the empty one
      // ("tick everything") — which §8.2's F1 already defeats, and which belongs
      // in the comparison for exactly that reason.
      const prefixes = new Set<string>(['']);
      for (const id of board.candidates) {
        const path = pathById.get(id);
        if (path === undefined) continue;
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) prefixes.add(`${parts.slice(0, i).join('/')}/`);
      }
      let best = 0;
      let bestAt = '';
      for (const prefix of prefixes) {
        const picked = board.candidates.filter((id) => (pathById.get(id) ?? ' ').startsWith(prefix));
        if (picked.length === 0) continue;
        const f1 = scoreSet(picked as never, truth as never).score;
        if (f1 > best) {
          best = f1;
          bestAt = prefix;
        }
      }
      sum += best;
      if (best >= BAND_A) beat += 1;
      if (best >= 0.999) {
        exact += 1;
        if (examples.length < 3) {
          examples.push(`${board.id} - "${bestAt || '(everything)'}" is exactly the key`);
        }
      }
    }
    const share = ((beat / boards.length) * 100).toFixed(0);
    console.log(
      `${repo} ${verb.padEnd(12)}: ${boards.length} boards - best-prefix mean F1 ${(sum / boards.length).toFixed(3)}` +
        ` - beats band A on ${beat} (${share}%) - EXACT on ${exact}`,
    );
    for (const line of examples) console.log(`      ${line}`);
  }
}
