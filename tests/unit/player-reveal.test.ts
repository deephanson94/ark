/**
 * How the console lays out the rows a player left alone (`src/player/reveal.ts`,
 * ADR-0050).
 *
 * `challenge.ts` is a DOM builder with no unit tests — the console is covered
 * only by `test:e2e` — so the *rule* lives out here where it can be asserted,
 * and every assertion below was mutation-checked.
 */
import { describe, expect, it } from 'vitest';

import type { RevealNote } from '../../src/verbs/index.js';
import { belowBarNote, groupAvoided } from '../../src/player/reveal.js';
import { EMPTY_PROGRESS, applyGrade, livenessOf } from '../../src/player/progress.js';
import { PASS_THRESHOLD } from '../../src/verbs/index.js';
import { VERBS } from '../../src/verbs/index.js';
import { buildGraph } from '../../src/atlas/index.js';
import { atlasWith, atlasWithChallenge } from '../fixtures/atlas.js';

function note(label: string, text: string): RevealNote {
  return { id: `n:${label}`, label, kind: 'avoided', note: text, witness: null };
}

describe('groupAvoided', () => {
  it('collapses rows that say the same thing into one block', () => {
    // Archaeology averages 15.6 of these rows carrying **2.2** distinct
    // sentences, so a sentence per row makes the panel eight times longer and
    // says two things (`scripts/probe-silent.ts`).
    const groups = groupAvoided([
      note('a.ts', 'it landed inside this file’s lifetime and never touched it.'),
      note('b.ts', 'it landed inside this file’s lifetime and never touched it.'),
      note('c.ts', 'the subject imports this — the arrow points the other way.'),
      note('d.ts', 'it landed inside this file’s lifetime and never touched it.'),
    ]);
    expect(groups.map((group) => group.members.length)).toEqual([3, 1]);
    expect(groups[0]?.members.map((member) => member.label)).toEqual(['a.ts', 'b.ts', 'd.ts']);
  });

  it('keeps every row, so the panel still accounts for the whole board', () => {
    const rows = [note('a.ts', 'x'), note('b.ts', 'y'), note('c.ts', 'x')];
    const groups = groupAvoided(rows);
    expect(groups.reduce((n, group) => n + group.members.length, 0)).toBe(rows.length);
  });

  it('orders a group by its first member, so the layout is stable', () => {
    // Every verb has already sorted these rows; a group that jumped to the front
    // because it is large would reorder the panel between two boards that differ
    // only in how many rows share a sentence.
    const groups = groupAvoided([
      note('a.ts', 'only once'),
      note('b.ts', 'said twice'),
      note('c.ts', 'said twice'),
    ]);
    expect(groups.map((group) => group.note)).toEqual(['only once', 'said twice']);
  });

  it('leaves a verb whose rows all differ exactly as it found them', () => {
    // Companion and Placement average 10.1 and 11.9 distinct sentences over
    // ~15 rows, so grouping is close to a no-op there — which is the correct
    // outcome and not a missed optimisation.
    const rows = [note('a.ts', 'one'), note('b.ts', 'two'), note('c.ts', 'three')];
    expect(groupAvoided(rows).map((group) => group.members.length)).toEqual([1, 1, 1]);
  });

  it('has nothing to say about an empty set', () => {
    expect(groupAvoided([])).toEqual([]);
  });
});

describe('what a below-the-bar answer costs', () => {
  /**
   * **The mechanic and the sentence, asserted together.** Either alone misses
   * this: the mechanic was always right and the sentence said the opposite of
   * it, two lines from the code that implements it.
   */
  it('spends the board’s one chance to be proved, whatever the panel used to say', () => {
    // **A key of real dependents, or this test asserts the opposite of the
    // truth.** `challengeFor`'s default picks arbitrary node ids, and
    // `gradedKeys` drops a certificate whose members no longer *hold* — so with
    // a made-up key the failing answer's certificate was discarded, `first`
    // stayed true, and the second answer minted `proved`. The fixture said the
    // panel's old sentence was correct. It is not; the fixture was.
    const base = atlasWith(
      ['src/hub.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      [
        ['src/a.ts', 'src/hub.ts'],
        ['src/b.ts', 'src/hub.ts'],
      ],
    );
    const idOf = (path: string): string =>
      base.nodes.find((node) => node.path === path)?.id ?? '';
    const atlas = atlasWithChallenge(base, {
      subject: idOf('src/hub.ts'),
      truth: [idOf('src/a.ts'), idOf('src/b.ts')].sort(),
      candidates: [idOf('src/a.ts'), idOf('src/b.ts'), idOf('src/c.ts'), idOf('src/d.ts')].sort(),
    });
    const challenge = atlas.challenges[0];
    if (challenge === undefined) throw new Error('fixture has no challenge');
    const verb = VERBS[challenge.verb as keyof typeof VERBS];
    if (verb === undefined) throw new Error('fixture verb is not registered');
    const liveness = livenessOf(buildGraph(atlas), VERBS);

    // A failing answer records no pass — and records a certificate anyway,
    // which is what spends the first-answer chance.
    const missed = verb.grade(challenge, { picked: [] });
    const after = applyGrade(EMPTY_PROGRESS, challenge, missed, PASS_THRESHOLD, liveness).progress;
    expect(after.passes).toHaveLength(0);

    // Coming back and answering perfectly now writes a note in the *shown*
    // register. So "nothing is lost" was false — the proved claim is gone — and
    // "not written to your field notes" would have been false too, because a
    // note does arrive. Only "revealed rather than proved" is true of both.
    const perfect = verb.grade(challenge, { picked: [...challenge.truth] });
    const later = applyGrade(after, challenge, perfect, PASS_THRESHOLD, liveness).progress;
    const pass = later.passes[0];
    expect(pass?.proved ?? []).toEqual([]);
    expect((pass?.shown ?? []).length).toBeGreaterThan(0);
  });

  it('says what is lost rather than that nothing is', () => {
    const said = belowBarNote(0.5, false).toLowerCase();
    // The exact claim the mechanic above refutes.
    expect(said).not.toContain('nothing is lost');
    // And it names the register a later pass actually earns, which is the whole
    // of NORTH-STAR §9's proved-versus-shown distinction.
    expect(said).toContain('revealed');
    expect(said).toContain('proved');
    expect(said).toContain('50%');
  });

  it('promises a re-earn only where the board can actually offer one', () => {
    // **Two mechanics, two sentences, and each must be true of its own case**
    // (ADR-0053). This is the assertion the previous version could not make:
    // it held one sentence to a shape while the product had grown a second
    // behaviour the sentence was false about.
    const canRetry = belowBarNote(0.5, true).toLowerCase();
    expect(canRetry).toContain('different set of files');
    expect(canRetry).toContain('proved');
    // It must **not** tell a player with a second window that a later pass is
    // merely revealed — that is the false half, and it is what the single
    // sentence said to everyone.
    expect(canRetry).not.toContain('revealed rather than proved');

    // And the converse: a board with no second window must not promise one.
    const cannot = belowBarNote(0.5, false).toLowerCase();
    expect(cannot).not.toContain('different set of files');
    expect(cannot).toContain('no second question');
  });
});
