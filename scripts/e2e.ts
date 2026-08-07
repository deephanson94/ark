/**
 * `npm run test:e2e` — build the player, serve the built output, drive it in a
 * real browser.
 *
 * This is the slow suite, and CLAUDE.md says to ask before running it on a
 * small change. It exists because two items in the definition of done cannot be
 * checked any other way: "no console errors in the player", and whether the map
 * is legible — which needs a picture, not an assertion.
 *
 * It tests the *built* artifact rather than the dev server, because the thing
 * that ships is the bundle.
 *
 * Everything it starts, it stops. An orphaned preview server holds a port and
 * breaks the next run.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import type { ConsoleMessage } from 'playwright';
import { build, preview } from 'vite';

import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ATLAS_OUT = join(ROOT, 'src/player/public/atlas.json');
const SHOT_DIR = join(ROOT, 'artifacts');

/**
 * Where to find a browser.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` lets an environment point at a Chromium it already
 * has, which matters when the installed Playwright expects a different browser
 * build than the one on the machine — the failure is
 * "Executable doesn't exist at .../chromium_headless_shell-1234/...", and
 * downloading a second copy to fix it is the wrong trade in CI.
 */
const CHROMIUM_PATH = process.env['PLAYWRIGHT_CHROMIUM_PATH'];

interface Failure {
  readonly what: string;
  readonly detail: string;
}

async function indexForPlayer(): Promise<number> {
  const atlas = await buildAtlas(indexOptions(ROOT));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  return atlas.nodes.length;
}

async function main(): Promise<number> {
  const failures: Failure[] = [];
  const nodeCount = await indexForPlayer();
  process.stdout.write(`e2e: indexed ${nodeCount} nodes\n`);

  await build({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
  const server = await preview({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('preview server did not report a URL');
  process.stdout.write(`e2e: serving ${url}\n`);

  const browser = await chromium.launch(
    CHROMIUM_PATH === undefined
      ? { args: ['--no-sandbox'] }
      : { executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] },
  );
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const consoleErrors: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) =>
      consoleErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
    );

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.map', { timeout: 15_000 });

    // The atlas failing to load renders a fatal panel instead of a map.
    const fatal = await page.locator('.fatal pre').count();
    if (fatal > 0) {
      failures.push({ what: 'atlas load', detail: (await page.locator('.fatal pre').innerText()).trim() });
    }

    // Did anything actually get drawn? A canvas of one flat colour is a canvas
    // that rendered nothing, and it looks identical to success from the outside.
    const distinctColours = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.map');
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const context = canvas.getContext('2d');
      if (context === null) return 0;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
        if (seen.size > 64) break;
      }
      return seen.size;
    });
    if (distinctColours < 8) {
      failures.push({ what: 'render', detail: `canvas has only ${distinctColours} distinct colours` });
    }

    // First paint, against the 1.5 s ceiling in CLAUDE.md. `npm run budget`
    // cannot measure this — it needs a browser — so it is measured here and
    // printed alongside the rest.
    const paintMs = await page.evaluate(() => {
      const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
      return paint?.startTime ?? Number.NaN;
    });
    if (Number.isFinite(paintMs)) {
      process.stdout.write(`e2e: first contentful paint ${paintMs.toFixed(0)} ms (ceiling 1500)\n`);
      if (paintMs > 1500) {
        failures.push({ what: 'budget', detail: `first paint ${paintMs.toFixed(0)} ms exceeds 1500 ms` });
      }
    }

    const hud = (await page.locator('.hud-counts').innerText()).trim();
    if (!hud.includes(`${nodeCount} files`)) {
      failures.push({ what: 'hud', detail: `expected "${nodeCount} files", got "${hud}"` });
    }
    const surveyedAtStart = Number.parseInt(hud.split('·')[1]?.trim() ?? '0', 10);
    if (surveyedAtStart < 3) {
      // §4's loop starts "pick a landmark", so some must be visible to pick.
      failures.push({ what: 'landmarks', detail: `only ${surveyedAtStart} named on arrival` });
    }

    // Find a node by hit-testing a grid, which exercises the real pick() path.
    const box = await page.locator('canvas.map').boundingBox();
    if (box === null) throw new Error('canvas has no bounding box');
    const hits: { x: number; y: number; path: string }[] = [];
    const seenPaths = new Set<string>();
    for (let row = 1; row < 12 && hits.length < 6; row++) {
      for (let column = 1; column < 18 && hits.length < 6; column++) {
        const x = box.x + (box.width * column) / 18;
        const y = box.y + (box.height * row) / 12;
        await page.mouse.move(x, y);
        if ((await page.locator('.inspector-path').count()) === 0) continue;
        const path = (await page.locator('.inspector-path').innerText()).trim();
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);
        hits.push({ x, y, path });
      }
    }
    const hit = hits[0] ?? null;

    if (hit === null) {
      failures.push({ what: 'hover', detail: 'no node found anywhere on the map' });
    } else {
      process.stdout.write(`e2e: found ${hits.map((entry) => entry.path).join(', ')}\n`);

      // Click several distinct nodes rather than one. The highest-degree files
      // start surveyed as landmarks, so clicking a single node can legitimately
      // leave the count unchanged — the assertion has to be that surveying
      // *works*, not that any given disc was unsurveyed.
      for (const entry of hits) await page.mouse.click(entry.x, entry.y);

      // The HUD repaints on the next animation frame, not synchronously on the
      // click, so reading it immediately reads the previous frame.
      const grew = await page
        .waitForFunction(
          (start: number) => {
            const text = document.querySelector('.hud-counts')?.textContent ?? '';
            const match = /(\d+) surveyed/.exec(text);
            return match?.[1] !== undefined && Number.parseInt(match[1], 10) > start;
          },
          surveyedAtStart,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!grew) {
        const actual = (await page.locator('.hud-counts').innerText()).trim();
        failures.push({
          what: 'survey',
          detail: `clicking ${hits.length} nodes did not raise surveyed above ${surveyedAtStart}: "${actual}"`,
        });
      }
    }

    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SHOT_DIR, 'map-fit.png') });

    // Zoomed in, to check semantic zoom actually promotes detail.
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOT_DIR, 'map-zoomed.png') });
    const zoomLevel = (await page.locator('.hud-detail').innerText()).trim();
    process.stdout.write(`e2e: after zoom → ${zoomLevel}\n`);

    for (const error of consoleErrors) failures.push({ what: 'console', detail: error });
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  if (failures.length > 0) {
    process.stderr.write('\ne2e failures:\n');
    for (const failure of failures) process.stderr.write(`  [${failure.what}] ${failure.detail}\n`);
    return 1;
  }
  process.stdout.write(`e2e: clean — screenshots in ${SHOT_DIR}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
