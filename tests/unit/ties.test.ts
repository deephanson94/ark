/**
 * History wires — the co-change relation on the map, and the gate that decides
 * who may see it (`src/player/ties.ts`, ADR-0016).
 *
 * Every assertion here was mutation-checked: the code it names was broken, the
 * test confirmed to fail, and the break reverted. One of them survived its
 * mutation and was rewritten — see `gives an unordered pair one identity`, which
 * records why the obvious version of it proved nothing.
 *
 * The block that matters most is `the gate the obvious implementation would have
 * used`: it is the only place in the suite that would notice the map drawing an
 * answer key nobody has been shown.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, NodeId, VerbId } from '../../src/atlas/index.js';
import { buildGraph, validateAtlas } from '../../src/atlas/index.js';
import { NO_TIES, tieWidth, tiesAt, tiesNamedBy } from '../../src/player/ties.js';
import { channelOf } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

const FILES = [
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/d.ts',
  'src/e.ts',
  'src/f.ts',
];

/** `[a, b, count]` by path, turned into the atlas's ref-indexed shape. */
function fixture(pairs: readonly (readonly [string, string, number])[]): Atlas {
  const bare = atlasWith(FILES, [['src/a.ts', 'src/b.ts']]);
  const refOf = (path: string): number => {
    const ref = bare.nodes.findIndex((node) => node.path === path);
    if (ref < 0) throw new Error(`no such fixture file: ${path}`);
    return ref;
  };
  const coChange = pairs
    .map(([x, y, n]) => {
      const [a, b] = refOf(x) < refOf(y) ? [refOf(x), refOf(y)] : [refOf(y), refOf(x)];
      return [a, b, n] as const;
    })
    // The atlas contract sorts count-descending, then by ref. `parseAtlas`
    // enforces it, so a fixture that ignored it would not be an atlas.
    .sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]);
  return validateAtlas({
    ...bare,
    // `history.present` must agree with `repo.head` — the validator's own
    // cross-field rule, so a fixture carrying history needs a head and a root.
    repo: {
      ...bare.repo,
      head: 'a'.repeat(40),
      headDate: '2026-01-01',
      root: 'b'.repeat(40),
    },
    history: {
      present: true,
      commitsWalked: 100,
      commitsRetained: 0,
      window: { from: '2025-01-01', to: '2026-01-01' },
      wideLimit: 25,
      coChange,
      commits: [],
    },
  });
}

function idOf(atlas: Atlas, path: string): NodeId {
  const node = atlas.nodes.find((entry) => entry.path === path);
  if (node === undefined) throw new Error(`no such fixture file: ${path}`);
  return node.id;
}

/** A Companion challenge naming `truth` as the subject's board members. */
function companionChallenge(
  atlas: Atlas,
  subject: string,
  truth: readonly string[],
): Challenge {
  return {
    id: `companion-${subject}`,
    verb: 'companion',
    tier: 3,
    difficulty: 0.5,
    subject: idOf(atlas, subject),
    candidates: FILES.filter((path) => path !== subject).map((path) => idOf(atlas, path)),
    truth: truth.map((path) => idOf(atlas, path)),
    evidence: { kind: 'coChange', minCount: 2, wideLimit: 25, atMost: 1 },
  } as Challenge;
}

describe('the wires a reveal has named', () => {
  it('draws the named pairs and nothing else in the subject’s row', () => {
    // `a` co-changes with three files; the board named only two of them.
    const atlas = fixture([
      ['src/a.ts', 'src/b.ts', 6],
      ['src/a.ts', 'src/c.ts', 4],
      ['src/a.ts', 'src/d.ts', 3],
    ]);
    const graph = buildGraph(atlas);
    const ties = tiesNamedBy(atlas, graph, [
      companionChallenge(atlas, 'src/a.ts', ['src/b.ts', 'src/c.ts']),
    ]);
    // Unordered pairs, sorted — the hash order of the fixture's refs is not a
    // fact about the code under test.
    const paths = ties.all
      .map((tie) => [atlas.nodes[tie.a]?.path, atlas.nodes[tie.b]?.path].sort().join(' '))
      .sort();
    expect(paths).toEqual(['src/a.ts src/b.ts', 'src/a.ts src/c.ts']);
    // The whole point of ADR-0016: `a—d` is real, it is in the matrix, and no
    // reveal has named it. Drawing the row instead of the named pairs is the
    // one-line change this assertion exists to catch.
    expect(paths).not.toContain('src/a.ts src/d.ts');
  });

  it('carries the real commit count, not a placeholder', () => {
    const atlas = fixture([['src/a.ts', 'src/b.ts', 7]]);
    const ties = tiesNamedBy(atlas, buildGraph(atlas), [
      companionChallenge(atlas, 'src/a.ts', ['src/b.ts']),
    ]);
    expect(ties.all[0]?.count).toBe(7);
  });

  it('drops a named pair the live matrix no longer bears', () => {
    // A save outlives the atlas that produced it (ADR-0011 keys on `repo.root`,
    // not `repo.head`), so a stored claim can name a pair this history does not
    // record. A wire we cannot substantiate is not drawn faintly — it is not
    // drawn.
    const atlas = fixture([['src/a.ts', 'src/b.ts', 5]]);
    const stale = companionChallenge(atlas, 'src/a.ts', ['src/b.ts', 'src/e.ts']);
    const ties = tiesNamedBy(atlas, buildGraph(atlas), [stale]);
    expect(ties.all).toHaveLength(1);
    // Compared as an unordered set: node refs come from a content hash, so
    // which end lands in `.a` is not a fact about this code.
    expect(
      [atlas.nodes[ties.all[0]?.a ?? -1]?.path, atlas.nodes[ties.all[0]?.b ?? -1]?.path].sort(),
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('gives an unordered pair one identity, however the reveals arrive', () => {
    const atlas = fixture([['src/a.ts', 'src/b.ts', 4]]);
    const graph = buildGraph(atlas);
    const fromA = companionChallenge(atlas, 'src/a.ts', ['src/b.ts']);
    const fromB = companionChallenge(atlas, 'src/b.ts', ['src/a.ts']);

    // **Each direction alone must produce a wire**, and this half is the half
    // that matters. The obvious assertion — name both directions, expect one
    // wire — is *vacuous*: with an unnormalised pair key the second direction
    // misses the count index (which is built from the atlas's own `a < b`
    // ordering), so the duplicate is dropped by accident and the count still
    // reads 1. The first version of this test asserted exactly that and
    // survived the mutation. Node refs come from a content hash, so which of
    // these two sorts second is not knowable here — which is why both are
    // checked.
    expect(tiesNamedBy(atlas, graph, [fromA]).all).toHaveLength(1);
    expect(tiesNamedBy(atlas, graph, [fromB]).all).toHaveLength(1);

    // And together they are still one wire, at one weight.
    const ties = tiesNamedBy(atlas, graph, [fromA, fromB]);
    expect(ties.all).toHaveLength(1);
    expect(ties.all[0]?.a).toBeLessThan(ties.all[0]?.b ?? -1);
  });

  it('ignores a verb whose channel is not this one', () => {
    const atlas = fixture([['src/a.ts', 'src/b.ts', 4]]);
    const blast = {
      ...companionChallenge(atlas, 'src/a.ts', ['src/b.ts']),
      verb: 'blastRadius',
      evidence: { kind: 'importGraph', depth: 2 },
    } as Challenge;
    expect(tiesNamedBy(atlas, buildGraph(atlas), [blast]).all).toHaveLength(0);
  });

  it('draws nothing for a verb this build does not have', () => {
    // `channelOf` falls closed on an unknown id. An atlas can name a verb this
    // build lacks — `VERB_IDS` is checked at load, but a save or a hand-edited
    // atlas can still carry one — and the safe answer to "may I draw an answer
    // I do not understand?" is no. Without this assertion the fallback could be
    // flipped to `coChangeTies` and every suite still passed.
    const atlas = fixture([['src/a.ts', 'src/b.ts', 4]]);
    const unknown = {
      ...companionChallenge(atlas, 'src/a.ts', ['src/b.ts']),
      verb: 'trace',
    } as unknown as Challenge;
    expect(tiesNamedBy(atlas, buildGraph(atlas), [unknown]).all).toHaveLength(0);
    expect(channelOf('trace' as VerbId)).toBe('nothing');
    // And the two verbs that do exist declare a channel each, so the lookup is
    // not vacuously answering "nothing" to everything.
    expect(channelOf('companion')).toBe('coChangeTies');
    expect(channelOf('blastRadius')).toBe('importRadius');
  });

  it('indexes both endpoints, so focusing a node is a lookup', () => {
    const atlas = fixture([
      ['src/a.ts', 'src/b.ts', 5],
      ['src/a.ts', 'src/c.ts', 3],
    ]);
    const graph = buildGraph(atlas);
    const ties = tiesNamedBy(atlas, graph, [
      companionChallenge(atlas, 'src/a.ts', ['src/b.ts', 'src/c.ts']),
    ]);
    const ref = (path: string): number => atlas.nodes.findIndex((n) => n.path === path);
    expect(tiesAt(ties, ref('src/a.ts'))).toHaveLength(2);
    expect(tiesAt(ties, ref('src/b.ts'))).toHaveLength(1);
    expect(tiesAt(ties, ref('src/d.ts'))).toHaveLength(0);
    expect(tiesAt(ties, null)).toHaveLength(0);
    expect(tiesAt(NO_TIES, ref('src/a.ts'))).toHaveLength(0);
  });

  it('orders wires by the repo, not by the order questions were answered', () => {
    const atlas = fixture([
      ['src/a.ts', 'src/b.ts', 5],
      ['src/c.ts', 'src/d.ts', 3],
    ]);
    const graph = buildGraph(atlas);
    const first = companionChallenge(atlas, 'src/a.ts', ['src/b.ts']);
    const second = companionChallenge(atlas, 'src/c.ts', ['src/d.ts']);
    const forward = tiesNamedBy(atlas, graph, [first, second]).all;
    const backward = tiesNamedBy(atlas, graph, [second, first]).all;
    expect(backward).toEqual(forward);
  });
});

describe('the gate the obvious implementation would have used', () => {
  it('never draws a pair belonging to a board nobody has been shown', () => {
    // This is the assertion the whole module exists for, in miniature.
    //
    // `a—b` and `b—c` are both in the matrix. The player has answered `a`'s
    // board, so `a—b` was named to them in words. `b` is itself a Companion
    // subject, its question is still open, and its key contains `c`.
    //
    // The tempting gate — draw the wires of everything in
    // `provedThrough(progress, liveness, 'companion')` — puts `b` in the
    // drawable set, because `b` was a member the player picked correctly. It
    // would then draw `b—c` and hand over `b`'s answer. Measured on the real
    // deck, that gate exposes 89 open-key members in a single frame.
    const atlas = fixture([
      ['src/a.ts', 'src/b.ts', 6],
      ['src/b.ts', 'src/c.ts', 5],
    ]);
    const graph = buildGraph(atlas);
    const ref = (path: string): number => atlas.nodes.findIndex((n) => n.path === path);
    const answered = companionChallenge(atlas, 'src/a.ts', ['src/b.ts']);
    const stillOpen = companionChallenge(atlas, 'src/b.ts', ['src/c.ts']);
    const openKey = new Set(stillOpen.truth);

    // While `b`'s board is open, nothing incident to `b` may be drawn — not
    // even `a—b`, which the player *was* told, because the ink sits beside the
    // question it helps answer.
    expect(tiesNamedBy(atlas, graph, [answered], new Set([ref('src/b.ts')])).all).toHaveLength(0);

    // Once `b`'s board is answered too, both wires are legitimate — and the
    // loop below is the one that would notice `c` arriving early. `checked` is
    // not decoration: the first version of this loop read
    // `tie.a === bRef ? tie.b : tie.a === bRef ? tie.a : null`, whose second
    // ternary repeats the first condition, so `other` was always null and **the
    // assertion inside ran zero times**. A gate needs proof it opened; that is
    // what `npm run raster` cost two rewrites to learn.
    const ties = tiesNamedBy(atlas, graph, [answered]);
    let checked = 0;
    for (const tie of ties.all) {
      const other =
        tie.a === ref('src/b.ts') ? tie.b : tie.b === ref('src/b.ts') ? tie.a : null;
      if (other === null) continue;
      checked++;
      expect(openKey.has(atlas.nodes[other]?.id ?? '')).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
    // `b—c` is in the matrix and no reveal named it, so it is absent whatever
    // the gate says.
    expect(ties.all).toHaveLength(1);
  });

  it('withholds a named wire while either endpoint still carries an open board', () => {
    // The endpoint gate, which is pillar 3 rather than a disclosure argument.
    // Both pairs below were named to the player by `a`'s reveal. But `b` and
    // `c` are themselves Companion subjects, and `c`'s board is still open — so
    // a wire touching `c` sits on the map, behind the challenge scrim, beside
    // the question it answers. On the real deck that assembles up to 5 of a
    // 6-member key.
    const atlas = fixture([
      ['src/a.ts', 'src/b.ts', 6],
      ['src/a.ts', 'src/c.ts', 5],
    ]);
    const graph = buildGraph(atlas);
    const ref = (path: string): number => atlas.nodes.findIndex((n) => n.path === path);
    const named = [companionChallenge(atlas, 'src/a.ts', ['src/b.ts', 'src/c.ts'])];

    const gated = tiesNamedBy(atlas, graph, named, new Set([ref('src/c.ts')]));
    expect(gated.all).toHaveLength(1);
    expect(
      [atlas.nodes[gated.all[0]?.a ?? -1]?.path, atlas.nodes[gated.all[0]?.b ?? -1]?.path].sort(),
    ).toEqual(['src/a.ts', 'src/b.ts']);

    // Same reveals, `c`'s board now closed: the withheld wire arrives. Nothing
    // is permanently hidden — the layer converges to every named pair, which is
    // what makes this a deferral rather than a subtraction (guardrail 6).
    expect(tiesNamedBy(atlas, graph, named, new Set()).all).toHaveLength(2);
  });

  it('withholds the subject’s own wires while the subject’s board is open', () => {
    // The other half of the same gate. A restored save can name a subject whose
    // board is open again because its claim decayed (`stillHolds`), and the
    // wires must go down with it.
    const atlas = fixture([['src/a.ts', 'src/b.ts', 6]]);
    const graph = buildGraph(atlas);
    const ref = (path: string): number => atlas.nodes.findIndex((n) => n.path === path);
    const named = [companionChallenge(atlas, 'src/a.ts', ['src/b.ts'])];
    expect(tiesNamedBy(atlas, graph, named, new Set([ref('src/a.ts')])).all).toHaveLength(0);
    expect(tiesNamedBy(atlas, graph, named, new Set()).all).toHaveLength(1);
  });

});

describe('wire weight', () => {
  it('rises with the count and clamps, so svelte’s monsters are not ribbons', () => {
    // Counts run 2..10 on this repo and to 613 on `sveltejs/svelte`. Linear
    // width cannot serve both.
    expect(tieWidth(2)).toBeGreaterThan(tieWidth(1));
    expect(tieWidth(10)).toBeGreaterThan(tieWidth(2));
    expect(tieWidth(613)).toBeLessThanOrEqual(3.5);
    expect(tieWidth(613)).toBeGreaterThan(tieWidth(10));
    // A count of zero cannot happen, but a width of `-Infinity` from `log2(0)`
    // would be a silent invisible wire rather than a crash.
    expect(tieWidth(0)).toBeGreaterThan(0);
  });
});
