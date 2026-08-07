/**
 * The Ctrl+F gate — pillar 3, made computable.
 *
 * > *"Teach coupling, not trivia. **Violated when** a challenge can be answered
 * > by `Ctrl+F` rather than by reasoning about structure."*
 *
 * Until now that was a rule nobody could check. A cold playtest on `vitejs/vite`
 * scored 80% over five questions and four of them were answerable by *"which
 * file in this directory is called `index.js`"*, which is the violation stated
 * almost word for word.
 *
 * This is ADR-0007's argument used a second time. There, the observation was
 * that "select everything" must score below the pass threshold, and the F1
 * metric enforced it with no special-case code — *"no anti-cheat needed; the
 * metric does it"*. Here the same metric is pointed at two more strategies that
 * need no understanding of the graph at all:
 *
 *   directory   select every candidate under the subject's own directory
 *   name        select every candidate sharing a name token with the subject
 *
 * If either reaches the pass threshold, the board is broken. Note what is
 * *not* here: no importance score, no "is this a fixture" classifier, no
 * weights, nothing authored per repo. The heuristics are the ones §8.3 already
 * names as the mistakes distractors exist to punish, and the scorer is the one
 * the player is graded by.
 *
 * **`directImporters` is deliberately absent.** ADR-0008 gives depth 1 away on
 * the map on purpose, and §8.4 measures `surprise` against exactly that guess.
 * A question that strategy passes is an *easy* question, which the progression
 * needs — not a broken one.
 *
 * ## Why the bar is an A, not a pass
 *
 * ADR-0007 set the select-everything bar at the *pass* threshold, which is
 * right there because selecting everything is pure gaming: it uses no knowledge
 * of any kind. These two heuristics are different. In a codebase whose
 * directories track its modules, "the files in this folder are coupled" is a
 * cheap but **true** structural fact, and a player who applies it has reasoned,
 * badly but not vacuously. Rejecting every question it can scrape a C on
 * deletes real questions from every directory-aligned architecture — measured
 * on `vitejs/vite`, the pass threshold cut the deck from 254 to 57 and took
 * *two thirds of the questions about the real source with it* (31 → 10).
 *
 * So the bar is band **A**: a question is broken when someone reading nothing
 * but filenames would earn a *strong* grade on it, not when they scrape a bare
 * pass. The measurement says this is not a knife edge — on vite the surviving
 * count is identical at 0.7 and at 0.78 (135 both times), so the threshold sits
 * on a plateau rather than on a cliff.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { nodeAt } from '../../atlas/index.js';
import { BAND_THRESHOLDS } from '../types.js';
import { scoreSet } from '../score.js';
import { directoryOf, nameTokens } from './distractors.js';

export type HeuristicId = 'directory' | 'name';

/**
 * Band A. Read the header for why this is not the pass threshold.
 * Derived rather than written down, so it moves if §8.2's bands move.
 */
export const CTRL_F_THRESHOLD: number =
  BAND_THRESHOLDS.find(([band]) => band === 'A')?.[1] ?? 0.78;

export interface GateVerdict {
  readonly passed: boolean;
  /** Heuristics that reached the threshold, sorted. Empty when `passed`. */
  readonly beatenBy: readonly HeuristicId[];
  /** What each heuristic actually scored. For reporting and for tests. */
  readonly scores: readonly (readonly [HeuristicId, number])[];
}

/**
 * What a player picks who reads only the file paths.
 *
 * Both take the whole choice set and filter it, exactly as a person scanning a
 * list would — no graph access, no atlas access, nothing but the strings.
 */
function guess(
  heuristic: HeuristicId,
  graph: Graph,
  subject: NodeRef,
  candidates: readonly NodeRef[],
): NodeRef[] {
  const subjectPath = nodeAt(graph, subject).path;
  if (heuristic === 'directory') {
    const home = directoryOf(subjectPath);
    return candidates.filter((ref) => directoryOf(nodeAt(graph, ref).path) === home);
  }
  const wanted = new Set(nameTokens(subjectPath));
  return candidates.filter((ref) =>
    nameTokens(nodeAt(graph, ref).path).some((token) => wanted.has(token)),
  );
}

export function gradeHeuristics(
  graph: Graph,
  subject: NodeRef,
  candidates: readonly NodeRef[],
  truth: readonly NodeRef[],
  threshold = CTRL_F_THRESHOLD,
): GateVerdict {
  const truthIds = truth.map((ref) => nodeAt(graph, ref).id);
  const scores: [HeuristicId, number][] = [];
  const beatenBy: HeuristicId[] = [];

  for (const heuristic of ['directory', 'name'] as const) {
    const picked = guess(heuristic, graph, subject, candidates).map((ref) => nodeAt(graph, ref).id);
    // The real scorer, not a reimplementation of it. If the pass threshold
    // moves, this moves with it — the same property ADR-0007 gave `isGameable`.
    const { score } = scoreSet(picked, truthIds);
    scores.push([heuristic, score]);
    if (score >= threshold) beatenBy.push(heuristic);
  }

  return { passed: beatenBy.length === 0, beatenBy, scores };
}
