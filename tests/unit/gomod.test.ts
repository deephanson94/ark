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
  return { packages: new Set(packages), moduleFor: () => mod };
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
    expect(resolveGoImport('main.go', 'C', context(['.']))).toEqual({ kind: 'external', name: 'C' });
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
