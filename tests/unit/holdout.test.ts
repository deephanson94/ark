/**
 * The hold-out split — `src/verbs/holdout.ts`.
 *
 * **Read this before trusting the split's output.** On every real repo measured,
 * the disclosure check refuses **nothing** and the swap loop runs **once**. That
 * is the expected result and it is also indistinguishable, from the outside,
 * from a check that does not work — `CLAUDE.md`'s landmine is that an absence
 * assertion passes whether or not the rule exists, and it errs in the direction
 * that gets believed.
 *
 * So the load-bearing test in this file is `refuses a held-out board whose key a
 * served reveal already states`. It hand-builds the collision that a *generated*
 * atlas cannot contain — ADR-0019 decision 7 excludes it at generation time —
 * and asserts the machinery fires. Everything else here is detail; that one is
 * the proof the instrument exists.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, CommitRecord, NodeId } from '../../src/atlas/index.js';
import { commitIdFor, nodeIdFor, validateAtlas } from '../../src/atlas/index.js';
import { touchedFact, widthFact } from '../../src/verbs/disclosure.js';
import type { HoldoutVerbs } from '../../src/verbs/holdout.js';
import { mutualMembership, preferenceOrder, splitDeck, summary } from '../../src/verbs/holdout.js';
import { VERBS } from '../../src/verbs/index.js';
import { atlasWith, witnessFor } from '../fixtures/atlas.js';

const PATHS = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
const idOf = (path: string): NodeId => nodeIdFor(path);

/** Two commits, so a Placement board and an Archaeology board can collide. */
const SHA_ONE = 'a1'.repeat(6);
const SHA_TWO = 'b2'.repeat(6);

/**
 * An atlas with history and hand-authored challenges.
 *
 * Hand-authored on purpose: the collision this file exists to test is one the
 * generator refuses to produce, so a fixture built by generating would be a
 * fixture that can never exercise the check.
 */
function atlasWithDeck(challenges: readonly Challenge[]): Atlas {
  const bare = atlasWith(PATHS);
  const refOf = (path: string): number => bare.nodes.findIndex((n) => n.id === idOf(path));
  const records: CommitRecord[] = [
    {
      sha: SHA_ONE,
      date: '2026-01-01',
      subject: 'first',
      files: [refOf('src/a.ts'), refOf('src/b.ts')].sort((x, y) => x - y),
      wide: false,
      issue: null,
    },
    {
      sha: SHA_TWO,
      date: '2026-01-01',
      subject: 'second',
      files: [refOf('src/c.ts'), refOf('src/d.ts')].sort((x, y) => x - y),
      wide: false,
      issue: null,
    },
  ];
  return validateAtlas({
    ...bare,
    repo: { ...bare.repo, head: 'a'.repeat(40), headDate: '2026-01-01', root: 'b'.repeat(40) },
    history: {
      ...bare.history,
      present: true,
      commitsWalked: records.length,
      commitsRetained: records.length,
      window: { from: '2026-01-01', to: '2026-01-01' },
      commits: [...records].sort((a, b) => (a.sha < b.sha ? -1 : 1)),
    },
    challenges: [...challenges].sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
}

function placementBoard(id: string, sha: string, truth: readonly string[], difficulty = 0.5): Challenge {
  const candidates = PATHS.map(idOf).sort();
  const base: Challenge = {
    id,
    verb: 'placement',
    tier: 6,
    difficulty,
    subject: commitIdFor(sha),
    candidates,
    truth: truth.map(idOf).sort(),
    witness: '',
    evidence: { kind: 'commit', subject: 'first', date: '2026-01-01', touched: 2 },
  };
  return { ...base, witness: witnessFor(base.candidates, base.truth) };
}

function archaeologyBoard(
  id: string,
  path: string,
  shas: readonly string[],
  difficulty = 0.5,
): Challenge {
  const candidates = [commitIdFor(SHA_ONE), commitIdFor(SHA_TWO)].sort();
  const base: Challenge = {
    id,
    verb: 'archaeology',
    tier: 5,
    difficulty,
    subject: idOf(path),
    candidates,
    truth: shas.map(commitIdFor).sort(),
    witness: '',
    evidence: { kind: 'history', touchedBy: 2 },
  };
  return { ...base, witness: witnessFor(base.candidates, base.truth) };
}

function blastBoard(id: string, subject: string, truth: readonly string[], difficulty = 0.5): Challenge {
  const candidates = PATHS.filter((p) => p !== subject).map(idOf).sort();
  const base: Challenge = {
    id,
    verb: 'blastRadius',
    tier: 3,
    difficulty,
    subject: idOf(subject),
    candidates,
    truth: truth.map(idOf).sort(),
    witness: '',
    evidence: { kind: 'importGraph', depth: 1 },
  };
  return { ...base, witness: witnessFor(base.candidates, base.truth) };
}

function companionBoard(
  id: string,
  subject: string,
  truth: readonly string[],
  difficulty = 0.5,
): Challenge {
  const candidates = PATHS.filter((p) => p !== subject).map(idOf).sort();
  const base: Challenge = {
    id,
    verb: 'companion',
    tier: 3,
    difficulty,
    subject: idOf(subject),
    candidates,
    truth: truth.map(idOf).sort(),
    witness: '',
    evidence: { kind: 'coChange', minCount: 3, wideLimit: 50, atMost: 1 },
  };
  return { ...base, witness: witnessFor(base.candidates, base.truth) };
}

describe('keyFacts — the third direction', () => {
  it('is null for the two verbs whose keys relate files, and that is not zero', () => {
    const blast = blastBoard('b-1', 'src/a.ts', ['src/b.ts']);
    const companion = companionBoard('c-1', 'src/a.ts', ['src/b.ts']);
    expect(VERBS.blastRadius.keyFacts(blast)).toBeNull();
    expect(VERBS.companion.keyFacts(companion)).toBeNull();
  });

  it('states a commit-membership atom for each history verb, from its own side', () => {
    const placement = placementBoard('p-1', SHA_ONE, ['src/a.ts']);
    const archaeology = archaeologyBoard('a-1', 'src/a.ts', [SHA_ONE]);
    const fact = touchedFact(commitIdFor(SHA_ONE), idOf('src/a.ts'));
    expect([...(VERBS.placement.keyFacts(placement) ?? [])]).toEqual([fact]);
    expect([...(VERBS.archaeology.keyFacts(archaeology) ?? [])]).toEqual([fact]);
  });

  it('excludes the width fact that `discloses` yields, because it names no member', () => {
    const placement = placementBoard('p-1', SHA_ONE, ['src/a.ts']);
    const disclosed = [...VERBS.placement.discloses(placement)];
    const key = [...(VERBS.placement.keyFacts(placement) ?? [])];
    // The distinction the whole function exists for: reusing `discloses` here
    // would refuse a board because some reveal printed how *big* its answer is.
    expect(disclosed).toContain(widthFact(commitIdFor(SHA_ONE)));
    expect(key).not.toContain(widthFact(commitIdFor(SHA_ONE)));
  });
});

describe('the disclosure check', () => {
  /**
   * **The positive control.** A served Placement reveal states that commit one
   * touched `src/a.ts`; the held-out Archaeology board about `src/a.ts` has that
   * commit in its key. The split must notice and swap.
   */
  it('refuses a held-out board whose key a served reveal already states', () => {
    const atlas = atlasWithDeck([
      placementBoard('p-1', SHA_ONE, ['src/a.ts']),
      archaeologyBoard('a-1', 'src/a.ts', [SHA_ONE], 0.1),
      archaeologyBoard('a-2', 'src/c.ts', [SHA_TWO], 0.9),
    ]);
    const split = splitDeck(atlas, { archaeology: 1 }, VERBS);
    const archaeology = split.report.perVerb.find((v) => v.verb === 'archaeology');

    expect(archaeology?.expressible).toBe(true);
    expect(archaeology?.refused.map((r) => r.id)).toEqual(['a-1']);
    expect(archaeology?.refused[0]?.disclosedAtoms).toBe(1);
    expect(archaeology?.refused[0]?.atoms).toBe(1);
    // Swapped for the next candidate rather than simply dropped: a short quiz
    // is a different defect and is reported separately.
    expect(archaeology?.heldOut).toEqual(['a-2']);
    expect(archaeology?.shortfall).toBe(0);
    // The loop ran a second time to re-check after the swap.
    expect(split.report.rounds).toBe(2);
  });

  it('does not refuse when the disclosing board is itself held out', () => {
    // Same collision, but Placement is in the quiz too, so its reveal is never
    // served and states nothing. This is the case that makes the check a
    // property of the *served* deck rather than of the atlas.
    const atlas = atlasWithDeck([
      placementBoard('p-1', SHA_ONE, ['src/a.ts']),
      archaeologyBoard('a-1', 'src/a.ts', [SHA_ONE], 0.1),
    ]);
    const split = splitDeck(atlas, { archaeology: 1, placement: 1 }, VERBS);
    expect(split.report.perVerb.find((v) => v.verb === 'archaeology')?.refused).toEqual([]);
    expect(split.report.perVerb.find((v) => v.verb === 'archaeology')?.heldOut).toEqual(['a-1']);
  });

  it('reports the blind arm as unchecked and never as clean', () => {
    const atlas = atlasWithDeck([
      blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1),
      blastBoard('b-2', 'src/c.ts', ['src/d.ts'], 0.9),
    ]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS);
    const blast = split.report.perVerb.find((v) => v.verb === 'blastRadius');
    expect(blast?.expressible).toBe(false);
    expect(blast?.refused).toEqual([]);
    // The distinction has to survive as far as the words a reader sees, because
    // that is where it is acted on.
    expect(summary(split.report).join('\n')).toContain('unchecked');
    expect(summary(split.report).join('\n')).not.toContain('0 refused');
  });

  it('reports a shortfall rather than silently serving a short quiz', () => {
    const atlas = atlasWithDeck([
      placementBoard('p-1', SHA_ONE, ['src/a.ts']),
      archaeologyBoard('a-1', 'src/a.ts', [SHA_ONE], 0.1),
    ]);
    // Two archaeology boards asked for, one exists, and it is refused.
    const split = splitDeck(atlas, { archaeology: 2 }, VERBS);
    const archaeology = split.report.perVerb.find((v) => v.verb === 'archaeology');
    expect(archaeology?.heldOut).toEqual([]);
    expect(archaeology?.shortfall).toBe(2);
    expect(summary(split.report).join('\n')).toContain('SHORT by 2');
  });
});

describe('mutual membership — the channel the disclosure check is blind to', () => {
  it('finds two boards of one verb that name each other', () => {
    const held = companionBoard('c-1', 'src/a.ts', ['src/b.ts']);
    const served = companionBoard('c-2', 'src/b.ts', ['src/a.ts']);
    const found = mutualMembership([held], [served]);
    expect(found).toHaveLength(1);
    expect(found?.[0]?.id).toBe('c-1');
    expect(found?.[0]?.servedId).toBe(idOf('src/b.ts'));
  });

  it('does not match across verbs', () => {
    // A Blast Radius board about b naming a, and a Companion board about a
    // naming b, are two different relations. Matching them would report a leak
    // that does not exist.
    const held = companionBoard('c-1', 'src/a.ts', ['src/b.ts']);
    const served = blastBoard('b-1', 'src/b.ts', ['src/a.ts']);
    expect(mutualMembership([held], [served])).toEqual([]);
  });

  it('does not fire on a one-way naming', () => {
    const held = companionBoard('c-1', 'src/a.ts', ['src/b.ts']);
    const served = companionBoard('c-2', 'src/b.ts', ['src/c.ts']);
    expect(mutualMembership([held], [served])).toEqual([]);
  });

  it('is null, not empty, where a subject and a member are different kinds of id', () => {
    // Placement's subject is a commit and its members are nodes, so "two boards
    // naming each other" is not a relation that can hold — and a 0 printed here
    // beside Blast Radius's checked 0 would be this module's own two-zeroes rule
    // broken in the channel it added second. It was, in the first version.
    const placement = placementBoard('p-1', SHA_ONE, ['src/a.ts']);
    const archaeology = archaeologyBoard('a-1', 'src/a.ts', [SHA_ONE]);
    expect(mutualMembership([placement], [placement])).toBeNull();
    expect(mutualMembership([archaeology], [archaeology])).toBeNull();
    // And the report says so rather than printing a number.
    const atlas = atlasWithDeck([placement, archaeologyBoard('a-2', 'src/c.ts', [SHA_TWO], 0.9)]);
    const split = splitDeck(atlas, { placement: 1 }, VERBS);
    expect(split.report.perVerb[0]?.mutual).toBeNull();
    expect(summary(split.report).join('\n')).toContain('mutual n/a');
  });
});

describe('taking a verb’s whole supply', () => {
  it('is a shortfall even though the arithmetic says otherwise', () => {
    // `size - bucket.length` fires only when k > eligible. At k === eligible the
    // played atlas loses every board of that verb and the script exited 0.
    const atlas = atlasWithDeck([
      blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1),
      blastBoard('b-2', 'src/c.ts', ['src/d.ts'], 0.9),
    ]);
    const split = splitDeck(atlas, { blastRadius: 2 }, VERBS);
    expect(split.played.challenges.filter((c) => c.verb === 'blastRadius')).toEqual([]);
    expect(split.report.perVerb[0]?.shortfall).toBe(2);
  });
});

describe('the bar — the leak the hold-out itself creates', () => {
  it('keeps a barred board out of the quiz and takes the next one instead', () => {
    const atlas = atlasWithDeck([
      blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1),
      blastBoard('b-2', 'src/c.ts', ['src/d.ts'], 0.9),
    ]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS, (c) =>
      c.id === 'b-1' ? 'has a twin' : null,
    );
    const blast = split.report.perVerb.find((v) => v.verb === 'blastRadius');
    expect(blast?.heldOut).toEqual(['b-2']);
    expect(blast?.barred.map((b) => b.id)).toEqual(['b-1']);
    expect(blast?.barred[0]?.reason).toBe('has a twin');
    expect(blast?.shortfall).toBe(0);
    // Barred at supply, so it never enters the loop and never counts as a round.
    expect(split.report.rounds).toBe(1);
  });

  it('reports a shortfall when the bar leaves too little supply', () => {
    const atlas = atlasWithDeck([blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1)]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS, () => 'barred');
    const blast = split.report.perVerb.find((v) => v.verb === 'blastRadius');
    expect(blast?.heldOut).toEqual([]);
    expect(blast?.shortfall).toBe(1);
    // A barred board is still counted as eligible: the row has to show that the
    // supply existed and the bar took it, not that the verb had no boards.
    expect(blast?.eligible).toBe(1);
    expect(summary(split.report).join('\n')).toContain('barred 1');
  });

  it('bars nothing by default, so a caller that has not thought about it is not silently protected', () => {
    const atlas = atlasWithDeck([blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1)]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS);
    expect(split.report.perVerb[0]?.barred).toEqual([]);
    expect(split.quiz.map((c) => c.id)).toEqual(['b-1']);
  });
});

describe('the preference order', () => {
  it('spreads across the difficulty range instead of taking one end', () => {
    const deck = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((d, i) =>
      blastBoard(`b-${String(i)}`, 'src/a.ts', ['src/b.ts'], d),
    );
    const picked = preferenceOrder(deck, 3).slice(0, 3);
    // §6 names both a floor and a ceiling as instrument failures. A quiz drawn
    // from one end of the range measures a band rather than the range.
    expect(picked.map((c) => c.difficulty)).toEqual([0.1, 0.4, 0.7]);
  });

  it('is total, so the swap supply is the rest of the deck in difficulty order', () => {
    const deck = [0.3, 0.1, 0.2].map((d, i) =>
      blastBoard(`b-${String(i)}`, 'src/a.ts', ['src/b.ts'], d),
    );
    const order = preferenceOrder(deck, 1);
    expect(order).toHaveLength(3);
    expect(order.map((c) => c.difficulty)).toEqual([0.1, 0.2, 0.3]);
  });

  it('breaks ties on id, so the split is reproducible from the atlas alone', () => {
    const deck = ['b-3', 'b-1', 'b-2'].map((id) =>
      blastBoard(id, 'src/a.ts', ['src/b.ts'], 0.5),
    );
    expect(preferenceOrder(deck, 3).map((c) => c.id)).toEqual(['b-1', 'b-2', 'b-3']);
  });
});

describe('the split as an artifact', () => {
  it('partitions the deck exactly, and the played atlas still validates', () => {
    const atlas = atlasWithDeck([
      blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1),
      blastBoard('b-2', 'src/c.ts', ['src/d.ts'], 0.9),
      companionBoard('c-1', 'src/a.ts', ['src/b.ts'], 0.2),
    ]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS);
    expect(split.played.challenges.length + split.quiz.length).toBe(atlas.challenges.length);
    const ids = new Set([
      ...split.played.challenges.map((c) => c.id),
      ...split.quiz.map((c) => c.id),
    ]);
    expect(ids.size).toBe(atlas.challenges.length);
    // The artifact twelve people are served has to be an atlas, not a smaller
    // object that happens to parse.
    expect(() => validateAtlas(split.played)).not.toThrow();
  });

  it('leaves a verb nobody asked about entirely alone', () => {
    const atlas = atlasWithDeck([
      blastBoard('b-1', 'src/a.ts', ['src/b.ts'], 0.1),
      companionBoard('c-1', 'src/a.ts', ['src/b.ts'], 0.2),
    ]);
    const split = splitDeck(atlas, { blastRadius: 1 }, VERBS);
    expect(split.report.perVerb.map((v) => v.verb)).toEqual(['blastRadius']);
    expect(split.quiz.map((c) => c.id)).toEqual(['b-1']);
  });

  it('holds both arms of the id union — a commit subject and a commit member', () => {
    // `AtlasId` is a string alias, so nothing here is checked by the compiler:
    // a split that assumed a subject is a node would drop every Placement board
    // and one that assumed a member is a node would drop every Archaeology key.
    const atlas = atlasWithDeck([
      placementBoard('p-1', SHA_TWO, ['src/c.ts'], 0.4),
      archaeologyBoard('a-1', 'src/e.ts', [SHA_ONE], 0.6),
    ]);
    const split = splitDeck(atlas, { placement: 1, archaeology: 1 }, VERBS);
    expect(split.quiz.map((c) => c.id).sort()).toEqual(['a-1', 'p-1']);
    for (const row of split.report.perVerb) expect(row.expressible).toBe(true);
  });

  it('treats a verb this build does not have as unheld rather than guessing', () => {
    const atlas = atlasWithDeck([blastBoard('b-1', 'src/a.ts', ['src/b.ts'])]);
    const noVerbs: HoldoutVerbs = {};
    const split = splitDeck(atlas, { blastRadius: 1 }, noVerbs);
    // Still held out — the split is a deck operation — but reported as blind.
    expect(split.quiz.map((c) => c.id)).toEqual(['b-1']);
    expect(split.report.perVerb[0]?.expressible).toBe(false);
  });
});
