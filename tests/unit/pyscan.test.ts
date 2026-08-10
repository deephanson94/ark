import { describe, expect, it } from 'vitest';

import { scanPyModule } from '../../src/indexer/pyscan.js';

const sites = (source: string): string[] =>
  scanPyModule(source).imports.map(
    (r) => `${'.'.repeat(r.level)}${r.module ?? '<computed>'}${r.names.length > 0 ? ` :: ${r.names.join(',')}` : ''}`,
  );

describe('the Python scanner reads import statements', () => {
  it('reads the plain forms, one site per comma-separated clause', () => {
    expect(sites('import os\nimport a.b.c as x, d.e\n')).toEqual(['os', 'a.b.c', 'd.e']);
  });

  it('reads a from-import with its names, and keeps them', () => {
    // The names are not decoration: `from . import cli` names a *module*, and
    // resolving only the package would miss the file the statement is about.
    expect(sites('from pkg.sub import alpha, beta as b\n')).toEqual(['pkg.sub :: alpha,beta']);
  });

  it('counts the dots of a relative import, and `from . import x` has no module', () => {
    expect(sites('from . import cli\nfrom ..a.b import c\nfrom ... import d\n')).toEqual([
      '. :: cli',
      '..a.b :: c',
      '... :: d',
    ]);
  });

  it('keeps a star import as a name of its own', () => {
    expect(sites('from .globals import *\n')).toEqual(['.globals :: *']);
  });

  it('reads `from __future__ import annotations`', () => {
    // tree-sitter gives this its own node type and spells the module in the
    // grammar. Nothing here should notice; the scanner reads statements.
    expect(sites('from __future__ import annotations\n')).toEqual(['__future__ :: annotations']);
  });

  it('reads a parenthesised list spanning lines — implicit continuation', () => {
    const source = 'from pkg import (\n    alpha,\n    beta,\n)\nimport tail\n';
    expect(sites(source)).toEqual(['pkg :: alpha,beta', 'tail']);
  });

  it('reads a backslash continuation', () => {
    expect(sites('from pkg import \\\n    alpha\n')).toEqual(['pkg :: alpha']);
  });

  it('reads both halves of a semicolon-separated line', () => {
    expect(sites('import os; import sys\n')).toEqual(['os', 'sys']);
  });

  it('reads an import inside a function body — Python has no imports-come-first rule', () => {
    // Go's grammar bounds the scan to the top of the file. Python's does not,
    // which is one of the two reasons ADR-0026 said not to assume the next
    // language would be as easy as Go.
    expect(sites('def f():\n    import json\n    return json\n')).toEqual(['json']);
  });
});

describe('the Python scanner refuses what is not an import', () => {
  it('ignores `raise X from Y` and `yield from g`', () => {
    // The shape neither JavaScript nor Go has: `from` is a keyword in three
    // different statements, so a bare `\bfrom\b` search is wrong.
    const source = 'def f():\n    try:\n        pass\n    except E as e:\n        raise V() from e\n\ndef g():\n    yield from h()\n';
    expect(sites(source)).toEqual([]);
  });

  it('ignores the word inside a comment or a string', () => {
    const source = '# import os\nx = "import sys"\ny = """\nfrom pkg import alpha\n"""\n';
    expect(sites(source)).toEqual([]);
  });

  it('ignores it inside every string flavour, prefixed and triple-quoted', () => {
    const source = [
      "a = r'import os'",
      'b = b"import sys"',
      'c = f"{x}import json"',
      "d = rb'''\nfrom pkg import alpha\n'''",
      'e = F"""import re"""',
      '',
    ].join('\n');
    expect(sites(source)).toEqual([]);
  });

  it('does not read a prefix letter glued to an identifier as a string prefix', () => {
    // `deff'…'` is not a string; the guard is that the character before the
    // prefix must not be an identifier character.
    expect(sites("classf = 1\nimport os\n")).toEqual(['os']);
  });

  it('survives a quote inside a raw string without swallowing the file', () => {
    const source = "PATTERN = r'\\''\nimport os\n";
    expect(sites(source)).toEqual(['os']);
  });

  it('ignores an attribute or identifier that merely contains the keyword', () => {
    expect(sites('important = 1\nx = y.imported\nimport os\n')).toEqual(['os']);
  });
});

describe('the Python scanner records what it cannot evaluate', () => {
  it('records a computed import as the null arm rather than dropping it', () => {
    // The arm `GoImportRef` does not have, and the one ADR-0024 §4.1 found
    // poisoning 83.7% of django's blast subjects from seven sites. A silently
    // dropped import is worse than a wrong one.
    const facts = scanPyModule('import importlib\nm = importlib.import_module(name)\n');
    const computed = facts.imports.filter((r) => r.module === null);
    expect(computed).toHaveLength(1);
    expect(computed[0]?.raw).toContain('import_module');
  });

  it('reads a literal argument as an ordinary specifier', () => {
    expect(sites('m = importlib.import_module("pkg.sub")\n')).toContain('pkg.sub');
  });

  it('records `__import__(expr)` too', () => {
    const facts = scanPyModule('mod = __import__(import_name)\n');
    expect(facts.imports.filter((r) => r.module === null)).toHaveLength(1);
  });
});

describe('the Python scanner reads public top-level names', () => {
  it('takes column-0 definitions and assignments, and drops the private ones', () => {
    const source = [
      'import os',
      'CONSTANT = 1',
      '_private = 2',
      'typed: int = 3',
      'def helper():',
      '    inner = 4',
      '    def nested(): pass',
      'class Thing:',
      '    def method(self): pass',
      'async def fetch(): pass',
      'def _hidden(): pass',
      '',
    ].join('\n');
    expect(scanPyModule(source).exports).toEqual(['CONSTANT', 'Thing', 'fetch', 'helper', 'typed']);
  });

  it('does not read a comparison as an assignment', () => {
    expect(scanPyModule('ok == 1\n').exports).toEqual([]);
  });

  it('loses no export to an unmasked quote — the mutant this suite exists for', () => {
    // `goscan.ts` has a landmine about exactly this: masking a rune literal is
    // load-bearing but its damage lands on `exports`, not on `imports`, so a
    // test asserting only on imports lets the mutant survive. Here the quote
    // inside a character-class regex string is the same shape.
    const source = 'QUOTE = \'"\'\nclass After: pass\n';
    expect(scanPyModule(source).exports).toEqual(['After', 'QUOTE']);
  });
});
