/**
 * What a grade does to the fog.
 *
 * `fog.ts` draws a distinction the whole product rests on — *surveyed* is what
 * you were shown, *understood* is what you proved — and this is the only place
 * that can quietly collapse it. Every assertion below is really the same
 * assertion: that a fact you did not earn never becomes a fact you know.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge } from '../../src/atlas/index.js';
import { CLEAR_FOG } from '../../src/player/fog.js';
import { applyGrade } from '../../src/player/progress.js';
import { PASS_THRESHOLD, gradeSet } from '../../src/verbs/index.js';

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `n:${i.toString(16).padStart(12, '0')}`);
}

const candidates = ids(21);
const subject = candidates[20] ?? '';
const truth = candidates.slice(0, 4);
const challenge: Challenge = {
  id: 'blast-fixture',
  verb: 'blastRadius',
  tier: 3,
  difficulty: 0.5,
  subject,
  candidates: candidates.slice(0, 20),
  truth,
  evidence: { kind: 'importGraph', depth: 2 },
};

describe('applyGrade', () => {
  it('surveys everything the player was shown, whatever they scored', () => {
    const grade = gradeSet(challenge, { picked: [] });
    const { fog, unlocked } = applyGrade(CLEAR_FOG, challenge, grade);
    expect(unlocked).toBe(false);
    expect(fog.surveyed.size).toBe(21);
    for (const id of challenge.candidates) expect(fog.surveyed.has(id)).toBe(true);
    expect(fog.surveyed.has(subject)).toBe(true);
  });

  it('promotes nothing to understood below the pass threshold', () => {
    // Two of four right and three wrong: precision 0.4, recall 0.5, F1 ≈ 0.44.
    // Two-and-two lands exactly *on* 0.5, which would make this pass for the
    // wrong reason.
    const grade = gradeSet(challenge, {
      picked: [...truth.slice(0, 2), candidates[10] ?? '', candidates[11] ?? '', candidates[12] ?? ''],
    });
    expect(grade.score).toBeLessThan(PASS_THRESHOLD);
    expect(applyGrade(CLEAR_FOG, challenge, grade).fog.understood.size).toBe(0);
  });

  it('promotes the subject and the picks that were right, on a pass', () => {
    const grade = gradeSet(challenge, { picked: [...truth.slice(0, 3)] });
    expect(grade.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    const { fog, unlocked } = applyGrade(CLEAR_FOG, challenge, grade);
    expect(unlocked).toBe(true);
    expect(fog.understood.has(subject)).toBe(true);
    for (const id of truth.slice(0, 3)) expect(fog.understood.has(id)).toBe(true);
  });

  it('never promotes a member of the answer the player missed', () => {
    // The load-bearing one. Promoting a missed file would write a field note
    // claiming the player knows something they demonstrably did not.
    const grade = gradeSet(challenge, { picked: [...truth.slice(0, 3)] });
    const { fog } = applyGrade(CLEAR_FOG, challenge, grade);
    const missed = truth[3] ?? '';
    expect(grade.missed).toContain(missed);
    expect(fog.understood.has(missed)).toBe(false);
    expect(fog.surveyed.has(missed)).toBe(true);
  });

  it('never promotes a spurious pick', () => {
    const grade = gradeSet(challenge, { picked: [...truth, candidates[9] ?? ''] });
    const { fog } = applyGrade(CLEAR_FOG, challenge, grade);
    expect(grade.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(fog.understood.has(candidates[9] ?? '')).toBe(false);
  });

  it('takes nothing away — guardrail 6', () => {
    const before = applyGrade(CLEAR_FOG, challenge, gradeSet(challenge, { picked: truth })).fog;
    const after = applyGrade(before, challenge, gradeSet(challenge, { picked: [] })).fog;
    for (const id of before.understood) expect(after.understood.has(id)).toBe(true);
    for (const id of before.surveyed) expect(after.surveyed.has(id)).toBe(true);
  });
});
