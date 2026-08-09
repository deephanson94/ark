/**
 * The Go scanner.
 *
 * Pure, exactly like `scan.ts`: source text in, facts out. No filesystem, no
 * resolution — `gomod.ts` does that.
 *
 * **Why this is hand-rolled and not tree-sitter**, against NORTH-STAR §7.2's
 * *"v2: tree-sitter"*: measured on `gohugoio/hugo` (906 files) and
 * `spf13/cobra` (36), both instruments return **the same 6,013 and 190 import
 * sites** — the same counts ADR-0024 got from Go's own `go/parser` — with
 * **zero** per-file disagreements and zero on seventeen adversarial fixtures.
 * tree-sitter is **6.2× slower** (1,619 ms mean against 261 on hugo, against a
 * 10 s index budget) and would be this project's **first runtime dependency**.
 * §7.2's argument for tree-sitter is *breadth*; for one language it buys
 * nothing that was measurable. ADR-0026 records the number that would flip it.
 *
 * It is narrower than the ES-module scanner in two ways that matter, and both
 * make it safer rather than merely shorter:
 *
 *  1. **A Go import path is always a string literal.** There is no
 *     `import(expr)`, so there is no `null` specifier and no arm where a file
 *     hides a dependency and still looks resolved — the failure ADR-0024 §4.1
 *     found poisoning Python.
 *  2. **Masking Go is unambiguous.** `mask.ts` has to guess a regex from a
 *     division; Go has no regex literals, so a quote is a quote.
 *
 * What it cannot see is the thing package granularity exists for: a file's
 * references to its own package's siblings need no import statement at all
 * (ADR-0024 §6.1). That edge is not missing from the atlas — it is *inside* a
 * node.
 */

import { sortedUnique } from '../atlas/index.js';

export interface GoImportRef {
  /**
   * The import path. Never null: Go has no computed import, so unlike
   * `ImportRef.specifier` this arm does not exist.
   */
  readonly specifier: string;
  /** Character offset in the original source. Gives imports a stable order. */
  readonly at: number;
}

export interface GoFacts {
  /** In source order. */
  readonly imports: readonly GoImportRef[];
  /**
   * Exported package-level declarations — Go's analogue of `exports`, and
   * likewise the package's public surface.
   *
   * **Methods are excluded, deliberately.** `func (c *Command) Execute()`
   * declares `Execute` in `*Command`'s namespace, not the package's, and
   * treating the two as one is the false positive ADR-0024 §6.1 shipped inside
   * the paragraph congratulating itself for having fixed it — `Close`, `Create`
   * and `Write` matched across unrelated types.
   */
  readonly exports: readonly string[];
}

/**
 * Blank out comments and rune literals, and record string literals by their
 * opening-quote offset.
 *
 * Newlines survive so offsets and line structure are preserved — the
 * declaration scan below reads column 0, which only means anything if the
 * masked text has the same shape as the source. The one exception is an
 * **unterminated** interpreted string, where the closing quote is written over
 * the newline that ended it; that is malformed Go, it reached none of the 942
 * files measured, and the cost is a lost export rather than a phantom import.
 */
function maskGo(source: string): { masked: string; literals: Map<number, string> } {
  const out = new Array<string>(source.length);
  const literals = new Map<number, string>();
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) {
        out[i] = source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (char === '"' || char === '`' || char === "'") {
      const quote = char;
      const start = i;
      let body = '';
      out[i] = quote;
      i++;
      while (i < source.length) {
        const inner = source[i] ?? '';
        // A raw string (backticks) has no escapes at all, which is why the
        // guard names the quote rather than assuming every literal escapes.
        if (quote !== '`' && inner === '\\') {
          body += source.slice(i, i + 2);
          out[i] = ' ';
          if (i + 1 < source.length) out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (inner === quote) break;
        // An interpreted string cannot span a line; a raw one can.
        if (quote !== '`' && inner === '\n') break;
        body += inner;
        out[i] = inner === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) out[i] = quote;
      i++;
      // A rune's body is recorded like any other. It can never be *read* — the
      // import scan only ever looks up an offset after a `"` or a backtick —
      // and a branch that skips it would be a branch nothing can execute.
      // Masking runes is what matters here: an unmasked `'"'` opens a string
      // literal that swallows real code, which the export scan then loses.
      literals.set(start + 1, quote === '`' ? body : unescape(body));
      continue;
    }
    out[i] = char;
    i++;
  }
  return { masked: out.join(''), literals };
}

/** Only the escapes an import path could plausibly carry. */
function unescape(body: string): string {
  if (!body.includes('\\')) return body;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const next = body[++i] ?? '';
    out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
  }
  return out;
}

const IMPORT = /\bimport\b/g;
/**
 * `func Name(`, `type Name`, `var Name`, `const Name` — at column 0.
 *
 * A **method** — `func (c *Command) Execute()` — fails this by construction,
 * because `(` is not `[A-Za-z_]`. That is the whole exclusion and it needs no
 * second branch; an explicit `startsWith('func (')` guard was written here
 * first and could never fire, which is worse than no guard (CLAUDE.md).
 */
const DECLARATION = /^(func|type|var|const)[ \t]+([A-Za-z_][\w]*)/;
/**
 * A member of a grouped declaration: **exactly one tab**, then a name.
 *
 * One tab rather than any indent, because a `type (` block's struct *fields*
 * sit at two and are not package-level names. gofmt indents with tabs, so this
 * is exact on gofmt'd source and undercounts on anything else — which is the
 * safe direction, and the same one `UNREAD` takes.
 */
const GROUPED = /^\t([A-Za-z_][\w]*)/;

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i] ?? '')) i++;
  return i;
}

export function scanGoModule(source: string): GoFacts {
  const { masked, literals } = maskGo(source);
  const imports: GoImportRef[] = [];

  IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT.exec(masked)) !== null) {
    const start = match.index;
    // `x.import` is not legal Go, but `myimport` is — and the regex's own `\b`
    // already refuses that. This catches a selector spelling.
    if (/[\w.]/.test(masked[start - 1] ?? '\n')) continue;

    let i = skipSpace(masked, start + 'import'.length);

    if (masked[i] === '(') {
      const close = masked.indexOf(')', i);
      const end = close === -1 ? masked.length : close;
      i++;
      while (i < end) {
        i = skipSpace(masked, i);
        if (i >= end) break;
        const quote = masked[i];
        if (quote === '"' || quote === '`') {
          const literal = literals.get(i + 1);
          if (literal !== undefined && literal.length > 0) imports.push({ specifier: literal, at: i });
          i = skipLiteral(masked, i);
          continue;
        }
        // An alias — `m "math"`, `_ "embed"`, `. "strings"`. Step over it.
        i++;
      }
      IMPORT.lastIndex = end;
      continue;
    }

    // `import "x"`, `import m "x"`, `import _ "x"`, `import . "x"`.
    if (masked[i] !== '"' && masked[i] !== '`') {
      while (i < masked.length && !isSpace(masked[i] ?? '') && masked[i] !== '"' && masked[i] !== '`') i++;
      i = skipSpace(masked, i);
    }
    if (masked[i] === '"' || masked[i] === '`') {
      const literal = literals.get(i + 1);
      if (literal !== undefined && literal.length > 0) imports.push({ specifier: literal, at: i });
    }
  }

  imports.sort((a, b) => a.at - b.at);
  // No `packageName` here, deliberately. It was computed, tested, and read by
  // nothing in production — the `RevealNote.route` pattern the commit before
  // this one deleted a field for. The one thing it was wanted for, checking
  // that a directory holds a single package clause (§2), is a measurement taken
  // once by a scratch probe, not a guard the indexer needs: a repo that broke
  // the rule would get a coarser node, never a wrong answer key.
  return { imports, exports: sortedUnique(exportedDeclarations(masked)) };
}

/**
 * Exported package-level names, read off the masked text line by line.
 *
 * gofmt puts every top-level declaration at column 0, and Go's grammar requires
 * it to start with one of four keywords — so "column 0 plus a keyword" is a
 * cheap and exact test for *top level*. A name inside a function body is
 * indented and is never reached.
 *
 * **It reads one name per declaration**, so `var A, B = 1, 2` yields `A` alone.
 * That is an undercount in the same direction as the one-tab rule below, and it
 * is stated for the same reason: an export ark does not name costs a thinner
 * panel, and one it names wrongly is a false claim about the reader's own repo.
 */
function exportedDeclarations(masked: string): string[] {
  const names: string[] = [];
  let group: 'type' | 'var' | 'const' | null = null;
  for (const line of masked.split('\n')) {
    if (group !== null) {
      if (line.startsWith(')')) {
        group = null;
        continue;
      }
      const member = GROUPED.exec(line);
      if (member?.[1] !== undefined && isExported(member[1])) names.push(member[1]);
      continue;
    }
    const declared = DECLARATION.exec(line);
    if (declared?.[1] === undefined || declared[2] === undefined) {
      // `type (`, `var (`, `const (` — a grouped declaration opens here.
      const opener = /^(type|var|const)[ \t]+\($/.exec(line.trimEnd());
      if (opener?.[1] !== undefined) group = opener[1] as 'type' | 'var' | 'const';
      continue;
    }
    if (isExported(declared[2])) names.push(declared[2]);
  }
  return names;
}

/** Go's whole visibility rule: an initial upper-case letter. */
function isExported(name: string): boolean {
  const first = name[0] ?? '';
  return first >= 'A' && first <= 'Z';
}

function skipLiteral(masked: string, at: number): number {
  const quote = masked[at];
  let i = at + 1;
  while (i < masked.length && masked[i] !== quote) i++;
  return i + 1;
}
