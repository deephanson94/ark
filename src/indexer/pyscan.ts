/**
 * The Python scanner.
 *
 * Pure, exactly like `scan.ts` and `goscan.ts`: source text in, facts out. No
 * filesystem, no resolution — `pyroot.ts` does that.
 *
 * **Why this is hand-rolled and not tree-sitter.** ADR-0026 decision 1 refuses
 * tree-sitter for a language *where it was measured to buy nothing*, and asks
 * the next language to be scored the same way rather than inheriting the
 * verdict. Python was the language most likely to flip it — `from . import x`,
 * `from ..pkg import y`, parenthesised import lists, `\` continuations, and no
 * *imports come first* rule to bound the scan. It did not flip: the numbers and
 * the disagreements are in ADR-0028 §1.
 *
 * It is **wider** than the Go scanner in the two ways ADR-0026 §1.1 said made Go
 * easy, and both cost something here:
 *
 *  1. **A Python import is not always a string literal, and not always an import
 *     statement.** `importlib.import_module(expr)` and `__import__(expr)` name a
 *     module with an expression, so this scanner has the `null` arm `GoImportRef`
 *     does not — and it is the arm ADR-0024 §4.1 found poisoning 83.7% of
 *     django's Blast Radius subjects — from **79 call sites**, of which 49 are
 *     computed; the *seven* that figure was first taken from were the ones a
 *     prefixed-only regex could see (ADR-0028 §8.1). That is why Python is
 *     a *history* language (ADR-0024 decision 2): the arm exists, it is
 *     recorded, and guardrail 4 acts on it.
 *  2. **Masking Python needs the prefix and the triple quote.** `rb'''…'''` is
 *     one literal and `f"{x}"` is another; `#` inside either is not a comment.
 *     There is no regex-versus-division ambiguity — Python has no regex literal
 *     — so the residual guesswork is smaller than JavaScript's and larger than
 *     Go's.
 *
 * The keyword `from` is the shape neither other language has: `raise X from Y`
 * and `yield from g` are not imports, so a bare `\bfrom\b` search is wrong. Both
 * are refused by requiring statement position, which is what the logical-line
 * split below is for.
 */

import { sortedUnique } from '../atlas/index.js';

export interface PyImportRef {
  /**
   * Leading dots. `0` is absolute, `1` is `from . import x`, `2` is `from ..`.
   *
   * A computed site (`module === null`) is always level 0 — there is no
   * relative form of `import_module`.
   */
  readonly level: number;
  /**
   * The dotted module path, or `null` when the module is named by an expression
   * we cannot evaluate.
   *
   * `''` is a real value and is not `null`: `from . import x` names the current
   * package with no path after it.
   */
  readonly module: string | null;
  /**
   * The names in a `from X import a, b`, sorted and deduped. Empty for a plain
   * `import X`; `['*']` for a star import.
   *
   * Kept because `from X import y` may name a **submodule** rather than an
   * attribute, and on a package that is the dependency — `from . import cli` is
   * how a Python package re-exports, and resolving it to the package's
   * `__init__.py` alone would miss the file the statement is actually about.
   */
  readonly names: readonly string[];
  /** Character offset in the original source. Gives imports a stable order. */
  readonly at: number;
  /** What was written, for `unresolved` to report when we cannot place it. */
  readonly raw: string;
}

export interface PyFacts {
  /** In source order. */
  readonly imports: readonly PyImportRef[];
  /**
   * Public top-level names: `def`/`class`/assignment at column 0, minus the
   * underscore-prefixed ones.
   *
   * Python has no visibility keyword, so the convention *is* the rule — the
   * same shape as Go's initial capital, and read the same way: off column 0, so
   * a name inside a function body is never reached.
   */
  readonly exports: readonly string[];
}

/**
 * Blank out comments and string literals, preserving offsets and newlines.
 *
 * Newlines survive because the logical-line split below reads them, and column
 * 0 is what makes the export scan a test for *top level*.
 *
 * **An unterminated triple-quoted string runs to end of file**, which is what
 * Python does too. An unterminated single-quoted string ends at the newline,
 * which is a syntax error in Python; the cost is a lost export rather than a
 * phantom import, the same trade `goscan.ts` makes.
 */
function maskPython(source: string): string {
  const out = new Array<string>(source.length);
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === '#') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (char === '"' || char === "'") {
      i = maskLiteral(source, out, i, i);
      continue;
    }
    // A string prefix — `r`, `b`, `u`, `f`, `rb`, `fr`, … — in any case, and
    // only when it is not part of a longer identifier. `x = f'…'` is a string;
    // `if'` cannot occur, but `deff'…'` must not be read as one.
    if (isPrefixChar(char)) {
      let j = i;
      while (j < source.length && isPrefixChar(source[j] ?? '') && j - i < 2) j++;
      const quote = source[j] ?? '';
      if ((quote === '"' || quote === "'") && !isIdentifierChar(source[i - 1] ?? ' ')) {
        for (let k = i; k < j; k++) out[k] = ' ';
        i = maskLiteral(source, out, j, i);
        continue;
      }
    }
    // An **explicit line continuation**, blanked here rather than in the
    // statement splitter so that one rule serves both readers. A `\` at the end
    // of a line joins it to the next, so the newline must not survive — a
    // splitter that sees it ends the statement early and reads
    // `from pkg import \` as an import of nothing. Offsets are preserved
    // because two characters become two spaces.
    if (char === '\\' && (source[i + 1] === '\n' || (source[i + 1] === '\r' && source[i + 2] === '\n'))) {
      const width = source[i + 1] === '\n' ? 2 : 3;
      for (let k = 0; k < width; k++) out[i + k] = ' ';
      i += width;
      continue;
    }
    out[i] = char;
    i++;
  }
  return out.join('');
}

function isPrefixChar(char: string): boolean {
  return 'rbufRBUF'.includes(char) && char !== '';
}

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/**
 * Blank a literal opening at `quoteAt`, returning the offset just past it.
 *
 * `startedAt` is where the prefix began, so a raw string can be told from an
 * ordinary one — in a raw string a backslash is not an escape, but it **still**
 * stops the next character ending the literal, which is why the skip is two
 * characters in both cases and the distinction does not appear here at all.
 */
function maskLiteral(source: string, out: string[], quoteAt: number, startedAt: number): number {
  const quote = source[quoteAt] ?? '';
  const triple = source[quoteAt + 1] === quote && source[quoteAt + 2] === quote;
  const closer = triple ? quote.repeat(3) : quote;
  let i = quoteAt;
  for (let k = 0; k < closer.length; k++) out[i + k] = ' ';
  i += closer.length;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === '\\') {
      out[i] = ' ';
      if (i + 1 < source.length) out[i + 1] = source[i + 1] === '\n' ? '\n' : ' ';
      i += 2;
      continue;
    }
    if (!triple && char === '\n') break;
    if (char === quote && (!triple || (source[i + 1] === quote && source[i + 2] === quote))) {
      for (let k = 0; k < closer.length && i + k < source.length; k++) out[i + k] = ' ';
      i += closer.length;
      return i;
    }
    out[i] = char === '\n' ? '\n' : ' ';
    i++;
  }
  void startedAt;
  return i;
}

/** One statement of the masked text, with the offset it started at. */
interface Statement {
  readonly text: string;
  readonly at: number;
  /** Indentation columns before it. 0 is top level. */
  readonly indent: number;
}

/**
 * Split masked source into statements.
 *
 * Two continuations join physical lines into one logical line, and a scanner
 * that handles neither reads `from x import (` as an import of nothing:
 *
 *  - **explicit** — a trailing `\`;
 *  - **implicit** — an unclosed `(`, `[` or `{`, which is how every long
 *    `from x import (a, b, c)` in a real repo is written.
 *
 * `;` separates statements on one line, so `import os; import sys` is two.
 */
function statementsOf(masked: string): Statement[] {
  const statements: Statement[] = [];
  let depth = 0;
  let start = 0;
  let indent = 0;
  let atLineStart = true;
  let seenNonSpace = false;

  const flush = (end: number): void => {
    const text = masked.slice(start, end);
    if (text.trim().length > 0) statements.push({ text, at: start, indent });
    start = end + 1;
    seenNonSpace = false;
  };

  for (let i = 0; i < masked.length; i++) {
    const char = masked[i] ?? '';
    if (atLineStart && !seenNonSpace) {
      if (char === ' ' || char === '\t') {
        indent++;
        continue;
      }
      if (char !== '\n') {
        seenNonSpace = true;
        start = i;
        atLineStart = false;
      }
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) {
      flush(i);
      // The next statement on this line keeps the line's indent.
      atLineStart = false;
      continue;
    } else if (char === '\n') {
      const continued = depth > 0 || masked[i - 1] === '\\';
      if (!continued) {
        flush(i);
        atLineStart = true;
        indent = 0;
      }
      continue;
    }
  }
  if (start < masked.length) flush(masked.length);
  return statements;
}

/**
 * A Python identifier, and a dotted path of them.
 *
 * `\w` is ASCII-only in JavaScript even under `/u`, and Python identifiers are
 * not: django's `tests/admin_views/test_nav_sidebar.py` imports a model called
 * `Héllo`, which an ASCII rule drops from the name list in silence. That was
 * **the only file of 3,011 where this scanner disagreed with Python's own
 * `ast`**, and it was found by the comparison rather than by reading.
 * `\p{L}\p{N}` undercounts Python's rule (which also admits `Mn`, `Mc` and
 * `Pc`), which is the safe direction — a name we drop costs an edge we could
 * have drawn, never one we invent.
 */
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const DOTTED = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

/**
 * The three spellings of *"name a module with an expression"*.
 *
 * **The bare one was missing and it is django's house style**: `from importlib
 * import import_module` at the top, then `import_module(name)` everywhere. 71
 * call sites on django against the 7 the prefixed form finds — 31 of them with a
 * *literal* argument, so they were missing **edges** as well as taints. Both of
 * ADR-0024's instruments used the prefixed regex, so the probe and the shipped
 * scanner agreed by sharing one blindness, which is why the site count matched
 * and the arm was still wrong.
 */
const IMPORT_CALL = /\b(importlib\s*\.\s*import_module|import_module|__import__)\s*\(/g;
const STRING_ARGUMENT = /^\s*(['"])((?:[^'"\\]|\\.)*)\1\s*[,)]/;

export function scanPyModule(source: string): PyFacts {
  const masked = maskPython(source);
  const imports: PyImportRef[] = [];
  const exports: string[] = [];

  for (const statement of statementsOf(masked)) {
    const trimmed = statement.text.trim();
    const offset = statement.at + statement.text.indexOf(trimmed[0] ?? '');
    // `if True: import os` is one statement carrying another. Only the compound
    // *keywords* open one, which is what keeps this off `x: int = 1` — a colon
    // at depth 0 is an annotation far more often than a suite header, and
    // splitting on it blindly would read `int = 1` as an export named `int`.
    const suite = /^(?:if|elif|else|try|except|finally|for|while|with|def|class|async)\b[^:]*:[ \t]*(\S.*)$/.exec(trimmed);
    const head = suite?.[1] ?? trimmed;
    if (head.startsWith('import ') || head === 'import') {
      pushPlainImports(imports, head, offset);
    } else if (head.startsWith('from ') || head.startsWith('from.')) {
      pushFromImport(imports, head, offset);
    }
    if (statement.indent === 0) pushExports(exports, trimmed);
  }

  // `importlib.import_module(...)` and `__import__(...)`, wherever they sit.
  // A literal argument is an ordinary absolute specifier; anything else is the
  // `null` arm — **recorded, never dropped**, because a file that hides a
  // dependency and still looks fully resolved is the one thing guardrail 4
  // cannot survive (CLAUDE.md).
  // The **bare** spelling is only `importlib`'s if this file imported it. A
  // locally-defined `import_module()` is somebody else's function, and calling
  // it an unresolved import would be inventing a dependency — the direction
  // ADR-0003 exists to refuse. One site of django's 71 fails this test.
  // (`from importlib import import_module as im` then `im(x)` is missed, and
  // that is the same undercount every alias in this file takes.)
  const importsImportModule = imports.some(
    (reference) => reference.module === 'importlib' && reference.names.includes('import_module'),
  );

  IMPORT_CALL.lastIndex = 0;
  let call: RegExpExecArray | null;
  while ((call = IMPORT_CALL.exec(masked)) !== null) {
    if (call[1] === 'import_module' && !importsImportModule) continue;
    const after = call.index + call[0].length;
    // The masked text has no string bodies left, so a literal argument has to
    // be read out of the **source**. Its extent is the same in both, because
    // masking preserves offsets.
    const literal = STRING_ARGUMENT.exec(source.slice(after, after + 512));
    const raw = source.slice(call.index, Math.min(source.length, after + 40)).split('\n')[0] ?? '';
    imports.push({
      level: 0,
      module: literal?.[2] !== undefined && literal[2].length > 0 ? literal[2] : null,
      names: [],
      at: call.index,
      raw: raw.trim(),
    });
  }

  imports.sort((a, b) => a.at - b.at);
  return { imports, exports: sortedUnique(exports) };
}

/** `import a.b as x, c` — one ref per comma-separated clause. */
function pushPlainImports(into: PyImportRef[], statement: string, at: number): void {
  // `import a . b` is legal; the spaces are stripped per clause below.
  const body = statement.slice('import'.length);
  for (const clause of body.split(',')) {
    // Collapse the spaces *around dots* first, then take the first token — the
    // other way round, `import a . b` yields `a`, which is a **wrong** target
    // rather than a missing one.
    const name = clause.replace(/\s*\.\s*/g, '.').trim().split(/\s+/)[0] ?? '';
    if (name.length === 0) continue;
    if (!DOTTED.test(name)) continue;
    into.push({ level: 0, module: name, names: [], at, raw: `import ${name}` });
  }
}

/** `from ..a.b import (c as d, e)` — one ref, carrying every name. */
function pushFromImport(into: PyImportRef[], statement: string, at: number): void {
  const rest = statement.slice('from'.length).trimStart();
  let level = 0;
  let i = 0;
  while (rest[i] === '.') {
    level++;
    i++;
    // `from ... import x` is three dots, and so is an ellipsis; only the
    // leading run counts, and Python spells level 3 exactly this way.
  }
  const afterDots = rest.slice(i);
  // `\b` rather than `(\s|$)` after the keyword: `from a.b import(c)` and
  // `from x import*` are both legal Python and both were read as nothing.
  const importAt = afterDots.search(/(^|[\s)])import\b/);
  // Whitespace inside a dotted path is legal too — `from a . b import c` — and
  // `DOTTED` rejects it, which dropped the statement in silence.
  const module = (importAt === -1 ? afterDots : afterDots.slice(0, importAt)).replace(/\s+/g, '');
  if (level === 0 && module.length === 0) return;
  if (module.length > 0 && !DOTTED.test(module)) return;
  const names: string[] = [];
  if (importAt !== -1) {
    const tail = afterDots.slice(importAt).replace(/^\s*import\b/, '');
    for (const clause of tail.replace(/[()]/g, ' ').split(',')) {
      const name = clause.trim().split(/\s+/)[0] ?? '';
      if (name === '*') names.push('*');
      else if (IDENTIFIER.test(name)) names.push(name);
    }
  }
  into.push({
    level,
    module,
    names: sortedUnique(names),
    at,
    raw: `from ${'.'.repeat(level)}${module} import …`,
  });
}

/**
 * Public top-level names, off a column-0 statement.
 *
 * `def f`, `class C`, `X = …`, and `X: T = …`. Underscore-prefixed names are
 * private by Python's only visibility convention, and are dropped — the same
 * undercount-is-safe direction `goscan.ts` takes with its one-name-per-
 * declaration rule.
 */
function pushExports(into: string[], statement: string): void {
  const declared = /^(?:async\s+)?(?:def|class)\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(statement);
  if (declared?.[1] !== undefined) {
    if (!declared[1].startsWith('_')) into.push(declared[1]);
    return;
  }
  const assigned = /^([\p{L}_][\p{L}\p{N}_]*)\s*(?::[^=]+)?=(?!=)/u.exec(statement);
  if (assigned?.[1] !== undefined && !assigned[1].startsWith('_')) into.push(assigned[1]);
}
