/**
 * The three sentences a player sees over an empty deck.
 *
 * **This file exists because a post-ship review reverted ADR-0025's repair and
 * ran everything green.** The guide said *"every question answered"* over a
 * repo that was never asked one — the defect that ADR calls the last hiding
 * place — with 606 unit tests, 102 atlas tests and a clean build all passing,
 * because the fork lived inside a DOM callback and `vitest.config.ts` has no DOM
 * environment. Moving the decision into `empty.ts` is what makes it assertable;
 * these are the assertions.
 */

import { describe, expect, it } from 'vitest';

import { guideExhausted, notesEmpty, questsLine } from '../../src/player/empty.js';

const REFUSAL =
  "None of this repository's 36 source files are on this map — they are Go, which ark cannot read.";

describe('the guide with nothing left to suggest', () => {
  it('never calls a refused deck finished', () => {
    const state = guideExhausted(REFUSAL);
    expect(state.label).not.toContain('every question answered');
    expect(state.caption).toBe(REFUSAL);
  });

  it('still says "finished" when the player actually finished', () => {
    const state = guideExhausted(null);
    expect(state.label).toBe('every question answered');
    expect(state.caption).toContain('Reindex');
  });

  it('passes the refusal through untouched, so the two surfaces cannot drift', () => {
    // The sentence is composed once in `src/atlas/coverage.ts` and printed by
    // the CLI and here. A panel that reworded it would be a second claim about
    // one population, which is the failure `coverage.ts` is centralised to
    // prevent.
    expect(guideExhausted(REFUSAL).caption).toBe(REFUSAL);
  });
});

describe('the HUD question count — the same fork one panel over', () => {
  it('never calls a refused deck finished either', () => {
    // The half that survived the first repair. Different words, different
    // variable, same question.
    expect(questsLine(true, 0, 0)).toBe('no questions for this repo');
    expect(questsLine(true, 0, 0)).not.toContain('every question answered');
  });

  it('distinguishes a refused deck from an exhausted one at the same count', () => {
    expect(questsLine(true, 0, 0)).not.toBe(questsLine(false, 0, 0));
    expect(questsLine(false, 0, 0)).toBe('every question answered');
  });

  it('says how many are ringed only when that is not the whole remainder', () => {
    expect(questsLine(false, 5, 5)).toBe('5 questions ringed on the map');
    expect(questsLine(false, 1, 1)).toBe('1 question ringed on the map');
    expect(questsLine(false, 36, 0)).toBe('36 left · 0 ringed on the map');
  });

  it('leads with what the player has, once it knows how much there is', () => {
    // This line is the largest type in the HUD and it read `160 left · 84 ringed`
    // — a backlog. Three of ten cold playtesters named it as the thing arguing
    // against the arc they could otherwise feel, one asking for exactly this:
    // *"make the headline read the thing that actually moved"*.
    expect(questsLine(false, 160, 84, 0, 187)).toBe('0 of 187 proved · 160 left');
    expect(questsLine(false, 158, 84, 7, 187)).toBe('7 of 187 proved · 158 left');
  });

  it('is byte-identical to the old line when no provable count is given', () => {
    // The new pair is additive. A caller that cannot supply it — a fixture, or
    // any surface without the atlas — must read exactly what shipped before,
    // rather than a half-built sentence.
    expect(questsLine(false, 36, 0, 0, 0)).toBe('36 left · 0 ringed on the map');
    expect(questsLine(false, 5, 5, 3, 0)).toBe('5 questions ringed on the map');
  });

  it('still forks on the two states that are not a count', () => {
    expect(questsLine(true, 0, 0, 0, 187)).toBe('no questions for this repo');
    expect(questsLine(false, 0, 0, 187, 187)).toBe('every question answered');
  });
});

describe('the field notes with nothing in them', () => {
  it('does not invite an action a refused repo does not have', () => {
    expect(notesEmpty(true)).not.toContain('Answer a question');
    expect(notesEmpty(true)).toContain('could not read enough of this repository');
  });

  it('still invites it when there is a deck', () => {
    expect(notesEmpty(false)).toContain('Answer a question');
  });
});
