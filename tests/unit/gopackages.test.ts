import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import { sourceCoverage } from '../../src/atlas/index.js';
import { buildAtlas, claimOrigins, indexOptions } from '../../src/indexer/build.js';

async function tree(files: Record<string, string>): Promise<Atlas> {
  const root = await mkdtemp(join(tmpdir(), 'ark-go-'));
  for (const [path, body] of Object.entries(files)) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) await mkdir(join(root, path.slice(0, slash)), { recursive: true });
    await writeFile(join(root, path), body, 'utf8');
  }
  return buildAtlas(indexOptions(root));
}

const MODULE = 'module example.com/app\n\ngo 1.22\n';

const at = (atlas: Atlas, path: string) => atlas.nodes.find((node) => node.path === path);
const edgesOf = (atlas: Atlas) =>
  atlas.edges.map((edge) => `${atlas.nodes[edge.from]?.path} -> ${atlas.nodes[edge.to]?.path}`);

describe('a Go package is one node', () => {
  it('collapses a directory’s files into a directory node and sums their size', async () => {
    const atlas = await tree({
      'go.mod': MODULE,
      'store/store.go': 'package store\n\nfunc New() {}\n',
      'store/keys.go': 'package store\n\nfunc Key() {}\nfunc unexported() {}\n',
      'store/keys_test.go': 'package store\n\nimport "testing"\n\nfunc TestKey(t *testing.T) {}\n',
    });
    const store = at(atlas, 'store');
    expect(store?.kind).toBe('dir');
    expect(store?.lang).toBe('go');
    expect(store?.fileCount).toBe(3);
    // Summed, not sampled: the three files are 3, 4 and 5 physical lines.
    expect(store?.loc).toBe(12);
    // Exported package-level names, unioned across the package's files.
    expect(store?.exports).toEqual(['Key', 'New', 'TestKey']);
    expect(atlas.nodes.filter((node) => node.lang === 'go').map((node) => node.path)).toEqual([
      'store',
    ]);
  });

  it('draws an edge between packages and never inside one', async () => {
    const atlas = await tree({
      'go.mod': MODULE,
      'main.go': 'package main\n\nimport "example.com/app/store"\n\nfunc main() { store.New() }\n',
      'store/store.go': 'package store\n\nfunc New() {}\n',
      // An external test package lives in the same directory and imports the
      // package under test. At file granularity that is a real edge; here it is
      // a self-edge, which the atlas has never carried.
      'store/store_test.go': 'package store_test\n\nimport "example.com/app/store"\n',
    });
    expect(edgesOf(atlas)).toEqual(['. -> store']);
    expect(at(atlas, '.')?.fileCount).toBe(1);
    expect(at(atlas, 'store')?.fileCount).toBe(2);
  });

  it('makes the same-package wrong answer unrepresentable rather than gated', async () => {
    // ADR-0024 §6.1's defect: `a.go` and `b.go` in one package see each other's
    // identifiers with **no import statement**, so a file-granular atlas has no
    // edge between them and `treeSibling` offers one as a wrong answer to the
    // other. There is no pair of nodes here for that to happen between.
    const atlas = await tree({
      'go.mod': MODULE,
      'pkg/a.go': 'package pkg\n\nfunc A() { b() }\n',
      'pkg/b.go': 'package pkg\n\nfunc b() {}\n',
    });
    const inPkg = atlas.nodes.filter((node) => node.path === 'pkg' || node.path.startsWith('pkg/'));
    expect(inPkg.map((node) => node.path)).toEqual(['pkg']);
  });

  it('leaves a non-Go file in the same directory as its own node', async () => {
    const atlas = await tree({
      'go.mod': MODULE,
      'web/server.go': 'package web\n',
      'web/client.ts': 'export const client = 1;\n',
      'web/README.md': '# web\n',
    });
    expect(at(atlas, 'web')?.kind).toBe('dir');
    expect(at(atlas, 'web/client.ts')?.kind).toBe('file');
    expect(at(atlas, 'web/client.ts')?.fileCount).toBe(1);
    expect(at(atlas, 'web/README.md')?.kind).toBe('file');
  });

  it('records an undeclared module as unresolved, not as an external', async () => {
    const atlas = await tree({
      'go.mod': MODULE,
      'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"github.com/nobody/nothing"\n)\n',
    });
    expect(at(atlas, '.')?.externals).toEqual(['fmt']);
    expect(at(atlas, '.')?.unresolved).toEqual(['github.com/nobody/nothing']);
  });
});

describe('source coverage counts files on both sides of its ratio', () => {
  it('weighs a package by its files, not by being one node', async () => {
    // Counting nodes here would read 1 mapped against 6 unreadable — a sliver,
    // and a refused deck — for a repo that is five sixths readable Go.
    const atlas = await tree({
      'go.mod': MODULE,
      'pkg/a.go': 'package pkg\n',
      'pkg/b.go': 'package pkg\n',
      'pkg/c.go': 'package pkg\n',
      'pkg/d.go': 'package pkg\n',
      'pkg/e.go': 'package pkg\n',
      'scripts/one.sh': 'echo 1\n',
      'scripts/two.sh': 'echo 2\n',
      'scripts/three.sh': 'echo 3\n',
      'scripts/four.sh': 'echo 4\n',
      'scripts/five.sh': 'echo 5\n',
      'scripts/six.sh': 'echo 6\n',
    });
    const coverage = sourceCoverage(atlas);
    expect(atlas.nodes.filter((node) => node.lang === 'go')).toHaveLength(1);
    expect(coverage.mapped).toBe(5);
    expect(coverage.unreadable).toBe(6);
    expect(coverage.bodyOfSource).toBe(true);
    expect(coverage.sliver).toBe(false);
    expect(coverage.deckRefused).toBe(false);
  });
});

describe('a node standing for many files still has one lineage', () => {
  // git records renames of **files**, never of directories, so a package that
  // moved has to read its own origin off its members'. These are the three
  // cases that produces (ADR-0026).
  const grouped = new Set(['pkg/a', 'pkg/b']);

  it('follows a package that moved wholesale', () => {
    const origins = claimOrigins(
      ['pkg/a'],
      new Map([['pkg/a', ['pkg/a/one.go', 'pkg/a/two.go']]]),
      new Set(['pkg/a']),
      new Map([
        ['pkg/a/one.go', 'old/a/one.go'],
        ['pkg/a/two.go', 'old/a/two.go'],
      ]),
    );
    expect(origins.get('pkg/a')).toBe('old/a');
  });

  it('takes the plurality when a moved package has since gained a file', () => {
    const origins = claimOrigins(
      ['pkg/a'],
      new Map([['pkg/a', ['pkg/a/one.go', 'pkg/a/two.go', 'pkg/a/three.go']]]),
      new Set(['pkg/a']),
      new Map([
        ['pkg/a/one.go', 'old/a/one.go'],
        ['pkg/a/two.go', 'old/a/two.go'],
        // Added after the move, so git knows it only at its current path.
        ['pkg/a/three.go', 'pkg/a/three.go'],
      ]),
    );
    expect(origins.get('pkg/a')).toBe('old/a');
  });

  it('does not let a package split take the other half’s identity', () => {
    // `pkg/b` was carved out of `pkg/a`, so every one of its files traces back
    // to `pkg/a` — which is a live node. The previous rule threw on this, which
    // is an exception on an ordinary refactor.
    const origins = claimOrigins(
      ['pkg/a', 'pkg/b'],
      new Map([
        ['pkg/a', ['pkg/a/one.go']],
        ['pkg/b', ['pkg/b/two.go']],
      ]),
      grouped,
      new Map([
        ['pkg/a/one.go', 'pkg/a/one.go'],
        ['pkg/b/two.go', 'pkg/a/two.go'],
      ]),
    );
    expect(origins.get('pkg/a')).toBe('pkg/a');
    expect(origins.get('pkg/b')).toBe('pkg/b');
  });

  it('gives one origin to one node when two both trace to a dead directory', () => {
    const origins = claimOrigins(
      ['pkg/a', 'pkg/b'],
      new Map([
        ['pkg/a', ['pkg/a/one.go']],
        ['pkg/b', ['pkg/b/two.go']],
      ]),
      grouped,
      new Map([
        ['pkg/a/one.go', 'gone/one.go'],
        ['pkg/b/two.go', 'gone/two.go'],
      ]),
    );
    // First claimant in a fixed order keeps it; the loser keeps its own path.
    expect([origins.get('pkg/a'), origins.get('pkg/b')]).toEqual(['gone', 'pkg/b']);
  });

  it('leaves a file node’s origin exactly as git reported it', () => {
    const origins = claimOrigins(
      ['src/new.ts'],
      new Map([['src/new.ts', ['src/new.ts']]]),
      new Set(),
      new Map([['src/new.ts', 'src/old.ts']]),
    );
    expect(origins.get('src/new.ts')).toBe('src/old.ts');
  });
});
