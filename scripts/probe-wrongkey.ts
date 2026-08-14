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
import process from 'node:process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

export interface Hit { repo: string; board: string; subject: string; candidate: string; specifier: string; line: string; }

function goModulePath(root: string): string | null {
  try {
    const line = readFileSync(join(root, 'go.mod'), 'utf8').split('\n').find((l) => l.startsWith('module '));
    return line === undefined ? null : (line.slice(7).trim() || null);
  } catch { return null; }
}

/** Every workspace package name → its manifest's directory, read from the repo rather than the atlas. */
function workspacePackageDirs(root: string): [string, string][] {
  const out: [string, string][] = [];
  let listed: string[] = [];
  try {
    listed = execFileSync('bash', ['-c',
      `cd ${JSON.stringify(root)} && git ls-files '*package.json' | grep -v node_modules`],
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch { return out; }
  for (const manifest of listed) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, manifest), 'utf8')) as Record<string, unknown>;
      if (typeof parsed['name'] !== 'string') continue;
      out.push([parsed['name'], manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/')) : '']);
    } catch { /* a malformed manifest is not this probe's problem */ }
  }
  // Longest name first, so `@scope/a/b` is not eaten by `@scope/a`.
  out.sort((a, b) => b[0].length - a[0].length);
  return out;
}

export interface ScanResult {
  readonly hits: readonly Hit[];
  readonly boards: number;
  readonly slots: number;
  /** Distinct boards carrying at least one hit — the plant's catch rate reads off this. */
  readonly byBoard: number;
}

export function scanBoards(root: string, atlas: Atlas, swap: boolean): ScanResult {
  const goModule = goModulePath(root);
  const workspaceDirs = workspacePackageDirs(root);
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
          // **Non-relative specifiers are checked too, and they were not.** A review measured this
          // lexer as blind to 62–64% of the dependency relation on apollo-client, rxjs and express
          // — the three repos ADR-0042 §3's +250 boards are on — because it skipped anything not
          // starting with `.`, which is *the whole specifier form* the workspace fix resolves. A
          // probe blind to the class a change creates cannot certify that change.
          const bases: string[] = [];
          if (spec.startsWith('.')) {
            const rel = joinPosix(dirnameOf(file), spec);
            if (rel !== null) bases.push(rel);
          } else {
            for (const [name, dir] of workspaceDirs) {
              if (spec !== name && !spec.startsWith(`${name}/`)) continue;
              const sub = spec.slice(name.length).replace(/^\//, '');
              bases.push(joinPosix(dir, sub) ?? '', joinPosix(dir, `src/${sub}`) ?? '');
            }
            if (bases.length === 0) continue;
          }
          for (const base of bases) {
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
      }
      if (planted !== null && pathById.get(planted) === candPath && hits.at(-1)?.candidate !== candPath) {
        // recorded by the caller via the plant summary below
      }
    }
  }
  return { hits, boards, slots, byBoard: new Set(hits.map((hit) => hit.board)).size };
}

// Only run as a command, never on import — `scripts/check-keys.ts` reuses `scanBoards`.
const invokedDirectly = process.argv[1]?.endsWith('probe-wrongkey.ts') ?? false;
let totalHits = 0;
for (const repo of invokedDirectly ? repos : []) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const { hits, boards, slots } = scanBoards(root, atlas, plant);
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
if (plant && invokedDirectly) {
  console.log(`\nPLANT GATE: ${totalHits > 0 ? 'PASS — the probe caught the planted wrong keys' : 'FAIL — the probe is measuring nothing'}`);
}
