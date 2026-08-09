import { describe, expect, it } from 'vitest';

import type { GoModule } from '../../src/indexer/gomod.js';
import { goPackageDir, isGoMod, parseGoMod, resolveGoImport } from '../../src/indexer/gomod.js';

const MOD = [
  'module github.com/spf13/cobra',
  '',
  'go 1.15',
  '',
  'require (',
  '\tgithub.com/cpuguy83/go-md2man/v2 v2.0.6 // indirect',
  '\tgithub.com/spf13/pflag v1.0.9',
  ')',
  '',
  'require gocloud.dev v0.37.0',
  '',
  'replace github.com/spf13/pflag => ./third_party/pflag',
  'replace example.com/elsewhere => /absolute/path',
].join('\n');

const module = parseGoMod('', MOD) as GoModule;

function context(packages: readonly string[], mod: GoModule | null = module) {
  return { packages: new Set(packages), moduleFor: () => mod, modules: mod === null ? [] : [mod] };
}

describe('parseGoMod', () => {
  it('reads the module path', () => {
    expect(module.path).toBe('github.com/spf13/cobra');
  });

  it('reads requires from a block and from a bare line alike', () => {
    // `gocloud.dev` is the specific miss ADR-0024 §3 recorded: its probe's
    // regex read only the block form, so hugo's eleven "unresolved" imports
    // were a probe limitation reported as a language one.
    expect([...module.requires].sort()).toEqual([
      'github.com/cpuguy83/go-md2man/v2',
      'github.com/spf13/pflag',
      'gocloud.dev',
    ]);
  });

  it('keeps only a replacement that points inside the repo', () => {
    expect([...module.replacements]).toEqual([['github.com/spf13/pflag', 'third_party/pflag']]);
  });

  it('returns null for a file with no module line', () => {
    expect(parseGoMod('', 'go 1.22\n')).toBeNull();
  });

  it('resolves a nested module’s paths against its own directory', () => {
    const nested = parseGoMod('tools', 'module example.com/tools\n') as GoModule;
    expect(resolveGoImport('tools/a/x.go', 'example.com/tools/a', context(['tools/a'], nested))).toEqual({
      kind: 'internal',
      dir: 'tools/a',
    });
  });
});

describe('resolveGoImport tells external from unknown', () => {
  it('resolves the module path itself to the repo root package', () => {
    // `spf13/cobra`'s `doc/` package imports the module path, and the root
    // package's node key is `.` rather than the empty string. Returning `''`
    // here made the repo's only internal edge vanish and tainted the file that
    // should have carried it.
    expect(resolveGoImport('doc/man.go', 'github.com/spf13/cobra', context(['.', 'doc']))).toEqual({
      kind: 'internal',
      dir: '.',
    });
  });

  it('resolves a package inside the module to its directory', () => {
    expect(
      resolveGoImport('main.go', 'github.com/spf13/cobra/doc', context(['.', 'doc'])),
    ).toEqual({ kind: 'internal', dir: 'doc' });
  });

  it('calls a path inside the module that holds no indexed Go file unresolved', () => {
    // Not external — it is ours and we cannot see it, which is exactly the
    // distinction ADR-0003 exists to keep.
    expect(resolveGoImport('main.go', 'github.com/spf13/cobra/gen', context(['.']))).toEqual({
      kind: 'unresolved',
    });
  });

  it('calls a domain-less first element the standard library', () => {
    expect(resolveGoImport('main.go', 'net/http', context(['.']))).toEqual({
      kind: 'external',
      name: 'net/http',
    });
  });

  it('calls a required module external, naming the module rather than the package', () => {
    expect(resolveGoImport('main.go', 'gocloud.dev/blob', context(['.']))).toEqual({
      kind: 'external',
      name: 'gocloud.dev',
    });
  });

  it('resolves into a sibling module of this repo even when the nearest go.mod requires it', () => {
    // **This was a wrong answer key**, measured on 2 of prometheus's 34 Go
    // Blast Radius boards. `documentation/examples/remote_storage/go.mod`
    // requires `github.com/prometheus/prometheus v0.308.1` with no `replace`,
    // so matching the *nearest* module only fell through to that require list
    // and called the import **external** — no edge — and the package whose
    // source reads `import ".../prompb/io/prometheus/write/v2"` was then
    // certified a non-dependent of that very package and offered as a wrong
    // answer. Whose repo a path is in is a different question from which
    // go.mod carries the requires.
    const root = parseGoMod('', 'module github.com/prometheus/prometheus\n') as GoModule;
    const nested = parseGoMod(
      'documentation/examples/remote_storage',
      'module github.com/prometheus/prometheus/documentation/examples/remote_storage\n' +
        'require github.com/prometheus/prometheus v0.308.1\n',
    ) as GoModule;
    const ctx = {
      packages: new Set(['prompb/io/prometheus/write/v2', 'documentation/examples/remote_storage/example_write_adapter']),
      moduleFor: () => nested,
      // Longest path first, as `loadGoModules` sorts them.
      modules: [nested, root],
    };
    expect(
      resolveGoImport(
        'documentation/examples/remote_storage/example_write_adapter/server.go',
        'github.com/prometheus/prometheus/prompb/io/prometheus/write/v2',
        ctx,
      ),
    ).toEqual({ kind: 'internal', dir: 'prompb/io/prometheus/write/v2' });
  });

  it('lets a nested module win a shared prefix over its parent', () => {
    const root = parseGoMod('', 'module example.com/app\n') as GoModule;
    const nested = parseGoMod('tools', 'module example.com/app/tools\n') as GoModule;
    const ctx = { packages: new Set(['tools/gen']), moduleFor: () => root, modules: [nested, root] };
    // Under the root module alone this would be the directory `tools/gen`
    // *relative to the root*, which is the same string here — so the test that
    // matters is that the nested module is consulted first and produces it.
    expect(resolveGoImport('main.go', 'example.com/app/tools/gen', ctx)).toEqual({
      kind: 'internal',
      dir: 'tools/gen',
    });
  });

  it('calls an undeclared module unresolved rather than guessing it is external', () => {
    expect(resolveGoImport('main.go', 'github.com/nobody/nothing', context(['.']))).toEqual({
      kind: 'unresolved',
    });
  });

  it('follows a replacement that points into the repo', () => {
    expect(
      resolveGoImport('main.go', 'github.com/spf13/pflag', context(['.', 'third_party/pflag'])),
    ).toEqual({ kind: 'internal', dir: 'third_party/pflag' });
  });

  it('treats cgo’s pseudo-package as external', () => {
    // Through the *stdlib* rule, not a special case: `C` has no dot in its
    // first path element, so Go's own rule already answers this. The special
    // case that used to sit at the top of the function returned the identical
    // value and fired zero times on three repos — a branch that can never
    // change an outcome is worse than no branch (CLAUDE.md).
    expect(resolveGoImport('main.go', 'C', context(['.']))).toEqual({ kind: 'external', name: 'C' });
  });

  it('refuses an absolute path rather than reading it as the standard library', () => {
    // `/opt/x`'s first path element is empty, so it has no dot in it — which is
    // exactly `isStandardLibrary`'s test. Without the guard above it this comes
    // back **external**, which is an invented answer.
    expect(resolveGoImport('main.go', '/opt/x', context(['.']))).toEqual({ kind: 'unresolved' });
  });

  it('refuses a relative import rather than anchoring it to a guess', () => {
    expect(resolveGoImport('a/x.go', './b', context(['a', 'a/b']))).toEqual({ kind: 'unresolved' });
  });

  it('still knows the standard library with no go.mod in scope', () => {
    expect(resolveGoImport('main.go', 'fmt', context(['.'], null))).toEqual({
      kind: 'external',
      name: 'fmt',
    });
    expect(resolveGoImport('main.go', 'github.com/x/y', context(['.'], null))).toEqual({
      kind: 'unresolved',
    });
  });
});

describe('a Go file’s package is its directory', () => {
  it('names the repo root `.`, which is a path the validator accepts', () => {
    expect(goPackageDir('main.go')).toBe('.');
    expect(goPackageDir('common/hugio/writers.go')).toBe('common/hugio');
  });

  it('puts an external test package in the same node as the package it tests', () => {
    // `foo` and `foo_test` compile together and move together in git.
    // Separating them would re-create at file level the distinction package
    // granularity exists to erase.
    expect(goPackageDir('hugolib/site_test.go')).toBe(goPackageDir('hugolib/site.go'));
  });

  it('recognises a nested go.mod', () => {
    expect(isGoMod('go.mod')).toBe(true);
    expect(isGoMod('tools/go.mod')).toBe(true);
    expect(isGoMod('gomod')).toBe(false);
    expect(isGoMod('docs/notgo.mod')).toBe(false);
  });
});
