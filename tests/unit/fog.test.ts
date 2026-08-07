/**
 * The fog vocabulary.
 *
 * `progress.ts` derives a `Fog` from the player's record and owns every rule
 * about *how* a node gets promoted; this file covers what the words mean once
 * it has — which visibility a node reads as, and that coverage counts what was
 * proved rather than what was looked at.
 */

import { describe, expect, it } from 'vitest';

import type { Fog } from '../../src/player/fog.js';
import { coverage, landmarks, visibilityOf } from '../../src/player/fog.js';

const A = 'n:aaaaaaaaaaaa';
const B = 'n:bbbbbbbbbbbb';
const C = 'n:cccccccccccc';

const NOTHING: Fog = { surveyed: new Set(), understood: new Set() };
const fogOf = (surveyed: string[], understood: string[] = []): Fog => ({
  surveyed: new Set([...surveyed, ...understood]),
  understood: new Set(understood),
});

describe('fog', () => {
  it('starts with nothing revealed', () => {
    expect(visibilityOf(NOTHING, A)).toBe('silhouette');
    expect(coverage(NOTHING, 10).fraction).toBe(0);
  });

  it('surveying reveals identity but not understanding', () => {
    const fog = fogOf([A]);
    expect(visibilityOf(fog, A)).toBe('surveyed');
    // The distinction that is the whole product: looking is not knowing.
    expect(coverage(fog, 10).understood).toBe(0);
    expect(coverage(fog, 10).fraction).toBe(0);
  });

  it('understanding outranks surveying', () => {
    const fog = fogOf([], [A]);
    expect(visibilityOf(fog, A)).toBe('understood');
    expect(fog.surveyed.has(A)).toBe(true);
  });

  it('measures coverage by what was understood, not what was looked at', () => {
    const seen = coverage(fogOf([A, B], [C]), 4);
    expect(seen.surveyed).toBe(3);
    expect(seen.understood).toBe(1);
    expect(seen.fraction).toBe(0.25);
  });

  it('handles an empty atlas without dividing by zero', () => {
    expect(coverage(NOTHING, 0).fraction).toBe(0);
  });
});

describe('landmarks', () => {
  // `elevation` is the bit length of the *transitive* cone (ADR-0013);
  // `dependentCount` is the direct in-degree.
  const nodes = [
    { id: 'n:000000000001', elevation: 0, dependentCount: 0, radius: 20 },
    { id: 'n:000000000002', elevation: 4, dependentCount: 9, radius: 4 },
    { id: 'n:000000000003', elevation: 2, dependentCount: 3, radius: 8 },
    { id: 'n:000000000004', elevation: 0, dependentCount: 0, radius: 3 },
    { id: 'n:000000000005', elevation: 3, dependentCount: 5, radius: 5 },
  ];

  it('picks the most depended-upon files', () => {
    // §4's loop opens with "pick a landmark", so the hubs have to be visible.
    expect(landmarks(nodes, 0.6, 1)).toEqual(['n:000000000002', 'n:000000000005', 'n:000000000003']);
  });

  it('ranks a chokepoint above a file with more direct importers', () => {
    // The reason ranking moved from in-degree to elevation, as a fixture. The
    // chokepoint has **one** direct importer and reaches sixty files through a
    // barrel; the popular file is imported by twenty and reaches nobody else.
    // In-degree ranks them backwards, and it is the chokepoint a newcomer needs
    // named — its importance is precisely what looking cannot tell you. Real
    // instance: `src/atlas/identity.ts`, 2 direct importers, 60 dependents.
    const pair = [
      { id: 'n:0000000000aa', elevation: 6, dependentCount: 1, radius: 4 },
      { id: 'n:0000000000bb', elevation: 5, dependentCount: 20, radius: 9 },
    ];
    expect(landmarks(pair, 1, 1)).toEqual(['n:0000000000aa', 'n:0000000000bb']);
  });

  it('caps the count, because a skyline of 488 peaks is a plateau', () => {
    // A fraction does not scale: at 12% svelte names 488 landmarks. The
    // prior-art writeup's §4.3.5 is that a few globally visible landmarks beat
    // any amount of terrain, so the count is capped rather than grown.
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `n:${i.toString(16).padStart(12, '0')}`,
      elevation: i % 7,
      dependentCount: i,
      radius: 5,
    }));
    expect(landmarks(many, 0.12, 3)).toHaveLength(24);
    expect(landmarks(many, 0.12, 3, 5)).toHaveLength(5);
  });

  it('breaks ties by in-degree, then size, then id, so the choice is the same everywhere', () => {
    const tied = [
      { id: 'n:00000000000b', elevation: 2, dependentCount: 2, radius: 5 },
      { id: 'n:00000000000a', elevation: 2, dependentCount: 2, radius: 5 },
      { id: 'n:00000000000c', elevation: 2, dependentCount: 2, radius: 9 },
    ];
    expect(landmarks(tied, 1, 1)).toEqual(['n:00000000000c', 'n:00000000000a', 'n:00000000000b']);
  });

  it('honours the minimum even in a tiny repo', () => {
    expect(landmarks(nodes, 0.01, 3)).toHaveLength(3);
  });

  it('never asks for more nodes than exist', () => {
    expect(landmarks(nodes.slice(0, 2), 0.5, 10)).toHaveLength(2);
    expect(landmarks([], 0.5, 3)).toEqual([]);
  });

  it('does not reorder its input', () => {
    const copy = [...nodes];
    landmarks(nodes);
    expect(nodes).toEqual(copy);
  });
});
