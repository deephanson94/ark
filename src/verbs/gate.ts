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
 *
 * ## Why the heuristic set is per-verb
 *
 * This moved up from `blastRadius/` in M4 and gained a third heuristic,
 * `churn` — *select the k busiest candidates* — which is Companion's version of
 * the same failure: co-change's naive strategy is not "same folder" but "the
 * files that change all the time change with everything". It is **not** applied
 * to Blast Radius, and that is deliberate rather than tidy. Every heuristic
 * here has to be a guess the verb's own board actually invites; adding one that
 * merely *could* be scored would silently delete questions from a shipped verb
 * for a reason nobody measured.
 *
 * It earns its place by firing: on the boards Companion assembles it refuses
 * **13 of 39** subjects on this repo, 17 on `honojs/hono` and 132 on
 * `sveltejs/svelte`. A gate that never rejects anything is a gate nobody
 * installed.
 */

import type { Graph, NodeRef } from '../atlas/index.js';
import { nodeAt } from '../atlas/index.js';
import { BAND_THRESHOLDS } from './types.js';
import { scoreSet } from './score.js';
import { directoryOf, nameTokens } from './paths.js';

export type HeuristicId = 'directory' | 'name' | 'churn';

/** What Blast Radius is checked against. Unchanged from M2 — see the header. */
export const PATH_HEURISTICS: readonly HeuristicId[] = ['directory', 'name'];

/** Companion adds the busiest-files guess. */
export const HISTORY_HEURISTICS: readonly HeuristicId[] = ['directory', 'name', 'churn'];

/**
 * Placement's set. `directory` is **absent and that is not an oversight**: a
 * commit has no directory, so the guess "the files in the subject's folder"
 * is not one its board can invite. Adding it would have meant inventing a home
 * for the subject — most plausibly the directory holding the most answers,
 * which the player cannot read off the prompt and which would therefore delete
 * questions for a strategy nobody could have used.
 */
export const COMMIT_HEURISTICS: readonly HeuristicId[] = ['name', 'churn'];

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
 * The subject as the *player* sees it: a home directory to scan around, and the
 * words the prompt puts in front of them.
 *
 * Generalised from a bare `NodeRef` when Placement landed, because a commit
 * subject has no path — and because the `name` guess is the *same* guess in
 * both cases. "Select every candidate whose filename appears in the prompt" is
 * exactly what a Ctrl+F reader does, whether the prompt shows `src/parse.ts` or
 * *"fix the parser's error path"*. Only where the words come from differs, so
 * that is the only thing this type varies.
 */
export interface GateSubject {
  /** The directory to treat as the subject's home, or null when it has none. */
  readonly home: string | null;
  /** The words the prompt shows, already tokenised and lowercased. */
  readonly words: ReadonlySet<string>;
}

/** A file subject: its own directory, and its own name's tokens. */
export function pathSubject(graph: Graph, subject: NodeRef): GateSubject {
  const path = nodeAt(graph, subject).path;
  return { home: directoryOf(path), words: new Set(nameTokens(path)) };
}

/**
 * A text subject: no home, and every word of the sentence the player is shown.
 *
 * Split on non-alphanumerics *and* at camel-case humps, so `parseConfig` in a
 * commit message matches `parse-config.ts` — the exact confusion §8.3's
 * name-similar strategy exists to punish. A gate that only matched whole words
 * would miss the leak it was installed for.
 */
export function textSubject(text: string): GateSubject {
  const words = new Set<string>();
  for (const token of text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (token.length > 0) words.add(token);
  }
  return { home: null, words };
}

/**
 * What a player picks who reads only the file paths, or only the churn column.
 *
 * Each takes the whole choice set and filters it, exactly as a person scanning
 * a list would — no graph traversal, nothing that requires understanding the
 * structure. `churn` is the one that reads a number rather than a string, and
 * it is still structure-blind: the map already prints it, and "the busy files
 * are the coupled files" needs no idea of what imports what.
 *
 * `churn` needs `size` because, unlike the other two, it has no natural cut —
 * a threshold would be a magic number. Taking exactly as many as the answer key
 * holds is the strongest form of the guess: it is what a player would pick who
 * knew how many answers there were and nothing else, so a board it beats was
 * never asking about coupling.
 */
function guess(
  heuristic: HeuristicId,
  graph: Graph,
  subject: GateSubject,
  candidates: readonly NodeRef[],
  size: number,
): NodeRef[] {
  if (heuristic === 'directory') {
    // A homeless subject cannot be guessed at by folder. Returning nothing
    // scores 0 rather than throwing, but no verb asks for this pairing — see
    // `COMMIT_HEURISTICS` on why a heuristic a board cannot invite is left out
    // of the list rather than scored at zero inside it.
    if (subject.home === null) return [];
    const home = subject.home;
    return candidates.filter((ref) => directoryOf(nodeAt(graph, ref).path) === home);
  }
  if (heuristic === 'churn') {
    return [...candidates]
      .sort(
        (a, b) =>
          nodeAt(graph, b).churn - nodeAt(graph, a).churn ||
          (nodeAt(graph, a).id < nodeAt(graph, b).id ? -1 : 1),
      )
      .slice(0, size);
  }
  return candidates.filter((ref) =>
    nameTokens(nodeAt(graph, ref).path).some((token) => subject.words.has(token)),
  );
}

export function gradeHeuristics(
  graph: Graph,
  subject: GateSubject,
  candidates: readonly NodeRef[],
  truth: readonly NodeRef[],
  heuristics: readonly HeuristicId[] = PATH_HEURISTICS,
  threshold = CTRL_F_THRESHOLD,
): GateVerdict {
  const truthIds = truth.map((ref) => nodeAt(graph, ref).id);
  const scores: [HeuristicId, number][] = [];
  const beatenBy: HeuristicId[] = [];

  for (const heuristic of heuristics) {
    const picked = guess(heuristic, graph, subject, candidates, truth.length).map(
      (ref) => nodeAt(graph, ref).id,
    );
    // The real scorer, not a reimplementation of it. If the pass threshold
    // moves, this moves with it — the same property ADR-0007 gave `isGameable`.
    const { score } = scoreSet(picked, truthIds);
    scores.push([heuristic, score]);
    if (score >= threshold) beatenBy.push(heuristic);
  }

  return { passed: beatenBy.length === 0, beatenBy, scores };
}
