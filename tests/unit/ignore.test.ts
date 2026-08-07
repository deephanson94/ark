import { describe, expect, it } from 'vitest';

import { isIgnored, layerFromPatterns, parseIgnoreFile } from '../../src/indexer/ignore.js';

function ignored(patterns: readonly string[], path: string, isDirectory = false): boolean {
  return isIgnored([layerFromPatterns(patterns)], path, isDirectory);
}

describe('isIgnored', () => {
  it('always excludes .git, whatever the patterns say', () => {
    expect(ignored([], '.git', true)).toBe(true);
    expect(ignored(['!.git'], '.git/config')).toBe(true);
  });

  it('matches a bare name at any depth', () => {
    expect(ignored(['node_modules'], 'node_modules', true)).toBe(true);
    expect(ignored(['node_modules'], 'packages/app/node_modules', true)).toBe(true);
    expect(ignored(['atlas.json'], 'src/atlas.json')).toBe(true);
  });

  it('anchors a pattern that starts with a slash', () => {
    expect(ignored(['/dist'], 'dist', true)).toBe(true);
    expect(ignored(['/dist'], 'packages/dist', true)).toBe(false);
  });

  it('anchors a pattern containing an interior slash', () => {
    expect(ignored(['src/generated'], 'src/generated', true)).toBe(true);
    expect(ignored(['src/generated'], 'lib/src/generated', true)).toBe(false);
  });

  it('applies a trailing slash to directories only', () => {
    expect(ignored(['build/'], 'build', true)).toBe(true);
    expect(ignored(['build/'], 'build', false)).toBe(false);
  });

  it('expands * without crossing a separator', () => {
    expect(ignored(['*.log'], 'debug.log')).toBe(true);
    expect(ignored(['*.log'], 'logs/debug.log')).toBe(true);
    expect(ignored(['/*.log'], 'logs/debug.log')).toBe(false);
    expect(ignored(['src/*.ts'], 'src/a.ts')).toBe(true);
    expect(ignored(['src/*.ts'], 'src/deep/a.ts')).toBe(false);
  });

  it('expands ** across directories', () => {
    expect(ignored(['src/**/*.spec.ts'], 'src/a/b/c.spec.ts')).toBe(true);
    expect(ignored(['src/**/*.spec.ts'], 'src/c.spec.ts')).toBe(true);
  });

  it('supports ? and character classes', () => {
    expect(ignored(['a?.ts'], 'ab.ts')).toBe(true);
    expect(ignored(['a?.ts'], 'abc.ts')).toBe(false);
    expect(ignored(['[abc].ts'], 'b.ts')).toBe(true);
    expect(ignored(['[!abc].ts'], 'd.ts')).toBe(true);
  });

  it('lets a later negation re-include a file', () => {
    expect(ignored(['*.log', '!keep.log'], 'keep.log')).toBe(false);
    expect(ignored(['*.log', '!keep.log'], 'other.log')).toBe(true);
  });

  it('lets the last matching rule win, not the first', () => {
    expect(ignored(['!keep.log', '*.log'], 'keep.log')).toBe(true);
  });

  it('skips comments and blank lines', () => {
    const layer = parseIgnoreFile('', '# a comment\n\n   \n*.tmp\n');
    expect(isIgnored([layer], 'x.tmp', false)).toBe(true);
    expect(isIgnored([layer], '# a comment', false)).toBe(false);
  });
});

describe('nested .gitignore precedence', () => {
  const root = layerFromPatterns(['*.ts']);
  const nested = parseIgnoreFile('src/keep', '!*.ts\n');

  it('lets a deeper file override a shallower one', () => {
    expect(isIgnored([root, nested], 'src/keep/a.ts', false)).toBe(false);
    expect(isIgnored([root, nested], 'src/other/a.ts', false)).toBe(true);
  });

  it('ignores rules from a directory the path is not under', () => {
    expect(isIgnored([root, parseIgnoreFile('elsewhere', '!*.ts\n')], 'src/a.ts', false)).toBe(true);
  });
});
