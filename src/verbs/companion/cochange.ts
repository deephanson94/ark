/**
 * The co-change matrix, read as evidence — and the bar at which it is safe to
 * ask a question about it.
 *
 * NORTH-STAR §2: *"Co-change coupling knows which files always move together,
 * and therefore which ones are secretly one module wearing two hats."* That is
 * the fact this verb is built on. This module is where it is turned from a
 * truncated array into something guardrail 4 will allow near an answer key.
 *
 * ## The problem: absence is not evidence of absence
 *
 * `atlas.history.coChange` is lossy in three separate ways, all of them in
 * `src/indexer/history.ts`:
 *
 *   minCoChangeCount   pairs seen fewer than this many times are dropped as
 *                      noise (default 2).
 *   wideCommitFiles    a commit touching more than this many indexed files is
 *                      excluded from counting at all, because a vendoring
 *                      commit couples every file to every other file — true and
 *                      useless.
 *   maxCoChangePairs   the matrix is capped (default 8,000), sorted by count
 *                      descending.
 *
 * So *"this pair is not in the matrix"* does **not** mean *"these files never
 * changed together"*. A verb that treated absence as zero would put a genuine
 * companion on the board as a wrong answer, which is a wrong answer key — the
 * one failure guardrail 4 exists to prevent, and the one that destroys trust
 * permanently.
 *
 * ## The fix: ask above the highest count a dropped pair could have
 *
 * The cap is applied to a list sorted by count descending. So if it bit, every
 * pair that fell off the end has a count no greater than the *last kept* pair's
 * count. And if it did not bite, every absent pair is below `minCoChangeCount`.
 * Either way there is a provable ceiling on what absence can hide:
 *
 *     ceiling = capBit ? count(last kept pair) : minCoChangeCount - 1
 *     floor   = ceiling + 1
 *
 * At that bar, two things hold at once and both are needed:
 *
 *  - **No missing truth.** Every pair at or above `floor` has a count strictly
 *    greater than `ceiling`, and sorting by count descending puts all of those
 *    before the cut. So they are all still in the matrix.
 *  - **No false distractor.** Every pair absent from the matrix has a count at
 *    or below `ceiling`, hence below `floor`. So it is a correct exclusion.
 *
 * `floor` is the bar a companion must clear to be *askable*. It is not the bar
 * the player is graded at — that one is measured per challenge and is usually
 * far higher (see `generate.ts`).
 *
 * The bar is therefore *derived from what this atlas can prove*, never chosen —
 * which is the difference between a threshold and a magic number. On a big repo
 * where the cap bites it rises automatically, and the question gets harder
 * because the evidence got thinner. See ADR-0014.
 *
 * **What it does not fix, stated rather than hidden.** The `wide` exclusion is
 * not a truncation, it is part of the *definition* of the quantity: these counts
 * are co-changes in focused commits. That is a defensible definition — a
 * repo-wide reformat is not evidence that two files are coupled — but it is a
 * definition the player has to be told, which is why `promptFor` says so.
 */

import type { Atlas, NodeRef } from '../../atlas/index.js';

/** One subject's row of the matrix: partner → commits changed together. */
export type CoChangeRow = ReadonlyMap<NodeRef, number>;

export interface CoChangeIndex {
  /** Every node with at least one partner in the matrix. Empty rows are absent. */
  readonly rows: ReadonlyMap<NodeRef, CoChangeRow>;
  /**
   * True when the indexer did **not** reach the end of the repo's history —
   * `maxCommitsWalked` stopped it short.
   *
   * This is a **fourth** loss channel, and the first draft of this file missed
   * it: the ceiling argument below reasons about pairs the *matrix* dropped and
   * says nothing about commits the *walk* never read. A pair coupled only in
   * older history is absent for a reason no bound covers, so it would be
   * offered as a certified exclusion when it is a genuine companion — precisely
   * the wrong answer key guardrail 4 exists to prevent.
   *
   * **Two ways the walk can fall short, and only one is a count.**
   *
   *  - `maxCommitsWalked` stopped it: `commitsWalked` is less than the repo's
   *    total. Fires on none of ark, hono or svelte (36, 2,758 and 11,285
   *    commits against a 20,000 ceiling); it would fire on TypeScript.
   *  - **The clone is shallow.** `totalCommits` comes from
   *    `git rev-list --count HEAD`, which on a `--depth` clone counts only what
   *    is *present* — so the comparison sees nothing wrong while history is cut
   *    at the graft boundary. Caught by `repo.root`, which ADR-0011 already
   *    makes null in exactly that case. Not a corner case: `git.ts` records
   *    that both large repos an earlier session measured were `--depth` clones.
   *
   * Either way there is no bound to derive, so the verb refuses the repo. A
   * missing deck costs nothing and a wrong answer key costs trust permanently.
   */
  readonly walkTruncated: boolean;
  /**
   * The weakest coupling this atlas can still certify an *exclusion* against.
   * See the header — this is the whole guardrail-4 argument, and it is one
   * number.
   */
  readonly floor: number;
  /** The highest count anywhere in the matrix. */
  readonly maxCount: number;
  /** `History.wideLimit`, carried through so the challenge can state it. */
  readonly wideLimit: number;
  /**
   * True when `floor` had to rise above `minCoChangeCount` because the pair
   * cap bit. Reported by the CLI rather than inferred, because a session
   * reading the derivation above will otherwise assume the raised branch is
   * exercised somewhere — and on ark, `honojs/hono` and `sveltejs/svelte` it is
   * not. See the ADR: it is a correctness bound, not a fallback path.
   */
  readonly capBit: boolean;
}

/**
 * `minCoChangeCount` from `src/indexer/history.ts`, which the atlas does not
 * carry.
 *
 * Duplicating a default across the wall is a real smell, so here is why it is
 * the lesser evil: the alternative is a new atlas field carrying a constant that
 * has never moved, on a shape guardrail 5 makes expensive to change.
 *
 * **Only one direction is safe, and an earlier version of this comment had it
 * backwards.** Lowering the indexer's floor is fine — pairs with a count of 1
 * enter the matrix and the derivation below proves their counts directly.
 * *Raising* it is not: with an indexer floor of 5 and this constant at 2, absent
 * pairs can hold counts of 2 to 4, `evidence.atMost` would claim 1, and the
 * middle-band trap ADR-0014 exists to ban comes straight back. The ADR states
 * the rule correctly — assume a floor **no lower** than the real one — and the
 * comment here used to say the opposite, which is worse than saying nothing,
 * because it addresses exactly the session that would change it.
 *
 * `tests/unit/companion.test.ts` pins the two equal. A test may reach across the
 * wall; production may not.
 */
export const ASSUMED_MIN_CO_CHANGE = 2;

/**
 * Memoised per atlas, because `stillHolds` is called once per stored claim when
 * a save is restored and rebuilding a 5,018-pair matrix each time turns an O(1)
 * lookup into an O(pairs) scan. Keyed weakly so a discarded atlas is collected.
 */
const CACHE = new WeakMap<Atlas, CoChangeIndex>();

export function indexCoChange(atlas: Atlas): CoChangeIndex {
  const cached = CACHE.get(atlas);
  if (cached !== undefined) return cached;
  const built = buildIndex(atlas);
  CACHE.set(atlas, built);
  return built;
}

function buildIndex(atlas: Atlas): CoChangeIndex {
  const rows = new Map<NodeRef, Map<NodeRef, number>>();
  const add = (from: NodeRef, to: NodeRef, count: number): void => {
    const row = rows.get(from);
    if (row === undefined) rows.set(from, new Map([[to, count]]));
    else row.set(to, count);
  };

  let maxCount = 0;
  for (const [a, b, count] of atlas.history.coChange) {
    add(a, b, count);
    add(b, a, count);
    if (count > maxCount) maxCount = count;
  }

  const capBit = atlas.report.truncations.some((entry) => entry.what === 'coChange');
  // The array is sorted count-descending (the atlas contract, enforced by
  // `coChangeOrder`), so the last entry carries the smallest retained count —
  // which is the ceiling on everything the cap threw away.
  const last = atlas.history.coChange.at(-1);
  const ceiling = capBit && last !== undefined ? last[2] : ASSUMED_MIN_CO_CHANGE - 1;

  // Total commits reachable from HEAD is recoverable exactly: the `commits`
  // truncation records what retention dropped against that total, so
  // `kept + dropped` is the total and `commitsWalked` is what we actually read.
  // With no truncation entry, retention kept everything it walked.
  const retention = atlas.report.truncations.find((entry) => entry.what === 'commits');
  const totalCommits =
    retention === undefined
      ? atlas.history.commitsRetained
      : retention.kept + retention.dropped;

  return {
    rows,
    floor: ceiling + 1,
    maxCount,
    wideLimit: atlas.history.wideLimit,
    capBit,
    // `root === null` with history present means a shallow clone — or a root we
    // could not read, which falls on the refusing side, the direction guardrail
    // 4 wants.
    walkTruncated:
      atlas.history.commitsWalked < totalCommits ||
      (atlas.history.present && atlas.repo.root === null),
  };
}

/**
 * The subject's companions at or above the bar, best first.
 *
 * Ordered by **count descending** — NORTH-STAR §6.2 words this verb *"which
 * file changes with this one most often"*, so the strongest coupling leads —
 * then by how *discriminating* the partner is, then by id.
 *
 * The tie-break is the lesson learned in `blastRadius/generate.ts`, where
 * ranking a hub's dependents by in-degree produced seven groups of subjects
 * with byte-identical answer keys. The analogue here is a file that changes
 * with everything: on this repo `CHANGELOG.md` has 37 partners and is nobody's
 * *specific* companion, so between two partners tied on count the one with
 * fewer partners of its own says something about this subject rather than about
 * the repo's tempo. It is a tie-break rather than the primary key because
 * demoting a genuinely strong pair for being popular would answer a different
 * question than the one the prompt asks.
 */
export function rankCompanions(
  index: CoChangeIndex,
  subject: NodeRef,
  idOf: (ref: NodeRef) => string,
): NodeRef[] {
  const row = index.rows.get(subject);
  if (row === undefined) return [];
  const strong: NodeRef[] = [];
  for (const [partner, count] of row) if (count >= index.floor) strong.push(partner);
  return strong.sort(
    (a, b) =>
      (row.get(b) ?? 0) - (row.get(a) ?? 0) ||
      (index.rows.get(a)?.size ?? 0) - (index.rows.get(b)?.size ?? 0) ||
      (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0),
  );
}
