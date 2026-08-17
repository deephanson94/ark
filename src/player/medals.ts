/**
 * What the player has collected — the session's shape, as a derived view.
 *
 * ## Why this exists
 *
 * Four of ten cold playtesters, from four different backgrounds, independently
 * said the same thing about why they would stop: *"160 left → 159 left is the
 * entire arc"*, *"a quiz queue, not a curriculum"*, *"no session shape, no
 * ending, no chapter"*, *"no arc, no goal, nothing that says I'm getting
 * somewhere"*. The reward for passing a board was a sentence in a modal and a
 * counter going down by one. It was the largest single drag on "would you keep
 * playing" and nothing in the product addressed it.
 *
 * A collection is the right answer for one reason beyond taste: guardrail 6 says
 * **never punish a wrong answer**, and a collection is additive by construction.
 * There is no version of a medal shelf that takes something away.
 *
 * ## Three rules this file exists to obey
 *
 * **1. Derived, never stored.** ADR-0011 makes `Progress` the record and `Fog` a
 * *view* of it, re-checked against the live graph at render, so that a claim the
 * repository no longer supports is dropped rather than shown stale. A medal is
 * the same kind of claim and gets the same treatment: nothing here is persisted,
 * and `medalsFor` is a pure function of `(scene, progress, liveness)`. A medal
 * for a file that has since been deleted simply is not there.
 *
 * **2. Derived, never authored.** Guardrail 2 forbids repo-specific content, so
 * there is no hand-written medal for this repository or any other. A region
 * medal takes its name from the region; the rest are product-level and generic.
 * Every threshold is a fraction of what *this* repository can actually offer.
 *
 * **3. Named for what is checked, not for what sounds good.** This repo has paid
 * for the class-label/gloss gap four times — a witness sentence, a docstring, a
 * guard and a distractor's own selection rule. So: the save records which truth
 * members a player picked (`Pass.proved`) and **not the score**, so "you scored
 * 100%" is *not derivable* and is not offered. What is derivable is full
 * **recall** — you found every member of the key — and that is what the medal
 * says.
 *
 * ## The denominator is the achievable set, not the node count
 *
 * A region medal scored against every node in the region would be unreachable on
 * every repository, because most nodes carry no board and can never come out of
 * the fog. That is the unreachable-threshold bug that made ADR-0034's `hub`
 * detector read 0.0% on hugo, and it is avoided by scoring against the same
 * `provable` set `src/indexer/cli.ts` reports — subjects and truth members, node
 * ids only. One definition with two readers, rather than two that can disagree.
 */

import type { Atlas, Challenge, NodeId, VerbId } from '../atlas/index.js';
import { byteCompare, isNodeId } from '../atlas/index.js';
import { dependents } from '../atlas/graph.js';
import type { Scene } from './scene.js';
import { arrivalOf } from './arrival.js';
import type { Fog } from './fog.js';
import type { Liveness, Progress } from './progress.js';
import { livePasses } from './progress.js';

/**
 * How much of a thing a tier asks for, as a fraction of what is achievable.
 *
 * **Fractions rather than counts**, so a five-file repository and django both
 * have a reachable top tier — the alternative is a bar in absolute files, which
 * is either trivial on one and unreachable on the other.
 *
 * The three values are a **design choice and are labelled as one.** This repo's
 * landmine about thresholds is that a bar chosen for its English is a bar nobody
 * measured, and the honest response here is not to invent a measurement: there
 * is no distribution to read a natural break out of, because the quantity is
 * "how much of this repo has the player finished" and every value in `[0,1]`
 * occurs. A third, two thirds and all of it is the conventional shape of a
 * three-tier collection, and it is chosen for that and nothing else.
 */
const TIERS = [1 / 3, 2 / 3, 1] as const;

/** Bronze, silver, gold — the index into `TIERS` a medal has reached. */
export type Tier = 0 | 1 | 2;

export interface Medal {
  /** Stable across sessions and machines, so the shelf does not reorder. */
  readonly id: string;
  /** What it is called. Derived from the atlas, or product-level and generic. */
  readonly name: string;
  /**
   * What it asserts, in words the player can check against the map.
   *
   * Present-tense and about *them* — the field notes' distinction between what
   * was proved and what was merely shown applies here too, and every medal below
   * is minted from `fog.understood`, which ADR-0047 makes the proved register and
   * nothing else.
   */
  readonly claim: string;
  /** How far along, and how far there is to go. `have >= need` is earned. */
  readonly have: number;
  readonly need: number;
  /** Which tier this row is currently showing, for a graded medal. */
  readonly tier: Tier;
  /** How many tiers this medal has. 1 for a single-shot medal. */
  readonly tiers: number;
  readonly earned: boolean;
  /**
   * Which shelf it sits on. The renderer picks a shape from this, so a family is
   * recognisable before it is read — and an *unearned* medal still has a shape,
   * which is the other half of why this field exists (see `medalArt`).
   */
  readonly shelf: 'territory' | 'reach' | 'craft';
}

/** Nodes some board can actually lift the fog from. */
export function provableNodes(atlas: Atlas): Set<NodeId> {
  const provable = new Set<NodeId>();
  for (const challenge of atlas.challenges) {
    // `isNodeId` on **both** roles. A commit is not a node and cannot come out
    // of the fog, so counting one would inflate the denominator and make a
    // region medal unreachable — the same filter, and the same reason, as
    // `cli.ts`'s coverage line, whose comment records that the member half of it
    // was missing for a milestone.
    if (isNodeId(challenge.subject)) provable.add(challenge.subject);
    for (const id of challenge.truth) if (isNodeId(id)) provable.add(id);
  }
  return provable;
}

/** Where a graded medal stands: which tier it has reached, and the next bar. */
function gradeOf(have: number, achievable: number): { tier: Tier; need: number } {
  // Ceil, so a tier is never satisfied by less than its fraction — and never 0,
  // or a medal with nothing achievable would read as earned. A region with no
  // provable nodes is filtered out before it gets here; this is the guard for
  // the case where that filter is ever loosened.
  const bar = (fraction: number): number => Math.max(1, Math.ceil(achievable * fraction));
  for (let tier = 0; tier < TIERS.length; tier += 1) {
    const need = bar(TIERS[tier] as number);
    if (have < need) return { tier: tier as Tier, need };
  }
  return { tier: 2, need: bar(1) };
}

/**
 * **The fog is handed in, not re-derived here.** The shell already holds one, and
 * two surfaces computing the same population separately is how the Archaeology
 * reveal and its own field note came to disagree on 21 of 26 boards — each
 * internally consistent, each with passing tests, contradicting each other. One
 * fog, two readers.
 */
/**
 * Files reached by a **passing answer**, in either register.
 *
 * ## Why this exists, and why the arc is not scored on `understood`
 *
 * ADR-0047 mints `proved` only on a board's *first* graded submission
 * (`applyGrade`: `first = !gradedKeys(...).has(key)`), so a player who fails a
 * board once can never move its subject into `fog.understood` in that save. That
 * is right for the epistemics — §9's whole point is that a note claims only what
 * was proved, and a board that has already explained itself cannot prove
 * anything — and it was safe while nothing visible depended on the conversion.
 * ADR-0047 §4 says exactly that: *"the only thing a retry cannot do is convert
 * shown into proved"*.
 *
 * **The first version of this shelf hung the arc on it anyway, and that is a
 * lockout.** Measured on this repo, **69 of 187 provable nodes are carried by
 * exactly one board**, so region gold and Cartographer gold required first-try
 * success on every single-carrier board. A cold player's wrong first answers are
 * the learning loop working as designed — *"wrong picks teach"* — and the shelf
 * would have answered them with a finish line they could never reach again,
 * displaying "34 of 35, forever". Guardrail 6 forbids a lockout, and *"a
 * permanently empty trophy is the same feeling with a frame around it"* is this
 * module's own sentence, written about the static case while it shipped the
 * dynamic one.
 *
 * So the two surfaces take the two populations. **The arc is about
 * participation** and counts a passing answer however many attempts it took;
 * **the epistemics stay strict** — `fog.understood`, the field notes and the
 * craft medals are untouched, and ADR-0047 is not amended. The claims say
 * *answered*, which is what is checked.
 */
function answeredNodes(progress: Progress, liveness: Liveness): Set<NodeId> {
  const answered = new Set<NodeId>();
  for (const pass of livePasses(progress, liveness)) {
    if (isNodeId(pass.subject)) answered.add(pass.subject);
    for (const member of [...pass.proved, ...pass.shown]) {
      if (isNodeId(member)) answered.add(member);
    }
  }
  return answered;
}

export function medalsFor(
  scene: Scene,
  progress: Progress,
  liveness: Liveness,
  fog: Fog,
): Medal[] {
  const provable = provableNodes(scene.atlas);
  const medals: Medal[] = [];
  // **A refused deck gets no shelf at all** (ADR-0025). Cartographer would
  // otherwise render "0 of 0 provable files proved" with a `need` of 1 — an
  // impossible goal over a repository that was never asked a question. The
  // guide and the HUD were both bitten by this exact extreme and both
  // special-case it; this is the same landmine, one panel over: a count of zero
  // has more than one cause.
  if (provable.size === 0) return medals;
  const answered = answeredNodes(progress, liveness);

  // ---- territory: one medal per region ------------------------------------
  //
  // This is the "territory goals" two testers asked for by name — *"the headline
  // stat being a region I'm completing (`src/player 3/38`) rather than 159
  // left"* — and it costs no new content, because the legend already prints this
  // exact tally. What it adds is a *finish line*.
  //
  // **Topology regions only.** ADR-0010's rule is that a terrain lump is "files
  // the graph has nothing to say about", drawn in one shared grey precisely so
  // the map does not claim it is a neighbourhood. A medal named after one would
  // make exactly that claim, and `placeArches` refuses them for the same reason.
  for (const region of scene.regions) {
    if (region.kind !== 'topology') continue;
    const members = scene.nodes.filter((node) => node.regionIndex === region.index);
    const achievable = members.filter((node) => provable.has(node.id)).length;
    // A region no question can reach gets no medal rather than an unwinnable
    // one. Risk #4 is that fog reads as the tool hiding things; a permanently
    // empty trophy is the same feeling with a frame around it.
    if (achievable === 0) continue;
    const have = members.filter((node) => answered.has(node.id)).length;
    const { tier, need } = gradeOf(have, achievable);
    medals.push({
      id: `region:${region.id}`,
      name: region.label,
      // **Short, because the name already says which region.** The first draft
      // repeated the label inside the sentence, so a medal for `around
      // src/indexer/build.ts` was four lines tall and the shelf read as a wall
      // of prose rather than a trophy case.
      claim:
        have >= achievable
          ? `all ${achievable} — every file a question can reach`
          : `${have} of ${achievable} files answered`,
      have,
      need,
      tier,
      tiers: TIERS.length,
      earned: have >= need,
      shelf: 'territory',
    });
  }
  medals.sort((a, b) => byteCompare(a.id, b.id));

  // ---- reach: how much of the whole map ------------------------------------
  const answeredProvable = [...answered].filter((id) => provable.has(id)).length;
  const reach = gradeOf(answeredProvable, provable.size);
  medals.push({
    id: 'reach:coverage',
    name: 'Cartographer',
    claim: `${answeredProvable} of ${provable.size} answerable files answered`,
    have: answeredProvable,
    need: reach.need,
    tier: reach.tier,
    tiers: TIERS.length,
    earned: answeredProvable >= reach.need,
    shelf: 'reach',
  });

  // **Verb-blind, and that is the seam rather than shyness.** The `Verb`
  // contract carries no display name — a title lives on `Prompt` and needs a
  // challenge — so a medal that named the four kinds would have to reach into
  // the verbs for wording the console itself is not allowed to know. Counting
  // them says the same thing and generalises for free: a Python repository ships
  // three kinds (ADR-0028) and gets a medal asking for three.
  const kinds = new Set<VerbId>(scene.atlas.challenges.map((challenge) => challenge.verb));
  const met = new Set<VerbId>();
  // **Either register.** The claim says *answered*, and a player who failed a
  // Companion board once and then passed it has answered Companion — reading
  // `proved` alone told them they had not, a sentence they could check against
  // their own play and find false.
  for (const pass of livePasses(progress, liveness)) met.add(pass.verb);
  medals.push({
    id: 'reach:kinds',
    name: 'Every kind of question',
    claim: `${met.size} of ${kinds.size} kinds of question answered`,
    have: met.size,
    need: kinds.size,
    tier: 0,
    tiers: 1,
    earned: kinds.size > 0 && met.size >= kinds.size,
    shelf: 'reach',
  });

  // ---- craft: the two that reward the actual skill -------------------------
  //
  // The product's whole claim is that it teaches propagation past the obvious
  // neighbours. `evidence.depth` is the **measured** furthest hop in a board's
  // key (ADR-0008 §5), so a board with depth >= 3 is one where the answer was
  // genuinely not the direct ring — the thing §8.4's `surprise` term prices and
  // the thing `showsItsKey` exists to keep out of the opening.
  // **Indexed once, not searched per pass.** `blastRadius/distractors.ts` has
  // documented since M2 that tokenising inside a per-subject loop cost 8 s of a
  // 10 s index budget, and M4's Companion did it anyway; a `find` over the whole
  // deck for each pass is the same shape, and this runs on every render.
  const byKey = new Map<string, Challenge>();
  for (const challenge of scene.atlas.challenges) {
    byKey.set(`${challenge.verb}\n${challenge.subject}`, challenge);
  }
  const deep = new Set<string>();
  const swept = new Set<string>();
  for (const pass of livePasses(progress, liveness)) {
    // **Either register**, for the same reason `kinds` uses both: the claim is
    // about what you found, and a retry that found every member found them.
    // Reading `proved` alone printed "0 boards with every member found" directly
    // under a reveal that had just said you found all of them.
    const found = [...pass.proved, ...pass.shown];
    if (found.length === 0) continue;
    const key = `${pass.verb}\n${pass.subject}`;
    const board = byKey.get(key);
    if (board === undefined) continue;

    // **The hop the player actually reached, not the board's own depth.**
    // `evidence.depth` is a property of the *board* — the furthest hop in its
    // key — so checking it earned "Past the obvious" for a pass that found only
    // direct-ring members, and the first unit test enshrined exactly that. The
    // name and the claim are assertions about what the player did, so the check
    // has to be too. Measured on this repo the gap could not fire today (0 of 27
    // deep boards are passable on shallow recall alone), but that is an accident
    // of one repo's distractor mix, and this project has a landmine about a
    // heuristic measured on one mix being backwards on another.
    const subjectRef = scene.graph.refById.get(pass.subject);
    if (subjectRef !== undefined) {
      const hops = dependents(scene.graph, subjectRef, Number.POSITIVE_INFINITY);
      for (const member of found) {
        const ref = scene.graph.refById.get(member);
        if (ref === undefined) continue;
        if ((hops.get(ref) ?? 0) >= 3) {
          deep.add(key);
          break;
        }
      }
    }

    const gotten = new Set(found);
    if (board.truth.every((id) => gotten.has(id))) swept.add(key);
  }
  medals.push({
    id: 'craft:deep',
    name: 'Past the obvious',
    claim:
      deep.size === 0
        ? 'reach a file 3+ hops out from its subject'
        : `${deep.size} ${deep.size === 1 ? 'board' : 'boards'} where you reached 3+ hops out`,
    have: deep.size,
    need: 1,
    tier: 0,
    tiers: 1,
    earned: deep.size > 0,
    shelf: 'craft',
  });
  medals.push({
    id: 'craft:complete',
    name: 'Left nothing behind',
    claim:
      swept.size === 0
        ? 'find every member of one board’s key'
        : `${swept.size} ${swept.size === 1 ? 'board' : 'boards'} with every member found`,
    have: swept.size,
    need: 1,
    tier: 0,
    tiers: 1,
    earned: swept.size > 0,
    shelf: 'craft',
  });

  // The most load-bearing file, from the same function the arrival card uses —
  // so the card's opening sentence and this medal cannot disagree about which
  // file it is. Two surfaces describing one population is the defect ADR's
  // Archaeology reveal and field note had on 21 of 26 boards.
  const landmark = arrivalOf(scene);
  // By **id**, not by label: a label is a basename and is not unique by
  // construction, so `.find` on it is the `.first()` landmine with a different
  // key. `arrivalOf` carries the id for exactly this caller.
  const landmarkId = landmark.landmarkId;
  if (landmarkId !== null && provable.has(landmarkId)) {
    // The keystone is a **craft** medal, so it keeps the strict register: this
    // one is a claim about knowledge rather than about participation.
    const done = fog.understood.has(landmarkId);
    medals.push({
      id: 'craft:landmark',
      name: 'The keystone',
      claim: done
        ? `${landmark.landmark} — proved`
        : `${landmark.landmark} — the file most others lean on`,
      have: done ? 1 : 0,
      need: 1,
      tier: 0,
      tiers: 1,
      earned: done,
      shelf: 'craft',
    });
  }

  return medals;
}

/** How many are earned, for the shelf's own headline. */
export function earnedCount(medals: readonly Medal[]): number {
  return medals.filter((medal) => medal.earned).length;
}
