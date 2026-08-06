/**
 * A `.gitignore` matcher.
 *
 * Written by hand rather than pulled from npm because the indexer's dependency
 * budget is "as close to zero as the job allows", and because the semantics we
 * need are a well-defined subset. Supported: comments, blank lines, `!`
 * negation, trailing `/` for directory-only, leading or interior `/` for
 * anchoring, `*`, `?`, `[…]` character classes, and `**`.
 *
 * Not supported: `\` escapes of `#`, `!` and trailing spaces. If a repo needs
 * those, the file is over-ignored rather than under-ignored, which fails safe.
 *
 * Precedence follows git: later rules beat earlier ones, and rules from a
 * deeper `.gitignore` beat rules from a shallower one. The walker never
 * descends into an ignored directory, which is also what git does — so a
 * negation inside an ignored directory does not resurrect anything.
 */

import { byteCompare } from '../atlas/index.js';

interface Rule {
  readonly matcher: RegExp;
  readonly negated: boolean;
  readonly dirOnly: boolean;
}

export interface IgnoreLayer {
  /** Repo-relative POSIX directory the rules are anchored to. `''` for the root. */
  readonly base: string;
  readonly rules: readonly Rule[];
}

/** Directories no walk should ever enter, whatever `.gitignore` says. */
export const ALWAYS_EXCLUDED: readonly string[] = ['.git'];

function escapeLiteral(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

function compile(pattern: string, anchored: boolean): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === undefined) break;

    if (char === '*') {
      const doubled = pattern[i + 1] === '*';
      if (doubled) {
        const trailingSlash = pattern[i + 2] === '/';
        if (trailingSlash) {
          // `**/` — zero or more directories.
          source += '(?:[^/]+/)*';
          i += 2;
        } else if (i + 2 >= pattern.length) {
          // trailing `**` — anything, including separators.
          source += '.*';
          i += 1;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      source += `[${body}]`;
      i = close;
      continue;
    }

    source += escapeLiteral(char);
  }

  const prefix = anchored ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${source}$`);
}

function parseLine(line: string): Rule | null {
  let pattern = line.replace(/\s+$/, '');
  if (pattern.length === 0 || pattern.startsWith('#')) return null;

  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);

  const dirOnly = pattern.endsWith('/');
  if (dirOnly) pattern = pattern.slice(0, -1);
  if (pattern.length === 0) return null;

  // A `/` anywhere but the end anchors the pattern to the .gitignore's dir.
  const anchored = pattern.includes('/');
  if (pattern.startsWith('/')) pattern = pattern.slice(1);

  return { matcher: compile(pattern, anchored), negated, dirOnly };
}

export function parseIgnoreFile(base: string, contents: string): IgnoreLayer {
  const rules: Rule[] = [];
  for (const line of contents.split('\n')) {
    const rule = parseLine(line.replace(/\r$/, ''));
    if (rule !== null) rules.push(rule);
  }
  return { base, rules };
}

/** Rules from a list of patterns, anchored at the repo root. */
export function layerFromPatterns(patterns: readonly string[]): IgnoreLayer {
  return parseIgnoreFile('', patterns.join('\n'));
}

/**
 * Decide whether a repo-relative POSIX path is ignored.
 *
 * `layers` must be ordered shallowest first — the walker builds it that way as
 * it descends, so the deepest `.gitignore` is consulted last and wins.
 */
export function isIgnored(
  layers: readonly IgnoreLayer[],
  path: string,
  isDirectory: boolean,
): boolean {
  const first = path.split('/')[0];
  if (first !== undefined && ALWAYS_EXCLUDED.includes(first)) return true;

  let ignored = false;
  for (const layer of layers) {
    const relative = relativeTo(layer.base, path);
    if (relative === null) continue;
    for (const rule of layer.rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.matcher.test(relative)) ignored = !rule.negated;
    }
  }
  return ignored;
}

function relativeTo(base: string, path: string): string | null {
  if (base === '') return path;
  if (!path.startsWith(`${base}/`)) return null;
  return path.slice(base.length + 1);
}

/** Stable order for directory entries. Never `localeCompare` (see order.ts). */
export function compareEntries(a: string, b: string): number {
  return byteCompare(a, b);
}
