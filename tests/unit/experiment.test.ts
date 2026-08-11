/**
 * The experiment harness (`src/player/experiment.ts`) and the one rendering
 * decision it drives.
 *
 * Two claims are worth a test and one of them needs a canvas stub:
 *
 * 1. **An unrecognised arm is the ordinary player.** The deployed page has no
 *    query string, so the parse being total in that direction is what keeps
 *    this change out of the product.
 * 2. **The world arm's minimap draws no roads, and everything else survives.**
 *    Asserting only the first half would pass against a minimap that drew
 *    nothing at all, which is the other configuration the owner did *not*
 *    choose and a different confound (experiment 0001 §4.3) — so the dots are
 *    counted in both cases and the roads only in one.
 */

import { describe, expect, it } from 'vitest';

import { LOCKED_KEYS, armFromSearch, keyHintFor, worldHintFor } from '../../src/player/experiment.js';
import { prepare } from '../../src/player/scene.js';
import { buildWorld } from '../../src/player/world/build.js';
import { drawMinimap } from '../../src/player/world/minimap.js';
import { EMPTY_PROGRESS, deriveFog, livenessOf } from '../../src/player/progress.js';
import { VERBS } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

/** The three arms and the three views happen to be the same three names. */
const VIEWS = ['map', 'orbit', 'world'] as const;

describe('the arm a session is locked to', () => {
  it('reads the three arms and nothing else', () => {
    expect(armFromSearch('?arm=map')).toBe('map');
    expect(armFromSearch('?arm=orbit')).toBe('orbit');
    expect(armFromSearch('?arm=world')).toBe('world');
  });

  it('is null for no query string, an absent arm, or a value that is not one', () => {
    // The deployed player is the first of these. A typo is the third, and it
    // has to fail *open* — the facilitator can see the keys still work, where
    // a thrown error would spend a participant's twenty minutes on a stack
    // trace.
    expect(armFromSearch('')).toBeNull();
    expect(armFromSearch('?repo=hono')).toBeNull();
    expect(armFromSearch('?arm=')).toBeNull();
    expect(armFromSearch('?arm=flat')).toBeNull();
    expect(armFromSearch('?arm=MAP')).toBeNull();
  });

  it('never advertises a key its arm has disabled, on either surface', () => {
    // **Both hints and every view, one assertion.** The player advertises its
    // controls in two places — the DOM HUD and the world's own canvas line —
    // and the first version of this change made only the first arm-aware, so a
    // locked `?arm=world` session painted *"g map"* under a `g` that does
    // nothing. A screenshot caught it and no assertion would have.
    for (const arm of VIEWS) {
      for (const view of VIEWS) {
        for (const key of LOCKED_KEYS) expect(keyHintFor(arm, view)).not.toContain(key);
      }
      for (const key of LOCKED_KEYS) expect(worldHintFor(arm)).not.toContain(key);
    }
    // Unlocked, every one of them is offered somewhere — the control that stops
    // this passing against a player with no controls at all.
    const open = `${VIEWS.map((view) => keyHintFor(null, view)).join(' ')} ${worldHintFor(null)}`;
    for (const key of LOCKED_KEYS) expect(open).toContain(key);
    // And every arm can still open the board it is standing on, or the
    // experiment measures nothing.
    for (const arm of [...VIEWS, null] as const) {
      expect(keyHintFor(arm, 'map')).toContain('enter ask');
      expect(keyHintFor(arm, 'world')).toContain('enter open');
      expect(worldHintFor(arm)).toContain('enter open');
    }
  });

  it('offers no key that is dead in the view on screen, locked or not', () => {
    // The defect three playtesters hit was in the **unlocked** session: `f` and
    // `n` measured dead in the world while the HUD offered both, and `o orbit`
    // while already in the orbit. So this holds for `arm === null` too, which
    // is the ordinary player and everyone outside the experiment.
    for (const arm of [...VIEWS, null] as const) {
      const world = keyHintFor(arm, 'world');
      expect(world).not.toContain('f fit');
      expect(world).not.toContain('n north');
      expect(world).toContain('wasd move');
      // `o` and `g` say where they *go* from here, never where you already are.
      expect(keyHintFor(null, 'orbit')).not.toContain('o orbit');
      expect(keyHintFor(null, 'world')).not.toContain('g walk');
      expect(keyHintFor(null, 'map')).toContain('o orbit');
    }
  });
});

/** A 2D context that counts the calls the minimap's two layers make. */
function countingContext(): { context: CanvasRenderingContext2D; lines: () => number; arcs: () => number } {
  let lines = 0;
  let arcs = 0;
  const noop = (): void => {};
  const target = {
    measureText: (text: string) => ({ width: text.length * 7 }),
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: () => {
      lines++;
    },
    arc: () => {
      arcs++;
    },
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    fillText: noop,
    setLineDash: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  const context = new Proxy(target, {
    get: (object, key) => Reflect.get(object, key) ?? undefined,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { context, lines: () => lines, arcs: () => arcs };
}

describe("the world arm's minimap", () => {
  const atlas = atlasWith(
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/core/hub.ts'],
    [
      ['src/a.ts', 'src/core/hub.ts'],
      ['src/b.ts', 'src/core/hub.ts'],
      ['src/c.ts', 'src/b.ts'],
    ],
  );
  const scene = prepare(atlas);
  const world = buildWorld(scene);
  const fog = deriveFog(EMPTY_PROGRESS, livenessOf(scene.graph, VERBS));

  function draw(roads: boolean): { lines: number; arcs: number } {
    const { context, lines, arcs } = countingContext();
    drawMinimap(context, {
      world,
      hero: { x: 0, y: 0, facing: 0 },
      viewport: { width: 800, height: 600 },
      fog,
      questions: new Set(),
      waypoint: null,
      fovRadians: 1.05,
      roads,
    });
    return { lines: lines(), arcs: arcs() };
  }

  it('draws one line per import edge when the inset is whole', () => {
    // The count is exact rather than "more than zero", because the diamond and
    // the hero triangle draw lines too — 4 and 3 of them — and a road layer
    // that quietly dropped half its edges would pass a lower bound.
    const whole = draw(true);
    const bare = draw(false);
    expect(whole.lines - bare.lines).toBe(world.roads.length);
    expect(world.roads.length).toBe(scene.edges.length);
  });

  it('keeps every other layer when the roads go', () => {
    // The confound is the *edge* channel (experiment 0001 §4.3). Dropping the
    // whole inset is the option the owner refused, and it would show up here
    // as the dots going with the lines.
    const whole = draw(true);
    const bare = draw(false);
    expect(bare.arcs).toBe(whole.arcs);
    expect(bare.arcs).toBeGreaterThanOrEqual(scene.nodes.length);
    // …and the hero and chronicle glyphs, which are lines, are still drawn.
    expect(bare.lines).toBeGreaterThan(0);
  });
});
