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
    // **Both hints, one assertion.** The player advertises its controls in two
    // places — the DOM HUD and the world's own canvas line — and the first
    // version of this change made only the first one arm-aware, so a locked
    // `?arm=world` session painted *"g map"* under a `g` that does nothing. A
    // screenshot caught it and no assertion would have, which is why the rule
    // is quantified over the surfaces rather than written out per surface.
    for (const arm of ['map', 'orbit', 'world'] as const) {
      for (const hint of [keyHintFor(arm), worldHintFor(arm)]) {
        for (const key of LOCKED_KEYS) expect(hint).not.toContain(key);
      }
    }
    // Unlocked, every one of them is offered — the control that stops this
    // passing against a player with no controls at all.
    const open = `${keyHintFor(null)} ${worldHintFor(null)}`;
    for (const key of LOCKED_KEYS) expect(open).toContain(key);
    // And every arm can still open the board it is standing on, or the
    // experiment measures nothing.
    for (const arm of ['map', 'orbit', 'world', null] as const) {
      expect(keyHintFor(arm)).toContain('enter ask');
      expect(worldHintFor(arm)).toContain('enter open');
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
