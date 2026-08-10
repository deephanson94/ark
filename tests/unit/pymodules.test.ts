/**
 * Python end to end: real walk, real scan, real resolution, real validator,
 * over a temporary repo on disk.
 *
 * The sibling of `gopackages.test.ts`, and here for the same reason — it is in
 * `tests/unit/` only because it runs in milliseconds. `tests/atlas/` indexes
 * *this* repo and this repo has no Python in it, so nothing there can see any
 * of this.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import { canGradeImports, canImport, sourceCoverage } from '../../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../../src/indexer/build.js';
import { SCANNED, UNREAD } from '../../src/indexer/walk.js';

async function tree(files: Record<string, string>): Promise<Atlas> {
  const root = await mkdtemp(join(tmpdir(), 'ark-py-'));
  for (const [path, body] of Object.entries(files)) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) await mkdir(join(root, path.slice(0, slash)), { recursive: true });
    await writeFile(join(root, path), body, 'utf8');
  }
  return buildAtlas(indexOptions(root));
}

const at = (atlas: Atlas, path: string) => atlas.nodes.find((node) => node.path === path);
const edgesOf = (atlas: Atlas) =>
  atlas.edges.map((edge) => `${atlas.nodes[edge.from]?.path} -> ${atlas.nodes[edge.to]?.path}`).sort();

const MANIFEST = '[project]\nname = "app"\ndependencies = ["click"]\n';

describe('a Python node is a file', () => {
  it('keeps one node per module and never groups a package', async () => {
    // ADR-0026 decided a *Go* node is a directory because a Go file references
    // its package's siblings with no import. Python's unit of import is the
    // module, which is a file, so nothing here is grouped — `pkg/__init__.py`
    // is a node beside `pkg/app.py`, not a `pkg` node containing it.
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'pkg/__init__.py': 'from . import app\n',
      'pkg/app.py': 'CONSTANT = 1\n',
    });
    // Sorted here, because `nodes` is ordered by **node id** — a hash of the
    // origin path — and asserting on the array as it comes would be checking
    // that ordering rather than the grouping this test is about.
    expect(
      atlas.nodes
        .filter((n) => n.lang === 'py')
        .map((n) => n.path)
        .sort(),
    ).toEqual(['pkg/__init__.py', 'pkg/app.py']);
    expect(atlas.nodes.every((n) => n.kind === 'file' && n.fileCount === 1)).toBe(true);
  });

  it('draws the edges a relative and an absolute import name', async () => {
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'pkg/__init__.py': 'from .app import App\nfrom . import cli\n',
      'pkg/app.py': 'import os\nfrom pkg.helpers import helper\n\nclass App: pass\n',
      'pkg/cli.py': 'import click\n',
      'pkg/helpers.py': 'def helper(): pass\n',
    });
    expect(edgesOf(atlas)).toEqual([
      'pkg/__init__.py -> pkg/app.py',
      'pkg/__init__.py -> pkg/cli.py',
      'pkg/app.py -> pkg/helpers.py',
    ]);
    // `os` is stdlib and `click` is declared, so both are external and neither
    // taints anything.
    expect(at(atlas, 'pkg/app.py')?.unresolved).toEqual([]);
    expect(at(atlas, 'pkg/cli.py')?.externals).toEqual(['click']);
  });

  it('names the package and the submodule when a `from` import reaches both', async () => {
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'app.py': 'from db import models\n',
      'db/__init__.py': 'X = 1\n',
      'db/models/__init__.py': 'Y = 2\n',
    });
    expect(edgesOf(atlas)).toEqual(['app.py -> db/__init__.py', 'app.py -> db/models/__init__.py']);
  });

  it('records a computed import rather than dropping it', async () => {
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'conf.py': 'import importlib\n\ndef load(name):\n    return importlib.import_module(name)\n',
    });
    expect(at(atlas, 'conf.py')?.unresolved).toHaveLength(1);
    expect(at(atlas, 'conf.py')?.unresolved[0]).toContain('import_module');
  });

  it('leaves an undeclared package unresolved rather than calling it external', async () => {
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'app.py': 'import PIL.Image\n',
    });
    expect(at(atlas, 'app.py')?.unresolved).toEqual(['import PIL.Image']);
    expect(at(atlas, 'app.py')?.externals).toEqual([]);
  });
});

describe('Python is mapped source and never grades a board', () => {
  it('ships no Blast Radius board however clean the imports are', async () => {
    // The point of `canGradeImports`. This fixture resolves **perfectly** — no
    // unresolved import anywhere — so guardrail 4 would have shipped a board.
    // ADR-0024 decision 2 says no Python repo ever does, and the rule is the
    // language rather than the taint precisely so that *whether the deck
    // exists* does not depend on how dynamic one repo happens to be.
    //
    // **The TypeScript half is the gate, and the first draft did not have it.**
    // Asserting only that the Python deck is empty passes whether or not the
    // rule exists: a five-file fixture has too few candidates to build a choice
    // set, so it ships no board in either language. Deleting the rule reddened
    // exactly one assertion — the predicate one below — and this one sat there
    // reading as evidence. The two trees have the **same shape** and differ only
    // in the language, which is what makes the pair a counterfactual rather than
    // two measurements.
    const shape = (extension: 'py' | 'ts'): Record<string, string> => {
      const files: Record<string, string> = {};
      const importOf = (name: string): string =>
        extension === 'py' ? `from pkg import ${name}\n` : `import './${name}.js';\n`;
      files[extension === 'py' ? 'pyproject.toml' : 'package.json'] =
        extension === 'py' ? MANIFEST : '{"name":"app"}\n';
      files[`pkg/core.${extension}`] = 'CORE = 1\n';
      for (let i = 0; i < 9; i++) files[`pkg/leaf${i}.${extension}`] = `${importOf('core')}LEAF = ${i}\n`;
      for (let i = 0; i < 9; i++) files[`pkg/lone${i}.${extension}`] = `LONE = ${i}\n`;
      return files;
    };

    const typescript = await tree(shape('ts'));
    const python = await tree(shape('py'));
    for (const atlas of [typescript, python]) {
      expect(atlas.nodes.every((n) => n.unresolved.length === 0)).toBe(true);
      expect(atlas.edges.length).toBeGreaterThan(0);
    }
    expect(typescript.challenges.filter((c) => c.verb === 'blastRadius').length).toBeGreaterThan(0);
    expect(python.challenges.filter((c) => c.verb === 'blastRadius')).toEqual([]);
  });

  it('counts Python as mapped source, so a Python repo keeps its deck', async () => {
    // The trap the split predicate exists for. Under one predicate `mapped`
    // reads 0 on a pure-Python repo, ADR-0025 clause 2 refuses the deck, and
    // the HUD says *"None of this repository's N source files are on this
    // map"* over a **full** map — a false claim about the reader's own repo,
    // which is the cost ADR-0025 decision 5 exists never to pay.
    const atlas = await tree({
      'pyproject.toml': MANIFEST,
      'pkg/__init__.py': 'from . import app\n',
      'pkg/app.py': 'X = 1\n',
      'run.sh': 'echo hi\n',
      'lib.rs': 'fn main() {}\n',
      'a.rs': 'fn a() {}\n',
      'b.rs': 'fn b() {}\n',
      'c.rs': 'fn c() {}\n',
    });
    const coverage = sourceCoverage(atlas);
    expect(coverage.mapped).toBe(2);
    // Five unreadable files clear `UNREADABLE_FLOOR`, so clause 1 holds and
    // only clause 2 is left to decide it — which is the case this fixture is
    // built to reach.
    expect(coverage.bodyOfSource).toBe(true);
    expect(coverage.sliver).toBe(false);
    expect(coverage.deckRefused).toBe(false);
  });

  it('keeps the two predicates in the relation the design rests on', () => {
    // `canGradeImports` is a **strict** subset of `canImport`. Equal, and the
    // Blast Radius deck comes back; disjoint, and a Python repo's deck goes.
    for (const lang of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go'] as const) {
      expect(canImport(lang) && canGradeImports(lang)).toBe(true);
    }
    expect(canImport('py')).toBe(true);
    expect(canGradeImports('py')).toBe(false);
    for (const lang of ['json', 'md', 'other'] as const) {
      expect(canImport(lang) || canGradeImports(lang)).toBe(false);
    }
  });

  it('has moved every Python extension out of the unreadable tally', () => {
    // ADR-0025 decision 6: adding a language to `SCANNED` deletes its row from
    // `UNREAD` in the same commit. `coverage.test.ts` asserts the general
    // disjointness; this names the three rows this change was about, because a
    // general assertion passes whether or not the rows exist at all.
    for (const extension of ['.py', '.pyi', '.pyw']) {
      expect(SCANNED.get(extension)).toBe('py');
      expect(UNREAD.has(extension)).toBe(false);
    }
  });
});
