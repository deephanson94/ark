/**
 * What a grade does to the fog.
 *
 * Pure, and separate from the console for one reason: this is where the
 * distinction `fog.ts` draws between *surveyed* and *understood* either holds
 * or quietly stops meaning anything. §9 says field notes accumulate facts you
 * have **proven** you know, not facts you were shown, and that distinction is
 * the product. So:
 *
 *   surveyed    every file whose name appeared in the choice set, plus the
 *               subject. You were shown them. That is all `surveyed` claims.
 *   understood  the subject, and the truth members you actually picked —
 *               and only when the score reached the pass threshold.
 *
 * The two halves matter separately. A file you *missed* was in the answer and
 * you did not know it, so promoting it would write a field note you never
 * earned. A file you picked correctly in an answer that came apart overall is
 * as likely to have been a guess as knowledge, so the pass threshold gates the
 * whole promotion rather than each pick.
 *
 * Guardrail 6 is why nothing here can subtract: `survey` and `understand` only
 * ever add, so a wrong answer costs the player exactly nothing.
 */

import type { Challenge } from '../atlas/index.js';
import type { Grade } from '../verbs/index.js';
import { PASS_THRESHOLD } from '../verbs/index.js';
import type { Fog } from './fog.js';
import { survey, understand } from './fog.js';

export interface Progression {
  readonly fog: Fog;
  /** True when this grade unlocked the subject's full radius. */
  readonly unlocked: boolean;
}

export function applyGrade(
  fog: Fog,
  challenge: Challenge,
  grade: Grade,
  threshold = PASS_THRESHOLD,
): Progression {
  let next = survey(fog, challenge.subject);
  for (const id of challenge.candidates) next = survey(next, id);

  const passed = grade.score >= threshold;
  if (passed) next = understand(next, [challenge.subject, ...grade.correct]);
  return { fog: next, unlocked: passed };
}
