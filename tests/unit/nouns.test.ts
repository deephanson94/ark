import { describe, expect, it } from 'vitest';

import { buildGraph, commitIdFor, nodeIdFor } from '../../src/atlas/index.js';
import { counted, memberLabel, memberNoun, pathLabel, wordsFor } from '../../src/verbs/index.js';
import { atlasWith, goAtlas } from '../fixtures/atlas.js';

const ID = (path: string): string => nodeIdFor(path);

describe('what to call a set of members', () => {
  const graph = buildGraph(goAtlas());

  it('calls a set of Go packages packages, not files', () => {
    // The defect this exists for: 153 of `gohugoio/hugo`'s 156 Blast Radius
    // boards asked "which of these **files** depend on it" about packages.
    expect(memberNoun(graph, [ID('store'), ID('web')])).toEqual({
      one: 'package',
      many: 'packages',
    });
  });

  it('calls a set of files files', () => {
    expect(memberNoun(graph, [ID('web/client.ts'), ID('README.md')])).toEqual({
      one: 'file',
      many: 'files',
    });
  });

  it('calls a set of commits commits', () => {
    expect(memberNoun(graph, [commitIdFor('a'.repeat(12))])).toEqual({
      one: 'commit',
      many: 'commits',
    });
  });

  it('calls a mixed set places, which is the normal case on a Go repo', () => {
    // Not an edge case: a commit touches whatever it touches, so 118 of hugo's
    // 121 Placement boards and 151 of its 156 Companion boards are mixed.
    expect(memberNoun(graph, [ID('store'), ID('README.md')])).toEqual({
      one: 'place',
      many: 'places',
    });
  });

  it('says places for an empty set rather than guessing a kind', () => {
    expect(memberNoun(graph, [])).toEqual({ one: 'place', many: 'places' });
  });

  it('reads an id it does not know as a commit, never as a file', () => {
    // `memberLabel`'s fallback arm: a stored pass whose commit slid out of the
    // window. Calling it a *file* would put a wrong noun in a sentence about
    // something that is not on the map at all.
    expect(memberNoun(graph, ['c:000000000000'])).toEqual({ one: 'commit', many: 'commits' });
  });
});

describe('a noun agrees with its count', () => {
  it('uses the singular for exactly one', () => {
    expect(counted(1, { one: 'package', many: 'packages' })).toBe('1 package');
    expect(counted(2, { one: 'package', many: 'packages' })).toBe('2 packages');
    expect(counted(0, { one: 'file', many: 'files' })).toBe('0 files');
  });
});

describe('the repo root reads as a place in a sentence', () => {
  it('glosses `.` and leaves every other path alone', () => {
    // `spf13/cobra` is one flat Go package at the repo root, so its prompts
    // read "changed alongside ." until this.
    expect(pathLabel('.')).toBe('. (the root package)');
    expect(pathLabel('src/main.ts')).toBe('src/main.ts');
    expect(pathLabel('hugolib')).toBe('hugolib');
  });

  it('is the same rule the member label uses, not a second one', () => {
    const graph = buildGraph(goAtlas());
    expect(memberLabel(graph, ID('.'))).toBe('. (the root package)');
  });
});

describe('one vocabulary, shared by the console and the inspector', () => {
  it('answers for the whole atlas as well as for a board', () => {
    const words = wordsFor(buildGraph(goAtlas()));
    // A Go repo holds packages *and* files, so the repo-wide noun — which is
    // what Companion's wide-commit sentence counts in — is `places`.
    expect(words.repo).toEqual({ one: 'place', many: 'places' });
    expect(words.noun([ID('store')])).toEqual({ one: 'package', many: 'packages' });
    expect(words.label(ID('store'))).toBe('store');
  });

  it('is plain files on a repo that is all files', () => {
    const words = wordsFor(buildGraph(atlasWith(['src/a.ts', 'src/b.ts'])));
    expect(words.repo).toEqual({ one: 'file', many: 'files' });
    expect(words.noun([ID('src/a.ts')])).toEqual({ one: 'file', many: 'files' });
  });
});
