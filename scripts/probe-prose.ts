/**
 * How much of an answer key is documentation.
 *
 * A cold playtester reported that **25.3% of all answer-key members** on this
 * repo are Markdown, and that the guide repeatedly offered `NORTH-STAR.md` and
 * decision records as boards. Their objection is pillar 3's — *teach coupling,
 * not trivia*: on Companion, a key made of `CHANGELOG.md` says only that the
 * author updates the changelog every session, which is true, derived, gradeable
 * and worth nothing.
 *
 * This is the size of it, per verb, so the question of what to do about it is
 * argued from a number. Reports the share of key members that are prose, the
 * share of *subjects* that are, and how many boards are prose end to end.
 *
 * "Prose" is the walk's own notion of a non-source file rather than a new list:
 * a node whose language the scanner does not read as program source.
 *
 *   npx tsx scripts/probe-prose.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

/** Extensions that are prose or data rather than program source. */
const PROSE = /\.(md|markdown|txt|rst|adoc|json|ya?ml|toml|lock)$/i;

console.log('| repo | verb | boards | key members prose | subjects prose | boards prose end to end |');
console.log('|---|---|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const pathById = new Map(atlas.nodes.map((node) => [node.id, node.path] as const));
  const isProse = (id: string): boolean => {
    const path = pathById.get(id);
    return path !== undefined && PROSE.test(path);
  };

  const verbs = [...new Set(atlas.challenges.map((board) => board.verb))].sort();
  for (const verb of verbs) {
    const boards = atlas.challenges.filter((board) => board.verb === verb);
    let members = 0;
    let proseMembers = 0;
    let proseSubjects = 0;
    let allProse = 0;
    for (const board of boards) {
      const nodeMembers = board.truth.filter(isNodeId);
      members += nodeMembers.length;
      const hit = nodeMembers.filter(isProse).length;
      proseMembers += hit;
      if (isNodeId(board.subject) && isProse(board.subject)) proseSubjects += 1;
      if (nodeMembers.length > 0 && hit === nodeMembers.length) allProse += 1;
    }
    const pct = (n: number, of: number): string =>
      of === 0 ? '—' : `${((100 * n) / of).toFixed(1)}%`;
    console.log(
      `| ${repo} | ${verb} | ${boards.length} | ${proseMembers}/${members} ${pct(proseMembers, members)} | ` +
        `${proseSubjects}/${boards.length} ${pct(proseSubjects, boards.length)} | ${allProse} |`,
    );
  }
}
