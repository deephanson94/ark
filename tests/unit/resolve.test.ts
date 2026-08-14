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

/**
 * Resolving a specifier that names a package **this repository defines** (ADR-0042 decision 5).
 *
 * Three arms, and every assertion below is about a gap between them rather than about an arm:
 *
 *   1. `exports` declares the subpath and its target is on the map — authoritative.
 *   2. `exports` declares it and the target is missing (a build artifact) — fall back to the
 *      source-layout mirror `<dir>/src/<rest>` and **nowhere else**.
 *   3. `exports` says nothing — plain directory resolution, which is what Node does without one.
 *
 * The two `''`-directory cases are the ones an adversarial review found in the first version of
 * this code, both of them ADR-0026's *a path prefix and a node key are not the same string*.
 */
function workspace(
  files: readonly string[],
  packages: Record<string, { dir: string; exports?: Record<string, string> }>,
): ResolveContext {
  const base = context(files, {}, Object.keys(packages));
  return {
    ...base,
    workspacePackages: new Map(
      Object.entries(packages).map(([name, entry]) => [
        name,
        { dir: entry.dir, exports: new Map(Object.entries(entry.exports ?? {})) },
      ]),
    ),
  };
}

describe('resolveSpecifier — a package this repo defines', () => {
  it('follows an exports map that names source', () => {
    // apollo-client's shape: `{".": "./src/core/index.ts"}`, at the repository root.
    const ctx = workspace(['src/core/index.ts', 'src/consumer.ts'], {
      '@apollo/client': { dir: '', exports: { '.': './src/core/index.ts' } },
    });
    expect(resolveSpecifier('src/consumer.ts', '@apollo/client', ctx)).toEqual({
      kind: 'internal',
      path: 'src/core/index.ts',
      confidence: 'certain',
    });
  });

  it('falls back to the source mirror when exports names a build artifact', () => {
    // rxjs's shape: exports points at `dist/`, which is not on the map; `packages/*/src/` is.
    const ctx = workspace(['packages/test/src/index.ts', 'packages/rxjs/src/a.ts'], {
      '@rxjs/test': { dir: 'packages/test', exports: { '.': './dist/esm/index.js' } },
    });
    expect(resolveSpecifier('packages/rxjs/src/a.ts', '@rxjs/test', ctx)).toEqual({
      kind: 'internal',
      path: 'packages/test/src/index.ts',
      confidence: 'certain',
    });
  });

  it('resolves through the package directory when there is no exports map', () => {
    // nest's shape: no `exports` and no `main` anywhere; 493 specifiers resolve this way.
    const ctx = workspace(['packages/common/utils/shared.utils.ts', 'packages/core/x.ts'], {
      '@nestjs/common': { dir: 'packages/common' },
    });
    expect(resolveSpecifier('packages/core/x.ts', '@nestjs/common/utils/shared.utils', ctx)).toEqual({
      kind: 'internal',
      path: 'packages/common/utils/shared.utils.ts',
      confidence: 'certain',
    });
  });

  /**
   * **The wrong answer key this ordering exists to prevent.** `exports` maps `./utils` to a build
   * artifact compiled from `src/utils.ts`. A root-level `utils.ts` decoy exists. Falling through
   * from a *declared* subpath to `<dir>/<rest>` — which at a root manifest is the repository root —
   * resolves the specifier to the decoy, `certain`, and the real file never gets the edge.
   */
  it('never falls from a declared exports subpath to the package directory', () => {
    const ctx = workspace(['src/utils.ts', 'utils.ts', 'src/consumer.ts'], {
      myrepo: { dir: '', exports: { './utils': './dist/utils.js' } },
    });
    const hit = resolveSpecifier('src/consumer.ts', 'myrepo/utils', ctx);
    expect(hit).toEqual({ kind: 'internal', path: 'src/utils.ts', confidence: 'certain' });
    // …and specifically not the decoy.
    expect(hit).not.toEqual(expect.objectContaining({ path: 'utils.ts' }));
  });

  /**
   * **The dead arm.** With a manifest at the repository root `dir` is `''`, and `` `${dir}/src` ``
   * is `/src` — a leading slash `normalizeJoin` preserves and no node key can match. The first
   * version of this block built exactly that, so both fallback arms were inert for every
   * root-level package: 8 of the 12 corpus repos with a root manifest self-import their own name.
   */
  it('resolves under a manifest at the repository root', () => {
    const ctx = workspace(['src/index.ts', 'src/utils.ts', 'src/consumer.ts'], {
      myrepo: { dir: '' },
    });
    expect(resolveSpecifier('src/consumer.ts', 'myrepo', ctx)).toEqual({
      kind: 'internal',
      path: 'src/index.ts',
      confidence: 'certain',
    });
    expect(resolveSpecifier('src/consumer.ts', 'myrepo/utils', ctx)).toEqual({
      kind: 'internal',
      path: 'src/utils.ts',
      confidence: 'certain',
    });
  });

  it('stays unresolved when nothing lands on an indexed file', () => {
    // The refusal is kept, not replaced: a workspace sibling reaches back into the repo, so
    // calling it `external` would be the false negative guardrail 4 exists to catch.
    const ctx = workspace(['src/consumer.ts'], {
      myrepo: { dir: 'packages/thing', exports: { '.': './dist/index.js' } },
    });
    expect(resolveSpecifier('src/consumer.ts', 'myrepo', ctx)).toEqual({ kind: 'unresolved' });
  });
});
