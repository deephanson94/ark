/**
 * The witness format (ADR-0020).
 *
 * The whole of this contract is *alignment*: token `i` describes candidate `i`,
 * and `-` marks a candidate no strategy chose. A witness that has drifted by one
 * position describes every candidate after it wrongly and still parses, so the
 * validator is the only thing standing between that and a panel confidently
 * telling a player why a file is on the board when it is talking about a
 * different file.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge } from '../../src/atlas/index.js';
import {
  AtlasValidationError,
  NO_STRATEGY,
  encodeWitness,
  readWitness,
  validateAtlas,
} from '../../src/atlas/index.js';
import { atlasWith, challengeFor } from '../fixtures/atlas.js';

const PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];

function board(witness?: string): Challenge {
  const atlas = atlasWith(PATHS);
  return challengeFor(atlas, witness === undefined ? {} : { witness });
}

function withChallenge(challenge: Challenge): void {
  validateAtlas({ ...atlasWith(PATHS), challenges: [challenge] });
}

describe('encodeWitness', () => {
  it('writes one token per candidate, in candidate order', () => {
    const candidates = ['n:aaa', 'n:bbb', 'n:ccc'];
    const witness = encodeWitness(candidates, new Map([['n:bbb', 'treeSibling']]));
    expect(witness).toBe(`${NO_STRATEGY} treeSibling ${NO_STRATEGY}`);
  });

  it('round-trips through readWitness, and answers come back absent', () => {
    const candidates = ['n:aaa', 'n:bbb'];
    const challenge: Challenge = {
      ...board(),
      candidates,
      truth: ['n:aaa'],
      witness: encodeWitness(candidates, new Map([['n:bbb', 'nameSimilar']])),
    };
    const read = readWitness(challenge);
    // Absent, not `'-'`: a caller asking about an answer gets the same reply it
    // gets for a candidate this build does not recognise, which is the safe
    // direction for a panel deciding whether it has anything to say.
    expect(read.get('n:aaa')).toBeUndefined();
    expect(read.get('n:bbb')).toBe('nameSimilar');
    expect(read.size).toBe(1);
  });
});

describe('the validator refuses a witness it cannot trust', () => {
  it('accepts the aligned one the fixture builds', () => {
    expect(() => withChallenge(board())).not.toThrow();
  });

  it('refuses a token count that does not match the candidate count', () => {
    const base = board();
    expect(() => withChallenge({ ...base, witness: `${base.witness} distant` })).toThrow(
      AtlasValidationError,
    );
  });

  it('refuses a witness shifted by one position', () => {
    // The failure this format is most exposed to, and the one that parses
    // cleanly: every token is legal, the length is right, and every candidate
    // after the shift is described by its neighbour's reason.
    const base = board();
    const tokens = base.witness.split(' ');
    const rotated = [...tokens.slice(1), tokens[0] ?? NO_STRATEGY].join(' ');
    expect(rotated.split(' ')).toHaveLength(tokens.length);
    expect(() => withChallenge({ ...base, witness: rotated })).toThrow(AtlasValidationError);
  });

  it('refuses a strategy token on an answer, and a `-` on a wrong answer', () => {
    const base = board();
    const answers = new Set(base.truth);
    const onAnswer = base.candidates
      .map((id) => (answers.has(id) ? 'treeSibling' : NO_STRATEGY))
      .join(' ');
    expect(() => withChallenge({ ...base, witness: onAnswer })).toThrow(AtlasValidationError);
    const allDashes = base.candidates.map(() => NO_STRATEGY).join(' ');
    expect(() => withChallenge({ ...base, witness: allDashes })).toThrow(AtlasValidationError);
  });

  it('refuses a token that is not a strategy id', () => {
    const base = board();
    const answers = new Set(base.truth);
    const bad = base.candidates
      .map((id) => (answers.has(id) ? NO_STRATEGY : 'tree_sibling!'))
      .join(' ');
    expect(() => withChallenge({ ...base, witness: bad })).toThrow(AtlasValidationError);
  });

  it('refuses a non-string witness', () => {
    const base = board();
    expect(() => withChallenge({ ...base, witness: 7 as unknown as string })).toThrow(
      AtlasValidationError,
    );
  });
});
