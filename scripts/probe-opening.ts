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
 * Two counts, and **which of them is the cross-check reversed once this ran**:
 *
 *  - **fixture-shaped** — zero transitive dependents that themselves have
 *    dependents, the graph property ADR-0040 measured its ρ = 0.96 against. It
 *    was the proposed rule and it is **refuted**: it flags `src/indexer/build.ts`
 *    on this repo, whose consumers are all scripts, tests and the CLI, exactly as
 *    it flags `tests/fixtures/atlas.ts`. An orchestrator near the top of a
 *    program and a fixture are topologically the same shape. Kept as a
 *    diagnostic, never as a rule.
 *  - **test-pathed** — the subject's path looks like a test, fixture, benchmark
 *    or manifest. A whitelist, with ADR-0025's landmine attached, and it is the
 *    signal that survived — see ADR-0046 for why demotion-only is what makes a
 *    list acceptable here.
 *
 *   npx tsx scripts/probe-opening.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph, dependents } from '../src/atlas/graph.js';
import type { Atlas, Challenge, VerbId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { answerKey } from '../src/player/progress.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../src/player/selector.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

const FIRST = Number(process.env['ARK_FIRST'] ?? '15');
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

console.log('| repo | deck | **fixture-shaped** | test-pathed | 2nd verb at | longest run | verbs met | opening five verbs |');
console.log('|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  if (atlas.challenges.length === 0) {
    console.log(`| ${repo} | 0 | — | — | — | — | — | — |`);
    continue;
  }
  const shaped = fixtureShapedSubjects(atlas);
  const pathOf = new Map(atlas.nodes.map((node) => [node.id, node.path]));
  const regionOf = (subject: string): string | null =>
    atlas.nodes.find((node) => node.id === subject)?.region ?? null;

  // The player model: pass everything, first try. `noteAttempt` is still driven
  // so the rank's outermost term is exercised the way the shell drives `answered`; note the shell bumps `attempts` only on a failure, which this does not model and the `answered` filter masks.
  let state = NO_HISTORY;
  const served: Challenge[] = [];
  for (let step = 0; step < FIRST; step += 1) {
    const next = suggestNext(atlas.challenges, regionOf, state, (subject) => pathOf.get(subject) ?? null);
    if (next === null) break;
    served.push(next);
    const key = answerKey(next.verb, next.subject);
    state = {
      answered: new Set([...state.answered, key]),
      attempts: noteAttempt(state.attempts, key),
      skipped: new Set(),
      verbRun: state.previous !== null && state.previous.verb === next.verb ? state.verbRun + 1 : 1,
      metVerbs: new Set<VerbId>([...state.metVerbs, next.verb]),
      previous: next,
    };
  }

  // **The verb of each of the first five, in order.** A cold playtester's
  // complaint was not only *which* subjects opened but that the first three
  // boards were the same *shape* — three Blast Radius questions reading "2 of
  // 20, and one of them is the file's own test". ADR-0040 measures when the
  // second verb *arrives*; that is a different question from what the opening
  // feels like, and only this row answers it.
  const opening = served.slice(0, 5).map((board) => board.verb).join(' ');
  // **How many of the deck's verbs a player actually meets.** A cold playtester
  // was offered two of four across sixty consecutive suggestions — no
  // Archaeology, no Placement — while the HUD counted all 160 boards as "left".
  const deckVerbs = new Set(atlas.challenges.map((board) => board.verb));
  const metVerbs = new Set(served.map((board) => board.verb));
  const unmet = [...deckVerbs].filter((verb) => !metVerbs.has(verb)).sort();
  const runLength = (() => {
    let longest = 1;
    let run = 1;
    for (let i = 1; i < served.length; i += 1) {
      run = served[i]?.verb === served[i - 1]?.verb ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    return served.length === 0 ? 0 : longest;
  })();

  const shapedCount = served.filter((board) => shaped.has(board.subject)).length;
  const testCount = served.filter((board) => TEST_PATH.test(pathOf.get(board.subject) ?? '')).length;

  // **When the second verb arrives, not whether.** ADR-0040's own acceptance
  // number — a player met the second verb at board 25 on hono before it — and a
  // count of distinct verbs hides it completely. Any rank term placed above
  // `progress` risks pushing it back, so it is measured rather than argued.
  const first = served[0]?.verb;
  const secondAt = served.findIndex((board) => board.verb !== first) + 1;
  const firstFive = served
    .slice(0, 5)
    .map((board) => pathOf.get(board.subject) ?? board.subject.slice(0, 10))
    .join(', ');
  console.log(
    `| ${repo} | ${atlas.challenges.length} | **${shapedCount}** of ${served.length} | ${testCount} | ${secondAt === 0 ? '—' : secondAt} | **${runLength}** | ${metVerbs.size}/${deckVerbs.size}${unmet.length === 0 ? '' : ` (no ${unmet.join(', ')})`} | ${opening} |`,
  );
  if (process.env['ARK_PATHS'] === '1') console.log(`|   first five: ${firstFive}`);
  if (process.env['ARK_SHOW'] === '1') {
    for (const board of served) {
      const flag = shaped.has(board.subject) ? 'SHAPED' : '      ';
      console.log(`|   ${flag} ${board.verb.padEnd(12)} ${pathOf.get(board.subject) ?? board.subject}`);
    }
  }
}
