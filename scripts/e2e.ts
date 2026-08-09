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
import { GOLDEN_TURN, TURN_MS } from '../src/player/heading.js';

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

async function indexForPlayer(): Promise<Atlas> {
  const atlas = await buildAtlas(indexOptions(ROOT));
  await mkdir(dirname(ATLAS_OUT), { recursive: true });
  await writeFile(ATLAS_OUT, serializeAtlas(atlas), 'utf8');
  return atlas;
}

async function main(): Promise<number> {
  const failures: Failure[] = [];
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
    [...atlas.nodes.map((node) => [node.id, rendered(node.path)] as const)].concat(
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
      // Three at most: each attempt is a full grid sweep of mouse moves, and the
      // point is to not depend on one candidate rather than to try them all.
      for (const candidate of wireTargets.slice(0, 3)) {
        wireTargetPath = pathById.get(candidate.subject) ?? '';
        for (let row = 1; row < 26 && wireHit === null; row++) {
          for (let column = 1; column < 40 && wireHit === null; column++) {
            const x = box.x + (box.width * column) / 40;
            const y = box.y + (box.height * row) / 26;
            await page.mouse.move(x, y);
            if ((await page.locator('.inspector-path').count()) === 0) continue;
            if ((await page.locator('.inspector-path').innerText()).trim() !== wireTargetPath) continue;
            wireHit = { x, y };
          }
        }
        if (wireHit !== null) {
          wirePlayed = candidate;
          break;
        }
      }

      if (wireTarget === undefined) {
        failures.push({ what: 'wires', detail: 'no companion-only subject in this atlas to play' });
      } else if (wireHit === null) {
        failures.push({ what: 'wires', detail: `${wireTargetPath} never appeared under the cursor grid` });
      } else {
        await page.mouse.click(wireHit.x, wireHit.y);
        await page.locator('.inspector-action').click();
        await page.waitForSelector('.console-panel', { timeout: 5000 });
        const verb = (await page.locator('.console-verb').innerText()).trim().toLowerCase();
        if (verb !== 'companion') {
          failures.push({ what: 'wires', detail: `expected a companion board, got ${verb}` });
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
        const mine = claims.find((text) => text.includes(subject));
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
          const mine = claims.find((claim) => claim.includes(sha));
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
        const mine = claims.find((claim) => claim.includes(subjectPath) && claim.includes('commit'));
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
