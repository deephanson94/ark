/**
 * Persistence.
 *
 * Two things are being asserted here and they pull in opposite directions. The
 * atlas must throw on anything malformed, because a wrong atlas produces a
 * wrong answer key. A *save* must never throw, because it is a string a user
 * can edit, and bricking the player on it would be a self-inflicted denial of
 * service. So most of this file is hostile input.
 *
 * The rest is the key, which ADR-0011 spends most of its length on: it is
 * `root`, not `head`, and getting that wrong wipes progress on every reindex.
 */

import { describe, expect, it } from 'vitest';

import type { NodeId } from '../../src/atlas/index.js';
import {
  EMPTY_PROGRESS,
  SAVE_VERSION,
  answerKey,
  applyGrade,
  recordPass,
  recordSurvey,
} from '../../src/player/progress.js';
import type { SaveStore } from '../../src/player/save.js';
import { witnessFor } from '../fixtures/atlas.js';
import {
  loadProgress,
  parseProgress,
  saveProgress,
  serializeProgress,
  storageKeyFor,
} from '../../src/player/save.js';

const ROOT = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const id = (n: number): NodeId => `n:${n.toString(16).padStart(12, '0')}`;

function memoryStore(initial: Record<string, string> = {}): SaveStore & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('storageKeyFor', () => {
  it('keys on the root commit, so a reindex does not wipe progress', () => {
    // The whole point of ADR-0011 decision 1. NORTH-STAR §10 said "repo + HEAD",
    // and HEAD moves on every commit.
    const before = storageKeyFor({ root: ROOT, name: 'ark' });
    const after = storageKeyFor({ root: ROOT, name: 'ark' });
    expect(before).toBe(after);
    expect(before).toContain(ROOT);
    expect(before).not.toContain(HEAD);
  });

  it('falls back to the name when there is no knowable root', () => {
    expect(storageKeyFor({ root: null, name: 'vite' })).toBe('ark:name:vite');
  });

  it('cannot collide a name key with a root key', () => {
    // A 40-hex sha never begins `name:`, so a repo literally called `name:x`
    // still lands somewhere of its own.
    expect(storageKeyFor({ root: null, name: `name:${ROOT}` })).not.toBe(
      storageKeyFor({ root: ROOT, name: 'whatever' }),
    );
  });

  it('separates two repos with different roots and the same name', () => {
    expect(storageKeyFor({ root: ROOT, name: 'app' })).not.toBe(
      storageKeyFor({ root: HEAD, name: 'app' }),
    );
  });
});

describe('parseProgress', () => {
  it('round-trips a real record', () => {
    // Built through `applyGrade` rather than `recordPass`, because that is what
    // writes `graded` — and the invariant below is what made the difference
    // visible: `parseProgress` re-seeds `graded` from `passes`, so a record
    // hand-built without it does not round-trip, correctly.
    const progress = recordPass(recordSurvey(EMPTY_PROGRESS, [id(1), id(2)]), 'blastRadius', id(3), [id(1)], 'proved');
    const whole = { ...progress, graded: [{ key: answerKey('blastRadius', id(3)), members: [id(1)] }] };
    expect(parseProgress(serializeProgress(whole))).toEqual(whole);
  });

  it('covers every pass in `graded`, whatever the file said', () => {
    // A save is untrusted input. A record whose `graded` omits a key its
    // `passes` carries would let that board be proved a second time, which is
    // ADR-0047's rule undone by a hand-edit — reachable only that way today
    // (NORTH-STAR §7.1 opts out of it), and one line to make impossible.
    const forged = JSON.stringify({
      version: SAVE_VERSION,
      surveyed: [],
      graded: [],
      passes: [{ verb: 'blastRadius', subject: id(3), proved: [id(1)], shown: [] }],
    });
    expect(parseProgress(forged).graded).toEqual([
      { key: answerKey('blastRadius', id(3)), members: [id(1)] },
    ]);
  });

  it('returns an empty record for nothing, junk, and the wrong root type', () => {
    for (const input of [null, '', '{', 'null', '[]', '"a string"', '7']) {
      expect(parseProgress(input)).toEqual(EMPTY_PROGRESS);
    }
  });

  it('discards a record from a version it does not know', () => {
    const text = JSON.stringify({ version: 99, surveyed: [id(1)], passes: [] });
    expect(parseProgress(text)).toEqual(EMPTY_PROGRESS);
  });

  it('drops entries that are not node ids rather than trusting them', () => {
    // A `NodeId` is `n:` + 12 hex. Anything else in `surveyed` would be handed
    // straight to a Set the renderer looks nodes up in.
    const text = JSON.stringify({
      version: 1,
      surveyed: [id(1), 'src/index.ts', 42, null, { }, 'n:zzzzzzzzzzzz'],
      passes: [],
    });
    expect(parseProgress(text).surveyed).toEqual([id(1)]);
  });

  it('drops a pass with an unknown verb or a malformed subject', () => {
    const text = JSON.stringify({
      version: 1,
      surveyed: [],
      passes: [
        { verb: 'blastRadius', subject: id(3), proved: [id(1)] },
        { verb: 'somethingElse', subject: id(4), proved: [id(1)] },
        { verb: 'blastRadius', subject: 'src/a.ts', proved: [] },
        { verb: 'blastRadius' },
        'not an object',
        null,
      ],
    });
    const parsed = parseProgress(text);
    expect(parsed.passes).toHaveLength(1);
    expect(parsed.passes[0]).toEqual({ shown: [], verb: 'blastRadius', subject: id(3), proved: [id(1)] });
  });

  it('survives a record whose fields are the wrong container type', () => {
    const text = JSON.stringify({ version: 1, surveyed: 'everything', passes: { a: 1 } });
    expect(parseProgress(text)).toEqual(EMPTY_PROGRESS);
  });
});

describe('the storage edge', () => {
  it('writes and reads back through a store', () => {
    const store = memoryStore();
    const progress = recordSurvey(EMPTY_PROGRESS, [id(1)]);
    expect(saveProgress(store, 'ark:x', progress)).toBe(true);
    expect(loadProgress(store, 'ark:x')).toEqual(progress);
  });

  it('runs without a store at all, and reports that nothing was written', () => {
    // A browser with storage disabled. The game must start and forget, not fail.
    expect(loadProgress(null, 'ark:x')).toEqual(EMPTY_PROGRESS);
    expect(saveProgress(null, 'ark:x', EMPTY_PROGRESS)).toBe(false);
  });

  it('reports a failed write instead of throwing — quota, private mode', () => {
    const throwing: SaveStore = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(loadProgress(throwing, 'ark:x')).toEqual(EMPTY_PROGRESS);
    expect(saveProgress(throwing, 'ark:x', EMPTY_PROGRESS)).toBe(false);
  });

  it('keeps one repo out of another repo’s save', () => {
    const store = memoryStore();
    const a = storageKeyFor({ root: ROOT, name: 'app' });
    const b = storageKeyFor({ root: HEAD, name: 'app' });
    saveProgress(store, a, recordSurvey(EMPTY_PROGRESS, [id(1)]));
    expect(loadProgress(store, b)).toEqual(EMPTY_PROGRESS);
  });

  it('restores a graded session exactly', () => {
    const store = memoryStore();
    const challenge = {
      id: 'blast-fixture',
      verb: 'blastRadius',
      tier: 3,
      difficulty: 0.5,
      subject: id(20),
      candidates: Array.from({ length: 20 }, (_, i) => id(i)),
      truth: [id(0), id(1), id(2), id(3)],
      witness: witnessFor(
        Array.from({ length: 20 }, (_, i) => id(i)),
        [id(0), id(1), id(2), id(3)],
      ),
      evidence: { kind: 'importGraph', depth: 2 },
    } as const;
    const { progress } = applyGrade(EMPTY_PROGRESS, challenge, {
      score: 1,
      correct: [...challenge.truth],
      missed: [],
      spurious: [],
      evidence: '',
    });
    saveProgress(store, 'ark:x', progress);
    expect(loadProgress(store, 'ark:x')).toEqual(progress);
  });
});

describe('a commit subject survives a round trip', () => {
  // ADR-0018. `asPass` checked `isNodeId(subject)` and nothing else, which is
  // the same shape as the `VERB_IDS` hazard the file's own comment describes:
  // a pass this rejects is dropped at parse and erased by the next write, so
  // every Placement pass would have been destroyed on the second session with
  // nothing anywhere to say so.
  const commitPass = {
    version: SAVE_VERSION,
    surveyed: [],
    passes: [{ verb: 'placement', subject: 'c:0123456789ab', proved: ['n:000000000001'] }],
  };

  it('keeps a pass whose subject is a commit', () => {
    const restored = parseProgress(JSON.stringify(commitPass));
    expect(restored.passes).toEqual([
      { shown: [], verb: 'placement', subject: 'c:0123456789ab', proved: ['n:000000000001'] },
    ]);
  });

  it('still rejects a subject that is neither shape', () => {
    const bogus = { ...commitPass, passes: [{ ...commitPass.passes[0], subject: 'nonsense' }] };
    expect(parseProgress(JSON.stringify(bogus)).passes).toEqual([]);
  });

  /**
   * **This test asserted the opposite until ADR-0019, and its old name stated
   * the reason as a rule**: *"still rejects a commit id in `proved`, because a
   * member is always a file"*. Archaeology's members are commits, so that
   * sentence — which also sat in a comment beside the code — was false one verb
   * later, and the failure it would have caused is the one this file has two
   * other records of: a member the parser drops is gone at load and **erased by
   * the next write**, so the pass survives its own session and dies on the
   * second.
   *
   * Kept as a test rather than deleted, inverted, because the widening is
   * exactly what has to stay true.
   */
  it('keeps a commit id in `proved`, because a member is a place or an event', () => {
    const withCommit = {
      ...commitPass,
      passes: [{ ...commitPass.passes[0], proved: ['c:0123456789ab'] }],
    };
    expect(parseProgress(JSON.stringify(withCommit)).passes[0]?.proved).toEqual([
      'c:0123456789ab',
    ]);
  });

  it('still drops a member that is neither a node nor a commit', () => {
    const junk = {
      ...commitPass,
      passes: [{ ...commitPass.passes[0], proved: ['c:0123456789ab', 'not-an-id', 42] }],
    };
    expect(parseProgress(JSON.stringify(junk)).passes[0]?.proved).toEqual(['c:0123456789ab']);
  });

  /**
   * `surveyed` is the one list that really is node-only: it is the map's memory
   * of what the player was shown, and a commit has no square. The widening above
   * must not have leaked into it.
   */
  it('keeps `surveyed` node-only, because it is a set of squares on the map', () => {
    const surveyed = { ...commitPass, surveyed: ['n:0123456789ab', 'c:0123456789ab'] };
    expect(parseProgress(JSON.stringify(surveyed)).surveyed).toEqual(['n:0123456789ab']);
  });
});
