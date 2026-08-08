/**
 * The one thing only `drawFrame` can be asked: does a label survive to the
 * canvas, and does the chrome standing over the canvas take its slot away?
 *
 * `labels.test.ts` pins `placeLabels`, which is pure and easy. What it cannot
 * see is the *wiring* — three call sites hand the placer their blockers, and one
 * of them forgetting is invisible, because the labels still draw, just
 * underneath a panel. A mutation removing the chrome from the node pass survived
 * the whole suite until this file existed.
 *
 * The context is a stub rather than a real canvas: everything asserted here is a
 * count the renderer returns, and `measureText` is the only measurement the
 * placement depends on.
 */

import { describe, expect, it } from 'vitest';

import { drawFrame } from '../../src/player/draw.js';
import type { FrameInput } from '../../src/player/draw.js';
import { NORTH } from '../../src/player/camera.js';
import { NO_TIES } from '../../src/player/ties.js';
import { prepare } from '../../src/player/scene.js';
import { atlasWith } from '../fixtures/atlas.js';

/** Just enough 2D context for the renderer, and one honest `measureText`. */
function stubContext(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const target = {
    measureText: (text: string) => ({ width: text.length * 7 }),
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    fillText: noop,
    strokeText: noop,
    setLineDash: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  // Anything else the renderer touches is a style property; swallow reads and
  // writes rather than enumerating them, which would go stale on every change.
  return new Proxy(target, {
    get: (object, key) => Reflect.get(object, key) ?? undefined,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

const VIEWPORT = { width: 1200, height: 800 };

function frameInput(chrome: FrameInput['chrome']): FrameInput {
  const atlas = atlasWith(
    ['src/hub.ts', 'src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'],
    [
      ['src/one.ts', 'src/hub.ts'],
      ['src/two.ts', 'src/hub.ts'],
    ],
  );
  const scene = prepare(atlas);
  const surveyed = new Set(atlas.nodes.map((node) => node.id));
  return {
    scene,
    camera: { x: 0, y: 0, scale: 1, bearing: NORTH },
    viewport: VIEWPORT,
    fog: { surveyed, understood: surveyed },
    hovered: null,
    selected: null,
    radius: null,
    chrome,
    questions: new Set(),
    peaks: new Set(scene.nodes.map((node) => node.ref)),
    ties: NO_TIES,
    tieFocus: null,
  };
}

describe('drawFrame', () => {
  it('draws labels at all, or the assertion below means nothing', () => {
    const stats = drawFrame(stubContext(), frameInput([]));
    expect(stats.labelsDrawn).toBeGreaterThan(0);
  });

  it('spends no label on a slot the chrome is standing over', () => {
    const open = drawFrame(stubContext(), frameInput([]));
    // A panel over the entire canvas: every label placement must be refused,
    // whatever the layout happens to be. Anything short of the whole viewport
    // would be asserting where the fixture's nodes landed.
    const covered = drawFrame(
      stubContext(),
      frameInput([{ left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }]),
    );
    expect(open.labelsDrawn).toBeGreaterThan(0);
    expect(covered.labelsDrawn).toBe(0);
  });
});
