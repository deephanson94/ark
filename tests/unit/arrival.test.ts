/**
 * The repository's own introduction.
 *
 * Pure, so the sentence is asserted here rather than read off a screenshot. The
 * claims worth holding are that it counts what it says it counts, that it names
 * the *load-bearing* file rather than the most-directly-imported one, and that
 * it says nothing on a map with no arrows in it — where "most load-bearing"
 * would be a claim about a graph that has no edges.
 */

import { describe, expect, it } from 'vitest';

import { arrivalLines, arrivalOf } from '../../src/player/arrival.js';
import { prepare } from '../../src/player/scene.js';
import { atlasWith } from '../fixtures/atlas.js';

describe('arrivalOf', () => {
  it('counts the files and the imports on the map', () => {
    const scene = prepare(
      atlasWith(
        ['src/hub.ts', 'src/a.ts', 'src/b.ts'],
        [
          ['src/a.ts', 'src/hub.ts'],
          ['src/b.ts', 'src/a.ts'],
        ],
      ),
    );
    const arrival = arrivalOf(scene);
    expect(arrival.files).toBe(3);
    expect(arrival.edges).toBe(2);
  });

  it('names the most load-bearing file, not the most directly imported one', () => {
    // `deep.ts` is imported once; `wide.ts` twice. But everything reaches
    // `deep.ts` through the chain, so its cone is the whole repo and `wide.ts`'s
    // is two — which is the difference between elevation and in-degree, and the
    // reason a barrel would otherwise be named over the thing it re-exports.
    const scene = prepare(
      atlasWith(
        ['src/deep.ts', 'src/mid.ts', 'src/wide.ts', 'src/one.ts', 'src/two.ts'],
        [
          ['src/mid.ts', 'src/deep.ts'],
          ['src/wide.ts', 'src/mid.ts'],
          ['src/one.ts', 'src/wide.ts'],
          ['src/two.ts', 'src/wide.ts'],
        ],
      ),
    );
    expect(arrivalOf(scene).landmark).toBe('deep.ts');
  });

  it('names nobody on a map with no edges', () => {
    const scene = prepare(atlasWith(['docs/a.md', 'docs/b.md'], []));
    const arrival = arrivalOf(scene);
    expect(arrival.landmark).toBeNull();
    expect(arrivalLines(arrival)).toHaveLength(1);
  });

  it('is the same sentence twice for the same atlas', () => {
    const atlas = atlasWith(
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      [
        ['src/b.ts', 'src/a.ts'],
        ['src/c.ts', 'src/a.ts'],
      ],
    );
    expect(arrivalLines(arrivalOf(prepare(atlas)))).toEqual(
      arrivalLines(arrivalOf(prepare(atlas))),
    );
  });

  it('agrees with English about one of anything', () => {
    const scene = prepare(atlasWith(['src/a.ts', 'src/b.ts'], [['src/b.ts', 'src/a.ts']]));
    const [counts] = arrivalLines(arrivalOf(scene));
    expect(counts).toContain('1 import between them');
    expect(counts).not.toContain('1 imports');
  });

  it('states no per-node number', () => {
    // The map already draws every node's direct importers and the inspector
    // prints the count, so a number here would disclose nothing new — but a
    // security researcher on the panel found that same figure beside a question
    // asking for that set is a shortcut, and nothing has been earned yet at
    // arrival. Aggregates and one name.
    const scene = prepare(
      atlasWith(
        ['src/hub.ts', 'src/a.ts', 'src/b.ts'],
        [
          ['src/a.ts', 'src/hub.ts'],
          ['src/b.ts', 'src/hub.ts'],
        ],
      ),
    );
    const landmark = arrivalLines(arrivalOf(scene))[1] ?? '';
    expect(landmark).toContain('hub.ts');
    expect(landmark).not.toMatch(/\d/);
  });
});
