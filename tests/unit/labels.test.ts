import { describe, expect, it } from 'vitest';

import { placeLabels } from '../../src/player/labels.js';
import type { LabelCandidate } from '../../src/player/labels.js';

/** Fixed-width measurement, so the geometry is exactly predictable. */
const measure = (text: string): number => text.length * 8;

const OPTIONS = { lineHeight: 14, padding: 3, budget: 100, width: 1000, height: 800 };

function candidate(text: string, x: number, y: number, priority = 0): LabelCandidate {
  return { text, x, y, offset: 4, priority };
}

describe('placeLabels', () => {
  it('places a label under its anchor', () => {
    const [placed] = placeLabels([candidate('a.ts', 100, 100)], measure, OPTIONS);
    expect(placed?.x).toBe(100);
    expect(placed?.y).toBeGreaterThan(100);
  });

  it('skips a label that would collide with one already placed', () => {
    const placed = placeLabels(
      [candidate('alpha.ts', 100, 100, 10), candidate('beta.ts', 104, 100, 1)],
      measure,
      OPTIONS,
    );
    expect(placed.map((label) => label.text)).toEqual(['alpha.ts']);
  });

  it('keeps both when they are far enough apart', () => {
    const placed = placeLabels(
      [candidate('alpha.ts', 100, 100), candidate('beta.ts', 600, 400)],
      measure,
      OPTIONS,
    );
    expect(placed).toHaveLength(2);
  });

  it('gives the space to the higher priority label', () => {
    // Priority is in-degree: the hubs are the names worth knowing, so when two
    // labels compete for the same pixels the more depended-upon one wins.
    const placed = placeLabels(
      [candidate('leaf.ts', 100, 100, 1), candidate('hub.ts', 102, 100, 99)],
      measure,
      OPTIONS,
    );
    expect(placed.map((label) => label.text)).toEqual(['hub.ts']);
  });

  it('resolves equal priorities the same way every time', () => {
    // A label that flickers as you pan is worse than no label at all.
    const candidates = [candidate('b.ts', 100, 100, 5), candidate('a.ts', 102, 100, 5)];
    const first = placeLabels(candidates, measure, OPTIONS);
    const second = placeLabels([...candidates].reverse(), measure, OPTIONS);
    expect(first.map((label) => label.text)).toEqual(second.map((label) => label.text));
    expect(first.map((label) => label.text)).toEqual(['a.ts']);
  });

  it('respects the budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => candidate(`f${i}.ts`, i * 90, 100));
    expect(placeLabels(many, measure, { ...OPTIONS, budget: 5 })).toHaveLength(5);
  });

  it('draws nothing when the budget is zero', () => {
    expect(placeLabels([candidate('a.ts', 100, 100)], measure, { ...OPTIONS, budget: 0 })).toEqual([]);
  });

  it('drops labels that fall outside the viewport', () => {
    const placed = placeLabels(
      [candidate('offscreen.ts', -900, 100), candidate('onscreen.ts', 500, 400)],
      measure,
      OPTIONS,
    );
    expect(placed.map((label) => label.text)).toEqual(['onscreen.ts']);
  });

  it('does not reorder its input', () => {
    const candidates = [candidate('b.ts', 100, 100, 1), candidate('a.ts', 400, 400, 9)];
    const copy = [...candidates];
    placeLabels(candidates, measure, OPTIONS);
    expect(candidates).toEqual(copy);
  });

  it('accounts for text width when deciding overlap', () => {
    const shortLabels = placeLabels(
      [candidate('a', 100, 100, 9), candidate('b', 130, 100, 1)],
      measure,
      OPTIONS,
    );
    const longLabels = placeLabels(
      [candidate('aaaaaaaaaaaaaaa', 100, 100, 9), candidate('bbbbbbbbbbbbbbb', 130, 100, 1)],
      measure,
      OPTIONS,
    );
    expect(shortLabels).toHaveLength(2);
    expect(longLabels).toHaveLength(1);
  });
});
