/**
 * `src/player/tally.ts` — M2's instrumentation.
 *
 * The load-bearing test here is `the selector never imports the tally`. Every
 * other assertion checks arithmetic; that one checks the *argument* the whole
 * design rests on — that this record is not the cursor ADR-0011 decision 2
 * forbids, because nothing reads it back into the game. An argument nothing
 * enforces is a comment, and this repo's landmine is that a rule stated in an ADR
 * and not grepped for in the code reads exactly like a design choice once it has
 * been in the tree for a milestone.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commitIdFor, nodeIdFor } from '../../src/atlas/index.js';
import {
  EMPTY_TALLY,
  TALLY_VERSION,
  boardsAttempted,
  noteGrade,
  parseTally,
  passBreakdown,
  serializeTally,
  tallyKeyFor,
  summarise,
  totalGraded,
} from '../../src/player/tally.js';

const NODE = nodeIdFor('src/a.ts');
const OTHER = nodeIdFor('src/b.ts');
const COMMIT = commitIdFor('a1b2c3d4e5f6');

describe('counting a graded submission', () => {
  it('counts a pass, which the selector’s own attempt map never did', () => {
    // The defect this module exists for: `main.ts` increments `selector.attempts`
    // only when the grade did *not* pass, so a board answered correctly first
    // time was invisible to the quantity M2 asks for.
    const tally = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, true);
    expect(totalGraded(tally)).toBe(1);
    expect(tally.entries[0]?.passedOn).toBe(1);
  });

  it('accumulates attempts on one board and latches the first pass', () => {
    let tally = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, false);
    tally = noteGrade(tally, 'blastRadius', NODE, false);
    tally = noteGrade(tally, 'blastRadius', NODE, true);
    tally = noteGrade(tally, 'blastRadius', NODE, true);
    expect(tally.entries).toHaveLength(1);
    expect(tally.entries[0]?.graded).toBe(4);
    // Latched: a fourth attempt on an already-passed board is still an attempt,
    // but it did not become a first pass twice.
    expect(tally.entries[0]?.passedOn).toBe(3);
  });

  it('keys on (verb, subject) like every other record', () => {
    let tally = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, false);
    tally = noteGrade(tally, 'companion', NODE, false);
    expect(boardsAttempted(tally)).toBe(2);
    expect(totalGraded(tally)).toBe(2);
  });

  it('holds a commit subject, which is 25% of this repo’s deck', () => {
    // `AtlasId` is a string alias, so a narrowing to nodes would compile and
    // silently drop every Placement row.
    const tally = noteGrade(EMPTY_TALLY, 'placement', COMMIT, true);
    expect(tally.entries[0]?.subject).toBe(COMMIT);
    expect(parseTally(serializeTally(tally)).entries[0]?.subject).toBe(COMMIT);
  });

  it('sorts entries, so two sessions with the same answers store the same bytes', () => {
    let a = noteGrade(EMPTY_TALLY, 'companion', OTHER, true);
    a = noteGrade(a, 'blastRadius', NODE, true);
    let b = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, true);
    b = noteGrade(b, 'companion', OTHER, true);
    expect(serializeTally(a)).toBe(serializeTally(b));
  });
});

describe('the readouts a facilitator takes', () => {
  it('separates first-attempt passes from later ones and from the unpassed', () => {
    let tally = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, true);
    tally = noteGrade(tally, 'companion', OTHER, false);
    tally = noteGrade(tally, 'companion', OTHER, true);
    tally = noteGrade(tally, 'placement', COMMIT, false);
    expect(passBreakdown(tally)).toEqual({ first: 1, later: 1, unpassed: 1 });
    // The three do not sum to anything but `boardsAttempted`, and an open board
    // belongs to none of the two pass buckets.
    expect(boardsAttempted(tally)).toBe(3);
    expect(totalGraded(tally)).toBe(4);
  });
});

describe('the store is untrusted input', () => {
  it('turns anything unreadable into no reading rather than a plausible one', () => {
    expect(parseTally(null)).toEqual(EMPTY_TALLY);
    expect(parseTally('')).toEqual(EMPTY_TALLY);
    expect(parseTally('{')).toEqual(EMPTY_TALLY);
    expect(parseTally('[]')).toEqual(EMPTY_TALLY);
    expect(parseTally('null')).toEqual(EMPTY_TALLY);
    expect(parseTally(JSON.stringify({ version: 99, entries: [] }))).toEqual(EMPTY_TALLY);
  });

  it('drops an absurd count instead of clamping it', () => {
    // A clamped number is indistinguishable from a real one in the output, and
    // this output lands in an experiment's results.
    const rows = [
      { verb: 'blastRadius', subject: NODE, graded: -1, passedOn: 0 },
      { verb: 'blastRadius', subject: NODE, graded: 1.5, passedOn: 0 },
      { verb: 'blastRadius', subject: NODE, graded: Number.MAX_VALUE, passedOn: 0 },
      { verb: 'blastRadius', subject: NODE, graded: 0, passedOn: 0 },
      // passed on an attempt that never happened
      { verb: 'blastRadius', subject: NODE, graded: 2, passedOn: 3 },
      { verb: 'notAVerb', subject: NODE, graded: 1, passedOn: 1 },
      { verb: 'blastRadius', subject: 'not-an-id', graded: 1, passedOn: 1 },
    ];
    for (const row of rows) {
      expect(parseTally(JSON.stringify({ version: TALLY_VERSION, entries: [row] })).entries).toEqual(
        [],
      );
    }
  });

  it('round-trips a real record', () => {
    let tally = noteGrade(EMPTY_TALLY, 'archaeology', NODE, false);
    tally = noteGrade(tally, 'placement', COMMIT, true);
    expect(parseTally(serializeTally(tally))).toEqual(tally);
  });
});

describe('the key', () => {
  it('is the repo’s identity, and cannot collide with the save’s', () => {
    const root = 'f'.repeat(40);
    expect(tallyKeyFor({ root, name: 'ark' })).toBe(`ark:tally:${root}`);
    // `storageKeyFor` produces `ark:<root>`; a 40-hex sha never begins `tally:`.
    expect(tallyKeyFor({ root, name: 'ark' })).not.toBe(`ark:${root}`);
  });

  it('falls back on the name when there is no root, like the save does', () => {
    expect(tallyKeyFor({ root: null, name: 'ark' })).toBe('ark:tally:name:ark');
  });
});

describe('the readout the facilitator takes', () => {
  it('is the reading M2 needs, and it exists because a record with no reader is not an instrument', () => {
    let tally = noteGrade(EMPTY_TALLY, 'blastRadius', NODE, true);
    tally = noteGrade(tally, 'companion', OTHER, false);
    tally = noteGrade(tally, 'companion', OTHER, true);
    tally = noteGrade(tally, 'placement', COMMIT, false);
    expect(summarise(tally)).toEqual({
      graded: 4,
      boards: 3,
      first: 1,
      later: 1,
      unpassed: 1,
    });
  });
});

describe('the claim the design rests on', () => {
  /**
   * **The one that matters.** The argument for storing this at all is that it is
   * never read back into the game, so position in the progression is still
   * recomputed from the answered set on every load — ADR-0011 decision 2's own
   * words. Nothing enforced that, and a later session wiring `attempts` in from
   * storage would turn the instrument into the cursor the ADR forbids without a
   * single test going red.
   */
  it('the selector never imports the tally', () => {
    const selector = readFileSync(
      fileURLToPath(new URL('../../src/player/selector.ts', import.meta.url)),
      'utf8',
    );
    expect(selector).not.toContain('tally');
    expect(selector).not.toContain('Tally');
  });

  it('the selector’s state carries no attempt count that outlives the session', () => {
    // `NO_HISTORY` is what a fresh load starts from. If a future change seeded
    // it from storage, this is where that would show.
    const selector = readFileSync(
      fileURLToPath(new URL('../../src/player/selector.ts', import.meta.url)),
      'utf8',
    );
    expect(selector).toContain('session-scoped and never persisted');
  });
});
