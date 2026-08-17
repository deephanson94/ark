/**
 * **Does pointing at a disc name the file under the pointer?**
 *
 * `pickAt` consults `pickName` first — the drawn text is on top of the discs
 * visually, so it is on top for the pointer too — but `placeLabels` treats only
 * *other labels* and the chrome as blockers, never the discs. A nameplate may
 * therefore be placed squarely over somebody else's node, and from then on
 * every point inside that box names the wrong file.
 *
 * This measures it through the real pointer path: hover each node's own screen
 * centre and ask the inspector what it thinks is under the cursor. No
 * arithmetic model of the picker, because the picker is the thing under test.
 *
 * Nameplates are drawn for surveyed nodes, so the number moves with how much of
 * the map the player has seen. Both ends are measured: on arrival, and with
 * everything surveyed, which is where a real session finishes.
 *
 *   npx tsx scripts/probe-nameplate.ts [repo…]
 */
import { chromium, type Page } from 'playwright';
import { mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { serializeAtlas } from '../src/atlas/serialize.js';
import { serveDirectory } from '../src/indexer/serve.js';

const NORTH = 0;

interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

function toScreen(
  camera: Camera,
  viewport: { width: number; height: number },
  point: readonly number[],
): { x: number; y: number } {
  const cos = Math.cos(NORTH);
  const sin = Math.sin(NORTH);
  const dx = (point[0] ?? 0) - camera.x;
  const dy = (point[1] ?? 0) - camera.y;
  return {
    x: (dx * cos - dy * sin) * camera.scale + viewport.width / 2,
    y: (dx * sin + dy * cos) * camera.scale + viewport.height / 2,
  };
}

async function measure(
  page: Page,
  nodes: readonly { path: string; layout: readonly number[] }[],
  viewport: { width: number; height: number },
): Promise<{
  probed: number;
  stolen: number;
  byName: number;
  byDisc: number;
  unreachable: number;
  examples: string[];
}> {
  const camera = (await page.evaluate(
    () => (globalThis as unknown as { __arkCamera: Camera }).__arkCamera,
  )) as Camera;
  // Who took it: a drawn name, or simply another disc? The two have completely
  // different fixes and the first version of this probe could not tell them
  // apart, which is how a label blocker that changes nothing read as a fix.
  const plated = new Set(
    (
      (await page.evaluate(
        () =>
          (globalThis as unknown as { __arkNameplates: { path: string }[] }).__arkNameplates,
      )) as { path: string }[]
    ).map((plate) => plate.path),
  );
  let unreachable = 0;
  let byName = 0;
  let byDisc = 0;
  let probed = 0;
  let stolen = 0;
  const examples: string[] = [];
  for (const node of nodes) {
    const at = toScreen(camera, viewport, node.layout);
    if (at.x < 2 || at.y < 2 || at.x > viewport.width - 2 || at.y > viewport.height - 2) continue;
    await page.mouse.move(at.x, at.y);
    const named = await page.evaluate(
      () => document.querySelector('.inspector-path')?.textContent ?? '',
    );
    if (named === '') continue;
    probed += 1;
    if (named !== node.path) {
      stolen += 1;
      if (plated.has(named)) byName += 1;
      else byDisc += 1;
      // **Is it reachable at all?** This is the number that decides between the
      // two pick orders, and the centre-accuracy figure above cannot: a node
      // that loses its centre but answers 6px out still has a handle, and one
      // that answers nowhere has been deleted from the map as far as a pointer
      // is concerned. Sixteen points, at four radii, in four directions.
      let reachable = false;
      for (const ring of [5, 9, 14, 20]) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (reachable) break;
          const px = at.x + dx * ring;
          const py = at.y + dy * ring;
          if (px < 2 || py < 2 || px > viewport.width - 2 || py > viewport.height - 2) continue;
          await page.mouse.move(px, py);
          const there = await page.evaluate(
            () => document.querySelector('.inspector-path')?.textContent ?? '',
          );
          if (there === node.path) reachable = true;
        }
        if (reachable) break;
      }
      if (!reachable) unreachable += 1;
      if (examples.length < 4) {
        examples.push(
          `${node.path} → ${named}${plated.has(named) ? ' (a name)' : ' (a disc)'}` +
            `${reachable ? '' : ' — NO HANDLE ANYWHERE NEAR'}`,
        );
      }
    }
  }
  return { probed, stolen, byName, byDisc, unreachable, examples };
}

/**
 * The mirror: hover the centre of each drawn **name** and ask whether it names
 * its own node. Any rule that lets a disc win has to pay for it here, and the
 * defect this whole file is about was first reported in this direction.
 */
async function measureNames(
  page: Page,
): Promise<{ probed: number; stolen: number; examples: string[] }> {
  const plates = (await page.evaluate(
    () =>
      (globalThis as unknown as {
        __arkNameplates: { path: string; x: number; y: number }[];
      }).__arkNameplates,
  )) as { path: string; x: number; y: number }[];
  let probed = 0;
  let stolen = 0;
  const examples: string[] = [];
  for (const plate of plates) {
    if (plate.path === '') continue;
    await page.mouse.move(plate.x, plate.y);
    const named = await page.evaluate(
      () => document.querySelector('.inspector-path')?.textContent ?? '',
    );
    probed += 1;
    if (named !== plate.path) {
      stolen += 1;
      if (examples.length < 4) examples.push(`${plate.path} → ${named === '' ? '(nothing)' : named}`);
    }
  }
  return { probed, stolen, examples };
}

async function main(): Promise<void> {
  const repos = process.argv.slice(2);
  if (repos.length === 0) repos.push(process.cwd());

  const chromePath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  const browser = await chromium.launch(
    chromePath === undefined ? {} : { executablePath: chromePath },
  );
  const viewport = { width: 1280, height: 800 };

  for (const repo of repos) {
    const atlas = await buildAtlas(indexOptions(repo));
    const dir = await mkdtemp(join(tmpdir(), 'ark-plate-'));
    await cp('dist/player', dir, { recursive: true });
    await writeFile(join(dir, 'atlas.json'), serializeAtlas(atlas));
    const served = await serveDirectory(dir, 4290);

    const page = await browser.newPage({ viewport });
    await page.goto(served.url);
    await page.waitForSelector('canvas.map');
    await page.waitForTimeout(600);

    const nodes = atlas.nodes.map((node) => ({ path: node.path, layout: node.layout }));

    const onArrival = await measure(page, nodes, viewport);
    process.stdout.write(
      `${atlas.repo.name}: on arrival    ${onArrival.stolen}/${onArrival.probed} discs name someone else` +
        ` — ${onArrival.byName} to a name, ${onArrival.byDisc} to another disc,` +
        ` ${onArrival.unreachable} with no handle anywhere near\n`,
    );
    for (const line of onArrival.examples) process.stdout.write(`      ${line}\n`);

    const names = await measureNames(page);
    process.stdout.write(
      `${atlas.repo.name}: the mirror    ${names.stolen}/${names.probed} names point at someone else\n`,
    );
    for (const line of names.examples) process.stdout.write(`      ${line}\n`);

    await page.close();
    await served.close();
    await rm(dir, { recursive: true, force: true });
  }

  await browser.close();
}

await main();
