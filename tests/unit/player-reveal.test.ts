/**
 * How the console lays out the rows a player left alone (`src/player/reveal.ts`,
 * ADR-0050).
 *
 * `challenge.ts` is a DOM builder with no unit tests — the console is covered
 * only by `test:e2e` — so the *rule* lives out here where it can be asserted,
 * and every assertion below was mutation-checked.
 */
import { describe, expect, it } from 'vitest';

import type { RevealNote } from '../../src/verbs/index.js';
import { groupAvoided } from '../../src/player/reveal.js';

function note(label: string, text: string): RevealNote {
  return { id: `n:${label}`, label, kind: 'avoided', note: text, witness: null };
}

describe('groupAvoided', () => {
  it('collapses rows that say the same thing into one block', () => {
    // Archaeology averages 15.6 of these rows carrying **2.2** distinct
    // sentences, so a sentence per row makes the panel eight times longer and
    // says two things (`scripts/probe-silent.ts`).
    const groups = groupAvoided([
      note('a.ts', 'it landed inside this file’s lifetime and never touched it.'),
      note('b.ts', 'it landed inside this file’s lifetime and never touched it.'),
      note('c.ts', 'the subject imports this — the arrow points the other way.'),
      note('d.ts', 'it landed inside this file’s lifetime and never touched it.'),
    ]);
    expect(groups.map((group) => group.members.length)).toEqual([3, 1]);
    expect(groups[0]?.members.map((member) => member.label)).toEqual(['a.ts', 'b.ts', 'd.ts']);
  });

  it('keeps every row, so the panel still accounts for the whole board', () => {
    const rows = [note('a.ts', 'x'), note('b.ts', 'y'), note('c.ts', 'x')];
    const groups = groupAvoided(rows);
    expect(groups.reduce((n, group) => n + group.members.length, 0)).toBe(rows.length);
  });

  it('orders a group by its first member, so the layout is stable', () => {
    // Every verb has already sorted these rows; a group that jumped to the front
    // because it is large would reorder the panel between two boards that differ
    // only in how many rows share a sentence.
    const groups = groupAvoided([
      note('a.ts', 'only once'),
      note('b.ts', 'said twice'),
      note('c.ts', 'said twice'),
    ]);
    expect(groups.map((group) => group.note)).toEqual(['only once', 'said twice']);
  });

  it('leaves a verb whose rows all differ exactly as it found them', () => {
    // Companion and Placement average 10.1 and 11.9 distinct sentences over
    // ~15 rows, so grouping is close to a no-op there — which is the correct
    // outcome and not a missed optimisation.
    const rows = [note('a.ts', 'one'), note('b.ts', 'two'), note('c.ts', 'three')];
    expect(groupAvoided(rows).map((group) => group.members.length)).toEqual([1, 1, 1]);
  });

  it('has nothing to say about an empty set', () => {
    expect(groupAvoided([])).toEqual([]);
  });
});
