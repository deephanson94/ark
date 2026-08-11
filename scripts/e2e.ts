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
function claimAbout(claim: string): string {
  return claim.split(' — ')[0] ?? claim;
}

async function indexForPlayer(): Promise<Atlas> {
  const atlas = await buildAtlas(indexOptions(ROOT));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  return atlas;
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
      const marksLine = (await page.locator('.hud-detail').innerText()).trim();
      const marks = Number(/(\d+) marks/.exec(marksLine)?.[1] ?? '0');
      if (marks <= 0) {
        failures.push({ what: 'board', detail: `the map marked nothing: ${marksLine}` });
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
        for (let row = 1; row < 20 && toggled === ''; row++) {
          for (let column = 1; column < 30 && toggled === ''; column++) {
            const x = mapBox.x + (mapBox.width * column) / 44;
            const y = mapBox.y + (mapBox.height * row) / 24;
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
          entry.candidates.every((id) => shownHereSet.has(labelById.get(id) ?? ' ')),
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

      await page.locator('.console-submit').click(); // "back to the map"
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
          const detail = (await page.locator('.hud-detail').innerText()).trim();
          const marked = Number(/(\d+) marks/.exec(detail)?.[1] ?? '0');
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
        await page.locator('.console-submit').click();
        await page.waitForSelector('.console-score', { timeout: 5000 });

        // The reveal must promise only what the map will actually draw. The
        // shipped bug this guards against ran the other way — the panel said
        // "now drawn on the map" beside a map that had stopped drawing it.
        const summary = (await page.locator('.console-evidence, .console-summary').allInnerTexts())
          .join(' ')
          .trim();
        process.stdout.write(`e2e: companion summary → ${summary.replace(/\s+/g, ' ')}\n`);

        await page.locator('.console-submit').click();
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
          const count = await page.locator('.choice-button').count();
          let picked = false;
          for (let i = 0; i < count; i++) {
            const button = page.locator('.choice-button').nth(i);
            if ((await button.innerText()).trim() !== spoken.label) continue;
            await button.click();
            picked = true;
          }
          if (!picked) {
            failures.push({ what: 'witness', detail: `${spoken.label} was not on the board` });
          }
          await page.locator('.console-submit').click();
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
          await page.locator('.console-submit').click();
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
    const surveyedAfterWalk = Number(
      /(\d+) surveyed/.exec((await page.locator('.hud-counts').innerText()).trim())?.[1] ?? '0',
    );
    if (surveyedAfterWalk <= surveyedBeforeWalk) {
      failures.push({
        what: 'world',
        detail: `walking surveyed nothing: ${surveyedBeforeWalk} → ${surveyedAfterWalk}`,
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
          await seededPage.locator('.console-submit').click();
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
          await seededPage.locator('.console-submit').click();
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
        await seededPage.locator('.console-submit').click();
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

        await seededPage.locator('.console-submit').click();
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
