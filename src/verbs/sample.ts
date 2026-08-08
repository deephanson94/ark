/**
 * Sizing and sampling, shared by every verb that ships a *sample* of an answer.
 *
 * All three functions below existed as byte-identical copies in
 * `blastRadius/`, `companion/` and `placement/` — and `placement/generate.ts`
 * said so out loud about one of them (*"the same expression appears in
 * `companion/generate.ts` for the same reason"*). A fourth verb would have made
 * four copies of each, so they moved here on exactly the precedent
 * `src/verbs/index.ts` records for `difficulty.ts`, `gate.ts` and `paths.ts`:
 * self-contained means a verb owns its *semantics*, not that it hoards shared
 * machinery.
 *
 * Nothing here has verb semantics. `truthCap` is arithmetic on ADR-0007's
 * sizing rule, `spread` is order-agnostic by construction, and `retain` sorts by
 * a field every challenge has.
 */

import type { Challenge } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';

/**
 * The largest answer key that still satisfies ADR-0007's 3:1 rule at a given
 * choice-set size.
 *
 * Arithmetic rather than a policy: selecting everything scores
 * `2t/(t+c)`, which is below the 0.5 pass threshold exactly when `c > 3t`.
 */
export function truthCap(candidateCount: number): number {
  return Math.max(0, Math.floor((candidateCount - 1) / 3));
}

/**
 * `size` members of `items`, spread evenly across the list.
 *
 * Indices are strictly increasing whenever `size <= items.length` (they are
 * `round(i·(L−1)/(size−1))` over a list at least as long as the sample), so the
 * result never collapses to fewer than `size` entries.
 *
 * **Order-agnostic on purpose: the caller decides what "evenly across" means by
 * choosing the ordering, and that choice is a decision each time.** Placement
 * spreads over a *path* ordering, because a commit's file list arrives in an
 * FNV-1a hash shuffle and spreading over noise is stable and meaningless
 * (ADR-0018 decision 4). Archaeology spreads over a *date* ordering, because the
 * meaningful axis for a file's history is time — a sample spread across it is
 * the arc of the file's life rather than its six busiest weeks (ADR-0019
 * decision 3).
 */
export function spread<T>(items: readonly T[], size: number): T[] {
  if (size >= items.length) return [...items];
  const out: T[] = [];
  for (let i = 0; i < size; i++) {
    const at = size === 1 ? 0 : Math.round((i * (items.length - 1)) / (size - 1));
    const item = items[at];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * Drop to `max` while keeping the difficulty range.
 *
 * Evenly spaced samples of the difficulty-sorted list keep both ends and the
 * middle, so the progression curve survives the cut rather than the deck
 * becoming whichever questions sorted first.
 */
export function retain<T extends { challenge: Challenge }>(
  entries: readonly T[],
  max: number,
): T[] {
  if (entries.length <= max) return [...entries];
  if (max <= 0) return [];
  const ordered = [...entries].sort(
    (a, b) =>
      a.challenge.difficulty - b.challenge.difficulty || byteCompare(a.challenge.id, b.challenge.id),
  );
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) {
    picked.add(max === 1 ? 0 : Math.round((i * (ordered.length - 1)) / (max - 1)));
  }
  for (let i = 0; picked.size < max && i < ordered.length; i++) picked.add(i);
  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => ordered[index])
    .filter((entry): entry is T => entry !== undefined);
}
