/**
 * The CLI's budget verdicts.
 *
 * The point of these assertions is the **distinction** between a rate breach and an absolute one,
 * because each of the two obvious single-rule versions is wrong in a way this repo has already paid
 * for once:
 *
 *   rate only     — fires on **no repo** in the ADR-0042 corpus (typeorm 1,060 B/file and 3.99
 *                   ms/file, django 1,002 and 4.01, webpack 762 and 4.47, against 2,621 and 5.00).
 *                   A check that never fires is the never-fires landmine.
 *   absolute only — calls django's 13.5 s at 3,035 files a breach, which is exactly the error
 *                   ADR-0038 spent a milestone correcting.
 *
 * Measured on the shipped rule: it fires on **1 of the corpus's 19 repos**, webpack, whose atlas is
 * 9,399.5 KiB.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ATLAS_BYTES,
  MAX_BYTES_PER_FILE,
  MAX_INDEX_MS,
  MAX_MS_PER_FILE,
  REFERENCE_FILES,
  budgetVerdicts,
} from '../../src/atlas/budget.js';

const KIB = 1024;

describe('budgetVerdicts', () => {
  it('says nothing when everything is inside its ceiling', () => {
    // ark at 9b86d12b: 226 files, 379.0 KiB, 587 ms.
    expect(budgetVerdicts(226, 379 * KIB, 587)).toEqual([]);
  });

  it('says nothing for a repo past the absolute time figure but inside the rate', () => {
    // django at c9eb16a87e: 3,035 files, 12,175 ms — 4.01 ms/file. ADR-0038's whole point.
    const verdicts = budgetVerdicts(3035, 2970 * KIB, 12_175);
    expect(verdicts.filter((v) => v.what === 'index time')).toEqual([]);
  });

  it('reports a large atlas as absolute, not as a breach', () => {
    // webpack at f0246170: 12,626 files, 9,399.5 KiB — 762 B/file, inside 2,621.
    const verdicts = budgetVerdicts(12_626, 9399.5 * KIB, 56_400);
    const size = verdicts.filter((v) => v.what === 'atlas size');
    expect(size).toHaveLength(1);
    expect(size[0]?.kind).toBe('absolute');
    // The sentence must carry both numbers, or a reader cannot tell which question it answered.
    expect(size[0]?.line).toContain('9399.5 KiB');
    expect(size[0]?.line).toContain('762');
    expect(size[0]?.line).not.toContain('OVER BUDGET');
  });

  it('reports a genuine rate breach as a breach', () => {
    // Half the reference scale at 1.5x the per-file cost: absolute is inside, rate is not.
    // (2x lands exactly ON the absolute ceiling, which is the boundary rather than the case.)
    const files = REFERENCE_FILES / 2;
    const bytes = files * MAX_BYTES_PER_FILE * 1.5;
    expect(bytes).toBeLessThan(MAX_ATLAS_BYTES);
    const size = budgetVerdicts(files, bytes, 1).filter((v) => v.what === 'atlas size');
    expect(size).toHaveLength(1);
    expect(size[0]?.kind).toBe('rate');
    expect(size[0]?.line).toContain('OVER BUDGET');
  });

  it('reports a time breach by rate at any scale', () => {
    const overSmall = budgetVerdicts(10, 1, 10 * MAX_MS_PER_FILE + 1);
    const overLarge = budgetVerdicts(10_000, 1, 10_000 * MAX_MS_PER_FILE + 1);
    for (const verdicts of [overSmall, overLarge]) {
      const time = verdicts.filter((v) => v.what === 'index time');
      expect(time).toHaveLength(1);
      expect(time[0]?.kind).toBe('rate');
    }
    // …and stays quiet just under it, at both scales.
    expect(budgetVerdicts(10, 1, 10 * MAX_MS_PER_FILE - 1).filter((v) => v.what === 'index time')).toEqual([]);
  });

  it('is empty rather than dividing by zero on a repo with no files', () => {
    expect(budgetVerdicts(0, 999 * MAX_ATLAS_BYTES, 999 * MAX_INDEX_MS)).toEqual([]);
  });
});
