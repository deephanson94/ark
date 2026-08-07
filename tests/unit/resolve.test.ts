import { describe, expect, it } from 'vitest';

import { EMPTY_CONFIG, normalizeJoin, resolveSpecifier } from '../../src/indexer/resolve.js';
import type { ProjectConfig, ResolveContext } from '../../src/indexer/resolve.js';

function context(
  files: readonly string[],
  overrides: Partial<ProjectConfig> = {},
  workspaceNames: readonly string[] = [],
): ResolveContext {
  const indexed = new Set(files);
  const config = { ...EMPTY_CONFIG, ...overrides };
  return {
    indexed,
    onDisk: new Set(files),
    configFor: () => config,
    workspaceNames: new Set(workspaceNames),
  };
}

describe('normalizeJoin', () => {
  it('resolves . and .. segments', () => {
    expect(normalizeJoin('src/indexer', './scan.js')).toBe('src/indexer/scan.js');
    expect(normalizeJoin('src/indexer', '../atlas/index.js')).toBe('src/atlas/index.js');
    expect(normalizeJoin('src', './a/../b.js')).toBe('src/b.js');
  });

  it('refuses to escape the repo root', () => {
    expect(normalizeJoin('src', '../../outside.js')).toBeNull();
  });
});

describe('resolveSpecifier — relative', () => {
  it('resolves an exact path', () => {
    const result = resolveSpecifier('src/a.ts', './b.ts', context(['src/a.ts', 'src/b.ts']));
    expect(result).toEqual({ kind: 'internal', path: 'src/b.ts', confidence: 'certain' });
  });

  it('rewrites .js to .ts, which is what TypeScript ESM output requires', () => {
    const result = resolveSpecifier('src/a.ts', './b.js', context(['src/a.ts', 'src/b.ts']));
    expect(result).toEqual({ kind: 'internal', path: 'src/b.ts', confidence: 'certain' });
  });

  it('adds an extension when the specifier has none', () => {
    const result = resolveSpecifier('src/a.ts', './b', context(['src/a.ts', 'src/b.ts']));
    expect(result).toEqual({ kind: 'internal', path: 'src/b.ts', confidence: 'certain' });
  });

  it('resolves a directory to its index file', () => {
    const result = resolveSpecifier('src/a.ts', './lib', context(['src/a.ts', 'src/lib/index.ts']));
    expect(result).toEqual({ kind: 'internal', path: 'src/lib/index.ts', confidence: 'certain' });
  });

  it('marks the edge probable when more than one target is viable', () => {
    // `./b.js` could be b.js, or the b.ts it was compiled from. Node would take
    // the first, TypeScript the second, and we cannot tell which the author
    // meant — so we take the literal match and flag the edge as a guess, which
    // is enough to keep it out of any challenge's answer key.
    const result = resolveSpecifier('src/a.ts', './b.js', context(['src/a.ts', 'src/b.ts', 'src/b.js']));
    expect(result).toEqual({ kind: 'internal', path: 'src/b.js', confidence: 'probable' });
  });

  it('walks up out of a directory', () => {
    const result = resolveSpecifier(
      'src/indexer/scan.ts',
      '../atlas/index.js',
      context(['src/indexer/scan.ts', 'src/atlas/index.ts']),
    );
    expect(result).toEqual({ kind: 'internal', path: 'src/atlas/index.ts', confidence: 'certain' });
  });

  it('reports a missing relative target as unresolved, not as external', () => {
    expect(resolveSpecifier('src/a.ts', './gone.js', context(['src/a.ts']))).toEqual({
      kind: 'unresolved',
    });
  });

  it('treats an unindexed asset as off-map — it cannot hide an edge', () => {
    const ctx: ResolveContext = {
      indexed: new Set(['src/a.ts']),
      onDisk: new Set(['src/a.ts', 'src/styles.css']),
      configFor: () => EMPTY_CONFIG,
      workspaceNames: new Set<string>(),
    };
    expect(resolveSpecifier('src/a.ts', './styles.css', ctx)).toEqual({
      kind: 'offMap',
      path: 'src/styles.css',
    });
  });

  it('treats an unindexed *module* as unresolved — it could hide an edge', () => {
    const ctx: ResolveContext = {
      indexed: new Set(['src/a.ts']),
      onDisk: new Set(['src/a.ts', 'src/huge.ts']),
      configFor: () => EMPTY_CONFIG,
      workspaceNames: new Set<string>(),
    };
    expect(resolveSpecifier('src/a.ts', './huge.js', ctx)).toEqual({ kind: 'unresolved' });
  });

  it('treats an unknown extension as a risk, not as inert', () => {
    // The list of inert extensions is a denylist on purpose. If it were an
    // allowlist of "things that can import", every format nobody thought of —
    // .vue, .svelte, .astro — would be silently assumed to hide nothing, and a
    // file full of imports would become invisible to guardrail 4.
    for (const extension of ['vue', 'svelte', 'astro', 'unheard-of']) {
      const ctx: ResolveContext = {
        indexed: new Set(['src/a.ts']),
        onDisk: new Set(['src/a.ts', `src/widget.${extension}`]),
        configFor: () => EMPTY_CONFIG,
      workspaceNames: new Set<string>(),
      };
      expect(
        resolveSpecifier('src/a.ts', `./widget.${extension}`, ctx),
        `.${extension} should count as a risk`,
      ).toEqual({ kind: 'unresolved' });
    }
  });
});

describe('resolveSpecifier — bare', () => {
  it('resolves node builtins', () => {
    expect(resolveSpecifier('src/a.ts', 'node:fs/promises', context(['src/a.ts']))).toEqual({
      kind: 'external',
      name: 'node:fs/promises',
    });
    expect(resolveSpecifier('src/a.ts', 'path', context(['src/a.ts']))).toEqual({
      kind: 'external',
      name: 'path',
    });
  });

  it('resolves a declared dependency, including a scoped one', () => {
    const ctx = context(['src/a.ts'], { dependencies: new Set(['vitest', '@types/node']) });
    expect(resolveSpecifier('src/a.ts', 'vitest', ctx)).toEqual({ kind: 'external', name: 'vitest' });
    expect(resolveSpecifier('src/a.ts', '@types/node/fs', ctx)).toEqual({
      kind: 'external',
      name: '@types/node',
    });
  });

  it('reports an undeclared bare specifier as unresolved, never as external', () => {
    // This is the distinction the whole guardrail rests on: "it is a package"
    // and "we have no idea" must not collapse into each other.
    expect(resolveSpecifier('src/a.ts', 'mystery-lib', context(['src/a.ts']))).toEqual({
      kind: 'unresolved',
    });
  });

  it('follows tsconfig path aliases into the repo', () => {
    const ctx = context(['src/a.ts', 'src/shared/util.ts'], {
      aliases: [{ prefix: '@shared/', wildcard: true, targets: ['src/shared/'] }],
    });
    expect(resolveSpecifier('src/a.ts', '@shared/util', ctx)).toEqual({
      kind: 'internal',
      path: 'src/shared/util.ts',
      confidence: 'certain',
    });
  });

  it('resolves through baseUrl', () => {
    const ctx = context(['src/a.ts', 'src/deep/thing.ts'], { baseUrl: 'src' });
    expect(resolveSpecifier('src/a.ts', 'deep/thing.js', ctx)).toEqual({
      kind: 'internal',
      path: 'src/deep/thing.ts',
      confidence: 'certain',
    });
  });

  it('treats an absolute path as unresolved — it is machine-specific', () => {
    expect(resolveSpecifier('src/a.ts', '/opt/lib/x.js', context(['src/a.ts']))).toEqual({
      kind: 'unresolved',
    });
  });

  it('treats a URL specifier as external', () => {
    expect(resolveSpecifier('src/a.ts', 'https://esm.sh/x', context(['src/a.ts']))).toEqual({
      kind: 'external',
      name: 'https://esm.sh/x',
    });
  });
});
