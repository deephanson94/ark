/**
 * Whether Archaeology's "where in this file's life" clause says anything.
 *
 * `whyYes` places each correct pick in the arc of the file's history: the oldest
 * one this board asked about, or *"N days after the change before it"*. When two
 * commits share a date the gap is 0 and the clause becomes *"landing the same
 * day as the change before it"* — which is fine once and says nothing when it is
 * every row, because a busy repo lands several commits a day. That is ADR-0018's
 * own `whyYes` defect, which the comment in `archaeology/reveal.ts` says this
 * clause exists to avoid: *"six words that told the player nothing they could
 * check"*.
 *
 * Reports, over every shipped Archaeology board:
 *
 *  - **uniform** — every non-oldest member has gap 0, so every row but the first
 *    carries the identical sentence.
 *  - **rows** — the share of all correct-pick rows whose gap is 0.
 *
 *   npx tsx scripts/probe-sameday.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph } from '../src/atlas/graph.js';
import { byteCompare, commitIdFor } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  buildGraph(atlas);
  const commitById = new Map(
    atlas.history.commits.map((commit) => [commitIdFor(commit.sha), commit] as const),
  );

  let boards = 0;
  let uniform = 0;
  let rows = 0;
  let sameDay = 0;

  for (const challenge of atlas.challenges) {
    if (challenge.verb !== 'archaeology') continue;
    // The same ordering the reveal uses: date, then sha.
    const key = [...challenge.truth].sort((x, y) => {
      const a = commitById.get(x);
      const b = commitById.get(y);
      if (a === undefined || b === undefined) return byteCompare(x, y);
      return byteCompare(a.date, b.date) || byteCompare(a.sha, b.sha);
    });
    if (key.length < 2) continue;
    boards += 1;
    let zeros = 0;
    for (let i = 1; i < key.length; i += 1) {
      const previous = commitById.get(key[i - 1] ?? '');
      const current = commitById.get(key[i] ?? '');
      if (previous === undefined || current === undefined) continue;
      rows += 1;
      if (previous.date === current.date) {
        zeros += 1;
        sameDay += 1;
      }
    }
    if (zeros === key.length - 1) uniform += 1;
  }

  console.log(
    `${repo.padEnd(12)} boards ${String(boards).padStart(4)} · ` +
      `every row same-day ${uniform} (${((100 * uniform) / Math.max(1, boards)).toFixed(1)}%) · ` +
      `same-day rows ${sameDay}/${rows} (${((100 * sameDay) / Math.max(1, rows)).toFixed(1)}%)`,
  );
}
