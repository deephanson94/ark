/**
 * Twins, and the gate that decides when one may be named (ADR-0030).
 *
 * The gate is the part worth testing hardest: the leak it closes is a *passed
 * board certifying its distractors as non-dependents of the twin*, which decides
 * 4 of the 12 eligible pairs at best 0.923 against a 0.78 bar.
 */

import { describe, expect, it } from 'vitest';

import { buildGraph } from '../../src/atlas/index.js';
import { findTwins, nameableClass } from '../../src/player/twins.js';
import { atlasWith } from '../fixtures/atlas.js';

/**
 * `a.ts` and `b.ts` are both imported by exactly `app.ts`, so their cones are
 * identical and they are twins. `solo.ts` is imported by `other.ts` alone, so
 * its cone differs and it is not.
 */
const ATLAS = atlasWith(
  ['app.ts', 'other.ts', 'a.ts', 'b.ts', 'solo.ts', 'lonely.ts'],
  [
    ['app.ts', 'a.ts'],
    ['app.ts', 'b.ts'],
    ['other.ts', 'solo.ts'],
  ],
);
const GRAPH = buildGraph(ATLAS);
const IDS = ATLAS.nodes.map((node) => node.id);
const refOf = (path: string): number => ATLAS.nodes.findIndex((node) => node.path === path);

describe('finding twins', () => {
  const twins = findTwins(GRAPH, IDS);

  it('groups nodes reached by exactly the same places', () => {
    expect(twins.classes).toHaveLength(1);
    const paths = (twins.classes[0]?.members ?? []).map((ref) => ATLAS.nodes[ref]?.path);
    expect(paths).toEqual(['a.ts', 'b.ts']);
  });

  it('carries the cone size, which is the whole content of the claim', () => {
    // One place reaches both — `app.ts`. ADR-0030 decision 5 keeps a class this
    // thin *and* names the count, so a reader can tell how much it is worth.
    expect(twins.classes[0]?.coneSize).toBe(1);
  });

  it('does not make twins of two files nothing depends on', () => {
    // "Nothing depends on either of us" is a statement about an absent
    // relation. The claim this makes is that two files are reached *identically*,
    // so an empty cone is not a shared one — otherwise every leaf in the repo
    // would be indistinguishable from every other, which is both useless and
    // false.
    expect(twins.classOf.has(refOf('lonely.ts'))).toBe(false);
    expect(twins.classOf.has(refOf('app.ts'))).toBe(false);
  });

  it('leaves a node with a distinct cone out of every class', () => {
    expect(twins.classOf.has(refOf('solo.ts'))).toBe(false);
  });

  it('orders classes and members deterministically', () => {
    // Same reason every array in the atlas is sorted: insertion order is not an
    // order, and a sentence that lists its members must read the same twice.
    const again = findTwins(GRAPH, IDS);
    expect(again.classes.map((c) => [...c.members])).toEqual(twins.classes.map((c) => [...c.members]));
  });
});

describe('the gate', () => {
  const twins = findTwins(GRAPH, IDS);
  const a = refOf('a.ts');
  const b = refOf('b.ts');

  it('names the class when no member still carries a board', () => {
    const named = nameableClass(twins, a, () => false);
    expect(named?.members).toEqual([a, b]);
  });

  it('withholds the class while ANY member has an open board', () => {
    // Including when the *other* member is the one with the board — that is the
    // leak: A's passed board certifies its distractors as non-dependents of B,
    // so B is the one at risk and A is where the sentence would appear.
    expect(nameableClass(twins, a, (member) => member === b)).toBeNull();
    expect(nameableClass(twins, b, (member) => member === b)).toBeNull();
  });

  it('withholds from every member together, never one at a time', () => {
    // ADR-0020's rule, and here it is load-bearing rather than stylistic: if
    // the class showed for A and hid for B, the *absence* would say "B still
    // has a board open", which points at a specific node and is a stronger hint
    // than the sentence it replaced.
    const open = (member: number): boolean => member === a;
    expect(nameableClass(twins, a, open)).toBeNull();
    expect(nameableClass(twins, b, open)).toBeNull();
  });

  it('says nothing about a node that has no twin, gate or no gate', () => {
    expect(nameableClass(twins, refOf('solo.ts'), () => false)).toBeNull();
    expect(nameableClass(twins, refOf('solo.ts'), () => true)).toBeNull();
  });
});
