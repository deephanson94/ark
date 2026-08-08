/**
 * Which commits Placement is allowed to ask about, and why the others are not.
 *
 * Placement's ground truth is `history.commits[].files` — the indexed files a
 * commit touched. That is a **positive record**, so this verb's relationship to
 * guardrail 4 differs from Companion's, and the difference is worth stating
 * precisely — because a first draft of this file stated it *imprecisely* and
 * shipped a wrong answer key.
 *
 *   Companion certifies a distractor by **absence** from the co-change matrix,
 *   so every channel that drops a pair — the pair cap, the count floor, the
 *   wide-commit exclusion, and the walk window — can turn a true companion into
 *   a certified exclusion. That is why a truncated walk refuses the whole repo
 *   there.
 *
 *   Placement certifies a distractor by **absence from one commit's own
 *   recorded file list**. How far back the walk went genuinely does not enter
 *   into it: retained commits are the newest walked, so a walk that stopped
 *   early removes whole commits and corrupts none. `windowTruncated` is
 *   therefore not needed here, and copying it over would delete the deck on
 *   every large repo for nothing.
 *
 * ## The shallow clone is a different mechanism, and it does bite
 *
 * The draft above lumped a shallow clone in with the walk window and concluded
 * this verb needed no refusal for it. **That was wrong, and the failure is
 * demonstrable in four commands.** A `--depth N` clone's oldest commit has no
 * parent, so git diffs it against the empty tree: `git log --name-status`
 * reports it as **adding the entire worktree**, not its own change.
 *
 *     git clone --depth 2 …            # boundary = "third: add c only"
 *     git log --name-status            # → A a.ts  A b.ts  A c.ts
 *
 * Nothing downstream can tell that record from a real 3-file commit, so
 * Placement ships a board quoting a true commit message over an answer key
 * naming files it never touched. Measured on a purpose-built fixture: a repo
 * of 8 files that later grew to 38, cloned at depth 2, produces a board for
 * *"wave one lands"* whose key contains three `base*.ts` files that predate it
 * by eight commits, and whose `touched` says 23 against a true 15.
 *
 * So the refusal is the whole repo, on ADR-0014's own signal —
 * `history.present && repo.root === null`, which is null exactly when the clone
 * is shallow or the root is unreadable (ADR-0011). Refusing only the boundary
 * commit would be tighter and is not available: the oldest *retained* commit is
 * not necessarily the boundary once `maxCommits` or a commit touching no indexed
 * file gets between them. A missing deck costs nothing; a wrong answer key costs
 * trust permanently.
 *
 * ## What else makes a retained commit's own list untrustworthy
 *
 *   truncated   `maxCommitFiles` cut a long list, so the key is incomplete. The
 *               atlas reports the cut (`report.truncations`, `what:
 *               'commitFiles'`) and the entry's `kept` **is** the limit, so the
 *               affected commits are identifiable exactly rather than guessed
 *               at. Checked **before** `wide` deliberately — see below.
 *   wide        a commit touching more than `history.wideLimit` indexed files.
 *               This one is **pillar 3, not guardrail 4**: with the indexer's
 *               defaults (`wideCommitFiles` 25, `maxCommitFiles` 64) a wide
 *               commit's list is complete unless it is also long. It is refused
 *               because a vendoring commit or a mass reformat couples everything
 *               to everything — ADR-0005's judgement, applied where it now
 *               decides a question rather than a matrix cell.
 *   contested   a node whose rename lineage `applyRenames` resolved
 *               arbitrarily. Its membership in *any* commit may be
 *               misattributed, so it is barred from every role exactly as
 *               ADR-0014 decision 4 bars it from Companion's.
 *
 * **Why `truncated` is tested first, and it is not stylistic.** Ordered after
 * `wide` it is a branch that can never be taken: truncation needs > 64 files and
 * wideness needs > 25, so with the shipped limits every truncatable commit is
 * already wide. It would have been code and test surface asserting a behaviour
 * the product does not have — CLAUDE.md's landmine, in the commit that quotes
 * it. Tested first it fires exactly when the cap bit, and reports the
 * guardrail-4 reason rather than the pillar-3 one.
 *
 * ## One limit this verb has and cannot certify away
 *
 * `touched` is built by mapping each historical path through `alias`, which is
 * only as good as `git log -M`'s rename detection. A rename with a heavy rewrite
 * is reported as delete+add, so an older commit's list omits today's file under
 * its old name — and the generator will offer that file as a wrong answer. The
 * exclusion is therefore certified against **the rename history git detected**,
 * not against what a human would call the same file. That is the accuracy trade
 * NORTH-STAR §7.2 makes for the whole product ("an 85%-accurate import graph
 * that works everywhere"), stated here rather than hidden behind the word
 * *provably*.
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

export type CommitSkip = 'wide' | 'truncated' | 'uncertain' | 'shallowClone';

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
  /**
   * True when the clone is shallow (or its root is unreadable), so the oldest
   * commit's recorded file list is git's diff against the empty tree rather
   * than its own change. The whole repo is refused — see the header.
   */
  readonly shallow: boolean;
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

  // Whole-repo refusal, counted once — it is a fact about the atlas, not about
  // any one question. `repo.root` is null exactly when the clone is shallow or
  // the root is unreadable (ADR-0011), and the unreadable case falls on the
  // refusing side, which is the direction guardrail 4 wants.
  const shallow = atlas.history.present && atlas.repo.root === null;
  if (shallow) {
    note('shallowClone');
    return { eligible: [], barred, refused, fileCap, shallow };
  }

  const eligible: EligibleCommit[] = [];
  for (const commit of atlas.history.commits) {
    // Before `wide`, and the header says why: after it, this branch could never
    // be taken with the shipped limits.
    //
    // `>=` and not `>`: a list cut to exactly the cap is indistinguishable from
    // one that happened to end there, and guardrail 4 wants the ambiguous case
    // on the refusing side.
    if (fileCap !== null && commit.files.length >= fileCap) {
      note('truncated');
      continue;
    }
    if (commit.wide) {
      note('wide');
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

  return { eligible, barred, refused, fileCap, shallow };
}

const BY_ID = new WeakMap<Atlas, ReadonlyMap<string, CommitRecord>>();

/**
 * The commit a subject id names, or null when this atlas no longer holds it.
 *
 * Null is a normal outcome, not an error: the commit window slides with every
 * reindex, so a save earned against last month's atlas can name a commit that
 * has fallen out of it. ADR-0011 decision 3 says a claim the atlas can no longer
 * support is dropped rather than shown stale, and returning null is how that
 * happens here.
 *
 * **Indexed, memoised per atlas — and the comment this replaces was wrong about
 * its own cost.** It claimed to be "called once per note and once per reveal",
 * which is true of the panel and false of `livenessOf`: restoring a save asks
 * `stillHolds` once per *node* per stored pass, so a linear scan here is
 * `O(nodes × commits)` string builds at load — 1.8 M of them for one Placement
 * pass on a svelte-sized repo. Same `WeakMap` shape `indexCoChange` uses, for
 * the same reason.
 */
export function commitOf(atlas: Atlas, subject: SubjectId): CommitRecord | null {
  let index = BY_ID.get(atlas);
  if (index === undefined) {
    const built = new Map<string, CommitRecord>();
    for (const commit of atlas.history.commits) built.set(commitIdFor(commit.sha), commit);
    index = built;
    BY_ID.set(atlas, built);
  }
  return index.get(subject) ?? null;
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
