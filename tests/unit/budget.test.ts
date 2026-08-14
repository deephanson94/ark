/**
 * The CLI's budget verdict.
 *
 * It reports **one** thing — the atlas is over the 5 MiB total — and `src/atlas/budget.ts` records
 * the three richer rules that were built and withdrawn. The assertions that matter are the two
 * *silences*, because each corresponds to a version that shipped a false alarm:
 *
 *   cobra  145.0 KiB at  53 files — 2,801 B/file, which a per-file rate rule called OVER BUDGET
 *   flask  284.3 KiB at  91 files — 3,200 B/file and 6.16 ms/file, likewise
 *
 * Measured on the ADR-0042 corpus, the shipped rule fires on **1 of 19** repos (webpack).
 */
import { describe, expect, it } from 'vitest';

import { MAX_ATLAS_BYTES, REFERENCE_FILES, budgetVerdicts } from '../../src/atlas/budget.js';

const KIB = 1024;

describe('budgetVerdicts', () => {
  it('says nothing for an atlas inside the total', () => {
    // ark at 9b86d12b: 226 files, 379.0 KiB.
    expect(budgetVerdicts(226, 379 * KIB)).toEqual([]);
  });

  it('says nothing about a small repo with a high per-file rate', () => {
    // cobra: 145.0 KiB at 53 files is 2,801 B/file against a 2,621 B/file ceiling — and 2.8% of
    // the total. A per-file rule reports this as OVER BUDGET; this one must not.
    expect(budgetVerdicts(53, 145 * KIB)).toEqual([]);
    // flask: 284.3 KiB at 91 files, 3,200 B/file.
    expect(budgetVerdicts(91, 284.3 * KIB)).toEqual([]);
  });

  it('reports an atlas over the total, with both numbers on the line', () => {
    // webpack at f0246170: 12,626 files, 9,399.5 KiB.
    const verdicts = budgetVerdicts(12_626, 9399.5 * KIB);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.what).toBe('atlas size');
    // Both the measurement and the scale the ceiling is quoted at, or the reader cannot judge it.
    expect(verdicts[0]?.line).toContain('9399.5 KiB');
    expect(verdicts[0]?.line).toContain('12626');
    expect(verdicts[0]?.line).toContain(String(REFERENCE_FILES));
  });

  it('is silent exactly at the ceiling and speaks one byte over', () => {
    expect(budgetVerdicts(1, MAX_ATLAS_BYTES)).toEqual([]);
    expect(budgetVerdicts(1, MAX_ATLAS_BYTES + 1)).toHaveLength(1);
  });

  it('does not depend on the file count', () => {
    // The whole point of dropping the rate: a big atlas is a big download at any N.
    expect(budgetVerdicts(1, MAX_ATLAS_BYTES + 1)).toHaveLength(1);
    expect(budgetVerdicts(1_000_000, MAX_ATLAS_BYTES + 1)).toHaveLength(1);
  });
});
