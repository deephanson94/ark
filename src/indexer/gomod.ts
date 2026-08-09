/**
 * Go module resolution: `go.mod` in, a verdict per import path out.
 *
 * The same three verdicts as `resolve.ts`, for the same reason — `external` and
 * `unresolved` must not be confused, because lumping them together either
 * invents dependencies or, worse, treats *"I could not work this out"* as
 * *"there is nothing there"*, which produces a confident wrong answer key.
 *
 * Go makes the distinction cheaper than JavaScript does, and it is worth
 * knowing why, because it is what lets a Go map be dense where a Python one
 * cannot (ADR-0024 §4):
 *
 *  - **An import path is a location, not a name.** `github.com/x/y/z` under
 *    module `github.com/x/y` is the directory `z`, exactly, with no extension
 *    guessing, no `index` file and no `exports` map. Every internal edge is
 *    `certain`; there is no `probable` arm to have.
 *  - **The standard library is exactly the domain-less paths.** Go reserves
 *    first path elements without a dot, so `net/http` is stdlib and
 *    `gocloud.dev/blob` is not, by a rule rather than by a list that goes
 *    stale.
 *
 * What is left over is genuinely unknown and is reported as such: an import of
 * a module the nearest `go.mod` never requires.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { byteCompare } from '../atlas/index.js';

export const GO_MOD = 'go.mod';

/**
 * The package a `.go` file belongs to: its directory.
 *
 * The repo root is spelled `.` rather than the empty string, because an empty
 * `path` is refused by the validator and because `.` is what a person reading
 * the map would call it. `spf13/cobra` is exactly this case — one flat package
 * at the root.
 *
 * A directory holding both `foo` and `foo_test` — Go's external test package —
 * is still one node. That is deliberate: the two are compiled together, they
 * move together in git, and separating them would re-create at the *file*
 * level the very distinction package granularity exists to erase.
 */
export function goPackageDir(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '.' : path.slice(0, slash);
}

export interface GoModule {
  /** Repo-relative directory holding this `go.mod`. `''` at the repo root. */
  readonly dir: string;
  /** The `module` line, e.g. `github.com/gohugoio/hugo`. */
  readonly path: string;
  /** Module paths this file requires. */
  readonly requires: ReadonlySet<string>;
  /**
   * `replace X => ./local` — module paths redirected to a directory **inside
   * this repo**, mapped to that repo-relative directory.
   *
   * A replacement pointing outside the repo (an absolute path, or a `..` that
   * escapes it) is deliberately absent rather than recorded as external: we
   * cannot see the target, so we do not know.
   */
  readonly replacements: ReadonlyMap<string, string>;
}

export type GoResolution =
  /** A package directory in this repo. */
  | { readonly kind: 'internal'; readonly dir: string }
  /** Standard library, or a module the nearest `go.mod` declares. No edge. */
  | { readonly kind: 'external'; readonly name: string }
  | { readonly kind: 'unresolved' };

export interface GoContext {
  /** Directories holding at least one indexed `.go` file. Only these are targets. */
  readonly packages: ReadonlySet<string>;
  /** The `go.mod` in scope for a file — the nearest ancestor, or null. */
  moduleFor(path: string): GoModule | null;
}

/** POSIX-join `base` with `rest`, normalising `.`/`..`. Null if it escapes. */
function joinUnder(base: string, rest: string): string | null {
  const parts = base === '' ? [] : base.split('/');
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

function firstSegment(specifier: string): string {
  const slash = specifier.indexOf('/');
  return slash === -1 ? specifier : specifier.slice(0, slash);
}

/**
 * Go's own rule for "is this the standard library": the first path element has
 * no dot in it. `import "C"` — cgo's pseudo-package — is the one name that is
 * neither stdlib nor a module, and it imports nothing back.
 */
function isStandardLibrary(specifier: string): boolean {
  return !firstSegment(specifier).includes('.');
}

/**
 * The package directory a module path names, if it names one inside `module`.
 *
 * The result is normalised to a **node key**, which is why the repo root comes
 * back as `.` and not as the empty string. Skipping that normalisation is not a
 * missing edge in the abstract: `spf13/cobra`'s own `doc/` package imports
 * `github.com/spf13/cobra`, the module path itself, so the repo's *only*
 * internal edge landed on `''`, matched no node, and was reported as an
 * unresolved import — a repo with one edge shipping zero, and the file that
 * should have carried it tainted for guardrail 4 instead.
 */
function underModule(module: GoModule, specifier: string): string | null {
  if (specifier === module.path) return asPackage(module.dir);
  if (!specifier.startsWith(`${module.path}/`)) return null;
  const joined = joinUnder(module.dir, specifier.slice(module.path.length + 1));
  return joined === null ? null : asPackage(joined);
}

/** `''` is a directory; `.` is what `goPackageDir` calls it. */
function asPackage(dir: string): string {
  return dir === '' ? '.' : dir;
}

export function resolveGoImport(
  fromPath: string,
  specifier: string,
  context: GoContext,
): GoResolution {
  if (specifier.length === 0) return { kind: 'unresolved' };
  // Illegal inside a module, and it survives in pre-module trees. We have no
  // module path to anchor it to, so we do not guess.
  //
  // **Not redundant, unlike the branch that used to sit above it.** `./b` falls
  // through to `unresolved` anyway, but `/abs/path` has an empty first segment,
  // which `isStandardLibrary` reads as domain-less and would call **external**.
  // A guard is not the same thing as a fallback: this one fires zero times on
  // hugo, cobra and prometheus and is kept because deleting it invents an
  // answer, where deleting cgo's `import "C"` case changed nothing at all —
  // `C` has no dot, so Go's own stdlib rule already returns exactly it.
  if (specifier.startsWith('.') || specifier.startsWith('/')) return { kind: 'unresolved' };

  const module = context.moduleFor(fromPath);
  if (module === null) {
    // No `go.mod` in scope: the standard library is still knowable by Go's own
    // rule, and nothing else is — there is no require list to check against.
    return isStandardLibrary(specifier)
      ? { kind: 'external', name: specifier }
      : { kind: 'unresolved' };
  }

  const own = underModule(module, specifier);
  if (own !== null) {
    // A path inside this module that holds no indexed Go file is not an
    // external package — it is a directory we did not index (generated,
    // ignored, or simply absent). ADR-0003: we do not know.
    return context.packages.has(own) ? { kind: 'internal', dir: own } : { kind: 'unresolved' };
  }

  for (const [from, to] of module.replacements) {
    if (specifier !== from && !specifier.startsWith(`${from}/`)) continue;
    const rest = specifier.slice(from.length);
    const joined = joinUnder(to, rest);
    if (joined === null) break;
    const dir = asPackage(joined);
    return context.packages.has(dir) ? { kind: 'internal', dir } : { kind: 'unresolved' };
  }

  if (isStandardLibrary(specifier)) return { kind: 'external', name: specifier };

  // A module is required as a whole; a package inside it is `module/sub`.
  for (const required of module.requires) {
    if (specifier === required || specifier.startsWith(`${required}/`)) {
      return { kind: 'external', name: required };
    }
  }

  return { kind: 'unresolved' };
}

// ---------------------------------------------------------------------------
// parsing — the only I/O in this module
// ---------------------------------------------------------------------------

/** Strip `//` comments. `go.mod` has no block comments and no string literals. */
function stripComments(line: string): string {
  const at = line.indexOf('//');
  return (at === -1 ? line : line.slice(0, at)).trim();
}

export function parseGoMod(dir: string, source: string): GoModule | null {
  let path: string | null = null;
  const requires = new Set<string>();
  const replacements = new Map<string, string>();
  let block: 'require' | 'replace' | null = null;

  for (const raw of source.split('\n')) {
    const line = stripComments(raw);
    if (line.length === 0) continue;
    if (block !== null) {
      if (line === ')') {
        block = null;
        continue;
      }
      if (block === 'require') addRequire(requires, line);
      else addReplace(replacements, dir, line);
      continue;
    }
    if (line.startsWith('module ')) {
      path = line.slice('module '.length).trim();
      continue;
    }
    if (line === 'require (') {
      block = 'require';
      continue;
    }
    if (line === 'replace (') {
      block = 'replace';
      continue;
    }
    if (line.startsWith('require ')) addRequire(requires, line.slice('require '.length));
    else if (line.startsWith('replace ')) addReplace(replacements, dir, line.slice('replace '.length));
  }

  if (path === null || path.length === 0) return null;
  return { dir, path, requires, replacements };
}

/** `github.com/x/y v1.2.3` — the module path is the first field. */
function addRequire(into: Set<string>, entry: string): void {
  const name = entry.trim().split(/\s+/)[0];
  if (name !== undefined && name.length > 0 && name !== '(') into.add(name);
}

/** `github.com/x/y => ./local/y` or `github.com/x/y v1 => ../y v2`. */
function addReplace(into: Map<string, string>, dir: string, entry: string): void {
  const [left, right] = entry.split('=>');
  if (left === undefined || right === undefined) return;
  const from = left.trim().split(/\s+/)[0];
  const target = right.trim().split(/\s+/)[0];
  if (from === undefined || target === undefined) return;
  // Only a filesystem path is a replacement we can follow, and only one that
  // stays inside the repo. A module-to-module replacement changes which
  // *external* module is used, which changes no edge of ours.
  if (!target.startsWith('./') && !target.startsWith('../')) return;
  const resolved = joinUnder(dir, target);
  if (resolved !== null) into.set(from, resolved);
}

export interface GoModuleIndex {
  readonly modules: readonly GoModule[];
  /** The nearest `go.mod` at or above `path`'s directory, or null. */
  moduleFor(path: string): GoModule | null;
}

/**
 * Read every `go.mod` the walk saw.
 *
 * Nearest-ancestor rather than root-only, for the same reason `config.ts`
 * reads the manifest nearest each importing file: a repo with a nested module
 * gives its subtree a different module path, and resolving that subtree
 * against the root's path would call every one of its internal imports
 * unresolved.
 */
export async function loadGoModules(root: string, paths: readonly string[]): Promise<GoModuleIndex> {
  const found: GoModule[] = [];
  for (const path of [...paths].sort(byteCompare)) {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash);
    let source: string;
    try {
      source = await readFile(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseGoMod(dir, source);
    if (parsed !== null) found.push(parsed);
  }
  // Deepest first, so the first match walking down is the nearest ancestor.
  const modules = [...found].sort((a, b) => b.dir.length - a.dir.length || byteCompare(a.dir, b.dir));
  return {
    modules,
    moduleFor(path: string): GoModule | null {
      for (const module of modules) {
        if (module.dir === '') return module;
        if (path.startsWith(`${module.dir}/`)) return module;
      }
      return null;
    },
  };
}

/** `go.mod`, at the root or nested. */
export function isGoMod(path: string): boolean {
  return path === GO_MOD || path.endsWith(`/${GO_MOD}`);
}
