/**
 * Which commits Placement is allowed to ask about, and why the others are not.
 *
 * Placement's ground truth is `history.commits[].files` — the indexed files a
 * commit touched. That list is a **positive record**, which changes this verb's
 * relationship to guardrail 4 in a way worth stating outright, because
 * ADR-0014's four refusals do not all carry over:
 *
 *   Companion certifies a distractor by **absence** from the co-change matrix,
 *   so every channel that drops a pair — the pair cap, the count floor, the
 *   wide-commit exclusion, and the walk window — is a channel that can turn a
 *   true companion into a certified exclusion. That is why a truncated walk
 *   refuses the whole repo there.
 *
 *   Placement certifies a distractor by **absence from one commit's own
 *   recorded file list**. How far back the walk went does not enter into it: a
 *   commit either lists a file or it does not, and the record is complete for
 *   every commit that is present. So this verb needs neither `windowTruncated`
 *   nor the shallow-clone refusal, and adding them "for symmetry" would delete
 *   the deck on every large repo for no gain.
 *
 * What *does* bite is anything that makes a retained commit's own list
 * incomplete or misleading:
 *
 *   truncated   `maxCommitFiles` cuts a long list. The atlas reports the cut
 *               (`report.truncations`, `what: 'commitFiles'`), and the entry's
 *               `kept` **is** the limit, so the affected commits are
 *               identifiable exactly rather than guessed at. No commit is
 *               refused when the entry is absent — nothing was cut.
 *   wide        a commit touching more than `history.wideLimit` indexed files.
 *               This one is **pillar 3, not guardrail 4**, and the schema's
 *               "its files list may be truncated" is loose about it: with the
 *               indexer's defaults (`wideCommitFiles` 25, `maxCommitFiles` 64)
 *               a wide commit's list is complete unless it is also long. It is
 *               refused because a vendoring commit or a mass reformat couples
 *               everything to everything — ADR-0005's own judgement, applied
 *               where it now decides a question rather than a matrix cell.
 *   contested   a node whose rename lineage `applyRenames` resolved
 *               arbitrarily. Its membership in *any* commit may be
 *               misattributed, so it is barred from every role exactly as
 *               ADR-0014 decision 4 bars it from Companion's.
 */

import type { Atlas, CommitRecord, NodeRef, SubjectId } from '../../atlas/index.js';
import { commitIdFor } from '../../atlas/index.js';

export interface EligibleCommit {
  /** Abbreviated sha, as `CommitRecord.sha` carries it. */
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  /** Indexed files touched, sorted ascending. Complete for this commit. */
  readonly files: readonly NodeRef[];
}

export type CommitSkip = 'wide' | 'truncated' | 'uncertain';

export interface CommitSupply {
  readonly eligible: readonly EligibleCommit[];
  /** Nodes barred from every role by contested lineage. */
  readonly barred: ReadonlySet<NodeRef>;
  /** Why each refused commit was refused. Never silent — CLAUDE.md. */
  readonly refused: ReadonlyMap<CommitSkip, number>;
  /**
   * The `maxCommitFiles` limit, recovered from the truncation report, or null
   * when nothing was truncated.
   *
   * Recovered rather than assumed: ADR-0014 rejected carrying the indexer's
   * caps in the atlas to save schema surface, and this one need not be carried
   * either — a cap that bit says so, with its own value, in `kept`.
   */
  readonly fileCap: number | null;
}

/**
 * Everything this verb may ask about, in the atlas's own commit order.
 *
 * A commit is refused whole. Dropping only its contested members would leave
 * the remaining list looking complete while it is not — the certification a
 * distractor rests on ("this commit did not touch that file") would then be
 * made against a list we know is wrong.
 */
export function commitSupply(atlas: Atlas): CommitSupply {
  const barred = new Set<NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) {
    if (node.lineage === 'contested') barred.add(ref);
  }

  const truncation = atlas.report.truncations.find((entry) => entry.what === 'commitFiles');
  const fileCap = truncation === undefined ? null : truncation.kept;

  const refused = new Map<CommitSkip, number>();
  const note = (reason: CommitSkip): void => {
    refused.set(reason, (refused.get(reason) ?? 0) + 1);
  };

  const eligible: EligibleCommit[] = [];
  for (const commit of atlas.history.commits) {
    if (commit.wide) {
      note('wide');
      continue;
    }
    // `>=` and not `>`: a list cut to exactly the cap is indistinguishable from
    // one that happened to end there, and guardrail 4 wants the ambiguous case
    // on the refusing side.
    if (fileCap !== null && commit.files.length >= fileCap) {
      note('truncated');
      continue;
    }
    if (commit.files.some((ref) => barred.has(ref))) {
      note('uncertain');
      continue;
    }
    // There is deliberately no empty-list branch: `src/indexer/history.ts`
    // retains a commit only when it touched at least one indexed file, so a
    // branch for `files.length === 0` could never be taken on an atlas this
    // build produced. A path that never executes is worse than no path — it is
    // code and test surface asserting a behaviour the product does not have.
    eligible.push({
      sha: commit.sha,
      date: commit.date,
      subject: commit.subject,
      files: commit.files,
    });
  }

  return { eligible, barred, refused, fileCap };
}

/**
 * The commit a subject id names, or null when this atlas no longer holds it.
 *
 * Null is a normal outcome, not an error: the commit window slides with every
 * reindex, so a save earned against last month's atlas can name a commit that
 * has fallen out of it. ADR-0011 decision 3 says a claim the atlas can no
 * longer support is dropped rather than shown stale, and returning null is how
 * that happens here.
 *
 * Linear rather than indexed on purpose. It is called once per note and once
 * per reveal, over a list the indexer caps at `maxCommits` (500), so an index
 * would cost a map rebuild per call to save a scan of a bounded list.
 */
export function commitOf(atlas: Atlas, subject: SubjectId): CommitRecord | null {
  return atlas.history.commits.find((commit) => commitIdFor(commit.sha) === subject) ?? null;
}

/**
 * What to call a commit on screen: its abbreviated sha and its own subject line.
 *
 * The message is quoted, never paraphrased. Guardrail 2 forbids authoring
 * content about a particular project; repeating what the repo already says
 * about itself is derived content, and it is the only thing that makes this
 * verb's prompt mean anything.
 */
export function labelOf(commit: CommitRecord): string {
  return `${commit.sha} — "${commit.subject}"`;
}
