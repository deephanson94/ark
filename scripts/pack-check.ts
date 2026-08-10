/**
 * Does `npx ark` actually work?
 *
 * `CLAUDE.md`'s Definition of done carried *"`npx ark index .` still works"* for
 * four milestones while it **had never worked** — `package.json` had no `bin`,
 * and `build` typechecks the indexer with `--noEmit` rather than emitting it, so
 * there was nothing for `npx` to resolve. A checklist item nobody can literally
 * satisfy gets ticked from memory, which is the failure mode that list exists to
 * prevent. So the item is now a script.
 *
 * **It packs the real tarball and installs it somewhere that is not this repo.**
 * That is the whole point and it is not paranoia: every path bug this exercise
 * exists to catch is invisible from inside a checkout, because a checkout has a
 * `dist/player` at the working directory and an installed package does not.
 * Reasoning that it should work is what produced the four milestones.
 *
 * The gates, because a check that measures nothing looks exactly like good news:
 *
 *  - the tarball must contain `dist/cli/indexer/cli.js` **and** the built player;
 *  - the installed binary must be resolvable as `ark`, not by path;
 *  - `ark index` must write an atlas the **validator** accepts, over a fixture
 *    repo with real git history that this script creates outside the repo;
 *  - `ark play` must serve that atlas and answer with the player's HTML, from a
 *    working directory with no `dist/` in it at all.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { validateAtlas } from '../src/atlas/index.js';

const run = promisify(execFile);
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

function fail(message: string): never {
  process.stderr.write(`pack-check: ${message}\n`);
  process.exit(1);
}

/**
 * A repo big enough to produce a **deck**, with history to read.
 *
 * Size is the gate rather than tidiness: a four-file fixture indexes to a valid
 * atlas with **zero** challenges, so asserting on nodes and edges alone would
 * never touch `src/verbs/` and the check would pass with the whole generator
 * missing from the tarball. A hub with nine dependents and nine unrelated files
 * clears ADR-0007's `|candidates| > 3·|truth|`.
 */
async function fixtureRepo(at: string): Promise<void> {
  const git = (...args: string[]): Promise<unknown> =>
    run('git', args, { cwd: at, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } });
  await mkdir(join(at, 'src'), { recursive: true });
  await writeFile(join(at, 'package.json'), '{"name":"fixture","type":"module"}\n');
  await writeFile(join(at, 'src/core.ts'), 'export const core = 1;\n');
  for (let i = 0; i < 9; i++) {
    await writeFile(join(at, `src/leaf${i}.ts`), `import { core } from './core.js';\nexport const leaf${i} = core;\n`);
    await writeFile(join(at, `src/lone${i}.ts`), `export const lone${i} = ${i};\n`);
  }
  await git('init', '-q');
  await git('config', 'user.email', 'pack-check@example.com');
  await git('config', 'user.name', 'pack check');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'first');
  for (let commit = 0; commit < 4; commit++) {
    await writeFile(join(at, `src/leaf${commit}.ts`), `import { core } from './core.js';\nexport const leaf${commit} = core + ${commit};\n`);
    await writeFile(join(at, 'src/core.ts'), `export const core = ${commit + 1};\n`);
    await git('add', '-A');
    await git('commit', '-q', '-m', `change ${commit}`);
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, 'dist', 'player', 'index.html'))) {
    fail('the player is not built — run `npm run build` first');
  }

  const workspace = await mkdtemp(join(tmpdir(), 'ark-pack-'));
  const install = join(workspace, 'install');
  const repo = join(workspace, 'repo');
  await mkdir(install, { recursive: true });
  await mkdir(repo, { recursive: true });

  try {
    // `--ignore-scripts` so `prepack` does not re-run the build we just checked
    // for; this script is about the *packaging*, and rebuilding here would let
    // a stale `dist/` pass by being quietly refreshed.
    const packed = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workspace], {
      cwd: ROOT,
      maxBuffer: 1 << 26,
    });
    const [meta] = JSON.parse(packed.stdout) as { filename: string; files: { path: string }[] }[];
    if (meta === undefined) fail('npm pack produced no tarball');
    const contents = new Set(meta.files.map((file) => file.path));
    for (const required of ['dist/cli/indexer/cli.js', 'dist/player/index.html', 'package.json']) {
      if (!contents.has(required)) fail(`the tarball is missing ${required}`);
    }
    if (![...contents].some((path) => path.startsWith('dist/player/assets/'))) {
      fail('the tarball carries no player bundle');
    }
    process.stdout.write(`pack-check: tarball ${meta.filename} — ${contents.size} files\n`);

    await writeFile(join(install, 'package.json'), '{"name":"ark-pack-check","private":true}\n');
    await run('npm', ['install', '--no-audit', '--no-fund', '--silent', join(workspace, meta.filename)], {
      cwd: install,
      maxBuffer: 1 << 26,
    });
    const binary = join(install, 'node_modules', '.bin', 'ark');
    if (!existsSync(binary)) fail('installing the tarball produced no `ark` binary');

    await fixtureRepo(repo);

    // **From `install`, which has no `dist/` of its own.** Running this from the
    // repo would resolve `dist/player` by accident and prove nothing.
    const indexed = await run(binary, ['index', repo], { cwd: install, maxBuffer: 1 << 26 });
    const atlasPath = join(repo, 'atlas.json');
    if (!existsSync(atlasPath)) fail(`\`ark index\` wrote no atlas at ${atlasPath}`);
    const atlas = validateAtlas(JSON.parse(await readFile(atlasPath, 'utf8')));
    if (atlas.nodes.length === 0) fail('the atlas has no nodes');
    if (atlas.edges.length === 0) fail('the atlas has no edges — the scanner did not run');
    // Without this the check passes with `src/verbs/` missing from the tarball
    // entirely: a valid atlas and an empty deck are the same shape.
    if (atlas.challenges.length === 0) fail('the atlas has no challenges — the generators did not run');
    process.stdout.write(
      `pack-check: ark index → ${atlas.nodes.length} nodes, ${atlas.edges.length} edges,` +
        ` ${atlas.challenges.length} challenges\n`,
    );
    if (!indexed.stdout.includes('written')) fail('`ark index` printed no report');

    // `ark play` holds the process open, so it is spawned and killed rather than
    // awaited. What is asserted is that it serves the **player**, from a working
    // directory that has no player in it.
    const played = await serve(binary, repo, install);
    // The bundle, not merely *some* HTML: a placeholder page would satisfy a
    // check for `id="app"` alone, and what is being proved here is that the
    // packaged `dist/player` is the thing being served.
    if (!played.includes('id="app"') || !/<script[^>]+src="\.\/assets\/index-[^"]+\.js"/.test(played)) {
      fail(`\`ark play\` served something that is not the player: ${played.slice(0, 200)}`);
    }
    process.stdout.write('pack-check: ark play → served the player\n');
    process.stdout.write('pack-check: ok\n');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Start `ark play`, fetch its root document, stop it. */
async function serve(binary: string, repo: string, cwd: string): Promise<string> {
  const { spawn } = await import('node:child_process');
  const child = spawn(binary, ['play', repo], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  try {
    const url = await new Promise<string>((settle, reject) => {
      const timer = setTimeout(() => reject(new Error(`\`ark play\` printed no url:\n${output}`)), 60_000);
      const poll = setInterval(() => {
        const match = /http:\/\/\S+/.exec(output);
        if (match !== null) {
          clearInterval(poll);
          clearTimeout(timer);
          settle(match[0]);
        }
      }, 100);
      child.once('exit', (code) => {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error(`\`ark play\` exited with ${code}:\n${output}`));
      });
    });
    const response = await fetch(url);
    return await response.text();
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
