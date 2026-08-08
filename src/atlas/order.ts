/**
 * Ordering primitives. Every array in the atlas has a defined order, and that
 * order must not depend on the machine that produced it.
 *
 * `String.prototype.localeCompare` is locale-dependent — the same two strings
 * sort differently under `en-US` and `sv-SE`. Using it anywhere in the indexer
 * would break the determinism test on a colleague's laptop and nowhere else,
 * which is the worst kind of bug. Compare code units instead.
 */

/** Total order on strings by UTF-16 code unit. Locale-independent by construction. */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `Array.prototype.sort` comparator over a string key. */
export function byKey<T>(key: (value: T) => string): (a: T, b: T) => number {
  return (a, b) => byteCompare(key(a), key(b));
}

/** True when `values` is sorted ascending under `byteCompare` and has no duplicates. */
export function isStrictlySorted(values: readonly string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev === undefined || cur === undefined) return false;
    if (byteCompare(prev, cur) >= 0) return false;
  }
  return true;
}

/** Sorted copy with duplicates removed. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byteCompare);
}

/**
 * Round to 2 decimal places using only exact IEEE-754 operations, so the result
 * is bit-identical on every conforming platform. See ADR-0003.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The order a *player* meets a subject's questions in: tier ascending, then id.
 *
 * **Not the order the atlas stores them in, and the difference is a defect
 * waiting to happen.** `atlas.challenges` is sorted by challenge id, and an id
 * begins with its verb's name — so `archaeology-…` sorts before `blast-…` and
 * `companion-…`. The map's click path takes the first unanswered question in a
 * node's bucket, so inheriting the id order would have served the tier-5 history
 * question before the tier-3 import question on every subject carrying both,
 * silently inverting NORTH-STAR §5's curriculum on the interaction
 * `selector.ts` calls primary. ADR-0019 decision 8.
 *
 * Here rather than inline in `main.ts` so it is a thing a test can hold: the
 * hazard is invisible in a diff, since the wrong behaviour is what you get by
 * writing no comparator at all.
 */
export function challengeOrder(
  x: { readonly tier: number; readonly id: string },
  y: { readonly tier: number; readonly id: string },
): number {
  return x.tier - y.tier || byteCompare(x.id, y.id);
}
