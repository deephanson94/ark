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
import type { ConsoleMessage, Page } from 'playwright';
import { build, preview } from 'vite';

import type { Atlas } from '../src/atlas/index.js';
import { buildGraph, commitIdFor, serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { VERBS, commitLabel } from '../src/verbs/index.js';
import { storageKeyFor } from '../src/player/save.js';
import { findTwins } from '../src/player/twins.js';
import { GOLDEN_TURN, TURN_MS } from '../src/player/heading.js';
// The player's own label rule, not a second copy of it: `node.path` is what
// this map used, which is the same string only while no node is the repo root.
import { pathLabel } from '../src/verbs/index.js';

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

/**
 * Text as the browser *renders* it, which is the only form worth comparing.
 *
 * `innerText` collapses runs of whitespace under `white-space: normal`, so a
 * label the code built with two spaces — `commitLabel`, whose fields are
 * separated that way — never equals the string on screen. A file path survives
 * the round trip unchanged, which is exactly why this went unnoticed until a
 * board of commits was played: the bug is invisible on three verbs out of four.
 */
function rendered(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The part of a field note that is a claim **about its subject**.
 *
 * A claim reads `You proved N <noun> that <relation> SUBJECT — member, member,
 * …`, so searching the whole sentence for a path also matches a note about
 * somebody *else* that happens to list this subject among its members — and
 * `find` takes the first. Three separate steps did that; two of them went red
 * on the CI merge commit, which is a different tree with a different deck, and
 * the second trap was subtler still: `claim.includes('commit')` matched a Blast
 * Radius note because the *subject path* was `src/verbs/commits.ts`.
 *
 * One rule in one place, because a rule that lives three times diverges twice.
 */
/**
 * Wait for a condition, with a deadline.
 *
 * The player writes most of what a test reads from the rAF loop, so a fixed
 * `waitForTimeout` before reading is a race that only loses on a slower
 * machine — this file already carries a landmine about CI reporting `0 marks`
 * on a board that draws six. The deadline is what keeps a genuinely dead
 * surface failing rather than hanging.
 */
async function pollUntil(check: () => Promise<boolean>, deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/**
 * Wait for the renderer to have actually drawn.
 *
 * **A panel appearing is synchronous DOM; what the frame drew is not.** The
 * canvas publishes `__arkRadius`, `__arkCamera` and `__arkNameplates` from
 * inside its `requestAnimationFrame` loop, so reading one straight after
 * `waitForSelector` reads the *previous* frame. Locally a frame had always
 * landed first; CI is slower, and the answer-key gate reported an open board
 * still drawing its import radius — the defect it exists to catch, green here
 * and red there on an identical tree.
 *
 * Two frames rather than one: `invalidate()` sets a dirty flag that the *next*
 * loop iteration consumes, so one is the boundary and two is inside it. Passed
 * as a string because tsx transpiles this file with `keepNames`, which wraps a
 * named inner function in a `__name` helper the page does not have.
 */
async function drawn(page: Page): Promise<void> {
  await page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))))',
  );
}

function claimAbout(claim: string): string {
  return claim.split(' — ')[0] ?? claim;
}

/**
 * Click Submit, and say **why** when it will not take the click.
 *
 * A disabled Submit means nothing is ticked — which is real information, and
 * Playwright renders it as thirty seconds of `retrying click action` followed by
 * a stack trace with no mention of the board. This file already carries a
 * landmine about hanging on a correctly-disabled Submit; that entry was written
 * about a step that ticked nothing *deterministically*, and the same hang has
 * now cost a run that reproduced on neither side of it. Whatever the cause, a
 * timeout is the wrong instrument: the tally is on screen and it says what the
 * board thought was selected.
 */
async function submitBoard(page: Page, what: string): Promise<void> {
  const submit = page.locator('.console-submit');
  try {
    await submit.waitFor({ state: 'attached', timeout: 5000 });
    await page.waitForFunction(
      () => {
        const button = document.querySelector('.console-submit');
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      undefined,
      { timeout: 5000 },
    );
  } catch {
    const tally = await page
      .locator('.console-tally')
      .innerText()
      .catch(() => '(no tally)');
    const ticked = await page.locator('.choice-button.is-picked').count().catch(() => -1);
    throw new Error(
      `${what}: Submit never became clickable — tally says "${tally.trim()}", ${ticked} rows carry the picked class`,
    );
  }
  await submit.click();
}

async function indexForPlayer(): Promise<Atlas> {
  const atlas = await buildAtlas(indexOptions(ROOT));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  return atlas;
}


/**
 * The HUD's board-marker count, once a frame carrying it has actually painted.
 *
 * **Read without waiting, this is a race that only loses on a slow machine.**
 * The panel appearing is synchronous DOM; the count is written inside the
 * requestAnimationFrame loop. Locally a frame had always landed by the time the
 * assertion ran, and CI's runner reported `0 marks` on a board that draws six —
 * green here, red there, on identical code. Polling is the fix; the deadline is
 * what keeps a genuinely dead layer failing rather than hanging.
 */
async function markCount(page: Page, atLeast: number): Promise<number> {
  const deadline = 4000;
  const step = 100;
  let seen = 0;
  for (let waited = 0; waited <= deadline; waited += step) {
    const detail = (await page.locator('.hud-detail').innerText()).trim();
    seen = Number(/(\d+) marks/.exec(detail)?.[1] ?? '0');
    if (seen >= atLeast) return seen;
    await page.waitForTimeout(step);
  }
  return seen;
}

async function main(): Promise<number> {
  const failures: Failure[] = [];
  /**
   * Did any board in this run let a map click tick a candidate?
   *
   * Tracked across the run rather than asserted per board: which verb the deck
   * serves first moves with the repo, and on a commit-candidate board no map
   * click can tick anything. Without this flag a run that only opened
   * Archaeology boards would skip the interesting half and go green — the
   * dead-path failure this repo has a landmine about.
   */
  let sawMapTick = false;
  /**
   * Subjects this run has already answered.
   *
   * Later steps need a board that is still **open** — the inspector hides its
   * "answer this" control once a subject's questions are all passed — and
   * picking one with `.find()` over the deck is an ordering assumption that
   * holds until the deck moves. It moved: on the CI merge commit the wire
   * step's `.find()` landed on the very subject the challenge step had just
   * played, and the click waited 30 s for a control that was correctly absent.
   */
  const answeredPaths = new Set<string>();
  const atlas = await indexForPlayer();
  const nodeCount = atlas.nodes.length;
  const pathById = new Map(atlas.nodes.map((node) => [node.id, node.path]));
  // For asking a verb what its reveal would say, which is how the witness step
  // picks a wrong answer the panel will actually explain.
  const graph = buildGraph(atlas);
  // Every id to the string the console prints for it — a path for a file, a date
  // and message for a commit. `pathById` covers only half the union since
  // ADR-0018, and a board of commits would silently match nothing.
  // Values are **rendered** text: `innerText` collapses whitespace under
  // `white-space: normal`, and `commitLabel` separates its fields with two
  // spaces — so an unnormalised label matches a file path and never a commit,
  // which is a board of twenty rows silently matching none of them.
  const labelById = new Map(
    [...atlas.nodes.map((node) => [node.id, rendered(pathLabel(node.path))] as const)].concat(
      atlas.history.commits.map(
        (commit) => [commitIdFor(commit.sha), rendered(commitLabel(commit))] as const,
      ),
    ),
  );
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

    /**
     * Wait out a turn.
     *
     * The map turns between challenges over `TURN_MS`, so anything that reads a
     * pixel — or clicks a position found by an earlier scan — has to let it
     * land first. Imported from the player rather than typed in here, because a
     * hard-coded copy would silently stop covering the animation the day
     * somebody lengthens it.
     */
    const settle = async (): Promise<void> => {
      await page.waitForTimeout(TURN_MS + 140);
    };
    /** The compass's accessible name carries the heading in degrees. */
    const heading = async (): Promise<number> =>
      Number(/turned (\d+)°/.exec((await page.locator('.hud-compass').getAttribute('title')) ?? '')?.[1] ?? '-1');

    /**
     * A fingerprint of what is actually on the canvas.
     *
     * Every liveness gate in this script ends here, because `npm run raster`
     * printed confident, plausible, completely false numbers twice before it
     * had one. State that says the map turned is not the map having turned.
     */
    const hashCanvas = async (): Promise<string> =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas.map');
        if (!(canvas instanceof HTMLCanvasElement)) return 'no-canvas';
        const context = canvas.getContext('2d');
        if (context === null) return 'no-context';
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let hash = 2166136261;
        for (let i = 0; i < data.length; i += 997) {
          hash ^= data[i] ?? 0;
          hash = Math.imul(hash, 16777619);
        }
        return String(hash >>> 0);
      });

    const consoleErrors: string[] = [];
    /**
     * One exclusion, and it is the harness apologising for itself.
     *
     * The orbit liveness gate hashes the canvas with `getImageData`, and
     * Chromium advises setting `willReadFrequently` when you do that repeatedly.
     * The advice is aimed at the *test*, not at the player — nothing in the
     * product ever reads pixels back. Suppressing it here rather than setting
     * the flag on the real canvas, because that flag moves the canvas off the
     * GPU and would quietly change the very rendering the gate exists to
     * measure. Matched narrowly, so any other Canvas2D warning still fails.
     */
    const harnessNoise = /willReadFrequently/;
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return;
      if (harnessNoise.test(message.text())) return;
      consoleErrors.push(`${message.type()}: ${message.text()}`);
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

    /**
     * A point on the map whose node offers a question, **found now**.
     *
     * This walked `hits` — the coordinates the grid scan recorded — and that is
     * a prediction about what a coordinate means, which is the same family as
     * predicting which board the shell will serve. It was wrong for a reason the
     * step causes itself: the survey block above clicks every hit, surveying a
     * node draws its **name**, and `pickAt` consults nameplates before discs, so
     * a label placed over a neighbouring disc changes what that neighbour's
     * coordinates pick. The hits then resolved to nodes carrying no question and
     * this reported *"no node under the cursor grid carried a question"* — a
     * sentence that reads as the generator being broken. It failed only in CI,
     * because ark indexes itself and CI indexes `refs/pull/N/merge`, so which
     * discs the scan lands on is a different set there.
     *
     * The fix is the same one this file has now applied four times: **read what
     * is on screen and match it**, never carry an earlier reading forward. The
     * scan is re-run rather than the hits re-used, so the question it finds is a
     * question the map is offering at the moment it is clicked.
     */
    const findQuestion = async (): Promise<{ x: number; y: number; path: string } | null> => {
      for (let row = 1; row < 26; row++) {
        for (let column = 1; column < 40; column++) {
          const x = box.x + (box.width * column) / 40;
          const y = box.y + (box.height * row) / 26;
          await page.mouse.move(x, y);
          if ((await page.locator('.inspector-action').count()) === 0) continue;
          const path = (await page.locator('.inspector-path').innerText()).trim();
          return { x, y, path };
        }
      }
      return null;
    };

    const offered = await findQuestion();
    let opened: { x: number; y: number; path: string } | null = null;
    if (offered === null) {
      failures.push({ what: 'challenge', detail: 'no node under the cursor grid carried a question' });
    } else {
      await page.mouse.click(offered.x, offered.y);
      // The click re-describes whatever is under the pointer, which is the node
      // the hover just named — but assert it rather than assume it, because the
      // whole defect above was an assumption of exactly this shape.
      if ((await page.locator('.inspector-action').count()) === 0) {
        failures.push({
          what: 'challenge',
          detail: `hovering ${offered.path} offered a question and clicking it withdrew the offer`,
        });
      } else {
        await page.locator('.inspector-action').click();
        opened = offered;
      }
    }

    if (opened !== null) {
      await page.waitForSelector('.console-panel', { timeout: 5000 });
      const question = (await page.locator('.console-question').innerText()).trim();
      process.stdout.write(`e2e: challenge → ${question}\n`);
      // Verb-aware since M4. ADR-0008 fixes Blast Radius's wording — the graph
      // proves dependence, not that a file will need to change — and ADR-0014
      // fixes Companion's, which must state the *measured* bar so the player
      // knows the line they are being asked to draw.
      // Read off the console's own header, which the *verb* supplies — so this
      // also checks the seam that lets the console render a question it knows
      // nothing about.
      // Lowercased because `innerText` returns *rendered* text and the header
      // is `text-transform: uppercase` — it reads `COMPANION`, not `companion`.
      const title = (await page.locator('.console-verb').innerText()).trim().toLowerCase();
      process.stdout.write(`e2e: verb → ${title}\n`);
      // **One entry per verb, not a binary.** This read
      // `title === 'companion' ? … : 'depend on it'`, which asserts Blast
      // Radius's wording over *any* verb that is not Companion — so the day the
      // grid scan landed on an Archaeology board it reported the wrong prompt
      // and then hung for 30 s on a Submit that was correctly disabled. ark
      // indexes itself, so which board this step plays moves with every commit;
      // a default arm here is a prediction about a deck nobody controls.
      const WORDING: Record<string, string> = {
        'blast radius': 'depend on it',
        companion: 'changed alongside',
        archaeology: 'commits changed',
        placement: 'did it change',
      };
      const expected = WORDING[title] ?? '';
      if (expected === '') {
        failures.push({ what: 'prompt', detail: `no expected wording for verb "${title}"` });
      }
      if (!question.includes(expected)) {
        failures.push({ what: 'prompt', detail: `unexpected wording: "${question}"` });
      }
      const choices = await page.locator('.choice-button').count();
      if (choices < 4) {
        failures.push({ what: 'challenge', detail: `only ${choices} choices offered` });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'challenge.png') });

      // **The map marks the open board.** Three cold playtesters found the map
      // inert during a challenge — a checkbox list of paths over a dimmed map
      // with nothing on it marked — so this is the liveness gate on the fix,
      // measured off the renderer like `peaksDrawn` and `tiesDrawn`. A layer
      // that never fires would otherwise be code and comments asserting a
      // behaviour the product does not have.
      const marks = await markCount(page, 1);
      if (marks <= 0) {
        failures.push({ what: 'board', detail: 'the map marked nothing on an open board' });
      }
      process.stdout.write(`e2e: board marked ${marks} places on the map\n`);

      // **And a click on the map answers the board rather than discarding it.**
      // The scrim used to close on any pointerdown that reached it, so the most
      // natural act during a challenge threw the ticks away.
      //
      // **The first version of this check passed for the wrong reason.** It
      // swept the whole canvas, and the panel is docked to the right of it — so
      // a "map click" that ticked a row was scored as a map click that ticked a
      // marker, on an Archaeology board where the candidates are *commits* and
      // no map click can ever tick anything. The panel's own box is excluded
      // now, and the tick is required only where a candidate has a place at
      // all: `marks > 1` means the subject plus at least one candidate.
      const mapBox = await page.locator('canvas.map').boundingBox();
      const panelBox = await page.locator('.console-panel').boundingBox();
      if (mapBox !== null) {
        const before = (await page.locator('.console-tally').innerText()).trim();
        let toggled = '';
        // **A sweep has to be finer than the thing it is looking for, and cover
        // all of it.** This one was neither, and both halves were luck for
        // milestones. The bounds never reached their own denominators —
        // `column < 30` over a `/44` grid, `row < 20` over `/24` — so it searched
        // 66% by 79% of the canvas; and at `/44 × /24` the step is ~33 × 37 px
        // against node discs that render at ~15–20 px, so even inside the swept
        // area it hit a mark by chance. ark indexes itself, so a commit that
        // changed no rendering at all re-rolled the layout and put all 19 marks
        // where the grid did not land. `/96 × /54` steps ~15 × 17 px, under the
        // smallest disc, and runs to the edges. It still exits on the first hit,
        // so the cost is paid only when the step is about to fail anyway.
        for (let row = 1; row < 54 && toggled === ''; row++) {
          for (let column = 1; column < 96 && toggled === ''; column++) {
            const x = mapBox.x + (mapBox.width * column) / 96;
            const y = mapBox.y + (mapBox.height * row) / 54;
            if (
              panelBox !== null &&
              x >= panelBox.x - 8 &&
              x <= panelBox.x + panelBox.width + 8 &&
              y >= panelBox.y - 8 &&
              y <= panelBox.y + panelBox.height + 8
            ) {
              continue;
            }
            await page.mouse.click(x, y);
            const now = (await page.locator('.console-tally').innerText()).trim();
            if (now !== before) toggled = now;
          }
        }
        if (marks > 1 && toggled === '') {
          failures.push({ what: 'board', detail: 'no click on the map ever ticked a candidate' });
        }
        if (toggled !== '') {
          sawMapTick = true;
          process.stdout.write(`e2e: a click on the map → ${toggled}\n`);
        }
        // Verb-independent, and the other half of the fix: whatever the click
        // landed on, the board is still open.
        if (!(await page.locator('.console-panel').isVisible())) {
          failures.push({ what: 'board', detail: 'clicking the map closed the board' });
        }
        // Leave the board as we found it, so the deliberate answer below is
        // graded against a clean set of picks.
        for (const pickedButton of await page.locator('.choice-button.is-picked').all()) {
          await pickedButton.click();
        }
      }

      // Answer it correctly, on purpose. A wrong answer would exercise the
      // grade but not the *unlock*, and the unlock is the whole of ADR-0008
      // decision 1: passing is what turns the map's depth-1 preview into the
      // full radius. The answer comes from the atlas this script just built —
      // it is checking that the panel grades what the indexer wrote, not that
      // the player can play.
      const subject = opened.path;
      // **Match the board on screen; never predict which one the shell serves.**
      // This read `atlas.challenges.find(subject matches)`, which is *id* order —
      // `archaeology-` sorts before `blast-` and `companion-` — while the console
      // serves a node's bucket in **tier** order. It passed for as long as the
      // first-by-id board happened to be the one served, and went red the moment
      // a subject gained an Archaeology board: `find` returned a board whose
      // truth is *commits*, nothing matched, and the submit button never enabled.
      //
      // The witness step below already reads the choice set off the screen and
      // matches the board whose candidates those are — CLAUDE.md's `.first()`
      // landmine, fixed there and left standing here, four hundred lines apart.
      const shownHere = (await page.locator('.choice-path').allInnerTexts()).map(rendered);
      const shownHereSet = new Set(shownHere);
      const challenge = atlas.challenges.find(
        (entry) =>
          pathById.get(entry.subject) === subject &&
          entry.candidates.length === shownHere.length &&
          // `labelById`, not `pathById`: a member is a place **or an event**
          // (ADR-0018), and `pathById` covers only the first arm — so an
          // Archaeology board, whose rows are commits, matched nothing at all,
          // `clicked` stayed 0 and the step hung 30 s on a Submit that was
          // correctly disabled. The same half-of-the-union mistake the comment
          // above describes, one map along.
          entry.candidates.every((id) => shownHereSet.has(labelById.get(id) ?? '\u0000')),
      );
      if (!question.includes(subject)) {
        failures.push({ what: 'prompt', detail: `asked about ${subject} but says "${question}"` });
      }
      if (challenge === undefined) {
        failures.push({ what: 'challenge', detail: `no challenge in the atlas for ${subject}` });
      } else {
        const wanted = new Set(challenge.truth.map((id) => labelById.get(id) ?? ''));
        let clicked = 0;
        for (let i = 0; i < choices; i++) {
          const button = page.locator('.choice-button').nth(i);
          if (!wanted.has(rendered(await button.innerText()))) continue;
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

      const headingBeforeGrade = await heading();
      await submitBoard(page, 'grade a board');
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
      answeredPaths.add(subject);
      await page.screenshot({ path: join(SHOT_DIR, 'graded.png') });

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

      // ---- the map turns between challenges (ADR-0017) --------------------
      //
      // **The load-bearing assertion of the whole feature, and it is one
      // comparison**: with the turn landed, hash the canvas, press `n`, hash
      // again, and require the two to differ. That single check proves the
      // grade turned the *map* — not a state variable, not the compass, which
      // is CSS-rotated independently and would keep spinning over a dead map —
      // and that the way back works, because if the grade had turned nothing
      // the map would still be north-up and `n` would be a no-op.
      //
      // Everything else here is a name for the number. The pixels are the gate.
      // **The turn must not have happened behind the scrim.** ADR-0017 argues
      // for a paragraph that turning while the console covers the map is worth
      // nothing — the player would close it onto a world that had silently
      // moved — and nothing tested it.
      //
      // Compared across the whole open-panel window, from before the grade to
      // after a full turn's worth of time, rather than between two hashes taken
      // after it: the first version of this check hashed the canvas 200 ms after
      // the score appeared, by which time a grade-time turn had already
      // finished, so both hashes matched and moving `turnTo` into `onGraded`
      // sailed through it. A gate whose window can close before the thing it
      // watches for is a gate that measures nothing.
      await page.waitForTimeout(200);
      const duringPanel = await hashCanvas();
      await settle();
      const headingWhileOpen = await heading();
      if (headingWhileOpen !== headingBeforeGrade) {
        failures.push({
          what: 'rotation',
          detail: `the map turned to ${headingWhileOpen}° while the console was still open, behind the scrim`,
        });
      }
      if ((await hashCanvas()) !== duringPanel) {
        failures.push({
          what: 'rotation',
          detail: 'the map moved while the console was still open',
        });
      }

      await submitBoard(page, 'rotation: back to the map'); // "back to the map"
      await page.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });
      await settle();
      // Frame the whole map at the new heading before anything scans it again:
      // the turn pivots about the file just graded, so the camera moves as well
      // as turns, and a later grid scan hunting a particular node needs it on
      // screen. Exercises the bearing-aware `fit` while it is at it.
      await page.keyboard.press('f');
      await page.waitForTimeout(120);
      const turnedTo = await heading();
      // Derived from the constant the player uses, so this stays true if the
      // schedule ever changes — and false the moment the *rendered* heading
      // stops agreeing with it. "Not north" was too weak a claim: a sign flip
      // in the compass reads 222° and passes it, which is the decoy instrument
      // the needle is supposed not to be.
      const oneTurn = Math.round(((GOLDEN_TURN * 180) / Math.PI) % 360);
      process.stdout.write(`e2e: after one grade the map is turned ${turnedTo}° (expected ${oneTurn}°)\n`);
      if (turnedTo !== oneTurn) {
        failures.push({
          what: 'rotation',
          detail: `grading a challenge left the map at ${turnedTo}°, not the ${oneTurn}° it turns by`,
        });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'turned.png') });
      const turnedMapPixels = await hashCanvas();

      await page.keyboard.press('n');
      await settle();
      const northPixels = await hashCanvas();
      const backTo = await heading();
      process.stdout.write(`e2e: n → ${backTo}°\n`);
      if (northPixels === turnedMapPixels) {
        failures.push({
          what: 'rotation',
          detail: 'the heading changed but the canvas did not — bearing reaches no pixel',
        });
      }
      if (backTo !== 0) {
        failures.push({ what: 'rotation', detail: `n left the map at ${backTo}° instead of north` });
      }

      // **Only a *grade* turns the map.** The pending flag exists so that
      // opening a question and thinking better of it costs nothing; without a
      // test, turning on every close passes everything else in this file.
      await page.locator('.inspector-action').click();
      await page.waitForSelector('.console-panel', { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });
      await settle();
      const afterEscape = await heading();
      if (afterEscape !== backTo) {
        failures.push({
          what: 'rotation',
          detail: `escaping an unanswered board turned the map to ${afterEscape}°`,
        });
      }

      // ---- history wires -------------------------------------------------
      //
      // ADR-0016's liveness gate, and it is the whole reason `wires` is in the
      // HUD string. Simulating the supply in node proves the *arithmetic*; only
      // this proves a stroke reached the canvas. CLAUDE.md's landmine is
      // explicit that a fallback nobody counted is worse than no fallback, and
      // a gate that never opens is the same defect wearing a different hat.
      //
      // The subject is chosen rather than stumbled upon, because the endpoint
      // gate makes "answer any Companion question" an unreliable trigger: a
      // wire is withheld while *either* end still carries an open board. So
      // pick a subject that carries **only** a Companion question (no Blast
      // Radius one to be served first) and whose key contains a file that is
      // not itself a Companion subject. Almost all of them do, and one answer is
      // then enough to leave a wire standing — `.find()` needs one, so this does
      // not depend on a count that changes every commit.
      let wirePlayed: (typeof atlas.challenges)[number] | undefined;
      const companionSubjects = new Set(
        atlas.challenges.filter((c) => c.verb === 'companion').map((c) => c.subject),
      );
      const blastSubjects = new Set(
        atlas.challenges.filter((c) => c.verb === 'blastRadius').map((c) => c.subject),
      );
      //
      // **A list, biggest circle first, not `.find()`.** Two ordering
      // assumptions bit here on CI's merge commit and neither was visible on the
      // branch: the first match was the board the challenge step had already
      // played (so the inspector correctly hid its "answer this" control), and
      // the next one was a file small enough to fall between the grid's points.
      // Node radius tracks `loc`, so trying the largest subjects first is the
      // cheap fix for a coarse scan — and falling through to the next candidate
      // is what stops this depending on any one of them.
      const locOf = new Map(atlas.nodes.map((node) => [node.id, node.loc]));
      const wireTargets = atlas.challenges
        .filter(
          (c) =>
            c.verb === 'companion' &&
            !blastSubjects.has(c.subject) &&
            !answeredPaths.has(pathById.get(c.subject) ?? '') &&
            c.truth.some((t) => !companionSubjects.has(t)),
        )
        .sort((a, b) => (locOf.get(b.subject) ?? 0) - (locOf.get(a.subject) ?? 0));
      const wireTarget = wireTargets[0];
      let wireTargetPath = '';
      let wireHit: { x: number; y: number } | null = null;
      //
      // **Sweep once, then choose from what the sweep found — never the other
      // way round.** The previous version picked its three largest candidates
      // up front and swept the grid looking for each, which is a prediction
      // about where a 40×26 scan will land: at fit scale a small node is about
      // a pixel and the grid's points are 36 apart, so a perfectly valid
      // candidate is simply invisible to it. It went red on an ordinary commit
      // — ark indexes itself, so the deck moves under this step every time —
      // with "never appeared under the cursor grid" for all three.
      //
      // One pass, recording every path the inspector actually reports, then
      // intersect with the candidate list. Now it can only fail when *no*
      // eligible subject is reachable at all, which is a real finding rather
      // than a coincidence of sizes.
      const reachable = new Map<string, { x: number; y: number }>();
      for (let row = 1; row < 26; row++) {
        for (let column = 1; column < 40; column++) {
          const x = box.x + (box.width * column) / 40;
          const y = box.y + (box.height * row) / 26;
          await page.mouse.move(x, y);
          if ((await page.locator('.inspector-path').count()) === 0) continue;
          const path = (await page.locator('.inspector-path').innerText()).trim();
          if (!reachable.has(path)) reachable.set(path, { x, y });
        }
      }
      for (const candidate of wireTargets) {
        const path = pathById.get(candidate.subject) ?? '';
        const at = reachable.get(path);
        if (at === undefined) continue;
        wireTargetPath = path;
        wireHit = at;
        wirePlayed = candidate;
        break;
      }
      if (wireHit === null) {
        wireTargetPath = pathById.get(wireTarget?.subject ?? '') ?? '(none)';
      }

      // ---- twins (ADR-0030) ---------------------------------------------
      //
      // **The liveness gate for a surface that is silent by design.** A twin
      // class may be named only when *no* member still carries an unanswered
      // Blast Radius board, so on a fresh save most of ark's classes say
      // nothing — measured, 1 of 8 is nameable at load and all 8 once the deck
      // is cleared. A test that only checked "no error" would pass against a
      // surface that never renders, which is this repo's dead-path landmine.
      //
      // The candidate set is computed from the atlas and then intersected with
      // what the sweep above actually reached — never predicted, which is the
      // mistake the wires step just above had to be rewritten for.
      const twinClasses = findTwins(
        graph,
        atlas.nodes.map((node) => node.id),
      );
      const openBlast = new Set(
        atlas.challenges.filter((entry) => entry.verb === 'blastRadius').map((entry) => entry.subject),
      );
      const nameableMembers: string[] = [];
      for (const found of twinClasses.classes) {
        const gated = found.members.some((member) => {
          const id = atlas.nodes[member]?.id;
          return id !== undefined && openBlast.has(id);
        });
        if (gated) continue;
        for (const member of found.members) {
          const path = atlas.nodes[member]?.path;
          if (path !== undefined) nameableMembers.push(path);
        }
      }
      process.stdout.write(
        `e2e: ${twinClasses.classes.length} twin classes, ${nameableMembers.length} members nameable now\n`,
      );
      if (nameableMembers.length === 0) {
        failures.push({
          what: 'twins',
          detail: `no twin class is nameable on a fresh save — the surface can never render (${twinClasses.classes.length} classes exist)`,
        });
      }

      // The gate *closing*, checked in the browser on the un-seeded page. This
      // is the half that matters: the leak ADR-0030 closes is a passed board
      // certifying its distractors as non-dependents of the twin, so a surface
      // that renders correctly and gates incorrectly is worse than no surface.
      const gatedPaths: string[] = [];
      for (const found of twinClasses.classes) {
        const gated = found.members.some((member) => {
          const id = atlas.nodes[member]?.id;
          return id !== undefined && openBlast.has(id);
        });
        if (!gated) continue;
        for (const member of found.members) {
          const path = atlas.nodes[member]?.path;
          if (path !== undefined) gatedPaths.push(path);
        }
      }
      const gatedAt = gatedPaths
        .map((path) => ({ path, at: reachable.get(path) }))
        .find((found) => found.at !== undefined);
      if (gatedAt?.at !== undefined) {
        await page.mouse.move(gatedAt.at.x, gatedAt.at.y);
        await page.waitForTimeout(120);
        if ((await page.locator('.inspector-twin').count()) > 0) {
          failures.push({
            what: 'twins',
            detail: `${gatedAt.path} named its twin class while a member still carries an open board`,
          });
        } else {
          process.stdout.write(`e2e: gate holds — ${gatedAt.path} says nothing while its class has a board\n`);
        }
      }

      // **Silent while gated, and rendering once cleared** — both halves, because
      // either alone passes against a broken surface. The first version of this
      // step tried only the fresh save, found that neither of its two nameable
      // members fell under a 40×26 grid, printed "skipping the render check" and
      // went green: a liveness gate that reports its own absence and passes is
      // the dead-path landmine wearing a test's clothes.
      //
      // Answering every Blast Radius board opens all 8 classes (20 members),
      // which is both far likelier to land under the grid *and* the ADR's actual
      // claim: the fact arrives as boards are answered, the opposite direction
      // from ADR-0016's wires, which appeared and then withdrew.
      const twinSeed = JSON.stringify({
        version: 1,
        surveyed: [],
        passes: atlas.challenges
          .filter((entry) => entry.verb === 'blastRadius')
          .map((entry) => ({ verb: entry.verb, subject: entry.subject, proved: entry.truth })),
      });
      const twinKey = storageKeyFor(atlas.repo);
      const twinContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const twinPage = await twinContext.newPage();
      const twinErrors: string[] = [];
      twinPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') twinErrors.push(message.text());
      });
      twinPage.on('pageerror', (error: Error) => twinErrors.push(String(error)));
      await twinPage.addInitScript(
        ([storageKey, value]: [string, string]) => window.localStorage.setItem(storageKey, value),
        [twinKey, twinSeed] as [string, string],
      );
      await twinPage.goto(url, { waitUntil: 'networkidle' });
      await twinPage.waitForSelector('.hud-counts');
      const allNameable = new Set<string>();
      for (const found of twinClasses.classes) {
        for (const member of found.members) {
          const path = atlas.nodes[member]?.path;
          if (path !== undefined) allNameable.add(path);
        }
      }
      const twinBox = await twinPage.locator('canvas.map').boundingBox();
      let twinSaid: string | null = null;
      if (twinBox !== null) {
        // Sweep, then take what the sweep found — never predict which node the
        // grid will land on.
        for (let row = 1; row < 34 && twinSaid === null; row++) {
          for (let column = 1; column < 52 && twinSaid === null; column++) {
            const x = twinBox.x + (twinBox.width * column) / 52;
            const y = twinBox.y + (twinBox.height * row) / 34;
            await twinPage.mouse.move(x, y);
            if ((await twinPage.locator('.inspector-twin').count()) === 0) continue;
            twinSaid = rendered(await twinPage.locator('.inspector-twin').innerText());
          }
        }
      }
      if (twinSaid === null) {
        failures.push({
          what: 'twins',
          detail: `no twin line rendered anywhere with every Blast Radius board answered (${allNameable.size} members should be nameable)`,
        });
      } else {
        process.stdout.write(`e2e: twin → ${twinSaid}\n`);
        // The *revealed* register, not the proved one (ADR-0011 decision 3).
        if (!twinSaid.includes('nothing in this repository can tell')) {
          failures.push({ what: 'twins', detail: `twin line is not in the revealed register: ${twinSaid}` });
        }
      }
      for (const error of twinErrors) {
        failures.push({ what: 'twins', detail: `console error on the seeded page: ${error}` });
      }
      await twinContext.close();
      process.stdout.write(
        `e2e: grid reached ${reachable.size} nodes; ${wireTargets.length} companion-only candidates\n`,
      );

      if (wireTarget === undefined) {
        failures.push({ what: 'wires', detail: 'no companion-only subject in this atlas to play' });
      } else if (wireHit === null) {
        failures.push({
          what: 'wires',
          detail: `none of the ${wireTargets.length} companion-only subjects was reachable by the grid (best was ${wireTargetPath}); the grid reached ${reachable.size} nodes`,
        });
      } else {
        await page.mouse.click(wireHit.x, wireHit.y);
        await page.locator('.inspector-action').click();
        await page.waitForSelector('.console-panel', { timeout: 5000 });
        const verb = (await page.locator('.console-verb').innerText()).trim().toLowerCase();
        if (verb !== 'companion') {
          failures.push({ what: 'wires', detail: `expected a companion board, got ${verb}` });
        }
        // **A Companion board's candidates are files, so this is where a map
        // click can tick one.** The board opened earlier in this run may be
        // Archaeology, whose candidates are commits and have no place at all —
        // which is why the run-level `sawMapTick` flag exists rather than a
        // per-board assertion.
        {
          const marked = await markCount(page, 2);
          process.stdout.write(`e2e: companion board marked ${marked} places\n`);
          if (marked < 2) {
            failures.push({
              what: 'board',
              detail: `a companion board marked ${marked} places; expected the subject and candidates`,
            });
          }
          const box = await page.locator('canvas.map').boundingBox();
          const panel = await page.locator('.console-panel').boundingBox();
          const before = (await page.locator('.console-tally').innerText()).trim();
          let ticked = '';
          if (box !== null) {
            for (let row = 1; row < 22 && ticked === ''; row++) {
              for (let column = 1; column < 32 && ticked === ''; column++) {
                const x = box.x + (box.width * column) / 44;
                const y = box.y + (box.height * row) / 26;
                if (
                  panel !== null &&
                  x >= panel.x - 8 &&
                  x <= panel.x + panel.width + 8 &&
                  y >= panel.y - 8 &&
                  y <= panel.y + panel.height + 8
                ) {
                  continue;
                }
                await page.mouse.click(x, y);
                const now = (await page.locator('.console-tally').innerText()).trim();
                if (now !== before) ticked = now;
              }
            }
          }
          if (ticked === '') {
            failures.push({ what: 'board', detail: 'no map click ticked a candidate on a companion board' });
          } else {
            sawMapTick = true;
            process.stdout.write(`e2e: a click on the map → ${ticked}\n`);
          }
          if (!(await page.locator('.console-panel').isVisible())) {
            failures.push({ what: 'board', detail: 'clicking the map closed the board' });
          }
          for (const on of await page.locator('.choice-button.is-picked').all()) await on.click();
        }

        const wanted = new Set((wirePlayed ?? wireTarget).truth.map((id) => pathById.get(id) ?? ''));
        const options = await page.locator('.choice-button').count();
        for (let i = 0; i < options; i++) {
          const button = page.locator('.choice-button').nth(i);
          if (wanted.has((await button.innerText()).trim())) await button.click();
        }
        await submitBoard(page, 'companion board');
        await page.waitForSelector('.console-score', { timeout: 5000 });

        // The reveal must promise only what the map will actually draw. The
        // shipped bug this guards against ran the other way — the panel said
        // "now drawn on the map" beside a map that had stopped drawing it.
        const summary = (await page.locator('.console-evidence, .console-summary').allInnerTexts())
          .join(' ')
          .trim();
        process.stdout.write(`e2e: companion summary → ${summary.replace(/\s+/g, ' ')}\n`);

        await submitBoard(page, 'companion: back to the map');
        await page.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });
        // That was a second grade, so a second turn is running.
        await settle();
        await page.waitForFunction(
          () => /(\d+) wires/.test(document.querySelector('.hud-detail')?.textContent ?? ''),
          undefined,
          { timeout: 5000 },
        );
        const wires = Number(
          /(\d+) wires/.exec(await page.locator('.hud-detail').innerText())?.[1] ?? '0',
        );
        process.stdout.write(`e2e: history wires after one companion pass → ${wires}\n`);
        if (wires <= 0) {
          failures.push({
            what: 'wires',
            detail: `passing ${wireTargetPath} drew no co-change wire — the gate never opened`,
          });
        }
        await page.screenshot({ path: join(SHOT_DIR, 'wires.png') });
      }

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
      // ADR-0011 decision 2: a cursor is never persisted, and an orientation
      // into the rotation is one. Every session arrives at the canonical map,
      // which is also the only heading a returning player can already have
      // learned. The pass above turned the map; the reload must not restore it.
      const headingAfterReload = await heading();
      process.stdout.write(`e2e: heading after reload → ${headingAfterReload}°\n`);
      if (headingAfterReload !== 0) {
        failures.push({
          what: 'rotation',
          detail: `the heading survived a reload at ${headingAfterReload}° — it is being persisted`,
        });
      }
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
      const landedOn = rendered(await page.locator('.inspector-path').innerText());
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

      // ---- the negative witness (ADR-0020) ------------------------------
      // **Every board this script plays, it plays perfectly**, which is why the
      // witness had to be checked here explicitly: it renders only under a
      // *wrong* pick, so a run that never gets one wrong exercises none of it.
      // That is the "infrastructure with no consumer" trap with the consumer
      // present and never reached — and the screenshots would have looked fine.
      //
      // The pick is chosen by asking the **verb** what it would say, rather than
      // by this script re-deriving the withhold table. Two classes are never
      // spoken and padding is never spoken, so picking any distractor at random
      // would fail on the ones that are correctly silent.
      //
      // **The board is identified from the open console, not predicted from the
      // atlas.** `atlas.challenges` is sorted by **id**, so `archaeology-…`
      // sorts before everything, while `challengeFor` serves a node's bucket in
      // **tier** order — blast radius first. Measured on this deck, 27 subjects
      // carry two or more boards and the two orders disagree on **20** of them,
      // so predicting the board would hunt for a commit label among file-path
      // buttons and time out. It passed once because today's suggestion happens
      // to carry exactly one board; ark indexes itself and CI plays a different
      // merge commit, which is the `.find()` landmine's exact mechanism.
      //
      // So: open it, read the choice set off the screen, and match the board
      // whose candidates those are.
      const boardsHere = atlas.challenges.filter(
        (entry) => labelById.get(entry.subject) === landedOn,
      );
      await page.locator('.inspector-action').click();
      await page.waitForSelector('.console-panel', { timeout: 5000 });
      const shown = (await page.locator('.choice-path').allInnerTexts()).map(rendered);
      const shownSet = new Set(shown);
      const witnessBoard = boardsHere.find(
        (entry) =>
          entry.candidates.length === shown.length &&
          entry.candidates.every((id) => shownSet.has(labelById.get(id) ?? '\u0000')),
      );
      if (witnessBoard === undefined) {
        failures.push({
          what: 'witness',
          detail: `${landedOn} has ${boardsHere.length} board(s), none matching the ${shown.length} choices on screen`,
        });
      } else {
        const answers = new Set(witnessBoard.truth);
        const wrong = witnessBoard.candidates.filter((id) => !answers.has(id));
        const preview = VERBS[witnessBoard.verb].reveal(atlas, graph, witnessBoard, {
          score: 0,
          correct: [],
          missed: [...witnessBoard.truth],
          spurious: wrong,
          evidence: '',
        });
        const spoken = preview.notes.find(
          (note) => note.witness !== null && !answers.has(note.id),
        );
        if (spoken === undefined) {
          failures.push({
            what: 'witness',
            detail: `${landedOn}'s board offers no wrong answer the verb will explain`,
          });
        } else {
          // **Every answer, plus the one wrong row whose witness is being
          // checked.** This was a workaround for ADR-0035's precision bar —
          // picking the wrong row alone scored precision 0 and the board went
          // silent, so the step measured the withholding rule rather than the
          // witness. The bar is gone (ADR-0047) and the shape is kept anyway,
          // because it is the honest near-miss this step is about and it leaves
          // exactly one spurious row to explain.
          // **Rendered text on both sides.** `commitLabel` separates its date,
          // sha and subject with *two* spaces and `innerText` collapses them to
          // one, so a commit row can never equal the string the verb built.
          // This file's own landmine says exactly that, about a step four
          // hundred lines up; this site kept the raw comparison and was
          // invisible for as long as the deck happened to land on a
          // file-candidate verb. Adding one script to this repo re-rolled the
          // deck onto Archaeology and it went red — ark indexes itself, so
          // "which board this step plays" is not a constant.
          const wanted = new Set(
            [...witnessBoard.truth]
              .map((id) => rendered(labelById.get(id) ?? ''))
              .filter((l) => l !== ''),
          );
          const spokenLabel = rendered(spoken.label);
          const count = await page.locator('.choice-button').count();
          let picked = false;
          for (let i = 0; i < count; i++) {
            const button = page.locator('.choice-button').nth(i);
            const label = rendered(await button.innerText());
            if (label === spokenLabel) {
              await button.click();
              picked = true;
            } else if (wanted.has(label)) {
              await button.click();
            }
          }
          if (!picked) {
            failures.push({ what: 'witness', detail: `${spoken.label} was not on the board` });
          }
          await submitBoard(page, 'witness board');
          await page.waitForSelector('.console-score', { timeout: 5000 });
          const witnesses = (await page.locator('.note-witness').allInnerTexts()).map((text) =>
            text.trim(),
          );
          process.stdout.write(`e2e: witness → ${witnesses[0] ?? '(none)'}\n`);
          // The exact sentence the verb wrote, so a panel that rendered *a*
          // witness for the wrong row would not pass.
          if (!witnesses.includes(`Offered as ${spoken.witness ?? ''}.`)) {
            failures.push({
              what: 'witness',
              detail: `panel showed ${JSON.stringify(witnesses)}, verb wrote "${spoken.witness ?? ''}"`,
            });
          }
          // And an answer must never carry one — nothing chose it.
          const rows = await page.locator('.console-notes .note').count();
          if (witnesses.length >= rows) {
            failures.push({
              what: 'witness',
              detail: `${witnesses.length} witnesses over ${rows} rows — answers are being explained too`,
            });
          }
          await page.screenshot({ path: join(SHOT_DIR, 'witness.png') });
          await submitBoard(page, 'witness: back to the map');
        }
      }

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
        // **Find the note by its subject, never by its position.** `fieldNotes`
        // sorts by descending radius, then path, then verb — nothing to do with
        // the order the player proved things in — so `.first()` was an ordering
        // assumption that happened to hold. It held until a commit that changed
        // only prose changed the deck (ark indexes itself), the grid scan landed
        // on a different first subject, and this compared *some other pass's*
        // note against this challenge's answer key. The check below cannot care
        // what order the notebook is in.
        const claims = (await page.locator('.field-note-claim').allInnerTexts()).map((text) =>
          text.trim(),
        );
        // **Match the subject, not the sentence.** A claim reads
        // `You proved N files that change with SUBJECT — member, member, …`,
        // so `text.includes(subject)` also matches a note about someone *else*
        // that happens to list this subject as one of its members — and picks
        // it, because `find` takes the first. That is the same
        // select-by-position mistake the comment above describes, wearing a
        // substring: it went red on the CI merge commit, where a note for
        // `tests/unit/placement.test.ts` listed the subject among six members
        // and sorted first. Everything before the first em dash is the claim
        // about the subject; everything after it is the list of members.
        const mine = claims.find((text) => claimAbout(text).includes(subject));
        process.stdout.write(`e2e: note → ${mine ?? claims[0] ?? '(none)'}\n`);
        // Every note, not just one: the surveyed/understood line is broken by
        // any sentence stronger than what was earned, wherever it sits.
        for (const claim of claims) {
          if (!claim.startsWith('You proved')) {
            failures.push({ what: 'notes', detail: `a note must claim only what was proved: "${claim}"` });
          }
        }
        if (mine === undefined) {
          failures.push({ what: 'notes', detail: `no note names ${subject}, which was just proved` });
        } else if (challenge !== undefined && !mine.includes(String(challenge.truth.length))) {
          failures.push({
            what: 'notes',
            detail: `note for ${subject} claims a different count than the ${challenge.truth.length} files proved: "${mine}"`,
          });
        }
        // The full radius may appear, but only in a line labelled as revealed —
        // and that has to hold for every one of them, not for whichever is top.
        for (const shown of await page.locator('.field-note-revealed').allInnerTexts()) {
          if (!shown.includes('revealed')) {
            failures.push({ what: 'notes', detail: `the radius is stated as knowledge: "${shown.trim()}"` });
          }
        }
      }

      // ---- the guide's caption and the board Enter opens ------------------
      //
      // They drifted, and six of ten cold playtesters hit it. `suggestNext`
      // picks partly for **verb variety**; `challengeFor` returned the node's
      // first unpassed board in **tier order** and threw that away, so a
      // Companion suggestion opened as Blast Radius. Measured through the real
      // selector: 3 of the first 12, including board two. The sharpest report
      // was a skip that moved the caption while `Enter` opened the old board.
      //
      // A unit test cannot see this — `challengeFor` is shell-local and the two
      // halves only meet in a browser.
      {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        // `answerKey` joins with a newline, so print it flattened or the log
        // breaks across two lines and reads as truncated output.
        const flat = (key: unknown): string => String(key).replace(/\n/g, ' ');
        let rivals = 0;
        let checked = 0;
        // **Skip until a suggestion whose subject carries a rival board**, and
        // require at least one. The first version of this checked whichever
        // suggestion happened to be up, landed on a subject carrying one board,
        // and a mutant deleting the entire fix passed it — this file's own
        // landmine about never predicting which board the shell serves, in the
        // gate written to catch that very class of defect.
        for (let round = 0; round < 10; round += 1) {
          const rival = await page.evaluate(
            () => (globalThis as unknown as { __arkNextRival?: unknown }).__arkNextRival,
          );
          if (rival !== true) {
            if ((await page.locator('.guide-skip').count()) === 0) break;
            await page.locator('.guide-skip').click();
            await page.waitForTimeout(200);
            continue;
          }
          rivals += 1;
          await page.locator('.guide-action').click();
          await page.waitForTimeout(400);
          const promised = await page.evaluate(
            () => (globalThis as unknown as { __arkNextKey?: unknown }).__arkNextKey,
          );
          await page.keyboard.press('Enter');
          await page.waitForTimeout(400);
          const opened = await page.evaluate(
            () => (globalThis as unknown as { __arkOpenKey?: unknown }).__arkOpenKey,
          );
          checked += 1;
          process.stdout.write(
            `e2e: guide promised ${flat(promised)}, Enter opened ${flat(opened)}\n`,
          );
          if (promised === null || opened === null || promised !== opened) {
            failures.push({
              what: 'guide',
              detail: `caption offered ${flat(promised)} and Enter opened ${flat(opened)}`,
            });
          }
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          break;
        }
        process.stdout.write(`e2e: guide/board agreement checked on ${checked} rival board(s)\n`);
        if (rivals === 0) {
          failures.push({
            what: 'guide',
            detail:
              'no suggestion carried a rival board in 10 skips, so the caption-vs-Enter check measured nothing',
          });
        }
        await page.locator('.hud-notes').click();
        await page.waitForSelector('.notes-panel', { timeout: 5000 });
      }

      // ---- the medal shelf ----------------------------------------------
      // Four of ten cold playtesters said the game had no arc, only a counter
      // going down. This is the surface that answers that, and two of its
      // properties are invisible to a unit test.
      //
      // **An unearned medal must still draw its outline.** The sub-pass badge
      // shipped as a conic gradient that at 0% was a near-black rounded square —
      // the missing-visual defect reproduced inside the fix for it — and an
      // unearned medal is the *common* case in the first ten minutes. So: every
      // medal has an outline path, whatever its state.
      const shelf = await page.locator('.medal').count();
      if (shelf === 0) {
        failures.push({ what: 'medals', detail: 'the shelf drew no medals at all' });
      }
      const outlines = await page.evaluate(
        () => document.querySelectorAll('.medal-art path[fill="none"]').length,
      );
      if (outlines !== shelf) {
        failures.push({
          what: 'medals',
          detail: `${outlines} outlines over ${shelf} medals — an unearned medal is drawing nothing`,
        });
      }
      // And a pass has to have *moved* something, or the shelf is decoration.
      const won = await page.locator('.medal.is-earned').count();
      const filled = await page.evaluate(
        () => document.querySelectorAll('.medal-art path[clip-path]').length,
      );
      process.stdout.write(`e2e: medals → ${shelf} on the shelf, ${won} earned, ${filled} part-filled\n`);
      if (filled === 0) {
        failures.push({
          what: 'medals',
          detail: 'a board was passed and no medal shows any progress at all',
        });
      }
      // The shelf and the toggle must agree — two surfaces, one population.
      const toggleText = (await page.locator('.hud-notes').innerText()).trim();
      if (!toggleText.includes(`${won}/${shelf} medals`)) {
        failures.push({
          what: 'medals',
          detail: `toggle says "${toggleText}" and the shelf holds ${won} of ${shelf}`,
        });
      }
      await page.screenshot({ path: join(SHOT_DIR, 'field-notes.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.notes-scrim', { state: 'hidden', timeout: 5000 });
    }

    // ---- the legend (ADR-0041) -----------------------------------------
    //
    // The change's user-facing claim is that the rows are ordered by size, that
    // terrain is one row, and that a clipped list can be **scrolled** — and
    // none of that was checked by anything running a browser. The scroll in
    // particular is a CSS property nothing else can see: it was declared and
    // simultaneously disabled by `pointer-events: none` in the same rule block
    // for a milestone.
    const legendRowText = await page.locator('.legend-item').allInnerTexts();
    if (legendRowText.length === 0) {
      failures.push({ what: 'legend', detail: 'the legend drew no rows at all' });
    }
    // **`rendered`, because a row is now two spans and a tally.** The region
    // name and its per-region proved count are separate elements, so
    // `innerText` puts a newline between them and an anchored `$` no longer
    // matches — the rendered-text landmine, met from the layout side rather
    // than from the whitespace side.
    const legendCounts = legendRowText.map((row) =>
      Number(/\((\d+)[^)]*\)/.exec(rendered(row))?.[1] ?? '-1'),
    );
    if (legendCounts.some((n) => n < 0)) {
      failures.push({ what: 'legend', detail: `a row printed no count: ${legendRowText.join(' | ')}` });
    }
    // Terrain sorts last however big it is; every other row descends by size.
    const terrainAt = legendRowText.findIndex((row) => row.startsWith('terrain'));
    const topology = terrainAt === -1 ? legendCounts : legendCounts.slice(0, terrainAt);
    for (let i = 1; i < topology.length; i++) {
      if ((topology[i] ?? 0) > (topology[i - 1] ?? 0)) {
        failures.push({
          what: 'legend',
          detail: `rows are not descending by size: ${legendRowText.join(' | ')}`,
        });
        break;
      }
    }
    if (terrainAt !== -1 && terrainAt !== legendRowText.length - 1) {
      failures.push({ what: 'legend', detail: `terrain is not last: ${legendRowText.join(' | ')}` });
    }
    if (legendRowText.filter((row) => row.startsWith('terrain')).length > 1) {
      failures.push({ what: 'legend', detail: 'terrain drew more than one row' });
    }
    // The list must actually take a wheel event. `scrollHeight > clientHeight`
    // says it overflows; scrolling it and reading `scrollTop` says the overflow
    // is reachable, which is the half that was broken. On a repo whose legend
    // fits, there is nothing to scroll and the check is skipped rather than
    // faked — and it says which happened.
    //
    // **The window is shrunk to force the overflow**, because at 1440x900 this
    // repo's seven rows fit and the branch that was broken never runs — the
    // first version of this step printed "fits without scrolling" and asserted
    // nothing, which is the never-fires landmine inside the test written to
    // close it. `max-height: 42vh` means a short window clips, on any repo.
    const listBox = page.locator('.legend-list');
    await page.setViewportSize({ width: 1440, height: 260 });
    await page.waitForTimeout(120);
    const overflows = await listBox.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
    if (!overflows) {
      failures.push({
        what: 'legend',
        detail: `${legendRowText.length} rows still fit in a 260px window — the scroll path cannot be tested`,
      });
    } else {
      // **A real wheel over the panel, not `node.scrollTop = 40`.** Assigning
      // `scrollTop` is a DOM write that succeeds whatever `pointer-events` says,
      // so it would pass against the exact bug this fixes. Hit-testing is the
      // thing under test, so the input has to be hit-tested.
      const box = await listBox.boundingBox();
      if (box === null) {
        failures.push({ what: 'legend', detail: 'the list has no box to point at' });
      } else {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(120);
        const moved = await listBox.evaluate((node) => node.scrollTop);
        if (moved <= 0) {
          failures.push({
            what: 'legend',
            detail: 'the list overflows and a wheel over it scrolled nothing — pointer-events again',
          });
        }
        process.stdout.write(
          `e2e: legend → ${legendRowText.length} rows, clipped at 260px, wheel scrolled it to ${moved}\n`,
        );
      }
    }
    // Restoring the *size* is not restoring the *view*: the camera does not
    // re-fit on resize, so leaving it here sent the next step's zoom to
    // "street - 1 nodes" and reddened the peaks gate 200 lines later. `f` fits
    // at the current heading, which is the control a player would use.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(120);
    await page.mouse.move(720, 450);
    await page.keyboard.press('f');
    await page.waitForTimeout(200);

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
    // The repaint's own liveness gate, and it is here for the reason every
    // other counted layer is: the landmasses are the figure-ground the map had
    // none of, and a fill that quietly stopped happening would look exactly
    // like the map it replaced. Counted on this repo rather than asserted in a
    // fixture — `CLAUDE.md`'s rule about machinery that never fires.
    const isles = Number(/(\d+) isles/.exec(zoomLevel)?.[1] ?? '0');
    if (isles <= 0) {
      failures.push({ what: 'isles', detail: `no region landmass filled: ${zoomLevel}` });
    }
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
    process.stdout.write(`e2e: tallest is ${tallest}\n`);
    // NORTH-STAR §4 says a session should leave you able to name the
    // most-depended-upon module, so assert the tallest file is one the fog has
    // already given a name to — that is what `landmarks()` ranking by elevation
    // is *for*. The first version of this check computed the name and then
    // asserted the canvas was visible, which is to say it asserted nothing.
    const tallestIsLandmark = await page.evaluate(async () => {
      const response = await fetch('atlas.json', { cache: 'no-cache' });
      const atlas = (await response.json()) as { nodes: { path: string; elevation: number }[] };
      const top = Math.max(...atlas.nodes.map((node) => node.elevation));
      const raw = window.localStorage.getItem(
        Object.keys(window.localStorage).find((key) => key.startsWith('ark:')) ?? '',
      );
      const surveyed = new Set<string>(
        raw === null ? [] : ((JSON.parse(raw) as { surveyed?: string[] }).surveyed ?? []),
      );
      return { top, surveyedCount: surveyed.size };
    });
    if (tallestIsLandmark.top <= 0) {
      failures.push({ what: 'peaks', detail: 'no node has any elevation — the atlas is flat' });
    }
    if (tallestIsLandmark.surveyedCount === 0) {
      failures.push({ what: 'peaks', detail: 'nothing surveyed — landmarks gave no head start' });
    }

    // ---- the map does not draw an open board's answer key ----------------
    //
    // ADR-0008 decision 1 draws every node's **direct importers** for free, and
    // a Blast Radius key is a sample of the **transitive** dependent set, which
    // contains them. So a board open on `S` drew a gold line from `S` to some of
    // its own answers: measured, **37 of ark's 40 boards and 81 of 216 key
    // members**, 94–96% of hono's and graphql-js's. A cold playtester found it
    // at street zoom and proved the lines belonged to the subject by
    // deselecting with the camera untouched.
    //
    // Gated the way they found it — on the pixels, at street zoom, with the
    // camera fixed — because the whole defect is that the ink is only obvious
    // when you zoom in to read the map, which is what a player does.
    {
      const marked = await page.evaluate('window.__arkEdgeInk ?? null');
      if (marked !== null) {
        failures.push({ what: 'ring', detail: 'stale ink probe left on the page' });
      }
      // **The rule ADR-0008 decision 1 states, both halves of it.** Depth 1 is
      // drawn *"for every node, always — in free roam and while a challenge is
      // open alike"*, and the **full** cone only for a subject in
      // `fog.understood`. The decision's Rejected list names *"suppress
      // everything while a challenge is open"* explicitly.
      //
      // This gate has now asserted three different rules in three commits — off
      // for every board, off for import-graded boards, and the ADR's — which is
      // what happens when a gate is written from the code instead of from the
      // decision. It reads the decision now: with a board open, whatever its
      // verb, the channel is live and bounded at depth 1 for an unproved
      // subject.
      const plates = (await page.evaluate('window.__arkNameplates ?? []')) as {
        path: string;
        x: number;
        y: number;
      }[];
      const seen = new Map<string, string>();
      for (const plate of Array.isArray(plates) ? plates : []) {
        if (seen.size >= 2) break;
        await page.mouse.click(plate.x, plate.y);
        await page.waitForTimeout(110);
        if ((await page.locator('.inspector-action').count()) === 0) continue;
        await page.locator('.inspector-action').click();
        await page.waitForSelector('.choice-button', { timeout: 5000 });
        await drawn(page);
        // `innerText` is rendered text and the CSS uppercases this element.
        const verb = rendered(await page.locator('.console-verb').innerText()).toLowerCase();
        const kind = verb === 'blast radius' ? 'imports' : 'history';
        if (!seen.has(kind)) {
          // **Both halves, and the second one is read rather than assumed.**
          // The decision's depth depends on whether the subject is proved, so a
          // check that only knows the depth has to guess which rule applies —
          // and it guessed "unproved", which is a prediction about which board a
          // re-rolling deck serves. It went red on a commit that added two
          // scripts, over a full cone ADR-0008 decision 1 grants outright.
          const drew = String(await page.evaluate('window.__arkRadius ?? "absent"'));
          const traced = new Set(
            ((await page.evaluate('window.__arkTraced ?? []')) as number[]) ?? [],
          );
          const ref = Number(/^subject (\d+)/.exec(drew)?.[1] ?? NaN);
          seen.set(kind, `${drew}${traced.has(ref) ? ' (proved)' : ' (unproved)'}`);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
      await drawn(page);
      const closed = String(await page.evaluate('window.__arkRadius ?? "absent"'));
      process.stdout.write(
        `e2e: radius — import board ${seen.get('imports') ?? 'not reached'}, ` +
          `history board ${seen.get('history') ?? 'not reached'}, closed ${closed}\n`,
      );
      const onImports = seen.get('imports');
      if (onImports === undefined) {
        failures.push({ what: 'ring', detail: 'no import-graded board was reached, so nothing was measured' });
      } else if (!onImports.startsWith('subject ')) {
        failures.push({
          what: 'ring',
          detail: `an open Blast Radius board drew no import radius (${onImports}) — ADR-0008 decision 1 draws depth 1 always, and §8.4 calibrates difficulty against exactly that guess`,
        });
      } else if (onImports.endsWith('(unproved)') && !onImports.includes('depth 1 ')) {
        failures.push({
          what: 'ring',
          detail: `an open board on an unproved subject drew more than depth 1 (${onImports}) — the full cone is earned, not shown`,
        });
      } else if (onImports.endsWith('(proved)') && !onImports.includes('depth Infinity ')) {
        // The half nothing checked. A proved subject *must* get its whole cone —
        // that is the reward the pass buys, and a gate that only ever asserted
        // "depth 1" would have read a silently withdrawn unlock as a pass.
        failures.push({
          what: 'ring',
          detail: `an open board on a proved subject drew ${onImports} — passing a board unlocks its full cone`,
        });
      }
      const onHistory = seen.get('history');
      if (onHistory !== undefined && !onHistory.startsWith('subject ')) {
        failures.push({
          what: 'ring',
          detail: `a history board drew no import radius (${onHistory}) — the rule must not depend on which board is open`,
        });
      }
      // The control: without it a dead radius channel reads as a pass.
      if (closed === 'none') {
        failures.push({
          what: 'ring',
          detail: 'no import radius with the board closed either, so the assertions above prove nothing',
        });
      }
    }

    // ---- the panel only promises inputs the board actually has -----------
    //
    // "Tick a row here, or click its marker on the map" is verb-blind copy, and
    // whether it is **true** depends on what a candidate is: Archaeology's are
    // commits, which have nowhere to stand (ADR-0018), so on that board there is
    // no marker to click. A screenshot caught it; no test would have, because
    // both the sentence and the board are individually correct.
    //
    // Read off the panel rather than predicted: open boards until both kinds
    // have been seen, and assert the sentence is present exactly where the map
    // marked something.
    {
      await page.keyboard.press('f');
      await page.waitForTimeout(220);
      const plates = (await page.evaluate('window.__arkNameplates ?? []')) as {
        x: number;
        y: number;
      }[];
      let checked = 0;
      for (const plate of Array.isArray(plates) ? plates : []) {
        if (checked >= 4) break;
        await page.mouse.click(plate.x, plate.y);
        await page.waitForTimeout(110);
        if ((await page.locator('.inspector-action').count()) === 0) continue;
        await page.locator('.inspector-action').click();
        await page.waitForSelector('.choice-button', { timeout: 5000 });
        await drawn(page);
        const verb = rendered(await page.locator('.console-verb').innerText()).toLowerCase();
        const says = (await page.locator('.console-how').count()) > 0;
        // **Candidate markers, not marks.** The HUD's `marks` counts the
        // subject's ring too, and an Archaeology board marks its subject — a
        // file — while none of its candidates, which are commits, has a place.
        // Reading the merged number made this gate demand a click hint on the
        // one board where clicking answers nothing; CI caught it, on a rule I
        // had written the same day to stop a sentence being false.
        const marks = Number(await page.evaluate('window.__arkCandidateMarks ?? 0'));
        checked += 1;
        process.stdout.write(
          `e2e: ${verb} → ${marks} candidate marks, click hint ${says ? 'shown' : 'absent'}\n`,
        );
        if (marks > 0 && !says) {
          failures.push({
            what: 'inputs',
            detail: `${verb} marked ${marks} clickable candidates and did not say they can be clicked`,
          });
        }
        if (marks === 0 && says) {
          failures.push({
            what: 'inputs',
            detail: `${verb} marked no clickable candidate and told the player to click a marker`,
          });
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(180);
      }
      if (checked === 0) {
        failures.push({ what: 'inputs', detail: 'no board was opened, so nothing was measured' });
      }
    }

    // ---- a skipped verb counts as met ------------------------------------
    //
    // `unmetVerb` is a one-shot rank term that lifts the first board of a verb
    // the player has not met, so that a strict `tier` does not hide the history
    // verbs behind a hundred tier-3 boards. A verb counts as met when it is
    // **graded or skipped** — without the second half, skipping the
    // introduction offers the entire unmet deck one skip at a time (measured:
    // 102 consecutive suggestions on this repo, 274 on django).
    //
    // **What this holds is that skipping never re-offers what it just declined**,
    // and that is deliberately narrower than the paragraph above. The first
    // version of this step claimed to cover the met-verb half of a skip, and it
    // did not: deleting that half leaves `12 suggestions, 12 distinct` either
    // way, because `noteSkip`'s list already prevents a repeat on its own. The
    // met-verb half is a unit test now (`noteSkipped`), where it can be held to
    // the state rather than to a symptom this step cannot see.
    //
    // It stays because the anti-lockout clear is real and shell-side: a skip
    // list that never emptied would strand the player, and that *is* visible
    // here.
    {
      await page.keyboard.press('f');
      await page.waitForTimeout(200);
      // **The selector's own key, not the rendered caption.** The caption reads
      // "N left · next is X" and X is the *subject*; the key the selector
      // de-duplicates on is `(verb, subject)`. So two boards asking different
      // questions about one file render one caption, and this step scored a
      // correct pair as a re-offer — `11 distinct of 12` on a run where the
      // selector had done nothing wrong. Same family as this file's other
      // three: identify the thing by what identifies it, never by a sentence
      // that happens to mention it.
      const suggestion = async (): Promise<string> =>
        String(
          await page.evaluate(
            () => (globalThis as unknown as { __arkNextKey?: unknown }).__arkNextKey,
          ),
        );
      const seen: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        if ((await page.locator('.guide-skip').count()) === 0) break;
        seen.push(await suggestion());
        await page.locator('.guide-skip').click();
        await page.waitForTimeout(120);
      }
      const distinct = new Set(seen).size;
      process.stdout.write(`e2e: skipped ${seen.length} suggestions, ${distinct} distinct\n`);
      if (seen.length < 3) {
        failures.push({
          what: 'skip',
          detail: `the skip control disappeared after ${seen.length} presses, so nothing was measured`,
        });
      } else if (distinct < seen.length) {
        failures.push({
          what: 'skip',
          detail: `skipping re-offered a suggestion: ${distinct} distinct of ${seen.length}`,
        });
      }
    }

    // ---- closing a board gives back the pan it took ----------------------
    //
    // `openBoard` slides the subject to 30% from the left so the docked panel
    // does not sit on top of it. Nothing gave that back, and the golden-angle
    // turn then swung the map about the off-centre point it was left at — so
    // the frame a player lands in after **every** grade had the map in one
    // corner and half the screen empty. A design review called it the
    // worst-composed frame the product produces, and it is the reward beat of
    // the core loop.
    //
    // Gated on the camera rather than on pixels, because the rule is about the
    // camera and a canvas hash cannot tell a restored view from the turn that
    // follows it. Read after the turn has landed, so what is asserted is the
    // frame the player is actually left sitting in.
    {
      type Cam = { x: number; y: number; scale: number };
      const cameraNow = async (): Promise<Cam> => {
        await drawn(page);
        return (await page.evaluate('window.__arkCamera ?? null')) as Cam;
      };
      await page.keyboard.press('f');
      await page.waitForTimeout(240);

      // **Open the board off a name on the map, never off the guide.** The
      // first version pressed "Where next?" and then Enter, which on CI opened
      // a **Placement** board — its subject is a commit, there is nowhere to
      // pan to, and `openBoard` correctly borrows nothing. The control then
      // fired: *"opening a board moved the camera by nothing"*. That is the
      // control doing its job on a step that had predicted what the shell
      // would serve, which is this file's oldest recurring mistake.
      //
      // A nameplate is a node by construction, so the board it opens has a
      // place. Walk them until one carries an "answer this" control.
      const plates = (await page.evaluate('window.__arkNameplates ?? []')) as {
        path: string;
        x: number;
        y: number;
      }[];
      let opened = false;
      let before: Cam | null = null;
      for (const plate of Array.isArray(plates) ? plates : []) {
        await page.mouse.click(plate.x, plate.y);
        await page.waitForTimeout(120);
        if ((await page.locator('.inspector-action').count()) === 0) continue;
        // Read *after* selecting: a click on the map selects and surveys, and
        // does not move the camera, but reading before it would fold any
        // movement it did make into the board's borrowing.
        before = await cameraNow();
        await page.locator('.inspector-action').click();
        await page.waitForSelector('.choice-button', { timeout: 5000 });
        opened = true;
        break;
      }
      if (!opened || before === null) {
        failures.push({
          what: 'pan',
          detail: `no drawn name of ${Array.isArray(plates) ? plates.length : 0} carried a board to open`,
        });
      } else {
        const panned = await cameraNow();
        await page.keyboard.press('Escape');
        // Escape does not grade, so no turn runs — what is compared is the pan
        // alone.
        await page.waitForTimeout(400);
        const back = await cameraNow();
        const moved = Math.hypot(panned.x - before.x, panned.y - before.y);
        const kept = Math.hypot(back.x - before.x, back.y - before.y);
        process.stdout.write(
          `e2e: board pan → borrowed ${moved.toFixed(1)} world units, ${kept.toFixed(1)} left after closing\n`,
        );
        if (moved < 1) {
          // The control, and it earns its place twice over: the first version
          // of this gate asserted the *composition* instead — how many nodes
          // stay in frame — and a run with the give-back deleted kept 345.9
          // units of pan while still reporting `261 of 261 nodes`, because
          // ark's map at fit scale survives being shoved half a screen
          // sideways. Then this line caught the placeless board above.
          failures.push({
            what: 'pan',
            detail: 'opening a board moved the camera by nothing, so the give-back cannot be measured',
          });
        } else if (kept > 0.5) {
          failures.push({
            what: 'pan',
            detail: `closing the board kept ${kept.toFixed(1)} of the ${moved.toFixed(1)} units it borrowed`,
          });
        }

        // **The other direction, which no suite could see.** `onClose` restores
        // only when the camera is still exactly where the board left it, and
        // every gate above moves it only via the board — so mutating
        // `sameCamera` to `() => true`, which would stomp a pan the *player*
        // made behind the open board, left the whole pyramid green. The
        // comment in `main.ts` calls that "the same theft in the other
        // direction"; this is the step that would notice it.
        //
        // The map stays live behind a docked board on purpose, so dragging here
        // is an ordinary thing to do and the camera it produces is the
        // player's.
        await page.locator('.inspector-action').count();
        for (const plate of Array.isArray(plates) ? plates : []) {
          await page.mouse.click(plate.x, plate.y);
          await page.waitForTimeout(120);
          if ((await page.locator('.inspector-action').count()) === 0) continue;
          await page.locator('.inspector-action').click();
          await page.waitForSelector('.choice-button', { timeout: 5000 });
          const onOpen = await cameraNow();
          // Drag the map behind the scrim — a deliberate pan, mid-board.
          await page.mouse.move(700, 700);
          await page.mouse.down();
          await page.mouse.move(560, 640, { steps: 8 });
          await page.mouse.up();
          await page.waitForTimeout(160);
          const mine = await cameraNow();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
          const after = await cameraNow();
          const dragged = Math.hypot(mine.x - onOpen.x, mine.y - onOpen.y);
          const stolen = Math.hypot(after.x - mine.x, after.y - mine.y);
          process.stdout.write(
            `e2e: pan behind an open board → dragged ${dragged.toFixed(1)}, ` +
              `${stolen.toFixed(1)} taken back on close\n`,
          );
          if (dragged < 1) {
            failures.push({
              what: 'pan',
              detail: 'dragging behind an open board moved the camera by nothing, so the guard cannot be measured',
            });
          } else if (stolen > 0.5) {
            failures.push({
              what: 'pan',
              detail: `closing undid ${stolen.toFixed(1)} units of a pan the player made themselves`,
            });
          }
          break;
        }
      }
    }

    // ---- a drawn name is a handle on its node ----------------------------
    //
    // A cold playtester answered **all eight** of their boards off the panel's
    // text list and never used the map once, reporting it as "naming the wrong
    // objects": pointing at a label selected whatever disc lay under the text.
    // The labels were right — `placeLabels` anchors each under its own node —
    // and the *pointer* was not. The unit half pins that the frame returns the
    // right node per label; this is the half that only a browser can check, that
    // clicking the pixels of a name selects the file that name belongs to.
    {
      await page.keyboard.press('f');
      await page.waitForTimeout(220);
      await drawn(page);
      const plates = await page.evaluate('window.__arkNameplates ?? []');
      const rows = Array.isArray(plates) ? plates : [];
      if (rows.length === 0) {
        failures.push({ what: 'labels', detail: 'the frame exposed no nameplates to point at' });
      }
      let checked = 0;
      let wrong = 0;
      // **Spread across the placed labels, not the top six.** `nameplates` is
      // priority-ordered, so the first six are the biggest hubs — the easiest
      // possible sample, and re-rolled every commit since ark indexes itself.
      // An interval walk reaches the crowded low-priority end, where a name is
      // most likely to sit over someone else.
      const typed = rows as { text: string; path: string; x: number; y: number }[];
      const step = Math.max(1, Math.floor(typed.length / 6));
      for (let i = 0; i < typed.length && checked < 6; i += step) {
        const row = typed[i];
        if (row === undefined) continue;
        // **Click empty water, not move to it.** Moving clears a *hover*; the
        // selection survives, and `pointermove` on a miss re-describes it — so
        // a hover that missed entirely was scored as "named someone else" with
        // the stale selection's path, and the 1.5s poll below simply timed out
        // with its result discarded. A click on empty space sets `selected =
        // null`, which is what "cleared" was supposed to mean. Asserted rather
        // than dropped, because a clear that silently fails puts every row that
        // follows into the failure mode this line exists to remove.
        await page.mouse.click(4, 4);
        const cleared = await pollUntil(
          async () => (await page.locator('.inspector-path').count()) === 0,
          1500,
        );
        if (!cleared) {
          failures.push({ what: 'labels', detail: 'could not clear the selection before a hover' });
          break;
        }
        await page.mouse.move(row.x, row.y);
        // Polled with a deadline rather than slept: the inspector is written
        // from the rAF loop, and this file already carries a landmine about
        // reading a rAF-driven value after a fixed wait.
        const landed = await pollUntil(
          async () => (await page.locator('.inspector-path').count()) > 0,
          2000,
        );
        if (!landed) continue;
        const shown = (await page.locator('.inspector-path').innerText()).trim();
        checked += 1;
        // **Exact, against the path the frame published.** `endsWith` on the
        // label is a substring match, and this repo has seven `index.ts` nodes:
        // pointing at one and surveying another passed that check — the defect
        // this step exists for, invisible to it.
        if (shown !== row.path) {
          wrong += 1;
          failures.push({
            what: 'labels',
            detail: `pointing at the name "${row.text}" (${row.path}) surveyed ${shown}`,
          });
        }
      }
      if (checked < 3) {
        failures.push({ what: 'labels', detail: `only ${checked} label hovers landed` });
      }
      process.stdout.write(`e2e: pointed at ${checked} names → ${wrong} named someone else\n`);

      // **And in the orbit**, which returned no nameplates at all until a review
      // pointed out the stated reason was a wrong technical claim: its peak
      // labels come from the same screen-space pass. Pointing at a summit name
      // there selected whatever column was behind the text — the same defect,
      // one view over — so it gets the same gate.
      await page.keyboard.press('o');
      await page.waitForTimeout(300);
      await drawn(page);
      const orbitPlates = await page.evaluate('window.__arkNameplates ?? []');
      const orbitRows = (Array.isArray(orbitPlates) ? orbitPlates : []) as {
        text: string;
        path: string;
        x: number;
        y: number;
      }[];
      if (orbitRows.length === 0) {
        failures.push({ what: 'labels', detail: 'the orbit exposed no nameplates to point at' });
      }
      let orbitChecked = 0;
      let orbitWrong = 0;
      for (const row of orbitRows.slice(0, 4)) {
        await page.mouse.click(4, 4);
        if (!(await pollUntil(async () => (await page.locator('.inspector-path').count()) === 0, 1500))) {
          failures.push({ what: 'labels', detail: 'could not clear the selection before an orbit hover' });
          break;
        }
        await page.mouse.move(row.x, row.y);
        if (!(await pollUntil(async () => (await page.locator('.inspector-path').count()) > 0, 2000))) {
          continue;
        }
        const shown = (await page.locator('.inspector-path').innerText()).trim();
        orbitChecked += 1;
        if (shown !== row.path) {
          orbitWrong += 1;
          failures.push({
            what: 'labels',
            detail: `orbit: pointing at "${row.text}" (${row.path}) surveyed ${shown}`,
          });
        }
      }
      if (orbitChecked < 2) {
        failures.push({ what: 'labels', detail: `only ${orbitChecked} orbit label hovers landed` });
      }
      process.stdout.write(
        `e2e: orbit — pointed at ${orbitChecked} names → ${orbitWrong} named someone else\n`,
      );
      await page.keyboard.press('o');
      await page.waitForTimeout(250);
    }

    // ---- keyboard navigation and the help card ---------------------------
    //
    // A cold playtester scored the controls 6 of 10, and the flat map could not
    // be moved from the keyboard at all — a real gap on a trackpad and an
    // absolute one for anyone not using a pointer. Both halves are gated on
    // pixels rather than on "no error", for the reason the orbit block below
    // spells out: this repo has shipped two instruments that reported confident
    // numbers about a map that was not moving.
    {
      // **Fit first, and that is not tidiness.** An earlier step zooms this page
      // to street level, and the first draft of this block pressed `+` from
      // there and reported *"+ changed no pixel"* — `clampScale` caps at
      // MAX_SCALE and the camera was already against it, so the control was
      // working and the instrument was testing the clamp. Fitting puts the
      // camera at a known scale with room in both directions.
      await page.keyboard.press('f');
      await page.waitForTimeout(200);
      const beforeArrow = await hashCanvas();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(180);
      const afterArrow = await hashCanvas();
      if (afterArrow === beforeArrow) {
        failures.push({ what: 'keys', detail: 'ArrowRight moved no pixel on the map' });
      }
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(180);
      const beforeZoom = await hashCanvas();
      await page.keyboard.press('+');
      await page.waitForTimeout(180);
      if ((await hashCanvas()) === beforeZoom) {
        failures.push({ what: 'keys', detail: '+ changed no pixel on the map' });
      }
      const beforeOut = await hashCanvas();
      await page.keyboard.press('-');
      await page.waitForTimeout(180);
      if ((await hashCanvas()) === beforeOut) {
        failures.push({ what: 'keys', detail: '- changed no pixel on the map' });
      }

      // The card is built from `controlsFor`, so the assertion is that it says
      // more than the HUD's one-line hint does — that being the whole reason it
      // exists. Comparing counts rather than text: the line is a *projection* of
      // the same list, so any row it drops is a control written down nowhere.
      await page.keyboard.press('?');
      await page.waitForSelector('.help', { state: 'visible', timeout: 3000 });
      const rows = await page.locator('.help-keys').count();
      const briefs = (await page.locator('.hud-keys').innerText()).split('·').length;
      if (rows <= briefs) {
        failures.push({
          what: 'keys',
          detail: `the help card lists ${rows} controls and the HUD line already had ${briefs}`,
        });
      }
      const helpText = (await page.locator('.help').innerText()).toLowerCase();
      // The gestures that were written down nowhere before this existed.
      for (const gesture of ['scroll', 'drag', 'arrows']) {
        if (!helpText.includes(gesture)) {
          failures.push({ what: 'keys', detail: `the help card never mentions ${gesture}` });
        }
      }
      await page.screenshot({ path: join(SHOT_DIR, 'help.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      // **The orbit's card too, because the map's was the only one gated and the
      // orbit's was the one that lied**: it listed `drag` twice with
      // contradictory sentences, one of them dead in that view. A gate that
      // covers one view of three is a gate over the view least likely to be
      // wrong.
      await page.keyboard.press('o');
      await page.waitForTimeout(220);
      await page.keyboard.press('?');
      await page.waitForSelector('.help', { state: 'visible', timeout: 3000 });
      const orbitKeys = await page.locator('.help-keys').allInnerTexts();
      const trimmed = orbitKeys.map((text) => text.trim());
      if (new Set(trimmed).size !== trimmed.length) {
        failures.push({ what: 'keys', detail: `the orbit card repeats a gesture: ${trimmed.join(', ')}` });
      }
      const orbitText = (await page.locator('.help').innerText()).toLowerCase();
      if (orbitText.includes('about the pointer')) {
        failures.push({ what: 'keys', detail: 'the orbit card offers pointer-anchored zoom, which is the map’s' });
      }
      process.stdout.write(`e2e: orbit card → ${trimmed.length} controls, no repeats\n`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      await page.keyboard.press('o');
      await page.waitForTimeout(150);
      if (await page.locator('.help').isVisible()) {
        failures.push({ what: 'keys', detail: 'Escape did not close the help card' });
      }
      process.stdout.write(`e2e: help card → ${rows} controls, HUD line carries ${briefs}\n`);
    }

    // ---- the orbit view -------------------------------------------------
    //
    // Gated by a canvas hash, because `npm run raster` printed confident,
    // plausible, completely false numbers twice before it had one: synthetic
    // input that drove nothing, and a zoom level where the map rendered as a
    // sub-pixel smudge. Both looked like success. So the assertion here is not
    // "no error" — it is "the pixels changed, and changed again when turned".
    const flatPixels = await hashCanvas();
    await page.keyboard.press('o');
    await page.waitForTimeout(220);
    const orbitPixels = await hashCanvas();
    const orbitDetail = (await page.locator('.hud-detail').innerText()).trim();
    process.stdout.write(`e2e: orbit → ${orbitDetail}\n`);
    await page.screenshot({ path: join(SHOT_DIR, 'orbit.png') });
    if (orbitPixels === flatPixels) {
      failures.push({ what: 'orbit', detail: 'pressing o changed nothing on the canvas' });
    }

    // Turning is the whole intervention — motion parallax over a structure you
    // stay outside of. If the drag moves no pixels, the rung does not exist.
    const canvasBox = await page.locator('canvas.map').boundingBox();
    if (canvasBox !== null) {
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      // Several small steps, not one jump: a single move can be coalesced away
      // and then the drag "happened" without ever reaching the handler.
      for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 14, cy + i * 3);
      await page.mouse.up();
      await page.waitForTimeout(220);
    }
    const turnedPixels = await hashCanvas();
    await page.screenshot({ path: join(SHOT_DIR, 'orbit-turned.png') });
    if (turnedPixels === orbitPixels) {
      failures.push({ what: 'orbit', detail: 'dragging did not turn the world — no parallax' });
    }

    // ADR-0009's D1: the overview survives, one keystroke away.
    await page.keyboard.press('o');
    await page.waitForTimeout(220);
    const backDetail = (await page.locator('.hud-detail').innerText()).trim();
    if (backDetail.includes('orbit')) {
      failures.push({ what: 'orbit', detail: `o did not return to the flat map: ${backDetail}` });
    }

    // ---- the walkable world (ADR-0033) ----------------------------------
    //
    // Same discipline as the orbit above: a canvas hash gates every claim,
    // because "the view changed" is the one thing a screenshot cannot assert
    // and `npm run raster` printed plausible nonsense twice before it had a
    // gate. Three things have to be true, and each is checked by a *measured*
    // value rather than by the absence of an error — entering changes the
    // picture, walking changes it again, and the ground carries roads, which is
    // the entire argument of ADR-0033 decision 1.
    //
    // **In from a selected node, which is ADR-0032 §3.4's fast travel and not a
    // convenience here.** Entering from the map with nothing selected spawns the
    // hero at the shore, outside the north edge — and the buildings near the
    // shore are the ones a session has already surveyed by this point, so the
    // walking assertion below had nothing left to find. It read 63 → 65, then
    // 67 → 69, then 74 → 75, then went red at 82 → 82 when ADR-0046's rank term
    // surveyed eight more nodes earlier. Sweeping harder is the wrong fix: at
    // 2.1× run speed the hero simply leaves the map and the next assertion goes
    // red instead, with `17 towers · 0 roads` on screen. Arriving *in* the city
    // is both the representative path and the one with something to survey.
    const entryBox = await page.locator('canvas.map').boundingBox();
    let entered = false;
    if (entryBox !== null) {
      for (let row = 1; row < 20 && !entered; row++) {
        for (let column = 1; column < 30 && !entered; column++) {
          const x = entryBox.x + (entryBox.width * column) / 30;
          const y = entryBox.y + (entryBox.height * row) / 20;
          await page.mouse.move(x, y);
          if ((await page.locator('.inspector-path').count()) === 0) continue;
          await page.mouse.click(x, y);
          entered = true;
        }
      }
    }
    // **Loudly, not silently.** With no node found the hero falls back to the
    // shore spawn and the walking assertion below inherits exactly the fragility
    // this entry exists to remove — passing, or failing for a reason that has
    // nothing to do with walking. A fallback nobody can see is worse than none.
    if (!entered) {
      failures.push({ what: 'world', detail: 'found no node to fast-travel from; entering at the shore' });
    }
    const beforeWorld = await hashCanvas();
    await page.keyboard.press('g');
    await page.waitForTimeout(300);
    const inWorld = await hashCanvas();
    await page.screenshot({ path: join(SHOT_DIR, 'world.png') });
    const worldDetail = (await page.locator('.hud-detail').innerText()).trim();
    process.stdout.write(`e2e: world → ${worldDetail}\n`);
    if (inWorld === beforeWorld) {
      failures.push({ what: 'world', detail: 'pressing g changed nothing on the canvas' });
    }
    // ADR-0033 decision 1: the roads *are* the import edges, and a world that
    // draws none teaches topology as proximity — the `treeSibling` fallacy with
    // legs. A count of zero here is that regression, silently.
    const roadsDrawn = Number(/(\d+) roads/.exec(worldDetail)?.[1] ?? '0');
    if (roadsDrawn <= 0) {
      failures.push({ what: 'world', detail: `the ground carried no roads: ${worldDetail}` });
    }
    const towersDrawn = Number(/(\d+) towers/.exec(worldDetail)?.[1] ?? '0');
    if (towersDrawn <= 0) {
      failures.push({ what: 'world', detail: `nothing was standing on the plane: ${worldDetail}` });
    }
    // ADR-0044: the districts are named at street level. The world has carried
    // region colour since it shipped and had no legend, so a hue meant nothing
    // to a walker. A count of zero here is that gap silently returning — and it
    // is a count rather than a screenshot for the reason `skylineDrawn` is:
    // a picture cannot tell an absent layer from a layer with nothing to draw.
    const archesDrawn = Number(/(\d+) arches/.exec(worldDetail)?.[1] ?? '0');
    if (archesDrawn <= 0) {
      failures.push({ what: 'world', detail: `no district was named: ${worldDetail}` });
    }
    // **The skyline is checked at the edge of the world, not here.** NORTH-STAR
    // risk #4 wants the silhouette of what you have not explored, and the world
    // drew *nothing* past `VIEW_DISTANCE` — seconds of unlit void when crossing
    // between clusters, which is the exact failure that risk names. But ark's
    // whole span is 475 units against a 620-unit view, so standing in the city
    // there is no "distant" to draw and this reads a legitimate 0. Asserting it
    // here would be asserting a path this repo cannot take from this spot. The
    // run-to-the-boundary step below is where the feature exists to fire, and
    // that is where it is gated.

    // Walking. `surveyed` must rise, because walking past a building is looking
    // at it — the mechanic that makes an unexplored world navigable rather than
    // a city of unnamed shapes. Read off the HUD, which is the same counter the
    // map's own survey step reads.
    const surveyedBeforeWalk = Number(
      /(\d+) surveyed/.exec((await page.locator('.hud-counts').innerText()).trim())?.[1] ?? '0',
    );
    await page.keyboard.down('w');
    await page.waitForTimeout(2600);
    await page.keyboard.up('w');
    await page.waitForTimeout(250);
    const walked = await hashCanvas();
    await page.screenshot({ path: join(SHOT_DIR, 'world-walked.png') });
    if (walked === inWorld) {
      failures.push({ what: 'world', detail: 'holding w moved nothing — the hero does not walk' });
    }
    // **Keep walking until something new is surveyed, with a deadline.** One
    // fixed burst in one fixed direction was an assumption about where the city
    // happens to lie, and ark indexes itself — adding two source files re-rolled
    // the layout, the hero's straight line passed only buildings the earlier map
    // steps had already surveyed, and a step that had been green for a milestone
    // went red on a commit that changed nothing about walking. That is the
    // `.first()` landmine with a compass instead of an index.
    //
    // The deadline is what keeps this an assertion: a genuinely dead surveyor
    // still fails, it just takes twelve seconds to say so instead of three.
    const surveyedNow = async (): Promise<number> =>
      Number(
        /(\d+) surveyed/.exec((await page.locator('.hud-counts').innerText()).trim())?.[1] ?? '0',
      );
    //
    // **And the sweeps have to cross the city, not the shore.** Entered from the
    // map with nothing selected the hero *would* spawn outside the north edge,
    // so short bursts only ever met the buildings nearest the shore — and this
    // step's real assumption is that some of *those* are still unsurveyed when
    // it runs. The fast-travel entry above is what removes that assumption. That assumption
    // gets weaker every time the deck improves. The entry above is the fix; the
    // extra sweeps here are the belt, and the deadline is untouched, so a
    // genuinely dead surveyor still fails.
    let surveyedAfterWalk = await surveyedNow();
    for (let sweep = 0; sweep < 8 && surveyedAfterWalk <= surveyedBeforeWalk; sweep++) {
      // Turn, then walk. Turning first is what makes the sweeps independent
      // rather than eight copies of the same straight line. **Walk, not run** —
      // running covers 2.1× the ground and takes the hero out of the city
      // entirely, which trades this assertion for the one below it.
      await page.keyboard.down('e');
      await page.waitForTimeout(500);
      await page.keyboard.up('e');
      await page.keyboard.down('w');
      await page.waitForTimeout(2000);
      await page.keyboard.up('w');
      await page.waitForTimeout(250);
      surveyedAfterWalk = await surveyedNow();
    }
    if (surveyedAfterWalk <= surveyedBeforeWalk) {
      failures.push({
        what: 'world',
        detail: `walking surveyed nothing in nine sweeps: ${surveyedBeforeWalk} → ${surveyedAfterWalk}`,
      });
    }
    process.stdout.write(
      `e2e: walking surveyed ${surveyedBeforeWalk} → ${surveyedAfterWalk}\n`,
    );

    // Turning, and then walking *after* turning — which is the case a playtest
    // broke the build on. `hero.ts` and `camera.ts` held two different bases for
    // one heading, so at 90° the hero walked out of its own camera: the figure
    // vanished and the city receded as you approached it. The unit suite pins
    // the bases; this pins the player-visible half, that the picture keeps
    // changing when you turn and then move.
    await page.keyboard.down('e');
    await page.waitForTimeout(600);
    await page.keyboard.up('e');
    await page.waitForTimeout(250);
    const turned = await hashCanvas();
    if (turned === walked) {
      failures.push({ what: 'world', detail: 'holding e turned nothing' });
    }
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOT_DIR, 'world-turned.png') });
    const afterTurnWalk = (await page.locator('.hud-detail').innerText()).trim();
    if ((await hashCanvas()) === turned) {
      failures.push({ what: 'world', detail: 'walking after a turn moved nothing' });
    }
    // And the world is still populated after turning off the arrival heading:
    // the basis bug emptied the frame, which a pixel hash alone cannot tell
    // from a legitimate change of scene.
    if (Number(/(\d+) towers/.exec(afterTurnWalk)?.[1] ?? '0') <= 0) {
      failures.push({
        what: 'world',
        detail: `turning and walking emptied the world: ${afterTurnWalk}`,
      });
    }

    // Out to the shore, which is the case the skyline exists for: far enough
    // that most of the repo is past `VIEW_DISTANCE`, where the world used to
    // draw literally nothing. Running *backwards* keeps the heading, so this is
    // a distance test rather than another turn test.
    await page.keyboard.down('Shift');
    await page.keyboard.down('s');
    await page.waitForTimeout(4200);
    await page.keyboard.up('s');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOT_DIR, 'world-shore.png') });
    const shoreDetail = (await page.locator('.hud-detail').innerText()).trim();
    process.stdout.write(`e2e: at the shore → ${shoreDetail}\n`);
    const shoreSkyline = Number(/(\d+) skyline/.exec(shoreDetail)?.[1] ?? '0');
    const shoreTowers = Number(/(\d+) towers/.exec(shoreDetail)?.[1] ?? '0');
    // **The gate is that something is standing, not that the skyline fired.**
    // Sampled over 121 positions, ark averages 10 silhouettes and hono 112 —
    // ark's entire 488-unit span fits inside one 620-unit view, so a 0 here is a
    // legitimate reading of a small repo and asserting on it would be a bar
    // sitting on a knife edge (the first version of this step measured exactly
    // **1**). The count is reported so a regression is visible; the assertion is
    // the property that actually matters.
    if (shoreTowers + shoreSkyline <= 0) {
      failures.push({ what: 'world', detail: `the shore is an empty plane: ${shoreDetail}` });
    }

    // ADR-0009's D1 again: the flat map is one keystroke away from here too.
    await page.keyboard.press('g');
    await page.waitForTimeout(250);
    const outDetail = (await page.locator('.hud-detail').innerText()).trim();
    if (outDetail.includes('world')) {
      failures.push({ what: 'world', detail: `g did not return to the flat map: ${outDetail}` });
    }

    // ---- Placement: a question with no place on the map -----------------
    //
    // ADR-0018's liveness gate. Placement's subject is a commit, so it is
    // unreachable from the map — no node carries it, no ring shows it, and the
    // grid scan above can never find it. The *only* way in is the guide, and
    // the guide is exactly the code path a placeless subject broke: it looked
    // up the subject's node, found nothing, and returned, leaving a live-looking
    // button that did nothing.
    //
    // Reaching one honestly costs 80 answered questions, because §5's tiers are
    // the progression and this verb is tier 6 — so the deck is seeded through
    // the *supported* restore path instead, in its own context so the run above
    // is untouched. That makes this a test of two things at once: a save
    // carrying `c:` subjects, and the console rendering a verb the shell has
    // never been able to name.
    const placementDeck = atlas.challenges.filter((entry) => entry.verb === 'placement');
    if (placementDeck.length === 0) {
      failures.push({ what: 'placement', detail: 'the atlas shipped no Placement questions at all' });
    } else {
      const seeded = JSON.stringify({
        version: 1,
        surveyed: [],
        passes: atlas.challenges
          .filter((entry) => entry.verb !== 'placement')
          .map((entry) => ({ verb: entry.verb, subject: entry.subject, proved: entry.truth })),
      });
      const key = storageKeyFor(atlas.repo);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const seededPage = await context.newPage();
      const seededErrors: string[] = [];
      seededPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') seededErrors.push(message.text());
      });
      try {
        await seededPage.addInitScript(
          ([storageKey, value]) => window.localStorage.setItem(String(storageKey), String(value)),
          [key, seeded],
        );
        await seededPage.goto(url, { waitUntil: 'networkidle' });
        await seededPage.waitForSelector('canvas.map', { timeout: 15_000 });

        const leftBefore = Number.parseInt(
          /(\d+) left/.exec((await seededPage.locator('.guide-caption').innerText()).trim())?.[1] ??
            '0',
          10,
        );
        if (leftBefore !== placementDeck.length) {
          // The counter used to be the map's *ring* set, which a commit subject
          // never joins — so it read 0 here while a third of the deck waited.
          failures.push({
            what: 'placement',
            detail: `guide says ${leftBefore} left with ${placementDeck.length} Placement questions unanswered`,
          });
        }
        // The HUD's own sentence, which is a claim about the **map**. It counted
        // off the deck and read "36 questions ringed on the map" over a map with
        // no rings at all, because a commit subject never joins the ring set.
        const ringed = (await seededPage.locator('.hud-quests').innerText()).trim();
        if (ringed.includes(`${placementDeck.length} questions ringed on the map`)) {
          failures.push({
            what: 'placement',
            detail: `the HUD counts placeless questions as ringed: "${ringed}"`,
          });
        }
        const action = (await seededPage.locator('.guide-action').innerText()).trim();
        if (!action.toLowerCase().includes('open')) {
          failures.push({
            what: 'placement',
            detail: `the control offers to travel to a subject with no position: "${action}"`,
          });
        }
        await seededPage.screenshot({ path: join(SHOT_DIR, 'placement-guide.png') });

        await seededPage.locator('.guide-action').click();
        await seededPage.waitForSelector('.console-panel', { timeout: 5000 });
        // Lowercased: the header is `text-transform: uppercase`, so `innerText`
        // returns rendered text and not the string the verb supplied.
        const verb = (await seededPage.locator('.console-verb').innerText()).trim().toLowerCase();
        if (verb !== 'placement') {
          failures.push({ what: 'placement', detail: `the guide opened a ${verb} board` });
        }
        const asked = (await seededPage.locator('.console-question').innerText()).trim();
        process.stdout.write(`e2e: placement → ${asked}\n`);
        // The question quotes a commit message the atlas holds. Derived, never
        // authored (guardrail 2) — and this is what proves it.
        // Matched on the **quoted** message and required to be unique: a bare
        // substring test picks the wrong board whenever one retained commit's
        // message is a prefix of another's ("Fix" inside "Fix tests"), which is
        // the `.first()` landmine wearing a different hat.
        const matches = placementDeck.filter(
          (entry) =>
            entry.evidence.kind === 'commit' && asked.includes(`"${entry.evidence.subject}"`),
        );
        if (matches.length > 1) {
          failures.push({
            what: 'placement',
            detail: `${matches.length} retained commits match the prompt — cannot say which board was played`,
          });
        }
        const played = matches.length === 1 ? matches[0] : undefined;
        if (played === undefined) {
          failures.push({
            what: 'placement',
            detail: `the prompt quotes no commit this atlas retained: "${asked}"`,
          });
        } else {
          const wanted = new Set(played.truth.map((id) => pathById.get(id) ?? ''));
          const options = await seededPage.locator('.choice-button').count();
          let clicked = 0;
          for (let i = 0; i < options; i++) {
            const button = seededPage.locator('.choice-button').nth(i);
            if (!wanted.has(rendered(await button.innerText()))) continue;
            await button.click();
            clicked++;
          }
          if (clicked !== played.truth.length) {
            failures.push({
              what: 'placement',
              detail: `${clicked} of ${played.truth.length} answer files were on the board`,
            });
          }
          await seededPage.screenshot({ path: join(SHOT_DIR, 'placement.png') });
          await submitBoard(seededPage, 'placement board');
          await seededPage.waitForSelector('.console-score', { timeout: 5000 });
          const score = (await seededPage.locator('.console-score').innerText())
            .replace(/\s+/g, ' ')
            .trim();
          if (!score.includes('100%')) {
            failures.push({ what: 'placement', detail: `the atlas's own answer key scored "${score}"` });
          }
          // `.console-instruction` is where `Reveal.summary` renders after a
          // grade — the sentence the *verb* writes about its own answer.
          const summary = (await seededPage.locator('.console-instruction').allInnerTexts()).join(' ');
          const sha = played.subject.slice(2);
          if (!summary.includes(sha)) {
            failures.push({
              what: 'placement',
              detail: `the reveal never names the commit it graded: "${summary.trim()}"`,
            });
          }
          await seededPage.screenshot({ path: join(SHOT_DIR, 'placement-graded.png') });
          await submitBoard(seededPage, 'placement: back to the map');
          await seededPage.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });

          // The note. `notes.ts` looked a subject up through `refById`, which
          // returns nothing for a commit id and `continue`d — so this note
          // would have been absent with nothing anywhere to say it had gone.
          await seededPage.locator('.hud-notes').click();
          await seededPage.waitForSelector('.notes-panel', { timeout: 5000 });
          const claims = await seededPage.locator('.field-note-claim').allInnerTexts();
          const mine = claims.find((claim) => claimAbout(claim).includes(sha));
          if (mine === undefined) {
            failures.push({
              what: 'placement',
              detail: `no field note names ${sha}, which was just proved`,
            });
          } else if (mine.includes('hops') || mine.includes('depend')) {
            // The sentence Blast Radius's template would have produced about a
            // sha, which is why the note contract moved onto the verb.
            failures.push({ what: 'placement', detail: `a Placement note talks in import hops: "${mine}"` });
          }
          await seededPage.screenshot({ path: join(SHOT_DIR, 'placement-notes.png') });
        }
      } finally {
        for (const error of seededErrors) failures.push({ what: 'console', detail: error });
        await context.close();
      }
    }

    // ---- Archaeology: the first board whose *rows* are not files ---------
    //
    // Reachable from the map — its subject is a node — but only after the
    // tier-3 question about the same file, which is `challengeOrder` working.
    // Seeded through the restore path for the same reason Placement is: §5's
    // tiers are the progression and this is tier 5, so honest play costs 80
    // answered boards first.
    //
    // What this checks that no unit test can: **the console renders twenty
    // commits**. Every row here is a `c:` id, and until this change the panel
    // resolved a row through `refById` and fell back to printing the raw id — a
    // board of `c:1a2b3c4d5e6f`. The screenshot is the point.
    const archaeologyDeck = atlas.challenges.filter((entry) => entry.verb === 'archaeology');
    if (archaeologyDeck.length === 0) {
      failures.push({ what: 'archaeology', detail: 'the atlas shipped no Archaeology questions' });
    } else {
      const target = archaeologyDeck[0];
      if (target === undefined) throw new Error('unreachable: deck is non-empty');
      // Seed everything *except* this one board, so the guide has exactly one
      // question left and there is no ambiguity about which was played. Chosen
      // by subject rather than by taking whatever came first on screen — the
      // `.first()` landmine, which cost four milestones of a false green.
      const seeded = JSON.stringify({
        version: 1,
        surveyed: [],
        passes: atlas.challenges
          .filter((entry) => !(entry.verb === target.verb && entry.subject === target.subject))
          .map((entry) => ({ verb: entry.verb, subject: entry.subject, proved: entry.truth })),
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const seededPage = await context.newPage();
      const seededErrors: string[] = [];
      seededPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') seededErrors.push(message.text());
      });
      try {
        await seededPage.addInitScript(
          ([storageKey, value]) => window.localStorage.setItem(String(storageKey), String(value)),
          [storageKeyFor(atlas.repo), seeded],
        );
        await seededPage.goto(url, { waitUntil: 'networkidle' });
        await seededPage.waitForSelector('canvas.map', { timeout: 15_000 });
        // Two clicks, and the difference from Placement is the design working.
        // A node subject **has** a place, so ADR-0011's "the map stays the
        // frame" applies: the guide flies there and selects it, leaving the
        // inspector's own control one keystroke away. Placement's subject has
        // nowhere to fly, which is why that button opens the board directly.
        await seededPage.locator('.guide-action').click();
        await seededPage.waitForSelector('.inspector-action', { timeout: 5000 });
        const label = (await seededPage.locator('.inspector-action').innerText()).trim();
        if (!/history/i.test(label)) {
          // The inspector hard-coded Blast Radius's phrasing until M4 and then
          // opened Companion boards with it. The verb owns its own wording.
          failures.push({
            what: 'archaeology',
            detail: `the inspector offers "${label}" for a history question`,
          });
        }
        await seededPage.locator('.inspector-action').click();
        await seededPage.waitForSelector('.console-panel', { timeout: 5000 });

        const verb = (await seededPage.locator('.console-verb').innerText()).trim().toLowerCase();
        if (verb !== 'archaeology') {
          failures.push({ what: 'archaeology', detail: `the guide opened a ${verb} board` });
        }
        const asked = (await seededPage.locator('.console-question').innerText()).trim();
        process.stdout.write(`e2e: archaeology → ${asked}\n`);
        // **The negative arm of the click-hint rule, here because this is the
        // only step that reaches this verb.** Archaeology's candidates are
        // commits and a commit has nowhere to stand (ADR-0018), so there is no
        // marker to click and the panel must not say there is. The sweep four
        // hundred lines up covers the positive arm and never reaches this verb,
        // which would have left half that gate asserting nothing — the
        // uncovered-arm landmine, in a gate written to catch a false sentence.
        if ((await seededPage.locator('.console-how').count()) > 0) {
          failures.push({
            what: 'inputs',
            detail: 'an archaeology board told the player to click a marker; its candidates are commits',
          });
        }
        const subjectPath = pathById.get(target.subject) ?? '';
        if (!asked.includes(subjectPath)) {
          failures.push({
            what: 'archaeology',
            detail: `the prompt does not name the file it is about: "${asked}"`,
          });
        }

        // **Every row is a commit, rendered as one.** A row still showing a raw
        // `c:` id means the console fell back to printing the identifier.
        const rows = await seededPage.locator('.choice-path').allInnerTexts();
        const raw = rows.filter((row) => /^c:[0-9a-f]{12}$/.test(row.trim()));
        if (raw.length > 0) {
          failures.push({
            what: 'archaeology',
            detail: `${raw.length} of ${rows.length} rows render as a bare commit id`,
          });
        }
        const dated = rows.filter((row) => /^\d{4}-\d{2}-\d{2}\s/.test(row.trim()));
        if (dated.length !== rows.length) {
          failures.push({
            what: 'archaeology',
            detail: `${rows.length - dated.length} of ${rows.length} rows do not read as a commit`,
          });
        }
        await seededPage.screenshot({ path: join(SHOT_DIR, 'archaeology.png') });

        // **Matched on the sha the row prints, not on a reconstructed label.**
        // `innerText` returns *rendered* text, so the label's double spaces
        // arrive collapsed to one — comparing against the string the code built
        // fails for a reason that has nothing to do with the board. The sha is
        // what the row claims and it is unique, which is also the property the
        // `.first()` landmine asks for.
        const wanted = new Set(target.truth.map((id) => id.slice(2)));
        let clicked = 0;
        for (let i = 0; i < rows.length; i++) {
          const sha = /\b([0-9a-f]{12})\b/.exec(rows[i] ?? '')?.[1];
          if (sha === undefined || !wanted.has(sha)) continue;
          await seededPage.locator('.choice-button').nth(i).click();
          clicked++;
        }
        if (clicked !== target.truth.length) {
          failures.push({
            what: 'archaeology',
            detail: `${clicked} of ${target.truth.length} answer commits were on the board`,
          });
        }
        await submitBoard(seededPage, 'archaeology board');
        await seededPage.waitForSelector('.console-score', { timeout: 5000 });
        const score = (await seededPage.locator('.console-score').innerText())
          .replace(/\s+/g, ' ')
          .trim();
        if (!score.includes('100%')) {
          failures.push({ what: 'archaeology', detail: `the atlas's own answer key scored "${score}"` });
        }

        // **The disclosure rule that no unit test can see from inside a verb.**
        // The reveal may state a relation and never an identity: naming another
        // file this commit touched would hand over that commit's Placement key
        // (ADR-0019 decision 9). Checked against every *other* path in the repo.
        const revealed = [
          ...(await seededPage.locator('.console-instruction').allInnerTexts()),
          ...(await seededPage.locator('.note-why').allInnerTexts()),
        ].join(' ');
        const leaked = [...pathById.values()].filter(
          (path) => path !== subjectPath && revealed.includes(path),
        );
        if (leaked.length > 0) {
          failures.push({
            what: 'archaeology',
            detail: `the reveal names ${leaked.length} file(s) it must not: ${leaked.slice(0, 3).join(', ')}`,
          });
        }
        await seededPage.screenshot({ path: join(SHOT_DIR, 'archaeology-graded.png') });

        await submitBoard(seededPage, 'archaeology: back to the map');
        await seededPage.waitForSelector('.console-scrim', { state: 'hidden', timeout: 5000 });
        await seededPage.locator('.hud-notes').click();
        await seededPage.waitForSelector('.notes-panel', { timeout: 5000 });
        // The note names the *file*, and its members are commits — the field
        // notes resolved a member through `refById` until this change, so this
        // note would have been absent with nothing to say it had gone.
        const claims = await seededPage.locator('.field-note-claim').allInnerTexts();
        // `claim.includes('commit')` was meant to pick Archaeology's note out of
        // the several a subject can have. It matches any note whose **subject
        // path** contains the word — `src/verbs/commits.ts` — so the noun is
        // read as a noun.
        const mine = claims.find(
          (claim) =>
            claimAbout(claim).includes(subjectPath) && /^You proved \d+ commits? that/.test(claim),
        );
        if (mine === undefined) {
          failures.push({
            what: 'archaeology',
            detail: `no field note claims commits for ${subjectPath}, which was just proved`,
          });
        } else if (mine.includes('hops') || mine.includes('depend')) {
          failures.push({ what: 'archaeology', detail: `an Archaeology note talks in import hops: "${mine}"` });
        }
        await seededPage.screenshot({ path: join(SHOT_DIR, 'archaeology-notes.png') });
      } finally {
        for (const error of seededErrors) failures.push({ what: 'console', detail: error });
        await context.close();
      }
    }

    // ---- select-all buys no *proof* (ADR-0047) ---------------------------
    //
    // A playtester farmed a pass in two clicks: tick everything, read the
    // annotated key off the reveal, reopen, tick what it named — `S · 100%`, a
    // pass, and a field note. This plays the **whole** exploit, both steps, and
    // asserts where it now ends.
    //
    // **It used to assert that the reveal named nothing**, which was ADR-0035's
    // gate. That gate is gone: it could not hold — a single-pick answer scores
    // above zero exactly when the pick is in the key, so the score is a
    // membership oracle and guardrail 6 makes retries free — and its own
    // showcase case *was* the exploit. So the reveal now names every member, on
    // purpose, and what must not move is the **ledger**: the second answer
    // passes, retires the board and draws the cone, and proves nothing. That is
    // a browser check rather than a unit one because the unit version
    // (`progress.test.ts`) cannot see the notebook or the HUD, which are what a
    // player reads the claim off.
    {
      const exploitContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const exploitPage = await exploitContext.newPage();
      const exploitErrors: string[] = [];
      exploitPage.on('pageerror', (error: Error) => exploitErrors.push(String(error)));
      exploitPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') exploitErrors.push(message.text());
      });
      try {
        // A fresh save, so the guide's suggestion is an unanswered board.
        await exploitPage.goto(url, { waitUntil: 'networkidle' });
        await exploitPage.waitForSelector('.guide-action');
        // **The guide takes you to a landmark; it does not open a question.**
        // ADR-0011 is explicit about that, and it is only false for a placeless
        // subject, where the control opens the board directly. So: click, and
        // press Enter only if nothing opened — pressing it unconditionally would
        // toggle the focused row and quietly un-tick one of the sweep's picks.
        await exploitPage.locator('.guide-action').click();
        await exploitPage.waitForTimeout(400);
        if (!(await exploitPage.locator('.console-panel').isVisible())) {
          await exploitPage.keyboard.press('Enter');
        }
        await exploitPage.waitForSelector('.choice-button', { timeout: 5000 });
        const rows = await exploitPage.locator('.choice-button').allInnerTexts();
        for (const button of await exploitPage.locator('.choice-button').all()) await button.click();
        await submitBoard(exploitPage, 'select-all exploit');
        await exploitPage.waitForSelector('.console-score', { timeout: 5000 });
        const shown = (await exploitPage.locator('.console-panel').innerText()).trim();
        // Every row's own rendered label, compared against rendered text — the
        // `innerText` landmine, and the reason the labels come from the board
        // rather than from the atlas. The reveal is *expected* to name members
        // now; this is the control that proves the exploit's first step
        // succeeded, so the assertions below are about a real farm.
        const named = rows.map((row) => row.trim()).filter((row) => row !== '' && shown.includes(row));
        if (named.length === 0) {
          failures.push({
            what: 'select-all',
            detail: `the reveal named none of ${rows.length} candidates — nothing to farm`,
          });
        }
        if (rows.length < 4) {
          failures.push({ what: 'select-all', detail: `only ${rows.length} rows to sweep` });
        }
        // How much the map claims the player understands, before the farm's
        // second step. Read off the HUD, which is the number a player would
        // point at.
        const understoodBefore = await exploitPage.locator('.hud-counts').innerText();
        // The board's own subject, read off the panel rather than predicted —
        // this file has four landmines about guessing which board the shell
        // serves. Used below to find *this* board's note among the others.
        const subjectPath = (await exploitPage.locator('.console-question').innerText()).trim();

        // **Step two: reopen and type back what the panel just said.** This is
        // the click that used to mint a field note claiming proof.
        //
        // Reopened with Enter on the **selected** node rather than through the
        // guide, and that is not a shortcut: `main.ts` selects the subject when
        // it grades, so Enter reopens *this* board, while the guide would move
        // on — a failed attempt bumps `selector.attempts`, which demotes the
        // board it was spent on. The first version of this step used the guide,
        // got a different board, and failed with `nothing selected` because none
        // of the remembered labels was on it. Never predict what the shell will
        // serve; here, ask for the one thing we already have.
        const key = new Set(
          (await exploitPage.locator('.note-missed .note-path, .note-correct .note-path')
            .allInnerTexts()).map((text) => text.trim()),
        );
        if (key.size === 0) {
          failures.push({ what: 'select-all', detail: 'the reveal listed no answer rows to copy' });
        }
        await exploitPage.locator('.console-submit').click();
        await exploitPage.waitForTimeout(400);
        await exploitPage.keyboard.press('Enter');
        await exploitPage.waitForSelector('.choice-button', { timeout: 5000 });
        // Tick exactly the rows the reveal named as answers — `.note-missed`
        // and `.note-correct` are the truth set, `.note-spurious` is not.
        for (const button of await exploitPage.locator('.choice-button').all()) {
          if (key.has((await button.innerText()).trim())) await button.click();
        }
        await submitBoard(exploitPage, 'select-all farm');
        await exploitPage.waitForSelector('.console-score', { timeout: 5000 });
        const farmed = (await exploitPage.locator('.console-panel').innerText()).trim();
        // It passes — guardrail 6 forbids anything else — and it says so.
        if (!farmed.includes('Recorded as shown rather than proved')) {
          failures.push({
            what: 'select-all',
            detail: 'a farmed pass did not say it was recorded as shown',
          });
        }
        await exploitPage.locator('.console-submit').click();
        await exploitPage.waitForTimeout(300);
        // **The notebook, which this step's own preamble names as its reason for
        // being a browser test and the first version never opened.** A mutant
        // forcing `notes.ts`'s register to `'proved'` — the notebook claiming
        // *"You proved…"* over a farmed pass, which is the §9 violation ADR-0047
        // exists to close — survived 920 unit tests, 116 atlas tests and this
        // file, because nothing here looked at the page it is about.
        await exploitPage.locator('.hud-notes').click();
        await exploitPage.waitForSelector('.notes-panel', { timeout: 5000 });
        const claims = await exploitPage.locator('.field-note-claim').allInnerTexts();
        // **Through `claimAbout`, not `includes`.** A claim reads
        // *"You were shown N … that depend on SUBJECT — member, member, …"*, so
        // a note about somebody *else* that merely lists this subject as a
        // member matches a substring test — and `find` takes the first, which
        // is the largest-population note. This file has paid for that exact
        // shape four times and built `claimAbout` because "a rule that lived
        // three times had already diverged twice"; the first version of this
        // step reintroduced it three call sites away from the helper.
        const farmedNote = claims.find((claim) => claimAbout(claim).includes(subjectPath));
        if (farmedNote === undefined) {
          failures.push({ what: 'select-all', detail: `no note for the farmed board ${subjectPath}` });
        } else if (!farmedNote.includes('You were shown')) {
          failures.push({
            what: 'select-all',
            detail: `the farmed board's note claims proof: "${farmedNote}"`,
          });
        }
        await exploitPage.keyboard.press('Escape');
        await exploitPage.waitForTimeout(200);
        // **Only the `understood` number, and comparing the whole line was
        // wrong.** Ticking twenty rows *shows* you twenty things, and a shown
        // member promotes to `surveyed` by design — ADR-0047 in as many words,
        // *"which is exactly what it is: you were shown it"*. So `surveyed`
        // legitimately moves, by as much as twenty, and by **nothing at all**
        // when the board's members are commits, which have no square on the
        // map. That is verb-dependent, this step does not choose its board, and
        // the string comparison passed here and failed on CI for exactly that
        // reason. What the farm must not move is knowledge.
        const countOf = (line: string): string =>
          /(\d+) understood/.exec(line)?.[1] ?? 'missing';
        const understoodAfter = await exploitPage.locator('.hud-counts').innerText();
        process.stdout.write(
          `e2e: farm counts → ${rendered(understoodBefore)} → ${rendered(understoodAfter)}\n`,
        );
        if (countOf(understoodAfter) !== countOf(understoodBefore)) {
          failures.push({
            what: 'select-all',
            detail: `the farm moved the understood count: ${understoodBefore} → ${understoodAfter}`,
          });
        }
        process.stdout.write(
          `e2e: select-all over ${rows.length} rows → ${named.length} named, ` +
            `farmed pass recorded as shown, counts held at ${understoodAfter}\n`,
        );
        await exploitPage.screenshot({ path: join(SHOT_DIR, 'select-all.png') });
      } finally {
        for (const error of exploitErrors) failures.push({ what: 'console', detail: error });
        await exploitContext.close();
      }
    }

    // ---- the guide moves you in the world, not just on the flat map ------
    //
    // A cold playtester proved the avatar never moved: clicking "Where next?"
    // in world mode took the caption from *"next is labels.ts"* to *"you are on
    // labels.ts"* with the canvas **byte-identical**, twice, on two nodes. The
    // handler was moving the flat map's camera, which is not what is on screen
    // there, and then the caption asserted an arrival that had not happened.
    //
    // Gated the same way they found it — on the pixels — because a caption
    // saying "you are on X" is exactly the thing that lied.
    {
      const worldContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const worldPage = await worldContext.newPage();
      const worldErrors: string[] = [];
      worldPage.on('pageerror', (error: Error) => worldErrors.push(String(error)));
      worldPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') worldErrors.push(message.text());
      });
      try {
        await worldPage.goto(url, { waitUntil: 'networkidle' });
        await worldPage.waitForSelector('.hud-detail');
        await worldPage.keyboard.press('g');
        await worldPage.waitForTimeout(400);
        const inWorld = (await worldPage.locator('.hud-detail').innerText()).trim();
        if (!inWorld.includes('world')) {
          failures.push({ what: 'world guide', detail: `g did not enter the world: "${inWorld}"` });
        }
        // **The hero's position, not a canvas hash.** The first version of this
        // gate compared the canvas and a `travelTo` that moved nothing at all
        // still passed it: the guide selects, describes and repaints a waypoint
        // regardless, so "some pixel changed" is true either way. That is this
        // repo's instrument-that-measures-nothing landmine, and it read as good
        // news exactly as the landmine says.
        const where = async (): Promise<string> =>
          JSON.stringify(await worldPage.evaluate('window.__arkHero ?? null'));
        const before = await where();
        const captionBefore = (await worldPage.locator('.guide-caption').innerText()).trim();
        await worldPage.locator('.guide-action').click();
        await worldPage.waitForTimeout(500);
        const after = await where();
        const captionAfter = (await worldPage.locator('.guide-caption').innerText()).trim();
        if (before === 'null' || after === 'null') {
          failures.push({ what: 'world guide', detail: 'no hero position was published' });
        } else if (after === before) {
          failures.push({
            what: 'world guide',
            detail: `the hero did not move: ${before} → ${after}, caption "${captionBefore}" → "${captionAfter}"`,
          });
        }
        process.stdout.write(
          `e2e: world guide → "${captionAfter}", hero ${before} → ${after}\n`,
        );
        await worldPage.screenshot({ path: join(SHOT_DIR, 'world-guide.png') });
      } finally {
        for (const error of worldErrors) failures.push({ what: 'console', detail: error });
        await worldContext.close();
      }
    }

    // ---- the experiment arms (docs/experiments/0001 §4.2) ----------------
    //
    // `?arm=` is the only thing making experiment 0001's between-subjects
    // design enforceable, and every part of it is *shell wiring* — the pure
    // half is unit-tested and the guards in `main.ts` are not reachable from a
    // unit test at all. A lock that silently does not engage looks exactly like
    // a lock: the participant plays, the facilitator sees a map, and nothing
    // anywhere records that they pressed `g` in the middle of it. So this is a
    // liveness gate on the branch, not a check that no error was thrown.
    //
    // The arm is identified by what the HUD's mode line **cannot** say, never
    // by predicting what it will: the flat map's line names its *zoom level*,
    // which is `district` at the fitted scale and `territory` further out, and
    // the first draft of this step asserted `territory` and went red against a
    // working lock. That is this file's own landmine — never predict what the
    // shell will serve — arriving in the step that was added to it.
    for (const [arm, required, forbidden] of [
      ['map', 'nodes', ['world', 'orbit']],
      ['world', 'world', ['orbit']],
    ] as const) {
      const armContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const armPage = await armContext.newPage();
      const armErrors: string[] = [];
      armPage.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error') armErrors.push(message.text());
      });
      armPage.on('pageerror', (error: Error) => armErrors.push(String(error)));
      try {
        await armPage.goto(`${url}?arm=${arm}`, { waitUntil: 'networkidle' });
        await armPage.waitForSelector('.hud-detail');
        await armPage.waitForTimeout(300);
        // **The arm starts in its own view**, without a keystroke. Arriving in
        // the flat map and being walked across would show every participant the
        // control condition first.
        const onArrival = (await armPage.locator('.hud-detail').innerText()).trim();
        if (!onArrival.includes(required) || forbidden.some((other) => onArrival.includes(other))) {
          failures.push({ what: `arm=${arm}`, detail: `arrived in "${onArrival}"` });
        }
        // …and the keys that would leave it do nothing. `o`, `g` and Escape are
        // three separate guards in `main.ts`; pressing all three is what makes
        // this a test of the lock rather than of one branch of it.
        for (const key of ['o', 'g', 'Escape']) {
          await armPage.keyboard.press(key);
          await armPage.waitForTimeout(160);
        }
        const afterKeys = (await armPage.locator('.hud-detail').innerText()).trim();
        if (!afterKeys.includes(required) || forbidden.some((other) => afterKeys.includes(other))) {
          failures.push({ what: `arm=${arm}`, detail: `o/g/escape left the arm: "${afterKeys}"` });
        }
        // **The guide must be alive in every arm.** Under `?arm=world` this
        // panel rendered as an enabled, clickable, permanently *empty* pill —
        // `guide.update` was called only in the map/orbit frame branch — which
        // is the recall experiment's own arm shipping with a dead next-step
        // affordance in every participant's field of view. Asserting it is
        // non-empty is the liveness gate; the caption is the half that carries
        // a count, so it is the half checked.
        const caption = (await armPage.locator('.guide-caption').innerText()).trim();
        if (caption.length === 0) {
          failures.push({ what: `arm=${arm}`, detail: 'the guide panel is empty' });
        }
        // **M2's instrumentation has to actually fire, in a browser, in an arm.**
        // Every assertion about it elsewhere is a unit test over a pure module,
        // and this repo's landmine is that shell wiring is exactly what a unit
        // suite cannot see — a mutant deleting the seed of the guide's attempt
        // counts once reddened no unit test at all. So: play a board, and check
        // the reading moved and survived a reload. `arkTally` exists only in an
        // arm, which is the other half of the claim.
        if (arm === 'map') {
          const beforeTally = await armPage.evaluate(
            '(globalThis.arkTally ? globalThis.arkTally() : null)',
          );
          if (beforeTally === null) {
            failures.push({ what: `arm=${arm}`, detail: 'arkTally() is absent inside an arm' });
          }
          // The guide takes you to a landmark; it does not open a question —
          // except for a placeless subject, where the control opens the board.
          // Same dance as the select-all step, and for the same reason.
          await armPage.locator('.guide-action').click();
          await armPage.waitForTimeout(400);
          if (!(await armPage.locator('.console-panel').isVisible())) {
            await armPage.keyboard.press('Enter');
          }
          await armPage.waitForSelector('.choice-button', { timeout: 5000 });
          await armPage.locator('.choice-button').first().click();
          await submitBoard(armPage, 'tally inside an arm');
          await armPage.waitForSelector('.console-score', { timeout: 5000 });
          const afterTally = (await armPage.evaluate(
            '(globalThis.arkTally ? globalThis.arkTally() : null)',
          )) as { graded: number } | null;
          if (afterTally === null || afterTally.graded !== 1) {
            failures.push({
              what: `arm=${arm}`,
              detail: `one graded board should read 1, read ${JSON.stringify(afterTally)}`,
            });
          }
          // Persisted, not merely in memory: the whole point of a record over a
          // variable is that a reload mid-session does not lose the reading.
          await armPage.reload({ waitUntil: 'networkidle' });
          await armPage.waitForSelector('.hud-detail');
          await armPage.waitForTimeout(300);
          const reloaded = (await armPage.evaluate(
            '(globalThis.arkTally ? globalThis.arkTally() : null)',
          )) as { graded: number } | null;
          if (reloaded === null || reloaded.graded !== 1) {
            failures.push({
              what: `arm=${arm}`,
              detail: `the tally did not survive a reload: ${JSON.stringify(reloaded)}`,
            });
          }
        }
        // A HUD advertising a key the arm has disabled is the broken-control
        // failure `main.ts` already has a comment about.
        const hint = (await armPage.locator('.hud-keys').innerText()).trim();
        if (hint.includes('orbit') || (arm === 'map' && hint.includes('walk'))) {
          failures.push({ what: `arm=${arm}`, detail: `the HUD offers a disabled key: "${hint}"` });
        }
        process.stdout.write(`e2e: arm=${arm} → ${afterKeys} · keys "${hint}" · guide "${caption}"\n`);
        await armPage.screenshot({ path: join(SHOT_DIR, `arm-${arm}.png`) });
      } finally {
        for (const error of armErrors) failures.push({ what: 'console', detail: error });
        await armContext.close();
      }
    }

    // **The control**: no query string is the ordinary player, and every key
    // still works. Without this, deleting the whole feature and hard-coding a
    // lock would pass the two arms above.
    {
      const openContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const openPage = await openContext.newPage();
      try {
        await openPage.goto(url, { waitUntil: 'networkidle' });
        await openPage.waitForSelector('.hud-detail');
        await openPage.keyboard.press('g');
        await openPage.waitForTimeout(300);
        const walked = (await openPage.locator('.hud-detail').innerText()).trim();
        if (!walked.includes('world')) {
          failures.push({ what: 'unlocked', detail: `g did not enter the world: "${walked}"` });
        }
        await openPage.keyboard.press('g');
        await openPage.waitForTimeout(300);
        const back = (await openPage.locator('.hud-detail').innerText()).trim();
        if (back.includes('world')) {
          failures.push({ what: 'unlocked', detail: `g did not leave the world: "${back}"` });
        }
      } finally {
        await openContext.close();
      }
    }

    if (!sawMapTick) {
      failures.push({
        what: 'board',
        detail: 'no board in this run let a map click tick a candidate — the marking layer is unexercised',
      });
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
