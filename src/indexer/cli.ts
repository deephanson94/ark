#!/usr/bin/env node
/**
 * `ark index <path>` — the indexer's command line.
 *
 * Everything it prints is a measurement, not an estimate: node and edge counts,
 * how many imports it could not resolve, what it truncated, how big the atlas
 * came out and how long it took. Those are the numbers the budgets in CLAUDE.md
 * are written against, and printing them is how a regression gets noticed.
 */

import { existsSync, realpathSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  coverageSentence,
  isNodeId,
  serializeAtlas,
  sourceCoverage,
  unreadableList,
} from '../atlas/index.js';
import type { Atlas } from '../atlas/index.js';
import type { IndexResult } from './build.js';
import { buildIndex, indexOptions } from './build.js';
import { serveDirectory } from './serve.js';

/**
 * `index` writes an atlas and stops. `play` writes one into the built player
 * and serves it, which is the whole command a person needs.
 */
export type Command = 'index' | 'play';

interface Args {
  readonly command: Command;
  readonly root: string;
  readonly out: string;
  readonly quiet: boolean;
}

const USAGE = `ark — map a repo into an atlas, and play it

usage:
  ark play  <path>                     index a repo and open it in a browser
  ark index <path> [--out <file>]      write an atlas and stop

  <path>          repo to work on (default: the current directory)
  --out, -o       where to write the atlas (default: <path>/atlas.json)
  --quiet, -q     print nothing but errors

"play" needs the player built once: npm run build
`;

/**
 * Where `npm run build` puts the player. `play` serves this directory.
 *
 * **Resolved against the package, never against the working directory.** This
 * was `'dist/player'` — a bare relative path — for five milestones, which works
 * exactly when you run `ark play` from inside a checkout of ark and fails
 * everywhere else. `npx ark play ~/some/repo` runs with `cwd` at *your* repo,
 * where `dist/player` is either absent or, worse, somebody else's build output.
 *
 * The package root is the nearest ancestor of this module holding a
 * `package.json`. From source that is `src/indexer/` → the repo; from the
 * emitted tree it is `dist/cli/indexer/` → the installed package, because
 * `dist/` carries no manifest of its own. One rule, both modes.
 */
const PLAYER_DIST = join(packageRoot(), 'dist', 'player');

function packageRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, 'package.json'))) return directory;
    const parent = dirname(directory);
    // At the filesystem root `dirname` is a fixed point. Falling back to the
    // module's own directory keeps the error the caller sees a *missing player*
    // rather than a crash inside path arithmetic.
    if (parent === directory) return dirname(fileURLToPath(import.meta.url));
    directory = parent;
  }
}

export function parseArgs(argv: readonly string[]): Args | null {
  const command: Command = argv[0] === 'play' ? 'play' : 'index';
  const rest = argv[0] === 'index' || argv[0] === 'play' ? argv.slice(1) : [...argv];
  let root: string | null = null;
  let out: string | null = null;
  let quiet = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      out = rest[++i] ?? null;
      continue;
    }
    if (arg.startsWith('-')) return null;
    root ??= arg;
  }

  const rootPath = resolve(root ?? '.');
  // `play` writes the atlas where the built player will look for it, so the
  // person running it never has to know that `atlas.json` is the seam.
  const fallback = command === 'play' ? join(PLAYER_DIST, 'atlas.json') : `${rootPath}/atlas.json`;
  return { command, root: rootPath, out: resolve(out ?? fallback), quiet };
}

function summarise(
  atlas: Atlas,
  generation: IndexResult['generation'],
  bytes: number,
  milliseconds: number,
): string {
  const unresolved = atlas.nodes.reduce((total, node) => total + node.unresolved.length, 0);
  const probable = atlas.edges.filter((edge) => edge.confidence !== 'certain').length;
  const nodeLine = (a: Atlas): string => {
    const files = a.nodes.reduce((total, node) => total + node.fileCount, 0);
    const packages = a.nodes.filter((node) => node.kind === 'dir').length;
    return packages === 0
      ? `${a.nodes.length} files`
      : `${a.nodes.length} nodes (${packages} packages holding ${files - (a.nodes.length - packages)} files)`;
  };
  const coverage = sourceCoverage(atlas);
  const lines = [
    `repo        ${atlas.repo.name} @ ${atlas.repo.head?.slice(0, 12) ?? 'no commits'}`,
    // A node is a file everywhere except Go, where it is a package (ADR-0026),
    // so this line says both numbers when they differ and neither reader has to
    // guess which one it is looking at.
    `nodes       ${nodeLine(atlas)} across ${atlas.regions.length} regions`,
    `edges       ${atlas.edges.length} imports (${probable} needed a guess)`,
    `unresolved  ${unresolved} import(s) we could not pin down`,
    `history     ${atlas.history.commitsRetained}/${atlas.history.commitsWalked} commits kept, ${atlas.history.coChange.length} co-change pairs`,
  ];
  // A measurement, printed whenever it is non-zero, in a file whose whole
  // discipline is that it prints measurements rather than estimates. It is not
  // the alarm — that is the refusal below, and it fires on a threshold. This
  // line fires on a fact, which is why one shell script in this repo shows up
  // here and warns about nothing.
  if (coverage.unreadable > 0) {
    lines.push(
      `unreadable  ${unreadableList(coverage)} — recognised source the scanner cannot read`,
    );
  }
  if (generation === null) {
    // The deck was refused before a generator ran, so there are no per-verb
    // numbers to print and inventing four zeroed reports would say something
    // about the verbs that is not true (ADR-0025).
    lines.push(`deck        REFUSED: ${coverageSentence(coverage) ?? ''}`);
    lines.push(`atlas       ${(bytes / 1024).toFixed(1)} KiB in ${milliseconds} ms`);
    for (const truncation of atlas.report.truncations) {
      lines.push(`truncated   ${truncation.what}: kept ${truncation.kept}, dropped ${truncation.dropped}`);
    }
    for (const skip of atlas.report.skipped) {
      lines.push(`skipped     ${skip.count} ${skip.reason}`);
    }
    return lines.join('\n');
  }

  const blast = generation.blastRadius.report;
  const companion = generation.companion.report;
  const placement = generation.placement.report;
  const archaeology = generation.archaeology.report;
  lines.push(
    `blast       ${generation.blastRadius.challenges.length} of ${blast.subjectsConsidered} subjects with a radius`,
    `companion   ${generation.companion.challenges.length} of ${companion.subjectsConsidered} subjects with a change history`,
    `placement   ${generation.placement.challenges.length} of ${placement.commitsConsidered} commits Ark may ask about`,
    `archaeology ${generation.archaeology.challenges.length} of ${archaeology.subjectsConsidered} files with a history worth asking about`,
    `atlas       ${(bytes / 1024).toFixed(1)} KiB in ${milliseconds} ms`,
  );

  // Which questions each verb refused to ship, and how much of each choice set
  // came from a principled distractor strategy rather than padding. Both are
  // measurements about answer-key quality, and a generator that quietly
  // declines half a repo reads as success unless it says so (CLAUDE.md).
  for (const [reason, count] of blast.skipped) {
    if (reason === 'noDependents') continue; // not a refusal — nothing imports it
    lines.push(`blast       declined ${count} subject(s): ${reason}`);
  }
  if (blast.reasked > 0) {
    lines.push(`blast       re-asked ${blast.reasked} subject(s) with a second, disjoint answer key`);
  }
  for (const [reason, count] of companion.skipped) {
    if (reason === 'noCompanions') continue; // not a refusal — it changes alone
    lines.push(`companion   declined ${count} subject(s): ${reason}`);
  }
  if (companion.minCountRange !== null) {
    const [low, high] = companion.minCountRange;
    // The bar each answer key was actually measured at. Printed because it is
    // the number that says whether this verb is asking about real coupling or
    // about coincidence — a deck whose keys all rest on 2 shared commits is a
    // deck about a repo with no history worth reading yet.
    lines.push(`companion   answer keys rest on ${low}–${high} shared commits`);
  }
  if (companion.contestedNodes > 0) {
    lines.push(
      `companion   barred ${companion.contestedNodes} node(s) with contested rename lineage`,
    );
  }
  if (companion.capBit) {
    lines.push('companion   co-change pair cap bit — the certification bound rose above 1');
  }
  if (companion.walkTruncated) {
    // The whole-repo refusal, said out loud. Absence from a matrix built over
    // part of the history certifies nothing, so no question could be asked.
    lines.push(
      `companion   REFUSED the repo: the walk stopped at ${atlas.history.commitsWalked} commits,` +
        ' so absence from the co-change matrix proves nothing',
    );
  }

  for (const [reason, count] of placement.skipped) {
    if (reason === 'shallowClone') continue; // said in full below
    lines.push(`placement   declined ${count} commit(s): ${reason}`);
  }
  if (placement.shallow) {
    // The whole-repo refusal, said out loud. A shallow clone's oldest commit is
    // diffed against the empty tree, so git reports it as adding the whole
    // worktree — an answer key naming files it never touched (ADR-0018).
    lines.push(
      'placement   REFUSED the repo: a shallow clone records its oldest commit as adding' +
        ' the entire worktree, so its file list is not its own change',
    );
  }
  if (placement.keyRange !== null) {
    const [narrowest, widest] = placement.keyRange;
    // How wide the shipped keys are, and how many of them are a *sample* of a
    // wider commit. A deck of one-file answers is a deck about a repo whose
    // commits never cross a boundary, which is worth knowing before reading
    // anything into the scores.
    lines.push(
      `placement   answer keys hold ${narrowest}–${widest} files; ${placement.sampled} sampled from a wider commit`,
    );
  }
  if (placement.fileCap !== null) {
    lines.push(
      `placement   commit file lists were cut at ${placement.fileCap} — commits at or over it are refused`,
    );
  }

  for (const [reason, count] of archaeology.skipped) {
    lines.push(`archaeology declined ${count} file(s): ${reason}`);
  }
  if (archaeology.keyRange !== null) {
    const [narrowest, widest] = archaeology.keyRange;
    lines.push(
      `archaeology answer keys hold ${narrowest}–${widest} commits; ${archaeology.sampled} sampled from a longer history`,
    );
  }
  // **The gate's firings, per heuristic, and this line is not decoration.**
  // ADR-0019 measured each of the four as live on exactly *one* of two repos —
  // so a session reading a zero here on this repo must not conclude the
  // heuristic is dead, and one reading a zero on hono must not either. Printing
  // the split is how the next person finds that out without re-running the
  // measurement. CLAUDE.md's landmine: count how many times a path fires on a
  // real repo before writing tests around it.
  const fired = archaeology.heuristicFirings.filter(([, count]) => count > 0);
  if (fired.length > 0) {
    lines.push(
      `archaeology ctrl-F refusals by guess: ${fired.map(([id, n]) => `${id} ${n}`).join(', ')}`,
    );
  }
  if (archaeology.shallow) {
    lines.push(
      'archaeology REFUSED the repo: a shallow clone records its oldest commit as adding' +
        ' the entire worktree, so it would enter every file’s answer key',
    );
  }

  // The cost of every refusal above, in the currency the player feels: how much
  // of the map can never come out of the fog, because `progress.ts` promotes a
  // node only as a subject or as a picked answer. Reported for the two verbs
  // *together*, because a node either verb can reveal is not dark.
  const provable = new Set<string>();
  for (const challenge of atlas.challenges) {
    // `isNodeId` because a commit is not a node and cannot come out of the fog.
    // Counting one here would overstate coverage — a report about the map,
    // inflated by things not on it.
    //
    // **On both roles, and the second was missing.** The subject filter landed
    // with Placement; the member loop below did not, because at the time a
    // member was always a file. Archaeology's members are commits, so an
    // unfiltered loop would add ~4 phantom ids per board to a set whose size is
    // then subtracted from the node count — understating `unprovable` by
    // hundreds on a repo where nothing had changed. The comment one line up was
    // right about the class and applied to half of it.
    if (isNodeId(challenge.subject)) provable.add(challenge.subject);
    for (const id of challenge.truth) if (isNodeId(id)) provable.add(id);
  }
  lines.push(
    `unprovable  ${atlas.nodes.length - provable.size} of ${atlas.nodes.length} node(s) no question can reveal` +
      ` (blast alone would leave ${blast.unprovableNodes})`,
  );

  for (const [label, mix] of [
    ['blast     ', blast.distractorMix],
    ['companion ', companion.distractorMix],
    ['placement ', placement.distractorMix],
    ['archaeol. ', archaeology.distractorMix],
  ] as const) {
    const text = mix
      .filter(([, count]) => count > 0)
      .map(([strategy, count]) => `${strategy} ${count}`)
      .join(', ');
    if (text.length > 0) lines.push(`distractors ${label} ${text}`);
  }
  for (const truncation of atlas.report.truncations) {
    lines.push(`truncated   ${truncation.what}: kept ${truncation.kept}, dropped ${truncation.dropped}`);
  }
  for (const skip of atlas.report.skipped) {
    lines.push(`skipped     ${skip.count} ${skip.reason}`);
  }
  return lines.join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    process.stdout.write(USAGE);
    return 0;
  }

  const started = Date.now();
  const { atlas, generation } = await buildIndex(indexOptions(args.root));
  const text = serializeAtlas(atlas);
  // The player's `public/` directory is generated and gitignored, so on a fresh
  // clone it does not exist yet and `--out` into it would fail with ENOENT.
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, text, 'utf8');

  if (!args.quiet) {
    process.stdout.write(
      `${summarise(atlas, generation, Buffer.byteLength(text), Date.now() - started)}\n`,
    );
    process.stdout.write(`written     ${args.out}\n`);
  }

  // **The guard, above the command split on purpose.**
  //
  // It used to sit sixty lines below, after `serveDirectory`, so `ark index` —
  // which is what `npm run index`, `scripts/budget.ts` and every measurement in
  // ADR-0024 run — could not reach it however loudly it fired. Two independent
  // reasons it never fired are recorded in that document's §8; this is the
  // second of them, and moving the branch is half the fix. The other half is the
  // predicate: `challenges.length === 0` cannot see a deck of 144 questions
  // about a Go repository's documentation, which is the failure that actually
  // happens (ADR-0025).
  //
  // Both cases are kept. A refused deck and an empty one are different facts
  // with different remedies, and the second is still live: a repo ark reads
  // perfectly can produce no questions if it has one file and no history.
  const coverage = sourceCoverage(atlas);
  if (coverage.deckRefused) {
    process.stderr.write(`note: ${coverageSentence(coverage) ?? ''}\n`);
  } else if (atlas.challenges.length === 0) {
    process.stderr.write(
      `note: this repo produced no challenges — ark can read its source, and no\n` +
        `generator found anything to ask about. ${args.command === 'play' ? 'The map is still playable' : 'The atlas is still valid'}.\n`,
    );
  }
  if (args.command === 'index') return 0;

  // `play`: serve the built player next to the atlas we just wrote.
  //
  // The build is *not* run from here on purpose. Shelling out to vite would
  // make the indexer depend on the player's toolchain, and the two halves of
  // this product are deliberately independent (NORTH-STAR §7) — the player is a
  // pure function of the atlas and the indexer must never need to know how it
  // is bundled. So this checks, and says exactly what to run.
  const distributionRoot = dirname(args.out);
  try {
    await access(join(distributionRoot, 'index.html'));
  } catch {
    process.stderr.write(
      `the player is not built yet — run \`npm run build\` once, then \`ark play\` again\n` +
        `  (looked for ${join(distributionRoot, 'index.html')})\n`,
    );
    return 1;
  }

  const served = await serveDirectory(distributionRoot);
  process.stdout.write(`\nplaying ${atlas.repo.name} — ${served.url}\n`);
  process.stdout.write(`press ctrl-c to stop\n`);
  // Resolve only when the process is interrupted, so the server stays up.
  await new Promise<void>((stop) => {
    const shutdown = (): void => {
      void served.close().then(stop);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return 0;
}

/**
 * Is this module the program, or was it imported?
 *
 * **Through `realpath` on both sides, which is the whole of it.** npm installs a
 * `bin` as a *symlink* at `node_modules/.bin/ark`, so `process.argv[1]` is that
 * link and `import.meta.url` is the file it points at — the naive comparison is
 * false for every installed copy. The failure is silent and total: `main` never
 * runs, nothing is printed, and the process exits **0**, which is how a packaged
 * CLI can look like it worked and write no atlas. Found by packing the tarball
 * and running it, not by reading (`scripts/pack-check.ts`).
 *
 * `realpathSync` throws on a path that does not exist, which `argv[1]` can be
 * under some launchers, so the whole thing is guarded rather than the compare.
 */
function isEntryPoint(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return pathToFileURL(realpathSync(argv1)).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
  } catch {
    return pathToFileURL(argv1).href === import.meta.url;
  }
}

if (isEntryPoint(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
