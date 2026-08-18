/**
 * Photograph the proved-chain layer at a point in a session where it has
 * something to say.
 *
 * `test:e2e` proves **one** board, so its `chains.png` shows two links on an
 * 847-edge map — which is a liveness check, not a look at the feature. This
 * builds a real save by grading real boards through `applyGrade`, injects it,
 * and shoots the map at three depths of a playthrough. The save is constructed
 * with the player's own code rather than hand-written JSON, so it cannot be a
 * shape the parser silently discards.
 *
 *   npx tsx scripts/shot-chains.ts [fraction …]     # default 0.1 0.5 1
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readFile } from 'node:fs/promises';
import { EMPTY_PROGRESS, applyGrade } from '../src/player/progress.js';
import { serializeProgress, storageKeyFor } from '../src/player/save.js';
import { parseAtlas } from '../src/atlas/index.js';
import { VERBS } from '../src/verbs/index.js';
import { channelOf } from '../src/verbs/index.js';

const ROOT = join(process.cwd(), 'dist', 'player');
const SHOT_DIR = join(process.cwd(), 'artifacts');
const atlas = parseAtlas(await readFile(join(ROOT, 'atlas.json'), 'utf8'));
const boards = atlas.challenges.filter((c) => channelOf(c.verb) === 'importRadius');
if (boards.length === 0) throw new Error('this atlas has no import-graded deck to photograph');

// The **built** artifact, served the way `test:e2e` serves it. A hand-rolled
// static server was tried first and hung on the module graph; this is the same
// preview the suite uses, so a shot here is a shot of what CI plays.
const server = await preview({ root: join(process.cwd(), 'src/player'), logLevel: 'warn' });
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('preview server exposed no url');

await mkdir(SHOT_DIR, { recursive: true });
const chromePath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const browser = await chromium.launch(chromePath === undefined ? {} : { executablePath: chromePath });

const fractions = process.argv.slice(2).length > 0 ? process.argv.slice(2).map(Number) : [0.1, 0.5, 1];
for (const fraction of fractions) {
  const take = Math.max(1, Math.round(boards.length * fraction));
  // A perfect answer on each: the upper bound on what the layer can hold, which
  // is the arm the gate has to survive.
  let progress = EMPTY_PROGRESS;
  for (const board of boards.slice(0, take)) {
    const verb = VERBS[board.verb as keyof typeof VERBS];
    if (verb === undefined) continue;
    progress = applyGrade(progress, board, verb.grade(board, { picked: [...board.truth] })).progress;
  }
  const key = storageKeyFor(atlas.repo);
  const saved = serializeProgress(progress);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(
    ([k, v]) => { globalThis.localStorage.setItem(k as string, v as string); },
    [key, saved],
  );
  await page.goto(url);
  await page.waitForSelector('canvas.map');
  await page.waitForFunction(
    () => /(\d+) chains/.test(document.querySelector('.hud-detail')?.textContent ?? ''),
    undefined,
    { timeout: 5000 },
  );
  const detail = (await page.locator('.hud-detail').innerText()).replace(/\s+/g, ' ').trim();
  process.stdout.write(`shot-chains: ${take}/${boards.length} boards answered → ${detail}\n`);
  await page.screenshot({ path: join(SHOT_DIR, `chains-${Math.round(fraction * 100)}.png`) });
  await page.close();
}

await browser.close();
await new Promise<void>((resolve, reject) =>
  server.httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
);
