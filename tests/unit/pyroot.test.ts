import { describe, expect, it } from 'vitest';

import type { PyContext } from '../../src/indexer/pyroot.js';
import {
  isRequirementsFile,
  normaliseDistribution,
  parseManifestDependencies,
  parseRequirements,
  relativeBase,
  resolvePyImport,
} from '../../src/indexer/pyroot.js';

function context(files: readonly string[], over: Partial<PyContext> = {}): PyContext {
  const subtrees = new Set<string>();
  for (const path of files) {
    const parts = path.split('/');
    parts.pop();
    for (let i = 1; i <= parts.length; i++) subtrees.add(parts.slice(0, i).join('/'));
  }
  return {
    files: new Set(files),
    subtrees,
    roots: [''],
    dependencies: new Set(),
    ...over,
  };
}

const verdicts = (
  from: string,
  reference: { level?: number; module: string | null; names?: readonly string[] },
  ctx: PyContext,
): string[] =>
  resolvePyImport(
    from,
    { level: reference.level ?? 0, module: reference.module, names: reference.names ?? [] },
    ctx,
  ).map((v) => (v.kind === 'internal' ? `${v.path} (${v.confidence})` : v.kind === 'external' ? `external:${v.name}` : 'unresolved'));

describe('Python relative imports', () => {
  const ctx = context([
    'pkg/__init__.py',
    'pkg/app.py',
    'pkg/cli.py',
    'pkg/json/__init__.py',
    'other/thing.py',
  ]);

  it('counts level 1 as the file’s own package, not its parent', () => {
    // Python resolves `.` to the package the module is *in*. Off by one and
    // every `from . import x` in a repo points at the wrong directory.
    expect(relativeBase('pkg/app.py', 1)).toBe('pkg');
    expect(relativeBase('pkg/app.py', 2)).toBe('');
    expect(relativeBase('pkg/app.py', 3)).toBeNull();
  });

  it('resolves `from . import cli` to the submodule, not only to the package', () => {
    expect(verdicts('pkg/app.py', { level: 1, module: '', names: ['cli'] }, ctx)).toEqual([
      'pkg/__init__.py (certain)',
      'pkg/cli.py (certain)',
    ]);
  });

  it('resolves a named module that is a package to its `__init__.py`', () => {
    expect(verdicts('pkg/app.py', { level: 1, module: 'json', names: ['dumps'] }, ctx)).toEqual([
      'pkg/json/__init__.py (certain)',
    ]);
  });

  it('climbs out of the repo rather than guessing', () => {
    expect(verdicts('pkg/app.py', { level: 4, module: '', names: [] }, ctx)).toEqual(['unresolved']);
  });

  it('leaves a relative import of something absent on `unresolved`', () => {
    expect(verdicts('pkg/app.py', { level: 1, module: 'missing', names: [] }, ctx)).toEqual([
      'unresolved',
    ]);
  });
});

describe('Python absolute imports', () => {
  it('finds a module under a declared root, and a `src/` layout', () => {
    const ctx = context(['src/flask/__init__.py', 'src/flask/app.py', 'docs/conf.py'], {
      roots: ['', 'src'],
    });
    expect(verdicts('docs/conf.py', { module: 'flask', names: ['Flask'] }, ctx)).toEqual([
      'src/flask/__init__.py (certain)',
    ]);
    expect(verdicts('docs/conf.py', { module: 'flask.app', names: [] }, ctx)).toEqual([
      'src/flask/app.py (certain)',
    ]);
  });

  it('names the module *and* the submodule when a `from` import reaches both', () => {
    // `from django.db import models` really does depend on two files, and
    // dropping either is a missing edge — the class no atlas-derived check can
    // see (ADR-0026 §4.1).
    const ctx = context(['django/db/__init__.py', 'django/db/models/__init__.py']);
    expect(verdicts('app.py', { module: 'django.db', names: ['models', 'connection'] }, ctx)).toEqual([
      'django/db/__init__.py (certain)',
      'django/db/models/__init__.py (certain)',
    ]);
  });

  it('reaches into a namespace package that has no `__init__.py`', () => {
    const ctx = context(['ns/inner/mod.py']);
    expect(verdicts('main.py', { module: 'ns.inner', names: ['mod'] }, ctx)).toEqual([
      'ns/inner/mod.py (certain)',
    ]);
  });

  it('calls it `probable` when two roots both answer', () => {
    // Which root `sys.path` puts first is the runtime fact ark refuses to
    // guess at, so the ambiguity is recorded rather than resolved.
    const ctx = context(['x.py', 'src/x.py'], { roots: ['', 'src'] });
    expect(verdicts('main.py', { module: 'x', names: [] }, ctx)).toEqual([
      'x.py (probable)',
      'src/x.py (probable)',
    ]);
  });

  it('prefers the package over the module of the same name, as Python’s finder does', () => {
    const ctx = context(['x/__init__.py', 'x.py']);
    expect(verdicts('main.py', { module: 'x', names: [] }, ctx)).toEqual([
      'x/__init__.py (certain)',
    ]);
  });

  it('calls the standard library external and an undeclared package unresolved', () => {
    const ctx = context(['main.py'], { dependencies: new Set(['click']) });
    expect(verdicts('main.py', { module: 'os.path', names: [] }, ctx)).toEqual(['external:os']);
    expect(verdicts('main.py', { module: 'click', names: [] }, ctx)).toEqual(['external:click']);
    // `PIL` comes from Pillow and there is no build-free mapping between the
    // two. ADR-0024 §3 — the class that stays unresolved however well the
    // manifest is parsed.
    expect(verdicts('main.py', { module: 'PIL.Image', names: [] }, ctx)).toEqual(['unresolved']);
  });

  it('knows the underscore-prefixed stdlib names, `__future__` above all', () => {
    // The first draft of `STDLIB` filtered them out as private C accelerators,
    // which dropped `__future__` with them — so `from __future__ import
    // annotations`, in **27 of flask's 83 files**, read as an unresolved import
    // of an unknown package and tainted every one of them.
    const ctx = context(['main.py']);
    expect(verdicts('main.py', { module: '__future__', names: ['annotations'] }, ctx)).toEqual([
      'external:__future__',
    ]);
    expect(verdicts('main.py', { module: '_thread', names: [] }, ctx)).toEqual(['external:_thread']);
  });

  it('never returns an empty verdict list, however little placed', () => {
    // The fourth outcome nobody declared: a namespace directory whose imported
    // names are not modules placed **nothing** — no edge, no external, no
    // `unresolved` — so `build.ts`'s loop over the verdicts recorded silence.
    // The absolute arm guarded it and the relative arm did not.
    const ctx = context(['ns/mod.py']);
    expect(verdicts('ns/mod.py', { level: 1, module: '', names: ['missing'] }, ctx)).toEqual([
      'unresolved',
    ]);
    expect(verdicts('ns/mod.py', { module: 'ns', names: ['missing'] }, ctx)).toEqual(['unresolved']);
  });

  it('leaves the computed arm unresolved rather than dropping the site', () => {
    expect(verdicts('main.py', { module: null, names: [] }, context(['main.py']))).toEqual([
      'unresolved',
    ]);
  });
});

describe('Python dependency declarations', () => {
  it('reads a PEP 621 array, an extras table and a dependency group', () => {
    // Extras and groups spell the key after the *group's* name, so a rule
    // keyed on `dependencies =` sees neither — which is what made this file
    // report 86 unresolved sites on flask where 62 is the truth.
    const source = [
      '[project]',
      'dependencies = ["Werkzeug>=3.1", "click>=8.1.3"]',
      '',
      '[project.optional-dependencies]',
      'async = ["asgiref>=3.2"]',
      '',
      '[dependency-groups]',
      'dev = ["ruff", "tox"]',
      'docs = ["pallets-sphinx-themes"]',
      '',
      '[tool.something-else]',
      'ignored = ["nope"]',
      '',
    ].join('\n');
    expect(parseManifestDependencies(source).sort()).toEqual([
      'asgiref',
      'click',
      'pallets_sphinx_themes',
      'ruff',
      'tox',
      'werkzeug',
    ]);
  });

  it('reads a poetry table and a setup.py call', () => {
    expect(parseManifestDependencies('[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "*"\n')).toEqual([
      'requests',
    ]);
    expect(parseManifestDependencies("setup(install_requires=['django>=4', 'pytz'])")).toEqual([
      'django',
      'pytz',
    ]);
  });

  it('reads a requirements file and skips its flags and comments', () => {
    expect(parseRequirements('# a comment\n-r other.txt\nselenium==4.1  # pinned\n\npytest\n')).toEqual([
      'selenium',
      'pytest',
    ]);
  });

  it('names no distribution for a VCS or URL requirement', () => {
    // `git+https://…` parses as a dependency called **git** under the name
    // rule, which would call `import git` — GitPython — external and *remove a
    // taint*. An undercount costs an `unresolved`; an over-count invents an
    // external, which is the direction this whole file refuses.
    expect(parseRequirements('git+https://github.com/x/y#egg=y\nhttps://example.com/z.whl\nclick\n')).toEqual([
      'click',
    ]);
    expect(parseManifestDependencies('dependencies = ["click", "y @ git+https://a/b"]')).toEqual([
      'click',
    ]);
  });

  it('recognises both requirements conventions, including a directory of them', () => {
    // django keeps `tests/requirements/postgres.txt` and flask
    // `requirements/dev.txt`; a rule matching only the basename sees neither.
    expect(isRequirementsFile('requirements.txt')).toBe(true);
    expect(isRequirementsFile('requirements-dev.txt')).toBe(true);
    expect(isRequirementsFile('requirements/dev.txt')).toBe(true);
    expect(isRequirementsFile('tests/requirements/postgres.txt')).toBe(true);
    expect(isRequirementsFile('requirements/dev.in')).toBe(true);
    expect(isRequirementsFile('docs/index.txt')).toBe(false);
    expect(isRequirementsFile('requirements/setup.cfg')).toBe(false);
  });

  it('treats a distribution name and its module spelling as one name', () => {
    expect(normaliseDistribution('Flask-SQLAlchemy')).toBe('flask_sqlalchemy');
    expect(normaliseDistribution('ruamel.yaml')).toBe('ruamel_yaml');
  });
});
