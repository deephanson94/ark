import { describe, expect, it } from 'vitest';

import { maskSource } from '../../src/indexer/mask.js';
import { scanModule } from '../../src/indexer/scan.js';

function specifiers(source: string): string[] {
  return scanModule(source).imports.map((reference) => reference.specifier ?? '<null>');
}

describe('maskSource', () => {
  it('preserves length so offsets still address the original source', () => {
    const source = "const a = 'hello'; // trailing\n/* block */ const b = `x`;\n";
    expect(maskSource(source).masked).toHaveLength(source.length);
  });

  it('blanks comments so a commented-out import is not an import', () => {
    expect(specifiers("// import x from './real.js'\n")).toEqual([]);
    expect(specifiers("/* import x from './real.js' */\n")).toEqual([]);
  });

  it('blanks string contents so a quoted import is not an import', () => {
    expect(specifiers(`const sample = "import x from './real.js'";\n`)).toEqual([]);
  });

  it('keeps the literal values it masked', () => {
    const source = `import a from './b.js';`;
    const { literals } = maskSource(source);
    expect([...literals.values()]).toContain('./b.js');
  });

  it('does not let a regex literal swallow the rest of the file', () => {
    const source = `const re = /['"]/;\nimport a from './b.js';\n`;
    expect(specifiers(source)).toEqual(['./b.js']);
  });

  it('treats a division as a division', () => {
    const source = `const half = total / 2;\nimport a from './b.js';\n`;
    expect(specifiers(source)).toEqual(['./b.js']);
  });
});

describe('scanModule — imports', () => {
  it('reads every static import form', () => {
    const source = [
      `import './side-effect.js';`,
      `import def from './default.js';`,
      `import { a, b as c } from './named.js';`,
      `import * as ns from './star.js';`,
      `import def2, { d } from './mixed.js';`,
    ].join('\n');
    expect(specifiers(source)).toEqual([
      './side-effect.js',
      './default.js',
      './named.js',
      './star.js',
      './mixed.js',
    ]);
  });

  it('reads a multi-line import clause', () => {
    const source = `import {\n  alpha,\n  beta,\n} from './wide.js';\n`;
    expect(specifiers(source)).toEqual(['./wide.js']);
  });

  it('marks type-only imports as type edges — they are still a coupling', () => {
    const facts = scanModule(`import type { A } from './types.js';`);
    expect(facts.imports).toHaveLength(1);
    expect(facts.imports[0]?.kind).toBe('type');
    expect(facts.imports[0]?.specifier).toBe('./types.js');
  });

  it('treats a mixed value/type import as a value import', () => {
    const facts = scanModule(`import { type A, b } from './mixed.js';`);
    expect(facts.imports[0]?.kind).toBe('import');
  });

  it('reads re-exports as reexport edges', () => {
    const facts = scanModule(
      [`export * from './all.js';`, `export { a } from './some.js';`, `export type { B } from './t.js';`].join('\n'),
    );
    expect(facts.imports.map((r) => [r.kind, r.specifier])).toEqual([
      ['reexport', './all.js'],
      ['reexport', './some.js'],
      ['reexport', './t.js'],
    ]);
  });

  it('reads a literal dynamic import', () => {
    const facts = scanModule(`const m = await import('./lazy.js');`);
    expect(facts.imports[0]?.kind).toBe('dynamic');
    expect(facts.imports[0]?.specifier).toBe('./lazy.js');
  });

  it('reports a computed dynamic import as unknowable rather than guessing', () => {
    const facts = scanModule('const m = await import(`./plugins/${name}.js`);');
    expect(facts.imports).toHaveLength(1);
    expect(facts.imports[0]?.specifier).toBeNull();
    expect(facts.imports[0]?.raw).toBe('import(<expression>)');
  });

  it('ignores import.meta', () => {
    expect(scanModule('const here = import.meta.url;').imports).toEqual([]);
  });

  it('reads require calls', () => {
    const facts = scanModule(`const fs = require('node:fs');`);
    expect(facts.imports[0]?.kind).toBe('require');
    expect(facts.imports[0]?.specifier).toBe('node:fs');
  });

  it('returns imports in source order', () => {
    const source = `import z from './z.js';\nimport a from './a.js';\n`;
    expect(specifiers(source)).toEqual(['./z.js', './a.js']);
  });
});

describe('scanModule — exports', () => {
  it('reads declaration exports', () => {
    const source = [
      'export const alpha = 1;',
      'export function beta() {}',
      'export class Gamma {}',
      'export type Delta = string;',
      'export interface Epsilon { a: number }',
      'export enum Zeta { A }',
      'export async function eta() {}',
      'export declare const theta: number;',
    ].join('\n');
    expect(scanModule(source).exports).toEqual([
      'Delta',
      'Epsilon',
      'Gamma',
      'Zeta',
      'alpha',
      'beta',
      'eta',
      'theta',
    ]);
  });

  it('reads a default export as `default`, not as the local function name', () => {
    expect(scanModule('export default function handler() {}').exports).toEqual(['default']);
    expect(scanModule('export default 42;').exports).toEqual(['default']);
  });

  it('reads named export lists, using the exported name for aliases', () => {
    expect(scanModule('export { a, b as c, type d };').exports).toEqual(['a', 'c', 'd']);
  });

  it('reads a star re-export as `*`', () => {
    expect(scanModule(`export * from './x.js';`).exports).toEqual(['*']);
    expect(scanModule(`export * as ns from './x.js';`).exports).toEqual(['ns']);
  });

  it('does not report a local declaration as an export', () => {
    expect(scanModule('const hidden = 1;\nfunction alsoHidden() {}').exports).toEqual([]);
  });

  it('sorts and deduplicates', () => {
    expect(scanModule('export const b = 1;\nexport const a = 2;').exports).toEqual(['a', 'b']);
  });
});
