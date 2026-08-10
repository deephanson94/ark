/**
 * Blast Radius generation — NORTH-STAR §6.1, semantics fixed by ADR-0008.
 *
 * The whole algorithm is one invariant:
 *
 *     candidates ∩ dependents(subject, ∞) = truth
 *
 * Every candidate that depends on the subject at any depth is in the answer
 * key, and any dependent that is not in the answer key never appears in the
 * choice set at all. That is what lets the prompt promise *dependence* without
 * a depth bound, a hop count, or a hedge — and it is why hub subjects can ship
 * a sampled answer key honestly: the files we left out are not on the board.
 *
 * Two things this file must never do:
 *
 *  - **Guess.** Guardrail 4. A subject whose cone contains an unresolved import
 *    or a `probable` edge carries no challenge, because a wrong answer key
 *    destroys trust permanently and a missing challenge costs nothing.
 *  - **Vary.** Same repo ⇒ same challenges, in the same order, on every
 *    machine. There is no `Math.random()` here and there must never be one:
 *    every ordering below is total and tie-broken on node id.
 */

import type { Atlas, Challenge, Graph, NodeRef } from '../../atlas/index.js';
import {
  buildGraph,
  byteCompare,
  canGradeImports,
  canImport,
  dependents,
  isChallengeable,
  nodeAt,
  taintedRefs,
} from '../../atlas/index.js';
import type { GenerateOptions } from '../types.js';
import { DEFAULT_GENERATE_OPTIONS, maxChallengesFor } from '../types.js';
import type { DistractorChoice, StrategyId } from './distractors.js';
import { analyse, mixOf, selectDistractors } from './distractors.js';
import { encodeWitness } from '../../atlas/witness.js';
import { retain, truthCap } from '../sample.js';
import { difficultyOf, hopReach, surpriseOf } from '../difficulty.js';
import { PATH_HEURISTICS, gradeHeuristics, pathSubject } from '../gate.js';

/** NORTH-STAR §5: predicting change propagation is tier 3, Coupling. */
const TIER = 3;


export type SkipReason =
  /** Nothing imports it, so there is no radius to draw. */
  | 'noDependents'
  /** Guardrail 4: an unresolved import or a `probable` edge in the cone. */
  | 'uncertain'
  /** Not enough certified non-dependents to build a choice set that cannot be
   *  passed by selecting everything. */
  | 'tooFewDistractors'
  /** Dropped to stay inside `maxChallenges`. */
  | 'capped'
  /**
   * Pillar 3: a structure-blind heuristic passed the board and no arrangement
   * of the available distractors could stop it. See `gate.ts`.
   */
  | 'ctrlF'
  /**
   * Another subject already asks this exact answer key, and this one has no
   * dependents left over to ask a different question with. See `dedupe()`.
   */
  | 'duplicateKey'
  /**
   * Its language's import graph may not carry an answer key at all
   * (`canGradeImports`, ADR-0024 decision 2). Python is the first: its imports
   * are parsed, resolved and drawn on the map, and they never grade.
   *
   * A reason of its own rather than folding into `uncertain`, because the two
   * are different facts with different remedies — `uncertain` is *this cone has
   * an unresolved import*, which a better repo fixes, and this one is *no repo
   * in this language will ever ship a board*, which only a different ADR does.
   * Reporting them as one number is how a language's absence reads as a
   * property of the repo in front of you.
   */
  | 'ungradedLanguage';

export interface GenerationReport {
  readonly subjectsConsidered: number;
  readonly generated: number;
  /**
   * How many challenges `dedupe` had to re-ask with a different window of the
   * same cone, because another subject already asked their canonical key.
   *
   * Reported rather than inferred, because the alternative is a session reading
   * the re-window code and assuming it does something. It fires 3 times here,
   * 15 on svelte and 0 on vite: if this ever reads 0 everywhere, the branch is
   * dead and CLAUDE.md says to delete it rather than keep testing it.
   */
  readonly reasked: number;
  /**
   * Nodes that no challenge can ever promote to `understood` — they are neither
   * a subject nor a member of any answer key, so their fog can never lift.
   *
   * This is the price of refusing a duplicate, stated out loud: dropping a twin
   * that appears in nobody else's key lowers the ceiling on how much of the map
   * a player can reveal. Measured cost of dedupe: 1 node here, 32 on vite, 114
   * on svelte. Silent truncation reads as success.
   */
  readonly unprovableNodes: number;
  /** Sorted by reason. Never silent — CLAUDE.md. */
  readonly skipped: readonly (readonly [SkipReason, number])[];
  /** How many wrong answers each §8.3 strategy actually produced, repo-wide. */
  readonly distractorMix: readonly (readonly [StrategyId, number])[];
}

export interface GenerationResult {
  readonly challenges: readonly Challenge[];
  readonly report: GenerationReport;
}

/** One assembled board, before the cap and the authoritative guardrail check. */
interface Built {
  readonly challenge: Challenge;
  readonly subject: NodeRef;
  readonly candidateRefs: readonly NodeRef[];
  readonly mix: readonly DistractorChoice[];
  /**
   * How many answer-key files are *not* direct importers of the subject —
   * §8.4's `surprise` before it is divided by anything. `dedupe` picks a group's
   * representative with it, because unlike `difficulty` it depends on nothing
   * outside the subject's own neighbourhood and therefore does not move when
   * some unrelated file changes the repo-wide normalisers.
   */
  readonly nonObvious: number;
}

/** A subject that survived generation, plus what `dedupe` needs to re-ask it. */
interface Pending {
  readonly subject: NodeRef;
  readonly reached: ReadonlyMap<NodeRef, number>;
  readonly clean: ReadonlyMap<NodeRef, number>;
  /** Every certain dependent, best first. `built` holds the head of it. */
  readonly ranked: readonly NodeRef[];
  readonly size: number;
  readonly built: Built;
}

type Assemble = (
  subject: NodeRef,
  reached: ReadonlyMap<NodeRef, number>,
  clean: ReadonlyMap<NodeRef, number>,
  pool: ReadonlySet<NodeRef>,
  truthRefs: readonly NodeRef[],
) => Built | SkipReason;

/**
 * The choice set's raw material: everything eligible that does *not* depend on
 * the subject, and is not tainted.
 *
 * One function rather than two matching loops, because `dedupe` rebuilds a board
 * for a subject the main loop already built one for, and a pool assembled by a
 * slightly different rule would break the invariant in the half of the deck
 * nothing re-checks.
 */
function nonDependents(
  eligible: ReadonlySet<NodeRef>,
  reached: ReadonlyMap<NodeRef, number>,
  tainted: ReadonlySet<NodeRef>,
  subject: NodeRef,
): Set<NodeRef> {
  const pool = new Set<NodeRef>();
  for (const ref of eligible) {
    if (ref !== subject && !reached.has(ref) && !tainted.has(ref)) pool.add(ref);
  }
  return pool;
}

/**
 * The key two challenges are the same question under.
 *
 * Sorted ids joined on a byte no id contains — `NodeId` is `n:` + hex. This is
 * the same comparison the player-side selector makes on `challenge.truth`, and
 * it is deliberately byte-equality rather than a similarity threshold: a Jaccard
 * cutoff would be a magic number with no objective function.
 */
function keyOf(ids: readonly string[]): string {
  return [...ids].sort(byteCompare).join('\n');
}

/**
 * **No answer key is issued twice.**
 *
 * Two subjects can produce a byte-identical answer key, and the M3 selector only
 * stopped them being served back to back. The cause is here. Measured across
 * four repos, every duplicated key came from subjects whose *certain* dependent
 * sets were equal or differed by one file — they are one question wearing two
 * subjects, and on `sveltejs/svelte` 212 of 350 shipped challenges were repeats.
 *
 * There are two populations underneath that symptom and they want opposite
 * treatment, which is why this is not simply a filter:
 *
 *  - **The certain cone is bigger than the key.** The collision is an artifact
 *    of sampling six files out of more. There is unspent supply, so the second
 *    subject is asked about a *different, disjoint* window of its own ranking —
 *    two questions teaching twelve files instead of one fact twice. This fires
 *    3 times on this repo, 15 on svelte and **0 on vite**, and `report.reasked`
 *    counts it on every run so a future session can see it is still alive.
 *  - **The certain cone is the key.** Nothing was sampled away, so there is no
 *    other question to ask — `playground/hmr/hmr.ts` really is the entire
 *    radius of ten different files in `vitejs/vite`. One representative survives
 *    and the rest are refused as `duplicateKey`, counted and printed like every
 *    other refusal. Guardrail 4's logic applies to redundancy too: a question
 *    that teaches nothing costs nothing to leave out.
 *
 * **Beware the raw cone when reading this.** Svelte's duplicate classes look
 * like they have thousands of dependents and hundreds of spare windows; their
 * *certain* cones are 3, 19 and 115 files, because taint removes the rest and
 * only certain dependents may be sampled. The first draft of this comment
 * claimed a 2,745-file class with room for 63 disjoint keys. It has 3.
 *
 * The representative is the member whose key is **least obvious** — the most
 * answer-key files that are not direct importers of the subject, tie-broken on
 * id. The map gives depth 1 away on hover by design (ADR-0008), so that is
 * literally the count of answers the map has not already supplied, and a test
 * pins the direction.
 *
 * Unnormalised is deliberate, and here is exactly how far the evidence goes.
 * `difficultyOf` divides by repo-wide maxima, so ranking a group by difficulty
 * lets an edit *anywhere* reorder it and swap which twin survives; since the
 * save is keyed by `(verb, subject)` (ADR-0011), a swap re-serves a question the
 * player already answered wearing the other subject's name. That flip is
 * derivable — a member ahead on depth and behind on surprise loses its lead as
 * `maxDepth` grows — but it is **not observed**: the two rules choose the same
 * representative on this repo and on svelte and differ on one vite group. So
 * there is deliberately no test pinning the choice of quantity, only its
 * direction. A test asserting a distinction the product does not exhibit is the
 * same mistake as a fallback that never fires.
 *
 * Every group's canonical key is reserved *before* any re-windowing, so a
 * re-sampled board can never take a key another subject was already going to
 * ask. **Measured to change nothing** — zero differing keys across ark, vite and
 * svelte against reserving only the uncontested ones — so it too has no test. It
 * is here because the alternative leaves which group re-windows decided by
 * iteration order, and an asymmetry nobody chose is worth one line to remove.
 *
 * The whole function is a no-op on the part of the deck that was never
 * duplicated: on all four repos every non-colliding challenge is byte-identical
 * to what the generator produced before this existed.
 */
function dedupe(
  pending: readonly Pending[],
  assemble: Assemble,
  eligible: ReadonlySet<NodeRef>,
  tainted: ReadonlySet<NodeRef>,
  note: (reason: SkipReason) => void,
): { kept: Built[]; reasked: number } {
  const groups = new Map<string, Pending[]>();
  for (const entry of pending) {
    const key = keyOf(entry.built.challenge.truth);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }

  // Every canonical key is reserved up front, contested or not. Reserving only
  // the uncontested ones would let an early group's re-windowed board take a key
  // a later group was about to ask under, pushing *that* group into a re-window
  // it did not need — an asymmetry with no justification other than iteration
  // order.
  const issued = new Set(groups.keys());
  const kept: Built[] = [];
  const contested: Pending[][] = [];
  for (const group of groups.values()) {
    if (group.length === 1 && group[0] !== undefined) kept.push(group[0].built);
    else contested.push(group);
  }
  // Deterministic across groups as well as within them: `pending` is in node
  // order, which is id order, so the first member's id totally orders the groups.
  contested.sort((a, b) =>
    byteCompare(a[0]?.built.challenge.id ?? '', b[0]?.built.challenge.id ?? ''),
  );

  let reasked = 0;
  for (const group of contested) {
    const ordered = [...group].sort(
      (a, b) =>
        b.built.nonObvious - a.built.nonObvious ||
        byteCompare(a.built.challenge.id, b.built.challenge.id),
    );
    const [representative, ...rest] = ordered;
    if (representative === undefined) continue;
    kept.push(representative.built);
    for (const entry of rest) {
      const rebuilt = reask(entry, assemble, eligible, tainted, issued);
      if (rebuilt === null) {
        note('duplicateKey');
        continue;
      }
      issued.add(keyOf(rebuilt.challenge.truth));
      reasked++;
      kept.push(rebuilt);
    }
  }
  return { kept, reasked };
}

/**
 * Ask the same subject about a later slice of its own ranking.
 *
 * Windows are disjoint and taken in rank order, so window 1 is the best answer
 * key that shares no file with window 0 — the collision is resolved by moving
 * *outward* through the cone rather than by perturbing the sample, which would
 * produce two keys differing in one file and teach the second thing twice.
 *
 * Only whole windows are used. A short tail would silently shrink the answer key
 * below the size ADR-0007's 3:1 rule was checked at, and a board that cannot be
 * built to the same standard is one we do not ship.
 */
function reask(
  entry: Pending,
  assemble: Assemble,
  eligible: ReadonlySet<NodeRef>,
  tainted: ReadonlySet<NodeRef>,
  issued: ReadonlySet<string>,
): Built | null {
  const { ranked, size, subject, reached, clean } = entry;
  const windows = Math.floor(ranked.length / size);
  if (windows < 2) return null;
  const pool = nonDependents(eligible, reached, tainted, subject);
  for (let window = 1; window < windows; window++) {
    const truthRefs = ranked.slice(window * size, window * size + size);
    const outcome = assemble(subject, reached, clean, pool, truthRefs);
    // A refused window says nothing about the next one, so the search continues
    // rather than giving up. **Measured to never fire**: across ark, vite,
    // svelte and vue no re-asked board was ever refused by the gate or the
    // sizing rule, because a later window of the same cone faces the same pool.
    // It is here because `assemble` returns a union and the case must be
    // handled, not because it is a rescue path — there are no tests around it.
    if (typeof outcome === 'string') continue;
    if (issued.has(keyOf(outcome.challenge.truth))) continue;
    return outcome;
  }
  return null;
}

/**
 * A deterministic, distance-stratified sample of a hub's dependents.
 *
 * ADR-0008 §2: "a hub sample of six direct importers is answerable straight
 * from the map" — the map gives away depth 1 by design, so a sample that is all
 * depth 1 is a question with no content. Round-robin from the *deepest* bucket
 * first guarantees the far members survive the cut, which are the ones that
 * carry the lesson: for `src/atlas/schema.ts` the interesting fact is that the
 * barrel at `src/atlas/index.ts` explodes the cone at hop 2.
 *
 * Within a bucket, **the most discriminating dependent first**, measured as the
 * smallest transitive dependency set of its own. This is not a refinement, it
 * is the difference between a question and a formality. A file that depends on
 * sixty of the repo's seventy files depends on the subject too, and knowing
 * that teaches nothing — it is true of nearly every subject you could name. A
 * file that depends on three says something specific about which three.
 *
 * The first version of this ranked by in-degree instead ("hubs are memorable"),
 * and it produced seven groups of subjects with **byte-identical answer keys**:
 * every module under `src/indexer/` answered `atlas-hash, budget, e2e, build,
 * atlas.test` plus its own unit test, so the question collapsed into "which
 * test file shares this name" — pillar 3's Ctrl+F failure, arrived at from the
 * other direction.
 */
export function rankByDistance(
  graph: Graph,
  reached: ReadonlyMap<NodeRef, number>,
  breadth: ReadonlyMap<NodeRef, number>,
): NodeRef[] {
  const buckets = new Map<number, NodeRef[]>();
  for (const [ref, distance] of reached) {
    const bucket = buckets.get(distance);
    if (bucket === undefined) buckets.set(distance, [ref]);
    else bucket.push(ref);
  }
  const distances = [...buckets.keys()].sort((a, b) => b - a);
  for (const distance of distances) {
    buckets.get(distance)?.sort(
      (a, b) =>
        (breadth.get(a) ?? 0) - (breadth.get(b) ?? 0) ||
        (graph.in[b] ?? []).length - (graph.in[a] ?? []).length ||
        byteCompare(nodeAt(graph, a).id, nodeAt(graph, b).id),
    );
  }

  const ranked: NodeRef[] = [];
  for (let round = 0; ; round++) {
    let progressed = false;
    for (const distance of distances) {
      const ref = buckets.get(distance)?.[round];
      if (ref === undefined) continue;
      ranked.push(ref);
      progressed = true;
    }
    if (!progressed) break;
  }
  return ranked;
}

/**
 * The best `size` dependents to ask about — the head of `rankByDistance`.
 *
 * `dedupe()` takes *later* windows of the same order when two subjects would
 * otherwise ship the same answer key, which is why the ranking is a separate,
 * total function rather than a truncating one.
 */
export function sampleByDistance(
  graph: Graph,
  reached: ReadonlyMap<NodeRef, number>,
  size: number,
  breadth: ReadonlyMap<NodeRef, number>,
): NodeRef[] {
  return rankByDistance(graph, reached, breadth).slice(0, size);
}

/**
 * Which nodes may appear in a choice set at all.
 *
 * A `.md` or `.json` file cannot import anything, so asking whether it depends
 * on the subject is not a distractor — it is padding, and padding makes a
 * question easier. §8.3's claim is that a question is exactly as good as its
 * wrong answers, so a wrong answer that could never have been right is worse
 * than no wrong answer. They stay on the map; they stay out of the choice set.
 *
 * **`canGradeImports`, not `canImport`** — the two were one predicate until
 * Python, which is parsed and mapped and may never grade a question
 * (ADR-0024 decision 2). A Python file is excluded from this set as a
 * *subject* and as a *candidate* alike: its own cone is unsound, and offering
 * it as a wrong answer would certify a non-dependence the seven computed
 * `import_module(expr)` sites make unknowable.
 */
/**
 * Nodes the scanner **parses** and whose imports may not grade a question.
 *
 * Distinct from the complement of `eligibleRefs`, which also holds terrain, and
 * the distinction is the report rather than the deck: a `.md` file is not a
 * subject because nothing imports it (`noDependents`), and a Python file is not
 * a subject because no Python file ever is. Folding the two together made
 * `flask` report **91** refusals over 83 Python files, which reads as a fact
 * about the repo instead of a fact about the language.
 */
function ungradedRefs(atlas: Atlas): Set<NodeRef> {
  const ungraded = new Set<NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) {
    if (canImport(node.lang) && !canGradeImports(node.lang)) ungraded.add(ref);
  }
  return ungraded;
}

function eligibleRefs(atlas: Atlas): Set<NodeRef> {
  const eligible = new Set<NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) if (canGradeImports(node.lang)) eligible.add(ref);
  return eligible;
}

function coChangeBySubject(atlas: Atlas): Map<NodeRef, Map<NodeRef, number>> {
  const byRef = new Map<NodeRef, Map<NodeRef, number>>();
  const add = (from: NodeRef, to: NodeRef, count: number): void => {
    const bucket = byRef.get(from);
    if (bucket === undefined) byRef.set(from, new Map([[to, count]]));
    else bucket.set(to, count);
  };
  for (const [a, b, count] of atlas.history.coChange) {
    add(a, b, count);
    add(b, a, count);
  }
  return byRef;
}

export function generateBlastRadius(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): readonly Challenge[] {
  return generateWithReport(atlas, options).challenges;
}

export function generateWithReport(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): GenerationResult {
  const graph = buildGraph(atlas);
  // Path segments and name tokens, computed once. Doing this inside the
  // per-subject loop cost 8 s of a 10 s index budget at 2,000 files.
  const corpus = analyse(graph);
  const eligible = eligibleRefs(atlas);
  const coChange = coChangeBySubject(atlas);
  // Guardrail 4, precomputed. A node is tainted when anything in its dependency
  // closure has an unresolved import or a `probable` outgoing edge — which is
  // exactly `isChallengeable`'s verdict, computed once for the whole graph
  // instead of once per candidate. `isChallengeable` still has the final say on
  // every assembled choice set below; this only avoids doing that work for
  // subjects that were never going to survive it.
  const tainted = taintedRefs(graph);
  const ungraded = ungradedRefs(atlas);

  const cap = truthCap(options.candidateCount);
  const skipped = new Map<SkipReason, number>();
  const note = (reason: SkipReason): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  // Per-repo normalisers for §8.4. Computed over every node, not just the
  // challengeable ones, so difficulty describes a question's place in *this
  // repo* rather than its place among the questions that happened to ship.
  const radii = new Map<NodeRef, Map<NodeRef, number>>();
  // How many files each node transitively depends on. Falls out of the same
  // sweep for free: X is in `dependents(Y)` exactly when Y is in
  // `dependencies(X)`, so counting the former by target counts the latter by
  // source. `sampleByDistance` uses it to prefer discriminating dependents.
  const breadth = new Map<NodeRef, number>();
  let maxFanOut = 0;
  let maxDepth = 1;
  for (const ref of atlas.nodes.keys()) {
    const reached = dependents(graph, ref, Number.POSITIVE_INFINITY);
    radii.set(ref, reached);
    maxFanOut = Math.max(maxFanOut, reached.size);
    for (const [dependent, distance] of reached) {
      maxDepth = Math.max(maxDepth, distance);
      breadth.set(dependent, (breadth.get(dependent) ?? 0) + 1);
    }
  }

  /**
   * Everything a subject needs to be asked about, once its cone is known.
   *
   * `assemble` is called twice for a colliding subject — once for the canonical
   * answer key and again for a later window of the same ranking — so the board,
   * the distractors, the Ctrl+F gate and the computed difficulty all live in one
   * place. A second code path that built a board slightly differently is exactly
   * how an answer key goes wrong.
   */
  const assemble = (
    subject: NodeRef,
    reached: ReadonlyMap<NodeRef, number>,
    clean: ReadonlyMap<NodeRef, number>,
    pool: ReadonlySet<NodeRef>,
    truthRefs: readonly NodeRef[],
  ): Built | SkipReason => {
    const size = truthRefs.length;
    const context = {
      graph,
      corpus,
      subject,
      pool: new Set(pool),
      coChange: coChange.get(subject) ?? new Map(),
    };
    const want = Math.min(pool.size, options.candidateCount - size);

    // Assemble, then check the board against the structure-blind heuristics
    // (ADR-0010 decision 4, `gate.ts`).
    //
    // There is no repair pass, and that is a measured decision rather than an
    // omission. One was written: on a beaten board, re-mix with the quota
    // weighted toward whichever strategy punishes the heuristic that won. It
    // **rescued zero boards on both this repo and vitejs/vite**, because §8.3's
    // default mix already *is* the repair — it spends 25% on tree-siblings and
    // 20% on name-alikes precisely to defeat these two guesses. A board they
    // still beat is one where that supply does not exist, and re-weighting an
    // empty supply changes nothing. The loop was deleted rather than shipped
    // untested.
    const distractors: readonly DistractorChoice[] = selectDistractors(context, want);
    const verdict = gradeHeuristics(
      graph,
      pathSubject(graph, subject),
      [...truthRefs, ...distractors.map((choice) => choice.ref)],
      truthRefs,
      PATH_HEURISTICS,
    );
    if (!verdict.passed) return 'ctrlF';

    const candidateRefs = [...truthRefs, ...distractors.map((choice) => choice.ref)];
    const idOfRef = (ref: NodeRef): string => nodeAt(graph, ref).id;
    const truth = truthRefs.map(idOfRef).sort(byteCompare);
    const candidates = candidateRefs.map(idOfRef).sort(byteCompare);
    const candidateSet = new Set(candidates);
    // Encoded here rather than at the end of generation, so `dedupe`'s re-asked
    // boards get theirs from the same line as everybody else's. A second place
    // that built a witness is a second place it could be built against an
    // unsorted candidate list, which validates and lies.
    const witness = encodeWitness(
      candidates,
      new Map(distractors.map((choice) => [idOfRef(choice.ref), choice.strategy])),
    );

    // `evidence.depth` is measured, not prescribed (ADR-0008 §5): the furthest
    // the answer key actually travels, so `explain()` can state it as fact.
    let depth = 1;
    for (const ref of truthRefs) depth = Math.max(depth, clean.get(ref) ?? 1);

    // §8.4's naive guess: what you would answer knowing only the direct
    // importers — which is exactly what the map gives away on hover.
    const naive: string[] = [];
    for (const edge of graph.in[subject] ?? []) {
      const id = idOfRef(edge.from);
      if (candidateSet.has(id)) naive.push(id);
    }

    return {
      subject,
      candidateRefs,
      nonObvious: truth.length - naive.length,
      challenge: {
        id: `blast-${nodeAt(graph, subject).id.slice(2)}`,
        verb: 'blastRadius',
        tier: TIER,
        difficulty: difficultyOf({
          breadth: reached.size,
          maxBreadth: maxFanOut,
          // `hopReach` is `difficultyOf`'s old inline depth term, moved beside
          // the formula when Companion needed `reach` to be a fraction rather
          // than a hop count. Identical arithmetic: the numbers this verb
          // produced before M4 are the numbers it produces now.
          reach: hopReach(depth, maxDepth),
          surprise: surpriseOf(truth, naive),
        }),
        subject: idOfRef(subject),
        candidates,
        truth,
        witness,
        evidence: { kind: 'importGraph', depth },
      },
      mix: distractors,
    };
  };

  const pending: Pending[] = [];
  let considered = 0;

  for (const subject of atlas.nodes.keys()) {
    // **Before anything else, and before `considered` counts it.** A Python
    // node is not a Blast Radius subject and not a wrong answer, by language
    // rather than by taint — see `canGradeImports`. Leaving it to guardrail 4
    // would be an accident that happens to hold: a Python file whose whole
    // cone resolves would ship a board, and *whether the deck exists* would
    // depend on how dynamic that particular repo is. `flask` has 32 such
    // subjects and django 976.
    if (ungraded.has(subject)) {
      note('ungradedLanguage');
      continue;
    }
    const reached = radii.get(subject) ?? new Map<NodeRef, number>();
    if (reached.size === 0) {
      note('noDependents');
      continue;
    }
    considered++;
    if (tainted.has(subject)) {
      note('uncertain');
      continue;
    }

    // The answer key may only contain dependents we are *certain* about.
    //
    // Reachability is sound over `certain` edges — an unknown import can only
    // add reachability, never remove it — so a tainted dependent really is a
    // dependent. But putting one on the board drags its unsound cone into the
    // choice set, and `isChallengeable` then refuses the whole question.
    // Because unsampled dependents are banned from the board anyway (the
    // invariant), leaving them out costs nothing and keeps the challenge.
    //
    // Measured on vitejs/vite: 111 of 361 otherwise-answerable subjects have a
    // tainted file somewhere in their radius, and sampling blindly threw
    // **14 of 40** shipped challenges into the final gate for no reason.
    const clean = new Map<NodeRef, number>();
    for (const [ref, distance] of reached) if (!tainted.has(ref)) clean.set(ref, distance);
    if (clean.size === 0) {
      // Everything that depends on it is unsound. Nothing certain left to ask.
      note('uncertain');
      continue;
    }

    // Every dependent is banned from the choice set unless it is in the answer
    // key. This is the invariant, and it is enforced here rather than checked
    // later, because "check afterwards" is how an answer key goes wrong.
    const pool = nonDependents(eligible, reached, tainted, subject);

    // Size the answer key downward until the choice set can be made large
    // enough that selecting everything fails (ADR-0007: |candidates| > 3·|truth|,
    // i.e. `want > 2·size`). Shrinking `truth` is the right lever rather than
    // padding `candidates`, because the pool is finite and padding it with
    // distant files makes the question easier, not harder.
    let size = 0;
    for (let attempt = Math.min(cap, clean.size); attempt >= 1; attempt--) {
      if (Math.min(pool.size, options.candidateCount - attempt) > 2 * attempt) {
        size = attempt;
        break;
      }
    }
    if (size === 0) {
      note('tooFewDistractors');
      continue;
    }

    const ranked = rankByDistance(graph, clean, breadth);
    const outcome = assemble(subject, reached, clean, pool, ranked.slice(0, size));
    if (typeof outcome === 'string') {
      note(outcome);
      continue;
    }
    pending.push({ subject, reached, clean, ranked, size, built: outcome });
  }


  const { kept: built, reasked } = dedupe(pending, assemble, eligible, tainted, note);

  const limit = options.maxChallenges ?? maxChallengesFor(atlas.nodes.length);
  const shortlist = retain(built, limit);
  for (let i = shortlist.length; i < built.length; i++) note('capped');

  // The authoritative guardrail-4 check, on the exact sets the player will see.
  //
  // It runs here rather than inside the loop above for a measured reason: it
  // costs O(candidates · edges) per challenge, and on a 2,000-file fixture
  // running it per *considered* subject took **15.3 s of the 10 s index
  // budget** — 1,860 of those 1,900 challenges were then dropped by the cap, so
  // nearly all of that work was spent certifying questions nobody would ever
  // see. Running it on the shortlist is the same guarantee for 2% of the cost.
  //
  // `tainted` has already refused these subjects and candidates by the
  // equivalent rule, so nothing is expected to fail here. It stays because
  // "expected" is not "guaranteed", and this is the guardrail whose failure
  // mode is a wrong answer key.
  const kept = shortlist.filter((entry) => {
    const verdict = isChallengeable(
      graph,
      entry.subject,
      entry.candidateRefs,
      Number.POSITIVE_INFINITY,
    );
    if (!verdict.ok) note('uncertain');
    return verdict.ok;
  });

  const totals = new Map<StrategyId, number>();
  for (const entry of kept) {
    for (const [strategy, count] of mixOf(entry.mix)) {
      totals.set(strategy, (totals.get(strategy) ?? 0) + count);
    }
  }

  // What a player can ever prove they know. `progress.ts` promotes a node only
  // as the subject of a passed challenge or as a correctly picked member of some
  // answer key, so anything in neither position is permanently fogged.
  const provable = new Set<string>();
  for (const entry of kept) {
    provable.add(entry.challenge.subject);
    for (const id of entry.challenge.truth) provable.add(id);
  }

  return {
    challenges: kept
      .map((entry) => entry.challenge)
      .sort((a, b) => byteCompare(a.id, b.id)),
    report: {
      subjectsConsidered: considered,
      generated: kept.length,
      reasked,
      unprovableNodes: atlas.nodes.length - provable.size,
      skipped: [...skipped].sort(([a], [b]) => byteCompare(a, b)),
      distractorMix: [...totals].sort(([a], [b]) => byteCompare(a, b)),
    },
  };
}

