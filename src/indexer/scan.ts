/**
 * The ES-module scanner.
 *
 * Pure: source text in, facts out. No filesystem, no resolution — that is
 * `resolve.ts`'s job. Keeping the two apart is what lets the scanner be tested
 * against a string fixture in microseconds.
 *
 * It reads what a module *says*, not what it *means*: no type checking, no
 * build, no language server (pillar 6). The accuracy cost is real and is paid
 * honestly — anything it cannot pin down comes back with a `null` specifier and
 * ends up on the node's `unresolved` list, where guardrail 4 can act on it.
 */

import type { EdgeKind } from '../atlas/index.js';
import { sortedUnique } from '../atlas/index.js';
import { maskSource } from './mask.js';

export interface ImportRef {
  /** The module specifier, or null when it is not statically knowable. */
  readonly specifier: string | null;
  readonly kind: EdgeKind;
  /** Character offset in the original source. Gives imports a stable order. */
  readonly at: number;
  /** Human-readable form, used as the `unresolved` entry when it comes to that. */
  readonly raw: string;
}

export interface ModuleFacts {
  /** In source order. */
  readonly imports: readonly ImportRef[];
  /** Sorted, unique. `default` and `*` appear as themselves. */
  readonly exports: readonly string[];
}

const KEYWORD = /\b(?:import|export|require)\b/g;
const DECLARATION =
  /^(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class|type|interface|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/;

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWhitespace(text[i] ?? '')) i++;
  return i;
}

function isQuote(char: string): boolean {
  return char === '"' || char === "'" || char === '`';
}

/** Reads the word starting at `from`, e.g. `type`, `from`, `default`. */
function readWord(text: string, from: number): string {
  let i = from;
  while (i < text.length && /[\w$*]/.test(text[i] ?? '')) i++;
  return text.slice(from, i);
}

export function scanModule(source: string): ModuleFacts {
  const { masked, literals } = maskSource(source);
  const imports: ImportRef[] = [];
  const exports: string[] = [];

  const literalAt = (quoteIndex: number): string | null => literals.get(quoteIndex + 1) ?? null;

  KEYWORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = KEYWORD.exec(masked)) !== null) {
    const start = match.index;
    const keyword = match[0];
    // `foo.import`, `obj.export` — a property access, not a module keyword.
    if (source[start - 1] === '.') continue;

    if (keyword === 'require') {
      const open = skipSpace(masked, start + keyword.length);
      if (masked[open] !== '(') continue;
      const argument = skipSpace(masked, open + 1);
      // A computed argument is recorded, not skipped. Dropping it would leave
      // the file looking fully resolved while it hides a dependency, which is
      // the one thing guardrail 4 must never allow — and it is exactly what the
      // dynamic-import branch below already gets right.
      const specifier = isQuote(masked[argument] ?? '') ? literalAt(argument) : null;
      imports.push({
        specifier,
        kind: 'require',
        at: start,
        raw: specifier === null ? 'require(<expression>)' : `require('${specifier}')`,
      });
      continue;
    }

    if (keyword === 'import') {
      const after = skipSpace(masked, start + 6);
      const next = masked[after] ?? '';

      if (next === '.') continue; // import.meta

      if (next === '(') {
        const argument = skipSpace(masked, after + 1);
        const specifier = isQuote(masked[argument] ?? '') ? literalAt(argument) : null;
        imports.push({
          specifier,
          kind: 'dynamic',
          at: start,
          raw: specifier === null ? 'import(<expression>)' : `import('${specifier}')`,
        });
        continue;
      }

      if (isQuote(next)) {
        const specifier = literalAt(after);
        imports.push({ specifier, kind: 'import', at: start, raw: bare(specifier) });
        continue;
      }

      const typeOnly = readWord(masked, after) === 'type' && readWord(masked, skipSpace(masked, after + 4)) !== 'from';
      const clause = findFromClause(masked, after);
      if (clause === null) continue;
      const specifier = literalAt(clause);
      imports.push({
        specifier,
        kind: typeOnly ? 'type' : 'import',
        at: start,
        raw: bare(specifier),
      });
      continue;
    }

    // keyword === 'export'
    let after = skipSpace(masked, start + 6);
    // `export type { A } from './x'` and `export type * from './x'` are barrel
    // hops like any other; step over the `type` and handle them identically.
    if (readWord(masked, after) === 'type') {
      const afterType = skipSpace(masked, after + 4);
      const following = masked[afterType] ?? '';
      if (following === '{' || following === '*') after = afterType;
    }
    const next = masked[after] ?? '';

    if (readWord(masked, after) === 'default') {
      exports.push('default');
      continue;
    }

    if (next === '*') {
      const afterStar = skipSpace(masked, after + 1);
      let exported = '*';
      let cursor = afterStar;
      if (readWord(masked, afterStar) === 'as') {
        const aliasStart = skipSpace(masked, afterStar + 2);
        exported = readWord(masked, aliasStart);
        cursor = aliasStart + exported.length;
      }
      exports.push(exported);
      const clause = findFromClause(masked, cursor);
      if (clause !== null) {
        const specifier = literalAt(clause);
        imports.push({ specifier, kind: 'reexport', at: start, raw: bare(specifier) });
      }
      continue;
    }

    if (next === '{') {
      const close = masked.indexOf('}', after);
      if (close === -1) continue;
      for (const name of parseBindings(masked.slice(after + 1, close))) exports.push(name);
      const clause = findFromClause(masked, close + 1);
      if (clause !== null) {
        const specifier = literalAt(clause);
        imports.push({ specifier, kind: 'reexport', at: start, raw: bare(specifier) });
      }
      continue;
    }

    const declared = DECLARATION.exec(masked.slice(after, after + 200));
    if (declared?.[1] !== undefined) exports.push(declared[1]);
  }

  imports.sort((a, b) => a.at - b.at);
  return { imports, exports: sortedUnique(exports) };
}

function bare(specifier: string | null): string {
  return specifier ?? '<computed specifier>';
}

/**
 * From `at`, walk forward past an import/export clause to the string literal
 * after its `from` keyword. Returns the literal's offset, or null.
 *
 * Bounded so a malformed file cannot make the scanner walk the whole source
 * looking for a `from` that is not there.
 */
function findFromClause(masked: string, at: number): number | null {
  const limit = Math.min(masked.length, at + 4000);
  let depth = 0;
  let i = at;
  while (i < limit) {
    const char = masked[i] ?? '';
    if (char === '{' || char === '(' || char === '[') depth++;
    else if (char === '}' || char === ')' || char === ']') depth--;
    else if (char === ';') return null;
    else if (depth === 0 && char === 'f' && masked.startsWith('from', i)) {
      const before = masked[i - 1] ?? ' ';
      const afterWord = masked[i + 4] ?? '';
      if (!/[\w$]/.test(before) && !/[\w$]/.test(afterWord)) {
        const literal = skipSpace(masked, i + 4);
        return isQuote(masked[literal] ?? '') ? literal : null;
      }
    } else if (depth === 0 && isQuote(char)) {
      // A bare `import 'x'` handled elsewhere; a stray literal ends the clause.
      return null;
    }
    i++;
  }
  return null;
}

/** `{ a, b as c, type d, e as default }` → the names this module exports. */
function parseBindings(body: string): string[] {
  const names: string[] = [];
  for (const entry of body.split(',')) {
    let text = entry.trim();
    if (text.length === 0) continue;
    if (text.startsWith('type ')) text = text.slice(5).trim();
    const alias = / as /.exec(text);
    const name = alias === null ? text : text.slice(alias.index + 4).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return names;
}
