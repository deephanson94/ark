import { describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import { parseAtlas, serializeAtlas } from '../../src/atlas/index.js';
import { atlasWith } from '../fixtures/atlas.js';

const SAMPLE = atlasWith(
  ['a.ts', 'b.ts', 'c.ts', 'docs/readme.md'],
  [
    ['b.ts', 'a.ts'],
    ['c.ts', 'a.ts'],
  ],
);

/** Rebuild an object graph with its keys in reverse order at every level. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, item]) => [key, reverseKeys(item)]));
  }
  return value;
}

describe('serializeAtlas', () => {
  it('is stable across calls', () => {
    expect(serializeAtlas(SAMPLE)).toBe(serializeAtlas(SAMPLE));
  });

  it('does not depend on the order the object was built in', () => {
    // JS preserves insertion order for string keys, so without canonicalisation
    // a harmless refactor of the builder would change every byte of the atlas
    // and the determinism test would start reporting phantom drift.
    const shuffled = reverseKeys(SAMPLE) as Atlas;
    expect(serializeAtlas(shuffled)).toBe(serializeAtlas(SAMPLE));
  });

  it('round-trips through the validator', () => {
    const parsed = parseAtlas(serializeAtlas(SAMPLE));
    expect(parsed.nodes.map((node) => node.path)).toEqual(SAMPLE.nodes.map((node) => node.path));
    expect(parsed.edges).toEqual(SAMPLE.edges);
  });

  it('ends with exactly one trailing newline', () => {
    const text = serializeAtlas(SAMPLE);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('puts long arrays one element per line so a diff is readable', () => {
    const wide = atlasWith(Array.from({ length: 12 }, (_, i) => `f${i}.ts`));
    const text = serializeAtlas(wide);
    const nodeLines = text.split('\n').filter((line) => line.trimStart().startsWith('{"authors"'));
    expect(nodeLines).toHaveLength(12);
  });

  it('emits sorted keys', () => {
    const first = serializeAtlas(SAMPLE).indexOf('"challenges"');
    const second = serializeAtlas(SAMPLE).indexOf('"edges"');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it('refuses to serialise a non-finite number rather than emitting null', () => {
    const broken = { ...SAMPLE, nodes: [{ ...SAMPLE.nodes[0], loc: Number.NaN }] } as unknown as Atlas;
    expect(() => serializeAtlas(broken)).toThrow(/cannot serialise/);
  });
});
