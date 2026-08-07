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
  const nodes = [
    { id: 'n:000000000001', dependentCount: 0, radius: 20 },
    { id: 'n:000000000002', dependentCount: 9, radius: 4 },
    { id: 'n:000000000003', dependentCount: 3, radius: 8 },
    { id: 'n:000000000004', dependentCount: 0, radius: 3 },
    { id: 'n:000000000005', dependentCount: 5, radius: 5 },
  ];

  it('picks the most depended-upon files', () => {
    // §4's loop opens with "pick a landmark", so the hubs have to be visible.
    expect(landmarks(nodes, 0.6, 1)).toEqual(['n:000000000002', 'n:000000000005', 'n:000000000003']);
  });

  it('breaks ties by size, then id, so the choice is the same everywhere', () => {
    const tied = [
      { id: 'n:00000000000b', dependentCount: 2, radius: 5 },
      { id: 'n:00000000000a', dependentCount: 2, radius: 5 },
      { id: 'n:00000000000c', dependentCount: 2, radius: 9 },
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
