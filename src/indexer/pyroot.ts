/**
 * Python module resolution: an import site in, a verdict per target out.
 *
 * The same three verdicts as `resolve.ts` and `gomod.ts`, for the same reason —
 * confusing *"it is outside this repo"* with *"I could not work this out"*
 * produces an import graph that looks complete and is not (ADR-0003).
 *
 * Python is harder than Go at every step, and each difficulty is a decision
 * rather than a shrug:
 *
 *  - **An import names a module, not a location.** `import a.b` is resolved
 *    against `sys.path`, which is a *runtime* fact. Ark cannot run anything
 *    (pillar 6), so the roots below are read off the repo's own layout: the
 *    repo root, every directory holding a Python manifest, and a `src/` beside
 *    one. django's test suite inserts `tests/` on the path from `runtests.py`,
 *    which no manifest declares — those imports are honestly `unresolved`, and
 *    ADR-0024 §3 measured them at 45 sites.
 *  - **The standard library is a list, not a rule.** Go reserves domain-less
 *    first segments; Python reserves nothing, so `STDLIB` below is a table with
 *    a table's failure mode. It is the safe direction: a name missing from it
 *    becomes `unresolved`, which costs a taint, never an invented edge.
 *  - **A distribution name is not a module name.** `PIL` comes from Pillow and
 *    `yaml` from PyYAML, and there is **no build-free mapping** between them
 *    (ADR-0024 §3). Those stay `unresolved` however well the manifest is parsed.
 *  - **`from X import y` may name a submodule.** `from . import cli` is how a
 *    package re-exports, and resolving it to the package's `__init__.py` alone
 *    would miss the file the statement is actually about. So a `from` import
 *    resolves its module *and* every name that turns out to be a module.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Confidence } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';

/**
 * Top-level standard-library module names, as of Python 3.11, plus the modules
 * removed in 3.12/3.13 (`imp`, `telnetlib`, `cgi`, …) so that a repo written
 * against an older Python is not tainted for importing them.
 *
 * **The underscore-prefixed names are in it**, which is not tidiness: the first
 * draft filtered them out as private C accelerators and thereby dropped
 * `__future__`, so every `from __future__ import annotations` — **27 of
 * `pallets/flask`'s 83 files** — was reported as an unresolved import of an
 * unknown package.
 *
 * **This is a list and anything not on it is `unresolved`** — the failure mode
 * ADR-0025 §9.1 names, pointed in the safe direction. Go needs no such table
 * because its own rule (a domain-less first path element is stdlib) is exact.
 */
export const STDLIB: ReadonlySet<string> = new Set([
  '__future__', '__main__', '_abc', '_aix_support', '_ast', '_asyncio', '_bisect', '_blake2',
  '_bootsubprocess', '_bz2', '_codecs', '_codecs_cn', '_codecs_hk', '_codecs_iso2022',
  '_codecs_jp', '_codecs_kr', '_codecs_tw', '_collections', '_collections_abc', '_compat_pickle',
  '_compression', '_contextvars', '_crypt', '_csv', '_ctypes', '_curses', '_curses_panel',
  '_datetime', '_dbm', '_decimal', '_elementtree', '_frozen_importlib',
  '_frozen_importlib_external', '_functools', '_gdbm', '_hashlib', '_heapq', '_imp', '_io',
  '_json', '_locale', '_lsprof', '_lzma', '_markupbase', '_md5', '_msi', '_multibytecodec',
  '_multiprocessing', '_opcode', '_operator', '_osx_support', '_overlapped', '_pickle',
  '_posixshmem', '_posixsubprocess', '_py_abc', '_pydecimal', '_pyio', '_queue', '_random',
  '_scproxy', '_sha1', '_sha256', '_sha3', '_sha512', '_signal', '_sitebuiltins', '_socket',
  '_sqlite3', '_sre', '_ssl', '_stat', '_statistics', '_string', '_strptime', '_struct',
  '_symtable', '_thread', '_threading_local', '_tkinter', '_tokenize', '_tracemalloc', '_typing',
  '_uuid', '_warnings', '_weakref', '_weakrefset', '_winapi', '_zoneinfo', 'abc', 'aifc',
  'antigravity', 'argparse', 'array', 'ast', 'asynchat', 'asyncio', 'asyncore', 'atexit',
  'audioop', 'base64', 'bdb', 'binascii', 'bisect', 'builtins', 'bz2', 'cProfile', 'calendar',
  'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs', 'codeop', 'collections', 'colorsys',
  'compileall', 'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg',
  'crypt', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib',
  'dis', 'distutils', 'doctest', 'email', 'encodings', 'ensurepip', 'enum', 'errno',
  'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools',
  'gc', 'genericpath', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip',
  'hashlib', 'heapq', 'hmac', 'html', 'http', 'idlelib', 'imaplib', 'imghdr', 'imp', 'importlib',
  'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'lib2to3', 'linecache', 'locale',
  'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap',
  'modulefinder', 'msilib', 'msvcrt', 'multiprocessing', 'netrc', 'nis', 'nntplib', 'nt',
  'ntpath', 'nturl2path', 'numbers', 'opcode', 'operator', 'optparse', 'os', 'ossaudiodev',
  'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib',
  'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'pydoc_data', 'pyexpat', 'queue', 'quopri', 'random', 're', 'readline',
  'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr', 'socket',
  'socketserver', 'spwd', 'sqlite3', 'sre_compile', 'sre_constants', 'sre_parse', 'ssl', 'stat',
  'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sunau', 'symtable', 'sys',
  'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'textwrap',
  'this', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'tomllib', 'trace',
  'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types', 'typing', 'unicodedata',
  'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser',
  'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport',
  'zlib', 'zoneinfo'
]);

/** Files ark indexes as Python, in the priority Python's own finder uses. */
const MODULE_SUFFIXES: readonly string[] = ['.py', '.pyw', '.pyi'];

/**
 * Manifests that make their directory an import root.
 *
 * A `src/` beside one is the other common layout — `pallets/flask` keeps its
 * package at `src/flask/` — and is added only when the walk actually saw
 * Python under it, so a `src/` of C extensions does not invent a root.
 */
export const PY_MANIFESTS: readonly string[] = ['pyproject.toml', 'setup.py', 'setup.cfg'];

export function isPyManifest(path: string): boolean {
  const slash = path.lastIndexOf('/');
  return PY_MANIFESTS.includes(slash === -1 ? path : path.slice(slash + 1));
}

export type PyResolution =
  | { readonly kind: 'internal'; readonly path: string; readonly confidence: Confidence }
  | { readonly kind: 'external'; readonly name: string }
  | { readonly kind: 'unresolved' };

export interface PyContext {
  /** Indexed Python files, by repo-relative path. */
  readonly files: ReadonlySet<string>;
  /** Every ancestor directory of an indexed Python file. Namespace packages live here. */
  readonly subtrees: ReadonlySet<string>;
  /** Import roots, sorted. `''` is the repo root. */
  readonly roots: readonly string[];
  /** Normalised distribution names the repo declares. */
  readonly dependencies: ReadonlySet<string>;
}

/** `Flask-SQLAlchemy` and `flask_sqlalchemy` are the same name asked twice. */
export function normaliseDistribution(name: string): string {
  return name.toLowerCase().replace(/[-.]/g, '_');
}

function joinUnder(base: string, parts: readonly string[]): string | null {
  const segments = base === '' ? [] : base.split('/');
  for (const part of parts) {
    if (part === '') return null;
    segments.push(part);
  }
  return segments.join('/');
}

/** What sits at `dir/parts`: a file we indexed, a namespace package, or nothing. */
function at(context: PyContext, base: string): { readonly path: string } | 'namespace' | null {
  // A package beats a module of the same name, which is Python's own finder
  // order — directories are searched before files — so this priority is a rule
  // rather than a guess, and there is no `probable` arm *within* a root.
  for (const suffix of MODULE_SUFFIXES) {
    const path = `${base}/__init__${suffix}`;
    if (context.files.has(path)) return { path };
  }
  for (const suffix of MODULE_SUFFIXES) {
    const path = `${base}${suffix}`;
    if (context.files.has(path)) return { path };
  }
  return context.subtrees.has(base) ? 'namespace' : null;
}

/** The directory holding a file. `''` at the repo root. */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function parentOf(dir: string): string | null {
  if (dir === '') return null;
  const slash = dir.lastIndexOf('/');
  return slash === -1 ? '' : dir.slice(0, slash);
}

/**
 * Where a relative import points, or `null` when it climbs out of the repo.
 *
 * `from . import x` inside `pkg/mod.py` names `pkg`; one extra dot is one
 * directory up. Python counts the *package* the file is in, so level 1 is the
 * file's own directory rather than its parent.
 */
export function relativeBase(fromPath: string, level: number): string | null {
  let dir: string | null = directoryOf(fromPath);
  for (let step = 1; step < level; step++) {
    if (dir === null) return null;
    dir = parentOf(dir);
  }
  return dir;
}

/**
 * Resolve one import site to the files it depends on.
 *
 * Returns **a list**, not a verdict, because one statement can name two real
 * files: `from django.db import models` depends on `django/db/__init__.py` and
 * on `django/db/models/__init__.py`, and dropping either would be a missing
 * edge. Every element is one of the three verdicts, so a site that resolves
 * partly still reports the part it could not.
 */
export function resolvePyImport(
  fromPath: string,
  reference: { readonly level: number; readonly module: string | null; readonly names: readonly string[] },
  context: PyContext,
): readonly PyResolution[] {
  if (reference.module === null) return [{ kind: 'unresolved' }];
  const parts = reference.module.length === 0 ? [] : reference.module.split('.');

  if (reference.level > 0) {
    const base = relativeBase(fromPath, reference.level);
    if (base === null) return [{ kind: 'unresolved' }];
    const joined = joinUnder(base, parts);
    if (joined === null) return [{ kind: 'unresolved' }];
    return fromTarget(context, joined, reference.names, 'certain');
  }

  // Absolute. Every root is tried, because which one `sys.path` would have put
  // first is exactly the runtime fact ark refuses to guess at — so two roots
  // offering the same module is a real ambiguity and the edge says `probable`.
  const hits: string[] = [];
  let namespace = false;
  for (const root of context.roots) {
    const joined = joinUnder(root, parts);
    if (joined === null) continue;
    const found = at(context, joined);
    if (found === 'namespace') namespace = true;
    else if (found !== null) hits.push(joined);
  }
  if (hits.length > 0) {
    const confidence: Confidence = hits.length > 1 ? 'probable' : 'certain';
    const out: PyResolution[] = [];
    for (const base of hits) out.push(...fromTarget(context, base, reference.names, confidence));
    return out;
  }
  if (namespace) {
    const out: PyResolution[] = [];
    for (const root of context.roots) {
      const joined = joinUnder(root, parts);
      if (joined !== null) out.push(...submodules(context, joined, reference.names, 'certain'));
    }
    return out.length > 0 ? out : [{ kind: 'unresolved' }];
  }

  const head = parts[0] ?? '';
  if (STDLIB.has(head)) return [{ kind: 'external', name: head }];
  if (context.dependencies.has(normaliseDistribution(head))) return [{ kind: 'external', name: head }];
  return [{ kind: 'unresolved' }];
}

/** The module itself, plus any imported name that is a module of its own. */
function fromTarget(
  context: PyContext,
  base: string,
  names: readonly string[],
  confidence: Confidence,
): PyResolution[] {
  const found = at(context, base);
  const out: PyResolution[] = [];
  if (found === null) return [{ kind: 'unresolved' }];
  if (found !== 'namespace') out.push({ kind: 'internal', path: found.path, confidence });
  out.push(...submodules(context, base, names, confidence));
  return out;
}

function submodules(
  context: PyContext,
  base: string,
  names: readonly string[],
  confidence: Confidence,
): PyResolution[] {
  const out: PyResolution[] = [];
  for (const name of names) {
    if (name === '*') continue;
    const found = at(context, `${base}/${name}`);
    if (found !== null && found !== 'namespace') {
      out.push({ kind: 'internal', path: found.path, confidence });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// building the context — the only I/O in this module
// ---------------------------------------------------------------------------

/**
 * `dependencies = ["click>=8", …]`, `install_requires=[…]`, and a
 * `requirements.txt` line.
 *
 * A regex over the array rather than a TOML parser, and said out loud: what is
 * wanted is the set of *names*, every declaration form spells a name the same
 * way, and a TOML parser would be a runtime dependency to read one array. The
 * cost of missing one is `unresolved`, which is the safe direction.
 */
const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)/;

export function parseRequirements(source: string): string[] {
  const names: string[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line.length === 0 || line.startsWith('-')) continue;
    const match = REQUIREMENT.exec(line);
    if (match?.[1] !== undefined) names.push(normaliseDistribution(match[1]));
  }
  return names;
}

export function parseManifestDependencies(source: string): string[] {
  const names: string[] = [];
  const quoted = (body: string): void => {
    for (const item of body.matchAll(/["']([^"']+)["']/g)) {
      const match = REQUIREMENT.exec(item[1]?.trim() ?? '');
      if (match?.[1] !== undefined) names.push(normaliseDistribution(match[1]));
    }
  };
  // Every quoted item inside a named requirement array, wherever it sits —
  // `[project]`, `[build-system]`, or a `setup()` call.
  const arrays = /(?:dependencies|install_requires|setup_requires|tests_require|requires)\s*=\s*\[([^\]]*)\]/gs;
  let block: RegExpExecArray | null;
  while ((block = arrays.exec(source)) !== null) quoted(block[1] ?? '');
  // **Extras and dependency groups spell the key after the group's name**, so
  // the rule above cannot see them: `[project.optional-dependencies]` holds
  // `async = ["asgiref"]` and PEP 735's `[dependency-groups]` holds
  // `dev = ["ruff", …]`. Missing them is what made this file report **86**
  // unresolved sites on `pallets/flask` against ADR-0024 §3's 42 — every one of
  // them `pytest`, `selenium` or a Sphinx theme, which is a *declared* test
  // dependency and not a mystery.
  // The terminator is a **lookahead**, not a consumed `\n[`. Consuming it puts
  // `lastIndex` inside the next table header, so `[dependency-groups]`
  // immediately after `[project.optional-dependencies]` is unmatchable — which
  // is what the unit fixture caught, having been written with both tables
  // adjacent precisely because that is how a real `pyproject.toml` reads.
  const groups = /\[(?:project\.optional-dependencies|dependency-groups)\]([\s\S]*?)(?=\n\[|$)/g;
  while ((block = groups.exec(source)) !== null) quoted(block[1] ?? '');
  // Poetry spells them as table keys rather than as an array.
  const poetry = /\[tool\.poetry\.(?:group\.[\w-]+\.)?(?:dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g;
  while ((block = poetry.exec(source)) !== null) {
    for (const line of (block[1] ?? '').split('\n')) {
      const key = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (key?.[1] !== undefined && key[1] !== 'python') names.push(normaliseDistribution(key[1]));
    }
  }
  return names;
}

/**
 * A pinned-requirements file, by either convention.
 *
 * `requirements.txt` at the root is one; a `requirements/` **directory** of
 * `dev.txt`, `docs.txt`, `tests.txt` is the other, and it is what both measured
 * repos use — django keeps `tests/requirements/postgres.txt` and flask
 * `requirements/dev.txt`. A rule matching only the basename sees neither.
 */
export function isRequirementsFile(path: string): boolean {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? '' : path.slice(0, slash);
  if (!/\.(txt|in)$/.test(name)) return false;
  return /^requirements/.test(name) || dir === 'requirements' || dir.endsWith('/requirements');
}

export interface PyContextOptions {
  readonly root: string;
  /** Indexed Python file paths. */
  readonly pythonPaths: readonly string[];
  /** Every path the walk saw, for finding manifests and `src/` layouts. */
  readonly onDisk: ReadonlySet<string>;
}

export async function loadPyContext(options: PyContextOptions): Promise<PyContext> {
  const files = new Set(options.pythonPaths);
  const subtrees = new Set<string>();
  for (const path of options.pythonPaths) {
    let dir: string | null = directoryOf(path);
    while (dir !== null && dir !== '') {
      if (subtrees.has(dir)) break;
      subtrees.add(dir);
      dir = parentOf(dir);
    }
  }

  const roots = new Set<string>(['']);
  const manifests = [...options.onDisk].filter(isPyManifest).sort(byteCompare);
  const dependencies = new Set<string>();
  for (const manifest of manifests) {
    const dir = directoryOf(manifest);
    roots.add(dir);
    // `src/` only when the walk actually saw Python under it.
    const src = dir === '' ? 'src' : `${dir}/src`;
    if (subtrees.has(src)) roots.add(src);
    const source = await readIfPresent(join(options.root, manifest));
    if (source !== null) for (const name of parseManifestDependencies(source)) dependencies.add(name);
  }
  for (const path of [...options.onDisk].sort(byteCompare)) {
    if (!isRequirementsFile(path)) continue;
    const source = await readIfPresent(join(options.root, path));
    if (source !== null) for (const dependency of parseRequirements(source)) dependencies.add(dependency);
  }

  return { files, subtrees, roots: [...roots].sort(byteCompare), dependencies };
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
