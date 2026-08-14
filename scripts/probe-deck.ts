/**
 * The question `probe-surprise.ts` cannot answer: **does route D change the deck
 * a player is served?**
 *
 * `atlas.challenges` is already `retain`'s output, so re-running `retain` over
 * it returns the same list by construction. The only honest instrument is the
 * generator, run twice with `blastRadius/generate.ts`'s `naive` baseline
 * patched — which is what the wrapper around this script does.
 *
 * Prints one line per Blast Radius board: the challenge id and its difficulty.
 * Run it before and after the patch and diff the two files; the diff *is* the
 * measurement. Kept deliberately dumb so the comparison is a `diff` rather than
 * a second piece of logic that could be wrong in the same direction as the
 * first.
 *
 *   npx tsx scripts/probe-deck.ts /tmp/ark-corpus <repo>... > before.txt
 *
 *   # patch src/verbs/blastRadius/generate.ts's `naive` to include out-edges
 *   npx tsx scripts/probe-deck.ts /tmp/ark-corpus <repo>... > after.txt
 *   diff before.txt after.txt
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  for (const challenge of atlas.challenges) {
    if (challenge.verb !== 'blastRadius') continue;
    console.log(`${repo} ${challenge.id} ${challenge.difficulty.toFixed(2)} ${challenge.subject}`);
  }
}
