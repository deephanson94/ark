/**
 * `ark index <path>` — the indexer's command line.
 *
 * Everything it prints is a measurement, not an estimate: node and edge counts,
 * how many imports it could not resolve, what it truncated, how big the atlas
 * came out and how long it took. Those are the numbers the budgets in CLAUDE.md
 * are written against, and printing them is how a regression gets noticed.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { isNodeId, serializeAtlas } from '../atlas/index.js';
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

/** Where `npm run build` puts the player. `play` serves this directory. */
const PLAYER_DIST = 'dist/player';

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
  const blast = generation.blastRadius.report;
  const companion = generation.companion.report;
  const placement = generation.placement.report;
  const lines = [
    `repo        ${atlas.repo.name} @ ${atlas.repo.head?.slice(0, 12) ?? 'no commits'}`,
    `nodes       ${atlas.nodes.length} files across ${atlas.regions.length} regions`,
    `edges       ${atlas.edges.length} imports (${probable} needed a guess)`,
    `unresolved  ${unresolved} import(s) we could not pin down`,
    `history     ${atlas.history.commitsRetained}/${atlas.history.commitsWalked} commits kept, ${atlas.history.coChange.length} co-change pairs`,
    `blast       ${generation.blastRadius.challenges.length} of ${blast.subjectsConsidered} subjects with a radius`,
    `companion   ${generation.companion.challenges.length} of ${companion.subjectsConsidered} subjects with a change history`,
    `placement   ${generation.placement.challenges.length} of ${placement.commitsConsidered} commits Ark may ask about`,
    `atlas       ${(bytes / 1024).toFixed(1)} KiB in ${milliseconds} ms`,
  ];

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
    lines.push(`placement   declined ${count} commit(s): ${reason}`);
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

  // The cost of every refusal above, in the currency the player feels: how much
  // of the map can never come out of the fog, because `progress.ts` promotes a
  // node only as a subject or as a picked answer. Reported for the two verbs
  // *together*, because a node either verb can reveal is not dark.
  const provable = new Set<string>();
  for (const challenge of atlas.challenges) {
    // `isNodeId` because a commit subject is not a node and cannot come out of
    // the fog. Counting it here would have overstated coverage by one per
    // Placement question — a report about the map, inflated by things not on it.
    if (isNodeId(challenge.subject)) provable.add(challenge.subject);
    for (const id of challenge.truth) provable.add(id);
  }
  lines.push(
    `unprovable  ${atlas.nodes.length - provable.size} of ${atlas.nodes.length} node(s) no question can reveal` +
      ` (blast alone would leave ${blast.unprovableNodes})`,
  );

  for (const [label, mix] of [
    ['blast     ', blast.distractorMix],
    ['companion ', companion.distractorMix],
    ['placement ', placement.distractorMix],
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
  if (atlas.challenges.length === 0) {
    // Better to say it than to hand someone a map with no game on it. On a
    // Python or Go repo this is the expected outcome until M5: the scanner is
    // ES-modules only (§7.2), so there are no edges and therefore no radius.
    process.stderr.write(
      `note: this repo produced no challenges. If it is not JavaScript or\n` +
        `TypeScript, that is expected — the v1 scanner reads ES modules only.\n`,
    );
  }
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

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
