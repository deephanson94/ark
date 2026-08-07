/**
 * Comment and string masking.
 *
 * The import scanner works on a masked copy of the source in which comments
 * have become spaces and string contents have become NUL padding, with the
 * original literal values kept in a side table. Everything is length-preserving,
 * so offsets into the masked text still address the real source.
 *
 * This is not paranoia. `tests/unit/scan.test.ts` is full of strings that
 * contain `import x from 'y'`, and without masking the indexer would read its
 * own test fixtures as imports of modules that do not exist — which would show
 * up as unresolved imports, which would (correctly, and uselessly) disqualify
 * half the repo from carrying a challenge under guardrail 4.
 *
 * The walker rejects any file containing a NUL byte as binary, so NUL is
 * guaranteed not to occur in real source and cannot be confused with padding.
 */

const PAD = '\u0000';

export interface MaskedSource {
  /** Same length as the input. Comments blanked, literal contents NUL-filled. */
  readonly masked: string;
  /** Offset of a literal's first content character → its decoded value. */
  readonly literals: ReadonlyMap<number, string>;
}

/** Keywords after which a `/` begins a regular expression, not a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
};

function isIdentifierChar(char: string): boolean {
  return /[\w$]/.test(char);
}

/**
 * Decide whether the `/` at `index` opens a regex literal, by looking back at
 * the last significant character. Ambiguous in general — it needs a real parse.
 *
 * Two ways it can be wrong, both narrow:
 *
 *  - A regex read as code leaks its body into the token stream. Usually
 *    harmless, but not *incapable* of harm: a regex whose body happens to
 *    contain `from './x'` would scan as an import. That needs a regex sitting
 *    where a division would go, which real code essentially never has.
 *  - A division read as a regex (`return width / height`) swallows to the end
 *    of the line. That loses code and can never invent an import, so it fails
 *    in the safe direction.
 */
function startsRegex(source: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i] ?? '')) i--;
  if (i < 0) return true;
  const previous = source[i] ?? '';
  if (previous === ')' || previous === ']' || previous === '}') return false;
  if (previous === '"' || previous === "'" || previous === '`') return false;
  if (isIdentifierChar(previous)) {
    let start = i;
    while (start >= 0 && isIdentifierChar(source[start] ?? '')) start--;
    return REGEX_PRECEDING_KEYWORDS.has(source.slice(start + 1, i + 1));
  }
  return true;
}

/** Replace a run with `filler`, keeping newlines so line numbers survive. */
function blank(original: string, filler: string): string {
  let out = '';
  for (const char of original) out += char === '\n' ? '\n' : filler;
  return out;
}

interface Quoted {
  /** Offset just past the closing quote (or end of input if unterminated). */
  readonly end: number;
  /** Offset just past the last content character. */
  readonly contentEnd: number;
  /** Decoded value, or null when the literal is not statically known. */
  readonly value: string | null;
  readonly terminated: boolean;
}

function readQuoted(source: string, start: number): Quoted {
  const quote = source[start] ?? '';
  let value = '';
  let dynamic = false;
  let i = start + 1;

  while (i < source.length) {
    const char = source[i] ?? '';

    if (char === '\\') {
      const escaped = source[i + 1] ?? '';
      value += SIMPLE_ESCAPES[escaped] ?? escaped;
      i += 2;
      continue;
    }

    if (char === quote) {
      return { end: i + 1, contentEnd: i, value: dynamic ? null : value, terminated: true };
    }

    if (quote === '`' && char === '$' && source[i + 1] === '{') {
      dynamic = true;
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i] ?? '';
        if (inner === '{') depth++;
        else if (inner === '}') depth--;
        i++;
      }
      continue;
    }

    if (quote !== '`' && char === '\n') {
      // Unterminated string. Stop at the newline rather than swallow the file.
      return { end: i, contentEnd: i, value: null, terminated: false };
    }

    value += char;
    i++;
  }

  return { end: source.length, contentEnd: source.length, value: null, terminated: false };
}

export function maskSource(source: string): MaskedSource {
  let masked = '';
  const literals = new Map<number, string>();
  let i = 0;

  while (i < source.length) {
    const char = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (char === '/' && next === '/') {
      const found = source.indexOf('\n', i);
      const stop = found === -1 ? source.length : found;
      masked += blank(source.slice(i, stop), ' ');
      i = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const found = source.indexOf('*/', i + 2);
      const stop = found === -1 ? source.length : found + 2;
      masked += blank(source.slice(i, stop), ' ');
      i = stop;
      continue;
    }

    if (char === '/' && startsRegex(source, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j] ?? '';
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      const stop = Math.min(j + 1, source.length);
      masked += blank(source.slice(i, stop), ' ');
      i = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quoted = readQuoted(source, i);
      const contentStart = i + 1;
      masked += char;
      masked += blank(source.slice(contentStart, quoted.contentEnd), PAD);
      if (quoted.terminated) masked += char;
      else masked += blank(source.slice(quoted.contentEnd, quoted.end), ' ');
      if (quoted.value !== null) literals.set(contentStart, quoted.value);
      i = quoted.end;
      continue;
    }

    masked += char;
    i++;
  }

  return { masked, literals };
}

