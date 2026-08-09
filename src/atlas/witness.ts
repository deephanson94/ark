/**
 * The negative witness: **why each wrong answer is on the board**, recorded by
 * the generator that put it there.
 *
 * Every distractor is chosen by a named §8.3 strategy — a directory sibling, a
 * name-alike, a structurally-near non-dependent, a co-change ghost, a commit
 * whose message names a file it never touched. Until now that label died at the
 * return statement: `report.distractorMix` kept the aggregate (*how many* of
 * each) and nothing kept *which*. A reveal wanting to explain a wrong pick had
 * to re-derive a reason from the graph at render time.
 *
 * ## Why re-derivation is not the same thing, measured
 *
 * Re-derivation asks *"what is true of this candidate?"*; the generator asked
 * *"what shall I offer, and why?"* — and the answers differ, because a candidate
 * satisfies several predicates at once and the choice between them was made by a
 * quota, not by a predicate. Measured over every shipped board on two repos
 * (ADR-0020), the sentence today's reveal writes names the strategy that
 * actually chose the candidate on **53.9%** of this repo's distractor slots and
 * **47.9%** of `honojs/hono`'s. **Seven of the seventeen (verb, strategy) pairs
 * are re-derived correctly zero times on either repo**: Companion's and
 * Placement's `treeSibling` and `nameSimilar`, swallowed by the churn arm that
 * runs before them, and Blast Radius's `nameSimilar` and `coChange` and
 * Archaeology's `sibling`, which have no arm to be swallowed by at all.
 *
 * ## Why this file is in `src/atlas/` and not in `src/verbs/`
 *
 * The **format** is part of the atlas contract, because `witness` is a field of
 * `Challenge` and the validator has to refuse a malformed one. The **names** are
 * verb semantics and stay in each verb's `distractors.ts`. That split is
 * `VERB_IDS`'s exactly: the validator cannot import from `src/verbs/` — verbs
 * are built on the atlas, so the dependency only runs one way.
 *
 * ## The format
 *
 * One space-separated token per candidate, positionally aligned with
 * `Challenge.candidates`, and `-` for a candidate that is in the answer key and
 * therefore was never *chosen* as anything. Alignment rather than an object
 * keyed by id because an id is 14 bytes and there are thousands of slots;
 * strategy names rather than an index into a table because a table is a second
 * thing to keep in step, and `disclosure.ts` records what an encoding nobody can
 * read costs. Measured through the real serialiser: +27.0 KiB on this repo
 * (10.8% of the atlas), against +5.9 KiB for one character per candidate — the
 * difference is the price of a field a human can check, and ADR-0020 says why it
 * is worth paying.
 *
 * Both sides of the wall use this module and nothing else knows the format, for
 * the reason `disclosure.ts` gives: two producers and two consumers each
 * building the string is how a one-character disagreement turns a mechanism into
 * a no-op no test can see.
 */

import type { AtlasId, Challenge } from './schema.js';

/**
 * The token for a candidate no strategy chose — i.e. an answer.
 *
 * A single character that cannot occur in a strategy id, so a truth member is
 * impossible to confuse with a class.
 */
export const NO_STRATEGY = '-';

/** Field separator. A strategy id is an identifier, so it can contain no space. */
const SEP = ' ';

/**
 * Encode a witness for one board.
 *
 * `candidates` must already be in its final sorted order — the alignment *is*
 * the contract, and encoding against an unsorted array would produce a string
 * that validates and lies.
 */
export function encodeWitness(
  candidates: readonly AtlasId[],
  chosen: ReadonlyMap<AtlasId, string>,
): string {
  return candidates.map((id) => chosen.get(id) ?? NO_STRATEGY).join(SEP);
}

/**
 * Which strategy chose each candidate, by id.
 *
 * An answer is **absent** from the map rather than present as `-`, so a caller
 * asking about one gets `undefined` — the same answer it gets for a candidate
 * this build does not recognise, which is the safe direction for a panel
 * deciding whether it has anything to say.
 */
export function readWitness(challenge: Challenge): ReadonlyMap<AtlasId, string> {
  const tokens = splitWitness(challenge.witness);
  const found = new Map<AtlasId, string>();
  for (const [index, id] of challenge.candidates.entries()) {
    const token = tokens[index];
    if (token === undefined || token === NO_STRATEGY) continue;
    found.set(id, token);
  }
  return found;
}

/** The tokens of a witness string. Exported for the validator. */
export function splitWitness(witness: string): readonly string[] {
  return witness === '' ? [] : witness.split(SEP);
}

/**
 * A strategy id is `[a-zA-Z]+`.
 *
 * Checked rather than assumed: the validator's job is to refuse an atlas it
 * cannot read, and a token containing the separator would silently shift every
 * candidate after it — a witness that is wrong about the whole tail of a board
 * and parses cleanly.
 */
export function isStrategyToken(token: string): boolean {
  return /^[a-zA-Z]+$/.test(token);
}
