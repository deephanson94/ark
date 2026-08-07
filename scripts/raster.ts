/**
 * `npm run raster` — close the last UNMEASURED budget: map interaction at 2,000
 * nodes, including raster cost.
 *
 * This is [ADR-0009](../docs/decisions/0009-third-person-is-a-presentation-layer-over-the-same-atlas.md)'s
 * precondition **P3**, which that ADR assigns to M3: *"`npm run budget` currently
 * reports map interaction as UNMEASURED for raster cost. Closing that hole is
 * small, belongs in M3, and must happen **before** a new renderer arrives —
 * otherwise we cannot tell whether 3D regressed something we never measured."*
 *
 * `tests/unit/scene.test.ts` already measures **culling** at 2,000 nodes and it
 * is fast (<8 ms). Culling is not the budget. The budget is the frame, and a
 * frame is dominated by things no headless unit test touches: filling several
 * thousand arcs, stroking edges, laying out and measuring text, and the
 * compositor. So this drives the **real built player** in a **real browser**
 * against a **2,000-node atlas** and times actual frames.
 *
 * ## Why a synthetic repo
 *
 * The ceilings in CLAUDE.md are quoted at 2,000 files; this repo has ~95. A
 * measurement at 95 nodes would pass forever and catch nothing. The fixture is a
 * 20-layer graph run through the **real layout**, so the positions have the
 * clustering and density the renderer actually has to cope with — a grid of
 * evenly spaced dots would understate overdraw, which is exactly the cost being
 * measured. Point `ARK_RASTER_REPO` at a large clone to measure a real one
 * instead; the numbers from both are reported the same way.
 *
 * ## What is measured
 *
 * Frame time while the map is **moving**, at each zoom level, because a static
 * map costs nothing — the player only redraws when something invalidates. The
 * headline is the **95th percentile**: a median that clears 50 fps while one
 * frame in ten stutters is not a map that feels good, and feel is the budget's
 * whole point.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build, preview } from 'vite';

import type { Atlas } from '../src/atlas/index.js';
import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ATLAS_OUT = join(ROOT, 'src/player/public/atlas.json');
const CHROMIUM_PATH = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const SCALE_REPO = process.env['ARK_RASTER_REPO'];

/** The scale CLAUDE.md's ceilings are quoted at. */
const REFERENCE_FILES = 2000;
/** ≥ 50 fps means a frame must land inside this. */
const FRAME_BUDGET_MS = 1000 / 50;

async function fixtureAtlas(): Promise<Atlas> {
  const { atlasWith } = await import('../tests/fixtures/atlas.js');
  const { computeLayout, DEFAULT_LAYOUT_OPTIONS } = await import('../src/indexer/layout.js');
  const { detectRegions } = await import('../src/indexer/regions.js');
  const { round2 } = await import('../src/atlas/index.js');

  const layers = 20;
  const per = REFERENCE_FILES / layers;
  const name = (layer: number, index: number): string =>
    `src/l${String(layer).padStart(2, '0')}/f${String(index).padStart(3, '0')}.ts`;

  const paths: string[] = [];
  for (let layer = 0; layer < layers; layer++) {
    for (let i = 0; i < per; i++) paths.push(name(layer, i));
  }
  const links: (readonly [string, string])[] = [];
  for (let layer = 1; layer < layers; layer++) {
    for (let i = 0; i < per; i++) {
      for (let k = 0; k < 3; k++) links.push([name(layer, i), name(layer - 1, (i * 7 + k * 13) % per)]);
    }
  }

  const flat = atlasWith(paths, links);
  // The fixture places nodes trivially. Run the *real* layout over it, or the
  // measurement understates overdraw — which is the cost being measured.
  const detected = detectRegions(
    flat.nodes.map((node) => node.path),
    flat.edges,
  );
  const groupByRef = new Array<number>(flat.nodes.length).fill(0);
  for (const [index, region] of detected.entries()) {
    for (const member of region.members) groupByRef[member] = index;
  }
  const positions = computeLayout(flat.nodes.length, flat.edges, DEFAULT_LAYOUT_OPTIONS, groupByRef);
  const regionById = new Map<number, string>();
  for (const region of detected) for (const member of region.members) regionById.set(member, region.id);

  return {
    ...flat,
    nodes: flat.nodes.map((node, ref) => ({
      ...node,
      layout: positions[ref] ?? [0, 0],
      region: regionById.get(ref) ?? flat.regions[0]?.id ?? 'root',
    })),
    regions: detected.map((region) => {
      let sumX = 0;
      let sumY = 0;
      for (const member of region.members) {
        const point = positions[member] ?? [0, 0];
        sumX += point[0];
        sumY += point[1];
      }
      const size = Math.max(1, region.members.length);
      return {
        id: region.id,
        label: region.label,
        nodeCount: region.members.length,
        centroid: [round2(sumX / size), round2(sumY / size)] as const,
        kind: region.kind,
      };
    }),
  };
}

interface Sample {
  readonly level: string;
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
}

/** A cheap hash of everything currently on the canvas. */
async function canvasSignature(page: import('playwright').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.map');
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const context = canvas.getContext('2d');
    if (context === null) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4001) hash = Math.imul(hash ^ (data[i] ?? 0), 16777619);
    return hash >>> 0;
  });
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index] ?? Number.NaN;
}

async function main(): Promise<number> {
  const atlas =
    SCALE_REPO === undefined || SCALE_REPO === ''
      ? await fixtureAtlas()
      : await buildAtlas(indexOptions(SCALE_REPO));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  process.stdout.write(
    `raster: ${atlas.nodes.length} nodes, ${atlas.edges.length} edges, ${atlas.regions.length} regions` +
      `${SCALE_REPO === undefined ? ' (synthetic)' : ` (${atlas.repo.name})`}\n`,
  );

  await build({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
  const server = await preview({ root: join(ROOT, 'src/player'), logLevel: 'warn' });
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('preview server did not report a URL');

  const browser = await chromium.launch(
    CHROMIUM_PATH === undefined
      ? { args: ['--no-sandbox'] }
      : { executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] },
  );
  const samples: Sample[] = [];
  const repaintRatio: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.map', { timeout: 30_000 });

    // Three zoom levels, because the renderer does genuinely different work at
    // each: territory hides node labels, street draws every one of them.
    //
    // The scale is reached by wheeling and then *read back* from the HUD rather
    // than assumed. A first version nudged from wherever `fit()` landed and
    // silently measured district, street and street again — territory, the one
    // level with a different draw path, was never sampled at all.
    // One rAF chain, installed once. Passed as a **string**, not a closure:
    // tsx transpiles this file with esbuild's keepNames on, which wraps any
    // named inner function in a `__name` helper that does not exist in the page
    // and fails the evaluate at runtime.
    await page.evaluate(`
      window.__raster = { times: [], last: performance.now() };
      window.__rasterTick = function () {
        var now = performance.now();
        window.__raster.times.push(now - window.__raster.last);
        window.__raster.last = now;
        requestAnimationFrame(window.__rasterTick);
      };
      requestAnimationFrame(window.__rasterTick);
    `);

    // Gently: wheeling out hard drives the scale into `clampScale`'s floor,
    // where 2,000 nodes render as a sub-pixel smudge and a pan changes no
    // pixels at all — which reads as "the map is not moving" and is really
    // "there is nothing left to see".
    for (const [wanted, wheels] of [
      ['territory', -3],
      ['district', 4],
      ['street', 6],
    ] as const) {
      for (let i = 0; i < Math.abs(wheels); i++) {
        await page.mouse.move(720, 450);
        await page.mouse.wheel(0, wheels > 0 ? -240 : 240);
      }
      const reported = (await page.locator('.hud-detail').innerText()).trim().split(' ')[0] ?? '?';
      if (reported !== wanted) {
        process.stdout.write(`  note  aimed for ${wanted}, landed on ${reported}\n`);
      }

      // Drag the map continuously and record the gap between painted frames.
      // Every pointermove invalidates, so the loop below keeps the renderer
      // saturated — which is the only state in which frame cost is meaningful.
      // Driven by Playwright's **real** mouse, not by `dispatchEvent`. Synthetic
      // pointer events move the map in isolation but did not in this harness,
      // and the difference is invisible from the timings — a still map reports
      // beautiful frame times. Real input removes the question.
      //
      // Frames are recorded *inside* the page, so the measurement is unaffected
      // by the Node-to-browser round trip on each move.
      // Reset the recorder's buffer. The loop itself is installed **once**,
      // before this loop — re-registering it per level left the previous
      // level's `requestAnimationFrame` chain running too, so three loops
      // pushed into one array and reported deltas of 0.0 ms.
      await page.evaluate('window.__raster.times.length = 0; window.__raster.last = performance.now();');

      const before = await canvasSignature(page);
      await page.mouse.move(700, 440);
      await page.mouse.down();
      for (let step = 0; step < 90; step++) {
        await page.mouse.move(700 + ((step * 37) % 240) - 120, 440 + ((step * 53) % 160) - 80);
      }
      await page.mouse.up();
      const after = await canvasSignature(page);

      // Drop the first few: the first frame after a zoom repopulates caches.
      const frames = (await page.evaluate('window.__raster.times.slice(5)')) as number[];

      // The liveness check. If the pixels are identical before and after a
      // 90-step drag, the map never moved and every number below is fiction —
      // CLAUDE.md: confirm it is actually measurable before asserting on it.
      if (before === after) {
        process.stderr.write(
          `\nraster: the canvas is byte-identical before and after the drag — the map is not moving, ` +
            `so these timings measure nothing.\n`,
        );
        return 1;
      }
      repaintRatio.push(String(frames.length));

      const sorted = [...frames].sort((a, b) => a - b);
      samples.push({
        level: reported === wanted ? wanted : `${reported} (aimed ${wanted})`,
        frames: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        worst: sorted[sorted.length - 1] ?? Number.NaN,
      });
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  process.stdout.write(`\n  ${'level'.padEnd(22)}  ${'p50'.padStart(9)}  ${'p95'.padStart(9)}  ${'worst'.padStart(9)}\n`);
  process.stdout.write(`  frames sampled per level: ${repaintRatio.join(', ')}\n\n`);
  for (const sample of samples) {
    const fps = 1000 / sample.p95;
    process.stdout.write(
      `  ${sample.level.padEnd(22)}  ${`${sample.p50.toFixed(1)} ms`.padStart(9)}  ` +
        `${`${sample.p95.toFixed(1)} ms`.padStart(9)}  ${`${sample.worst.toFixed(1)} ms`.padStart(9)}` +
        `   → ${fps.toFixed(0)} fps at p95\n`,
    );
  }

  // Advisory, not fatal: frame timing on a shared CI runner is noisy, and a
  // budget that fails at random teaches people to ignore budgets. The point of
  // this script is that the number stops being unknown.
  const over = samples.filter((sample) => sample.p95 > FRAME_BUDGET_MS);
  process.stdout.write(
    over.length === 0
      ? `\n  ok    every level holds ≥ 50 fps at p95 (${FRAME_BUDGET_MS.toFixed(1)} ms/frame)\n`
      : `\n  warn  ${over.map((sample) => sample.level).join(', ')} exceed ${FRAME_BUDGET_MS.toFixed(1)} ms at p95\n`,
  );
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
