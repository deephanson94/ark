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
    // Guardrail 6 survives and is still said: answer as often as you like.
    expect(rule).toContain('as often as you like');
    // **And the *second* false sentence is barred by name.** *"Nothing is locked
    // by a wrong answer"* was true of the score and the deck and false of the
    // explanation, which ADR-0035's gate locked — a cold playtester read this
    // promise and *"this board is not explained here"* in one panel and called
    // the pair the worst thing in the product. The gate is gone (ADR-0047) and
    // the phrase stays barred, because the thing that is now locked is *proof*,
    // which the sentence below says outright rather than denying.
    expect(rule).not.toContain('Nothing is locked');
    expect(rule).toContain('only the first one can prove anything');
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

/**
 * Where the answer comes from, said by the verb that is graded on it.
 *
 * Six cold testers reported the board as a checkbox list over a map that told
 * them nothing, and one named the cause: *"the evidence you need to reason
 * lives on a different screen from the reasoning."* Half of that was a real
 * defect — the import channel was switched off while a board was open, against
 * ADR-0008 decision 1, restored by ADR-0048 — and the other half is that
 * nothing ever said the map answers this question at all.
 *
 * The claim worth holding is the **seam**: only the verb graded on imports may
 * say the map shows evidence. The three graded on git must stay silent, because
 * a shared sentence here is the class-label failure this repo has paid for
 * repeatedly — true of one verb, printed over four.
 */
describe('the evidence line', () => {
  const atlas = fixture();
  const words = wordsFor(buildGraph(atlas));
  const board = challengeFor(atlas, { verb: 'blastRadius' });

  it('is present on the verb the import graph grades, and names the subject', () => {
    const evidence = VERBS.blastRadius.prompt(board, words).evidence;
    expect(evidence).toBeDefined();
    // The subject, so the line is about *this* board rather than a generic tip.
    expect(evidence).toContain(words.label(board.subject));
  });

  it('does not tell the player to hover, because hovering does nothing here', () => {
    // **The regression this guards is the sentence that used to be here.** It read
    // *"Hover any file on the map to see what imports it directly"*, and with a
    // board open a map hover only highlights the matching row — `main.ts`'s
    // pointermove returns early on `challengePanel.isOpen()`, so the map's hover
    // is never set and no ring is drawn for the file under the cursor. Three of
    // ten cold playtesters reported it as broken, one as *"dead on arrival"*.
    //
    // Asserted as an absence rather than a wording, because the defect is the
    // *instruction*: the subject's importers are already drawn (ADR-0008
    // decision 1), so this line has somewhere to point and nothing to ask for.
    // A substring check on the old phrasing is what let it ship — it asserted the
    // shape of a sentence and never whether it could be followed.
    const evidence = VERBS.blastRadius.prompt(board, words).evidence ?? '';
    expect(evidence.toLowerCase()).not.toContain('hover');
    expect(evidence.toLowerCase()).not.toContain('click');
  });

  it('never puts the drawn importers outside the question, because they are 38.8% of the key', () => {
    // **The regression this guards cost four of five cold testers a board.** The
    // sentence that replaced the hover instruction read *"…import X directly —
    // this question is about what reaches it **beyond** them"*, and ADR-0008
    // makes truth the *unbounded* dependent set: a direct importer is not
    // outside the question. Measured on the real deck, direct importers are
    // **85 of ark's 219 key members (38.8%) and 84 of hono's 247 (34.0%)**, and
    // **7 of ark's 40 boards and 15 of hono's 54** have a key made entirely of
    // them — where obeying the sentence scores **0.000**. Deck-wide it caps a
    // believing player at 0.654 / 0.598 against a 0.78 band A.
    //
    // Asserted here rather than left to the atlas suite because this is a claim
    // about a **sentence**, and 1,051 unit tests passed while it was false —
    // which is this repo's landmine in one line: a suite that checks the shape
    // of a sentence never checks whether it is true.
    const evidence = (VERBS.blastRadius.prompt(board, words).evidence ?? '').toLowerCase();
    for (const exclusion of ['beyond them', 'other than', 'apart from', 'excluding', 'do not count']) {
      expect(evidence, `the evidence line puts the drawn ring outside the answer: "${exclusion}"`)
        .not.toContain(exclusion);
    }
    // And it says the opposite, so this is not satisfied by a line that simply
    // stops mentioning them — which would leave the player guessing the same way.
    expect(evidence).toContain('count');
  });

  it('does not reuse the legend\'s word for something else', () => {
    // Three cold testers named this separately: the legend defines RING as
    // *"has a question you have not answered"*, and the evidence line used
    // "ringed" to mean *"has an import edge drawn to the subject"*. One screen,
    // one word, two meanings — and the reader has no way to know which is meant.
    const evidence = (VERBS.blastRadius.prompt(board, words).evidence ?? '').toLowerCase();
    expect(evidence).not.toContain('ring');
  });

  it('is absent on every verb graded on git', () => {
    // The seam: a shared sentence here would be the class-label failure this
    // repo has paid for repeatedly — true of one verb, printed over four.
    for (const verb of ['companion', 'placement', 'archaeology'] as const) {
      expect(
        VERBS[verb].prompt(challengeFor(atlas, { verb }) as never, words).evidence,
        `${verb} claims the map shows evidence for it`,
      ).toBeUndefined();
    }
  });
});
