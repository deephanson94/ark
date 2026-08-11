/**
 * Three sentences the product says to the player that were **false**, found by
 * three independent playtesters and not by any of the 780 assertions that
 * existed when they said them.
 *
 * That is the point of this file. `notes.test.ts`, `reveal.test.ts` and the
 * verb suites all check *shape* — which note exists, which class it carries,
 * which id it names. None of them held a claim to being **true**, so a prompt
 * could promise something the grader contradicts and a reveal could assert
 * something the player can falsify off the screen in front of them, for four
 * milestones, with everything green.
 *
 * This repo's landmine says it exactly: *"test the claim, not the wording — and
 * hold each sentence to the strongest relation it asserts."*
 */

import { describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import { buildGraph, commitIdFor, nodeIdFor } from '../../src/atlas/index.js';
import { VERBS, gradeSet, keyRule, wordsFor } from '../../src/verbs/index.js';
import { PHRASING as BLAST_PHRASING } from '../../src/verbs/blastRadius/index.js';
import { archaeology } from '../../src/verbs/archaeology/index.js';
import { atlasWith, atlasWithChallenge, challengeFor } from '../fixtures/atlas.js';

const PATHS = ['src/a/subject.ts', 'src/a/direct.ts', 'src/b/far.ts', 'src/a/other.ts'];

function fixture(): Atlas {
  return atlasWith(PATHS, [
    ['src/a/direct.ts', 'src/a/subject.ts'],
    ['src/b/far.ts', 'src/a/direct.ts'],
  ]);
}

describe('the board states its own rule', () => {
  const challenge = challengeFor(fixture(), {
    subject: nodeIdFor('src/a/subject.ts'),
    candidates: ['src/a/direct.ts', 'src/a/other.ts', 'src/b/far.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/a/direct.ts')],
  });

  it('says how many count, and never that a wrong pick is free', () => {
    const rule = keyRule(challenge);
    // The old sentence. It is false under §8.2 — see `keyRule`'s header — and a
    // literal check is worth having because the phrase is quotable and would
    // read as reassuring to whoever put it back.
    expect(rule).not.toContain('cost you nothing');
    expect(rule).toContain('one of these 3');
    expect(rule).toContain('lower the score');
    // Guardrail 6 survives and is still said: no lockout, no fail state.
    // Case-insensitive because the clause moved to the tail of the sentence when
    // the first-attempt rule joined it — the *claim* is what this asserts, and
    // pinning the capital was pinning the sentence's shape instead.
    expect(rule.toLowerCase()).toContain('nothing is locked');
    // **And the first-attempt rule is stated before the answer** (ADR-0035 §10).
    // A player who learns it from its consequence has been tricked, and
    // `challenge.ts` can only say it on a board that is already spent — so it has
    // to be here too, on a fresh one. The rule is what makes a pass proof of
    // understanding rather than of persistence, and a hidden rule is a verdict.
    expect(rule).toContain('first answer');
    expect(rule).toContain('notebook');
  });

  it('reaches every verb’s prompt, so no board can go back to promising it', () => {
    // The four instructions were four separate string literals ending in the
    // same false clause. Quantifying over `VERBS` is what stops the fifth verb
    // reintroducing it.
    for (const verb of Object.values(VERBS)) {
      const board = challengeFor(fixture(), {
        verb: verb.id,
        subject: nodeIdFor('src/a/subject.ts'),
        candidates: ['src/a/direct.ts', 'src/a/other.ts', 'src/b/far.ts'].map(nodeIdFor).sort(),
        truth: [nodeIdFor('src/a/direct.ts')],
      });
      const graph = buildGraph(atlasWithChallenge(fixture(), board));
      const instruction = verb.prompt(board, wordsFor(graph)).instruction;
      expect(instruction).not.toContain('cost you nothing');
      expect(instruction).toContain('lower the score');
    }
  });
});

describe('the grade shows its arithmetic', () => {
  const atlas = fixture();
  const challenge = challengeFor(atlas, {
    subject: nodeIdFor('src/a/subject.ts'),
    candidates: ['src/a/direct.ts', 'src/a/other.ts', 'src/b/far.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/a/direct.ts')],
  });

  it('reconciles “found 1 of 1” with a score below 100%', () => {
    // **The exact moment a playtester called the worst of their session.** They
    // found every correct answer that exists and were shown `1 of 1` beside
    // `33% · not yet`, with nothing on screen naming precision or recall. Both
    // facts were true; together they read as a contradiction.
    const grade = gradeSet(
      challenge,
      { picked: ['src/a/direct.ts', 'src/a/other.ts', 'src/b/far.ts'].map(nodeIdFor) },
      BLAST_PHRASING,
    );
    expect(grade.score).toBeCloseTo(0.5, 6);
    expect(grade.evidence).toContain('Found 1 of 1');
    expect(grade.evidence).toContain('Scored 50%');
    // Both ratios, in the units the number is actually made of.
    expect(grade.evidence).toContain('1 of your 3 picks are right');
    expect(grade.evidence).toContain('there is 1 to find in all');
  });

  it('says nothing extra when the answer is exact', () => {
    // `phrasing.exact` already carries that case; a second sentence restating
    // 100% is noise on the one screen that does not need help.
    const grade = gradeSet(challenge, { picked: [nodeIdFor('src/a/direct.ts')] }, BLAST_PHRASING);
    expect(grade.score).toBe(1);
    expect(grade.evidence).not.toContain('Scored');
  });

  it('says nothing when nothing was picked', () => {
    const grade = gradeSet(challenge, { picked: [] }, BLAST_PHRASING);
    expect(grade.evidence).not.toContain('Scored');
  });
});

describe('a commit that shares one word does not “name” the file', () => {
  /**
   * The real case, from `graphql-js`: the message
   * `"Refactoring and test changes"` was shown to a playtester as *naming*
   * `src/type/__tests__/extensions-test.ts`, on the strength of the token
   * `test`. Measured across three repos, **87% / 82% / 54%** of the rows
   * carrying that sentence were a single shared word.
   *
   * Four commits, because the sentence has three branches and a control needs
   * all of them: two that touched the file (the answer), one distractor whose
   * message really does name it, and one that merely shares `test`.
   */
  const SUBJECT = 'src/type/extensions-test.ts';
  const sha = (letter: string): string => letter.repeat(12);

  function withCommits(): Atlas {
    const base = atlasWith([SUBJECT, 'src/type/other.ts', 'src/type/third.ts'], []);
    const commit = (
      letter: string,
      date: string,
      subject: string,
      files: readonly number[],
    ): Atlas['history']['commits'][number] => ({
      sha: sha(letter),
      date,
      subject,
      files,
      issue: null,
      wide: false,
    });
    return {
      ...base,
      repo: { ...base.repo, head: 'c'.repeat(40), headDate: '2026-01-05', root: 'd'.repeat(40) },
      history: {
        ...base.history,
        present: true,
        window: { from: '2026-01-02', to: '2026-01-05' },
        commitsWalked: 4,
        commitsRetained: 4,
        commits: [
          // Newest first, which the validator enforces.
          commit('d', '2026-01-05', 'rework the schema printer', [0]),
          commit('c', '2026-01-04', 'drop the legacy branch', [0]),
          commit('b', '2026-01-03', 'fix extensions-test flake', [1]),
          commit('a', '2026-01-02', 'Refactoring and test changes', [1]),
        ],
      },
    };
  }

  const atlas = withCommits();
  const board = challengeFor(atlas, {
    verb: 'archaeology',
    tier: 5,
    subject: nodeIdFor(SUBJECT),
    candidates: [sha('a'), sha('b'), sha('c'), sha('d')].map(commitIdFor),
    truth: [commitIdFor(sha('c')), commitIdFor(sha('d'))],
    evidence: { kind: 'history', touchedBy: 2 },
  });
  const full = atlasWithChallenge(atlas, board);
  const graph = buildGraph(full);
  const reveal = archaeology.reveal(
    full,
    graph,
    board,
    archaeology.grade(board, { picked: [commitIdFor(sha('a')), commitIdFor(sha('b'))] }),
  );
  const noteFor = (letter: string): string =>
    reveal.notes.find((note) => note.id === commitIdFor(sha(letter)))?.note ?? '';

  it('does not claim a one-token message names the file', () => {
    const said = noteFor('a');
    expect(said).not.toContain(`names ${SUBJECT}`);
    // …and it still says something, because withholding the row would make the
    // *absence* say which class it was (ADR-0020: by class or by board, never
    // by row).
    expect(said.length).toBeGreaterThan(0);
    // The weaker claim is true and quotes the word, so the player can check it
    // against the message printed on the same screen.
    expect(said).toContain('\u201ctest\u201d');
  });

  it('still makes the strong claim when the message really does name it', () => {
    // The control. Without this, deleting the strong branch entirely would pass
    // the assertion above — and the sharpest wrong answer this verb has would
    // lose the sentence that makes it teach.
    expect(noteFor('b')).toContain(`names ${SUBJECT}`);
  });

  it('keeps the aphorism for a commit that names nothing', () => {
    expect(noteFor('c')).toContain('A log of subjects is not a log of files');
  });
});
