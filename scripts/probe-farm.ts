/**
 * What the reveal gate actually costs an attacker, in clicks.
 *
 * `withhold.ts` gates the reveal on precision ≥ 0.5 and argues the gate is not
 * farmable because *"reaching precision 1.0 means already knowing which ones
 * were right"*. That sentence is about **one** answer. Guardrail 6 says
 * re-answering is free and unlimited, so the attacker's unit is not an answer,
 * it is a **sequence** of them — and this measures the sequence.
 *
 * Two sequences, both of which the shipped player permits today:
 *
 *  - **`unlock`** — tick one candidate, submit, read the grade, repeat. The
 *    first pick that lands in the key scores precision 1.0, which clears the bar
 *    and hands over the whole reveal. Cost: the 1-based position of the first
 *    truth member in the order the board presents its candidates.
 *  - **`sweep`** — never trigger the reveal at all. `howScored` reports
 *    *"N of your 1 picks are right"* for every single-pick answer, so ticking
 *    each candidate once reads the entire key straight off the grade. Cost:
 *    `|candidates|`. The precision bar does not touch this path.
 *
 * Both end at the same place the select-all exploit ended: reopen, tick the key,
 * take `S · 100% · exact` and a field note.
 *
 *   npx tsx scripts/probe-farm.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import type { Atlas, Challenge } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

/** The bar ADR-0035's gate used, kept here because this probe is its obituary. */
const REVEAL_PRECISION_BAR = 0.5;

/**
 * Clicks until a single-pick answer clears the reveal bar.
 *
 * The board's candidate order is the order the console renders, so this is what
 * a player sweeping top-to-bottom actually pays. Returns `null` when no single
 * pick can clear the bar, which cannot happen while the bar is ≤ 1.
 */
function unlockClicks(challenge: Challenge): number | null {
  const truth = new Set(challenge.truth);
  for (const [at, id] of challenge.candidates.entries()) {
    const grade = scoreSet([id], challenge.truth);
    const precision = grade.correct.length / 1;
    if (precision >= REVEAL_PRECISION_BAR) {
      if (!truth.has(id)) throw new Error('a pick cleared the bar without being in the key');
      return at + 1;
    }
  }
  return null;
}

/**
 * Whether the grade alone distinguishes a right pick from a wrong one.
 *
 * The gate is irrelevant to this path, so it is asserted rather than counted:
 * if a single-pick answer ever failed to separate the two cases the sweep would
 * not work and the row below would be a lie.
 */
function gradeSeparates(challenge: Challenge): boolean {
  const inKey = challenge.truth[0];
  const outKey = challenge.candidates.find((id) => !challenge.truth.includes(id));
  if (inKey === undefined || outKey === undefined) return false;
  return scoreSet([inKey], challenge.truth).score > scoreSet([outKey], challenge.truth).score;
}

function report(name: string, atlas: Atlas): void {
  const boards = atlas.challenges;
  if (boards.length === 0) {
    console.log(`${name.padEnd(18)} no deck`);
    return;
  }
  const unlocks: number[] = [];
  let sweep = 0;
  let separable = 0;
  for (const board of boards) {
    const clicks = unlockClicks(board);
    if (clicks !== null) unlocks.push(clicks);
    sweep += board.candidates.length;
    if (gradeSeparates(board)) separable += 1;
  }
  unlocks.sort((a, b) => a - b);
  const mean = unlocks.reduce((sum, n) => sum + n, 0) / unlocks.length;
  const median = unlocks[Math.floor(unlocks.length / 2)] ?? 0;
  console.log(
    `${name.padEnd(18)} boards ${String(boards.length).padStart(4)} · ` +
      `unlock clicks mean ${mean.toFixed(1)} median ${median} max ${unlocks[unlocks.length - 1]} · ` +
      `boards unlockable ${unlocks.length}/${boards.length} · ` +
      `grade separates ${separable}/${boards.length} · ` +
      `full sweep ${sweep} clicks over the whole deck ` +
      `(${(sweep / boards.length).toFixed(1)} per board)`,
  );
}

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  report(repo, atlas);
}
