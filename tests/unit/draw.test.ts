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
import { INK, regionKnown, regionSilhouette, regionWash } from '../../src/player/palette.js';
import type { FrameInput } from '../../src/player/draw.js';
import { NORTH } from '../../src/player/camera.js';
import { NO_TIES } from '../../src/player/ties.js';
import { TERRAIN_INDEX, prepare } from '../../src/player/scene.js';
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
    board: null,
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

describe('the open board on the map', () => {
  /**
   * **The map's job during a challenge.** Three cold playtesters opened a board
   * and found a checkbox list of paths over a dimmed map with nothing marked on
   * it — so the only way to answer was to pattern-match on filenames, which is
   * what `treeSibling` exists to punish. What is asserted here is that the
   * markers are *drawn* and that they are drawn for the right nodes: the count
   * is measured off the renderer, like `peaksDrawn`, because a marking layer
   * that never fires is the defect it was built to fix with a comment on top.
   */
  // Refs into the same fixture `frameInput` builds: four nodes, no edges.
  const [subject, one, two] = [0, 1, 2];

  function drawWith(board: FrameInput['board']): number {
    return drawFrame(stubContext(), { ...frameInput([]), board }).boardDrawn;
  }

  it('marks the subject and every candidate, and nothing else', () => {
    const marks = drawWith({
      subject,
      candidates: new Set([one, two]),
      picked: new Set([one]),
      hovered: null,
    });
    // Three: the subject and its two candidates. The fourth node is on the map
    // and is not on the board.
    expect(marks).toBe(3);
  });

  it('draws nothing when no board is open', () => {
    // The control. Without it, a renderer that marked every node on every frame
    // would pass the assertion above on a four-node fixture.
    expect(drawWith(null)).toBe(0);
  });

  it('marks the candidates of a commit-subject board, and does not invent a place for the subject', () => {
    // Placement's subject is a commit (ADR-0018) and the shell hands `null`
    // rather than a ref. The candidates are still files and still get marked —
    // dropping the whole layer because the subject has no place would take the
    // marking away from a quarter of this repo's deck.
    expect(
      drawWith({ subject: null, candidates: new Set([one, two]), picked: new Set(), hovered: two }),
    ).toBe(2);
  });
});

/**
 * The fog is a three-state ramp, and for four milestones the map drew two.
 *
 * `fog.ts` names silhouette, surveyed and understood. `drawFrame` gave the top
 * two the **same fill** and separated them by a stroke width of 2.5px against
 * 1.4px — so the reward for the entire core loop, NORTH-STAR §4's *"fog lifts
 * around what you proved you understand"*, was a line getting one pixel thicker.
 * A cold playtester rated the loop 5 of 10 and could not say what passing had
 * changed. Nothing was red, because no test held the ramp to being visible.
 *
 * Asserted as measured contrast rather than as three HSL numbers that look
 * spaced: HSL lightness is not perceptual and these sit on a near-black ground
 * where the low end is compressed, so "22, 34, 50" is not evidence of anything.
 */
describe('the fog reads as three states', () => {
  const luminance = (color: string): number => {
    const hsl = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(color);
    const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
    let rgb: number[];
    if (hsl !== null) {
      const h = Number(hsl[1]) / 360;
      const s = Number(hsl[2]) / 100;
      const l = Number(hsl[3]) / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const at = (t: number): number => {
        const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      };
      rgb = s === 0 ? [l, l, l] : [at(h + 1 / 3), at(h), at(h - 1 / 3)];
    } else if (hex !== null) {
      const n = Number.parseInt(hex[1] ?? '0', 16);
      rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    } else {
      throw new Error(`not a colour this test can read: ${color}`);
    }
    const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };

  it('separates every state from the one below it, and from the ground', () => {
    // 1.2 is a low bar deliberately: this is a *floor* under "you can tell them
    // apart", not a target. The shipped ramp measures 1.45x and 1.73x
    // (`npx tsx scripts/probe-ramp.ts`), and the version this test was written
    // against measured **1.00** for the top step — the two fills were the same
    // string.
    for (const index of [0, 3, TERRAIN_INDEX]) {
      const ramp = [
        INK.ground,
        regionSilhouette(index, 1),
        regionWash(index, 1),
        regionKnown(index, 1),
      ];
      for (let i = 1; i < ramp.length; i++) {
        const step = contrast(ramp[i] ?? '', ramp[i - 1] ?? '');
        expect(step, `step ${i} of the ramp at region ${index}`).toBeGreaterThan(1.2);
      }
    }
  });

  it('rises monotonically, so brighter always means better known', () => {
    // A ramp that dipped would make *surveyed* read as more known than
    // *understood* somewhere, which is the fog telling the player the opposite
    // of what they earned.
    for (const index of [0, 3, TERRAIN_INDEX]) {
      const rungs = [regionSilhouette(index, 1), regionWash(index, 1), regionKnown(index, 1)].map(
        luminance,
      );
      expect(rungs[0] ?? 0).toBeLessThan(rungs[1] ?? 0);
      expect(rungs[1] ?? 0).toBeLessThan(rungs[2] ?? 0);
    }
  });
});
