/**
 * The verb-blind disclosure accumulator — ADR-0019 decision 7.
 *
 * What is deliberately **not** tested here: that `build.ts` passes a non-empty
 * `disclosed` into a later generator. Nothing consumes it yet, so an assertion
 * about the wiring would pin a behaviour no output depends on — CLAUDE.md's
 * dead-path landmine. That test arrives with Archaeology, where disabling the
 * wiring changes the deck.
 */

import { describe, expect, it } from 'vitest';

import { accumulate, disclosesNothing, touchedFact, widthFact } from '../../src/verbs/index.js';
import { blastRadius } from '../../src/verbs/blastRadius/index.js';
import { companion } from '../../src/verbs/companion/index.js';
import { placement } from '../../src/verbs/placement/index.js';
import type { Challenge } from '../../src/atlas/index.js';

const COMMIT = 'c:0123456789ab';
const OTHER = 'c:ba9876543210';
const FILE_A = 'n:aaaaaaaaaaaa';
const FILE_B = 'n:bbbbbbbbbbbb';

function placementChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'placement-0123456789ab',
    verb: 'placement',
    tier: 6,
    difficulty: 0.5,
    subject: COMMIT,
    candidates: [FILE_A, FILE_B, 'n:cccccccccccc'],
    truth: [FILE_A, FILE_B],
    evidence: { kind: 'commit', subject: 'a change', date: '2026-08-08', touched: 5 },
    ...overrides,
  };
}

describe('disclosure keys', () => {
  it('separates the fields, so no two distinct facts collide by concatenation', () => {
    // Without a separator, ("c:ab", "n:cd") and ("c:abn", ":cd") are one key.
    // The ids are fixed-width today, which is exactly why this is worth
    // pinning: a future id format that is not would break it silently.
    expect(touchedFact('c:ab', 'n:cd')).not.toBe(touchedFact('c:abn', ':cd'));
  });

  it('gives the two fact kinds different keys for the same commit', () => {
    expect(widthFact(COMMIT)).not.toBe(touchedFact(COMMIT, FILE_A));
  });

  it('keys on the commit, so the same file under two commits is two facts', () => {
    expect(touchedFact(COMMIT, FILE_A)).not.toBe(touchedFact(OTHER, FILE_A));
  });
});

describe('what each verb declares', () => {
  it('placement discloses every key member and the commit width', () => {
    const challenge = placementChallenge();
    expect([...placement.discloses(challenge)].sort()).toEqual(
      [touchedFact(COMMIT, FILE_A), touchedFact(COMMIT, FILE_B), widthFact(COMMIT)].sort(),
    );
  });

  it('placement discloses nothing about a candidate it did not put in the key', () => {
    // The reveal explains a distractor as a file the commit did *not* touch —
    // a negative fact, which can keep a commit off a board but never put one
    // into an answer key.
    const facts = [...placement.discloses(placementChallenge())];
    expect(facts).not.toContain(touchedFact(COMMIT, 'n:cccccccccccc'));
  });

  it('placement discloses no width when the evidence is not a commit', () => {
    const challenge = placementChallenge({ evidence: { kind: 'importGraph', depth: 2 } });
    expect([...placement.discloses(challenge)]).toEqual([
      touchedFact(COMMIT, FILE_A),
      touchedFact(COMMIT, FILE_B),
    ]);
  });

  it('placement discloses nothing for a subject that is not a commit', () => {
    const challenge = placementChallenge({ subject: FILE_A });
    expect([...placement.discloses(challenge)]).toEqual([]);
  });

  it('the two file-answer verbs disclose nothing', () => {
    // Measured rather than assumed: an import cone and a co-change pair are
    // relations between files, and no verb's answer key is made of them.
    expect([...blastRadius.discloses(placementChallenge())]).toEqual([]);
    expect([...companion.discloses(placementChallenge())]).toEqual([]);
    expect(disclosesNothing()).toEqual([]);
  });
});

describe('accumulate', () => {
  it('collects across challenges and deduplicates', () => {
    const into = new Set<string>();
    accumulate(into, [placementChallenge(), placementChallenge()], (c) => placement.discloses(c));
    expect(into.size).toBe(3);
  });

  it('adds to the set it is given, so generation order decides who sees what', () => {
    const into = new Set<string>([widthFact(OTHER)]);
    accumulate(into, [placementChallenge()], (c) => placement.discloses(c));
    expect(into.has(widthFact(OTHER))).toBe(true);
    expect(into.has(touchedFact(COMMIT, FILE_A))).toBe(true);
  });
});
