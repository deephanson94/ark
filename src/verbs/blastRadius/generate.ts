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
import { difficultyOf, surpriseOf } from './difficulty.js';
import { gradeHeuristics } from './gate.js';

/** NORTH-STAR §5: predicting change propagation is tier 3, Coupling. */
const TIER = 3;

/**
 * The largest answer key that still satisfies ADR-0007's 3:1 rule at a given
 * choice-set size. At the default 20 candidates this is 6, which ADR-0007 notes
 * is also about as many files as a person can hold in their head at once.
 */
export function truthCap(candidateCount: number): number {
  return Math.max(0, Math.floor((candidateCount - 1) / 3));
}

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
  | 'ctrlF';

export interface GenerationReport {
  readonly subjectsConsidered: number;
  readonly generated: number;
  /** Sorted by reason. Never silent — CLAUDE.md. */
  readonly skipped: readonly (readonly [SkipReason, number])[];
  /** How many wrong answers each §8.3 strategy actually produced, repo-wide. */
  readonly distractorMix: readonly (readonly [StrategyId, number])[];
}

export interface GenerationResult {
  readonly challenges: readonly Challenge[];
  readonly report: GenerationReport;
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
export function sampleByDistance(
  graph: Graph,
  reached: ReadonlyMap<NodeRef, number>,
  size: number,
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

  const picked: NodeRef[] = [];
  for (let round = 0; picked.length < size; round++) {
    let progressed = false;
    for (const distance of distances) {
      if (picked.length >= size) break;
      const ref = buckets.get(distance)?.[round];
      if (ref === undefined) continue;
      picked.push(ref);
      progressed = true;
    }
    if (!progressed) break;
  }
  return picked;
}

/**
 * Which nodes may appear in a choice set at all.
 *
 * A `.md` or `.json` file cannot import anything, so asking whether it depends
 * on the subject is not a distractor — it is padding, and padding makes a
 * question easier. §8.3's claim is that a question is exactly as good as its
 * wrong answers, so a wrong answer that could never have been right is worse
 * than no wrong answer. They stay on the map; they stay out of the choice set.
 */
function eligibleRefs(atlas: Atlas): Set<NodeRef> {
  const eligible = new Set<NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) if (canImport(node.lang)) eligible.add(ref);
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

  const built: {
    challenge: Challenge;
    subject: NodeRef;
    candidateRefs: readonly NodeRef[];
    mix: readonly DistractorChoice[];
  }[] = [];
  let considered = 0;

  for (const subject of atlas.nodes.keys()) {
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
    const pool = new Set<NodeRef>();
    for (const ref of eligible) {
      if (ref !== subject && !reached.has(ref) && !tainted.has(ref)) pool.add(ref);
    }

    const context = { graph, corpus, subject, pool, coChange: coChange.get(subject) ?? new Map() };

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

    const truthRefs =
      clean.size <= size ? [...clean.keys()] : sampleByDistance(graph, clean, size, breadth);
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
      subject,
      [...truthRefs, ...distractors.map((choice) => choice.ref)],
      truthRefs,
    );
    if (!verdict.passed) {
      note('ctrlF');
      continue;
    }

    const candidateRefs = [...truthRefs, ...distractors.map((choice) => choice.ref)];
    const idOfRef = (ref: NodeRef): string => nodeAt(graph, ref).id;
    const truth = truthRefs.map(idOfRef).sort(byteCompare);
    const candidates = candidateRefs.map(idOfRef).sort(byteCompare);
    const candidateSet = new Set(candidates);

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

    built.push({
      subject,
      candidateRefs,
      challenge: {
        id: `blast-${nodeAt(graph, subject).id.slice(2)}`,
        verb: 'blastRadius',
        tier: TIER,
        difficulty: difficultyOf({
          fanOut: reached.size,
          maxFanOut,
          depth,
          maxDepth,
          surprise: surpriseOf(truth, naive),
        }),
        subject: idOfRef(subject),
        candidates,
        truth,
        evidence: { kind: 'importGraph', depth },
      },
      mix: distractors,
    });
  }

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

  return {
    challenges: kept
      .map((entry) => entry.challenge)
      .sort((a, b) => byteCompare(a.id, b.id)),
    report: {
      subjectsConsidered: considered,
      generated: kept.length,
      skipped: [...skipped].sort(([a], [b]) => byteCompare(a, b)),
      distractorMix: [...totals].sort(([a], [b]) => byteCompare(a, b)),
    },
  };
}

/**
 * Drop to `max` while keeping the difficulty range.
 *
 * Taking the first N by id would ship an arbitrary slice; taking the hardest N
 * would delete the on-ramp. Evenly spaced samples of the difficulty-sorted list
 * keep both ends and the middle, so the progression curve survives the cut on a
 * repo far larger than this one.
 */
function retain<T extends { challenge: Challenge }>(entries: readonly T[], max: number): T[] {
  if (entries.length <= max) return [...entries];
  if (max <= 0) return [];
  const ordered = [...entries].sort(
    (a, b) =>
      a.challenge.difficulty - b.challenge.difficulty ||
      byteCompare(a.challenge.id, b.challenge.id),
  );
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) {
    picked.add(max === 1 ? 0 : Math.round((i * (ordered.length - 1)) / (max - 1)));
  }
  // Even spacing can collide after rounding; backfill from the easy end so the
  // count is exactly `max` whenever there is supply for it.
  for (let i = 0; picked.size < max && i < ordered.length; i++) picked.add(i);
  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => ordered[index])
    .filter((entry): entry is T => entry !== undefined);
}
