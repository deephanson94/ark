/**
 * Per-directory project configuration.
 *
 * These tests build real manifest trees on disk, because `loadConfigIndex` is
 * the imperative shell — its whole job is reading files — and a mocked
 * filesystem would test the mock. They are the cheapest place to pin the three
 * scoping rules down, and the three differ on purpose: Node and TypeScript do
 * not agree with each other, and copying one onto the other resolves imports
 * that do not exist.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { isManifest, loadConfigIndex } from '../../src/indexer/config.js';
import type { ConfigIndex } from '../../src/indexer/config.js';
import { resolveSpecifier } from '../../src/indexer/resolve.js';
import type { ResolveContext } from '../../src/indexer/resolve.js';

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** Write a tree of `{path: contents}` and index its manifests. */
async function fixture(files: Record<string, unknown>): Promise<ConfigIndex> {
  const root = await mkdtemp(join(tmpdir(), 'ark-config-'));
  roots.push(root);
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    const value = files[path];
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return loadConfigIndex(root, paths.filter(isManifest));
}

describe('isManifest', () => {
  it('matches the config files we understand, at any depth', () => {
    expect(isManifest('package.json')).toBe(true);
    expect(isManifest('packages/vite/package.json')).toBe(true);
    expect(isManifest('playground/tsconfig.json')).toBe(true);
    expect(isManifest('jsconfig.json')).toBe(true);
    expect(isManifest('src/index.ts')).toBe(false);
    expect(isManifest('docs/package.json.md')).toBe(false);
  });
});

describe('dependencies — union up the tree', () => {
  it('sees a dependency declared by an ancestor', async () => {
    const index = await fixture({
      'package.json': { name: 'root', devDependencies: { vitest: '^1' } },
      'packages/lib/package.json': { name: 'lib', dependencies: { 'magic-string': '^1' } },
    });
    const config = index.for('packages/lib/src/a.ts');
    expect(config.dependencies.has('magic-string')).toBe(true);
    expect(config.dependencies.has('vitest')).toBe(true);
  });

  it("does not leak a sibling package's dependencies sideways", async () => {
    const index = await fixture({
      'package.json': { name: 'root' },
      'packages/a/package.json': { name: 'a', dependencies: { 'only-in-a': '^1' } },
      'packages/b/package.json': { name: 'b' },
    });
    expect(index.for('packages/a/src/x.ts').dependencies.has('only-in-a')).toBe(true);
    expect(index.for('packages/b/src/x.ts').dependencies.has('only-in-a')).toBe(false);
  });
});

describe('subpath imports — the nearest package boundary only', () => {
  it('reads `imports` from the closest package.json', async () => {
    const index = await fixture({
      'package.json': { name: 'root', imports: { '#root/*': './root/*.ts' } },
      'packages/vite/package.json': { name: 'vite', imports: { '#types/*': './types/*.d.ts' } },
    });
    expect(index.for('packages/vite/src/node/a.ts').selfImports).toEqual(['#types/*']);
    // Node resolves `#` against the closest package boundary; the root's map is
    // not in scope inside `packages/vite`.
    expect(index.for('packages/vite/src/node/a.ts').selfImports).not.toContain('#root/*');
    expect(index.for('scripts/a.ts').selfImports).toEqual(['#root/*']);
  });
});

describe('tsconfig paths — nearest config, relative to its own directory', () => {
  it('reads a nested tsconfig and makes its targets repo-relative', async () => {
    // This is vite's `~utils` verbatim: 126 unresolved imports came from
    // reading only the root tsconfig.
    const index = await fixture({
      'tsconfig.json': { compilerOptions: {} },
      'playground/tsconfig.json': { compilerOptions: { paths: { '~utils': ['./test-utils.ts'] } } },
    });
    const config = index.for('playground/hmr/index.ts');
    expect(config.aliases).toHaveLength(1);
    expect(config.aliases[0]?.prefix).toBe('~utils');
    expect(config.aliases[0]?.targets).toEqual(['playground/test-utils.ts']);
  });

  it('resolves targets against baseUrl when one is set', async () => {
    const index = await fixture({
      'packages/app/tsconfig.json': {
        compilerOptions: { baseUrl: './src', paths: { '@/*': ['./lib/*'] } },
      },
    });
    const config = index.for('packages/app/src/main.ts');
    expect(config.baseUrl).toBe('packages/app/src');
    expect(config.aliases[0]?.targets).toEqual(['packages/app/src/lib/']);
  });

  it("follows a relative `extends` and keeps the parent directory", async () => {
    const index = await fixture({
      'tsconfig.base.json': { compilerOptions: { paths: { '@shared/*': ['./shared/*'] } } },
      'apps/web/tsconfig.json': { extends: '../../tsconfig.base.json', compilerOptions: {} },
    });
    const config = index.for('apps/web/src/a.ts');
    // Inherited paths are relative to the file that declared them, not the one
    // that extended it.
    expect(config.aliases[0]?.targets).toEqual(['shared/']);
  });

  it('lets the child override the parent it extends', async () => {
    const index = await fixture({
      'tsconfig.base.json': { compilerOptions: { paths: { '@x/*': ['./base/*'] } } },
      'apps/web/tsconfig.json': {
        extends: '../../tsconfig.base.json',
        compilerOptions: { paths: { '@x/*': ['./own/*'] } },
      },
    });
    expect(index.for('apps/web/a.ts').aliases[0]?.targets).toEqual(['apps/web/own/']);
  });

  it('survives a cyclic extends instead of hanging', async () => {
    const index = await fixture({
      'a.json': { extends: './b.json' },
      'b.json': { extends: './a.json' },
      'tsconfig.json': { extends: './a.json', compilerOptions: {} },
    });
    expect(index.for('src/x.ts').aliases).toEqual([]);
  });

  it('ignores a package extends, which lives in node_modules we do not walk', async () => {
    const index = await fixture({
      'tsconfig.json': { extends: '@tsconfig/node20/tsconfig.json', compilerOptions: {} },
    });
    expect(index.for('src/x.ts').aliases).toEqual([]);
  });
});

describe('a wildcard alias, loader to resolver', () => {
  it('keeps the separator, so `@app/foo` is not `srcfoo`', async () => {
    // End to end on purpose. The existing unit test for aliases hand-wrote its
    // target with the separator already attached, so it exercised the resolver
    // and never the loader that strips it — and the bug lived from M0 to M3.
    const index = await fixture({
      'tsconfig.json': { compilerOptions: { paths: { '@app/*': ['./src/*'] } } },
    });
    const context: ResolveContext = {
      indexed: new Set(['src/thing.ts']),
      onDisk: new Set(['src/thing.ts']),
      configFor: (path) => index.for(path),
      workspaceNames: new Set(),
    };
    expect(resolveSpecifier('other/a.ts', '@app/thing', context)).toEqual({
      kind: 'internal',
      path: 'src/thing.ts',
      confidence: 'certain',
    });
  });
});

describe('workspace names', () => {
  it('collects every package name the repo itself declares', async () => {
    const index = await fixture({
      'package.json': { name: 'vite-monorepo', devDependencies: { vite: 'workspace:*' } },
      'packages/vite/package.json': { name: 'vite' },
      'packages/plugin/package.json': { name: '@vitejs/plugin-legacy' },
    });
    expect([...index.workspaceNames].sort()).toEqual([
      '@vitejs/plugin-legacy',
      'vite',
      'vite-monorepo',
    ]);
  });
});

describe('the workspace-sibling rule in resolveSpecifier', () => {
  function contextWith(workspaceNames: readonly string[], dependencies: readonly string[]): ResolveContext {
    return {
      indexed: new Set(['packages/vite/src/node/index.ts']),
      onDisk: new Set(['packages/vite/src/node/index.ts']),
      configFor: () => ({
        dependencies: new Set(dependencies),
        selfImports: [],
        aliases: [],
        baseUrl: null,
        name: null,
      }),
      workspaceNames: new Set(workspaceNames),
    };
  }

  it('never calls a package this repo defines "external"', () => {
    // The bug this closes: vite's root manifest declares `"vite":
    // "workspace:*"`, so `import 'vite'` resolved as external — asserting
    // "nothing outside the repo can import back into it" about an import that
    // reaches 332 files inside it. The file then looked fully resolved to
    // guardrail 4 while hiding a dependency.
    const context = contextWith(['vite'], ['vite']);
    expect(resolveSpecifier('playground/ssr/vite.config.js', 'vite', context)).toEqual({
      kind: 'unresolved',
    });
  });

  it('still calls a genuine third-party dependency external', () => {
    const context = contextWith(['vite'], ['magic-string']);
    expect(resolveSpecifier('packages/vite/src/a.ts', 'magic-string', context)).toEqual({
      kind: 'external',
      name: 'magic-string',
    });
  });

  it('applies to a subpath of a workspace package too', () => {
    const context = contextWith(['@vitejs/plugin-legacy'], ['@vitejs/plugin-legacy']);
    expect(
      resolveSpecifier('playground/legacy/vite.config.js', '@vitejs/plugin-legacy/client', context),
    ).toEqual({ kind: 'unresolved' });
  });

  it('does not let a workspace name shadow a node builtin', () => {
    const context = contextWith(['path'], []);
    expect(resolveSpecifier('src/a.ts', 'node:path', context)).toEqual({
      kind: 'external',
      name: 'node:path',
    });
  });
});

/**
 * **Which manifests are workspace packages** — and the answer is not "all of them".
 *
 * `webpack` has no `workspaces` field at all, and its tracked test fixtures declare generic names
 * (`pkg`, `my-lib`) whose real targets are per-fixture `node_modules/` copies the walk excludes.
 * Treating every walked `package.json` as a linked package sent `import "pkg"` from one fixture to
 * an unrelated fixture's file as a **`certain` internal edge** — a non-dependent in a `truth` set,
 * on two shipped boards. ADR-0042 §3.7.
 *
 * Two conditions, and each is asserted alone because each alone leaves a live defect.
 */
async function write(dir: string, rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, rel)), { recursive: true });
  await writeFile(join(dir, rel), text, 'utf8');
}

describe('which manifests are workspace packages', () => {
  it('refuses a nested manifest no workspace glob covers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-ws-none-'));
    try {
      await write(dir, 'package.json', JSON.stringify({ name: 'webpack' }));
      await mkdir(join(dir, 'test', 'fixture'), { recursive: true });
      await write(dir, 'test/fixture/package.json', JSON.stringify({ name: 'pkg' }));
      const index = await loadConfigIndex(dir, ['package.json', 'test/fixture/package.json']);
      // The root is a package; the fixture is a directory boundary.
      expect(index.workspacePackages.get('webpack')?.dir).toBe('');
      expect(index.workspacePackages.get('pkg')).toBeUndefined();
      // `workspaceNames` still holds it — it may never be called `external` (guardrail 4).
      expect(index.workspaceNames.has('pkg')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a nested manifest a workspaces glob covers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-ws-glob-'));
    try {
      await write(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
      await mkdir(join(dir, 'packages', 'a'), { recursive: true });
      await write(dir, 'packages/a/package.json', JSON.stringify({ name: '@scope/a' }));
      const index = await loadConfigIndex(dir, ['package.json', 'packages/a/package.json']);
      expect(index.workspacePackages.get('@scope/a')?.dir).toBe('packages/a');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads pnpm-workspace.yaml, which is not JSON and not a scanned language', async () => {
    // The first version parsed every manifest with `parseJsonc` before dispatching on its name, so
    // the YAML returned null and was skipped — and every pnpm monorepo lost its declaration.
    // Measured on rxjs: 150 Blast Radius boards became 80.
    const dir = await mkdtemp(join(tmpdir(), 'ark-ws-pnpm-'));
    try {
      await write(dir, 'package.json', JSON.stringify({ name: 'root' }));
      await write(dir, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - apps/site\n");
      await mkdir(join(dir, 'packages', 'b'), { recursive: true });
      await write(dir, 'packages/b/package.json', JSON.stringify({ name: '@scope/b' }));
      const index = await loadConfigIndex(dir, [
        'package.json',
        'packages/b/package.json',
        'pnpm-workspace.yaml',
      ]);
      expect(index.workspacePackages.get('@scope/b')?.dir).toBe('packages/b');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a name two manifests claim', async () => {
    // nest's root manifest is literally named `@nestjs/core`, the same as `packages/core`. Without
    // this the root answers for it and resolves `@nestjs/core/x` against the repository root.
    const dir = await mkdtemp(join(tmpdir(), 'ark-ws-dup-'));
    try {
      await write(dir, 'package.json', JSON.stringify({ name: '@nestjs/core', workspaces: ['packages/*'] }));
      await mkdir(join(dir, 'packages', 'core'), { recursive: true });
      await write(dir, 'packages/core/package.json', JSON.stringify({ name: '@nestjs/core' }));
      const index = await loadConfigIndex(dir, ['package.json', 'packages/core/package.json']);
      expect(index.workspacePackages.get('@nestjs/core')).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `exports` flattening, through `loadConfigIndex` rather than a hand-built map.
 *
 * A review mutated the condition priority and the duplicate-name rule and found **both mutants
 * survived all 889 unit tests**: `tests/unit/resolve.test.ts`'s workspace helper builds
 * `workspacePackages` by hand with plain string targets, so the layer where the real defects lived
 * was exercised by nothing.
 */
describe('exports flattening', () => {
  it('prefers the import condition over types, in a fixed order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-cond-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: { '.': { types: './x.d.ts', require: './x.cjs', import: './x.js' } },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      expect(index.workspacePackages.get('p')?.exports.get('.')).toBe('./x.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a wildcard subpath key literally, for the pattern matcher to expand', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-star-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: { './*': './dist/*.js' },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      expect(index.workspacePackages.get('p')?.exports.get('./*')).toBe('./dist/*.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads a conditions-only exports object as the package root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-only-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: { import: './m.js', require: './c.cjs' },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      expect(index.workspacePackages.get('p')?.exports.get('.')).toBe('./m.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The `exports` **active condition set**, pinned against the two corpus shapes that decide it.
 *
 * A review read the fixed traversal order as a divergence from Node's insertion order. Measured on
 * nine repos it is the reverse: Node takes the first key that is an *active* condition, and naive
 * insertion order — every key active — picks the wrong file on all 6 subpaths where the two reach
 * different indexed files. `scripts/probe-conditions.ts`.
 */
describe('exports conditions that must never be picked', () => {
  it('skips a platform condition in favour of default (apollo-client ./react)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-cond2-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: {
          './react': { 'react-server': './src/react/index.react-server.ts', default: './src/react/index.ts' },
        },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      expect(index.workspacePackages.get('p')?.exports.get('./react')).toBe('./src/react/index.ts');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('descends a nested condition object to its default (vue-core node.default)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-cond3-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: {
          '.': {
            types: './dist/p.d.ts',
            node: { production: './dist/p.prod.js', development: './dist/p.dev.js', default: './index.js' },
            import: './dist/p.esm.js',
          },
        },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      // `import` outranks `node`, and neither `production` nor `development` may ever be chosen.
      expect(index.workspacePackages.get('p')?.exports.get('.')).toBe('./dist/p.esm.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never prefers a declaration file over a runtime target (kysely .)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ark-exp-cond4-'));
    try {
      await write(dir, 'package.json', JSON.stringify({
        name: 'p',
        workspaces: ['.'],
        exports: { '.': { types: './outdated-typescript.d.ts', require: './dist/index.js' } },
      }));
      const index = await loadConfigIndex(dir, ['package.json']);
      expect(index.workspacePackages.get('p')?.exports.get('.')).toBe('./dist/index.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
