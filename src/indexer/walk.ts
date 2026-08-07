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

import type { Lang, SkipCount } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import type { IgnoreLayer } from './ignore.js';
import { isIgnored, layerFromPatterns, parseIgnoreFile } from './ignore.js';

/** Extensions we parse for imports. */
const SCANNED: ReadonlyMap<string, Lang> = new Map([
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
  ['.mts', 'ts'],
  ['.cts', 'ts'],
  ['.js', 'js'],
  ['.jsx', 'jsx'],
  ['.mjs', 'mjs'],
  ['.cjs', 'cjs'],
]);

/** Extensions we map but do not parse — they are still part of the terrain. */
const CARRIED: ReadonlyMap<string, Lang> = new Map([
  ['.json', 'json'],
  ['.jsonc', 'json'],
  ['.md', 'md'],
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
  const note = (reason: SkipCount['reason']): void => {
    skips.set(reason, (skips.get(reason) ?? 0) + 1);
  };

  const rootLayers: IgnoreLayer[] = [layerFromPatterns(options.excludes)];
  await descend('', rootLayers);

  files.sort((a, b) => byteCompare(a.path, b.path));
  const skipped = [...skips.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => byteCompare(a.reason, b.reason));
  return { files, onDisk, skipped };

  async function descend(relativeDir: string, inherited: readonly IgnoreLayer[]): Promise<void> {
    const absoluteDir = relativeDir === '' ? options.root : join(options.root, relativeDir);

    let layers = inherited;
    const localIgnore = await readIfPresent(join(absoluteDir, '.gitignore'));
    if (localIgnore !== null) {
      layers = [...inherited, parseIgnoreFile(relativeDir, localIgnore)];
    }

    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => byteCompare(a.name, b.name));

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
        continue;
      }

      const absolute = join(options.root, path);
      const info = await stat(absolute);
      if (info.size > options.maxFileBytes) {
        note('tooLarge');
        continue;
      }

      const source = await readFile(absolute, 'utf8');
      if (looksBinary(source)) {
        note('binary');
        continue;
      }

      files.push({
        path,
        lang: scanned ?? carried ?? 'other',
        bytes: info.size,
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
