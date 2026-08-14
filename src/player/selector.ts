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
import { byteCompare, round2 } from '../atlas/index.js';
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
   * `(verb, subject)` keys the player has waved away **this session**.
   *
   * A cold playtester's first three suggestions were the same shape and there
   * was no way past them but to answer one — *"Where next?"* offered exactly one
   * next, so a player who did not want that board had no move. Skipping is the
   * cheapest possible answer to that and it costs nothing: the board stays in
   * the deck, keeps its rank, and comes back the moment the skip list empties.
   *
   * **Session-only, never stored.** ADR-0011 decision 2 is that `Progress` is
   * the record of what the player *knows*, and a skip is a preference about the
   * next ten minutes; persisting it would be a second kind of state in a file
   * whose whole shape is "claims, re-checked against the atlas". It also means
   * a reload is the other way out, which is the honest fallback.
   */
  readonly skipped: ReadonlySet<string>;
  /**
   * How many boards of `previous.verb` have just been **graded** in a row,
   * including `previous`. 0 when nothing has been graded.
   *
   * Graded, not served: the shell maintains this in `onGraded`, so a board that
   * was opened and escaped does not count, and one board retried twice counts
   * as a run of two. That is the right unit — a run is what the player *read*,
   * not what the deck offered — but it is not what "served" says.
   *
   * Feeds `sameVerb`, which breaks a **run** rather than forbidding a repeat —
   * see `rankLess`. The distinction is the whole of why the term is safe.
   */
  readonly verbRun: number;
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
  skipped: new Set(),
  verbRun: 0,
  previous: null,
};

/**
 * The skip list, with the one rule that keeps it from being a lockout.
 *
 * **When every remaining board has been skipped, the list clears.** Otherwise a
 * player who waved away the last unanswered question would be told the deck was
 * finished — the count-of-zero landmine, with a third cause for the same number
 * — and guardrail 6's spirit is that nothing the player does to a board takes it
 * away from them. `remaining` is what is left unanswered; the caller has it.
 */
export function noteSkip(
  skipped: ReadonlySet<string>,
  key: string,
  remaining: readonly string[],
): Set<string> {
  const next = new Set(skipped);
  next.add(key);
  if (remaining.every((candidate) => next.has(candidate))) return new Set();
  return next;
}

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

/**
 * Where each challenge sits in **its own verb's** difficulty range, `0..1`.
 *
 * §8.4's difficulty is `w₁·log(breadth) + w₂·reach + w₃·surprise`, computed from
 * whatever each verb's inputs are — so the numbers are not commensurable across
 * verbs, and comparing them raw is a category error rather than a preference.
 * Measured on four repos, the ranges barely overlap: Blast Radius spans
 * **0.03–0.94** and Companion **0.49–0.91** on hono, so ascending raw difficulty
 * serves *every* Blast Radius board below 0.49 before the first Companion one.
 * A player met the second verb at board **25 on hono, 19 on graphql-js and 17
 * here** — the git-as-rubric thesis is M4's whole point and a first session never
 * reached it.
 *
 * The cost is not only monotony, and this is the part that took measuring. Blast
 * Radius's difficulty is strongly **positively** correlated with how
 * load-bearing its subject is (Spearman **ρ = 0.96 / 0.84 / 0.38 / 0.84** against
 * the count of a node's transitive dependents that themselves have dependents),
 * because `breadth` is a term in both. So its easy end is *by construction* its
 * peripheral end, and the opening was `benchmarks/jsx/src/preact.ts`,
 * `src/middleware/jwk/keys.test.json` and six `src/__testUtils__/*` files.
 * Companion's correlation runs the **other way** (**−0.30 / −0.24 / −0.65 /
 * −0.06**) and its easiest boards are `GraphQLError.ts`, `insert-query-node.ts`
 * and `http-status.ts` — easy questions about landmarks already existed and were
 * simply unreachable.
 *
 * **This is why the obvious fix is refused.** Adding a "prefer a load-bearing
 * subject" term above difficulty was the proposal; measured, it opens graphql-js
 * at difficulty **0.71–0.91**, because that term is a re-encoding of difficulty
 * on the verb that dominates the opening. It is ADR-0039's rejected alternative
 * one layer up: a deck with no easy end, where a cold player's first question is
 * the most connected file in the repository.
 *
 * Ranks are computed from the deck rather than stored, so this stays a property
 * of the atlas the player was given and needs no schema change.
 *
 * **It is a band over ties, and both halves of that are load-bearing.**
 *
 * *A band*, because a bare position is a **total** order on each verb's deck —
 * everything below it in the rank, including `overlapWith`, which this file's
 * second amendment measured into place, becomes unreachable between two
 * challenges of the same verb. The first version of this function did exactly
 * that and silently killed the overlap term.
 *
 * *Over ties*, because the band must be a function of the **difficulty**, not of
 * the sorted index. Banding by index separates two *equally hard* questions
 * purely by the byte order of their ids, which is the opposite of what a
 * progression means and is what the two unit tests that caught the first version
 * are actually about. So a challenge's band is set by how much of its verb's
 * deck is **strictly** easier, which collapses ties by construction — and, being
 * rank-based rather than range-based, it equalises the two verbs' *distributions*
 * rather than just their endpoints. Normalising by `(d − min) / (max − min)`
 * instead was tried and does not interleave: Companion's difficulties are packed
 * against the top of its own range (hono: min 0.49, p25 0.74), so its first band
 * holds three boards where Blast Radius's holds fifteen.
 */
/**
 * Ten, and the number has an objective function rather than a taste behind it —
 * this file's own comment about "a magic number with no objective function"
 * applies to it. Measured on hono `7075369e` and this repo, sweeping the value
 * and reading two quantities: which board the second verb first appears at, and
 * how many served positions the `overlap` term below still decides.
 *
 * | bands | 2nd verb (hono / ark) | overlap reach (hono) |
 * |---|---|---|
 * | 4  | 15 / 10 | 18 of 216 |
 * | **10** | **7 / 5** | **18 of 216** |
 * | 20 | 7 / 5 | 14 of 216 |
 * | 60 | 7 / 2 | 14 of 216 |
 *
 * Four is too coarse to interleave. Past ten the reach of the term underneath
 * drops and stays down. **Ark keeps improving past ten — its second verb reaches
 * board 2 at sixty bands** — so this is a knee on hono and a trade on ark, not a
 * plateau on both; the first draft of this comment said "twenty and sixty buy no
 * further interleave", which the ark column of its own table refutes. Ten is
 * chosen for the column where the term below still fires.
 */
const PROGRESS_BANDS = 10;

function withinVerbRank(deck: readonly Challenge[]): Map<string, number> {
  const byVerb = new Map<string, Challenge[]>();
  for (const challenge of deck) {
    const seen = byVerb.get(challenge.verb);
    if (seen === undefined) byVerb.set(challenge.verb, [challenge]);
    else seen.push(challenge);
  }
  const out = new Map<string, number>();
  for (const [, challenges] of byVerb) {
    const sorted = [...challenges].sort(
      (a, b) => a.difficulty - b.difficulty || byteCompare(a.id, b.id),
    );
    let at = 0;
    while (at < sorted.length) {
      // **Grouped on `round2`, not on raw equality.** Every generator routes
      // difficulty through `round2` today (measured: 0 non-fixed-points across
      // five real atlases), so this changes no shipped band — but the tie
      // contract above would otherwise rest on an invariant nothing states.
      // `validateAtlas` checks difficulty is finite and in 0..1 and no more, so
      // one verb emitting `0.1 + 0.2` beside boards at `0.3` would render as two
      // identical 0.30s in different bands, and every term below `progress` —
      // including the overlap term this banding exists to protect — would go
      // unreachable between them. Rounding here removes the dependency instead
      // of documenting it.
      const difficulty = round2((sorted[at] as Challenge).difficulty);
      let end = at;
      while (end < sorted.length && round2((sorted[end] as Challenge).difficulty) === difficulty) {
        end++;
      }
      // `at` is the number of boards strictly easier than this one, so it is at
      // most `sorted.length - 1` and the band is at most `PROGRESS_BANDS - 1`
      // without a clamp. There was a `Math.min` here and it could never bind —
      // a dead branch whose comment described an impossible case.
      const band = Math.floor((at * PROGRESS_BANDS) / sorted.length);
      for (let i = at; i < end; i++) out.set((sorted[i] as Challenge).id, band);
      at = end;
    }
  }
  return out;
}

/**
 * Paths a first-time player should not be *opened* on.
 *
 * ## This is a list, and a list is the thing this repository distrusts most
 *
 * ADR-0025's landmine: *"a decision not to include something and a failure to
 * think of it look identical in a table"*. That one cost 64 challenges about a
 * Terraform repo's documentation because `.tf` was not on a list. So the bar for
 * putting one in the product is high, and it is cleared here by **what happens
 * when the list is wrong**, not by the list being right.
 *
 * This is consulted **only by the rank**, and only to push a board later. It
 * cannot refuse a board, cannot reach `retain`, cannot change an answer key and
 * cannot change what is drawn. A pattern that is missing costs *one junk board
 * served early* — the defect it exists to reduce, not a new one. A pattern that
 * over-fires costs *one good board served later*, and everything is still served.
 * Both failures are soft, which is the whole argument.
 *
 * ## Why a graph property was tried first, and why it cannot work
 *
 * The proposal this replaces was *"demote a subject with zero non-leaf transitive
 * dependents"* — a pure graph property, no list. It flags **`src/indexer/build.ts`
 * on this repo**: cone of 12, every one of them a script, a test or the CLI, so
 * zero of them has an importer. `tests/fixtures/atlas.ts` has the identical
 * signature (cone 31, zero non-leaf), and so do hono's `src/adapter/vercel/handler.ts`
 * and `keys.test.json`. **An orchestrator consumed by entry points and a fixture
 * consumed by tests are topologically the same thing**, because being near the top
 * of a program is what that shape means. There is no predicate over the import
 * graph that separates them; the distinction lives in a layer the graph does not
 * record. That is `CLAUDE.md`'s entry-point landmine one level up.
 *
 * ## What is a rule and what is a list
 *
 * The extension clause is a **rule** — a manifest or a Markdown file is not a
 * source file, so neither can be a module worth opening on, and neither has a
 * false-positive mode. `testdata` is rule-grade too: the Go toolchain reserves
 * and ignores that directory name. The rest is the list, and it carries the two
 * repos that matter: the rule alone catches 1 of hono's 4 junk openings and 0 of
 * graphql-js's 8.
 *
 * **Two known gaps, stated rather than patched.** graphql-js still opens on
 * `resources/strip-private-declarations.ts`; `resources/`, `docs/`, `site/` and
 * `tools/` are not here because each is a plausible real-source directory
 * elsewhere, and adding them blind is the failure this rule is meant not to
 * repeat. And the list **over-fires on a product module legitimately named
 * `test`** — `django/test/client.py` is `django.test.Client`, and rxjs publishes
 * `@rxjs/test` from `packages/test/src/` — measured across eight repos this is
 * the only false-positive shape it has. Demotion-only is what makes both soft.
 */
const SIDESHOW =
  // The `(__)?` wrappers are the `__tests__` / `__testUtils__` / `__testdata__`
  // convention, and they are a wrapper rather than three more entries because
  // enumerating them is how `__testdata__` got missed while `testdata` was
  // present — a list inside a list, with the same failure mode one level down.
  /(^|\/)(__)?(tests?|testutils?|testdata|fixtures?|benchmarks?|scripts?|examples?)(__)?(\/|$)|\.(test|spec)\.|\.(json|md)$/i;

/**
 * Whether a board is a poor thing to *open* a session on.
 *
 * Verb-blind, and it has to be: `pathOf` answers `null` for a commit subject
 * (ADR-0018), which is not demoted — a commit is not a sideshow, it simply has
 * no path. Nothing here names a verb, which is the seam M4 bought.
 */
export function isSideshow(path: string | null): boolean {
  return path !== null && SIDESHOW.test(path);
}

interface Rank {
  readonly attempts: number;
  readonly sameRegion: number;
  readonly sameVerb: number;
  readonly tier: number;
  readonly progress: number;
  readonly sideshow: number;
  readonly difficulty: number;
  readonly overlap: number;
  readonly id: string;
}

/**
 * How many of one verb in a row is fine.
 *
 * **Two.** At one — forbid any repeat — the term becomes strict alternation, and
 * a unit fixture with only two boards of the second verb showed what that costs:
 * both are spent early, so the hardest board in the deck arrives **fourth**
 * where a cap of two puts it sixth. (Measured through the real selector. This
 * comment said *third* until a review checked it, and the test beside it
 * asserted "not in the first three" — which cap 1 satisfies, so neither the
 * figure nor the assertion was holding the decision up.)
 * That is `sameVerb` overriding ADR-0040's progression, which is the objection
 * this rank was built to answer rather than to create. At two it breaks the runs
 * a playtester actually complained about (3 here, 4 on hono and kysely, **5** on
 * graphql-js) and leaves a natural pair alone.
 */
const RUN_CAP = 2;

function rankLess(a: Rank, b: Rank): boolean {
  // `attempts` outranks the region constraint, and that is load-bearing: below
  // it, the selector will re-serve a question the player has already failed in
  // order to move to a fresh region — spending a *fresh* question to buy variety
  // it could have had for free. A unit test pins that.
  if (a.attempts !== b.attempts) return a.attempts < b.attempts;
  if (a.sameRegion !== b.sameRegion) return a.sameRegion < b.sameRegion;
  // `(tier, …)` rather than bare difficulty because §5's tiers *are* the
  // progression. This was written when every challenge was tier 3, against the
  // day the git verbs landed; they landed, and the term below it was the one
  // that needed the amendment.
  if (a.tier !== b.tier) return a.tier < b.tier;
  // **Break a run of one verb, and only a run.** A cold playtester's first three
  // boards were the same shape and they said so; measured, this repo opened
  // `blastRadius blastRadius blastRadius` and graphql-js opened with a run of
  // **five**. `sameRegion` above has exactly this shape and exactly this reason
  // — vary the tour — and this is the same term over the other axis.
  //
  // **Below `tier`, and the placement was measured at three heights rather than
  // argued.** Above `tier` and here are **indistinguishable on all four repos**
  // (`npx tsx scripts/probe-opening.ts`: longest run 3/4/4/5 → 1/1/1/1 either
  // way, second verb at board 2), so the tie is broken on what happens where
  // they *would* differ: above `tier`, a verb-variety term outranks §5's
  // curriculum and could pull a tier-5 board ahead of a tier-3 one purely to
  // alternate. Below `progress` it is nearly inert where it is most needed —
  // runs of 4 and 5 survive on hono and graphql-js — which is the same shape
  // ADR-0046 measured for `sideshow`.
  //
  // Self-limiting, which is what makes it safe: once one verb's supply is gone
  // every remaining board scores 1 and the term stops discriminating. It cannot
  // refuse a board or shorten the deck.
  if (a.sameVerb !== b.sameVerb) return a.sameVerb < b.sameVerb;
  // **Ascending through each verb's own range, not through a shared number.**
  // See `withinVerbRank`: raw difficulties are not comparable across verbs, and
  // ranking on them served every one of hono's Blast Radius boards below 0.49
  // before its first Companion board. Raw difficulty stays directly underneath,
  // so among challenges at the same relative position the genuinely easier one
  // wins — which is what makes the two tier-3 verbs alternate rather than
  // arriving in blocks.
  // **Above `progress`, and the argument for putting it below was refuted by
  // measuring it.** That argument was that a term this high flattens the
  // progression — every real subject before any sideshow one, whatever the
  // difficulty — and so undoes ADR-0040's interleave. Measured through
  // `scripts/probe-opening.ts` on four repos, at three placements, it is
  // backwards in both halves. Below `progress` the term is nearly inert where it
  // is most needed, because it can only reorder *within* a band and Blast
  // Radius's band 0 is **entirely** sideshow on graphql-js: test-pathed boards in
  // the first fifteen go 8 → 8 there and 4 → 4 on hono. Above it they go to
  // **0 on all four repos**. And the interleave it was supposed to protect gets
  // *better*, not worse — the second verb arrives at board 2 rather than 6 on
  // hono, 3 rather than 7 on kysely, 2 rather than 8 on graphql-js — because the
  // boards being demoted were the ones crowding it out.
  if (a.sideshow !== b.sideshow) return a.sideshow < b.sideshow;
  if (a.progress !== b.progress) return a.progress < b.progress;
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
   * The subject's path, or `null` where it has none — a commit, or a node the
   * atlas no longer holds. Optional so a caller that does not care about the
   * opening (tests, and anything scoring a rank in isolation) is unchanged; the
   * shell passes it. Absent, `sideshow` is 0 for everything and the rank is
   * exactly what it was.
   */
  pathOf: (subject: AtlasId) => string | null = () => null,
): Challenge | null {
  // Null means "this subject is not anywhere on the map" — a commit (ADR-0018),
  // or a node the atlas no longer holds. The region constraint then simply does
  // not apply, rather than two placeless subjects counting as neighbours: a
  // shared *absence* of region is not the same-neighbourhood signal this rank
  // term exists to penalise.
  const previousRegion = state.previous === null ? null : regionOf(state.previous.subject);
  // Over the *whole* deck, not the unanswered remainder: a challenge's place in
  // its verb's difficulty range is a property of the repository, and recomputing
  // it over what is left would make the progression re-scale as the player
  // clears boards — the tenth question would rank as the easiest remaining.
  const progressOf = withinVerbRank(deck);

  let best: Challenge | null = null;
  let bestRank: Rank | null = null;
  for (const challenge of deck) {
    const key = answerKey(challenge.verb, challenge.subject);
    if (state.answered.has(key)) continue;
    if (state.skipped.has(key)) continue;
    const rank: Rank = {
      attempts: state.attempts.get(key) ?? 0,
      sameRegion: previousRegion !== null && regionOf(challenge.subject) === previousRegion ? 1 : 0,
      sameVerb:
        state.previous !== null && challenge.verb === state.previous.verb && state.verbRun >= RUN_CAP
          ? 1
          : 0,
      tier: challenge.tier,
      progress: progressOf.get(challenge.id) ?? 0,
      sideshow: isSideshow(pathOf(challenge.subject)) ? 1 : 0,
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
