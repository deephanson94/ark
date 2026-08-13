/**
 * The hold-out split — `docs/experiments/0001` §4.4 and §9's first piece of
 * harness.
 *
 * S1 needs a **fixed** quiz: the same items for every participant in every arm.
 * The first draft drew them per-participant with the subjects that participant
 * played excluded, which makes every quiz different — and played sets differ
 * *systematically by arm*, because walking reaches different subjects than the
 * map does, so arm means would be computed over systematically different items.
 *
 * So: before recruiting, `k` boards per verb come out of the generated deck. The
 * atlas both arms play is the remainder; the removed boards are the quiz. Overlap
 * with played subjects is zero by construction, and — the reason it is taken from
 * the generator rather than hand-written — **the items keep every certification
 * the product's own boards carry**: guardrail 4, the Ctrl+F gate, ADR-0012's
 * one-key-once, and ADR-0008's `candidates ∩ dependents(subject, ∞) = truth`.
 *
 * ## The leak a hold-out does not close on its own
 *
 * A board removed from the deck is still a subject in the graph, and ADR-0019's
 * disclosure channel runs between *reveals*: a served reveal can state an atom of
 * a held-out answer key, handing a quiz answer to whoever happened to open that
 * board. It is equal in both arms, so it adds ceiling rather than bias — but
 * "equal noise" is not a reason to ship an instrument with a known hole.
 *
 * Hence `check()`. It is the same accumulator the generator uses, run over the
 * **served** deck, with each held-out board asked what would state its own key
 * (`Verb.keyFacts`).
 *
 * ## Why this reports two kinds of zero and refuses to add them up
 *
 * The check is expected to refuse **nothing on a healthy atlas**, and that is the
 * dangerous kind of result: `CLAUDE.md`'s landmine is that an absence assertion
 * passes whether or not the rule exists, and it errs in the direction that gets
 * believed. There are two entirely different reasons a verb reports zero here and
 * a table that prints one number cannot tell them apart:
 *
 *   inexpressible  Blast Radius and Companion keys are relations between *files*
 *                  and every fact in `disclosure.ts` is keyed on a commit, so no
 *                  accumulated fact can state one. The check is **blind**, not
 *                  satisfied — and these are the two verbs §4.4's discriminating
 *                  tier is made of, so this is the cell that matters most.
 *   closed         Placement and Archaeology keys *are* expressible, and the
 *                  generator already excluded the overlap: ADR-0019 decision 7
 *                  takes a commit whose membership an earlier reveal stated off
 *                  the later board entirely. A zero here is a **measurement**, and
 *                  it is the proof that decision 7 survives an arbitrary subset —
 *                  which is not obvious, because the exclusion was computed
 *                  against the *full* deck and the served deck is a subset of it.
 *
 * `VerbSplit.expressible` carries the distinction, `summary()` prints
 * `unchecked` rather than `0` for the blind arm, and nothing sums the two.
 *
 * The apparatus is proved by a positive control rather than by its own silence:
 * `tests/unit/holdout.test.ts` builds an atlas where a served reveal really does
 * state a held-out key, and asserts the swap happens. A check that has never
 * fired is a check nobody has tested.
 *
 * ## Pure
 *
 * No I/O and no `VERBS` import — the verb surface is injected, which keeps this
 * acyclic and lets a test drive it with two lines of fixture. `scripts/holdout.ts`
 * is the shell.
 */

import type { Atlas, Challenge, VerbId } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import type { DisclosedFact } from './disclosure.js';

/**
 * Just enough of a `Verb` to split a deck.
 *
 * Injected rather than imported for the reason `progress.ts` injects
 * `VerbLookup`: this module is pure, and `src/verbs/index.ts` would be a cycle.
 * A verb this build does not have is simply absent, and `splitDeck` treats its
 * boards as unheld rather than guessing.
 */
export type HoldoutVerbs = Readonly<
  Partial<
    Record<
      VerbId,
      {
        discloses(challenge: Challenge): Iterable<DisclosedFact>;
        keyFacts(challenge: Challenge): Iterable<DisclosedFact> | null;
      }
    >
  >
>;

/** How many boards to hold out, per verb. */
export type HoldoutSizes = Readonly<Partial<Record<VerbId, number>>>;

/**
 * A board that may not be held out, and why — **the leak the hold-out itself
 * creates**.
 *
 * Removing a board is not a neutral act on the player. ADR-0030's twin surface
 * names a class *"only when no member still carries an unanswered Blast Radius
 * board"*, and `main.ts` asks that question as `challengesById.get(id) ?? []` —
 * so a **held-out** board is not *unanswered*, it is **absent**, the bucket is
 * empty, and the gate passes **vacuously**. The class gets named, `cone(T) =
 * cone(S)` by definition of a twin, and ADR-0008's invariant
 * `candidates ∩ dependents(subject, ∞) = truth` then makes `candidates(S) ∩
 * cone(T)` the held-out key **byte-exact**. Measured: **4 of kysely's 6** held-out
 * Blast Radius boards recover at F1 **1.000**, 19 of 19 under leave-one-out
 * (25.3% of that deck), and 3 of graphql-js's 6.
 *
 * The player is not wrong — a board that does not exist cannot be open — so the
 * repair belongs here, in the thing that made it not exist. Injected rather than
 * computed, because `findTwins` lives in `src/player/` and a second definition of
 * *twin* is the one thing worse than this leak.
 */
export type HoldoutBar = (challenge: Challenge) => string | null;

/** No board is barred. Fixtures and tests, and the honest default for a caller
 * that has not thought about it — `scripts/holdout.ts` supplies the real one. */
export const NOTHING_BARRED: HoldoutBar = () => null;

export interface BarredItem {
  readonly id: string;
  readonly verb: VerbId;
  readonly reason: string;
}

export interface RefusedItem {
  readonly id: string;
  readonly verb: VerbId;
  /** How many atoms of this board's key the served deck already states. */
  readonly disclosedAtoms: number;
  /** How many atoms the key has in total. */
  readonly atoms: number;
  /** The round it was refused in. Round 1 is the first pass over the deck. */
  readonly round: number;
}

export interface MutualItem {
  readonly id: string;
  readonly verb: VerbId;
  /** The served board that names this one's subject, and is named back by it. */
  readonly servedId: string;
  /** How many of this board's key members are implicated. */
  readonly atoms: number;
}

export interface VerbSplit {
  readonly verb: VerbId;
  /** What was asked for. */
  readonly requested: number;
  /** Boards this verb had available to hold out. */
  readonly eligible: number;
  /** Challenge ids of the held-out boards, sorted. */
  readonly heldOut: readonly string[];
  /**
   * **False when `keyFacts` returned `null`** — no fact in the vocabulary can
   * state an atom of this verb's key, so `refused` is empty because the check
   * could not run, not because the deck is clean. Never print this arm's zero
   * as a result.
   */
  readonly expressible: boolean;
  /** Items swapped out because the served deck already states part of their key. */
  readonly refused: readonly RefusedItem[];
  /**
   * **The second channel, and the only one that can fire on the quiz's own two
   * verbs** — reported, never refused on. See `mutualMembership`.
   */
  readonly mutual: readonly MutualItem[] | null;
  /**
   * Boards this verb could not hold out because removing them would open a
   * surface that states their own key. See `HoldoutBar`.
   */
  readonly barred: readonly BarredItem[];
  /**
   * Set when the verb could not supply `requested` boards after refusals. A
   * short quiz is a fact about the instrument and is never silently absorbed.
   */
  readonly shortfall: number;
}

export interface HoldoutReport {
  readonly perVerb: readonly VerbSplit[];
  /**
   * How many times the fixpoint loop ran.
   *
   * Held out and swapped are not independent: a board leaving the hold-out
   * rejoins the served deck and its own reveal starts disclosing again, which
   * can refuse a *different* held-out board. So the check re-runs until nothing
   * moves. **1 means the loop found nothing to do on the first pass** — the
   * expected result, and the reason this number is reported rather than assumed:
   * a repair path that never fires is one this repo has shipped before.
   */
  readonly rounds: number;
  /** True when the loop hit its bound instead of settling. */
  readonly exhausted: boolean;
}

export interface Split {
  /** The atlas both arms play: every challenge except the held-out ones. */
  readonly played: Atlas;
  /** The quiz: the held-out challenges, sorted by id like any deck. */
  readonly quiz: readonly Challenge[];
  readonly report: HoldoutReport;
}

/**
 * The order boards are taken in — **stated, because the refusal count depends on
 * it** and a table quoting one selection rule against another is not comparable.
 *
 * Evenly spaced across the difficulty ordering rather than the top or the bottom
 * of it. §4.4's tier 3 is the discriminating tier, and a quiz drawn from one end
 * measures a band rather than a range: all-hardest floors every arm, all-easiest
 * ceilings them, and §6 names both as instrument failures wearing opposite signs.
 *
 * Ties broken on `id`, which is byte-ordered and unique, so the sequence is total
 * and the split is reproducible from the atlas alone.
 */
export function preferenceOrder(deck: readonly Challenge[], count: number): Challenge[] {
  const sorted = [...deck].sort(
    (a, b) => a.difficulty - b.difficulty || byteCompare(a.id, b.id),
  );
  if (count <= 0 || sorted.length === 0) return sorted;
  const picked: Challenge[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < count && i < sorted.length; i++) {
    // Spread across the whole range: index ⌊i·n/k⌋ walks 0 → n as i walks 0 → k.
    let at = Math.floor((i * sorted.length) / count);
    while (taken.has(at)) at++;
    taken.add(at);
    const challenge = sorted[at];
    if (challenge !== undefined) picked.push(challenge);
  }
  // The rest, in difficulty order, are the swap supply.
  for (let at = 0; at < sorted.length; at++) {
    if (taken.has(at)) continue;
    const challenge = sorted[at];
    if (challenge !== undefined) picked.push(challenge);
  }
  return picked;
}

/**
 * The facts the served deck's reveals state.
 *
 * `discloses` only. `decidedBy`'s verdicts are in the same accumulator inside
 * `build.ts`, and they are deliberately not here: a `decided` fact says *what
 * would beat this board*, never what its answer is, and its constructor prefix
 * cannot collide with a `touched` one. Including them could only add facts that
 * match nothing, which is how a check acquires a branch nobody can reason about.
 */
function servedFacts(served: readonly Challenge[], verbs: HoldoutVerbs): Set<DisclosedFact> {
  const facts = new Set<DisclosedFact>();
  for (const challenge of served) {
    const verb = verbs[challenge.verb];
    if (verb === undefined) continue;
    for (const fact of verb.discloses(challenge)) facts.add(fact);
  }
  return facts;
}

/** How much of this board's key the served deck already states. */
function disclosure(
  challenge: Challenge,
  verbs: HoldoutVerbs,
  facts: ReadonlySet<DisclosedFact>,
): { expressible: boolean; atoms: number; disclosedAtoms: number } {
  const verb = verbs[challenge.verb];
  const keyFacts = verb === undefined ? null : verb.keyFacts(challenge);
  if (keyFacts === null) return { expressible: false, atoms: 0, disclosedAtoms: 0 };
  let atoms = 0;
  let disclosedAtoms = 0;
  for (const fact of keyFacts) {
    atoms++;
    if (facts.has(fact)) disclosedAtoms++;
  }
  return { expressible: true, atoms, disclosedAtoms };
}

/**
 * Boards that name each other — the leak `keyFacts` is structurally blind to.
 *
 * A held-out board `(S, T)` and a served board `(Y, T')` of the same verb where
 * `Y ∈ T` **and** `S ∈ T'`. Then the served board's reveal names `S` as one of
 * `Y`'s answers, and for a symmetric relation that is the atom `Y ∈ key(S)`
 * stated outright — in a deck the participant plays, about a board they are
 * later quizzed on.
 *
 * **Stated as mutual membership rather than as co-change, and that is what makes
 * it belong here.** Naming the relation would put `history.coChange` in
 * verb-blind code, which is the coupling the whole seam exists to prevent. Said
 * structurally it needs no relation at all, and it generalises for free: on
 * Companion it finds the symmetric co-change pair; on Blast Radius the same shape
 * is `S → Y → S`, a **cycle**, and ADR-0034 §4 measured that ticking a subject's
 * strongly connected component decides 109 of hugo's 156 Blast Radius boards at
 * precision 1.000. One rule, both readings.
 *
 * **Reported and never refused on**, which is a judgement and is written down as
 * one. Refusing would silently shrink the quiz for a leak whose size nobody has
 * measured on the two experiment repos yet, and §4.4's own instruction is to swap
 * items that are *disclosed* — a fact stated by a reveal — where this is a
 * property of two boards' shapes. When the number is known, this is the line that
 * changes.
 *
 * Not to be confused with the channel this deliberately does **not** report:
 * a served Blast Radius board about `D` where `D` transitively imports `S`
 * discloses `dependents(D) ⊆ dependents(S)`, which covers **29 of ark's 40**
 * boards' keys in part. That is not a leak — exploiting it needs the player to
 * know `D` depends on `S` and then reason transitively, which is tier 3's
 * construct in as many words (*"directly, or through a chain of imports"*).
 * ADR-0019's rule is the one that separates them: **an implied relation is
 * accepted where a stated atom is refused.**
 */
export function mutualMembership(
  heldOut: readonly Challenge[],
  served: readonly Challenge[],
): MutualItem[] | null {
  // **Only askable where a subject and a member are the same kind of id**, and
  // returning `null` rather than `[]` where they are not is this module's own
  // two-zeroes rule applied to the channel it added second — which the first
  // version got wrong, in the file whose docstring is mostly about that rule.
  //
  // Placement's subject is a commit and its members are nodes; Archaeology's are
  // the other way round. The two roles are in **disjoint namespaces**, so
  // `bucket.get(member)` misses by construction and the count is 0 for a reason
  // that has nothing to do with the repo. Printing that beside Blast Radius's
  // checked zero would be the same cell for two different facts, again.
  const kindOf = (id: string): string => id.slice(0, 2);
  for (const challenge of heldOut) {
    const member = challenge.truth[0];
    if (member !== undefined && kindOf(member) !== kindOf(challenge.subject)) return null;
  }
  const byVerb = new Map<VerbId, Map<string, ReadonlySet<string>>>();
  for (const challenge of served) {
    let bucket = byVerb.get(challenge.verb);
    if (bucket === undefined) {
      bucket = new Map();
      byVerb.set(challenge.verb, bucket);
    }
    bucket.set(challenge.subject, new Set(challenge.truth));
  }
  const found: MutualItem[] = [];
  for (const challenge of heldOut) {
    const bucket = byVerb.get(challenge.verb);
    if (bucket === undefined) continue;
    for (const member of challenge.truth) {
      const back = bucket.get(member);
      if (back === undefined || !back.has(challenge.subject)) continue;
      found.push({ id: challenge.id, verb: challenge.verb, servedId: member, atoms: 1 });
    }
  }
  return found.sort((a, b) => byteCompare(a.id, b.id) || byteCompare(a.servedId, b.servedId));
}

/**
 * Refuse a board as soon as **one** atom of its key is already stated.
 *
 * Not "the whole key", which was the other candidate bar and is wrong for a
 * scored instrument: a single disclosed atom is a free point on an F1-scored
 * item, and §4.4 scores a quiz board with the same `scoreSet` the product grades
 * by. Partial credit is the metric, so partial disclosure is a real effect.
 */
const REFUSE_AT = 1;

/** Loop bound. Every round removes at least one candidate from supply. */
const MAX_ROUNDS = 64;

/**
 * Split a built atlas into the atlas the arms play and the quiz they are scored
 * on.
 *
 * The two are coupled and the loop is why: a board swapped *out* of the hold-out
 * rejoins the served deck and its own reveal starts disclosing again, which can
 * refuse a board that was fine a moment ago. Settling that is the fixpoint, and
 * `report.rounds` says how many passes it took — 1 meaning nothing moved.
 */
export function splitDeck(
  atlas: Atlas,
  sizes: HoldoutSizes,
  verbs: HoldoutVerbs,
  bar: HoldoutBar = NOTHING_BARRED,
): Split {
  const byVerb = new Map<VerbId, Challenge[]>();
  for (const challenge of atlas.challenges) {
    const bucket = byVerb.get(challenge.verb);
    if (bucket === undefined) byVerb.set(challenge.verb, [challenge]);
    else bucket.push(challenge);
  }

  // Sorted so the walk is deterministic. Order does not change *which* facts the
  // served deck states — a set is a set — but it decides the order of `perVerb`,
  // and a report whose rows move between runs is one nobody can diff.
  const wanted = (Object.keys(sizes) as VerbId[])
    .filter((verb) => (sizes[verb] ?? 0) > 0)
    .sort(byteCompare);

  const order = new Map<VerbId, Challenge[]>();
  const held = new Map<VerbId, Challenge[]>();
  const refusedEver = new Map<VerbId, RefusedItem[]>();
  const barredEver = new Map<VerbId, BarredItem[]>();
  const barred = new Set<string>();
  for (const verb of wanted) {
    const deck = byVerb.get(verb) ?? [];
    const size = sizes[verb] ?? 0;
    // The bar is applied to the *supply*, before anything is picked. It is a
    // property of the board and of the atlas, not of what else was held out, so
    // filtering here keeps it out of the fixpoint loop — which is where a rule
    // that is not actually iterative would acquire a branch nobody can reason
    // about.
    const allowed: Challenge[] = [];
    const rejected: BarredItem[] = [];
    for (const challenge of deck) {
      const reason = bar(challenge);
      if (reason === null) allowed.push(challenge);
      else rejected.push({ id: challenge.id, verb, reason });
    }
    const sequence = preferenceOrder(allowed, size);
    order.set(verb, sequence);
    held.set(verb, sequence.slice(0, size));
    refusedEver.set(verb, []);
    barredEver.set(verb, rejected.sort((a, b) => byteCompare(a.id, b.id)));
  }

  let rounds = 0;
  let exhausted = true;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    rounds = round;
    const heldIds = new Set<string>();
    for (const bucket of held.values()) for (const c of bucket) heldIds.add(c.id);
    const served = atlas.challenges.filter((c) => !heldIds.has(c.id));
    const facts = servedFacts(served, verbs);

    let moved = false;
    for (const verb of wanted) {
      const bucket = held.get(verb) ?? [];
      const keep: Challenge[] = [];
      for (const challenge of bucket) {
        const { expressible, atoms, disclosedAtoms } = disclosure(challenge, verbs, facts);
        if (expressible && disclosedAtoms >= REFUSE_AT) {
          barred.add(challenge.id);
          refusedEver.get(verb)?.push({
            id: challenge.id,
            verb,
            disclosedAtoms,
            atoms,
            round,
          });
          moved = true;
        } else {
          keep.push(challenge);
        }
      }
      // Refill from the preference order, skipping anything already refused.
      const size = sizes[verb] ?? 0;
      const inHand = new Set(keep.map((c) => c.id));
      for (const challenge of order.get(verb) ?? []) {
        if (keep.length >= size) break;
        if (inHand.has(challenge.id) || barred.has(challenge.id)) continue;
        keep.push(challenge);
        inHand.add(challenge.id);
      }
      held.set(verb, keep);
    }
    if (!moved) {
      exhausted = false;
      break;
    }
  }

  const heldIds = new Set<string>();
  for (const bucket of held.values()) for (const c of bucket) heldIds.add(c.id);
  const quiz = atlas.challenges
    .filter((c) => heldIds.has(c.id))
    .slice()
    .sort((a, b) => byteCompare(a.id, b.id));
  const servedChallenges = atlas.challenges.filter((c) => !heldIds.has(c.id));
  const finalFacts = servedFacts(servedChallenges, verbs);

  const perVerb: VerbSplit[] = wanted.map((verb) => {
    const bucket = held.get(verb) ?? [];
    const size = sizes[verb] ?? 0;
    // Expressibility is a property of the verb, not of a board — but it is read
    // off one, because `keyFacts` takes a challenge. A verb with no boards at all
    // cannot be asked, and reports as unexpressible rather than clean: the same
    // rule, that an unaskable question is never an answered one.
    const probe = bucket[0] ?? byVerb.get(verb)?.[0];
    const expressible =
      probe !== undefined && disclosure(probe, verbs, finalFacts).expressible;
    return {
      verb,
      requested: size,
      eligible: (byVerb.get(verb) ?? []).length,
      heldOut: bucket.map((c) => c.id).sort(byteCompare),
      expressible,
      refused: refusedEver.get(verb) ?? [],
      mutual: mutualMembership(bucket, servedChallenges),
      barred: barredEver.get(verb) ?? [],
      // **A verb whose whole supply was taken is short even when the arithmetic
      // says otherwise.** `size - bucket.length` fires only when `k > eligible`,
      // never when `k === eligible` — so `-k 40` on a 40-board verb emptied that
      // verb's played deck and exited 0, handing participants an atlas with no
      // board of that kind and the guide saying "every question answered".
      // Reported as a shortfall of the whole request, because that is what the
      // caller has to act on.
      shortfall:
        bucket.length > 0 && bucket.length === (byVerb.get(verb) ?? []).length
          ? size
          : Math.max(0, size - bucket.length),
    };
  });

  return {
    played: { ...atlas, challenges: servedChallenges },
    quiz,
    report: { perVerb, rounds, exhausted },
  };
}

/**
 * The report as lines, with the two zeroes kept apart.
 *
 * `unchecked` where the vocabulary cannot express the key; a count where it can.
 * A caller that wants one number for "leaks found" is asking the question this
 * whole module exists to refuse to answer.
 */
export function summary(report: HoldoutReport): string[] {
  const lines: string[] = [];
  for (const split of report.perVerb) {
    const refusals = split.expressible
      ? `${split.refused.length} refused`
      : 'unchecked (key not expressible as a disclosed fact)';
    const short = split.shortfall > 0 ? `  SHORT by ${split.shortfall}` : '';
    lines.push(
      `${split.verb.padEnd(12)} held ${String(split.heldOut.length).padStart(3)}` +
        ` of ${String(split.eligible).padStart(4)} eligible   ${refusals}` +
        `   mutual ${split.mutual === null ? 'n/a' : String(split.mutual.length)}` +
        `   barred ${split.barred.length}${short}`,
    );
  }
  lines.push(`rounds ${report.rounds}${report.exhausted ? '  EXHAUSTED — did not settle' : ''}`);
  return lines;
}
