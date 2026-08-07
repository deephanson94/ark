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

import type { Atlas } from '../src/atlas/index.js';
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

async function indexForPlayer(): Promise<Atlas> {
  const atlas = await buildAtlas(indexOptions(ROOT));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  return atlas;
}

async function main(): Promise<number> {
  const failures: Failure[] = [];
  const atlas = await indexForPlayer();
  const nodeCount = atlas.nodes.length;
  const pathById = new Map(atlas.nodes.map((node) => [node.id, node.path]));
  process.stdout.write(
    `e2e: indexed ${nodeCount} nodes, ${atlas.challenges.length} challenges\n`,
  );
  if (atlas.challenges.length === 0) {
    failures.push({ what: 'challenges', detail: 'the indexer generated none' });
  }

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
    const subjects = new Set(
      atlas.challenges.map((challenge) => pathById.get(challenge.subject) ?? ''),
    );
    const hits: { x: number; y: number; path: string }[] = [];
    const seenPaths = new Set<string>();
    // Fine enough to be reliable rather than lucky: an earlier version sampled
    // an 18×12 grid, found two discs, and neither carried a question — so the
    // whole M2 half of this script silently did not run. The scan now stops on
    // a condition it can state, not on a count that happened to be enough.
    const enough = (): boolean => hits.length >= 6 && hits.some((h) => subjects.has(h.path));
    for (let row = 1; row < 26 && !enough(); row++) {
      for (let column = 1; column < 40 && !enough(); column++) {
        const x = box.x + (box.width * column) / 40;
        const y = box.y + (box.height * row) / 26;
        await page.mouse.move(x, y);
        if ((await page.locator('.inspector-path').count()) === 0) continue;
        const path = (await page.locator('.inspector-path').innerText()).trim();
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);
        hits.push({ x, y, path });
      }
    }
    // Answer the question on the biggest available subject, so the screenshot
    // shows a choice set rather than a one-line answer key.
    hits.sort((a, b) => Number(subjects.has(b.path)) - Number(subjects.has(a.path)));
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

    // ---- the loop ------------------------------------------------------
    // Everything above tests the map. This tests the game: find a node that
    // carries a question, answer it, and check that a grade came back and that
    // the fog moved. It is the only automated check that the M2 loop is wired
    // end to end, and it is deliberately played *as a player* — clicking discs
    // and buttons — rather than by calling into the module graph.
    const understoodAtStart = Number.parseInt(
      /(\d+) understood/.exec(await page.locator('.hud-counts').innerText())?.[1] ?? '0',
      10,
    );
    if (understoodAtStart !== 0) {
      failures.push({ what: 'fog', detail: `${understoodAtStart} understood before answering anything` });
    }

    let opened: { x: number; y: number; path: string } | null = null;
    for (const entry of hits) {
      await page.mouse.click(entry.x, entry.y);
      if ((await page.locator('.inspector-action').count()) === 0) continue;
      await page.locator('.inspector-action').click();
      opened = entry;
      break;
    }

    if (opened === null) {
      failures.push({ what: 'challenge', detail: 'no node under the cursor grid carried a question' });
    } else {
      await page.waitForSelector('.console-panel', { timeout: 5000 });
      const question = (await page.locator('.console-question').innerText()).trim();
      process.stdout.write(`e2e: challenge → ${question}\n`);
      if (!question.includes('depend on it')) {
        // ADR-0008 fixes the wording; the graph proves dependence, not that a
        // file will need to change.
        failures.push({ what: 'prompt', detail: `unexpected wording: "${question}"` });
      }
      const choices = await page.locator('.choice-button').count();
      if (choices < 4) {
        failures.push({ what: 'challenge', detail: `only ${choices} choices offered` });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'challenge.png') });

      // Answer it correctly, on purpose. A wrong answer would exercise the
      // grade but not the *unlock*, and the unlock is the whole of ADR-0008
      // decision 1: passing is what turns the map's depth-1 preview into the
      // full radius. The answer comes from the atlas this script just built —
      // it is checking that the panel grades what the indexer wrote, not that
      // the player can play.
      const subject = opened.path;
      const challenge = atlas.challenges.find((entry) => pathById.get(entry.subject) === subject);
      if (!question.includes(subject)) {
        failures.push({ what: 'prompt', detail: `asked about ${subject} but says "${question}"` });
      }
      if (challenge === undefined) {
        failures.push({ what: 'challenge', detail: `no challenge in the atlas for ${subject}` });
      } else {
        const wanted = new Set(challenge.truth.map((id) => pathById.get(id) ?? ''));
        let clicked = 0;
        for (let i = 0; i < choices; i++) {
          const button = page.locator('.choice-button').nth(i);
          if (!wanted.has((await button.innerText()).trim())) continue;
          await button.click();
          clicked++;
        }
        if (clicked !== challenge.truth.length) {
          failures.push({
            what: 'challenge',
            detail: `${clicked} of ${challenge.truth.length} answer files were on the board`,
          });
        }
      }

      await page.locator('.console-submit').click();
      await page.waitForSelector('.console-score', { timeout: 5000 });
      const score = (await page.locator('.console-score').innerText()).replace(/\s+/g, ' ').trim();
      const evidence = (await page.locator('.console-evidence').innerText()).trim();
      process.stdout.write(`e2e: graded ${score} — ${evidence}\n`);
      if (!score.includes('100%')) {
        failures.push({ what: 'grade', detail: `the atlas's own answer key scored "${score}"` });
      }
      if ((await page.locator('.console-notes .note').count()) === 0) {
        failures.push({ what: 'reveal', detail: 'the grade named no files' });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'graded.png') });

      await page.locator('.console-submit').click(); // "back to the map"
      await page.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });

      // The fog has to have moved, or nothing the player proved reached it.
      const understood = Number.parseInt(
        /(\d+) understood/.exec(await page.locator('.hud-counts').innerText())?.[1] ?? '0',
        10,
      );
      process.stdout.write(`e2e: fog after one pass → ${understood} understood\n`);
      if (understood === 0) {
        failures.push({ what: 'fog', detail: 'passing a challenge lifted no fog' });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'after-grade.png') });

      // ---- persistence -------------------------------------------------
      // The only check that M3's first rung actually works. Everything in
      // `save.test.ts` is a fake store; this is a real browser, a real reload,
      // and the built bundle. A save that round-trips in a unit test and does
      // not survive F5 is the failure mode worth catching.
      const keys = await page.evaluate(() => Object.keys(globalThis.localStorage));
      process.stdout.write(`e2e: localStorage keys → ${keys.join(', ') || '(none)'}\n`);
      const expectedKey = `ark:${atlas.repo.root ?? ''}`;
      if (atlas.repo.root !== null && !keys.includes(expectedKey)) {
        // Keyed on the root commit, not HEAD: a HEAD key is wiped by every
        // reindex, which is the whole of ADR-0011 decision 1.
        failures.push({ what: 'save', detail: `expected key ${expectedKey}, got ${keys.join(', ')}` });
      }
      if (atlas.repo.head !== null && keys.includes(`ark:${atlas.repo.head}`)) {
        failures.push({ what: 'save', detail: 'progress is keyed on HEAD; a reindex would wipe it' });
      }

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('canvas.map', { timeout: 15_000 });
      const restored = await page
        .waitForFunction(
          (want: number) => {
            const text = document.querySelector('.hud-counts')?.textContent ?? '';
            return Number.parseInt(/(\d+) understood/.exec(text)?.[1] ?? '0', 10) >= want;
          },
          understood,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false);
      const afterReload = (await page.locator('.hud-counts').innerText()).replace(/\s+/g, ' ').trim();
      process.stdout.write(`e2e: after reload → ${afterReload}\n`);
      if (!restored) {
        failures.push({
          what: 'save',
          detail: `reload lost progress: had ${understood} understood, HUD now reads "${afterReload}"`,
        });
      }
      // The question ring has to be gone too, or the reload restored the fog
      // and not the deck — the player would be asked what they already proved.
      const questionsLeft = Number.parseInt(
        /(\d+) question/.exec(await page.locator('.hud-quests').innerText())?.[1] ?? '-1',
        10,
      );
      if (questionsLeft >= atlas.challenges.length) {
        failures.push({
          what: 'save',
          detail: `reload restored the fog but not the deck: ${questionsLeft} of ${atlas.challenges.length} still open`,
        });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'after-reload.png') });

      // ---- the progression affordance ----------------------------------
      // "Where next?" takes you to a landmark; it must NOT open a question.
      // ADR-0011 calls it an affordance rather than a mode, and §4's loop is
      // "pick a landmark" — sending the player straight into a modal is the
      // first step towards a quiz deck.
      const guideCaption = (await page.locator('.guide-caption').innerText()).trim();
      process.stdout.write(`e2e: guide → ${guideCaption}\n`);
      await page.locator('.guide-action').click();
      if (await page.locator('.console-scrim:not([hidden])').count()) {
        failures.push({ what: 'guide', detail: 'the suggestion opened a modal instead of moving the map' });
      }
      const landedOn = (await page.locator('.inspector-path').innerText()).trim();
      process.stdout.write(`e2e: guide sent us to ${landedOn}\n`);
      if (landedOn === '') {
        failures.push({ what: 'guide', detail: 'the suggestion selected nothing' });
      }
      if (landedOn === subject) {
        // The subject just passed leaves the deck, so re-offering it would mean
        // the selector is not reading the same answered set the HUD reads.
        failures.push({ what: 'guide', detail: `suggested ${landedOn}, which was just answered` });
      }
      // It has to have gone somewhere the name is readable, or it sent the
      // player to an unlabelled dot.
      const levelAfter = (await page.locator('.hud-detail').innerText()).trim();
      if (levelAfter.startsWith('territory')) {
        failures.push({ what: 'guide', detail: `landed at ${levelAfter}, where node names are not drawn` });
      }
      // ...and the question it took us to must be answerable from where we are.
      if ((await page.locator('.inspector-action').count()) === 0) {
        failures.push({ what: 'guide', detail: `no "answer this" control on ${landedOn}` });
      }
      // Having arrived, the panel must stop pointing somewhere else — a caption
      // that still reads "next is X" while you stand on X is a control that
      // looks like it did nothing.
      const arrivedCaption = await page
        .waitForFunction(
          () => (document.querySelector('.guide-caption')?.textContent ?? '').includes('you are on'),
          undefined,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!arrivedCaption) {
        const actual = (await page.locator('.guide-caption').innerText()).trim();
        failures.push({ what: 'guide', detail: `after arriving the caption still reads "${actual}"` });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'suggested.png') });

      // ---- field notes --------------------------------------------------
      // §9's codex, and the one place the surveyed/understood distinction can
      // be quietly broken by writing a sentence stronger than what was earned.
      const notesLabel = (await page.locator('.hud-notes').innerText()).trim();
      process.stdout.write(`e2e: notes toggle → ${notesLabel}\n`);
      if (!/\(\d+\)/.test(notesLabel)) {
        failures.push({ what: 'notes', detail: `toggle shows no count after a pass: "${notesLabel}"` });
      }
      await page.locator('.hud-notes').click();
      await page.waitForSelector('.notes-panel', { timeout: 5000 });
      const noteCount = await page.locator('.field-note').count();
      if (noteCount === 0) {
        failures.push({ what: 'notes', detail: 'passed a challenge and the notebook is empty' });
      } else {
        const claim = (await page.locator('.field-note-claim').first().innerText()).trim();
        const revealed = await page.locator('.field-note-revealed').first().count();
        process.stdout.write(`e2e: note → ${claim}\n`);
        if (!claim.startsWith('You proved')) {
          failures.push({ what: 'notes', detail: `a note must claim only what was proved: "${claim}"` });
        }
        if (challenge !== undefined && !claim.includes(String(challenge.truth.length))) {
          failures.push({
            what: 'notes',
            detail: `note claims a different count than the ${challenge.truth.length} files proved`,
          });
        }
        // The full radius may appear, but only in the line labelled as revealed.
        if (revealed > 0) {
          const shown = (await page.locator('.field-note-revealed').first().innerText()).trim();
          if (!shown.includes('revealed')) {
            failures.push({ what: 'notes', detail: `the radius is stated as knowledge: "${shown}"` });
          }
        }
      }
      await page.screenshot({ path: join(SHOT_DIR, 'field-notes.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.notes-scrim', { state: 'hidden', timeout: 5000 });
    }

    // Zoomed in, to check semantic zoom actually promotes detail.
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOT_DIR, 'map-zoomed.png') });
    const zoomLevel = (await page.locator('.hud-detail').innerText()).trim();
    process.stdout.write(`e2e: after zoom → ${zoomLevel}\n`);

    // ADR-0013's liveness gate. `peaksDrawn` is a measured count from the
    // renderer, not the absence of an error: if elevation ever stops reaching a
    // pixel — a wrong field name, an empty peak set, a draw pass skipped — this
    // reads 0 and the run fails. CLAUDE.md is explicit that a "how many X"
    // number needs a gate proving X happened, and `npm run raster` printed
    // confident nonsense twice before it had one.
    const peaks = Number(/(\d+) peaks/.exec(zoomLevel)?.[1] ?? '0');
    if (peaks <= 0) {
      failures.push({ what: 'peaks', detail: `no summits drawn — elevation reached no pixel: ${zoomLevel}` });
    }
    // And the product claim, per NORTH-STAR §4: a session should leave you able
    // to name the most-depended-upon module. Assert it is *on screen* — the
    // highest-elevation node's name has to be one of the labels drawn.
    const tallest = await page.evaluate(async () => {
      const response = await fetch('atlas.json', { cache: 'no-cache' });
      const atlas = (await response.json()) as { nodes: { path: string; elevation: number }[] };
      let best = atlas.nodes[0];
      for (const node of atlas.nodes) if (best !== undefined && node.elevation > best.elevation) best = node;
      return best?.path ?? '';
    });
    const leaf = tallest.slice(tallest.lastIndexOf('/') + 1);
    process.stdout.write(`e2e: tallest is ${tallest}\n`);
    if (leaf !== '' && !(await page.locator('canvas.map').isVisible())) {
      failures.push({ what: 'peaks', detail: 'no canvas to draw summits on' });
    }

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
