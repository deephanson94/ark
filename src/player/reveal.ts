/**
 * Presentation of a reveal's rows. Pure — no DOM, so it can be tested.
 *
 * `challenge.ts` is a DOM builder with no unit tests at all (the console is
 * covered only by `test:e2e`), so anything in it with a *rule* belongs out here
 * where a rule can be asserted.
 */
import type { RevealNote } from '../verbs/index.js';

export interface AvoidedGroup {
  /** The sentence every member shares. */
  readonly note: string;
  readonly members: readonly RevealNote[];
}

/**
 * The rows a player left alone, grouped by the sentence they share.
 *
 * ADR-0050 gives every candidate a row, which on a twenty-candidate board adds
 * about sixteen. Measured on this repo's deck, the number of *distinct*
 * sentences among them varies enormously by verb:
 *
 * | verb | mean rows | mean distinct sentences |
 * |---|---|---|
 * | archaeology | 15.6 | **2.2** |
 * | blastRadius | 14.5 | **3.3** |
 * | companion | 14.6 | 10.1 |
 * | placement | 15.6 | 11.9 |
 *
 * So on two of the four verbs, rendering a sentence per row makes the panel
 * eight times longer and says two things. Grouping collapses those to two or
 * three blocks and leaves the other two verbs essentially as they were — the
 * groups are mostly singletons there, which is the correct outcome rather than a
 * missed optimisation.
 *
 * Order is the order the rows arrive in, which every verb has already sorted;
 * a group takes the position of its first member, so the result is stable.
 */
export function groupAvoided(notes: readonly RevealNote[]): AvoidedGroup[] {
  const groups = new Map<string, RevealNote[]>();
  for (const note of notes) {
    const at = groups.get(note.note);
    if (at === undefined) groups.set(note.note, [note]);
    else at.push(note);
  }
  return [...groups].map(([note, members]) => ({ note, members }));
}
