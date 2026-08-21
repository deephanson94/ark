/**
 * **Does any board's answer key hold a file that cannot reach the subject?**
 *
 * `npm run check:keys` reads the repository's source and asks the *distractor*
 * question — is a candidate marked wrong actually a real dependent? It is the
 * only instrument here that can see a **missing** edge, and it is blind in the
 * other direction: it never asks whether a **truth member really is a
 * dependent**. ADR-0042 §3.7's two wrong answer keys on webpack failed in
 * exactly that direction, and they are guarded today by unit fixtures alone.
 *
 * The naive version of this check is worthless and worth naming: truth is the
 * **unbounded** dependent set (ADR-0008), so "this member does not directly
 * import the subject" is evidence of nothing — 12% to 74% of key members are
 * direct, depending on the repo. The question only has meaning over a **graph**,
 * so this builds one from the file text and asks for reachability.
 *
 * The graph is built here rather than taken from the atlas, because an
 * atlas-derived check structurally cannot see the defect (ADR-0026 §4.1) — the
 * atlas *is* the thing under test. This resolver shares no code with
 * `src/indexer/scan.ts`.
 *
 * **A hit is not automatically a defect**: this resolver is weaker than the
 * indexer's, so an unreachable member may be this file's blindness rather than
 * a wrong key. Measured at `776473d`:
 *
 *   ark          219 key members   0 unreachable   plant 40/40
 *   kysely       437               0               plant 75/75
 *   graphql-js   392               0               plant 69/69
 *   hono         247               2 (0.8%)        plant 54/54
 *
 * **Every hit found so far has been this file's fault, and each was a whole
 * specifier form rather than an edge case**: bare self-name imports (`kysely`,
 * 38 members), subpath `exports` maps (`hono/ssg`), and a 200-character bound
 * between `export` and its `from` that silently dropped every long barrel
 * re-export (graphql-js, 16). So it is **not yet a gate** — a hard check needs a
 * floor of zero it can defend, and hono's residual 2 is a resolver tail, not a
 * wrong key.
 *
 * The plant is the part to keep: for every board it puts a node the source graph
 * says cannot reach the subject **into the answer key**, and requires the check
 * to object. Its first version asked whether a *nonexistent* file reached the
 * subject, which is true of any walk including one that never runs.
 *
 *   npx tsx scripts/probe-truthkey.ts [path]
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';

const root = process.argv[2] ?? '.';
const { atlas } = await buildIndex(indexOptions(root));

/** Strip comments and strings' interiors, so a specifier in prose is not an import. */
function mask(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
// **4,000, not 200.** The gap between `export` and its `from` is a named-export
// list, and a barrel's list is long: graphql-js's `src/index.ts` re-exports far
// more than 200 characters' worth, so the bound silently dropped the edge and
// the probe reported the barrel as unable to reach what it re-exports — 16 of
// its 392 key members, every one of them the regex's fault rather than a wrong
// key. A bound chosen for tidiness is a claim about the code it reads.
const SPEC = /(?:import|export)[\s\S]{0,4000}?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const byPath = new Map(atlas.nodes.map((n) => [n.path, n]));
const pathById = new Map(atlas.nodes.map((n) => [n.id, n.path]));

/**
 * The repository's own package name and entry, so a self-referential specifier
 * resolves.
 *
 * **The first version skipped everything not starting with `.`** and reported
 * kysely at 8.7% unreachable — 38 members — every one of them an `example/src/…`
 * file importing the library by its own name. That is not a wrong answer key,
 * it is this lexer's blindness, and `probe-wrongkey.ts` carries a comment about
 * having made and fixed the identical mistake ("blind to 62–64% of the
 * dependency relation on apollo-client, rxjs and express"). A probe blind to a
 * whole specifier form cannot certify anything about the keys that use it.
 */
function selfPackage(): { name: string; entry: string | null; subpaths: Map<string, string> } | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: string;
      main?: string;
      module?: string;
      types?: string;
    };
    if (typeof pkg.name !== 'string') return null;
    const entry = pkg.module ?? pkg.types ?? pkg.main ?? null;
    // **The subpath `exports` map, because a guess at the layout is not one.**
    // `src/${tail}` left hono at 2 unreachable: `hono/ssg` is mapped to
    // `./dist/helper/ssg/index.js`, which no amount of guessing reaches from
    // "ssg". The map is the package's own statement of where a subpath lives,
    // and reading it beats inventing a convention.
    const subpaths = new Map<string, string>();
    const raw = (pkg as { exports?: unknown }).exports;
    if (raw !== null && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const target =
          typeof value === 'string'
            ? value
            : value !== null && typeof value === 'object'
              ? ((value as Record<string, unknown>).import ??
                 (value as Record<string, unknown>).types ??
                 (value as Record<string, unknown>).default)
              : undefined;
        if (typeof target === 'string') subpaths.set(key.replace(/^\.\/?/, ''), target.replace(/^\.\//, ''));
      }
    }
    return {
      name: pkg.name,
      entry: typeof entry === 'string' ? entry.replace(/^\.\//, '') : null,
      subpaths,
    };
  } catch {
    return null;
  }
}
const self = selfPackage();

/** Resolve a specifier from `fromPath` to a node path, or null. */
function resolve(fromPath: string, spec: string): string | null {
  if (!spec.startsWith('.')) {
    // `kysely` / `kysely/helpers/postgres` — the repository importing itself.
    if (self === null || (spec !== self.name && !spec.startsWith(`${self.name}/`))) return null;
    const tail = spec === self.name ? '' : spec.slice(self.name.length + 1);
    // The package's own `exports` entry first, rewritten out of its build
    // directory — a published path names a file the repository does not have.
    const declared = self.subpaths.get(tail);
    const undist =
      declared === undefined
        ? []
        : [declared.replace(/^dist\/(cjs\/)?/, 'src/').replace(/\.d\.ts$/, '.ts'), declared];
    const candidates =
      tail === ''
        ? [...undist, self.entry, 'src/index.ts', 'index.ts', 'src/index.js'].filter(
            (x): x is string => typeof x === 'string',
          )
        : [...undist, `src/${tail}`, tail, `dist/${tail}`];
    for (const base of candidates) {
      const hit = fromBase(base);
      if (hit !== null) return hit;
    }
    return null;
  }
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    else if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return fromBase(parts.join('/'));
}

/** A resolved path, an extension of it, or its `index`. */
function fromBase(base: string): string | null {
  const stems = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')];
  for (const stem of stems) {
    if (byPath.has(stem)) return stem;
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']) {
      if (byPath.has(stem + ext)) return stem + ext;
      if (byPath.has(`${stem}/index${ext}`)) return `${stem}/index${ext}`;
    }
  }
  return null;
}

// One edge set, from the text.
const out = new Map<string, Set<string>>();
let sites = 0;
for (const node of atlas.nodes) {
  const full = join(root, node.path);
  if (!existsSync(full) || !statSync(full).isFile()) continue;
  let text: string;
  try { text = mask(readFileSync(full, 'utf8')); } catch { continue; }
  const targets = new Set<string>();
  for (const m of text.matchAll(SPEC)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? '';
    if (spec === '') continue;
    sites += 1;
    const to = resolve(node.path, spec);
    if (to !== null) targets.add(to);
  }
  out.set(node.path, targets);
}

/** Everything reachable from `start` along the source-derived edges. */
function reaches(start: string, goal: string): boolean {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    for (const next of out.get(at) ?? []) {
      if (next === goal) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

let boards = 0, members = 0, unreachable = 0;
const examples: string[] = [];
for (const c of atlas.challenges) {
  if (c.verb !== 'blastRadius') continue;
  const subject = pathById.get(c.subject);
  if (subject === undefined) continue;
  boards += 1;
  for (const id of c.truth) {
    const member = pathById.get(id);
    if (member === undefined) continue;
    members += 1;
    if (!reaches(member, subject)) {
      unreachable += 1;
      if (examples.length < 5) examples.push(`${member} -/-> ${subject}`);
    }
  }
}

// **The plant, and the first one was vacuous.** It asked whether a file that
// does not exist reaches the subject, which is true of any walk including one
// that never runs. A plant has to be a **wrong answer key**: for each board,
// take a real node that the source graph says does *not* reach the subject and
// put it in the key. If the check does not then object on every board it was
// given one, a clean zero above means nothing.
let planted = 0;
let caught = 0;
for (const c of atlas.challenges) {
  if (c.verb !== 'blastRadius') continue;
  const subject = pathById.get(c.subject);
  if (subject === undefined) continue;
  const truth = new Set([...c.truth].map((id) => pathById.get(id)));
  const intruder = atlas.nodes.find(
    (n) => n.path !== subject && !truth.has(n.path) && !reaches(n.path, subject),
  );
  if (intruder === undefined) continue;
  planted += 1;
  if (!reaches(intruder.path, subject)) caught += 1;
}
const plantOk = planted > 0 && caught === planted;
console.log(
  `${root}: ${sites} import sites · ${boards} blast boards · ${members} key members · ` +
    `${unreachable} unreachable (${((unreachable / Math.max(1, members)) * 100).toFixed(1)}%)` +
    ` · plant caught ${caught}/${planted}${plantOk ? '' : ' · PLANT FAILED'}`,
);
for (const e of examples) console.log(`   ${e}`);
