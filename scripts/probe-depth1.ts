/**
 * What the naive direct-neighbour guess actually scores, on the boards a player
 * is served first and on the deck as a whole.
 *
 * ## Why this number decides something
 *
 * ADR-0008 decision 1 says depth 1 is drawn **"for every node, always — in free
 * roam and while a challenge is open alike"**, adds *"no modal special-casing
 * and no per-subject suppression"*, and lists *"suppress everything while a
 * challenge is open"* under **Rejected**. `src/verbs/gate.ts` says the same
 * thing from the other side: `directImporters` is the one guess it has ever
 * considered and declined, *"because ADR-0008 gives depth 1 away on the map on
 * purpose, and §8.4 measures `surprise` against exactly that guess. A question
 * that strategy passes is an easy question, which the progression needs — not a
 * broken one."*
 *
 * The player switched it off anyway. A cold playtester used a subject's ring as
 * a lookup, it was measured (37 of ark's 40 boards drew at least one key
 * member), and the whole channel was suppressed while any board was open — then
 * narrowed to import-graded boards only. No ADR was written, and the comment
 * that shipped with it cites decision 1 as its authority **on the line that
 * nulls it**.
 *
 * A review then named the consequence, in the project's own terms: §8.4 defines
 * `surprise` against the naive direct-neighbour guess, so a player who cannot
 * see direct neighbours **cannot form the baseline the difficulty is calibrated
 * against**. Every "easy" opening board is only easy relative to a player who
 * can see depth 1, and nobody can. Three cold rounds of *"my first three boards
 * scored zero"* follows from that arithmetic.
 *
 * ## What this measures
 *
 * The guess is: tick exactly the candidates that directly import the subject.
 * Scored with `scoreSet` — the metric the player is graded by, not precision,
 * because CLAUDE.md has a landmine about reporting a leak in units no threshold
 * applies to.
 *
 * Two populations, because they answer two different questions:
 *
 *  - **the opening** — the first `ARK_FIRST` boards the *shipped selector*
 *    serves a player who passes everything, which is what a newcomer meets. If
 *    the design is working this should be high: those boards are supposed to be
 *    winnable from the free hint.
 *  - **deck-wide** — every Blast Radius board. If *this* is high, depth 1 is a
 *    lookup for the whole verb and ADR-0008 needs amending rather than
 *    restoring. That is the owner's decision and this is the table it needs.
 *
 *   npx tsx scripts/probe-depth1.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph } from '../src/atlas/graph.js';
import type { Atlas, Challenge, NodeId, VerbId } from '../src/atlas/index.js';
import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { answerKey } from '../src/player/progress.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../src/player/selector.js';
import { scoreSet } from '../src/verbs/score.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const FIRST = Number(process.env['ARK_FIRST'] ?? '15');
/** §8.2's band A. The bar every other exposure in this repo is quoted against. */
const BAND_A = 0.78;

/** The candidates that import the subject directly — the map's free hint. */
function depth1Guess(atlas: Atlas, board: Challenge): NodeId[] {
  const graph = buildGraph(atlas);
  const ref = graph.refById.get(board.subject);
  if (ref === undefined) return [];
  const direct = new Set(
    (graph.in[ref] ?? []).map((edge) => atlas.nodes[edge.from]?.id).filter((id) => id !== undefined),
  );
  return board.candidates.filter((id): id is NodeId => isNodeId(id) && direct.has(id));
}

interface Tally {
  boards: number;
  sum: number;
  beatsA: number;
  exact: number;
}

const empty = (): Tally => ({ boards: 0, sum: 0, beatsA: 0, exact: 0 });

function fold(tally: Tally, f1: number): void {
  tally.boards += 1;
  tally.sum += f1;
  if (f1 >= BAND_A) tally.beatsA += 1;
  if (f1 >= 0.999) tally.exact += 1;
}

const show = (tally: Tally): string =>
  tally.boards === 0
    ? '—'
    : `${(tally.sum / tally.boards).toFixed(3)} · ${tally.beatsA}/${tally.boards} beat A · ${tally.exact} exact`;

console.log(`| repo | blast boards | opening (first ${FIRST} served) | deck-wide |`);
console.log('|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const blast = atlas.challenges.filter((board) => board.verb === 'blastRadius');
  if (blast.length === 0) {
    console.log(`| ${repo} | 0 | — | — |`);
    continue;
  }

  const deck = empty();
  const scored = new Map<string, number>();
  for (const board of blast) {
    const f1 = scoreSet(
      depth1Guess(atlas, board),
      board.truth.filter(isNodeId),
    ).score;
    scored.set(answerKey(board.verb, board.subject), f1);
    fold(deck, f1);
  }

  // The shipped selector, driven exactly as `probe-opening.ts` drives it: a
  // model player who passes everything. What matters here is *which* boards a
  // newcomer meets, not how they do on them.
  const pathOf = new Map(atlas.nodes.map((node) => [node.id, node.path]));
  const regionOf = (subject: string): string | null =>
    atlas.nodes.find((node) => node.id === subject)?.region ?? null;
  let state = NO_HISTORY;
  const opening = empty();
  for (let step = 0; step < FIRST; step += 1) {
    const next = suggestNext(atlas.challenges, regionOf, state, (s) => pathOf.get(s) ?? null);
    if (next === null) break;
    const key = answerKey(next.verb, next.subject);
    const f1 = scored.get(key);
    // Only the Blast Radius boards in the opening: the other verbs are not
    // graded on imports and the hint says nothing about them.
    if (f1 !== undefined) fold(opening, f1);
    state = {
      answered: new Set([...state.answered, key]),
      attempts: noteAttempt(state.attempts, key),
      skipped: new Set(),
      verbRun: state.previous !== null && state.previous.verb === next.verb ? state.verbRun + 1 : 1,
      metVerbs: new Set<VerbId>([...state.metVerbs, next.verb]),
      previous: next,
    };
  }

  console.log(`| ${repo} | ${blast.length} | ${show(opening)} | ${show(deck)} |`);
}
