/**
 * Take the best `limit` of a candidate set without sorting all of it.
 *
 * Every distractor strategy ends the same way: score a pool, sort it, keep the
 * first handful. The pool is the interesting part — `placement`'s `treeSibling`
 * scores **1,136,093 candidates across django's deck** to keep 19 apiece — and
 * the sort was **792 ms of that strategy's 1.1 s**, which is 5% of the whole
 * index spent ordering candidates that were never going to be looked at.
 *
 * Measuring is what found that. The first attempt at this was a prefix trie
 * replacing the strategy's scoring walk, on the reasoning that the cost was
 * `anchors × candidates`; it was built, verified byte-identical, and **left the
 * strategy at 1,138 ms against 1,094**. The scan was never the cost. That
 * rewrite is not in the tree, and this comment is where it went.
 *
 * ## Why this is exactly `sort(…).slice(0, limit)` and not an approximation
 *
 * It returns the `limit` smallest under `compare`, in order — identical to
 * sorting and slicing **provided `compare` is a total order on the items**,
 * which every caller's is: each ends in a tiebreak on the node id, and ids are
 * unique. Under a total order there are no ties between distinct items, so the
 * stability difference between a full sort and an incremental insertion cannot
 * be observed.
 *
 * That proviso is the thing to check when adding a caller. A comparator that can
 * return 0 for two different items makes the result order-dependent, and the
 * atlas is a byte-for-byte contract (ADR-0038).
 */

/**
 * The `limit` smallest items under `compare`, in ascending order.
 *
 * Equivalent to `[...items].sort(compare).slice(0, limit)` for a total order,
 * and it is the equivalence rather than the speed that has to hold: the output
 * is serialised into an answer key.
 */
export function topBy<T>(
  items: Iterable<T>,
  limit: number,
  compare: (a: T, b: T) => number,
): T[] {
  if (limit <= 0) return [];
  const best: T[] = [];
  for (const item of items) {
    // The common case by a wide margin once the shortlist is full: one
    // comparison against the worst kept, and the candidate is gone. This is the
    // whole saving — a full sort pays `log n` comparisons for the same
    // candidate, and every comparison here calls back into a score map.
    if (best.length >= limit) {
      const worst = best[best.length - 1] as T;
      if (compare(item, worst) >= 0) continue;
    }
    let low = 0;
    let high = best.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (compare(item, best[mid] as T) < 0) high = mid;
      else low = mid + 1;
    }
    best.splice(low, 0, item);
    if (best.length > limit) best.pop();
  }
  return best;
}
