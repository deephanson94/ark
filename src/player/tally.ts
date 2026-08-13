/**
 * How often each board was answered — `docs/experiments/0001` §9's second piece
 * of harness, and M2's missing datum.
 *
 * §3 pre-registers two measures and the table says both are instrumented. One is
 * not: **M2 is "challenges attempted within the fixed 20 minutes"** and nothing
 * persists a count of attempts, so the engagement half of S1 cannot be read off a
 * finished session. This is that count.
 *
 * ## What §3 says exists, and what actually did
 *
 * That paragraph says *"`noteAttempt` keeps attempt counts in `selector.ts`'s
 * session state"*, which credits the code with more than it has. `main.ts`
 * increments that map **only when the grade did not pass**:
 *
 *     attempts: progression.unlocked ? selector.attempts : noteAttempt(…)
 *
 * so `selector.attempts` is a count of **failures**, and `selector.ts`'s own
 * docstring for it says so in as many words (*"served and not passed"*). The
 * datum M2 asks for did not exist even in session state — persistence was the
 * second problem, not the first. A board answered correctly first time is an
 * attempt, and under the old field it was invisible.
 *
 * ## Why this is not the cursor ADR-0011 forbids
 *
 * ADR-0011 decision 2: *"Nothing region-derived is ever persisted, and neither is
 * a cursor … position in the progression is recomputed from the answered set on
 * every load."* `selector.ts` reads that as covering attempts, because `attempts`
 * is the **outermost** key of its rank and a stored one would decide what a
 * restored session opens with.
 *
 * That reasoning is right and it is about a **read**. This record is never read
 * by the game: `suggestNext` takes a `SelectorState`, `SelectorState` has no
 * field derived from here, and nothing in `selector.ts` imports this module —
 * `tests/unit/tally.test.ts` asserts that against the source text, so wiring it
 * in later goes red rather than quietly turning an instrument into a cursor.
 * Position in the progression is still recomputed from the answered set on every
 * load, exactly as the ADR requires. What is stored is a measurement of what
 * already happened, which no reload can make untrue.
 *
 * ## Why it is not in `Progress`
 *
 * Because everything in `Progress` **decays** and this must not. ADR-0011
 * decision 3 re-checks every stored claim against the live graph before it
 * renders as knowledge, since a claim about today can stop holding. An attempt is
 * not a claim about today — it is an event, and no reindex can make it not have
 * happened. Putting a never-decaying thing inside the record whose whole
 * discipline is *"re-check before you render"* invites the next session either to
 * apply the decay rule to it or to forget it exists.
 *
 * A separate key also means `SAVE_VERSION` does not move, and a bump discards
 * every existing save outright (`parseProgress` returns `EMPTY_PROGRESS` on a
 * version mismatch). The repo is public and deployed (ADR-0031), so "there is no
 * installed base" is no longer a sentence anyone can write.
 *
 * ## Why nothing is written outside an arm
 *
 * `main.ts` writes this only when `?arm=` locked the session, which is
 * `experiment.ts`'s own rule — *"absent or unrecognised means today's player,
 * unchanged"*, and the deployed page has no query string. So the ordinary player
 * stores nothing at all and ADR-0011 decision 2 has no surface to be argued
 * about: there is no record, rather than a record nobody reads. The instrument
 * exists for the twenty minutes it is measuring and at no other time.
 *
 * ## Why the player never sees it, and why there is a readout anyway
 *
 * Showing a participant their own pre-registered measure changes the thing being
 * measured, and it is what keeps guardrail 6 untouched: a wrong answer costs
 * nothing because nothing the player can see reads this. But a record with no way
 * to read it is not an instrument — §9 offered *"a counter in the save, or a
 * facilitator's tally"* and the option that beats both is a **readout**, since the
 * count already existed in memory and what M2 lacked was any way to get it out of
 * a finished session. So `summarise` is typed and tested here, and `main.ts`
 * exposes it as `arkTally()` in an arm only. The facilitator calls it once, at
 * minute 20; `docs/experiments/0001` §9 names it.
 *
 * ## Two things this deliberately does not try to be
 *
 * It is **not windowed**. M2 says *"within the fixed 20 minutes"* and this carries
 * no clock, so the reading is a total for the key. That is sound only because §4
 * fixes one participant to one repo they have never seen, so the record is empty
 * at minute 0 **by construction** — a property of the protocol, not of the datum,
 * and it is written down here because the next use may not have it.
 *
 * And it is **not `SelectorState.attempts` persisted**. The shapes are
 * deliberately incompatible — a sorted array of rows against a
 * `ReadonlyMap<string, number>` — so feeding this to `suggestNext` is a rewrite
 * rather than a one-word edit. That is the enforcement a comment cannot give.
 */

import type { AtlasId, RepoMeta, VerbId } from '../atlas/index.js';
import { VERB_IDS, byteCompare, isCommitId, isNodeId } from '../atlas/index.js';

/** Bumped when the stored shape changes. Independent of `SAVE_VERSION`. */
export const TALLY_VERSION = 1;

export interface TallyEntry {
  readonly verb: VerbId;
  /**
   * A node id, or a commit id for a verb that asks about an event.
   *
   * **Both arms, and nothing here checks which** — `AtlasId` is a string alias,
   * so a filter narrowed to `isNodeId` would compile, drop every Placement row
   * at parse, and erase it on the next write. That is the failure `save.ts`
   * records three times in one file, and it is the reason this comment exists
   * rather than the reason it is a bug: 25% of ark's deck and 77% of django's
   * has a commit subject.
   */
  readonly subject: AtlasId;
  /**
   * Every graded submission on this board, passing or not.
   *
   * **Named `graded` and never `attempts`, deliberately.** `SelectorState.attempts`
   * already exists, is a different population — it counts only the boards that did
   * **not** pass — and is load-bearing for the rotation exactly as it is. Two
   * fields called `attempts` holding two populations is this repo's class-label
   * landmine arriving in a schema, and it is how §3 of the experiment came to
   * describe a failure tally as *"attempt counts"* in the first place.
   *
   * Summed over entries this is M2's *"challenges attempted"*.
   */
  readonly graded: number;
  /**
   * Which attempt first reached the pass threshold, or `0` for never.
   *
   * Carried because a bare count cannot separate *"tried once, got it"* from
   * *"tried once, gave up"*, and those are opposite engagement readings. It is
   * also the number that prices a first-attempt rule: the fraction of boards a
   * player passes on their **second** try is `passedOn ≥ 2`, and if that fraction
   * is large then a rule which spends the first attempt is expensive.
   */
  readonly passedOn: number;
}

export interface Tally {
  readonly version: number;
  /** Sorted by `(verb, subject)`. */
  readonly entries: readonly TallyEntry[];
}

export const EMPTY_TALLY: Tally = { version: TALLY_VERSION, entries: [] };

/**
 * Where this repo's tally lives — beside the save and never inside it.
 *
 * Same identity rule as `storageKeyFor`: the repo's root commit, because `head`
 * moves on every commit and a head-keyed record is wiped by every reindex
 * (ADR-0011 decision 1). The `tally:` infix is what keeps the two records apart,
 * and a 40-hex sha can never begin with it.
 */
export function tallyKeyFor(repo: Pick<RepoMeta, 'root' | 'name'>): string {
  return repo.root === null ? `ark:tally:name:${repo.name}` : `ark:tally:${repo.root}`;
}

/**
 * Record one graded submission. Adds only.
 *
 * Called on **every** grade, pass or fail — that is the difference between this
 * and `noteAttempt`, and it is the whole point. `passedOn` latches on the first
 * pass and never moves: a later attempt on an already-passed board is still an
 * attempt and still counts, but it did not become a first pass twice.
 */
export function noteGrade(
  tally: Tally,
  verb: VerbId,
  subject: AtlasId,
  passed: boolean,
): Tally {
  const entries = [...tally.entries];
  const at = entries.findIndex((entry) => entry.verb === verb && entry.subject === subject);
  const existing = at === -1 ? undefined : entries[at];
  const graded = (existing?.graded ?? 0) + 1;
  const next: TallyEntry = {
    verb,
    subject,
    graded,
    passedOn: existing?.passedOn !== undefined && existing.passedOn > 0
      ? existing.passedOn
      : passed
        ? graded
        : 0,
  };
  if (at === -1) entries.push(next);
  else entries[at] = next;
  entries.sort((a, b) => byteCompare(a.verb, b.verb) || byteCompare(a.subject, b.subject));
  return { ...tally, entries };
}

/** M2's headline: how many challenges were attempted. */
export function totalGraded(tally: Tally): number {
  return tally.entries.reduce((sum, entry) => sum + entry.graded, 0);
}

/** How many distinct boards were opened and graded at least once. */
export function boardsAttempted(tally: Tally): number {
  return tally.entries.length;
}

/**
 * Boards that passed, split by whether the first attempt did it.
 *
 * `later` is the figure that prices a first-attempt rule. A board still open when
 * the session ended is in neither bucket, which is why they do not sum to
 * `boardsAttempted`.
 */
export function passBreakdown(tally: Tally): { first: number; later: number; unpassed: number } {
  let first = 0;
  let later = 0;
  let unpassed = 0;
  for (const entry of tally.entries) {
    if (entry.passedOn === 0) unpassed++;
    else if (entry.passedOn === 1) first++;
    else later++;
  }
  return { first, later, unpassed };
}

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------

/**
 * Read a stored tally. Never throws.
 *
 * Same posture as `save.ts`, for the same reason and one more: this is an
 * instrument, so a corrupt reading must become *no* reading rather than a
 * plausible one. A row whose count is negative, fractional, infinite or absurd is
 * dropped rather than clamped — a clamped number is indistinguishable from a real
 * one in the output, and it would land in an experiment's results.
 */
export function parseTally(text: string | null): Tally {
  if (text === null || text === '') return EMPTY_TALLY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_TALLY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_TALLY;
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== TALLY_VERSION) return EMPTY_TALLY;
  const rows = Array.isArray(record['entries']) ? record['entries'] : [];
  const entries: TallyEntry[] = [];
  for (const row of rows) {
    const entry = asEntry(row);
    if (entry !== null) entries.push(entry);
  }
  entries.sort((a, b) => byteCompare(a.verb, b.verb) || byteCompare(a.subject, b.subject));
  return { version: TALLY_VERSION, entries };
}

function asCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function asEntry(value: unknown): TallyEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const verb = record['verb'];
  const subject = record['subject'];
  // `VERB_IDS` is the schema's list and the only one. A hand-kept copy here is
  // the defect `save.ts` documents: a row naming a verb missing from a stale copy
  // is dropped at parse and erased by the next write.
  if (typeof verb !== 'string' || !(VERB_IDS as readonly string[]).includes(verb)) return null;
  // Both arms of the id union (ADR-0018, ADR-0019).
  if (typeof subject !== 'string' || !(isNodeId(subject) || isCommitId(subject))) return null;
  const graded = asCount(record['graded']);
  const passedOn = asCount(record['passedOn']);
  if (graded === null || passedOn === null) return null;
  // A row claiming it passed on an attempt that never happened is incoherent,
  // and an incoherent instrument reading is worse than a missing one.
  if (graded === 0 || passedOn > graded) return null;
  return { verb: verb as VerbId, subject, graded, passedOn };
}

export function serializeTally(tally: Tally): string {
  return JSON.stringify(tally);
}

/**
 * The reading a facilitator takes at minute 20.
 *
 * **This is the piece §9 asked for and did not name.** It offered *"a counter in
 * the save, or a facilitator's tally"* — a schema change or a clipboard — and the
 * option that dominates both is a **readout**: the count already existed in
 * memory, and what M2 lacked was any way to get it out of a finished session. A
 * record with no way to read it is not an instrument, and the read is the least
 * safe consumer in the whole design, so it is a typed function here rather than
 * whatever a facilitator improvises in a console at the end of a session.
 */
export interface TallyReading {
  /** M2's headline: challenges attempted. */
  readonly graded: number;
  /** Distinct boards opened and graded at least once. */
  readonly boards: number;
  /** Passed first time. */
  readonly first: number;
  /** Passed, but not first time — the figure that prices a first-attempt rule. */
  readonly later: number;
  /** Graded at least once and never passed. */
  readonly unpassed: number;
}

export function summarise(tally: Tally): TallyReading {
  const { first, later, unpassed } = passBreakdown(tally);
  return { graded: totalGraded(tally), boards: boardsAttempted(tally), first, later, unpassed };
}
