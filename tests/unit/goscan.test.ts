import { describe, expect, it } from 'vitest';

import { scanGoModule } from '../../src/indexer/goscan.js';

const specifiers = (source: string): string[] =>
  scanGoModule(source).imports.map((reference) => reference.specifier);

describe('the Go scanner reads what a file says', () => {
  it('reads a single import', () => {
    expect(specifiers('package a\nimport "fmt"\n')).toEqual(['fmt']);
  });

  it('reads a parenthesised block', () => {
    expect(specifiers('package a\nimport (\n\t"fmt"\n\t"net/http"\n)\n')).toEqual([
      'fmt',
      'net/http',
    ]);
  });

  it('steps over an alias, a blank import and a dot import', () => {
    const source = 'package a\nimport (\n\tm "math"\n\t_ "embed"\n\t. "strings"\n)\n';
    expect(specifiers(source)).toEqual(['math', 'embed', 'strings']);
  });

  it('reads two separate declarations', () => {
    expect(specifiers('package a\nimport "fmt"\nimport "os"\n')).toEqual(['fmt', 'os']);
  });

  it('reads a full module path', () => {
    expect(specifiers('package a\nimport "github.com/x/y/z"\n')).toEqual(['github.com/x/y/z']);
  });

  it('reads the package clause', () => {
    expect(scanGoModule('//go:build linux\n\npackage hugolib\n').packageName).toBe('hugolib');
  });
});

describe('the Go scanner is not fooled by text that looks like an import', () => {
  // Zero disagreements with tree-sitter on 942 real files is evidence about the
  // corpus. These are the cases a masking scanner is *supposed* to be able to
  // get wrong, and they are what the corpus does not contain enough of.
  it('ignores the word inside a line comment', () => {
    expect(specifiers('package a\n// import "never"\nimport "fmt"\n')).toEqual(['fmt']);
  });

  it('ignores a whole block inside a block comment', () => {
    expect(specifiers('package a\n/* import (\n"never"\n) */\nimport "fmt"\n')).toEqual(['fmt']);
  });

  it('does not end a block at a close paren inside a comment', () => {
    expect(specifiers('package a\nimport (\n\t"fmt" // ) not the end\n\t"os"\n)\n')).toEqual([
      'fmt',
      'os',
    ]);
  });

  it('ignores the word inside an interpreted string', () => {
    expect(specifiers('package a\nimport "fmt"\nvar s = "import \\"never\\""\n')).toEqual(['fmt']);
  });

  it('ignores a multi-line raw string that contains a whole import block', () => {
    // A raw string has no escapes and spans lines, which is the one shape
    // `mask.ts`'s rules do not cover and the reason Go gets its own masker.
    //
    // The `import` has to sit on a **later line than the opening backtick** for
    // this to test anything: a first draft put it on the same line, where a
    // masker that wrongly ended raw strings at the newline still produced the
    // right answer, and the mutation survived.
    const source = 'package a\nimport "fmt"\nvar s = `\nimport (\n\t"never"\n)\n`\n';
    expect(specifiers(source)).toEqual(['fmt']);
  });

  it('ignores an identifier that merely starts with the keyword', () => {
    expect(specifiers('package a\nimport "fmt"\nfunc f(importPath string) {}\n')).toEqual(['fmt']);
  });

  it('is not derailed by a rune literal holding a quote', () => {
    // An unmasked `'"'` opens a string that swallows everything to the next
    // quote, so what it costs is not an import — imports come first in Go — but
    // every declaration after it. The assertion is therefore about `exports`;
    // asserting on `imports` here passed with rune masking removed entirely.
    const source = 'package a\nimport "fmt"\nvar Quote = \'"\'\nfunc Later() {}\ntype Kind int\n';
    expect(specifiers(source)).toEqual(['fmt']);
    expect(scanGoModule(source).exports).toEqual(['Kind', 'Later', 'Quote']);
  });

  it('is not derailed by a trailing escaped backslash', () => {
    const source = 'package a\nimport "fmt"\nvar s = "c:\\\\"\nvar t = "still not one"\n';
    expect(specifiers(source)).toEqual(['fmt']);
  });

  it('finds nothing in a file with no imports', () => {
    expect(specifiers('package a\nfunc main() {}\n')).toEqual([]);
  });
});

describe('the Go scanner reads a package’s exported surface', () => {
  it('takes exported top-level declarations and leaves unexported ones', () => {
    const source =
      'package a\n' +
      'func Execute() {}\n' +
      'func helper() {}\n' +
      'type Command struct{}\n' +
      'type internal struct{}\n' +
      'var Default = 1\n' +
      'const Version = "1"\n';
    expect(scanGoModule(source).exports).toEqual(['Command', 'Default', 'Execute', 'Version']);
  });

  it('excludes methods, whose names live in the receiver’s namespace', () => {
    // ADR-0024 §6.1: counting method names matched `Close`, `Create` and
    // `Write` across unrelated types, and the correction shipped inside the
    // paragraph congratulating itself for having tested the claim.
    const source = 'package a\ntype Command struct{}\nfunc (c *Command) Execute() {}\nfunc New() {}\n';
    expect(scanGoModule(source).exports).toEqual(['Command', 'New']);
  });

  it('reads members of a grouped declaration', () => {
    const source = 'package a\nconst (\n\tRed = iota\n\tblue\n\tGreen\n)\n';
    expect(scanGoModule(source).exports).toEqual(['Green', 'Red']);
  });

  it('does not mistake a struct field for a package-level name', () => {
    // Fields sit at two tabs inside a `type (` block. Accepting any indent
    // would publish every exported field of every struct as a package export.
    const source = 'package a\ntype (\n\tCommand struct {\n\t\tName string\n\t\tUse  string\n\t}\n)\n';
    expect(scanGoModule(source).exports).toEqual(['Command']);
  });

  it('does not read a name out of a function body', () => {
    const source = 'package a\nfunc New() {\n\tvar Inner = 1\n\t_ = Inner\n}\n';
    expect(scanGoModule(source).exports).toEqual(['New']);
  });

  it('reads a generic function’s name', () => {
    expect(scanGoModule('package a\nfunc Map[T any](xs []T) []T { return xs }\n').exports).toEqual([
      'Map',
    ]);
  });
});
