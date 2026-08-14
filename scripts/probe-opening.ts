/**
 * What a cold player is actually served first, and whether it is a real file.
 *
 * The measured complaint is the opening: three cold playtests at 4/10, 5/10 and
 * 4/10, all naming the first fifteen boards (`README.md` Known gaps, ADR-0040).
 * ADR-0045 §5.6 then established *why no ordering rule can fix it inside Blast
 * Radius*: §8.4 makes a real subject a hard question, so that verb's easy end is
 * **by construction** its peripheral end — fixtures, manifests and test helpers.
 *
 * This drives the shipped selector exactly as the player does, on a model that
 * passes everything, and reports what the first fifteen boards are *about*.
 *
 * Two counts, and the second is the one that matters:
 *
 *  - **fixture-shaped** — the subject has zero transitive dependents that
 *    themselves have dependents. A graph property, no path list, no language
 *    knowledge, and it is what ADR-0040 measured its ρ = 0.96 against.
 *  - **test-pathed** — the subject's path looks like a test, fixture or
 *    manifest. **Only a cross-check**: a path list is the whitelist landmine
 *    (ADR-0025's `UNREAD`) and must never be the rule. It exists here so that a
 *    graph property claiming to capture "not a real module" can be checked
 *    against the thing a human would say.
 *
 *   npx tsx scripts/probe-opening.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph, dependents } from '../src/atlas/graph.js';
import type { Atlas, Challenge } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { answerKey } from '../src/player/progress.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../src/player/selector.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

const FIRST = 15;
/** Cross-check only. Never a rule — see the header. */
const TEST_PATH = /(^|\/)(tests?|__tests__|__testutils__|fixtures?|benchmarks?)(\/|$)|\.(test|spec)\.|(^|\/)(package|tsconfig|jsr)\.json$|\.json$/i;

/**
 * Subjects with no transitive dependent that itself has dependents.
 *
 * Nothing is built on top of the things that use it — which is what a fixture,
 * a manifest or a test helper looks like from the graph, and what makes such a
 * subject easy under §8.4 without being worth asking about.
 */
function fixtureShapedSubjects(atlas: Atlas): Set<string> {
  const graph = buildGraph(atlas);
  const out = new Set<string>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const cone = dependents(graph, ref, Number.POSITIVE_INFINITY);
    let loadBearing = false;
    // **`dependents` returns a Map**, so iterating it yields `[ref, depth]`
    // pairs. The first version of this loop indexed `graph.in` with the pair,
    // got `undefined` every time, and reported *every node on every repo* as
    // fixture-shaped — a clean 15 of 15 that measured nothing. `tsc` said so and
    // the run happened anyway.
    for (const dependent of cone.keys()) {
      if ((graph.in[dependent] ?? []).length > 0) {
        loadBearing = true;
        break;
      }
    }
    if (!loadBearing) out.add(atlas.nodes[ref]?.id ?? '');
  }
  return out;
}

console.log('| repo | deck | **fixture-shaped in the first 15** | test-pathed | verbs met | first five subjects |');
console.log('|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  if (atlas.challenges.length === 0) {
    console.log(`| ${repo} | 0 | — | — | — | — |`);
    continue;
  }
  const shaped = fixtureShapedSubjects(atlas);
  const pathOf = new Map(atlas.nodes.map((node) => [node.id, node.path]));
  const regionOf = (subject: string): string | null =>
    atlas.nodes.find((node) => node.id === subject)?.region ?? null;

  // The player model: pass everything, first try. `noteAttempt` is still driven
  // so the rank's outermost term is exercised the way the shell drives it.
  let state = NO_HISTORY;
  const served: Challenge[] = [];
  for (let step = 0; step < FIRST; step += 1) {
    const next = suggestNext(atlas.challenges, regionOf, state);
    if (next === null) break;
    served.push(next);
    const key = answerKey(next.verb, next.subject);
    state = {
      answered: new Set([...state.answered, key]),
      attempts: noteAttempt(state.attempts, key),
      previous: next,
    };
  }

  const shapedCount = served.filter((board) => shaped.has(board.subject)).length;
  const testCount = served.filter((board) => TEST_PATH.test(pathOf.get(board.subject) ?? '')).length;
  const verbs = new Set(served.map((board) => board.verb));
  const firstFive = served
    .slice(0, 5)
    .map((board) => pathOf.get(board.subject) ?? board.subject.slice(0, 10))
    .join(', ');
  console.log(
    `| ${repo} | ${atlas.challenges.length} | **${shapedCount}** of ${served.length} | ${testCount} | ${verbs.size} | ${firstFive} |`,
  );
  if (process.env['ARK_SHOW'] === '1') {
    for (const board of served) {
      const flag = shaped.has(board.subject) ? 'SHAPED' : '      ';
      console.log(`|   ${flag} ${board.verb.padEnd(12)} ${pathOf.get(board.subject) ?? board.subject}`);
    }
  }
}
