/**
 * Canonical serialisation.
 *
 * `test:determinism` diffs bytes, so "the same atlas" has to mean "the same
 * string". Two things could break that even when the data is identical:
 * object key order (JS preserves insertion order, so a refactor that builds a
 * record's fields in a different order silently changes the file) and array
 * ordering (handled upstream — every array in the atlas has a defined order).
 *
 * We fix the first by sorting keys. It costs a little human readability at the
 * top level and buys a canonical form that no future refactor can perturb.
 *
 * Arrays longer than `EXPAND_ABOVE` print one element per line. That is purely
 * for diffability: a one-line 3 MB atlas tells you nothing about what changed.
 */

import type { Atlas } from './schema.js';

const EXPAND_ABOVE = 8;

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

function compact(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`cannot serialise ${value}`);
    // JSON.stringify emits the shortest round-tripping representation, which
    // ECMAScript specifies exactly — so this is stable across engines.
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(compact).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${compact(v)}`).join(',')}}`;
  }
  throw new TypeError(`cannot serialise ${typeof value}`);
}

function expand(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length <= EXPAND_ABOVE && !value.some(isContainer)) return compact(value);
    const inner = indent + '  ';
    const items = value.map((item) => inner + expand(item, inner));
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return '{}';
    if (!entries.some(([, v]) => isLargeContainer(v))) return compact(value);
    const inner = indent + '  ';
    const parts = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${expand(v, inner)}`);
    return `{\n${parts.join(',\n')}\n${indent}}`;
  }
  return compact(value);
}

function isContainer(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

function isLargeContainer(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > EXPAND_ABOVE || value.some(isContainer);
  if (isContainer(value)) {
    return Object.values(value as Record<string, unknown>).some(isLargeContainer);
  }
  return false;
}

/** The canonical bytes of an atlas. Ends with a trailing newline. */
export function serializeAtlas(atlas: Atlas): string {
  return `${expand(atlas as unknown as Json, '')}\n`;
}
