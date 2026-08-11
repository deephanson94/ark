/**
 * The select-all exploit, and the rule that closes it (ADR-0035).
 *
 * The exploit a playtester found in two clicks: tick every candidate, score
 * ~10%, read the full annotated answer key off the reveal, reopen the board,
 * tick what it named — `S · 100% · exact`, a pass, and a **field note**. Field
 * notes are NORTH-STAR §9's *"facts you have proven you know, not facts you were
 * shown"*, so the exploit falsifies the one claim the product makes about itself.
 *
 * What is asserted here is the whole rule, in both directions: select-all is
 * refused, and the honest near-miss is **not**.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge } from '../../src/atlas/index.js';
import type { Grade, Reveal } from '../../src/verbs/types.js';
import { REVEAL_PRECISION_BAR, asEarned, precisionOf } from '../../src/verbs/withhold.js';
import { blastRadius } from '../../src/verbs/blastRadius/index.js';
import { buildGraph, nodeIdFor } from '../../src/atlas/index.js';
import { atlasWith, atlasWithChallenge, challengeFor } from '../fixtures/atlas.js';

const PATHS = ['src/subject.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
const id = (path: string): string => nodeIdFor(path);

/** `a` and `b` import the subject; `c`, `d`, `e` do not. */
function board(): {
  challenge: Challenge;
  reveal: (picked: readonly string[]) => { grade: Grade; reveal: Reveal };
} {
  const atlas = atlasWith(PATHS, [
    ['src/a.ts', 'src/subject.ts'],
    ['src/b.ts', 'src/subject.ts'],
  ]);
  const challenge = challengeFor(atlas, {
    subject: id('src/subject.ts'),
    candidates: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'].map(id).sort(),
    truth: [id('src/a.ts'), id('src/b.ts')].sort(),
  });
  const full = atlasWithChallenge(atlas, challenge);
  const graph = buildGraph(full);
  return {
    challenge,
    reveal: (picked) => {
      const grade = blastRadius.grade(challenge, { picked: [...picked] });
      return { grade, reveal: blastRadius.reveal(full, graph, challenge, grade) };
    },
  };
}

const names = (reveal: Reveal): string[] => reveal.notes.map((note) => note.label);

describe('select-all does not buy the answer key', () => {
  const { challenge: open, reveal } = board();

  it('is refused: no candidate is named at all, and the map is not unlocked', () => {
    // The exploit, exactly as the playtester ran it.
    const all = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'].map(id);
    const { grade, reveal: raw } = reveal(all);
    // Precision here is 2/5 = 0.4, which is *above* the 0.308 maximum measured
    // over 792 real boards and still below the bar — the margin is real.
    expect(precisionOf(grade)).toBeCloseTo(0.4, 6);
    // Unfiltered, this is the leak: both answers named, with evidence.
    expect(names(raw)).toContain('src/a.ts');
    expect(names(raw)).toContain('src/b.ts');
    expect(raw.unlocks).toBe('importRadius');

    const earned = asEarned(raw, grade, open);
    // **Every** per-member row goes, not just the unpicked ones. Under
    // select-all there are no unpicked answers — each truth member is a
    // `correct` note — and naming only the wrong ones identifies the right ones
    // by complement. The partition is the answer.
    expect(earned.notes).toHaveLength(0);
    // …and so is the picture, because withholding the words while drawing the
    // cone changes nothing at all.
    expect(earned.unlocks).toBe('nothing');
    // The counts are stated rather than hidden: a silent absence leaves them
    // guessable off the tally anyway.
    expect(earned.summary).toContain('3 against 2');
    expect(earned.summary).toContain('nothing is locked');
  });

  it('does not leak the key by naming only the wrong picks', () => {
    // The second draft of the rule, refuted: keeping the `spurious` rows was
    // meant to be the mitigation, and on a swept board *"these three are wrong"*
    // is *"those two are right"* on a five-candidate board and *"those six are"*
    // on a twenty. Asserted as a property rather than as a count, because it is
    // the property that matters: nothing names a candidate.
    const all = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'].map(id);
    const { grade, reveal: raw } = reveal(all);
    const earned = asEarned(raw, grade, open);
    for (const path of PATHS) expect(JSON.stringify(earned.notes)).not.toContain(path);
  });
});

describe('the honest near-miss is untouched', () => {
  const { challenge: open, reveal } = board();

  it('names what was missed when every pick was right', () => {
    // **Precision 1.0, recall 0.5** — the teaching moment, and unfarmable:
    // reaching it means already knowing which ones were right. This is the case
    // a precision bar must never take away, and the reason recall is the wrong
    // knob for this rule.
    const { grade, reveal: raw } = reveal([id('src/a.ts')]);
    expect(precisionOf(grade)).toBe(1);
    const earned = asEarned(raw, grade, open);
    expect(earned).toBe(raw);
    expect(names(earned)).toContain('src/b.ts');
    expect(earned.unlocks).toBe('importRadius');
  });

  it('names what was missed at exactly the bar', () => {
    // Two picks, one right: precision 0.5, and inclusive at the boundary. The
    // prose cannot drift from the rule here, which is the nice part: precision
    // < 0.5 is *exactly* "more of your picks were wrong than right", so the
    // sentence the player reads is the condition that produced it.
    const { grade, reveal: raw } = reveal([id('src/a.ts'), id('src/c.ts')]);
    expect(precisionOf(grade)).toBe(REVEAL_PRECISION_BAR);
    expect(asEarned(raw, grade, open)).toBe(raw);
  });

  it('leaves an exact answer alone, having nothing to withhold', () => {
    const { grade, reveal: raw } = reveal([id('src/a.ts'), id('src/b.ts')]);
    expect(grade.score).toBe(1);
    expect(asEarned(raw, grade, open)).toBe(raw);
  });
});

describe('one lucky pick does not farm the board either', () => {
  /**
   * **The hole ADR-0035 shipped, found by a playtester and reproduced here.**
   * The ADR claimed precision 1.0 is *"not farmable, because reaching precision
   * 1.0 means already knowing which ones were right"*. Reaching it means knowing
   * **one**. On a four-of-twenty board a single lucky pick scored 40% — *"not
   * yet"* — and printed all four members with evidence; three boards fell in 4,
   * 7 and 13 submits, black-box, against the 20 the select-all rule was built to
   * stop. §4.1 had already derived the bound and the ADR declined to implement
   * it.
   */
  const PATHS = [
    'src/hub.ts',
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    'src/four.ts',
    'src/no-a.ts',
    'src/no-b.ts',
  ];
  const atlas = atlasWith(
    PATHS,
    ['src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'].map((from) => [from, 'src/hub.ts'] as const),
  );
  const challenge = challengeFor(atlas, {
    subject: nodeIdFor('src/hub.ts'),
    candidates: PATHS.slice(1).map(nodeIdFor).sort(),
    truth: ['src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'].map(nodeIdFor).sort(),
  });
  const full = atlasWithChallenge(atlas, challenge);
  const graph = buildGraph(full);
  const play = (picked: readonly string[]): Reveal => {
    const grade = blastRadius.grade(challenge, { picked: [...picked] });
    return asEarned(blastRadius.reveal(full, graph, challenge, grade), grade, challenge);
  };

  it('says nothing about the other three when one of four is picked', () => {
    const earned = play([nodeIdFor('src/one.ts')]);
    // Precision 1.0 and recall 0.25 — the case the ADR called unfarmable.
    expect(earned.notes).toHaveLength(0);
    expect(earned.unlocks).toBe('nothing');
    // And the sentence points the right way: *find more*, not *pick fewer*,
    // which is the advice a single message for two conditions gets backwards.
    expect(earned.summary).toContain('too thin');
    expect(earned.summary).not.toContain('Pick fewer');
  });

  it('explains itself once a third of the key is in hand', () => {
    // Two of four is recall 0.5. The honest near-miss the ADR wants to protect
    // keeps everything, which is the half of the rule a recall clause must not
    // break.
    const earned = play([nodeIdFor('src/one.ts'), nodeIdFor('src/two.ts')]);
    expect(earned.notes.length).toBeGreaterThan(0);
    expect(earned.unlocks).toBe('importRadius');
  });
});
