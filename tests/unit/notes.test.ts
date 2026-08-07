/**
 * Field notes.
 *
 * §9 says notes accumulate facts you have *proven*, not facts you were shown,
 * and calls that distinction the whole product. Under ADR-0008 the answer key is
 * a **sample**, so the strongest honest claim is about the members — never the
 * count, which was revealed rather than earned. §9's own example gets that
 * wrong; ADR-0011 decision 3 amends it. Most of this file is that one line.
 */

import { describe, expect, it } from 'vitest';

import type { NodeId } from '../../src/atlas/index.js';
import { buildGraph } from '../../src/atlas/index.js';
import { fieldNotes, noteProse } from '../../src/player/notes.js';
import { EMPTY_PROGRESS, livenessOf, recordPass } from '../../src/player/progress.js';
import { atlasWith } from '../fixtures/atlas.js';

// hub ← mid ← far, and `wide` also imports hub. `loner` imports nothing.
const atlas = atlasWith(
  ['src/hub.ts', 'src/mid.ts', 'src/far.ts', 'src/wide.ts', 'src/loner.ts'],
  [
    ['src/mid.ts', 'src/hub.ts'],
    ['src/far.ts', 'src/mid.ts'],
    ['src/wide.ts', 'src/hub.ts'],
  ],
);
const graph = buildGraph(atlas);
const liveness = livenessOf(graph);
const idFor = (path: string): NodeId => {
  const ref = graph.refByPath.get(path);
  return ref === undefined ? '' : (atlas.nodes[ref]?.id ?? '');
};

const passOn = (subject: string, proved: readonly string[]) =>
  recordPass(EMPTY_PROGRESS, 'blastRadius', idFor(subject), proved.map(idFor));

describe('what a note is built from', () => {
  it('names the files that were proved, with how far each reaches', () => {
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/far.ts']), liveness);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.subjectPath).toBe('src/hub.ts');
    expect(notes[0]?.proved).toEqual([
      { path: 'src/mid.ts', distance: 1 },
      { path: 'src/far.ts', distance: 2 },
    ]);
    expect(notes[0]?.farthest).toBe(2);
  });

  it('keeps the full radius separate from what was proved', () => {
    // hub's real radius is {mid, far, wide} = 3; the player proved 1 of them.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    expect(notes[0]?.radius).toBe(3);
    expect(notes[0]?.proved).toHaveLength(1);
  });

  // These two assert an end-to-end property — a stale claim never renders — and
  // that property is enforced one layer up, by `livePasses`. `notes.ts`'s own
  // guards are unreachable; the comment there says so. Testing the behaviour
  // rather than the layer is the point: it must hold however the code moves.
  it('drops a member the graph no longer supports', () => {
    // `loner` imports nothing, so it was never in hub's radius. A save claiming
    // it must not render — a stale claim shown as knowledge is a worse lie than
    // showing nothing.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/loner.ts']), liveness);
    expect(notes[0]?.proved.map((file) => file.path)).toEqual(['src/mid.ts']);
  });

  it('goes dormant rather than half-rendering when nothing survives', () => {
    expect(fieldNotes(graph, passOn('src/hub.ts', ['src/loner.ts']), liveness)).toEqual([]);
  });

  it('goes dormant when the subject itself is gone', () => {
    const ghost = recordPass(EMPTY_PROGRESS, 'blastRadius', 'n:ffffffffffff', [idFor('src/mid.ts')]);
    expect(fieldNotes(graph, ghost, liveness)).toEqual([]);
  });

  it('orders by radius so the biggest thing you know comes first', () => {
    const both = recordPass(passOn('src/mid.ts', ['src/far.ts']), 'blastRadius', idFor('src/hub.ts'), [
      idFor('src/wide.ts'),
    ]);
    const notes = fieldNotes(graph, both, liveness);
    expect(notes.map((note) => note.subjectPath)).toEqual(['src/hub.ts', 'src/mid.ts']);
  });

  it('follows a rename, because the record keys on node identity', () => {
    // The note resolves NodeId → path through the atlas currently loaded, so a
    // moved file appears under its new name rather than vanishing. That is the
    // job ADR-0002 exists to do.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    expect(notes[0]?.proved[0]?.path).toBe(nodePathOf('src/mid.ts'));
  });
});

function nodePathOf(path: string): string {
  const ref = graph.refByPath.get(path);
  return ref === undefined ? '' : (atlas.nodes[ref]?.path ?? '');
}

describe('the prose claims exactly what was proved', () => {
  it('states the members, not the count of dependents', () => {
    // The load-bearing assertion. §9's "engine.ts has 14 dependents" is a claim
    // about the *radius*, which the player was shown and never proved.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    const note = notes[0];
    expect(note).toBeDefined();
    if (note === undefined) return;
    const { claim, revealed } = noteProse(note);
    expect(claim).toContain('You proved 1 file');
    expect(claim).toContain('src/mid.ts');
    // The radius is 3. It must not appear in the sentence that says "proved".
    expect(claim).not.toContain('3');
    expect(revealed).toContain('3 files');
    expect(revealed).toContain('revealed');
  });

  it('says nothing about a radius the player has fully proved', () => {
    const notes = fieldNotes(graph, passOn('src/mid.ts', ['src/far.ts']), liveness);
    const note = notes[0];
    expect(note?.radius).toBe(1);
    expect(note === undefined ? null : noteProse(note).revealed).toBeNull();
  });

  it('describes reach in the graph’s terms, not a fixed phrase', () => {
    const direct = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    const deep = fieldNotes(graph, passOn('src/hub.ts', ['src/far.ts']), liveness)[0];
    expect(direct === undefined ? '' : noteProse(direct).claim).toContain('direct importers');
    expect(deep === undefined ? '' : noteProse(deep).claim).toContain('2 hops away');
  });

  it('agrees with itself on singular and plural', () => {
    const one = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    const two = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/wide.ts']), liveness)[0];
    expect(one === undefined ? '' : noteProse(one).claim).toContain('1 file that depends on');
    expect(two === undefined ? '' : noteProse(two).claim).toContain('2 files that depend on');
  });

  it('mentions no repo of its own — every specific string came from the atlas', () => {
    // Guardrail 2. The template may only contribute numbers and connective words.
    const note = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    if (note === undefined) throw new Error('fixture');
    const { claim, revealed } = noteProse(note);
    // Split on separators only — not on `.`, which is inside every filename.
    const words = `${claim} ${revealed ?? ''}`
      .split(/[\s,—]+/)
      .map((word) => word.replace(/\.$/, ''))
      .filter((word) => word.includes('/'));
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect([note.subjectPath, ...note.proved.map((f) => f.path)]).toContain(word);
    }
  });
});
