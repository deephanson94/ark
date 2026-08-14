/**
 * Project configuration, resolved **per directory** rather than per repo.
 *
 * The rule Node and TypeScript actually use is "the manifest nearest the
 * importing file, then upward". M0's resolver read only the repo root, which is
 * correct for a single-package repo and wrong for every monorepo. Measured on
 * `vitejs/vite`, which has 299 `package.json` and 55 `tsconfig.json` files, it
 * left **762 import specifiers unresolved**:
 *
 *   126  `~utils`            declared in `playground/tsconfig.json`, not the root
 *   614  bare specifiers     declared in `packages/vite/package.json`, not the root
 *    81  `#types/*`          declared in `packages/vite/package.json`'s `imports`
 *
 * None of those is exotic. They are what a workspace looks like.
 *
 * Guardrail 4 pays for this directly: an unresolved import taints its file, and
 * a tainted file can carry no challenge. 54% of vite's real source was
 * unaskable for no better reason than that we looked in one directory.
 *
 * Three lookups, three different scoping rules, because Node and TypeScript do
 * not agree with each other and copying one onto the other would be wrong:
 *
 *   dependencies   **union up the tree.** `require('x')` walks `node_modules`
 *                  from the file's directory to the root, so a dependency
 *                  declared by any ancestor is reachable.
 *   `#` imports    **the nearest `package.json` only.** Node resolves subpath
 *                  imports against the closest package boundary; an ancestor's
 *                  `imports` map is not in scope.
 *   tsconfig paths **the nearest `tsconfig.json`**, following `extends`. The
 *                  exact rule is "the tsconfig whose `include` covers the file",
 *                  which needs glob evaluation we do not do; nearest-ancestor is
 *                  the standard approximation and is what editors use.
 *
 * Everything here is deterministic: manifests arrive in the walk's sorted
 * order, every derived array is sorted, and nothing depends on the filesystem's
 * iteration order.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { byteCompare } from '../atlas/index.js';
import { parseJsonc } from './jsonc.js';
import type { PathAlias, ProjectConfig } from './resolve.js';
import { EMPTY_CONFIG, normalizeJoin } from './resolve.js';

/**
 * Filenames that carry configuration we understand.
 *
 * `tsconfig.base.json`, `tsconfig.node.json` and friends have to match too, or
 * an `extends` pointing at one finds nothing and the inherited `paths` vanish.
 * vite has 55 tsconfigs and only some are called `tsconfig.json`.
 */
const MANIFEST_PATTERN = /^(package\.json|[tj]sconfig(\.[\w-]+)*\.json)$/;

/**
 * A `tsconfig.json` may `extends` a chain of others. Bounded so a cycle or a
 * pathological chain cannot hang the indexer.
 */
const MAX_EXTENDS_DEPTH = 8;

export function isManifest(path: string): boolean {
  const slash = path.lastIndexOf('/');
  return MANIFEST_PATTERN.test(slash === -1 ? path : path.slice(slash + 1));
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function stringRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface PackageFacts {
  readonly dependencies: readonly string[];
  readonly selfImports: readonly string[];
  readonly name: string | null;
  /** Dependency names declared with the `workspace:` protocol. */
  readonly workspaceDeps: readonly string[];
  /** `exports` flattened to `subpath -> target`, sorted. MEASUREMENT (ADR-0042 §3). */
  readonly exports: readonly (readonly [string, string])[];
}

interface TsFacts {
  readonly aliases: readonly PathAlias[];
  readonly baseUrl: string | null;
  /** True when this config said nothing about module resolution. */
  readonly empty: boolean;
}

export interface ConfigIndex {
  /** The configuration that applies to a file, by its repo-relative path. */
  for(path: string): ProjectConfig;
  /**
   * Every package name declared by a `package.json` **inside this repo**.
   *
   * These may never resolve to `external`. See `resolveSpecifier` — calling a
   * workspace sibling external asserts "nothing outside the repo can import
   * back into it" about an import that reaches straight back in, which is the
   * false-negative guardrail 4 exists to prevent.
   */
  readonly workspaceNames: ReadonlySet<string>;
  /** MEASUREMENT (ADR-0042 §3): where each workspace package lives and what it exports. */
  readonly workspacePackages: ReadonlyMap<string, WorkspacePackage>;
}

/** MEASUREMENT (ADR-0042 §3). */
export interface WorkspacePackage {
  /** Repo-relative directory holding the manifest. `''` at the repo root. */
  readonly dir: string;
  /** `exports` subpath -> target, relative to `dir`. */
  readonly exports: ReadonlyMap<string, string>;
}

export async function loadConfigIndex(
  root: string,
  manifestPaths: readonly string[],
): Promise<ConfigIndex> {
  const packages = new Map<string, PackageFacts>();
  const tsconfigs = new Map<string, TsFacts>();
  const workspaceNames = new Set<string>();
  const workspacePackages = new Map<string, WorkspacePackage>();

  // Raw text first, so `extends` can be followed without re-reading.
  //
  // Read concurrently, and not as a micro-optimisation: a monorepo has hundreds
  // of manifests (vite has 354) and awaiting them one at a time cost **5 s of a
  // 10 s index budget**, turning a resolution fix into a budget breach. The map
  // is still populated in `manifestPaths` order, which the walk sorted, so the
  // result does not depend on which read finishes first.
  const texts = new Map<string, string>();
  const loaded = await Promise.all(
    manifestPaths.map(async (path) => [path, await readIfPresent(join(root, path))] as const),
  );
  for (const [path, text] of loaded) if (text !== null) texts.set(path, text);

  for (const [path, text] of texts) {
    const parsed = parseJsonc(text);
    if (parsed === null) continue;
    const directory = directoryOf(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === 'package.json') {
      const facts = packageFacts(parsed);
      packages.set(directory, facts);
      if (facts.name !== null) {
        workspaceNames.add(facts.name);
        // First manifest wins on a duplicate name, in the walk's sorted order.
        if (!workspacePackages.has(facts.name)) {
          workspacePackages.set(facts.name, { dir: directory, exports: new Map(facts.exports) });
        }
      }
    } else {
      tsconfigs.set(directory, tsFacts(parsed, directory, texts));
    }
  }

  const cache = new Map<string, ProjectConfig>();

  const configForDirectory = (directory: string): ProjectConfig => {
    const cached = cache.get(directory);
    if (cached !== undefined) return cached;

    const chain: string[] = [];
    for (let at: string | null = directory; at !== null; at = at === '' ? null : directoryOf(at)) {
      chain.push(at);
    }

    // Dependencies: union up the tree, matching `node_modules` lookup.
    const dependencies = new Set<string>();
    for (const step of chain) {
      for (const dependency of packages.get(step)?.dependencies ?? []) dependencies.add(dependency);
    }

    // `#` imports and `name`: the nearest package.json that declares them.
    let selfImports: readonly string[] = [];
    let name: string | null = null;
    for (const step of chain) {
      const facts = packages.get(step);
      if (facts === undefined) continue;
      if (name === null) name = facts.name;
      if (facts.selfImports.length > 0) {
        selfImports = facts.selfImports;
        break;
      }
    }

    // tsconfig: the nearest one that says anything about resolution.
    let aliases: readonly PathAlias[] = [];
    let baseUrl: string | null = null;
    for (const step of chain) {
      const facts = tsconfigs.get(step);
      if (facts === undefined || facts.empty) continue;
      aliases = facts.aliases;
      baseUrl = facts.baseUrl;
      break;
    }

    const config: ProjectConfig = { dependencies, selfImports, aliases, baseUrl, name };
    cache.set(directory, config);
    return config;
  };

  return {
    for: (path) => (texts.size === 0 ? EMPTY_CONFIG : configForDirectory(directoryOf(path))),
    workspaceNames,
    workspacePackages,
  };
}

function packageFacts(parsed: unknown): PackageFacts {
  const record = stringRecord(parsed);
  const dependencies: string[] = [];
  const workspaceDeps: string[] = [];
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const [key, value] of Object.entries(stringRecord(record[field]))) {
      dependencies.push(key);
      // `"vite": "workspace:*"` names a sibling package, not a registry one.
      if (typeof value === 'string' && value.startsWith('workspace:')) workspaceDeps.push(key);
    }
  }
  return {
    dependencies: dedupeSorted(dependencies),
    selfImports: dedupeSorted(Object.keys(stringRecord(record['imports']))),
    name: typeof record['name'] === 'string' ? record['name'] : null,
    workspaceDeps: dedupeSorted(workspaceDeps),
    exports: exportEntries(record['exports']),
  };
}

/**
 * MEASUREMENT (ADR-0042 §3). `exports` flattened to `subpath -> target`.
 *
 * Condition objects are followed in a fixed order so the result is deterministic.
 */
function exportEntries(value: unknown): readonly (readonly [string, string])[] {
  const target = (x: unknown, depth: number): string | null => {
    if (depth > 4) return null;
    if (typeof x === 'string') return x;
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
    const record = x as Record<string, unknown>;
    for (const key of ['import', 'module', 'default', 'require', 'node', 'types']) {
      if (!(key in record)) continue;
      const hit = target(record[key], depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  };
  const entries: (readonly [string, string])[] = [];
  if (typeof value === 'string') return [['.', value]];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > 0 && !keys.some((key) => key.startsWith('.'))) {
    const hit = target(value, 0);
    return hit === null ? [] : [['.', hit]];
  }
  for (const [key, raw] of Object.entries(record)) {
    if (!key.startsWith('.')) continue;
    const hit = target(raw, 0);
    if (hit !== null) entries.push([key, hit]);
  }
  entries.sort((a, b) => byteCompare(a[0], b[0]));
  return entries;
}

/**
 * `paths` and `baseUrl` from a tsconfig, made repo-relative.
 *
 * Both are relative to the **tsconfig's own directory**, not the repo root —
 * the bug that hid `playground/tsconfig.json`'s `"~utils": ["./test-utils.ts"]`
 * behind 126 unresolved imports.
 */
function tsFacts(parsed: unknown, directory: string, texts: ReadonlyMap<string, string>): TsFacts {
  const merged = withExtends(parsed, directory, texts, 0);
  const options = stringRecord(stringRecord(merged.value)['compilerOptions']);
  const home = merged.directory;

  const rawBaseUrl = options['baseUrl'];
  const baseUrl =
    typeof rawBaseUrl === 'string' ? normalizeJoin(home, rawBaseUrl) : null;
  // `paths` are relative to `baseUrl` when it is set, and to the config's own
  // directory when it is not — which is how modern TypeScript reads them.
  const pathRoot = baseUrl ?? home;

  const aliases: PathAlias[] = [];
  for (const [pattern, rawTargets] of Object.entries(stringRecord(options['paths']))) {
    if (!Array.isArray(rawTargets)) continue;
    const targets = rawTargets
      .filter((target): target is string => typeof target === 'string')
      .map((target) => aliasTarget(pathRoot, target))
      .filter((target): target is string => target !== null);
    if (targets.length === 0) continue;
    const wildcard = pattern.includes('*');
    aliases.push({ prefix: wildcard ? (pattern.split('*')[0] ?? '') : pattern, wildcard, targets });
  }
  // Longest prefix first, so `@app/ui/` beats `@app/`.
  aliases.sort((a, b) => b.prefix.length - a.prefix.length || byteCompare(a.prefix, b.prefix));

  return { aliases, baseUrl, empty: aliases.length === 0 && baseUrl === null };
}

/**
 * Follow `extends`, nearest wins. Only relative extends are followed: a
 * `extends: "@tsconfig/node20/tsconfig.json"` lives in `node_modules`, which we
 * deliberately do not walk, so there is nothing to read.
 */
function withExtends(
  value: unknown,
  directory: string,
  texts: ReadonlyMap<string, string>,
  depth: number,
): { value: unknown; directory: string } {
  const record = stringRecord(value);
  const extend = record['extends'];
  if (depth >= MAX_EXTENDS_DEPTH || typeof extend !== 'string') return { value, directory };
  if (!extend.startsWith('.')) return { value, directory };

  const target = normalizeJoin(directory, extend);
  if (target === null) return { value, directory };
  const candidates = target.endsWith('.json') ? [target] : [`${target}.json`, `${target}/tsconfig.json`];
  for (const candidate of candidates) {
    const text = texts.get(candidate);
    if (text === undefined) continue;
    const parent = parseJsonc(text);
    if (parent === null) continue;
    const resolved = withExtends(parent, directoryOf(candidate), texts, depth + 1);
    const parentOptions = stringRecord(stringRecord(resolved.value)['compilerOptions']);
    const ownOptions = stringRecord(record['compilerOptions']);
    // The child wins field by field, which is how TypeScript merges them. If the
    // child sets neither `paths` nor `baseUrl`, the parent's survive — and are
    // read relative to the *parent's* directory, which is why that is returned.
    const hasOwn = ownOptions['paths'] !== undefined || ownOptions['baseUrl'] !== undefined;
    return hasOwn
      ? { value: { compilerOptions: { ...parentOptions, ...ownOptions } }, directory }
      : { value: { compilerOptions: parentOptions }, directory: resolved.directory };
  }
  return { value, directory };
}

/**
 * The repo-relative prefix a `paths` target expands to.
 *
 * `normalizeJoin` drops a trailing separator, and the wildcard tail is then
 * concatenated straight onto it — so `"@app/*": ["./src/*"]` produced `src` and
 * `@app/foo` resolved to `srcfoo`. It has been wrong since M0 and nothing
 * caught it, because Ark's own tsconfig declares no `paths` and the unit test
 * hand-wrote its alias with the separator already attached, never exercising
 * the loader that strips it.
 */
function aliasTarget(pathRoot: string, target: string): string | null {
  const head = target.split('*')[0] ?? '';
  const joined = normalizeJoin(pathRoot, head);
  if (joined === null || joined === '') return joined;
  return head.endsWith('/') ? `${joined}/` : joined;
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(byteCompare);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
