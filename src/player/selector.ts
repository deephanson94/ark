/**
 * Which question to offer next.
 *
 * ADR-0011 decision 4 fixes the rule, and this is its **second amendment**: the
 * rank is a single ascending minimum over
 * `(attempts, sameRegion, tier, difficulty, overlap, id)`.
 *
 * The original rule's first constraint — skip a challenge whose `truth` is
 * byte-equal to the one just served — is **gone, because the generator now makes
 * it impossible**. `dedupe()` refuses to issue an answer key twice, so a flag
 * testing for that could never fire again. Keeping a symptom fix alive after its
 * cause is removed is the never-executing path `CLAUDE.md` warns about; the ADR
 * records the reasoning and the numbers. What replaces it is not the same
 * constraint relaxed but a different, continuous one — see `overlapWith` — and
 * it sits *below* difficulty, which the measurements forced.
 *
 * The region constraint is untouched, and it buys the tour: §4's loop is "pick
 * the next landmark", which should mean movement across the map.
 *
 * **Suggested-next is an affordance, not a mode.** Clicking a disc stays the
 * primary path; this feeds the same state. Otherwise M3 quietly turns a
 * cartography game into a quiz deck, which nothing in the spec licenses.
 *
 * ## Why one lexicographic key instead of ordered scans with fallbacks
 *
 * The ADR describes the rule as a scan that relaxes: try both constraints, then
 * drop one, then the other. Written that way it is several loops, most of them
 * fallbacks — and the landmine about machinery that never fires applies
 * directly. Measured on this repo and on vite, the "drop the truth constraint"
 * loop **never executed** under any player model. As one total ranking there are
 * no fallback branches to leave untaken, and it cannot fail to serve something.
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

import type { Challenge, AtlasId } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import { answerKey } from './progress.js';

export interface SelectorState {
  /**
   * `(verb, subject)` keys with a surviving pass. **Pass `answeredKeys()`'s
   * result — the same set the HUD counter and the map's question rings read.**
   * If the selector derived its own notion of "answered", the three could
   * disagree, and "3 questions left" beside a button that offers a fourth is
   * risk #4 verbatim.
   *
   * Keyed per verb since M4. Held as subjects, a Companion pass retired the
   * Blast Radius question about the same file: measured on this repo, a
   * full playthrough served **60 of 71 questions** and called the deck finished.
   */
  readonly answered: ReadonlySet<string>;
  /**
   * How many times each `(verb, subject)` has been served and not passed, this
   * session.
   *
   * Keyed like `answered`, and for the same reason: held as subjects, failing
   * the Blast Radius question about a file made the *Companion* question about
   * it look already-tried, so an all-failing player stopped cycling evenly and
   * one half of every doubled subject was served twice as often as the other.
   */
  readonly attempts: ReadonlyMap<string, number>;
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
 * How much of the previous answer key this one repeats, 0..1.
 *
 * This replaced a `sameTruth` byte-equality flag, and the reason is the whole
 * story of this rung. That flag guarded against two challenges whose `truth`
 * sets were *identical* — which the generator now refuses to emit at all
 * (`dedupe()`), so the flag became a branch that can no longer be taken. A
 * downstream mitigation for a defect that has been fixed upstream is exactly the
 * never-executing path `CLAUDE.md` warns about, and keeping it would also have
 * left the *measured* residual unaddressed: after dedupe, this repo still serves
 * consecutive questions sharing half their answer key.
 *
 * The old comment here argued a Jaccard cutoff would be "a magic number with no
 * objective function" and deferred it until repetition at a window of one was
 * measured as still felt. Both halves of that have now happened. It is measured
 * (mean served overlap 0.115 on this repo, 0.129 on svelte), and there is **no
 * cutoff**: overlap enters the rank as a continuous quantity, so nothing has to
 * decide how much sharing is too much. Byte-identical keys score 1.0 and remain
 * the worst possible pick, which is the old flag's behaviour as a limiting case.
 *
 * Correct as a set comparison **only because `truth` is sorted and unique**,
 * which the atlas contract requires and `validateAtlas` enforces.
 */
function overlapWith(previous: Challenge | null, challenge: Challenge): number {
  if (previous === null) return 0;
  const before = new Set(previous.truth);
  let shared = 0;
  for (const id of challenge.truth) if (before.has(id)) shared++;
  const union = before.size + challenge.truth.length - shared;
  return union === 0 ? 0 : shared / union;
}

interface Rank {
  readonly attempts: number;
  readonly sameRegion: number;
  readonly tier: number;
  /**
   * 1 when the board's answer key is exactly what the map already draws.
   *
   * **The tour used to open with nothing else.** Hovering a node paints gold
   * lines to every direct importer (ADR-0008 decision 1, deliberately), and a
   * board whose truth *is* that set is answerable by pointing. Measured: such
   * boards are **10% of graphql-js's, 8% of kysely's, 24% of hono's and 13% of
   * ark's** — and **every one of them is among the ten easiest**, so ascending
   * difficulty served a newcomer's whole first session from exactly that set. A
   * cold playtester found it and called it the thing that decides whether the
   * first twenty minutes teach you the graph or teach you to point at it.
   *
   * They are not broken questions — `gate.ts` declines to refuse this guess for a
   * stated reason, that §8.4 already prices it and the progression needs easy
   * rungs — so the fix is the **order**, not the deck. Ranked above difficulty
   * and below tier: within a tier, a board that teaches something the map is not
   * already showing comes first, and these stay reachable by clicking the node
   * and by the guide once the rest are done.
   */
  readonly naive: number;
  readonly difficulty: number;
  readonly overlap: number;
  readonly id: string;
}

function rankLess(a: Rank, b: Rank): boolean {
  // `attempts` outranks the region constraint, and that is load-bearing: below
  // it, the selector will re-serve a question the player has already failed in
  // order to move to a fresh region — spending a *fresh* question to buy variety
  // it could have had for free. A unit test pins that.
  if (a.attempts !== b.attempts) return a.attempts < b.attempts;
  if (a.sameRegion !== b.sameRegion) return a.sameRegion < b.sameRegion;
  // `(tier, difficulty)` rather than bare difficulty because §5's tiers *are*
  // the progression. Every challenge is tier 3 today, so this reduces to
  // ascending difficulty — writing it now stops an M4 session re-deriving the
  // ordering when the git verbs land.
  if (a.tier !== b.tier) return a.tier < b.tier;
  // Above difficulty on purpose — see `Rank.naive`. Below it, the naive boards
  // *are* the low-difficulty ones and the opening run is unchanged.
  if (a.naive !== b.naive) return a.naive < b.naive;
  if (a.difficulty !== b.difficulty) return a.difficulty < b.difficulty;
  // **Below difficulty, and that placement was measured rather than argued.**
  // Ranked above it, a continuous overlap swamps the progression: it always
  // picks the furthest question away, and the served difficulty falls as often
  // as it rises — 39 descending steps in 152 on svelte against 4, and 15 in 38
  // here against 7. §5's tiers are the curriculum, so a tour that ignores them
  // is not an improvement. Ranked here it costs the progression nothing (the
  // descending-step counts are unchanged) and still fires, because `difficulty`
  // is rounded to two decimals and ties constantly: it changed the pick 41 times
  // in 153 on svelte, 3 in 122 on vite and 2 in 39 here, cutting mean served
  // overlap on svelte from 0.129 to 0.083 and consecutive half-shared keys from
  // 16 to 6.
  if (a.overlap !== b.overlap) return a.overlap < b.overlap;
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
  regionOf: (subject: AtlasId) => string | null,
  state: SelectorState,
  /**
   * Ids of boards the map already answers — see `Rank.naive`. A set rather than
   * a predicate over the graph, because deciding it is a *graph* question and
   * this module is pure over the deck; the shell computes it once at load.
   */
  answeredByTheMap: ReadonlySet<string> = new Set(),
): Challenge | null {
  // Null means "this subject is not anywhere on the map" — a commit (ADR-0018),
  // or a node the atlas no longer holds. The region constraint then simply does
  // not apply, rather than two placeless subjects counting as neighbours: a
  // shared *absence* of region is not the same-neighbourhood signal this rank
  // term exists to penalise.
  const previousRegion = state.previous === null ? null : regionOf(state.previous.subject);

  let best: Challenge | null = null;
  let bestRank: Rank | null = null;
  for (const challenge of deck) {
    if (state.answered.has(answerKey(challenge.verb, challenge.subject))) continue;
    const rank: Rank = {
      attempts: state.attempts.get(answerKey(challenge.verb, challenge.subject)) ?? 0,
      sameRegion: previousRegion !== null && regionOf(challenge.subject) === previousRegion ? 1 : 0,
      tier: challenge.tier,
      naive: answeredByTheMap.has(challenge.id) ? 1 : 0,
      difficulty: challenge.difficulty,
      overlap: overlapWith(state.previous, challenge),
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
  attempts: ReadonlyMap<string, number>,
  key: string,
): Map<string, number> {
  const next = new Map(attempts);
  next.set(key, (next.get(key) ?? 0) + 1);
  return next;
}
