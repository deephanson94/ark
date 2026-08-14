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
  /** MEASUREMENT (ADR-0042 §3): where each workspace package lives and what it exports. */
  readonly workspacePackages?: ReadonlyMap<string, { readonly dir: string; readonly exports: ReadonlyMap<string, string> }>;
}

const BUILTINS = new Set(builtinModules);

/**
 * Extensions tried when a specifier has none, and the `.js → .ts` rewrite that
 * TypeScript's ESM output requires. Order is fixed: when more than one exists
 * we report `probable` and take the first, so the choice is at least stable.
 */
const TRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_FILES = TRY_EXTENSIONS.map((extension) => `/index${extension}`);
/** Extensions that really are module extensions, as opposed to a dot in a filename. */
const KNOWN_EXTENSIONS = new Set(TRY_EXTENSIONS);
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

/**
 * Join a repo-relative directory to a sub-path, where the directory may be `''` — the repository
 * root, which is what a manifest at the top of the tree has.
 *
 * `${dir}/${sub}` is wrong there: it produces `/src`, and `normalizeJoin` keeps the leading empty
 * segment, so every candidate built from it starts with a slash and can never match a node key.
 * ADR-0026's cobra defect; see the workspace block in `resolveSpecifier`.
 */
function joinDir(dir: string, sub: string): string {
  if (dir === '') return sub;
  if (sub === '') return dir;
  return `${dir}/${sub}`;
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
  // MEASUREMENT (ADR-0042 §3, fix 2 - `dottedSegment`). `extensionOf('./x.interface')` answers
  // `.interface`, so this append loop used to be skipped and `x.interface.ts` was never a
  // candidate. nest names 1,942 specifiers that way. A dot is not an extension unless we know it.
  if (extension === '' || !KNOWN_EXTENSIONS.has(extension)) {
    for (const suffix of TRY_EXTENSIONS) candidates.push(base + suffix);
  }
  // MEASUREMENT (ADR-0042 §3, fix 3 - `rootSelfPath`). `base` is `''` for a specifier naming the
  // repo root, and `'' + '/index.ts'` is `/index.ts` - a leading slash no repo-relative node key
  // can match. ADR-0026's cobra defect, in this resolver.
  const prefix = base === '' ? '' : `${base}/`;
  for (const suffix of INDEX_FILES) candidates.push(prefix + suffix.slice(1));

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

/**
 * The `exports` value for a subpath a `*` pattern covers, with the wildcard substituted.
 *
 * Longest literal prefix wins, which is the rule Node uses to disambiguate overlapping patterns.
 */
function matchExportPattern(
  exports: ReadonlyMap<string, string>,
  subpath: string,
): string | undefined {
  let best: { prefix: number; target: string } | null = null;
  for (const [key, target] of exports) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const head = key.slice(0, star);
    const tail = key.slice(star + 1);
    if (!subpath.startsWith(head) || !subpath.endsWith(tail)) continue;
    if (subpath.length < head.length + tail.length) continue;
    const filled = subpath.slice(head.length, subpath.length - tail.length);
    if (best !== null && head.length <= best.prefix) continue;
    best = { prefix: head.length, target: target.replace('*', filled) };
  }
  return best?.target;
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
  // **We do resolve it when the repository says where it lives** (ADR-0042 decision 5). The
  // sentence this comment used to carry — *"a package's entry point is its `exports` or `main`, and
  // in a monorepo those name built output that is gitignored"* — is **repo-dependent**, which
  // nothing had checked: apollo-client's root `exports` is `{".": "./src/core/index.ts"}`, source
  // and on disk, while rxjs's is `./dist/esm/index.js` where the sentence is exactly right.
  //
  // Three arms, and the **order and the gaps between them are the whole safety argument**:
  //
  //   1. `exports` declares this subpath and its target is on the map. Authoritative — the package
  //      itself said what the specifier means.
  //   2. `exports` declares it and the target is **missing** (a build artifact). Fall back to the
  //      source-layout mirror `<dir>/src/<rest>` and **nowhere else**. This is the monorepo shape
  //      rxjs and vue-core have, and stopping here is what makes arm 3 safe.
  //   3. `exports` says nothing about this subpath at all. Then plain directory resolution,
  //      `<dir>/<rest>` then `<dir>/src/<rest>`, which is what Node does without an `exports` map.
  //      nest is this case: 493 specifiers, no manifest declaring `exports` anywhere.
  //
  // **Arm 2 must not fall through to `<dir>/<rest>`, and that is not fastidiousness.** With a root
  // manifest `dir` is `''`, so `<dir>/<rest>` is the repository root: a package whose `exports` maps
  // `./utils` to `./dist/utils.js` — compiled from `src/utils.ts` — would resolve to a **root-level
  // `utils.ts` decoy** instead, `certain`, and the real file would never get the edge. Under
  // ADR-0008's `candidates ∩ dependents(subject, ∞) = truth` that is a wrong answer key. It is
  // fixture-proven and corpus-clean, and it is barred by construction rather than by luck.
  //
  // Anything else stays `unresolved`, exactly as before — a workspace sibling imports straight back
  // into the repo, so calling it `external` would assert "nothing outside can import back in" about
  // an import that does, which is the false negative guardrail 4 exists to catch.
  if (context.workspaceNames.has(packageName)) {
    const pkg = context.workspacePackages?.get(packageName);
    if (pkg !== undefined) {
      const subpath =
        specifier.length > packageName.length ? `.${specifier.slice(packageName.length)}` : '.';
      const rest = subpath === '.' ? '' : subpath.slice(2);
      // **Pattern subpaths count as declared.** `exportEntries` stores keys literally, so a map of
      // `{"./*": "./dist/*.js"}` matched no real subpath and fell to arm 3 — which tries
      // `<dir>/<rest>` first and is exactly the decoy path arm 2 exists to bar. typeorm (`./*`,
      // root manifest, so `<dir>` is the repository root), hono, vue-core and excalidraw all
      // declare patterns. "Corpus-clean" was luck of layout, which is not what a safety rule may
      // rest on.
      const declared = pkg.exports.get(subpath) ?? matchExportPattern(pkg.exports, subpath);

      if (declared !== undefined) {
        const base = normalizeJoin(pkg.dir, declared);
        const hit = base === null ? null : pick(base, context);
        if (hit !== null && hit.kind === 'internal') return hit;
      }

      // Arm 2 when `exports` declared the subpath, arm 3 when it did not. See above for why the
      // declared case may not reach `pkg.dir` itself.
      const roots =
        declared === undefined ? [pkg.dir, joinDir(pkg.dir, 'src')] : [joinDir(pkg.dir, 'src')];
      // **Two arms landing on two different files is a guess, and the schema has a word for it.**
      // `probable` means "more than one viable target"; `certain` is what `graph.ts` trusts for an
      // answer key. When both `<dir>/<rest>` and `<dir>/src/<rest>` are indexed we have no way to
      // say which the specifier meant, so the edge is drawn and excluded from generation rather
      // than asserted.
      const found: Resolution[] = [];
      for (const root of roots) {
        const base = normalizeJoin(joinDir(root, rest), '');
        if (base === null) continue;
        const hit = pick(base, context);
        if (hit !== null && hit.kind === 'internal') found.push(hit);
      }
      const first = found[0];
      if (first !== undefined && first.kind === 'internal') {
        const distinct = new Set(found.map((hit) => (hit.kind === 'internal' ? hit.path : '')));
        return distinct.size > 1 ? { ...first, confidence: 'probable' } : first;
      }
    }
    return { kind: 'unresolved' };
  }

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
