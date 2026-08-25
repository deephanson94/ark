/**
 * **What can a cold player actually reason from, on each verb's own board?**
 *
 * Three round-7 testers reported Placement and Archaeology as word-matching
 * rather than structure — one scored 0% and said *"I had no basis for that at
 * all"*. The structural cause is in the code: `blastRadius` declares
 * `channel: 'importRadius'` and draws the subject's ring while its board is
 * open, `companion`'s `coChangeTies` is switched off for exactly the board it
 * would help (ADR-0016), and `placement` and `archaeology` declare
 * `channel: 'nothing'`.
 *
 * So on three of four verbs the map says nothing about the question. What the
 * **gate** assumes, though, is richer than that: Placement is scored against
 * `churn` (top-k most-edited) and `recency` (candidates whose last-seen matches
 * the commit's date), which means every shipped board is already proof against a
 * player who can read those two numbers. The player cannot: they live in the
 * inspector, and a board being open redirects the map's hover to row
 * highlighting, so no candidate can be inspected while the question is up.
 *
 * `keyRule`'s own comment makes the argument for closing a gap like that —
 * *"stating the key size is free against the Ctrl-F gate, because `gate.ts`
 * already hands every heuristic `truth.length`"*. The same reasoning would put
 * churn and last-seen on each candidate row.
 *
 * **Free against the gate is not the same as harmless**, because the gate's bar
 * is band A (0.78) and the pass mark is 0.5 — a guess scoring 0.77 ships. So
 * this measures what a player reading *only* those two numbers would score. If
 * it sits below the pass mark the channel is safe to open; if it sits between
 * pass and band A, opening it hands out passes for no reasoning and the trade is
 * the owner's.
 *
 * **The `best` column is the one to read, not the mean.** A mean says how the
 * guess does over a deck; a bar is crossed by one board. And ark indexes itself,
 * so the deck re-rolls on every commit — this repo has a landmine about a leak
 * measured at 0.011 under its bar, accepted as a plateau, and pushed over it
 * three milestones later by a commit that touched two test files. A margin under
 * a bar is a deferral with a timer on it, so the margin is printed.
 *
 *   npx tsx scripts/probe-cold.ts [repo ...]
 */
import { join } from 'node:path';

import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { PASS_THRESHOLD } from '../src/verbs/index.js';
import { scoreSet } from '../src/verbs/score.js';

const BAND_A = 0.78;
const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const nodeById = new Map(atlas.nodes.map((n) => [n.id, n]));
  const commitById = new Map(
    atlas.history.commits.map((c) => [`c:${c.sha.slice(0, 12)}`, c]),
  );

  // ---------------------------------------------------------------------
  // Archaeology: the same question about the other verb round 7 named.
  // ---------------------------------------------------------------------
  //
  // Its candidates are **commits**, and a commit row already prints a date and
  // a message. What it carries no trace of is how *wide* the commit was — how
  // many files it touched — which is the one structural fact about a commit
  // that bears on "did it touch this file". `broadKnown` prices part of that
  // already (commits touching many files the player has *seen*), so this scores
  // the ungated version: tick the k widest commits on the board.
  {
    const boards = atlas.challenges.filter((c) => c.verb === 'archaeology');
    const width = new Map(
      atlas.history.commits.map((c) => [`c:${c.sha.slice(0, 12)}`, c.files.length]),
    );
    let sum = 0;
    let pass = 0;
    let beatA = 0;
    let best = 0;
    let scored = 0;
    for (const board of boards) {
      const truth = board.truth.filter((id) => !isNodeId(id));
      if (truth.length === 0) continue;
      const picked = [...board.candidates]
        .filter((id) => !isNodeId(id))
        .sort((a, b) => (width.get(b) ?? 0) - (width.get(a) ?? 0) || (a < b ? -1 : 1))
        .slice(0, truth.length);
      const f1 = scoreSet(picked as never, truth as never).score;
      sum += f1;
      if (f1 >= PASS_THRESHOLD) pass += 1;
      if (f1 >= BAND_A) beatA += 1;
      if (f1 > best) best = f1;
      scored += 1;
    }
    if (scored > 0) {
      console.log(
        `${repo} archaeology: ${scored} boards | widest-k ${(sum / scored).toFixed(3)}` +
          ` -> passes ${pass} (${((pass / scored) * 100).toFixed(0)}%),` +
          ` beats A ${beatA}, best ${best.toFixed(3)}`,
      );
    }
  }

  for (const verb of ['placement'] as const) {
    const boards = atlas.challenges.filter((c) => c.verb === verb);
    if (boards.length === 0) continue;
    let churnSum = 0;
    let recencySum = 0;
    let bothSum = 0;
    let bothPass = 0;
    let bothBeatA = 0;
    let bothBest = 0;
    let scored = 0;
    for (const board of boards) {
      const truth = board.truth.filter(isNodeId);
      if (truth.length === 0) continue;
      const commit = commitById.get(board.subject);
      if (commit === undefined) continue;
      const files = board.candidates.filter(isNodeId);
      // `churn`: the most-edited candidates, as many as the key needs.
      const byChurn = [...files]
        .sort((a, b) => (nodeById.get(b)?.churn ?? 0) - (nodeById.get(a)?.churn ?? 0))
        .slice(0, truth.length);
      // `recency`: candidates whose last-seen is the commit's own date.
      const byDate = files.filter((id) => nodeById.get(id)?.lastSeen === commit.date);
      // Both numbers in front of you: the most-edited among those dated right,
      // falling back to churn when the date filter is empty.
      const combined = byDate.length > 0
        ? [...byDate]
            .sort((a, b) => (nodeById.get(b)?.churn ?? 0) - (nodeById.get(a)?.churn ?? 0))
            .slice(0, truth.length)
        : byChurn;
      const c = scoreSet(byChurn as never, truth as never).score;
      const r = byDate.length === 0 ? 0 : scoreSet(byDate as never, truth as never).score;
      const b = scoreSet(combined as never, truth as never).score;
      churnSum += c;
      recencySum += r;
      bothSum += b;
      if (b >= PASS_THRESHOLD) bothPass += 1;
      if (b >= BAND_A) bothBeatA += 1;
      if (b > bothBest) bothBest = b;
      scored += 1;
    }
    if (scored === 0) continue;
    console.log(
      `${repo} ${verb}: ${scored} boards | churn alone ${(churnSum / scored).toFixed(3)}` +
        ` | dates alone ${(recencySum / scored).toFixed(3)}` +
        ` | both ${(bothSum / scored).toFixed(3)}` +
        ` -> passes ${bothPass} (${((bothPass / scored) * 100).toFixed(0)}%),` +
        ` beats A ${bothBeatA}, best ${bothBest.toFixed(3)}`,
    );
  }
}
