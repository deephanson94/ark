/**
 * Turning a commit log into the parts of the atlas that git is the rubric for:
 * per-file churn, rename lineage, and the co-change matrix.
 *
 * Pure — it takes the parsed log and the set of files that became nodes, and
 * returns plain data. All the subprocess work happened in `git.ts`.
 *
 * The budget lives here too. History is the only part of an atlas that grows
 * without bound (a 2,000-file repo can have 200,000 commits), so everything it
 * emits is capped, and every cap that actually bit is reported in
 * `atlas.report.truncations`. Silent truncation reads as success.
 */

import { byteCompare } from '../atlas/index.js';
import type { IsoDate, Truncation } from '../atlas/index.js';
import { commitOrder } from '../atlas/validate.js';
import type { GitCommit, GitHistory } from './git.js';

export interface HistoryLimits {
  /** Commits kept in full in the atlas. */
  readonly maxCommits: number;
  /** Files listed per retained commit. */
  readonly maxCommitFiles: number;
  /**
   * A commit touching more indexed files than this is excluded from co-change.
   * A vendoring commit or a mass reformat couples every file to every other
   * file, which is true and useless — it would drown the real signal.
   */
  readonly wideCommitFiles: number;
  readonly maxCoChangePairs: number;
  /** Pairs seen fewer times than this are noise, not coupling. */
  readonly minCoChangeCount: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  maxCommits: 500,
  maxCommitFiles: 64,
  wideCommitFiles: 25,
  maxCoChangePairs: 8000,
  minCoChangeCount: 2,
};

export interface NodeHistory {
  readonly churn: number;
  readonly authors: number;
  readonly firstSeen: IsoDate | null;
  readonly lastSeen: IsoDate | null;
  /**
   * True when this node's lineage was decided by `applyRenames`' arbitrary
   * tie-break, so its churn, dates and co-change counts may include another
   * file's activity. See `Lineage` in the schema, and `applyRenames` below.
   *
   * For a node standing for several files, **any** contested member contests
   * the node: the doubt is about whether these counts are this node's, and one
   * uncertain member is enough to make the sum uncertain.
   */
  readonly contested: boolean;
}

export interface RetainedCommit {
  readonly sha: string;
  readonly date: IsoDate;
  readonly subject: string;
  /** Node keys, sorted. A commit touching three files of one Go package touches one node. */
  readonly files: readonly string[];
  readonly wide: boolean;
  readonly issue: number | null;
}

export interface HistoryResult {
  /** Keyed by node key. Every node key has an entry. */
  readonly perNode: ReadonlyMap<string, NodeHistory>;
  /**
   * Live **file** path → the earliest path git knows that file by.
   *
   * Kept per file rather than per node because renames are a fact about files:
   * git records `pkg/a/x.go → internal/a/x.go`, never a directory move. A
   * node standing for several files derives its own origin from these
   * (`build.ts`), which is why this is returned instead of being folded into
   * `perNode`.
   */
  readonly originByFile: ReadonlyMap<string, string>;
  /** Newest first. */
  readonly commits: readonly RetainedCommit[];
  /** `[keyA, keyB, count]`, keyA < keyB. Sorted by count desc, then keys. */
  readonly coChange: readonly (readonly [string, string, number])[];
  readonly window: { readonly from: IsoDate; readonly to: IsoDate } | null;
  readonly commitsWalked: number;
  readonly truncations: readonly Truncation[];
}

/**
 * Which node a file belongs to.
 *
 * The identity for every language ark reads per file; a directory for Go,
 * whose unit of import is the package (ADR-0026). `buildHistory` takes it as a
 * parameter rather than knowing about it, because churn, co-change and a
 * commit's file list are all counted *per node* — a commit touching three
 * files of one package touched that package once, not three times — while
 * rename lineage is still followed per file.
 */
export type NodeKeyOf = (path: string) => string;

const SUBJECT_LIMIT = 120;

export function emptyHistory(paths: readonly string[], nodeKeyOf: NodeKeyOf): HistoryResult {
  const perNode = new Map<string, NodeHistory>();
  const originByFile = new Map<string, string>();
  for (const path of paths) {
    originByFile.set(path, path);
    perNode.set(nodeKeyOf(path), {
      churn: 0,
      authors: 0,
      firstSeen: null,
      lastSeen: null,
      // Nothing was inferred, so nothing was guessed.
      contested: false,
    });
  }
  return {
    perNode,
    originByFile,
    commits: [],
    coChange: [],
    window: null,
    commitsWalked: 0,
    truncations: [],
  };
}

interface Accumulator {
  churn: number;
  authors: Set<string>;
  firstSeen: IsoDate | null;
  lastSeen: IsoDate | null;
}

export function buildHistory(
  git: GitHistory,
  paths: readonly string[],
  nodeKeyOf: NodeKeyOf,
  limits: HistoryLimits,
): HistoryResult {
  if (!git.present || git.commits.length === 0) return emptyHistory(paths, nodeKeyOf);

  const live = new Set(paths);
  /** Historical path → the live path it eventually became. */
  const alias = new Map<string, string>();
  /** Live path → earliest path git knows it by. */
  const origin = new Map<string, string>();
  for (const path of paths) {
    alias.set(path, path);
    origin.set(path, path);
  }

  const accumulators = new Map<string, Accumulator>();
  const coChangeCounts = new Map<string, number>();
  /** Live paths whose lineage was decided arbitrarily. See `applyRenames`. */
  const contested = new Set<string>();
  const retained: RetainedCommit[] = [];
  let commitFilesDropped = 0;
  let oldest: IsoDate | null = null;
  let newest: IsoDate | null = null;

  for (const commit of git.commits) {
    if (newest === null || byteCompare(commit.date, newest) > 0) newest = commit.date;
    if (oldest === null || byteCompare(commit.date, oldest) < 0) oldest = commit.date;

    // Node keys, not paths: a commit touching three files of one Go package
    // touched that package **once**. Everything below — churn, the co-change
    // pairs, the wide-commit test and the retained file list — is counted in
    // that unit, so a package's numbers say what a file's have always said.
    const touched = new Set<string>();
    for (const path of commit.files) {
      const current = alias.get(path);
      if (current !== undefined && live.has(current)) touched.add(nodeKeyOf(current));
    }

    for (const path of touched) {
      let accumulator = accumulators.get(path);
      if (accumulator === undefined) {
        accumulator = { churn: 0, authors: new Set(), firstSeen: null, lastSeen: null };
        accumulators.set(path, accumulator);
      }
      accumulator.churn++;
      accumulator.authors.add(commit.author);
      // Min and max rather than first-and-last-seen: author dates are not
      // guaranteed to decrease monotonically along the log (a rebase or a
      // mailed patch can land an older authorship after a newer one).
      if (accumulator.firstSeen === null || byteCompare(commit.date, accumulator.firstSeen) < 0) {
        accumulator.firstSeen = commit.date;
      }
      if (accumulator.lastSeen === null || byteCompare(commit.date, accumulator.lastSeen) > 0) {
        accumulator.lastSeen = commit.date;
      }
    }

    const wide = touched.size > limits.wideCommitFiles;
    if (!wide && touched.size >= 2) {
      const members = [...touched].sort(byteCompare);
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const key = `${members[i]}\n${members[j]}`;
          coChangeCounts.set(key, (coChangeCounts.get(key) ?? 0) + 1);
        }
      }
    }

    if (touched.size > 0 && retained.length < limits.maxCommits) {
      const files = [...touched].sort(byteCompare);
      if (files.length > limits.maxCommitFiles) {
        commitFilesDropped += files.length - limits.maxCommitFiles;
        files.length = limits.maxCommitFiles;
      }
      retained.push({
        sha: commit.sha.slice(0, 12),
        date: commit.date,
        subject: truncate(commit.subject, SUBJECT_LIMIT),
        files,
        wide,
        issue: issueOf(commit.subject),
      });
    }

    applyRenames(commit, alias, origin, contested);
  }

  const originByFile = new Map<string, string>();
  // A node is contested when any of its files is. `contested` is a set of live
  // *file* paths, so the fold happens here rather than at the lookup — the
  // alternative is every reader remembering to check the members, which is the
  // shape of half this repo's landmines.
  const contestedNodes = new Set<string>();
  for (const path of paths) {
    originByFile.set(path, origin.get(path) ?? path);
    if (contested.has(path)) contestedNodes.add(nodeKeyOf(path));
  }

  const perNode = new Map<string, NodeHistory>();
  for (const path of paths) {
    const key = nodeKeyOf(path);
    if (perNode.has(key)) continue;
    const accumulator = accumulators.get(key);
    perNode.set(key, {
      churn: accumulator?.churn ?? 0,
      authors: accumulator?.authors.size ?? 0,
      firstSeen: accumulator?.firstSeen ?? null,
      lastSeen: accumulator?.lastSeen ?? null,
      contested: contestedNodes.has(key),
    });
  }

  const allPairs = [...coChangeCounts.entries()]
    .map(([key, count]): readonly [string, string, number] => {
      const [a = '', b = ''] = key.split('\n');
      return [a, b, count];
    })
    .filter(([, , count]) => count >= limits.minCoChangeCount)
    .sort((x, y) => y[2] - x[2] || byteCompare(x[0], y[0]) || byteCompare(x[1], y[1]));
  const coChange = allPairs.slice(0, limits.maxCoChangePairs);

  // Retention picks the newest commits in log order; the emitted array is then
  // put in a total order the validator can check, since the log's own order is
  // not recoverable from the fields we keep.
  retained.sort(commitOrder);

  const truncations: Truncation[] = [];
  const commitsDropped = git.totalCommits - retained.length;
  if (commitsDropped > 0) {
    truncations.push({ what: 'commits', kept: retained.length, dropped: commitsDropped });
  }
  if (allPairs.length > coChange.length) {
    truncations.push({
      what: 'coChange',
      kept: coChange.length,
      dropped: allPairs.length - coChange.length,
    });
  }
  if (commitFilesDropped > 0) {
    truncations.push({ what: 'commitFiles', kept: limits.maxCommitFiles, dropped: commitFilesDropped });
  }
  truncations.sort((a, b) => byteCompare(a.what, b.what));

  return {
    perNode,
    originByFile,
    commits: retained,
    coChange,
    window: oldest !== null && newest !== null ? { from: oldest, to: newest } : null,
    commitsWalked: git.commits.length,
    truncations,
  };
}

/**
 * Walk the rename records backwards in time. After this commit a file lived at
 * `to`; before it, at `from`.
 *
 * When two live files both claim the same historical path — A was renamed to B,
 * and later a new file appeared at A — the first claimant in log order keeps it
 * and the second falls back to its own current path. That is arbitrary but
 * deterministic.
 *
 * **Deterministic was enough until an answer key depended on it.** Every commit
 * older than a skipped rename credits `from`'s activity to whichever live file
 * currently holds that path, which may be a different file entirely. Blast
 * Radius only ever used co-change to *rank distractors*, so a wrong count cost
 * a slightly worse wrong answer. Companion grades against these counts, and
 * guardrail 4 does not accept "arbitrary" in an answer key — so both files
 * involved are recorded in `contested` and the verb refuses to ask about them.
 *
 * Measured: 0 on this repo, 0 on `sveltejs/svelte` (18,240 renames, none
 * contested), **5 skips on `honojs/hono`** — including a pair renamed to each
 * other's paths and back, so each live file claims the other's history.
 */
function applyRenames(
  commit: GitCommit,
  alias: Map<string, string>,
  origin: Map<string, string>,
  contested: Set<string>,
): void {
  for (const [from, to] of commit.renames) {
    const current = alias.get(to);
    if (current === undefined) continue;
    if (alias.has(from)) {
      // Both sides are compromised: the live file sitting at `from` is about to
      // inherit history that is not its own, and `current` loses history that
      // is. Neither may carry a question graded on co-change.
      const claimant = alias.get(from);
      if (claimant !== undefined) contested.add(claimant);
      contested.add(current);
      continue;
    }
    alias.set(from, current);
    alias.delete(to);
    origin.set(current, from);
  }
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function issueOf(subject: string): number | null {
  const match = /#(\d{1,9})\b/.exec(subject);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
