import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Atlas, UnreadableCount } from '../../src/atlas/index.js';
import {
  MAPPED_SHARE,
  UNREADABLE_FLOOR,
  coverageBadge,
  coverageSentence,
  sourceCoverage,
  unreadableLanguages,
  unreadableList,
  validateAtlas,
} from '../../src/atlas/index.js';
import { CARRIED, SCANNED, UNREAD, DEFAULT_WALK_OPTIONS, walk } from '../../src/indexer/walk.js';
import { atlasWith } from '../fixtures/atlas.js';

/**
 * An atlas with `mapped` importing-language nodes and a stated unreadable
 * tally. Nothing else in the atlas is read by `sourceCoverage`, so the fixture
 * says only what the rule looks at — and it goes back through the validator, so
 * a fixture whose `unreadable` is unsorted fails here rather than passing.
 */
function repo(mapped: number, unreadable: readonly UnreadableCount[]): Atlas {
  // One Markdown file, always. It is what a documentation-only repo is made of,
  // and it must not count towards the mapped source in either direction.
  const paths = ['README.md', ...Array.from({ length: mapped }, (_unused, i) => `src/m${i}.ts`)];
  const atlas = atlasWith(paths);
  return validateAtlas({ ...atlas, report: { ...atlas.report, unreadable: [...unreadable] } });
}

const go = (count: number): UnreadableCount[] => [{ lang: 'Go', count }];

describe('sourceCoverage counts only what it claims to count', () => {
  it('ignores Markdown and JSON on both sides of the ratio', () => {
    // `gohugoio/hugo` is 1,016 Markdown files and is not a documentation
    // project. If terrain counted as mapped source, its 24 JS files plus a
    // thousand docs pages would clear any bar.
    const atlas = repo(0, go(36));
    expect(sourceCoverage(atlas).mapped).toBe(0);
    expect(atlas.nodes.some((n) => n.lang === 'md')).toBe(true);
  });

  it('sums every language into the unreadable total', () => {
    const coverage = sourceCoverage(
      repo(0, [
        { lang: 'Go', count: 906 },
        { lang: 'Shell', count: 10 },
      ]),
    );
    expect(coverage.unreadable).toBe(916);
  });
});

describe('the deck refusal, one assertion per clause', () => {
  // Both clauses are load-bearing on real repos and each rescues a case the
  // other gets wrong (ADR-0025 §4). Asserting only the conjunction would let
  // either one rot into a no-op — which is how a strategy named after an "and"
  // ends up enforcing one half.
  it('clause 1 alone: a stray script is not a body of source', () => {
    // `sindresorhus/awesome` — seven Markdown files and one shell script. It has
    // no mapped source at all, so clause 2 holds and clause 1 is the only thing
    // between it and a refused deck.
    const coverage = sourceCoverage(repo(0, [{ lang: 'Shell', count: 1 }]));
    expect(coverage.sliver).toBe(true);
    expect(coverage.bodyOfSource).toBe(false);
    expect(coverage.deckRefused).toBe(false);
  });

  it('clause 2 alone: a large readable codebase keeps its deck', () => {
    // `facebook/react` — 4,436 mapped source files against 120 Rust and 16
    // Shell. Clause 1 holds; clause 2 is what stops a JS tool refusing a JS repo.
    const coverage = sourceCoverage(
      repo(4436, [
        { lang: 'Rust', count: 120 },
        { lang: 'Shell', count: 16 },
      ]),
    );
    expect(coverage.bodyOfSource).toBe(true);
    expect(coverage.sliver).toBe(false);
    expect(coverage.deckRefused).toBe(false);
  });

  it('both clauses: a Go library with a README gets no deck', () => {
    const coverage = sourceCoverage(repo(0, go(36)));
    expect(coverage.bodyOfSource).toBe(true);
    expect(coverage.sliver).toBe(true);
    expect(coverage.deckRefused).toBe(true);
  });

  it('a repo with nothing unreadable is never refused', () => {
    const coverage = sourceCoverage(repo(0, []));
    expect(coverage.unreadable).toBe(0);
    expect(coverage.deckRefused).toBe(false);
    expect(coverageSentence(coverage)).toBeNull();
    expect(coverageBadge(coverage)).toBeNull();
  });
});

describe('the two thresholds sit where they are said to sit', () => {
  it('the floor admits its own value and refuses one below it', () => {
    expect(sourceCoverage(repo(0, go(UNREADABLE_FLOOR))).bodyOfSource).toBe(true);
    expect(sourceCoverage(repo(0, go(UNREADABLE_FLOOR - 1))).bodyOfSource).toBe(false);
  });

  it('a map holding exactly a tenth of the source keeps its deck', () => {
    // 100 mapped, 900 unreadable — a tenth exactly, and a tenth is not *less*
    // than a tenth. The step from there is one file.
    expect(sourceCoverage(repo(100, go(900))).sliver).toBe(false);
    expect(sourceCoverage(repo(100, go(901))).sliver).toBe(true);
    expect(MAPPED_SHARE).toBe(10);
  });

  it('`sveltejs/svelte` is on the shipping side of it', () => {
    // 3,467 TypeScript files against 4,462 `.svelte` ones. A *majority* rule —
    // the first draft — refuses this, which is the reason the bar is a tenth.
    expect(sourceCoverage(repo(3467, [{ lang: 'Svelte', count: 4462 }])).deckRefused).toBe(false);
  });
});

describe('the sentence both surfaces print', () => {
  it('names every language with its count, largest first', () => {
    const coverage = sourceCoverage(
      repo(24, [
        { lang: 'C', count: 4 },
        { lang: 'Go', count: 906 },
        { lang: 'Shell', count: 10 },
      ]),
    );
    expect(unreadableList(coverage)).toBe('906 Go, 10 Shell and 4 C');
    expect(unreadableLanguages(coverage)).toBe('Go, Shell and C');
    const sentence = coverageSentence(coverage) ?? '';
    expect(sentence).toContain("24 of this repository's 944 source files");
    expect(sentence).toContain('906 Go, 10 Shell and 4 C');
    expect(sentence).toContain('generated no questions');
  });

  it('does not claim a deck was refused when it was not', () => {
    const sentence = coverageSentence(sourceCoverage(repo(4436, [{ lang: 'Rust', count: 120 }])));
    expect(sentence).toContain('4436 of this repository');
    expect(sentence).not.toContain('no questions');
  });

  it('says "none" rather than "0 of N" when no source is mapped', () => {
    const sentence = coverageSentence(sourceCoverage(repo(0, go(36)))) ?? '';
    expect(sentence).toContain("None of this repository's 36 source files");
    // The counts are already implied by "none of 36", so the languages are
    // named without repeating them — an earlier draft printed "The other 36 —
    // 36 Go —".
    expect(sentence).toContain('they are Go');
    expect(sentence).not.toContain('36 Go');
  });

  it('counts one file in the singular on both surfaces', () => {
    const coverage = sourceCoverage(repo(0, [{ lang: 'Shell', count: 1 }]));
    expect(coverageBadge(coverage)).toBe('1 source file not on this map');
    expect(coverageSentence(coverage)).toBe(
      "None of this repository's 1 source file is on this map — it is Shell, which ark cannot read.",
    );
  });

  it('does not say the count twice when there is one language', () => {
    // "The other 1 are 1 Shell" is what the first version printed, and the
    // bootstrap repo is exactly that case, so it was on screen.
    expect(coverageSentence(sourceCoverage(repo(116, [{ lang: 'Shell', count: 1 }])))).toBe(
      "This map holds 116 of this repository's 117 source files. The other 1 is Shell," +
        ' which ark cannot read.',
    );
  });
});

describe('the walk’s three language tables', () => {
  it('are disjoint, so nothing is both indexed and counted as missing', () => {
    for (const extension of UNREAD.keys()) {
      expect(SCANNED.has(extension), `${extension} is scanned and unread`).toBe(false);
      expect(CARRIED.has(extension), `${extension} is carried and unread`).toBe(false);
    }
  });

  it('name a language for every entry', () => {
    for (const [extension, lang] of UNREAD) {
      expect(extension.startsWith('.'), extension).toBe(true);
      expect(lang.length).toBeGreaterThan(0);
    }
  });

  it('spell an upper-case extension out rather than folding case at the lookup', () => {
    // `.R` and `.r` are both R and both have a row. The alternative — one row
    // and a `toLowerCase()` — is what shipped first, and it reported `.C`
    // (C++ by convention) as **C**. Any upper-case row must therefore name the
    // same language as its lower-case twin, or the fold has come back wearing
    // a different hat.
    for (const [extension, lang] of UNREAD) {
      const lower = extension.toLowerCase();
      if (lower === extension) continue;
      const twin = UNREAD.get(lower);
      expect(twin === undefined || twin === lang, `${extension} is ${lang}, ${lower} is ${twin}`).toBe(true);
    }
  });
});

describe('the walk tallies unreadable source', () => {
  async function tree(files: Record<string, string>): Promise<Awaited<ReturnType<typeof walk>>> {
    const root = await mkdtemp(join(tmpdir(), 'ark-coverage-'));
    for (const [path, body] of Object.entries(files)) {
      const slash = path.lastIndexOf('/');
      if (slash > 0) await mkdir(join(root, path.slice(0, slash)), { recursive: true });
      await writeFile(join(root, path), body, 'utf8');
    }
    return walk({ root, ...DEFAULT_WALK_OPTIONS });
  }

  it('counts source by language and leaves indexed files alone', async () => {
    const result = await tree({
      'src/main.ts': 'export const a = 1;\n',
      'README.md': '# hi\n',
      'cmd/root.go': 'package main\n',
      'cmd/flags.go': 'package main\n',
      'setup.py': 'x = 1\n',
      'run.sh': 'echo hi\n',
      'logo.png': 'not really a png\n',
      'config.yml': 'a: 1\n',
    });
    // **Go is scanned since M5**, so its files are indexed and are not
    // unreadable. That is decision 6 of ADR-0025 doing its job in the direction
    // it was written for: a language arriving in `SCANNED` leaves `UNREAD` in
    // the same commit, and this fixture is where the move is visible.
    expect(result.files.map((f) => f.path)).toEqual([
      'README.md',
      'cmd/flags.go',
      'cmd/root.go',
      'src/main.ts',
    ]);
    // Sorted by language, which is what the atlas stores and the validator checks.
    expect(result.unreadable).toEqual([
      { lang: 'Python', count: 1 },
      { lang: 'Shell', count: 1 },
    ]);
  });

  it('never counts more than the walk skipped as unsupported', async () => {
    // The refinement invariant: every unreadable file is an unsupported file.
    // A tally that outran its parent would mean something was counted twice or
    // counted after being indexed.
    const result = await tree({
      'a.rs': 'fn main() {}\n',
      'b.py': 'x = 1\n',
      'c.png': 'x\n',
      'd.ts': 'export const d = 1;\n',
    });
    const unsupported = result.skipped.find((s) => s.reason === 'unsupported')?.count ?? 0;
    const unreadable = result.unreadable.reduce((total, u) => total + u.count, 0);
    expect(unreadable).toBe(2);
    expect(unsupported).toBe(3);
    expect(unreadable).toBeLessThanOrEqual(unsupported);
  });

  it('has a row for the conventional upper-case spelling', async () => {
    const result = await tree({ 'analysis.R': 'x <- 1\n' });
    expect(result.unreadable).toEqual([{ lang: 'R', count: 1 }]);
  });

  it('undercounts rather than printing a wrong language name', async () => {
    // `.C` is C++ by convention. A `toLowerCase()` on the lookup — which is
    // what shipped first — folded it onto `.c` and reported it as **C**, the
    // one cost decision 5 says this mechanism never pays. Not counting it is
    // the safe direction and is what happens now.
    const result = await tree({ 'legacy.C': 'int main(){}\n' });
    expect(result.unreadable).toEqual([]);
  });

  it('counts the languages a real repo is made of, not only the famous ones', async () => {
    // A Terraform module repo reproduced ADR-0025's own defect after it
    // shipped: `.tf` was not in the table, so 77 invisible files produced 64
    // challenges about 24 Markdown ones with every new surface silent.
    const result = await tree({ 'main.tf': 'resource "x" "y" {}\n', 'vars.tfvars': 'a = 1\n' });
    expect(result.unreadable).toEqual([{ lang: 'Terraform', count: 2 }]);
  });

  it('counts nothing for a repo that is only its documentation', async () => {
    const result = await tree({ 'README.md': '# hi\n', 'docs/one.md': '# one\n', 'logo.svg': '<svg/>' });
    expect(result.unreadable).toEqual([]);
  });
});
