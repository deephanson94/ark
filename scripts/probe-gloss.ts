/**
 * Which word Archaeology quotes as evidence, and whether it is evidence.
 *
 * `reveal.ts`'s `quoteShared` takes `shared[0]` — the **first** token the commit
 * message and the filename have in common, in message order. A cold playtester
 * was shown *"its message talks about “a”, and so does this file's name"*: the
 * path `…/a.ts` tokenises to `['a']` and English messages contain the article,
 * so the sentence is literally true and says nothing. It is the class-label
 * landmine in a witness line — the strategy is right, the gloss explaining it is
 * a separate claim nobody checked.
 *
 * This counts, over every commit/subject pair a shipped Archaeology board can
 * put on screen, how often the quoted token would be too short to be evidence,
 * and what picking the **longest** shared token instead would do.
 *
 *   npx tsx scripts/probe-gloss.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph, nodeAt } from '../src/atlas/graph.js';
import { commitIdFor, isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { messageWords } from '../src/verbs/archaeology/corpus.js';
import { nameTokens } from '../src/verbs/paths.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const MIN = 3;

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const graph = buildGraph(atlas);
  const commitById = new Map(
    atlas.history.commits.map((commit) => [commitIdFor(commit.sha), commit] as const),
  );

  let glossed = 0;
  let thin = 0;
  let rescued = 0;
  let silenced = 0;
  const worst = new Map<string, number>();

  for (const challenge of atlas.challenges) {
    if (challenge.verb !== 'archaeology') continue;
    const node = isNodeId(challenge.subject) ? nodeAt(graph, graph.refById.get(challenge.subject) ?? -1) : null;
    if (node === null || node === undefined) continue;
    const words = new Set(nameTokens(node.path));
    for (const id of challenge.candidates) {
      const commit = commitById.get(id);
      if (commit === undefined) continue;
      const shared = messageWords(commit.subject).filter((word) => words.has(word));
      if (shared.length === 0) continue;
      glossed += 1;
      const first = shared[0] ?? '';
      const longest = [...shared].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0] ?? '';
      if (first.length < MIN) {
        thin += 1;
        worst.set(first, (worst.get(first) ?? 0) + 1);
        if (longest.length >= MIN) rescued += 1;
        else silenced += 1;
      }
    }
  }

  const top = [...worst].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(
    `${repo.padEnd(12)} glossed rows ${String(glossed).padStart(5)} · ` +
      `quoting a token under ${MIN} chars ${thin} (${((100 * thin) / Math.max(1, glossed)).toFixed(1)}%) · ` +
      `longest-token rescues ${rescued}, falls silent ${silenced} · ` +
      `commonest ${top.map(([word, n]) => `“${word}” ${n}`).join(', ') || '—'}`,
  );
}
