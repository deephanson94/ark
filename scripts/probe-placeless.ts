/**
 * How much of a deck a player who only clicks the map can never meet.
 *
 * Half the id union has no place (ADR-0018): a Placement board's subject is a
 * **commit**, so it has no square on the flat map and no marker to click. The
 * guide reaches those boards — `createGuide` labels the control *"Open the next
 * question"* and opens them directly — but the guide is one of two paths in, and
 * a player exploring by clicking meets only the other one.
 *
 * A cold playtester never found Placement at all. This is the size of what they
 * were missing, per repo, so the gap is a number rather than an impression.
 *
 *   npx tsx scripts/probe-placeless.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

console.log('| repo | deck | placeless boards | share | verbs affected |');
console.log('|---|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const deck = atlas.challenges;
  if (deck.length === 0) {
    console.log(`| ${repo} | 0 | — | — | — |`);
    continue;
  }
  const placeless = deck.filter((challenge) => !isNodeId(challenge.subject));
  const verbs = [...new Set(placeless.map((challenge) => challenge.verb))].sort();
  console.log(
    `| ${repo} | ${deck.length} | ${placeless.length} | ` +
      `**${((100 * placeless.length) / deck.length).toFixed(1)}%** | ${verbs.join(', ') || '—'} |`,
  );
}
