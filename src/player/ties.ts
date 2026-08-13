/**
 * History wires: the co-change relation, and the rule for when the map may
 * draw it.
 *
 * Companion asks *"which of these files change with this one"*, graded on
 * `atlas.history.coChange`. Until this module the map had no channel for that
 * answer at all — a Companion pass lifted fog on what it proved and changed
 * nothing else on screen, so NORTH-STAR §4's *"fog lifts around what you
 * proved"* was only half kept for the one verb whose whole point is a coupling
 * the import graph cannot see.
 *
 * ## The disclosure rule, and why it is not the Blast Radius rule
 *
 * ADR-0008 gives Blast Radius **direct importers for everyone, the full cone
 * only for the proved**. The obvious move is to find Companion's equivalent of
 * "direct importers" — a weak tier safe to give away — and there isn't one.
 * Two measured reasons, both in ADR-0016:
 *
 *  - **Blast Radius's free tier is the *bottom* of its answer; any count tier
 *    is the *top* of Companion's.** ADR-0008 could spend depth 1 because the
 *    question lives above it, and §8.4 defines `surprise` against exactly that
 *    guess. Companion's key is sampled **count-descending**
 *    (`companion/cochange.ts`'s `rankCompanions`), so "draw only the strong
 *    pairs" is not a baseline — it is the answer key, pre-sorted, best first.
 *  - **On this repo the key usually *is* the whole row.** Measured
 *    `|truth| / |row(subject)|` over the shipped deck: median **1.00**. There
 *    is no subset of a node's partners that is not key material.
 *
 * So no co-change pair is ever drawn from a node whose Companion question the
 * player has not been shown the answer to. What *is* drawn is exactly the pairs
 * some reveal has already **named in words**.
 *
 * ## Why "named", and not "the subject's row"
 *
 * `companion/reveal.ts` writes a note carrying the co-change count for every
 * board member in the subject's row — correct *and* missed — so answering S
 * hands the player every pair `(S, T)` for `T ∈ truth(S)` in text, before the
 * map draws anything. Rendering those costs no disclosure: it is the picture of
 * a sentence already spoken.
 *
 * The subject's **whole row** is a different act, and the difference is
 * measured rather than argued: on a full clear of this repo the row rule draws
 * 169 pairs where the named rule draws 138 — **31 pairs, 18% of the finished
 * layer, that no reveal ever named**. The reveal's summary states the row's
 * *cardinality* ("has changed with N files in all"); it does not state the
 * *identities*, and ADR-0011 decision 3 is precisely the rule that a count may
 * be shown while the names must be earned.
 *
 * ## The leak this used to name as open is closed, and it was closed upstream
 *
 * This paragraph used to read: *"Two partners can each carry the other in their
 * answer key, so answering P discloses a member of Q's key — **up to 6 of 6 on
 * this repo, measured** … Fixing it is generator-side work — window mutual
 * members the way ADR-0012 re-asks colliding subjects — and ADR-0016 records it
 * as open."*
 *
 * **That fix shipped.** `companion/generate.ts` keeps a `claimed` set of
 * *unordered* pairs — "one matrix cell, one question" — which is ADR-0012's rule
 * applied one level down, to the fact rather than to the key, and it cites the
 * same measurement this paragraph did. So `T ∈ truth(S) ⟹ S ∉ truth(T)`,
 * deck-wide, on any repo. Re-measured on the shipped decks: **0 mutual key
 * members on ark, hono, kysely and graphql-js**, where the figure above says 6
 * of 6. The old sentence was true when written and describes a defect the
 * product no longer has.
 *
 * ## What that leaves the endpoint gate doing, measured
 *
 * The gate below still **fires** — 16 / 28 / 26 / 43 suppressions across those
 * four repos while a partner's board is open — and on none of them could the
 * withheld wire have disclosed anything. Two generator invariants each rule it
 * out independently: `claimed` means the partner's key cannot contain this
 * subject, and the candidate pool excludes *every* file the matrix pairs with
 * the subject, so it cannot even be on the partner's board to be narrowed
 * toward. Measured: **0 wires naming a key member, 0 naming a candidate**, on
 * all four.
 *
 * It is kept rather than deleted, and that is a judgement worth stating. The
 * precedent for deleting it is `selector.ts`'s `sameTruth` flag, removed when
 * `dedupe()` made it unreachable — but that flag could no longer *fire*, and
 * this one fires and is merely ineffective, so removing it changes what is on
 * screen. It is defence in depth for an invariant two files away: relax
 * `claimed`, or let a matrix partner into the pool, and it is load-bearing again
 * the same day. `tests/atlas/atlas.test.ts` now pins the first of those on the
 * real deck rather than on a fixture, so the day it stops holding is a red test.
 */

import type { Atlas, Challenge, NodeRef } from '../atlas/index.js';
import type { Graph } from '../atlas/index.js';
import { channelOf } from '../verbs/index.js';

/**
 * One wire. `a < b` always, so a pair has exactly one identity and a symmetric
 * relation cannot be drawn twice or deduplicated by accident.
 */
export interface Tie {
  readonly a: NodeRef;
  readonly b: NodeRef;
  /** Commits that touched both files, from `atlas.history.coChange`. */
  readonly count: number;
}

export interface Ties {
  /** Every wire the map may draw, sorted for a stable draw order. */
  readonly all: readonly Tie[];
  /** Wires by endpoint, so focusing a node costs a lookup rather than a scan. */
  readonly byNode: ReadonlyMap<NodeRef, readonly Tie[]>;
}

export const NO_TIES: Ties = { all: [], byNode: new Map() };

/** Key for an unordered pair. */
function pairKey(a: NodeRef, b: NodeRef): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * The counts, under one normalised key per pair — `pairKey` orders the ends, so
 * a single entry serves both directions.
 *
 * Rebuilt per call rather than memoised. The call happens on every `remember()`,
 * which includes a plain map click and not only a grade, so "rare" is the wrong
 * word for it; it is cheap that matters, and at the 8,000-pair cap this is a
 * few thousand map writes against a pointer event.
 */
function countIndex(atlas: Atlas): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [a, b, count] of atlas.history.coChange) counts.set(pairKey(a, b), count);
  return counts;
}

/**
 * The wires named by these reveals.
 *
 * `revealed` is the challenges whose answer the player has **passed**;
 * `openBoards` is every co-change subject whose question is still live. There is
 * exactly one caller and exactly one gate — see ADR-0016 decision 3 for the
 * transient second layer that was built, measured at 79% of its own promise
 * evaporating on the next click, and removed.
 *
 * **Every pair is re-checked against the live matrix.** A save outlives the
 * atlas that produced it (ADR-0011: the key is `repo.root`, not `repo.head`),
 * so a stored claim can name a pair this atlas no longer records — and a wire
 * the history does not bear is a false statement drawn in ink. Dropped, not
 * approximated.
 */
export function tiesNamedBy(
  atlas: Atlas,
  graph: Graph,
  revealed: Iterable<Challenge>,
  openBoards: ReadonlySet<NodeRef> = new Set(),
): Ties {
  const counts = countIndex(atlas);
  const seen = new Map<string, Tie>();

  for (const challenge of revealed) {
    // The verb's own declaration, never its name. `Reveal.unlocks` cannot
    // serve here — a restored save has no `Reveal` — so the licence is the
    // static twin on the contract.
    if (channelOf(challenge.verb) !== 'coChangeTies') continue;
    const subject = graph.refById.get(challenge.subject);
    if (subject === undefined || openBoards.has(subject)) continue;
    for (const member of challenge.truth) {
      const partner = graph.refById.get(member);
      if (partner === undefined || partner === subject) continue;
      // **The endpoint gate, and it is pillar 3 rather than a disclosure
      // argument.** The pairs below were all named in a reveal, so drawing
      // them tells the player nothing they were not told. But text in a closed
      // panel is a memory test and ink on the map — which §9 keeps visible
      // *behind* the challenge scrim — is a lookup, concurrent with the board.
      // Two Companion subjects commonly carry each other in their keys, so an
      // ungated layer assembles a later board's answer one answered neighbour
      // at a time: measured, up to **5 of 6** key members drawn beside an open
      // question. Pillar 3 is violated exactly when a challenge can be answered
      // by looking something up instead of reasoning, and a wired answer is the
      // map's Ctrl+F.
      //
      // Blast Radius never has this problem despite drawing every import edge
      // always, and the difference is the general rule: **the map may aggregate
      // what it already draws; only a reveal may introduce a primitive.** A
      // cone is aggregation of visible edges and the aggregating *is* the
      // tested skill. A wire is a primitive, and reading one is not a skill.
      if (openBoards.has(partner)) continue;
      const key = pairKey(subject, partner);
      if (seen.has(key)) continue;
      const count = counts.get(key);
      // Not in the matrix now ⇒ this atlas does not bear the claim. Guardrail 4
      // in the player: a wire we cannot substantiate is not drawn faintly, it
      // is not drawn.
      if (count === undefined) continue;
      seen.set(key, {
        a: Math.min(subject, partner),
        b: Math.max(subject, partner),
        count,
      });
    }
  }

  return indexTies([...seen.values()]);
}

function indexTies(ties: readonly Tie[]): Ties {
  // Sorted so the draw order is a property of the repo rather than of the
  // order the player happened to answer in — the same reason every array in
  // the atlas is sorted before it is serialised.
  const all = [...ties].sort((x, y) => x.a - y.a || x.b - y.b);

  const byNode = new Map<NodeRef, Tie[]>();
  const push = (ref: NodeRef, tie: Tie): void => {
    const bucket = byNode.get(ref);
    if (bucket === undefined) byNode.set(ref, [tie]);
    else bucket.push(tie);
  };
  for (const tie of all) {
    push(tie.a, tie);
    push(tie.b, tie);
  }

  return { all, byNode };
}

/** The wires touching `ref`, or none. */
export function tiesAt(ties: Ties, ref: NodeRef | null): readonly Tie[] {
  return ref === null ? [] : (ties.byNode.get(ref) ?? []);
}

/**
 * Stroke width for a wire, in screen pixels before the camera scale.
 *
 * Logarithmic because counts are not comparable across repos: 2–10 here, and
 * up to **613** on `sveltejs/svelte`. Linear width would make svelte's monsters
 * ribbons and this repo's wires invisible at the same setting.
 */
export function tieWidth(count: number): number {
  return Math.min(3.5, 1 + Math.log2(Math.max(count, 1)) * 0.6);
}
