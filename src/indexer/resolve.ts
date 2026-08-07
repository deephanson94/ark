/**
 * Module resolution.
 *
 * Turns a specifier into one of three verdicts:
 *
 *   internal   — a file in this repo. Produces an edge.
 *   external   — a declared dependency, a node builtin, or a URL. No edge, and
 *                no risk: nothing outside the repo can import back into it.
 *   unresolved — we do not know. No edge, and the importing file is flagged so
 *                guardrail 4 can refuse to build a challenge around it.
 *
 * The distinction between `external` and `unresolved` is the whole point. A
 * naive scanner lumps them together and either invents dependencies on
 * packages or, worse, quietly treats "I could not work this out" as "there is
 * nothing there" — which produces a confident, wrong answer key.
 */

import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Confidence } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import { parseJsonc } from './jsonc.js';

export type Resolution =
  | { readonly kind: 'internal'; readonly path: string; readonly confidence: Confidence }
  | { readonly kind: 'external'; readonly name: string }
  /** Exists on disk but carries no imports of its own (a stylesheet, an asset). */
  | { readonly kind: 'offMap'; readonly path: string }
  | { readonly kind: 'unresolved' };

export interface PathAlias {
  /** e.g. `@app/` for the pattern `@app/*`, or the exact specifier when unstarred. */
  readonly prefix: string;
  readonly wildcard: boolean;
  /** Repo-relative target prefixes, in declaration order. */
  readonly targets: readonly string[];
}

export interface ProjectConfig {
  /** Package names this repo declares a dependency on. */
  readonly dependencies: ReadonlySet<string>;
  /** `imports` map keys from package.json, e.g. `#internal/*`. */
  readonly selfImports: readonly string[];
  readonly aliases: readonly PathAlias[];
  /** tsconfig `baseUrl`, repo-relative, or null. */
  readonly baseUrl: string | null;
  readonly name: string | null;
}

export const EMPTY_CONFIG: ProjectConfig = {
  dependencies: new Set(),
  selfImports: [],
  aliases: [],
  baseUrl: null,
  name: null,
};

export interface ResolveContext {
  /** Paths that became nodes. Only these can be edge targets. */
  readonly indexed: ReadonlySet<string>;
  /** Every non-ignored file the walk saw, indexed or not. */
  readonly onDisk: ReadonlySet<string>;
  /**
   * The configuration in scope for a given file — the manifests nearest it,
   * not the repo root's. See `config.ts` for why that distinction is worth a
   * module.
   */
  configFor(path: string): ProjectConfig;
  /**
   * Package names declared by a `package.json` inside this repo. A specifier
   * naming one of these is never `external`, whatever any manifest says about
   * it.
   */
  readonly workspaceNames: ReadonlySet<string>;
}

const BUILTINS = new Set(builtinModules);

/**
 * Extensions tried when a specifier has none, and the `.js → .ts` rewrite that
 * TypeScript's ESM output requires. Order is fixed: when more than one exists
 * we report `probable` and take the first, so the choice is at least stable.
 */
const TRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_FILES = TRY_EXTENSIONS.map((extension) => `/index${extension}`);
const REWRITES: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx', '.js']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
  ['.jsx', ['.tsx', '.jsx']],
]);

/**
 * Extensions known to be inert — they cannot import anything, so an import
 * pointing at one hides nothing and is safely off-map.
 *
 * A **denylist, not an allowlist**, and the direction matters. Listing the
 * extensions that *can* import means every format nobody thought of — `.vue`,
 * `.svelte`, `.astro`, whatever ships next — is silently treated as inert, and
 * a file full of imports becomes invisible to guardrail 4. Listing the ones
 * that certainly cannot means an unknown extension is treated as a risk, which
 * costs a challenge rather than an answer key.
 */
const INERT_EXTENSIONS = new Set([
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.styl',
  '.json',
  '.jsonc',
  '.json5',
  '.md',
  '.mdx',
  '.txt',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.wav',
  '.pdf',
  '.wasm',
  '.yml',
  '.yaml',
  '.toml',
  '.graphql',
  '.gql',
  '.html',
]);

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot <= slash + 1 ? '' : path.slice(dot);
}

function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** POSIX path join + `.`/`..` normalisation. Returns null if it escapes the repo. */
export function normalizeJoin(base: string, specifier: string): string | null {
  const parts = base === '' ? [] : base.split('/');
  for (const segment of specifier.split('/')) {
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

/** Candidate target paths for a resolved base path, in a fixed priority order. */
function candidatesFor(base: string): string[] {
  const candidates: string[] = [base];
  const extension = extensionOf(base);
  const rewrites = REWRITES.get(extension);
  if (rewrites !== undefined) {
    const stem = base.slice(0, base.length - extension.length);
    for (const replacement of rewrites) candidates.push(stem + replacement);
  }
  if (extension === '') {
    for (const suffix of TRY_EXTENSIONS) candidates.push(base + suffix);
  }
  for (const suffix of INDEX_FILES) candidates.push(base + suffix);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

function pick(base: string, context: ResolveContext): Resolution | null {
  const candidates = candidatesFor(base);
  const hits = candidates.filter((candidate) => context.indexed.has(candidate));
  const first = hits[0];
  if (first !== undefined) {
    // More than one viable target means we guessed. Say so — `probable` edges
    // are excluded from challenge generation.
    return { kind: 'internal', path: first, confidence: hits.length === 1 ? 'certain' : 'probable' };
  }
  for (const candidate of candidates) {
    if (!context.onDisk.has(candidate)) continue;
    // The file exists but is not on the map (too large, unsupported type). If it
    // could carry imports of its own, it might hide a path we would need — so
    // anything not known to be inert counts as a risk.
    return INERT_EXTENSIONS.has(extensionOf(candidate))
      ? { kind: 'offMap', path: candidate }
      : { kind: 'unresolved' };
  }
  return null;
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? specifier;
}

export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  context: ResolveContext,
): Resolution {
  if (specifier.length === 0) return { kind: 'unresolved' };
  const config = context.configFor(fromPath);

  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    const base = normalizeJoin(dirnameOf(fromPath), specifier);
    if (base === null) return { kind: 'unresolved' };
    return pick(base, context) ?? { kind: 'unresolved' };
  }

  // Absolute filesystem paths are machine-specific; we cannot map them.
  if (specifier.startsWith('/')) return { kind: 'unresolved' };

  if (specifier.startsWith('node:')) return { kind: 'external', name: specifier };
  if (/^[a-z][a-z0-9+.-]*:/.test(specifier)) return { kind: 'external', name: specifier };

  for (const alias of config.aliases) {
    const matches = alias.wildcard ? specifier.startsWith(alias.prefix) : specifier === alias.prefix;
    if (!matches) continue;
    const rest = alias.wildcard ? specifier.slice(alias.prefix.length) : '';
    for (const target of alias.targets) {
      const base = normalizeJoin('', alias.wildcard ? target + rest : target);
      if (base === null) continue;
      const hit = pick(base, context);
      if (hit !== null) return hit;
    }
    return { kind: 'unresolved' };
  }

  if (specifier.startsWith('#')) {
    return config.selfImports.some((key) => matchesSelfImport(key, specifier))
      ? { kind: 'external', name: packageNameOf(specifier) }
      : { kind: 'unresolved' };
  }

  if (config.baseUrl !== null) {
    const base = normalizeJoin(config.baseUrl, specifier);
    if (base !== null) {
      const hit = pick(base, context);
      if (hit !== null) return hit;
    }
  }

  const packageName = packageNameOf(specifier);
  if (BUILTINS.has(packageName)) return { kind: 'external', name: packageName };

  // A package this repo itself defines is **never** external, however it is
  // declared. `external` means "no risk: nothing outside the repo can import
  // back into it", and a workspace sibling imports straight back in — vite's
  // root manifest lists `"vite": "workspace:*"`, so `import 'vite'` from a
  // playground file used to be called external while reaching 332 files inside
  // the repo. That is a file that looks fully resolved and is hiding a
  // dependency, which is the exact false negative guardrail 4 exists to catch.
  //
  // We do not resolve it either: a package's entry point is its `exports` or
  // `main`, and in a monorepo those name *built* output that is gitignored and
  // not on the map. Pillar 6 forbids requiring a build to index, so the honest
  // answer is that we do not know — which taints the file and costs a
  // challenge, rather than shipping an answer key over an invisible edge.
  if (context.workspaceNames.has(packageName)) return { kind: 'unresolved' };

  if (config.dependencies.has(packageName)) return { kind: 'external', name: packageName };

  // A bare specifier we cannot tie to a declared dependency. It might be an
  // implicit transitive dep, or a typo. We do not know.
  return { kind: 'unresolved' };
}

function matchesSelfImport(key: string, specifier: string): boolean {
  if (!key.includes('*')) return key === specifier;
  const [head = '', tail = ''] = key.split('*');
  return specifier.startsWith(head) && specifier.endsWith(tail);
}

// ---------------------------------------------------------------------------
// config loading — the only I/O in this module
// ---------------------------------------------------------------------------

function stringRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const dependencies = new Set<string>();
  const selfImports: string[] = [];
  let name: string | null = null;

  const packageJson = parseJsonc((await readIfPresent(join(root, 'package.json'))) ?? '');
  if (packageJson !== null) {
    const record = stringRecord(packageJson);
    if (typeof record['name'] === 'string') name = record['name'];
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const key of Object.keys(stringRecord(record[field]))) dependencies.add(key);
    }
    for (const key of Object.keys(stringRecord(record['imports']))) selfImports.push(key);
  }

  const aliases: PathAlias[] = [];
  let baseUrl: string | null = null;
  const tsconfig = parseJsonc((await readIfPresent(join(root, 'tsconfig.json'))) ?? '');
  if (tsconfig !== null) {
    const options = stringRecord(stringRecord(tsconfig)['compilerOptions']);
    const rawBaseUrl = options['baseUrl'];
    if (typeof rawBaseUrl === 'string') baseUrl = normalizeJoin('', rawBaseUrl);
    for (const [pattern, rawTargets] of Object.entries(stringRecord(options['paths']))) {
      if (!Array.isArray(rawTargets)) continue;
      const targets = rawTargets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => normalizeJoin(baseUrl ?? '', target.replace('*', '')))
        .filter((target): target is string => target !== null);
      if (targets.length === 0) continue;
      const wildcard = pattern.includes('*');
      aliases.push({ prefix: wildcard ? (pattern.split('*')[0] ?? '') : pattern, wildcard, targets });
    }
  }
  // Longest prefix first, so `@app/ui/` beats `@app/`.
  aliases.sort((a, b) => b.prefix.length - a.prefix.length || byteCompare(a.prefix, b.prefix));

  return { dependencies, selfImports: selfImports.sort(byteCompare), aliases, baseUrl, name };
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
