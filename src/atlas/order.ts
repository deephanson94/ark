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
