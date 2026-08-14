/**
 * A look at the walkable world, from inside it, without playing a game.
 *
 * `npm run test:e2e` already screenshots the world, but from wherever the
 * playthrough leaves the hero — which is the shore. A visual change *inside*
 * the city needs pictures taken inside the city, and this repo's rule is to
 * look at the artifacts rather than at the assertion count.
 *
 *   npx tsx scripts/shot-world.ts            # this repo
 *   npx tsx scripts/shot-world.ts /path/repo
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build, preview } from 'vite';

import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOT_DIR = join(ROOT, 'artifacts');
const repo = process.argv[2] ?? ROOT;

const atlas = await buildAtlas(indexOptions(repo));
await mkdir(SHOT_DIR, { recursive: true });
await writeFile(join(ROOT, 'src/player/public/atlas.json'), serializeAtlas(atlas));
process.stdout.write(`shot: ${atlas.nodes.length} nodes, ${atlas.regions.length} regions\n`);

await build({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
const server = await preview({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('preview server did not report a URL');

const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const browser = await chromium.launch(
  chromiumPath === undefined
    ? { args: ['--no-sandbox'] }
    : { executablePath: chromiumPath, args: ['--no-sandbox'] },
);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (message) => {
    if (message.type() === 'error') process.stdout.write(`console error: ${message.text()}\n`);
  });
  await page.goto(url);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(700);
  await page.keyboard.press('g');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOT_DIR, 'world-shore.png') });
  process.stdout.write(`shore: ${(await page.locator('.hud-detail').innerText()).trim()}\n`);

  // Walk in, turning between bursts, so the pictures are of different streets
  // rather than five frames of one.
  for (let leg = 0; leg < 5; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(2400);
    await page.keyboard.up('w');
    await page.waitForTimeout(220);
    await page.screenshot({ path: join(SHOT_DIR, `world-leg${leg}.png`) });
    process.stdout.write(
      `leg ${leg}: ${(await page.locator('.hud-detail').innerText()).trim()}\n`,
    );
    const turn = leg % 2 === 0 ? 'e' : 'q';
    await page.keyboard.down(turn);
    await page.waitForTimeout(430);
    await page.keyboard.up(turn);
  }
} finally {
  await browser.close();
  await server.close();
}
