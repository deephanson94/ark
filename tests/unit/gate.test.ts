/**
 * The Ctrl+F gate.
 *
 * Pillar 3 says a challenge is violated when it "can be answered by `Ctrl+F`
 * rather than by reasoning about structure". These tests are that sentence made
 * checkable: build a board a filename-reader would ace, and assert the
 * generator refuses or repairs it.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import { buildGraph } from '../../src/atlas/index.js';
import { CTRL_F_THRESHOLD, gradeHeuristics } from '../../src/verbs/blastRadius/gate.js';
import { generateBlastRadius, generateWithReport } from '../../src/verbs/blastRadius/index.js';
import { BAND_THRESHOLDS, PASS_THRESHOLD } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

function refs(atlas: Atlas, paths: readonly string[]): number[] {
  return paths.map((path) => {
    const ref = atlas.nodes.findIndex((node) => node.path === path);
    if (ref < 0) throw new Error(`fixture has no ${path}`);
    return ref;
  });
}

describe('CTRL_F_THRESHOLD', () => {
  it('is band A, derived rather than written down', () => {
    expect(CTRL_F_THRESHOLD).toBe(BAND_THRESHOLDS.find(([band]) => band === 'A')?.[1]);
    // Deliberately *not* the pass threshold. ADR-0010: "the files in this folder
    // are coupled" is cheap but true, so scraping a C off it is an easy
    // question, not a broken one.
    expect(CTRL_F_THRESHOLD).toBeGreaterThan(PASS_THRESHOLD);
  });
});

describe('gradeHeuristics', () => {
  const atlas = atlasWith([
    'src/a/subject.ts',
    'src/a/one.ts',
    'src/a/two.ts',
    'src/b/subject.ts',
    'src/b/other.ts',
    'src/c/unrelated.ts',
  ]);

  it('catches a board whose answer is exactly the subject\'s directory', () => {
    const [subject] = refs(atlas, ['src/a/subject.ts']);
    const candidates = refs(atlas, [
      'src/a/one.ts',
      'src/a/two.ts',
      'src/b/other.ts',
      'src/c/unrelated.ts',
    ]);
    const truth = refs(atlas, ['src/a/one.ts', 'src/a/two.ts']);
    const verdict = gradeHeuristics(buildGraph(atlas), subject ?? 0, candidates, truth);
    expect(verdict.passed).toBe(false);
    expect(verdict.beatenBy).toContain('directory');
    expect(new Map(verdict.scores).get('directory')).toBe(1);
  });

  it('catches a board whose answer is exactly the name-alikes', () => {
    const [subject] = refs(atlas, ['src/a/subject.ts']);
    const candidates = refs(atlas, [
      'src/b/subject.ts',
      'src/a/one.ts',
      'src/a/two.ts',
      'src/c/unrelated.ts',
    ]);
    const truth = refs(atlas, ['src/b/subject.ts']);
    const verdict = gradeHeuristics(buildGraph(atlas), subject ?? 0, candidates, truth);
    expect(verdict.beatenBy).toContain('name');
  });

  it('passes a board where neither heuristic lines up with the answer', () => {
    const [subject] = refs(atlas, ['src/a/subject.ts']);
    const candidates = refs(atlas, [
      'src/a/one.ts',
      'src/a/two.ts',
      'src/b/other.ts',
      'src/c/unrelated.ts',
    ]);
    const truth = refs(atlas, ['src/c/unrelated.ts']);
    const verdict = gradeHeuristics(buildGraph(atlas), subject ?? 0, candidates, truth);
    expect(verdict.passed).toBe(true);
    expect(verdict.beatenBy).toEqual([]);
  });

  it('never judges by the direct importers, which the map gives away anyway', () => {
    // ADR-0008 shows depth 1 on hover by design and §8.4 measures `surprise`
    // against exactly that guess, so a question it answers is easy, not broken.
    const [subject] = refs(atlas, ['src/a/subject.ts']);
    const verdict = gradeHeuristics(buildGraph(atlas), subject ?? 0, refs(atlas, ['src/a/one.ts']), refs(atlas, ['src/a/one.ts']));
    expect(verdict.scores.map(([id]) => id).sort()).toEqual(['directory', 'name']);
  });
});

describe('the generator refuses what it cannot repair', () => {
  /** `aN → a(N-1) → … → a0`, all in one directory — vite's real fixture shape. */
  function synthChain(length: number, elsewhere: number): Atlas {
    const paths = [
      ...Array.from({ length }, (_, i) => `demo/entrypoints/a${String(i).padStart(2, '0')}.js`),
      ...Array.from({ length: elsewhere }, (_, i) => `far/p${String(i).padStart(2, '0')}.js`),
    ];
    const links: [string, string][] = [];
    for (let i = 0; i + 1 < length; i++) {
      links.push([
        `demo/entrypoints/a${String(i + 1).padStart(2, '0')}.js`,
        `demo/entrypoints/a${String(i).padStart(2, '0')}.js`,
      ]);
    }
    return atlasWith(paths, links);
  }

  it('refuses the chain endpoint, which is the question a cold playtest scored 0% on', () => {
    // `a00` is the bottom of the chain, so **every** file in its directory is a
    // dependent: there is no same-directory non-dependent to repair the board
    // with, and the directory heuristic scores 1.0. This is exactly
    // `playground/multiple-entrypoints/entrypoints/a0.js`, which §8.4 ranked the
    // hardest question in vite's deck and which teaches nothing.
    const atlas = synthChain(25, 24);
    const result = generateWithReport(atlas);
    const shipped = new Set(
      result.challenges.map((c) => atlas.nodes.find((n) => n.id === c.subject)?.path ?? ''),
    );
    expect(shipped.has('demo/entrypoints/a00.js')).toBe(false);
    expect(result.report.skipped).toContainEqual(['ctrlF', expect.any(Number)]);
  });

  it('repairs a chain middle using the subject\'s own dependencies', () => {
    // The other half, and the reason the gate repairs before it refuses: a
    // subject in the *middle* of the chain has files on both sides of it, and
    // the ones it imports are same-directory **non**-dependents — ADR-0008's
    // flagship distractor. The board is fixable, so it is fixed rather than
    // thrown away.
    const atlas = synthChain(25, 24);
    const graph = buildGraph(atlas);
    const middle = generateBlastRadius(atlas).find(
      (c) => atlas.nodes.find((n) => n.id === c.subject)?.path === 'demo/entrypoints/a12.js',
    );
    expect(middle).toBeDefined();
    if (middle === undefined) return;
    const inDirectory = middle.candidates.filter((id) =>
      (atlas.nodes.find((n) => n.id === id)?.path ?? '').startsWith('demo/entrypoints/'),
    );
    const truth = new Set(middle.truth);
    expect(inDirectory.some((id) => !truth.has(id))).toBe(true);
    const verdict = gradeHeuristics(
      graph,
      atlas.nodes.findIndex((n) => n.id === middle.subject),
      middle.candidates.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
      middle.truth.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
    );
    expect(verdict.passed).toBe(true);
  });

  it('keeps a question whose answer crosses directories', () => {
    // The control. Same shape, but the chain runs *between* directories, so the
    // directory heuristic has nothing to grab and the question survives.
    const paths = [
      ...Array.from({ length: 8 }, (_, i) => `mod${String(i).padStart(2, '0')}/index.ts`),
      ...Array.from({ length: 24 }, (_, i) => `far/p${String(i).padStart(2, '0')}.ts`),
    ];
    const links: [string, string][] = [];
    for (let i = 0; i + 1 < 8; i++) {
      links.push([`mod${String(i + 1).padStart(2, '0')}/index.ts`, `mod${String(i).padStart(2, '0')}/index.ts`]);
    }
    expect(generateBlastRadius(atlasWith(paths, links)).length).toBeGreaterThan(0);
  });

  it('ships nothing a filename-reader would get an A on', () => {
    // The gate's own postcondition, asserted over every board it emits.
    for (const atlas of [synthChain(25, 24), atlasWith(
      ['src/a/subject.ts', 'src/a/importer.ts', ...Array.from({ length: 24 }, (_, i) => `src/b/p${i}.ts`)],
      [['src/a/importer.ts', 'src/a/subject.ts']],
    )]) {
      const graph = buildGraph(atlas);
      for (const challenge of generateBlastRadius(atlas)) {
        const subject = atlas.nodes.findIndex((n) => n.id === challenge.subject);
        const verdict = gradeHeuristics(
          graph,
          subject,
          challenge.candidates.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
          challenge.truth.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
        );
        expect(verdict.passed, `${challenge.id} beaten by ${verdict.beatenBy.join(', ')}`).toBe(true);
      }
    }
  });
});
