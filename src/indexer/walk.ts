/**
 * The filesystem walk. One of the two places the indexer touches your source
 * (the other is `git.ts`), and the place where several of CLAUDE.md's landmines
 * live: symlink loops, `node_modules`, and walk order.
 *
 * Directory entries are sorted by code unit before descending, so the file
 * order — and therefore every array derived from it — is identical on every
 * machine.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Lang, SkipCount, UnreadableCount } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import type { IgnoreLayer } from './ignore.js';
import { isIgnored, layerFromPatterns, parseIgnoreFile } from './ignore.js';

/**
 * Extensions we parse for imports.
 *
 * **A row here is about the file, not about the node.** Go is scanned per file
 * and mapped per *package* — `build.ts` groups a directory's `.go` files into
 * one node — so "scanned" continues to mean exactly what it says: the walk
 * reads this file and something parses it. What the file becomes afterwards is
 * not this table's business, which is why adding Go needed no change to the
 * disjointness rule `UNREAD` is held to (ADR-0025 decision 6).
 */
export const SCANNED: ReadonlyMap<string, Lang> = new Map([
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
  ['.mts', 'ts'],
  ['.cts', 'ts'],
  ['.js', 'js'],
  ['.jsx', 'jsx'],
  ['.mjs', 'mjs'],
  ['.cjs', 'cjs'],
  ['.go', 'go'],
  // Python. `.pyi` is a stub and `.pyw` a Windows entry point; both are real
  // repo content with real history, and both are parsed by the same scanner —
  // a stub's imports are its module's imports. `pyroot.ts` resolves a module
  // name to at most one of them, in Python's own finder order.
  ['.py', 'py'],
  ['.pyi', 'py'],
  ['.pyw', 'py'],
]);

/** Extensions we map but do not parse — they are still part of the terrain. */
export const CARRIED: ReadonlyMap<string, Lang> = new Map([
  ['.json', 'json'],
  ['.jsonc', 'json'],
  ['.md', 'md'],
]);

/**
 * The third of the trio: **program source we recognise and cannot read.**
 *
 * Scanned files get an import graph, carried files get terrain, and these get a
 * *count* — nothing else. They are not indexed, not on the map, and not in any
 * answer key. The count exists because `skipped`'s `unsupported` tally cannot
 * tell a PNG from a Go file, and that difference decides whether a deck is about
 * the repository or about its documentation (ADR-0025).
 *
 * **The list is program source and nothing else.** Markup and prose are out —
 * `.html`, `.rst`, `.css`, `.txt` — and deliberately so: counting them would put
 * a book with an HTML build directory over the bar and refuse a deck that is
 * honestly about its Markdown. Data and config are out for the same reason.
 *
 * **Ambiguous extensions are out rather than guessed at.** `.m` is Objective-C
 * or MATLAB, `.pl` is Perl or Prolog, `.v` is Verilog or Coq or V, `.d` is D or
 * a Make dependency file. The cost of omitting one is an undercount; the cost of
 * including one is printing a false language name at the player, and this whole
 * mechanism exists to stop ark claiming things it has not checked.
 *
 * Adding a language to `SCANNED` means deleting its row here in the same commit.
 */
export const UNREAD: ReadonlyMap<string, string> = new Map([
  // `.go` was here until M5. Decision 6 of ADR-0025 makes that deletion part of
  // the same commit that adds the language to `SCANNED`, and a unit test
  // asserts the two tables are disjoint — an extension in both would be indexed
  // *and* counted as missing, which is the one thing this trio must never do.
  // `.py`, `.pyi` and `.pyw` were here until M5's Python half, and left in the
  // same commit that added them to `SCANNED` — decision 6 of ADR-0025, and the
  // disjointness unit test is what makes forgetting it a red suite rather than
  // a repo counted as both mapped and missing.
  ['.rb', 'Ruby'],
  ['.rake', 'Ruby'],
  ['.rs', 'Rust'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.kts', 'Kotlin'],
  ['.scala', 'Scala'],
  ['.swift', 'Swift'],
  ['.mm', 'Objective-C++'],
  ['.c', 'C'],
  ['.h', 'C'],
  ['.cc', 'C++'],
  ['.cpp', 'C++'],
  ['.cxx', 'C++'],
  ['.hh', 'C++'],
  ['.hpp', 'C++'],
  ['.hxx', 'C++'],
  ['.cs', 'C#'],
  ['.php', 'PHP'],
  ['.pm', 'Perl'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
  ['.erl', 'Erlang'],
  ['.hrl', 'Erlang'],
  ['.hs', 'Haskell'],
  ['.lua', 'Lua'],
  ['.dart', 'Dart'],
  ['.jl', 'Julia'],
  ['.clj', 'Clojure'],
  ['.cljc', 'Clojure'],
  ['.cljs', 'Clojure'],
  ['.fs', 'F#'],
  ['.fsi', 'F#'],
  ['.fsx', 'F#'],
  ['.ml', 'OCaml'],
  ['.mli', 'OCaml'],
  ['.nim', 'Nim'],
  ['.zig', 'Zig'],
  ['.cr', 'Crystal'],
  ['.elm', 'Elm'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.astro', 'Astro'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.zsh', 'Shell'],
  ['.ps1', 'PowerShell'],
  ['.groovy', 'Groovy'],
  ['.r', 'R'],
  ['.tcl', 'Tcl'],
  ['.vb', 'Visual Basic'],
  ['.pas', 'Pascal'],
  ['.f90', 'Fortran'],
  ['.f95', 'Fortran'],
  ['.f03', 'Fortran'],
  ['.gleam', 'Gleam'],
  ['.rkt', 'Racket'],
  ['.scm', 'Scheme'],
  ['.sol', 'Solidity'],
  ['.hx', 'Haxe'],
  // **Added after shipping, because a Terraform module repo reproduced the
  // exact defect this table exists to stop**: 77 `.tf` files invisible, 64
  // challenges about 24 Markdown files, and `unreadable` empty — so every
  // surface ADR-0025 added was silent. None of these is ambiguous and none was
  // excluded by a decision; they were simply missing, which is the failure mode
  // a list has and a rule does not (ADR-0025 §9).
  ['.tf', 'Terraform'],
  ['.tfvars', 'Terraform'],
  ['.el', 'Emacs Lisp'],
  ['.nix', 'Nix'],
  ['.vim', 'Vim script'],
  ['.proto', 'Protocol Buffers'],
  // The conventional upper-case spellings, as their own rows. There used to be
  // a `toLowerCase()` on the lookup instead, and it printed a **wrong language
  // name**: `.C` is C++ by convention and folded to `C`. An undercount is the
  // safe direction; a false claim about the reader's own repo is the one this
  // whole mechanism exists to avoid.
  ['.R', 'R'],
]);

/**
 * Excluded even when the repo has no `.gitignore` saying so. A repo that
 * vendors its dependencies is not a repo whose architecture you want to learn
 * by reading `node_modules`.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  'vendor/',
  // Lockfiles are generated, not authored. A 2,000-line dependency lock is the
  // largest node on the map and teaches nothing about the codebase's structure
  // (pillar 3: coupling, not trivia). This is a rule about a kind of file, not
  // about any one project.
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
];

export interface WalkOptions {
  readonly root: string;
  /** Files above this are skipped as generated or vendored. */
  readonly maxFileBytes: number;
  /** Extra ignore patterns, applied at the repo root. */
  readonly excludes: readonly string[];
}

export const DEFAULT_WALK_OPTIONS: Omit<WalkOptions, 'root'> = {
  maxFileBytes: 512 * 1024,
  excludes: DEFAULT_EXCLUDES,
};

export interface WalkedFile {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly lang: Lang;
  readonly bytes: number;
  readonly loc: number;
  /** Present only for languages we parse. */
  readonly source: string | null;
}

/** A file we meant to parse and did not. See `WalkResult.dropped`. */
export interface DroppedFile {
  readonly path: string;
  readonly lang: Lang;
}

export interface WalkResult {
  /** Sorted by path. */
  readonly files: readonly WalkedFile[];
  /**
   * Every non-ignored, non-symlink file the walk saw — including the ones it
   * did not index. Resolution needs this to tell "this import points at an
   * asset that cannot import anything back" from "we have no idea".
   */
  readonly onDisk: ReadonlySet<string>;
  /** Sorted by reason. */
  readonly skipped: readonly SkipCount[];
  /**
   * Program source we recognised and did not read, by language. Sorted by
   * language. Every file counted here is also counted in `skipped` as
   * `unsupported` — this is a refinement of that number, not a second bucket.
   */
  readonly unreadable: readonly UnreadableCount[];
  /**
   * Paths of files we **meant** to parse and could not — a `SCANNED` extension
   * dropped for size or for a NUL byte. Sorted.
   *
   * These are counted in `skipped` like anything else, and they are *not* in
   * `unreadable`, because `unreadable` is a refinement of `unsupported` and
   * these are `tooLarge` or `binary`. So without this list they are invisible
   * on both sides of ADR-0025's ratio — which was harmless while every node was
   * a file (nothing can depend on a node that does not exist) and became a
   * **missing edge** the moment a node stood for a directory: a Go package
   * whose 600 KiB generated `.pb.go` was dropped keeps its node, loses that
   * file's imports, and is then certified a non-dependent of whatever they
   * named. `build.ts` marks the owning node `unresolved` so guardrail 4 can
   * refuse rather than guess. ADR-0025 §9.3 predicted this exact direction.
   *
   * Carries the language because the grouping rule is per language and a
   * dropped file is, by definition, not in `files` for anyone to look it up in.
   */
  readonly dropped: readonly DroppedFile[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

/** Physical lines. An empty file has 0; a file with no trailing newline still counts its last line. */
export function countLines(source: string): number {
  if (source.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lines++;
  return source.endsWith('\n') ? lines : lines + 1;
}

function looksBinary(source: string): boolean {
  const window = Math.min(source.length, 8192);
  for (let i = 0; i < window; i++) if (source.charCodeAt(i) === 0) return true;
  return false;
}

export async function walk(options: WalkOptions): Promise<WalkResult> {
  const files: WalkedFile[] = [];
  const onDisk = new Set<string>();
  const skips = new Map<SkipCount['reason'], number>();
  const unread = new Map<string, number>();
  const dropped: DroppedFile[] = [];
/** One prefetched file, or the error that reading it produced. */
interface Prefetched {
  readonly size: number;
  /** `null` when the file is over the size cap and was deliberately not read. */
  readonly source: string | null;
  readonly failure: unknown;
}

/**
 * How many files to stat and read at once.
 *
 * Bounded rather than `Promise.all` over a whole directory: a repo with a
 * thousand files in one folder would open a thousand descriptors and hit
 * `EMFILE`. 32 is enough to cover the latency of a single read many times over
 * and is far below any default limit.
 */
const READ_CONCURRENCY = 32;

/** Run `task` over `items` with at most `limit` in flight. Order-free. */
async function inBatches<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(
      (async () => {
        for (;;) {
          const at = next++;
          const item = items[at];
          if (item === undefined) return;
          await task(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

  const note = (reason: SkipCount['reason']): void => {
    skips.set(reason, (skips.get(reason) ?? 0) + 1);
  };

  const rootLayers: IgnoreLayer[] = [layerFromPatterns(options.excludes)];
  await descend('', rootLayers);

  files.sort((a, b) => byteCompare(a.path, b.path));
  const skipped = [...skips.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => byteCompare(a.reason, b.reason));
  const unreadable = [...unread.entries()]
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => byteCompare(a.lang, b.lang));
  dropped.sort((a, b) => byteCompare(a.path, b.path));
  return { files, onDisk, skipped, unreadable, dropped };

  async function descend(relativeDir: string, inherited: readonly IgnoreLayer[]): Promise<void> {
    const absoluteDir = relativeDir === '' ? options.root : join(options.root, relativeDir);

    let layers = inherited;
    const localIgnore = await readIfPresent(join(absoluteDir, '.gitignore'));
    if (localIgnore !== null) {
      layers = [...inherited, parseIgnoreFile(relativeDir, localIgnore)];
    }

    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => byteCompare(a.name, b.name));

    // **Prefetch this directory's file contents concurrently. Nothing here
    // mutates anything.**
    //
    // The loop below was `await stat` then `await readFile` per file, one after
    // another — about 6,000 sequential round trips on django, which showed up as
    // **22% of a 16 s index sitting idle** in a CPU profile with git accounting
    // for only ~300 ms of it. Overlapping the I/O is the whole change.
    //
    // It is a *cache*, not a rewrite: the sequential loop keeps its exact shape
    // and its exact order, so `onDisk`'s insertion order, `skipped`'s counts,
    // `dropped` and `files` are all built in the same sequence as before. That
    // matters beyond tidiness — `build.ts` passes `[...walked.onDisk]` to
    // `loadGoModules` **unsorted**, so the set's insertion order is observable.
    //
    // An error is captured and rethrown at the point the sequential loop reaches
    // it, so the file that fails an index is still the first one in path order
    // rather than whichever lost the race.
    const prefetch = new Map<string, Prefetched>();
    const pending: { path: string; absolute: string }[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      const path = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (isIgnored(layers, path, false)) continue;
      const extension = extensionOf(entry.name);
      if (!SCANNED.has(extension) && !CARRIED.has(extension)) continue;
      pending.push({ path, absolute: join(options.root, path) });
    }
    await inBatches(pending, READ_CONCURRENCY, async ({ path, absolute }) => {
      try {
        const info = await stat(absolute);
        // A file over the cap is never read, exactly as before — the point of
        // the size check is not to pull a 20 MB bundle into memory.
        const source =
          info.size > options.maxFileBytes ? null : await readFile(absolute, 'utf8');
        prefetch.set(path, { size: info.size, source, failure: null });
      } catch (failure) {
        prefetch.set(path, { size: 0, source: null, failure });
      }
    });

    for (const entry of entries) {
      const path = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

      // A symlink is never followed. A loop would hang the walk, and a symlink
      // out of the repo would index files that are not part of it.
      if (entry.isSymbolicLink()) {
        note('symlink');
        continue;
      }

      if (entry.isDirectory()) {
        if (isIgnored(layers, path, true)) {
          note('ignored');
          continue;
        }
        await descend(path, layers);
        continue;
      }

      if (!entry.isFile()) continue;

      if (isIgnored(layers, path, false)) {
        note('ignored');
        continue;
      }

      onDisk.add(path);

      const extension = extensionOf(entry.name);
      const scanned = SCANNED.get(extension);
      const carried = CARRIED.get(extension);
      if (scanned === undefined && carried === undefined) {
        note('unsupported');
        // Exact case, like `SCANNED` and `CARRIED`. A `toLowerCase()` here
        // looked like a kindness and printed `.C` — C++ by convention — as
        // **C**; the upper-case spellings worth having are rows of their own.
        const language = UNREAD.get(extension);
        if (language !== undefined) unread.set(language, (unread.get(language) ?? 0) + 1);
        continue;
      }

      // Prefetched above. The `??` arm is unreachable for anything this loop
      // asks about — the prefetch is driven by the same three predicates — and
      // is a fall-back to the original I/O rather than a throw, so a future
      // divergence between the two filters degrades to *slow* instead of
      // *wrong*.
      const absolute = join(options.root, path);
      const cached = prefetch.get(path);
      if (cached?.failure != null) throw cached.failure;
      const size = cached === undefined ? (await stat(absolute)).size : cached.size;
      if (size > options.maxFileBytes) {
        note('tooLarge');
        // A file we would have parsed. Recorded so whoever owns it can say so.
        if (scanned !== undefined) dropped.push({ path, lang: scanned });
        continue;
      }

      const source = cached?.source ?? (await readFile(absolute, 'utf8'));
      if (looksBinary(source)) {
        note('binary');
        if (scanned !== undefined) dropped.push({ path, lang: scanned });
        continue;
      }

      files.push({
        path,
        lang: scanned ?? carried ?? 'other',
        bytes: size,
        loc: countLines(source),
        source: scanned === undefined ? null : source,
      });
    }
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
