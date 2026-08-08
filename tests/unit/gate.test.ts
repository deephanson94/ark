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
import { buildGraph, validateAtlas } from '../../src/atlas/index.js';
import {
  CTRL_F_THRESHOLD,
  HISTORY_HEURISTICS,
  PATH_HEURISTICS,
  gradeHeuristics,
  pathSubject,
} from '../../src/verbs/gate.js';
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
    const verdict = gradeHeuristics(buildGraph(atlas), pathSubject(buildGraph(atlas), subject ?? 0), candidates, truth);
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
    const verdict = gradeHeuristics(buildGraph(atlas), pathSubject(buildGraph(atlas), subject ?? 0), candidates, truth);
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
    const verdict = gradeHeuristics(buildGraph(atlas), pathSubject(buildGraph(atlas), subject ?? 0), candidates, truth);
    expect(verdict.passed).toBe(true);
    expect(verdict.beatenBy).toEqual([]);
  });

  it('never judges by the direct importers, which the map gives away anyway', () => {
    // ADR-0008 shows depth 1 on hover by design and §8.4 measures `surprise`
    // against exactly that guess, so a question it answers is easy, not broken.
    const [subject] = refs(atlas, ['src/a/subject.ts']);
    const verdict = gradeHeuristics(buildGraph(atlas), pathSubject(buildGraph(atlas), subject ?? 0), refs(atlas, ['src/a/one.ts']), refs(atlas, ['src/a/one.ts']));
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

  it('keeps chain middles, whose own dependencies are same-directory non-dependents', () => {
    // The other half, and the reason the endpoint alone is refused: a subject in
    // the *middle* of the chain has files on both sides of it, and the ones it
    // imports are same-directory **non**-dependents — ADR-0008's flagship
    // distractor. The board is defensible, so it survives.
    //
    // Deliberately "some middle" rather than a named one. Every subject in a
    // chain has the same *tail*, so deepest-first sampling gives them all the
    // same top six and `dedupe` re-asks all but three of them out of existence.
    // Pinning `a12` pinned which subject won that draw, which is a fact about
    // the dedupe order and not about the gate.
    const atlas = synthChain(25, 24);
    const graph = buildGraph(atlas);
    const pathOf = (id: string): string => atlas.nodes.find((n) => n.id === id)?.path ?? '';
    const middles = generateBlastRadius(atlas).filter((c) => {
      const path = pathOf(c.subject);
      const index = Number(path.replace('demo/entrypoints/a', '').replace('.js', ''));
      return path.startsWith('demo/entrypoints/') && index > 0 && index < 19;
    });
    expect(middles.length).toBeGreaterThan(0);
    for (const middle of middles) {
      const inDirectory = middle.candidates.filter((id) =>
        pathOf(id).startsWith('demo/entrypoints/'),
      );
      const truth = new Set(middle.truth);
      expect(inDirectory.some((id) => !truth.has(id))).toBe(true);
      const verdict = gradeHeuristics(
        graph,
        pathSubject(graph, atlas.nodes.findIndex((n) => n.id === middle.subject)),
        middle.candidates.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
        middle.truth.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
      );
      expect(verdict.passed).toBe(true);
    }
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
          pathSubject(graph, subject),
          challenge.candidates.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
          challenge.truth.map((id) => atlas.nodes.findIndex((n) => n.id === id)),
        );
        expect(verdict.passed, `${challenge.id} beaten by ${verdict.beatenBy.join(', ')}`).toBe(true);
      }
    }
  });
});

describe('the churn heuristic (Companion)', () => {
  /**
   * The naive strategy for a co-change question is not "same folder" — it is
   * *"the files that change all the time change with everything"*. On this repo
   * `CHANGELOG.md` has 37 co-change partners and is nobody's specific
   * companion. So Companion's gate scores that guess too, and this is the
   * assertion that it actually does: without it the heuristic was dead code
   * that a mutation could delete unnoticed.
   *
   * Measured on real repos, it refuses 13 subjects here, 17 on `honojs/hono`
   * and 132 on `sveltejs/svelte` — machinery that fires, which is the bar
   * CLAUDE.md sets before writing tests around a new path.
   */
  // The busy files sit in *different* directories from the subject and share no
  // name token with it, so `directory` and `name` both score 0 here. Otherwise
  // this would pass whichever heuristic happened to fire, and prove nothing
  // about `churn` — the vacuous pass CLAUDE.md warns about.
  const busy = atlasWith(
    ['src/cold.ts', 'src/ice.ts', 'lib/hot.ts', 'lib/far.ts', 'vendor/warm.ts', 'vendor/away.ts'],
    [],
  );
  const churned = validateAtlas({
    ...busy,
    nodes: busy.nodes.map((node) => ({
      ...node,
      churn: node.path === 'lib/hot.ts' || node.path === 'vendor/warm.ts' ? 90 : 1,
    })),
  });

  const refOf = (path: string): number => churned.nodes.findIndex((n) => n.path === path);

  it('catches a board whose answer is exactly the busiest candidates', () => {
    const graph = buildGraph(churned);
    const candidates = churned.nodes.map((_, ref) => ref).filter((ref) => ref !== refOf('src/cold.ts'));
    const truth = [refOf('lib/hot.ts'), refOf('vendor/warm.ts')];
    const verdict = gradeHeuristics(
      graph,
      pathSubject(graph, refOf('src/cold.ts')),
      candidates,
      truth,
      HISTORY_HEURISTICS,
    );
    expect(verdict.beatenBy).toContain('churn');
    expect(verdict.passed).toBe(false);
  });

  it('leaves Blast Radius boards alone — it is not in that verb\'s heuristic set', () => {
    // Deliberate: adding a heuristic to a shipped verb would delete questions
    // from it for a reason nobody measured.
    const graph = buildGraph(churned);
    const candidates = churned.nodes.map((_, ref) => ref).filter((ref) => ref !== refOf('src/cold.ts'));
    const truth = [refOf('lib/hot.ts'), refOf('vendor/warm.ts')];
    const verdict = gradeHeuristics(graph, pathSubject(graph, refOf('src/cold.ts')), candidates, truth, PATH_HEURISTICS);
    expect(verdict.scores.map(([id]) => id)).not.toContain('churn');
    expect(verdict.passed).toBe(true);
  });

  it('takes exactly as many as the answer key holds, so there is no free parameter', () => {
    // A fixed k would be a magic number. Sized to the key, it is the strongest
    // guess a pure-churn player could make.
    const graph = buildGraph(churned);
    const candidates = churned.nodes.map((_, ref) => ref).filter((ref) => ref !== refOf('src/cold.ts'));
    // One-member key: only the single busiest file is guessed, so a two-file
    // answer cannot be scored against a one-file guess and the board survives.
    const verdict = gradeHeuristics(
      graph,
      pathSubject(graph, refOf('src/cold.ts')),
      candidates,
      [refOf('lib/far.ts')],
      HISTORY_HEURISTICS,
    );
    expect(verdict.scores.find(([id]) => id === 'churn')?.[1]).toBe(0);
  });
});
