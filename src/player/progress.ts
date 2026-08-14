/**
 * What the player has proved, as a record — and what that record means for the
 * fog.
 *
 * `fog.ts` draws a distinction the whole product rests on:
 *
 *   surveyed    you looked at it. You were shown its name and its numbers.
 *   understood  you proved you knew something about it, by being graded
 *               against ground truth.
 *
 * §9 says field notes accumulate facts you have **proven** you know, not facts
 * you were shown, and that distinction is the product. So:
 *
 *   surveyed    every file whose name appeared in the choice set, plus the
 *               subject. You were shown them. That is all `surveyed` claims.
 *   understood  the subject, and the truth members you actually picked —
 *               and only when the score reached the pass threshold.
 *
 * The two halves matter separately. A file you *missed* was in the answer and
 * you did not know it, so promoting it would write a field note you never
 * earned. A file you picked correctly in an answer that came apart overall is
 * as likely to have been a guess as knowledge, so the pass threshold gates the
 * whole promotion rather than each pick.
 *
 * Guardrail 6 is why nothing here can subtract: every function only ever adds,
 * so a wrong answer costs the player exactly nothing.
 *
 * **`Progress` is the state; `Fog` is a view of it** (ADR-0011 decision 2).
 * `understood` is never stored, because storing it as well as the passes that
 * justify it would be two representations of one fact — and after a reindex
 * they would disagree. `surveyed` *is* stored, because map clicks are not
 * reconstructible from anything else.
 */

import type { NodeId, AtlasId, VerbId } from '../atlas/index.js';
import type { Graph } from '../atlas/index.js';
import { byteCompare, commitIdFor, isNodeId } from '../atlas/index.js';
import type { Challenge } from '../atlas/index.js';
import type { Grade, NoteRegister } from '../verbs/index.js';
import { PASS_THRESHOLD } from '../verbs/index.js';
import type { Fog } from './fog.js';

/** Bumped when the stored shape changes. Independent of `ATLAS_VERSION`. */
export const SAVE_VERSION = 2;

/**
 * One challenge the player passed.
 *
 * Keyed by `(verb, subject)`, **never by `challenge.id`**: `docs/atlas-format.md`
 * promises only that a challenge id is stable *within* an atlas, so keying a
 * save on it would depend on a cross-atlas guarantee the format explicitly
 * declines to make.
 */
export interface Pass {
  readonly verb: VerbId;
  /**
   * A node id, or a commit id for a verb that asks about an event (ADR-0018).
   *
   * Opaque here: the save keys on it, orders on it and compares it, and never
   * needs to know which kind it is. That is what let Placement's key be
   * `(verb, subject)` like everyone else's.
   */
  readonly subject: AtlasId;
  /**
   * The truth members the player actually picked. Sorted, unique.
   *
   * A place **or** an event, like the subject and for the same reason
   * (ADR-0019): Archaeology's members are commits. Opaque here — the save keys,
   * orders and compares these and never needs to know which kind they are.
   */
  readonly proved: readonly AtlasId[];
  /**
   * Truth members picked in a passing answer that came **after** this board had
   * already been graded once — and therefore after it had explained itself.
   *
   * Sorted, unique, and disjoint from `proved`. It is the other half of
   * NORTH-STAR §9's *"facts you have proven you know, not facts you were
   * shown"*, and before ADR-0047 the save had only the first half: **every**
   * passing answer minted `proved`, whatever the player had been told one click
   * earlier.
   *
   * A pass in this register still retires the board, still unlocks the subject's
   * cone and still writes a field note. What it does not do is claim the note as
   * knowledge, which is the one thing §9 says the register is for.
   */
  readonly shown: readonly AtlasId[];
}

export interface Progress {
  readonly version: number;
  /**
   * Sorted, unique. **Node ids only** — this is the map's memory of what you
   * were shown, and a commit has no square to remember.
   */
  readonly surveyed: readonly NodeId[];
  /** Sorted by `(verb, subject)`. */
  readonly passes: readonly Pass[];
  /**
   * Every `(verb, subject)` this player has submitted an answer to, passing or
   * not. Sorted, unique. `answerKey` strings, the same shape `answeredKeys`
   * returns.
   *
   * **This is what makes "the first submission" a thing the save can know**, and
   * it has to live on `Progress` rather than on `Pass` because a *failed* first
   * attempt leaves no `Pass` behind — which is precisely the attempt after which
   * the board has explained itself. In memory the selector's attempt counter
   * would answer the same question and it dies on reload, so a reload-then-pass
   * would mint a note the player did not earn.
   *
   * ADR-0047: proof is what the **first** answer earned. `gate.ts` certifies
   * every board against guesses assembled from a known information state — key
   * size, the drawn direct ring, hover — and that certification models the first
   * submission and nothing after it. So *proved* means "claimed under the
   * conditions this board was certified fair for", which is a sentence the save
   * can check.
   */
  readonly graded: readonly string[];
}

export const EMPTY_PROGRESS: Progress = {
  version: SAVE_VERSION,
  surveyed: [],
  passes: [],
  graded: [],
};

function union<T extends string>(existing: readonly T[], added: Iterable<T>): T[] {
  return [...new Set([...existing, ...added])].sort(byteCompare);
}

function passOrder(a: Pass, b: Pass): number {
  return byteCompare(a.verb, b.verb) || byteCompare(a.subject, b.subject);
}

/** Record that the player was shown these nodes. Adds only. */
export function recordSurvey(progress: Progress, ids: Iterable<NodeId>): Progress {
  const surveyed = union(progress.surveyed, ids);
  if (surveyed.length === progress.surveyed.length) return progress;
  return { ...progress, surveyed };
}

/**
 * Record that the player proved something about `subject`.
 *
 * A second pass on the same subject **unions** with the first rather than
 * replacing it: answer keys are sampled (ADR-0008), so two passes on one hub can
 * prove different members, and guardrail 6 forbids the second attempt taking
 * away what the first earned.
 */
export function recordPass(
  progress: Progress,
  verb: VerbId,
  subject: AtlasId,
  members: Iterable<AtlasId>,
  // **Required, not defaulted to `'proved'`.** The permissive default is what
  // let ADR-0047's whole register split compile with no test touching it: every
  // fixture in the suite inherited `'proved'`, so a mutant forcing the notebook
  // to that register survived 920 unit tests, 116 atlas tests and the e2e. A
  // caller that has not decided which register it is writing has not finished
  // thinking about the pass.
  register: Register,
): Progress {
  const passes = [...progress.passes];
  const at = passes.findIndex((pass) => pass.verb === verb && pass.subject === subject);
  const existing = at === -1 ? undefined : passes[at];
  const proved = union(existing?.proved ?? [], register === 'proved' ? members : []);
  // **Disjoint, and `proved` wins.** A member proved on the first submission and
  // shown again on a later one is still proved — guardrail 6 forbids the second
  // attempt taking away what the first earned, and this is the one place the two
  // registers could have collided.
  const knownProved = new Set(proved);
  const shown = union(existing?.shown ?? [], register === 'shown' ? members : []).filter(
    (id) => !knownProved.has(id),
  );
  const merged: Pass = { verb, subject, proved, shown };
  if (at === -1) passes.push(merged);
  else passes[at] = merged;
  passes.sort(passOrder);
  return { ...progress, passes };
}

/**
 * Which half of NORTH-STAR §9's distinction a passing answer lands in.
 *
 * **An alias for the verbs' `NoteRegister`, not a second declaration of the same
 * two strings.** They were separate for one commit, which is a rule living twice
 * in the codebase with a landmine about exactly that — and these are not two
 * facts that happen to agree: the note's register *is* the pass's register, and
 * a build where they could drift would be a build where the notebook can claim
 * a thing the save does not say.
 */
export type Register = NoteRegister;

/** Everything a live pass claims, in either register. */
export function claimedBy(pass: Pass): AtlasId[] {
  return [...pass.proved, ...pass.shown];
}

export interface Progression {
  readonly progress: Progress;
  /**
   * True when this grade reached the pass threshold.
   *
   * Named for what it means now rather than for what one verb does with it:
   * this used to read "unlocked the subject's full radius", which is false for
   * a Companion pass and is the kind of verb-specific wording that invites the
   * next leak. What a pass unlocks is the verb's business (`subjectsPassed`).
   */
  readonly unlocked: boolean;
  /**
   * Which register this answer landed in, or `null` when it did not pass.
   *
   * Returned rather than recomputed by the caller, because the fact is *"was
   * this board already graded before this call"* and this function is the only
   * one that knows — by the time it returns, `graded` says yes either way.
   */
  readonly register: Register | null;
}

/**
 * Fold one grade into the record.
 *
 * **The first submission is the one that can prove something** (ADR-0047). Every
 * later passing answer is recorded in the `shown` register instead, because by
 * then the board has explained itself and no policy over the *reveal* can change
 * that: a single-pick answer scores `2/(K+1) > 0` exactly when the pick is in
 * the key, so the **score** is a membership oracle, and guardrail 6 makes
 * retries free and unlimited. Measured on four repos, one candidate at a time
 * reads the whole answer key in 20 submissions and reaches a full reveal in a
 * mean of 5.2 clicks here and 5.8–7.0 on the other three — on **every board of
 * all four** (`npx tsx scripts/probe-farm.ts`, ark at `9b86d12`).
 *
 * So extraction-resistance is not a property this product can have, and
 * NORTH-STAR §7.1 already made that peace for the atlas file: *"anyone who opens
 * devtools to cheat has opted out of the product"*. What §9 says to defend is
 * the **distinction** between shown and proved, and that lives here.
 *
 * Guardrail 6 is untouched and the check is worth writing out: the score is
 * unchanged, nothing is locked, the board can be answered again immediately, a
 * retry still improves the band and still retires the deck, still unlocks the
 * cone and still writes a field note. The only thing a retry cannot do is
 * convert *shown* into *proved* — which is not a punishment for a wrong answer,
 * it is a refusal to relabel a fact the player was handed.
 *
 * **`liveness` is what stops the rule outliving the board it is about.** See
 * `gradedKeys`: a `graded` entry certifies *that* board, and a board whose pass
 * has fully decayed is a different question with the same name. Defaulted to
 * `UNCHECKED` so a fixture need not build a graph, which is the same default
 * `deriveFog`'s callers get — but the shell passes the real one, and a test that
 * is about decay has to.
 */
export function applyGrade(
  progress: Progress,
  challenge: Challenge,
  grade: Grade,
  threshold = PASS_THRESHOLD,
  liveness: Liveness = UNCHECKED,
): Progression {
  // **Node ids only.** `surveyed` and `understood` are sets of *files* — the
  // fog is a property of the map — and a commit has no square on it. Filtering
  // here rather than inside `recordSurvey` keeps the filter next to the one
  // place a non-node subject can enter the record.
  const seen = [challenge.subject, ...challenge.candidates].filter(isNodeId);
  let next = recordSurvey(progress, seen);
  const key = answerKey(challenge.verb, challenge.subject);
  const first = !gradedKeys(progress, liveness).has(key);
  const passed = grade.score >= threshold;
  const register: Register | null = passed ? (first ? 'proved' : 'shown') : null;
  if (register !== null) {
    next = recordPass(next, challenge.verb, challenge.subject, grade.correct, register);
  }
  // Recorded for **every** graded answer, passing or not: the attempt that
  // explains a board is usually the one that failed, and it is the reason the
  // next one cannot prove anything.
  //
  // Unioned into the *stored* list rather than the live one, so a key dropped by
  // decay and re-earned later does not accumulate twice — and so that nothing
  // here deletes a record, which is the rule the rest of this file keeps.
  next = { ...next, graded: union(next.graded, [key]) };
  return { progress: next, unlocked: passed, register };
}

// ---------------------------------------------------------------------------
// deriving the fog
// ---------------------------------------------------------------------------

/**
 * What the *current* atlas still says about a stored claim.
 *
 * A save outlives the repo state it was earned against, so every claim has to
 * be re-checked before it is rendered as knowledge (ADR-0011 decision 3).
 * Provenance is immutable — you did prove it — but the claim about *today* is
 * validated here, and a pair that no longer holds is dropped. Showing a stale
 * claim as current knowledge would be a worse lie than showing nothing.
 */
export interface Liveness {
  /**
   * True when this id names something the atlas now loaded still contains — a
   * node, or (for a commit subject) a retained commit.
   *
   * Both arms are the same question and it is deliberately **not** asked of the
   * verb: "is this still here?" is a fact about the atlas, and answering it by
   * prefix keeps it total for an id whose verb this build does not have.
   */
  exists(id: AtlasId): boolean;
  /**
   * True when the claim `(verb, subject, member)` still holds.
   *
   * **Per verb, and that is not a refinement — it is the difference between
   * dropping true claims and keeping false ones.** Before M4 this was
   * `dependsOn`, one rule for one verb: "does `member` still transitively
   * import `subject`". Applied to a Companion pass it would delete every claim
   * about a co-change pair that never imported anything — which is most of them
   * (67% on hono, 89% on svelte) — while a Blast Radius claim checked against
   * the co-change matrix would survive on coincidence.
   *
   * The rule itself belongs to the verb (`Verb.stillHolds`), because only the
   * verb knows what it asserted.
   */
  holds(verb: VerbId, subject: AtlasId, member: AtlasId): boolean;
}

/**
 * A `Liveness` that agrees with everything. **Fixtures and tests only** — it
 * turns the decay check off, which is the one thing that keeps a restored save
 * honest.
 */
export const UNCHECKED: Liveness = { exists: () => true, holds: () => true };

/**
 * The real thing, over a loaded graph.
 *
 * Memoised per `(verb, subject)`: restoring a save asks this once per stored
 * member, and both verbs' checks are a whole-cone or whole-matrix sweep.
 */
export function livenessOf(graph: Graph, verbs: VerbLookup): Liveness {
  const cones = new Map<string, ReadonlySet<AtlasId>>();
  const commits = new Set(graph.atlas.history.commits.map((commit) => commitIdFor(commit.sha)));
  return {
    // A commit that has slid out of the atlas's window takes its pass with it,
    // which is ADR-0011 decision 3 rather than a loss: the claim is still true
    // of the repo, and nothing loaded can confirm it. The record is retained in
    // storage, so a reindex that brings the commit back brings the note back.
    exists: (id) => (isNodeId(id) ? graph.refById.has(id) : commits.has(id)),
    holds: (verb, subject, member) => {
      const key = `${verb}\n${subject}`;
      let cone = cones.get(key);
      if (cone === undefined) {
        const implementation = verbs[verb];
        const found = new Set<AtlasId>();
        // Ask the verb about every id once rather than per member: the
        // implementations are a cone walk and a matrix lookup, and calling
        // either once per stored claim turns an O(1) question into an O(V·E)
        // one on a save with a full notebook.
        //
        // **Both populations, and this is a defect the compiler could not see.**
        // The scan was `atlas.nodes` alone, on the assumption a member is a
        // file. Archaeology's members are commits, so every one of its claims
        // would have been absent from this set, `livePasses` would have filtered
        // the pass to empty, and `livePasses` drops an empty pass — silently
        // re-fogging the subject and putting the question back. Asking each verb
        // about ids it never issues is cheap and total: a commit id is not in a
        // cone and a node id is not in a file list, so both simply answer false.
        if (implementation !== undefined) {
          for (const node of graph.atlas.nodes) {
            if (implementation.stillHolds(graph, subject, node.id)) found.add(node.id);
          }
          for (const id of commits) {
            if (implementation.stillHolds(graph, subject, id)) found.add(id);
          }
        }
        cone = found;
        cones.set(key, cone);
      }
      return cone.has(member);
    },
  };
}

/** Just enough of `VERBS` to check a claim. Injected so this module stays pure. */
export type VerbLookup = Readonly<Partial<Record<VerbId, { stillHolds: StillHolds }>>>;
type StillHolds = (graph: Graph, subject: AtlasId, member: AtlasId) => boolean;

/**
 * The stored passes that the current atlas still bears out, each narrowed to
 * the members whose claim still holds.
 *
 * This is the seam everything downstream reads: the fog, the question deck, and
 * (at rung 3) the field notes. One decay rule, applied once.
 *
 * Stored ids that name nothing are ignored here and **kept in storage**:
 * retention is what makes reverting a deletion restore your map.
 */
export function livePasses(progress: Progress, liveness: Liveness): Pass[] {
  const live: Pass[] = [];
  for (const pass of progress.passes) {
    if (!liveness.exists(pass.subject)) continue;
    const alive = (member: AtlasId): boolean =>
      liveness.exists(member) && liveness.holds(pass.verb, pass.subject, member);
    const proved = pass.proved.filter(alive);
    // **Both registers decay, and a pass survives while *either* does.** Reading
    // only `proved` here would drop every shown-register pass at the first
    // restore — which re-fogs the subject, un-retires the board and deletes the
    // note, silently, for a player who did nothing but answer twice.
    const shown = pass.shown.filter(alive);
    // A fully decayed pass drops out entirely, which demotes its subject: the
    // map re-fogs, honestly, because the thing the player proved is no longer
    // true — and the question comes back, because it is unanswered again.
    if (proved.length === 0 && shown.length === 0) continue;
    live.push({ verb: pass.verb, subject: pass.subject, proved, shown });
  }
  return live;
}

/**
 * The `graded` entries the current atlas still bears out.
 *
 * **A `graded` entry certifies one board, and a board is not immortal.** ADR-0047
 * mints proof only on a first submission, on the argument that `gate.ts`
 * certifies a board against guesses from a known information state and models
 * that first submission and nothing after it. The stored key has no such limit,
 * and a post-ship review found what that costs: when a pass **fully decays**
 * — every member fails `stillHolds`, which is the repo having changed enough
 * that the old explanation is void — `livePasses` drops it and the comment there
 * says *"the question comes back, because it is unanswered again."* It came back
 * **permanently unprovable**: the returning board's first honest answer read
 * `first = false`, so its subject could never re-enter `understood` again, under
 * a save ADR-0011 keyed to `repo.root` precisely so it would outlive a reindex.
 * Ark indexes itself, so that is the ordinary case over time and not a corner.
 *
 * And two surfaces then stated something the player could check and disprove:
 * the console's *"this board had already explained itself"* and the note's copy
 * of it, about a board whose current key was never explained — the old one
 * decayed, which is *why* it came back.
 *
 * So a key is live while its subject is, and — where a pass exists for it —
 * while that pass is. A key with no pass is a board that was answered and
 * failed; nothing about it decayed, so it stands.
 *
 * Derived rather than stored, like `Fog`: two representations of one fact
 * disagree after a reindex, which is ADR-0011 decision 2.
 */
export function gradedKeys(progress: Progress, liveness: Liveness): Set<string> {
  const live = new Set(livePasses(progress, liveness).map((pass) => answerKey(pass.verb, pass.subject)));
  const recorded = new Set(progress.passes.map((pass) => answerKey(pass.verb, pass.subject)));
  const keys = new Set<string>();
  for (const key of progress.graded) {
    const subject = key.slice(key.indexOf('\n') + 1);
    if (!liveness.exists(subject)) continue;
    if (recorded.has(key) && !live.has(key)) continue;
    keys.add(key);
  }
  return keys;
}

/** The key a challenge is "answered" under. `(verb, subject)`, never `id`. */
export function answerKey(verb: VerbId, subject: AtlasId): string {
  return `${verb}\n${subject}`;
}

/**
 * The questions the player has actually answered, as `(verb, subject)` keys.
 *
 * Deliberately **not** the same as `fog.understood`. Picking a file correctly in
 * someone else's question promotes it to `understood` — you proved you knew it
 * sits in that answer — but it says nothing about the question *that file* is
 * the subject of. Reading the deck off the fog silently retired questions
 * nobody had answered.
 *
 * **Keyed per verb since M4, and the old comment here predicted exactly why**:
 * collapsing over verbs was correct only while there was one, because a Blast
 * Radius pass would otherwise retire the Companion question about the same
 * file. `Pass` has carried the verb since M3 for this.
 */
export function answeredKeys(progress: Progress, liveness: Liveness): Set<string> {
  return new Set(livePasses(progress, liveness).map((pass) => answerKey(pass.verb, pass.subject)));
}

/**
 * The files whose **own** question of one verb the player has passed.
 *
 * This exists because `fog.understood` is verb-blind and one consumer must not
 * be. `main.ts` unlocks a node's full transitive dependent radius for anything
 * in this set, which is ADR-0008 decision 1: you may see the cone you proved
 * you knew. Feed that rule a verb-blind set the moment a second verb exists and
 * **passing a Companion question prints the answer to the still-open Blast
 * Radius question about the same file** — the M1 hover leak, reopened from the
 * side, and it would have shipped invisibly because no test asks what one
 * verb's pass does to another verb's board.
 *
 * **Subjects only, and the members are excluded for the same reason the other
 * verb is.** This returned `pass.proved` as well until ADR-0016 measured what
 * that costs: a file picked correctly inside S's question got its own full cone
 * drawn while *its own* board was still open, and by ADR-0008's invariant
 * (`candidates ∩ dependents(M, ∞) = truth`) the drawn set intersected with that
 * board is its answer key — measured at `e6f7e2f`, **26 of 40 boards are
 * exposable this way and all 26 recover byte-exact**; 9 of them do in the
 * deck's actual serving order, 6 at once at the worst frame. Hovering S does
 * not substitute: `cone(S)` strictly overapproximates `cone(M)` and can contain
 * M's certified distractors, so it never isolates the key, where `cone(M)`
 * does, precisely.
 *
 * ADR-0008 decision 1 always said this — *"permanently unlocked by passing that
 * node's challenge"* — so the member half was a divergence from the decision of
 * record rather than a decision anyone took. Proving that D depends on S is not
 * proving you know what depends on D.
 *
 * **Not gated on whether M's board is open**, which was the other candidate fix:
 * ADR-0008 forbids it in as many words (*"the rule must not depend on whether a
 * challenge is open, because the leak happens at the moment of choosing the
 * subject"*), and a rule that reads deck state would go stale the moment a
 * question is added.
 *
 * `understood` stays verb-blind on purpose: proving *anything* about a file is
 * a real reason to know its name. It is the radius, not the label, that has to
 * be earned in the verb that asks about it.
 *
 * **Either register unlocks the cone, and that is deliberate** (ADR-0047). The
 * reveal that made the pass a *shown* one had already drawn this cone and named
 * every member of it in words, so withholding the picture afterwards would be
 * ADR-0016's vanishing-payoff defect — a rendering that appears and then
 * withdraws, which this repository has shipped once and has a landmine about.
 * The board is retired either way, so nothing is asked back.
 */
export function subjectsPassed(
  progress: Progress,
  liveness: Liveness,
  verb: VerbId,
): Set<NodeId> {
  const subjects = new Set<NodeId>();
  for (const pass of livePasses(progress, liveness)) {
    // `isNodeId` because the caller draws a cone around each member: a commit
    // subject has no position, and letting one through would make the map's
    // unlock set contain an id `refById` cannot resolve.
    if (pass.verb === verb && isNodeId(pass.subject)) subjects.add(pass.subject);
  }
  return subjects;
}

/**
 * The fog implied by a record, against the atlas currently loaded.
 *
 * `base` is the head start `fog.ts` derives from the graph — the landmarks. It
 * is passed in rather than stored, because it is a property of the repo and not
 * of the player, and a stored copy would go stale the moment the graph moved.
 */
export function deriveFog(
  progress: Progress,
  liveness: Liveness,
  base: Iterable<NodeId> = [],
): Fog {
  const surveyed = new Set<NodeId>();
  for (const id of base) if (liveness.exists(id)) surveyed.add(id);
  for (const id of progress.surveyed) if (liveness.exists(id)) surveyed.add(id);

  const understood = new Set<NodeId>();
  for (const pass of livePasses(progress, liveness)) {
    // **`understood` is the proved register and nothing else** (ADR-0047). This
    // set's contract, stated at the top of this file, is *"you proved you knew
    // something about it, by being graded against ground truth"*, and NORTH-STAR
    // §4 calls the revealed fraction of the map *"a real measure of how much of
    // it you can reason about"*. A playthrough that read every answer off the
    // reveal and typed it back must not light the map, or that sentence is
    // false and the fog is decoration.
    //
    // A shown member still promotes to `surveyed`, which is exactly what it is:
    // you were shown it.
    //
    // A commit subject un-fogs nothing of its own — it is not on the map. Its
    // members still promote, below, which is the whole of what a Placement pass
    // reveals.
    if (isNodeId(pass.subject)) {
      if (pass.proved.length > 0) understood.add(pass.subject);
      surveyed.add(pass.subject);
    }
    for (const member of pass.shown) {
      if (isNodeId(member)) surveyed.add(member);
    }
    // **Node members only, and that filter is new.** `understood` and
    // `surveyed` are sets of *squares*; an Archaeology pass proves commits,
    // which have none. Without this the fog would carry ids `refById` cannot
    // resolve — invisible on the map, and counted in every "how much have I
    // uncovered" number that reads `fog.surveyed.size`.
    for (const member of pass.proved) {
      if (!isNodeId(member)) continue;
      understood.add(member);
      surveyed.add(member);
    }
  }
  return { surveyed, understood };
}
