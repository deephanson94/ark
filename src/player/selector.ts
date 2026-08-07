/**
 * Which question to offer next.
 *
 * ADR-0011 decision 4 fixes the rule and the measurements behind it: ascending
 * `(tier, difficulty, id)`, skipping a challenge whose `truth` is byte-equal to
 * the previously served one's, then one whose subject shares the previous
 * subject's region. The first constraint fixes a measured defect — identical
 * answer keys share a difficulty *by construction*, because difficulty is a
 * pure function of the cone, so any ascending sort places them adjacent. The
 * second buys the tour: §4's loop is "pick the next landmark", which should
 * mean movement across the map.
 *
 * **Suggested-next is an affordance, not a mode.** Clicking a disc stays the
 * primary path; this feeds the same state. Otherwise M3 quietly turns a
 * cartography game into a quiz deck, which nothing in the spec licenses.
 *
 * ## Why one lexicographic key instead of four ordered scans
 *
 * The ADR describes the rule as a scan that relaxes: try both constraints, drop
 * the region one, then drop the truth one. Written that way it is four loops,
 * three of them fallbacks — and the landmine about machinery that never fires
 * applies directly. Measured on this repo and on vite, the "drop the truth
 * constraint" loop **never executed**, under any player model, until the
 * attempted set was folded in.
 *
 * So the rule is expressed as a single minimum over
 * `(attempts, sameTruth, sameRegion, tier, difficulty, id)`. That is provably
 * the same function for the attempts-0 case — minimising `(sameTruth,
 * sameRegion, base…)` yields the first base-order candidate satisfying both when
 * one exists, the first satisfying the truth constraint when none does, and the
 * first overall otherwise — but it has no fallback branches to leave untaken,
 * and it cannot fail to serve something.
 *
 * ## Why `attempts` is the outermost key
 *
 * Only *passed* challenges leave the unanswered set, so "first unanswered"
 * re-serves a failed question forever, hammering a stuck player. Guardrail 6
 * forbids punishing a wrong answer; it does not forbid remembering one happened.
 * Ranking by attempt count — fewest first — means that after failing Q you are
 * offered the rest of the deck before Q comes back, and an always-failing player
 * cycles instead of being handed the same board 80 times, which is what a
 * hard "skip anything attempted" filter measured.
 *
 * Attempts are **session-scoped and never persisted**: ADR-0011 decision 2 says
 * a cursor is not stored, and a position in the rotation is a cursor.
 *
 * A least-recently-attempted rotation was the reviewed alternative and was
 * measured worse. It drops both constraints once every question has been tried,
 * on the argument that tour variety over a pool you have already seen protects
 * nothing — but on a half-failing player that produced 4 consecutive identical
 * keys on this repo and 3 on vite, against 1 for the rank above, and left the
 * truth-constraint relaxation firing zero times on both. Being handed the same
 * answer key twice running does not stop being the defect because you failed it.
 *
 * ## What runs hot on which repo
 *
 * On a repo whose graph forms a single region, the region constraint is
 * permanently unsatisfiable and every suggestion carries `sameRegion = 1`. That
 * is the design working, not a defect — but a future measurement session
 * reading a hot region counter should know it means "one region", not "bug".
 */

import type { Challenge, NodeId } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';

export interface SelectorState {
  /**
   * Subjects with a surviving pass. **Pass `answeredSubjects()`'s result — the
   * same set the HUD counter and the map's question rings read.** If the
   * selector derived its own notion of "answered", the three could disagree,
   * and "3 questions left" beside a button that offers a fourth is risk #4
   * verbatim.
   */
  readonly answered: ReadonlySet<NodeId>;
  /** How many times each subject has been served and not passed, this session. */
  readonly attempts: ReadonlyMap<NodeId, number>;
  /**
   * The last challenge the player was **graded** on, by either path — the
   * suggestion or a map click.
   *
   * Both, because the constraints never restrict the player's own choice; they
   * only shape what the button offers next, and a byte-identical answer key is
   * felt the same however the previous question arrived. Graded rather than
   * merely opened, because a challenge peeked at and escaped should not redirect
   * the tour.
   */
  readonly previous: Challenge | null;
}

export const NO_HISTORY: SelectorState = {
  answered: new Set(),
  attempts: new Map(),
  previous: null,
};

/**
 * Two answer keys are the same question wearing two subjects when their truth
 * sets are equal.
 *
 * Joining is a faithful set comparison **only because `truth` is sorted**, which
 * the atlas contract requires and `validateAtlas` enforces. If that ever
 * relaxed, this would silently become an order-sensitive comparison and the
 * constraint would stop firing — so the dependency is stated rather than
 * assumed. `NodeId` is `n:` + hex, so no id can contain the separator.
 *
 * Byte-equality needs no threshold, which is the point: a Jaccard cutoff or a
 * longer look-back window would be a magic number with no objective function —
 * the class of patch `CLAUDE.md`'s landmines warn about. It does not get added
 * until repetition at a window of one is *measured* as still felt.
 */
function truthKey(challenge: Challenge): string {
  return challenge.truth.join('\n');
}

interface Rank {
  readonly attempts: number;
  readonly sameTruth: number;
  readonly sameRegion: number;
  readonly tier: number;
  readonly difficulty: number;
  readonly id: string;
}

function rankLess(a: Rank, b: Rank): boolean {
  // `attempts` outranks both constraints, and that is load-bearing: below them,
  // the selector will re-serve a question the player has already failed in order
  // to move to a fresh region — spending a *fresh* question to buy variety it
  // could have had for free. A unit test pins that.
  //
  // Its order relative to `sameTruth` alone, however, is **measured to change
  // nothing**: swapping just those two produced 0 divergent choices across full
  // playthroughs of this repo and of vite at two failure rates. So there is no
  // test for it, deliberately — a test asserting a distinction the product never
  // exhibits is the same mistake as a fallback that never fires, and it would
  // freeze an arbitrary choice as if it were a decision.
  if (a.attempts !== b.attempts) return a.attempts < b.attempts;
  if (a.sameTruth !== b.sameTruth) return a.sameTruth < b.sameTruth;
  if (a.sameRegion !== b.sameRegion) return a.sameRegion < b.sameRegion;
  // `(tier, difficulty)` rather than bare difficulty because §5's tiers *are*
  // the progression. Every challenge is tier 3 today, so this reduces to
  // ascending difficulty — writing it now stops an M4 session re-deriving the
  // ordering when the git verbs land.
  if (a.tier !== b.tier) return a.tier < b.tier;
  if (a.difficulty !== b.difficulty) return a.difficulty < b.difficulty;
  return byteCompare(a.id, b.id) < 0;
}

/**
 * The next question to offer, or null when every one has been passed.
 *
 * Null is the only case that serves nothing, and it means the deck is finished
 * rather than that the selector gave up. Order of `deck` does not matter: the
 * base order is part of the rank, so there is no precondition a caller can
 * silently violate.
 */
export function suggestNext(
  deck: readonly Challenge[],
  regionOf: (subject: NodeId) => string,
  state: SelectorState,
): Challenge | null {
  const previousTruth = state.previous === null ? null : truthKey(state.previous);
  const previousRegion = state.previous === null ? null : regionOf(state.previous.subject);

  let best: Challenge | null = null;
  let bestRank: Rank | null = null;
  for (const challenge of deck) {
    if (state.answered.has(challenge.subject)) continue;
    const rank: Rank = {
      attempts: state.attempts.get(challenge.subject) ?? 0,
      sameTruth: previousTruth !== null && truthKey(challenge) === previousTruth ? 1 : 0,
      sameRegion: previousRegion !== null && regionOf(challenge.subject) === previousRegion ? 1 : 0,
      tier: challenge.tier,
      difficulty: challenge.difficulty,
      id: challenge.id,
    };
    if (bestRank === null || rankLess(rank, bestRank)) {
      best = challenge;
      bestRank = rank;
    }
  }
  return best;
}

/** Record that a challenge was served and not passed. Session-scoped. */
export function noteAttempt(
  attempts: ReadonlyMap<NodeId, number>,
  subject: NodeId,
): Map<NodeId, number> {
  const next = new Map(attempts);
  next.set(subject, (next.get(subject) ?? 0) + 1);
  return next;
}
