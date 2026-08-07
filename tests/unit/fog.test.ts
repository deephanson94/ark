import { describe, expect, it } from 'vitest';

import { CLEAR_FOG, coverage, landmarks, survey, understand, visibilityOf } from '../../src/player/fog.js';

const A = 'n:aaaaaaaaaaaa';
const B = 'n:bbbbbbbbbbbb';
const C = 'n:cccccccccccc';

describe('fog', () => {
  it('starts with nothing revealed', () => {
    expect(visibilityOf(CLEAR_FOG, A)).toBe('silhouette');
    expect(coverage(CLEAR_FOG, 10).fraction).toBe(0);
  });

  it('surveying reveals identity but not understanding', () => {
    const fog = survey(CLEAR_FOG, A);
    expect(visibilityOf(fog, A)).toBe('surveyed');
    // The distinction that is the whole product: looking is not knowing.
    expect(coverage(fog, 10).understood).toBe(0);
    expect(coverage(fog, 10).fraction).toBe(0);
  });

  it('understanding implies having surveyed', () => {
    const fog = understand(CLEAR_FOG, [A]);
    expect(visibilityOf(fog, A)).toBe('understood');
    expect(fog.surveyed.has(A)).toBe(true);
  });

  it('measures coverage by what was understood, not what was looked at', () => {
    const fog = understand(survey(survey(CLEAR_FOG, A), B), [C]);
    const seen = coverage(fog, 4);
    expect(seen.surveyed).toBe(3);
    expect(seen.understood).toBe(1);
    expect(seen.fraction).toBe(0.25);
  });

  it('does not mutate the fog it was given', () => {
    const before = survey(CLEAR_FOG, A);
    const after = survey(before, B);
    expect(before.surveyed.has(B)).toBe(false);
    expect(after.surveyed.has(B)).toBe(true);
  });

  it('returns the same object when nothing changes', () => {
    const fog = survey(CLEAR_FOG, A);
    expect(survey(fog, A)).toBe(fog);
  });

  it('handles an empty atlas without dividing by zero', () => {
    expect(coverage(CLEAR_FOG, 0).fraction).toBe(0);
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
