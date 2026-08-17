/**
 * If the map showed a board's **difficulty band**, what would that give away?
 *
 * ## The proposal this gates
 *
 * The owner proposed a monster whose *level* warns you off a question that is
 * beyond you — "too high means wrong path" — as a guide to self-exploration.
 * That is §8.4's difficulty made visible, and everything it needs is already
 * computed. It is also the only part of an RPG direction that survives the
 * guardrails, so it is worth getting right.
 *
 * ## Why it is not free
 *
 * §8.4's difficulty is `w₁·log(fanOut) + w₂·maxDepth + w₃·surprise`, and
 * `surprise = |truth Δ naiveGuess| / |truth|` is measured against **the guess a
 * player can already make from the map** — ADR-0008 draws every node's direct
 * importers, always. So a displayed band is not a neutral fact about a board: a
 * *low* band says "the ring you can see is close to the key", which is strategy
 * information the player did not have. ADR-0047 §5 declined the sharper version
 * of exactly this ("the farthest key member is N hops out").
 *
 * The rule this repo applies to such a thing is ADR-0021's: score the guess the
 * display invites, with `scoreSet`, against §8.2's band A, on more than one
 * repository — and report it in the units the player is graded in, because a
 * precision figure always flatters a leak.
 *
 * ## What this measures
 *
 * Partition each repo's Blast Radius deck into `B` equal bands of its own
 * difficulty range — the coarse thing a marker could show — and inside each
 * band score the guess the band invites:
 *
 *   **tick exactly the ring** — the candidates that import the subject directly.
 *
 * Deck-wide that guess is already known and already accepted (ADR-0048). The
 * question here is narrower and is the whole point: **is it concentrated in the
 * bottom band?** If the lowest band's boards are the ones the ring solves, then
 * drawing the band hands the player a "the answer is on screen" flag, and the
 * display has to be coarsened or gated. If the ring's success is spread evenly,
 * the band tells them nothing they could act on.
 *
 *   npx tsx scripts/probe-band.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph } from '../src/atlas/graph.js';
import type { Atlas, Challenge, NodeId } from '../src/atlas/index.js';
import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
/** §8.2's band A. The bar every other exposure in this repo is quoted against. */
const BAND_A = 0.78;
/** How many bands a marker might show. Measured at both. */
const BAND_COUNTS = [3, 4];

/** The candidates that import the subject directly — the map's free hint. */
function ringGuess(atlas: Atlas, graph: ReturnType<typeof buildGraph>, board: Challenge): NodeId[] {
  const ref = graph.refById.get(board.subject);
  if (ref === undefined) return [];
  const direct = new Set(
    (graph.in[ref] ?? []).map((edge) => atlas.nodes[edge.from]?.id).filter((id) => id !== undefined),
  );
  return board.candidates.filter((id): id is NodeId => isNodeId(id) && direct.has(id));
}

/**
 * The alternative signal, and the reason there is one.
 *
 * `difficulty` cannot be shown because `surprise` is defined *against* the ring,
 * so its bottom band is the set of boards the ring solves — that is the table
 * above. **`elevation` is the opposite case by construction**: ADR-0013 makes it
 * the bit length of the subject's transitive dependent count, it is frozen, and
 * the orbit and the world already draw it as height. A level read off it would
 * be a summary of a channel the product already publishes, which is the ADR-0008
 * test for whether a display gives anything away.
 *
 * Whether it is *also* a usable warning is the second question, and it is the
 * one that decides whether the owner's idea ships in any form: if elevation
 * bands do not separate the ring-solvable boards, the level is safe; if they do,
 * it is the same leak wearing a different number.
 */
const BY = ['difficulty', 'elevation'] as const;

console.log(`| repo | signal | bands | band | boards | mean F1 of the ring | beat A | exact |`);
console.log('|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const graph = buildGraph(atlas);
  const blast = atlas.challenges.filter((board) => board.verb === 'blastRadius');
  if (blast.length === 0) {
    console.log(`| ${repo} | — | — | 0 | — | — | — |`);
    continue;
  }

  const scored = blast.map((board) => ({
    board,
    f1: scoreSet(ringGuess(atlas, graph, board), board.truth.filter(isNodeId)).score,
  }));
  const low = Math.min(...blast.map((b) => b.difficulty));
  const high = Math.max(...blast.map((b) => b.difficulty));
  const span = high - low;

  const elevationOf = (board: Challenge): number => {
    const ref = graph.refById.get(board.subject);
    return ref === undefined ? 0 : (atlas.nodes[ref]?.elevation ?? 0);
  };
  const eLow = Math.min(...blast.map(elevationOf));
  const eHigh = Math.max(...blast.map(elevationOf));
  const eSpan = eHigh - eLow;

  for (const signal of BY) {
    const value = (board: Challenge): number =>
      signal === 'difficulty' ? board.difficulty : elevationOf(board);
    const min = signal === 'difficulty' ? low : eLow;
    const range = signal === 'difficulty' ? span : eSpan;
    for (const bands of BAND_COUNTS) {
      for (let band = 0; band < bands; band += 1) {
        const inBand = scored.filter(({ board }) => {
          const at =
            range === 0 ? 0 : Math.min(bands - 1, Math.floor(((value(board) - min) / range) * bands));
          return at === band;
        });
        if (inBand.length === 0) {
          console.log(`| ${repo} | ${signal} | ${bands} | ${band} | 0 | — | — | — |`);
          continue;
        }
        const mean = inBand.reduce((sum, row) => sum + row.f1, 0) / inBand.length;
        const beat = inBand.filter((row) => row.f1 >= BAND_A).length;
        const exact = inBand.filter((row) => row.f1 >= 0.999).length;
        console.log(
          `| ${repo} | ${signal} | ${bands} | ${band}${band === 0 ? ' (low)' : band === bands - 1 ? ' (high)' : ''} | ${inBand.length} | ${mean.toFixed(3)} | ${beat} (${((beat / inBand.length) * 100).toFixed(0)}%) | ${exact} |`,
        );
      }
    }
  }
}

/**
 * The counterfactual the two tables above are missing.
 *
 * They score a band against *nothing*, and the player is not starting from
 * nothing. Every prompt states the key's size — `keyRule`: *"Exactly 2 of these
 * 20 count"* — and ADR-0008 draws the ring on every node, always. So a player
 * already holds both halves of the check "does the ring have exactly as many
 * candidates as the key has members?", on **every** board, with no level
 * displayed at all.
 *
 * If that check already finds the ring-solvable boards, a displayed level adds
 * no strategy the player lacks and the leak the tables above report is one the
 * product already accepted (ADR-0048, and `gate.ts`: *"a question that strategy
 * passes is an easy question, which the progression needs"*). If it does not,
 * the level is genuinely new information and is refused.
 *
 * "Say what your counterfactual holds fixed, and check that it holds it."
 */
console.log('');
console.log('| repo | ring-solvable boards | found by the size check alone | new information a level would add |');
console.log('|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const graph = buildGraph(atlas);
  const blast = atlas.challenges.filter((board) => board.verb === 'blastRadius');
  if (blast.length === 0) continue;

  let solvable = 0;
  let caught = 0;
  for (const board of blast) {
    const ring = ringGuess(atlas, graph, board);
    const f1 = scoreSet(ring, board.truth.filter(isNodeId)).score;
    if (f1 < BAND_A) continue;
    solvable += 1;
    // The check a player can already run: the prompt states `truth.length`, and
    // the ring is on screen. No level required.
    if (ring.length === board.truth.length) caught += 1;
  }
  console.log(
    `| ${repo} | ${solvable} | ${caught} (${solvable === 0 ? '—' : ((caught / solvable) * 100).toFixed(0) + '%'}) | ${solvable - caught} |`,
  );
}

/**
 * The version that might survive: a level on the **region**, not on the board.
 *
 * The owner's idea is a warning about *where you are* — "too high means you have
 * wandered somewhere beyond you" — which is a claim about a neighbourhood, and a
 * neighbourhood is what a map is for. A per-region badge cannot say which
 * board's ring is its key, because a region holds many boards of many depths.
 *
 * Scored the same way: does knowing the low-elevation *regions* identify
 * ring-solvable boards any better than the size check the player already has?
 */
console.log('');
console.log('| repo | regions | boards in the lowest region band | ring-solvable there | beyond the size check |');
console.log('|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const graph = buildGraph(atlas);
  const blast = atlas.challenges.filter((board) => board.verb === 'blastRadius');
  if (blast.length === 0) continue;

  const regionOf = new Map(atlas.nodes.map((node) => [node.id, node.region]));
  // A region's level: the mean elevation of its nodes, banded into three.
  const byRegion = new Map<string, number[]>();
  for (const node of atlas.nodes) {
    byRegion.set(node.region, [...(byRegion.get(node.region) ?? []), node.elevation]);
  }
  const level = new Map<string, number>();
  for (const [id, values] of byRegion) {
    level.set(id, values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
  }
  const levels = [...level.values()];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const bandOf = (region: string): number =>
    hi === lo ? 0 : Math.min(2, Math.floor((((level.get(region) ?? 0) - lo) / (hi - lo)) * 3));

  const lowest = blast.filter((board) => bandOf(regionOf.get(board.subject) ?? '') === 0);
  let solvable = 0;
  let beyond = 0;
  for (const board of lowest) {
    const ring = ringGuess(atlas, graph, board);
    if (scoreSet(ring, board.truth.filter(isNodeId)).score < BAND_A) continue;
    solvable += 1;
    if (ring.length !== board.truth.length) beyond += 1;
  }
  console.log(
    `| ${repo} | ${byRegion.size} | ${lowest.length} | ${solvable} | ${beyond} |`,
  );
}

/**
 * ## What these four tables decided
 *
 * **A per-board level is refused.** Banding on `difficulty` puts 100% of the
 * bottom band's boards above band A for the ring guess (9 of 9 on ark, 16 of 16
 * on hono), because `surprise` is defined against the ring — showing difficulty
 * *is* showing surprise. Banding on `elevation` is barely better (88% / 77%).
 *
 * **But the marginal information is small, and that is the number that matters.**
 * Of the boards the ring solves, the player already identifies **70% on ark and
 * 83% on hono** with no level at all, from two things they always have: the
 * prompt states the key's size and the ring is drawn. A per-board level adds
 * **3 boards on each repo** — small, and the same magnitude ADR-0021 measured
 * and ADR-0022 then closed, so it is not below this project's acting threshold.
 *
 * **A per-region level adds nothing: 0 boards beyond the size check on both.**
 * That is the shippable version of the owner's idea — a warning about *where you
 * are*, which is what a map is for, and which cannot say which board's ring is
 * its key because a region holds many boards at many depths.
 *
 * **Its own caveat, and it is the one to fix before building:** hono's lowest
 * region band holds **0 boards**, so on that repo the warning never fires. Equal
 * *width* bands over a mean-elevation range are the wrong shape; equal *count*
 * bands (terciles by board) would fire on every repo. Count the firings before
 * writing tests around it.
 */
