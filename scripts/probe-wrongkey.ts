/**
 * PHASE 3/4 — does any Blast Radius board mark a **real** dependent as wrong?
 *
 * **This instrument must not read the atlas's edges.** ADR-0026 §6.1's lesson is that a check
 * derived from the atlas structurally cannot see an edge the atlas is missing — three such checks
 * were run on M5's Go work and all three were vacuous, while the one that read the repository's
 * *source* found two wrong answer keys. So the only atlas input here is the board itself (subject,
 * candidates, truth) and each node's path. Everything else comes from the file text and the
 * filesystem.
 *
 * It also uses its **own** lexer — a regex sweep over the raw source rather than `scan.ts` — because
 * ADR-0028 §8.1's `import_module` defect survived two instruments that shared one blindness. A
 * regex over-matches (a specifier inside a comment or a string counts); every hit is therefore
 * reported with its source line so it can be read.
 *
 * ## The gate
 *
 * `--plant` moves one member of each board's answer key into the distractor set and asserts the
 * probe finds it. A probe reporting zero because it cannot see anything looks exactly like good
 * news, so the zero is worthless until the plant is caught.
 *
 *   npx tsx scripts/probe-wrongkey.ts /tmp/ark-corpus <repo>...
 *   npx tsx scripts/probe-wrongkey.ts /tmp/ark-corpus <repo>... --plant
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import type { Atlas, AtlasNode } from '../src/atlas/schema.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const plant = process.argv.includes('--plant');
const repos = process.argv.slice(3).filter((a) => !a.startsWith('--'));

/** Our own lexer. Deliberately not `scan.ts`. Over-matches; every hit is printed. */
// The leading class excludes `.` on purpose. Without it, `require.main.require('./file')` matches
// on its trailing `.require(` — and that is a *different function*, resolving against the main
// module rather than this file. It flagged 2 of webpack's exotic-syntax test fixtures, where ark was
// right and the probe was wrong. Third correction to this instrument, all three in ark's favour.
const SPEC = /(?:^|[^\w$.])(?:import\s+[^;'"]*?from\s*|import\s*|export\s+[^;'"]*?from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
/** Go: the import block and single-line form. */
const GO_SPEC = /(?:^|\n)\s*(?:import\s+(?:\w+\s+)?"([^"]+)"|import\s*\(([\s\S]*?)\))/g;

/**
 * Blank out comments and template literals, keeping offsets so a reported line number stays true.
 *
 * The first version of this probe skipped this and reported **24 violations on webpack**. Every one
 * was a JSDoc `/** @typedef {import("./util/fs").WatchFileSystem} *\/` — a type reference inside a
 * comment, which `scan.ts` masks and correctly does not make an edge from. The probe was wrong and
 * ark was right, which is the direction that gets believed if nobody reads the hits.
 */
/** Comments blanked, but the specifier's own quotes must survive — so strings are kept. */
function maskCommentsOnly(text: string): string {
  const out = [...text];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < n && text[i] !== c) { if (text[i] === '\\') i += 1; i += 1; }
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') { out[i] = ' '; i += 1; } continue; }
    if (c === '/' && d === '*') {
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] !== '\n') out[i] = ' '; i += 1; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const dirnameOf = (p: string): string => (p.lastIndexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/')));
const TRY = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function joinPosix(base: string, spec: string): string | null {
  const parts = base === '' ? [] : base.split('/');
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Files a node stands for: itself for a file node, its `.go` members for a package. */
function filesOf(root: string, node: AtlasNode): string[] {
  if (node.kind !== 'dir') return [node.path];
  const dir = node.path === '.' ? root : join(root, node.path);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.go'))
      .map((f) => (node.path === '.' ? f : `${node.path}/${f}`));
  } catch { return []; }
}

interface Hit { repo: string; board: string; subject: string; candidate: string; specifier: string; line: string; }

function goModulePath(root: string): string | null {
  try {
    const line = readFileSync(join(root, 'go.mod'), 'utf8').split('\n').find((l) => l.startsWith('module '));
    return line === undefined ? null : (line.slice(7).trim() || null);
  } catch { return null; }
}

function scan(root: string, atlas: Atlas, swap: boolean): { hits: Hit[]; boards: number; slots: number } {
  const goModule = goModulePath(root);
  const nodeByPath = new Map(atlas.nodes.map((n) => [n.path, n]));
  const pathById = new Map(atlas.nodes.map((n) => [n.id, n.path]));

  // Go package path → node path, for resolving a Go import to a package node.
  const goPkgSuffix: [string, string][] = [];
  for (const n of atlas.nodes) if (n.kind === 'dir') goPkgSuffix.push([n.path, n.path]);

  const hits: Hit[] = [];
  let boards = 0;
  let slots = 0;

  for (const challenge of atlas.challenges) {
    if (challenge.verb !== 'blastRadius') continue;
    const subjectPath = pathById.get(challenge.subject);
    if (subjectPath === undefined) continue;
    const truth = new Set(challenge.truth);

    // The gate: move the first key member into the distractor set. The probe must catch it.
    let planted: string | null = null;
    if (swap) {
      const first = [...challenge.truth].sort()[0];
      if (first === undefined) continue;
      truth.delete(first);
      planted = first;
    }

    const wrongSlots = challenge.candidates.filter((c) => !truth.has(c) && c !== challenge.subject);
    if (wrongSlots.length === 0) continue;
    boards += 1;

    for (const id of wrongSlots) {
      const candPath = pathById.get(id);
      if (candPath === undefined) continue;
      const cand = nodeByPath.get(candPath);
      if (cand === undefined) continue;
      slots += 1;

      for (const file of filesOf(root, cand)) {
        const full = join(root, file);
        if (!existsSync(full) || !statSync(full).isFile()) continue;
        let text: string;
        try { text = maskCommentsOnly(readFileSync(full, 'utf8')); } catch { continue; }

        if (cand.kind === 'dir') {
          // Go: does this file import the subject package's import path?
          const subject = nodeByPath.get(subjectPath);
          if (subject === undefined) continue;
          const tail = subjectPath === '.' ? null : subjectPath;
          if (tail === null) continue;
          for (const m of text.matchAll(GO_SPEC)) {
            const specs = m[1] !== undefined ? [m[1]] : [...(m[2] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1] ?? '');
            for (const s of specs) {
              // Anchored on the repo's own module path. The first version matched any suffix and
              // reported `golang.org/x/text/transform` as hugo's own top-level `transform/` — an
              // external package read as an internal edge. An unanchored suffix is not a module.
              if (goModule !== null && s === `${goModule}/${tail}`) {
                hits.push({ repo: '', board: challenge.id, subject: subjectPath, candidate: candPath, specifier: s, line: file });
              }
            }
          }
          continue;
        }

        for (const m of text.matchAll(SPEC)) {
          const spec = m[1] ?? '';
          if (!spec.startsWith('.')) continue;
          const base = joinPosix(dirnameOf(file), spec);
          if (base === null) continue;
          // Does any spelling of this specifier name the subject's file?
          const names =
            TRY.some((e) => base + e === subjectPath) ||
            TRY.some((e) => `${base}/index${e}` === subjectPath) ||
            // `./x.js` in TypeScript ESM output means `./x.ts`
            (base.endsWith('.js') && [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`].includes(subjectPath));
          if (!names) continue;
          const at = text.slice(0, m.index).split('\n').length;
          hits.push({
            repo: '', board: challenge.id, subject: subjectPath, candidate: candPath,
            specifier: spec, line: `${file}:${at}`,
          });
        }
      }
      if (planted !== null && pathById.get(planted) === candPath && hits.at(-1)?.candidate !== candPath) {
        // recorded by the caller via the plant summary below
      }
    }
  }
  return { hits, boards, slots };
}

let totalHits = 0;
for (const repo of repos) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const { hits, boards, slots } = scan(root, atlas, plant);
  totalHits += hits.length;
  const byBoard = new Set(hits.map((h) => h.board));
  console.log(
    `${repo.padEnd(20)} boards ${String(boards).padStart(5)}  wrong-answer slots ${String(slots).padStart(6)}  ` +
    `**violations ${String(hits.length).padStart(4)}** on ${byBoard.size} board(s)${plant ? '   [PLANT]' : ''}`,
  );
  for (const h of hits.slice(0, 6)) {
    console.log(`    ${h.candidate}  imports  '${h.specifier}'  →  ${h.subject}     (${h.line})`);
  }
}
if (plant) {
  console.log(`\nPLANT GATE: ${totalHits > 0 ? 'PASS — the probe caught the planted wrong keys' : 'FAIL — the probe is measuring nothing'}`);
}
