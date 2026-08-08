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

import type { CommitId, Graph, IsoDate, NodeRef } from '../atlas/index.js';
import { commitIdFor, nodeAt } from '../atlas/index.js';
import { BAND_THRESHOLDS } from './types.js';
import { scoreSet } from './score.js';
import { directoryOf, nameTokens } from './paths.js';

export type HeuristicId = 'directory' | 'name' | 'churn' | 'recency';

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
 *
 * `recency` **is** here, and it was added after shipping because a post-ship
 * review noticed the pairing and a measurement confirmed it. Placement's prompt
 * prints the commit's date; the inspector prints every node's *last seen*. So
 * "tick every candidate whose last-seen date is the one in the question" needs
 * no idea of what changed with what — and it beat band A on **16 of hono's 54
 * boards**, scoring a flat 1.00 on several. On ark it beats none (mean 0.348,
 * best 0.71), which is exactly why measuring on a second repo is not optional.
 */
export const COMMIT_HEURISTICS: readonly HeuristicId[] = ['name', 'churn', 'recency'];

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
  /**
   * A date the prompt shows, or null when it shows none.
   *
   * Here because the inspector prints every node's `lastSeen`, so a date in the
   * question is a date the player can match against a column — no different in
   * kind from a filename, and `recency` scores it.
   */
  readonly date: IsoDate | null;
}

/** A file subject: its own directory, and its own name's tokens. */
export function pathSubject(graph: Graph, subject: NodeRef): GateSubject {
  const path = nodeAt(graph, subject).path;
  return { home: directoryOf(path), words: new Set(nameTokens(path)), date: null };
}

/**
 * A text subject: no home, and every word of the sentence the player is shown.
 *
 * Split on non-alphanumerics *and* at camel-case humps, so `parseConfig` in a
 * commit message matches `parse-config.ts` — the exact confusion §8.3's
 * name-similar strategy exists to punish. A gate that only matched whole words
 * would miss the leak it was installed for.
 */
export function textSubject(text: string, date: IsoDate | null = null): GateSubject {
  const words = new Set<string>();
  for (const token of text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (token.length > 0) words.add(token);
  }
  return { home: null, words, date };
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
  if (heuristic === 'recency') {
    // Structure-blind in the purest form available: two dates, one in the
    // question and one in the inspector, compared by eye. No cut and no
    // parameter — the filter *is* the guess, exactly as `directory` and `name`
    // are filters rather than top-k.
    if (subject.date === null) return [];
    const when = subject.date;
    return candidates.filter((ref) => nodeAt(graph, ref).lastSeen === when);
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

// ---------------------------------------------------------------------------
// the other side of the board: candidates that are commits
// ---------------------------------------------------------------------------

/**
 * Archaeology's set — ADR-0019 decision 6.
 *
 * A **separate function** below rather than one generalised `guess`, because the
 * two families share nothing but `scoreSet`: everything above filters a list of
 * *files* by path, churn or last-seen date, and everything here filters a list of
 * *commits* by message, date or width. The abstraction that unified them would
 * be a `pick(candidate) => boolean` with four incompatible closures behind it,
 * which is a longer way to write two functions.
 *
 * **Each of these four is live on exactly one repo, and deleting either half as
 * dead would be wrong.** `broadKnown` refuses boards here and none on hono; the
 * other three refuse none here and dozens on hono. Same profile ADR-0018
 * measured for `recency`, same cause: this repo is days old, so its dates barely
 * vary and its messages rarely name files, while hono's Placement deck is too
 * sparse to price many widths. A gate justified from one repo alone would have
 * been half deleted.
 *
 * ## `recentK` is here, and ADR-0019 had it the other way round
 *
 * That document decided this set as `{mentions, endpoints, oldestK, broadKnown}`
 * and left `recentK` out **on a measurement**: its throwaway probe scored
 * `oldestK` beating band A on 24 of hono's boards and `recentK` on none. Run
 * through the real generator both numbers move, and they swap:
 *
 *     firings (boards beaten)      ark    hono
 *     mentions                       0      11
 *     endpoints                      0       3
 *     broadKnown                     1       0
 *     oldestK                        0       0
 *     recentK                        0       3
 *
 * So excluding `recentK` would ship **3 boards on hono that a player beats by
 * ticking the newest rows**, for no reason except that a superseded probe said
 * the guess was dead. ADR-0019's own rule — a heuristic has to be a guess the
 * board actually invites — selects it, and its own text flagged the contingency:
 * *"it is dead under this configuration"*. This is that criterion applied to
 * re-measured data, not a new decision.
 *
 * **`oldestK` stays at zero firings, and that is not the same as dead.** Both
 * are invited by the *same structural fact*: decision 3 spreads the key over the
 * date ordering, so the key always contains the oldest **and** the newest
 * toucher. `oldestK` loses because the distractor padding is spread across the
 * window rather than ranked, which is §8.3 working as designed — supply the
 * board with the thing that makes the naive guess wrong, and still score it.
 * Measured: it is one design change away from firing (newest-first padding takes
 * it to 1 on hono, dropping the window filter to 2), so it is a canary that
 * catches a regression rather than a branch that cannot run. Its mean score is
 * 0.169 here and 0.150 on hono against a 0.78 bar.
 *
 * Two guesses are deliberately **absent**:
 *
 *  - `window`, "tick everything inside the file's lifetime". Not a heuristic at
 *    all: the pool filter (decision 5) makes every candidate contemporary, so
 *    this guess *is* select-everything, which ADR-0007's sizing rule already
 *    holds below the pass threshold by arithmetic. Measured on every shipped
 *    board of both repos, it maxes out at **0.462** — the bound the sizing rule
 *    predicts, not a coincidence. Two statements of one rule, and the weaker one
 *    able to go stale.
 *  - `directory`, for ADR-0018's reason, unchanged: the members have no
 *    directory.
 */
export type CommitHeuristicId =
  | 'mentions'
  | 'endpoints'
  | 'oldestK'
  | 'recentK'
  | 'broadKnown';

export const COMMIT_TRACE_HEURISTICS: readonly CommitHeuristicId[] = [
  'mentions',
  'endpoints',
  'oldestK',
  'recentK',
  'broadKnown',
];

/** The file a commit board is about, as the *player* can see it. */
export interface TraceSubject {
  /** The subject file's own name tokens — what a message would have to name. */
  readonly words: ReadonlySet<string>;
  /** The subject's `firstSeen` and `lastSeen`, which the inspector prints. */
  readonly firstSeen: IsoDate | null;
  readonly lastSeen: IsoDate | null;
  /**
   * Whether an earlier verb's reveal has printed this commit's file count.
   *
   * The player's knowledge, not the atlas's: `broadKnown` is only a guess a
   * player can *make* for commits somebody told them the width of, and
   * `disclosure.ts` is the record of who was told what. Scoring it over every
   * commit would refuse boards for a strategy nobody could have used, which is
   * the mistake `directory` is left out to avoid.
   */
  readonly widthKnown: (commit: CommitId) => boolean;
}

/**
 * The parts of a commit a structure-blind reader can see on the board.
 *
 * Structural rather than `CommitRecord` so the generator can pass its own
 * `EligibleCommit` without rebuilding one — the two agree on every field a guess
 * below actually reads, and listing them here says which those are. `wide` and
 * `issue` are deliberately absent: neither is on screen, so neither may enter a
 * guess about what a player could do.
 */
export interface GateCommit {
  readonly sha: string;
  readonly date: IsoDate;
  readonly subject: string;
  /** Read only for its **length** — the width `broadKnown` ranks by. */
  readonly files: readonly NodeRef[];
}

export interface CommitGateVerdict {
  readonly passed: boolean;
  readonly beatenBy: readonly CommitHeuristicId[];
  readonly scores: readonly (readonly [CommitHeuristicId, number])[];
}

function commitGuess(
  heuristic: CommitHeuristicId,
  subject: TraceSubject,
  candidates: readonly GateCommit[],
  size: number,
): GateCommit[] {
  if (heuristic === 'mentions') {
    // The mirror of `name`: there, the prompt's words are matched against the
    // board's filenames; here the *subject's* filename is matched against the
    // board's messages. Same reader, same effort, opposite direction.
    return candidates.filter((commit) =>
      messageTokens(commit.subject).some((token) => subject.words.has(token)),
    );
  }
  if (heuristic === 'endpoints') {
    // Two dates in the inspector against a column of dates on the board. The
    // key always contains both ends, because decision 3 spreads it over the
    // date ordering — which is exactly why this has to be scored rather than
    // assumed harmless.
    return candidates.filter(
      (commit) => commit.date === subject.firstSeen || commit.date === subject.lastSeen,
    );
  }
  if (heuristic === 'broadKnown') {
    // The widest, among the commits an earlier reveal has priced. `size`
    // because, like `churn`, width has no natural cut and a threshold would be
    // a magic number.
    return [...candidates]
      .filter((commit) => subject.widthKnown(commitIdFor(commit.sha)))
      .sort((a, b) => b.files.length - a.files.length || byteOrder(a.sha, b.sha))
      .slice(0, size);
  }
  if (heuristic === 'recentK') {
    return [...candidates]
      .sort((a, b) => byteOrder(b.date, a.date) || byteOrder(a.sha, b.sha))
      .slice(0, size);
  }
  // `oldestK` and `recentK`: the board alone hands both over, since every row
  // shows a date and the list is served in date order. They are one guess read
  // from each end, and the key contains both ends by construction (decision 3),
  // so scoring only one of them was an asymmetry with no argument behind it.
  return [...candidates]
    .sort((a, b) => byteOrder(a.date, b.date) || byteOrder(a.sha, b.sha))
    .slice(0, size);
}

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Split a commit message the same way `textSubject` does. */
function messageTokens(message: string): string[] {
  return message
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function gradeCommitHeuristics(
  subject: TraceSubject,
  candidates: readonly GateCommit[],
  truth: readonly GateCommit[],
  heuristics: readonly CommitHeuristicId[] = COMMIT_TRACE_HEURISTICS,
  threshold = CTRL_F_THRESHOLD,
): CommitGateVerdict {
  const truthIds = truth.map((commit) => commitIdFor(commit.sha));
  const scores: [CommitHeuristicId, number][] = [];
  const beatenBy: CommitHeuristicId[] = [];

  for (const heuristic of heuristics) {
    const picked = commitGuess(heuristic, subject, candidates, truth.length).map((commit) =>
      commitIdFor(commit.sha),
    );
    const { score } = scoreSet(picked, truthIds);
    scores.push([heuristic, score]);
    if (score >= threshold) beatenBy.push(heuristic);
  }

  return { passed: beatenBy.length === 0, beatenBy, scores };
}
