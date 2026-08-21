/**
 * **Can a board be answered by sorting the paths?**
 *
 * NORTH-STAR pillar 3 is violated *"when a challenge can be answered by Ctrl+F
 * rather than by reasoning about structure"*. A round-7 cold tester scored a
 * grade S on their first board without reasoning about a single import:
 *
 *   "exactly 6 of 20 candidates counted, and exactly 6 candidates began
 *    `scripts/` while all fourteen others began `src/`. I ticked the block and
 *    got an exact match. It made the S feel worthless the moment I noticed."
 *
 * The guess needs no graph, no history and no knowledge of the repository — only
 * the choice set on screen. That is the cheapest possible Ctrl+F, so it is the
 * one worth measuring.
 *
 * Scored with `scoreSet`, the metric §8.2 grades in, against band A (0.78).
 *
 * **Two adversaries, and they are not the same one.**
 *
 * - `player` is the guess a person can actually make: among the path prefixes
 *   that select *exactly as many candidates as the board says count* — a number
 *   the prompt prints — tick one. This is what the tester did. `gate.ts`'s
 *   `partition` heuristic models it and the generator refuses any board it
 *   beats, so this column should read **0** on a shipped deck; a non-zero is a
 *   defect in the gate. It carries the gate's own carve-out: a **one-file key**
 *   whose size several groups match is luck rather than reading, so neither
 *   side counts it. kysely ships two such boards, which is a real residual and
 *   is recorded as one.
 * - `oracle` is the best prefix scored *against the answer key*. No player can
 *   compute it, because picking it requires already knowing the answer. It is
 *   reported as an upper bound on how lexically clustered a repository is, and
 *   it does not go to zero — nor should it, since a well-organised codebase
 *   really does put related files together.
 *
 * Quoting the oracle as the leak is the units mistake this repo has a landmine
 * for, so both are printed and labelled.
 *
 *   npx tsx scripts/probe-prefix.ts [repo ...]
 */
import { join } from 'node:path';

import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

const BAND_A = 0.78;
const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const pathById = new Map(atlas.nodes.map((n) => [n.id, n.path]));

  for (const verb of ['blastRadius', 'companion', 'placement'] as const) {
    const boards = atlas.challenges.filter((c) => c.verb === verb);
    if (boards.length === 0) continue;
    let sum = 0;
    let beat = 0;
    let exact = 0;
    let playerBeat = 0;
    let playerExact = 0;
    const examples: string[] = [];
    for (const board of boards) {
      const truth = board.truth.filter(isNodeId);
      if (truth.length === 0) continue;
      // Every prefix a scanning eye could group by, including the empty one
      // ("tick everything") — which §8.2's F1 already defeats, and which belongs
      // in the comparison for exactly that reason.
      const prefixes = new Set<string>(['']);
      for (const id of board.candidates) {
        const path = pathById.get(id);
        if (path === undefined) continue;
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) prefixes.add(`${parts.slice(0, i).join('/')}/`);
      }
      let best = 0;
      let bestAt = '';
      let player = 0;
      // Groups of exactly the key's size, so the player column can apply the
      // same ambiguity rule the gate does — see below.
      let sizeMatchedGroups = 0;
      for (const prefix of prefixes) {
        const picked = board.candidates.filter((id) => (pathById.get(id) ?? ' ').startsWith(prefix));
        if (picked.length === 0) continue;
        const f1 = scoreSet(picked as never, truth as never).score;
        if (f1 > best) {
          best = f1;
          bestAt = prefix;
        }
        // The player's version: only splits whose size matches the stated key
        // size are pickable, and the best of those is what the gate refuses on.
        if (picked.length === truth.length) {
          sizeMatchedGroups += 1;
          if (f1 > player) player = f1;
        }
      }
      // **The gate's carve-out, mirrored here so the two columns mean the same
      // thing.** A one-file key whose size is matched by several groups is not
      // a guess: picking one singleton out of ten is luck, not reading. The
      // gate declines it, so this column must too — otherwise a "leak" it
      // reports is a disagreement between two instruments rather than a defect.
      // What remains is a genuine residual and is named in the README's known
      // gaps: kysely ships two such boards.
      const pickable = truth.length >= 2 || sizeMatchedGroups <= 1;
      if (pickable && player >= BAND_A) playerBeat += 1;
      if (pickable && player >= 0.999) playerExact += 1;
      sum += best;
      if (best >= BAND_A) beat += 1;
      if (best >= 0.999) {
        exact += 1;
        if (examples.length < 3) {
          examples.push(`${board.id} - "${bestAt || '(everything)'}" is exactly the key`);
        }
      }
    }
    const share = ((beat / boards.length) * 100).toFixed(0);
    console.log(
      `${repo} ${verb.padEnd(12)}: ${boards.length} boards` +
        ` | player: beats A ${playerBeat}, exact ${playerExact}` +
        ` | oracle: mean ${(sum / boards.length).toFixed(3)}, beats A ${beat} (${share}%), exact ${exact}`,
    );
    for (const line of examples) console.log(`      ${line}`);
  }
}
