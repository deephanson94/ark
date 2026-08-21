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

import { drawFrame, regionLines } from '../../src/player/draw.js';
import { INK, regionKnown, regionSilhouette, regionWash } from '../../src/player/palette.js';
import type { FrameInput } from '../../src/player/draw.js';
import { NORTH, worldToScreen } from '../../src/player/camera.js';
import { NO_CHAINS } from '../../src/player/chains.js';
import { NO_TIES } from '../../src/player/ties.js';
import { TERRAIN_INDEX, prepare } from '../../src/player/scene.js';
import { dependents } from '../../src/atlas/index.js';
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
    roundRect: noop,
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

/**
 * A stub that **records** the fill colours it is given.
 *
 * The proxy above swallows every style write, which is right for the tests that
 * only care what got drawn — and it makes a *colour* channel unobservable. The
 * region wash brightens with how much of a region the player has answered
 * (`FrameInput.regionProgress`), and without this a mutant ignoring that field
 * entirely passes every assertion in the file: the same island count is drawn
 * either way. Count-the-firings, applied to a rendering.
 */
function recordingContext(): { context: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const base = stubContext();
  const context = new Proxy(base, {
    get: (object, key) => Reflect.get(object, key),
    set: (object, key, value) => {
      if (key === 'fillStyle' && typeof value === 'string') fills.push(value);
      return Reflect.set(object, key, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, fills };
}

/**
 * Every `stroke()` in order, with the width, colour and alpha in force.
 *
 * The proxy stub swallows style writes, so an assertion about *how* something
 * was stroked needs the writes recorded — and the defect this exists for is an
 * ordering one (the radius pass must run last), which no end-state check can
 * see.
 */
function strokeLog(): { context: CanvasRenderingContext2D; strokes: { width: number; style: string; alpha: number }[] } {
  const strokes: { width: number; style: string; alpha: number }[] = [];
  const state = { width: 1, style: '', alpha: 1 };
  const base = stubContext();
  const context = new Proxy(base, {
    get: (object, key) => {
      if (key === 'stroke') return () => strokes.push({ ...state });
      return Reflect.get(object, key);
    },
    set: (object, key, value) => {
      if (key === 'lineWidth' && typeof value === 'number') state.width = value;
      if (key === 'strokeStyle' && typeof value === 'string') state.style = value;
      if (key === 'globalAlpha' && typeof value === 'number') state.alpha = value;
      return Reflect.set(object, key, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, strokes };
}

/** The alpha of an `hsla(...)` fill, or null if it is not one. */
function alphaOf(fill: string): number | null {
  const match = /hsla\([^)]*,\s*([0-9.]+)\)/.exec(fill);
  return match === null ? null : Number(match[1]);
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
  chains: NO_CHAINS,
    focus: null,
    // Untouched map: the wash channel is inert, which is what an arriving
    // player sees and is the baseline the brightening must not change.
    regionProgress: new Map<number, number>(),
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

  it('separates the state you earned from the one below it, at every hue', () => {
    // **The bar and the sample were both wrong in the first version.** It
    // asserted a flat 1.2 over regions `[0, 3, TERRAIN]` — a number I chose
    // without measuring, checked on three of the forty-eight hues the palette
    // can produce. A review swept all of them: the silhouette→surveyed step is
    // **1.18 at hue 243°**, under that bar, on a hue any repo with eight or more
    // regions has. So the bar was not holding; it was being sampled around.
    //
    // Two claims now, at their measured values, over the whole population.
    // **This one is the load-bearing half**: the step the core loop rewards.
    // Worst case 1.47 across all forty-eight (`npx tsx scripts/probe-ramp.ts`),
    // and it measured **1.00** before the third rung existed, because the two
    // fills were the same string.
    for (let index = 0; index < 48; index += 1) {
      const step = contrast(regionKnown(index, 1), regionWash(index, 1));
      expect(step, `reward step at region ${index}`).toBeGreaterThan(1.35);
    }
    expect(contrast(regionKnown(TERRAIN_INDEX, 1), regionWash(TERRAIN_INDEX, 1))).toBeGreaterThan(1.35);
  });

  it('keeps the unsurveyed state distinguishable, at the value it actually reaches', () => {
    // **The weaker half, stated at its real floor rather than at a hopeful one.**
    // HSL lightness is not perceptual and blue carries little luminance, so the
    // same three lightnesses separate well at red and poorly at 243°. Fixing
    // that properly means varying lightness by hue, which moves every colour on
    // every map and is a decision about the palette rather than about the fog —
    // not something to slip into a rendering commit. Recorded here at the
    // measured floor so a regression is still visible.
    for (let index = 0; index < 48; index += 1) {
      expect(contrast(regionWash(index, 1), regionSilhouette(index, 1))).toBeGreaterThan(1.15);
      expect(contrast(regionSilhouette(index, 1), INK.ground)).toBeGreaterThan(1.3);
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

/**
 * That the renderer *reaches for* the third rung, not merely that it exists.
 *
 * **A review unwired `regionKnown` from both shipped draw paths and all 934 unit
 * tests passed.** The ramp tests above are about the palette — they prove three
 * distinct colours exist and are ordered — and nothing connected them to the
 * frame. So the defect the ramp was built to fix could have been reintroduced by
 * deleting two ternaries, with the suite green and the palette still perfect.
 *
 * The stub records every `fillStyle` written, which is the cheapest thing that
 * can tell a fill apart from a fill.
 */
describe('the renderer uses the ramp it is given', () => {
  function fillsFor(understood: ReadonlySet<string>): string[] {
    const seen: string[] = [];
    const noop = (): void => {};
    const target = {
      measureText: (text: string) => ({ width: text.length * 7 }),
      save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop,
      lineTo: noop, arc: noop, ellipse: noop, rect: noop, roundRect: noop, fill: noop, stroke: noop,
      fillRect: noop, fillText: noop, strokeText: noop, setLineDash: noop,
      quadraticCurveTo: noop, bezierCurveTo: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
    };
    const context = new Proxy(target, {
      get: (object, key) => Reflect.get(object, key) ?? undefined,
      set: (_object, key, value) => {
        if (key === 'fillStyle' && typeof value === 'string') seen.push(value);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    const atlas = atlasWith(
      ['src/hub.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
      [
        ['src/a.ts', 'src/hub.ts'],
        ['src/b.ts', 'src/hub.ts'],
        ['src/c.ts', 'src/a.ts'],
      ],
    );
    const scene = prepare(atlas);
    const all = new Set(scene.nodes.map((node) => node.id));
    drawFrame(context, {
      scene,
      camera: { x: 0, y: 0, scale: 1, bearing: NORTH },
      viewport: VIEWPORT,
      fog: { surveyed: all, understood },
      hovered: null,
      selected: null,
      radius: null,
      questions: new Set(),
      peaks: new Set(),
      ties: NO_TIES,
  chains: NO_CHAINS,
      focus: null,
      board: null,
      chrome: [],
      regionProgress: new Map<number, number>(),
    });
    return seen;
  }

  it('paints an understood node with a colour it paints nothing else with', () => {
    const atlas = atlasWith(['src/hub.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'], []);
    const scene = prepare(atlas);
    const hub = scene.nodes.find((node) => node.path === 'src/hub.ts');
    if (hub === undefined) throw new Error('fixture lost its hub');
    const known = regionKnown(hub.regionIndex, 1);

    // Nothing understood: the ramp's top colour must not appear at all. This is
    // the half that catches the ternary being deleted.
    expect(fillsFor(new Set())).not.toContain(known);
    // One node understood: it must.
    expect(fillsFor(new Set([hub.id]))).toContain(known);
  });
});

/**
 * A drawn name is a handle on the node it names.
 *
 * A cold playtester answered **all eight** of their boards off the panel's text
 * list and never used the map once, and reported the map as "naming the wrong
 * objects": pointing at the label `draw.test.ts` selected `src/player/draw.ts`.
 * `placeLabels` anchors a label directly under its own disc and skips it
 * otherwise — it never drifts — so the labels were right and the *pointer* was
 * wrong: text lies across other discs on a crowded map, and hit-testing went
 * straight to whatever disc was underneath.
 *
 * `drawFrame` returns the placed labels with the node each names so the shell
 * can hit-test the text. This pins the half that lives here: every returned
 * nameplate names the node whose label it carries.
 */
describe('the labels a frame returns', () => {
  it('carries the node each name belongs to', () => {
    const atlas = atlasWith(
      ['src/hub.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
      [
        ['src/a.ts', 'src/hub.ts'],
        ['src/b.ts', 'src/hub.ts'],
        ['src/c.ts', 'src/a.ts'],
      ],
    );
    const scene = prepare(atlas);
    const all = new Set(scene.nodes.map((node) => node.id));
    const stats = drawFrame(stubContext(), {
      scene,
      camera: { x: 0, y: 0, scale: 4, bearing: NORTH },
      viewport: VIEWPORT,
      fog: { surveyed: all, understood: new Set() },
      hovered: null,
      selected: null,
      radius: null,
      questions: new Set(),
      peaks: new Set(),
      ties: NO_TIES,
  chains: NO_CHAINS,
      focus: null,
      board: null,
      chrome: [],
      regionProgress: new Map<number, number>(),
    });
    // Non-vacuous: a frame that drew no labels would satisfy any claim about
    // them, and this is the assertion that would have caught the field being
    // wired to an empty array.
    expect(stats.nameplates.length).toBeGreaterThan(0);
    // Not `=== labelsDrawn`: that holds only at street zoom, where region
    // labels are off. At district `labelsDrawn` counts those too, and
    // nameplates never will — the equality would be pinning a zoom-level
    // coincidence rather than a contract.
    expect(stats.nameplates.length).toBeLessThanOrEqual(stats.labelsDrawn);
    for (const plate of stats.nameplates) {
      expect(plate.ref, `"${plate.text}" carries no node`).toBeTypeOf('number');
      // The name on screen is this node's name — the exact claim the playtester
      // found false from the pointer's side.
      expect(scene.nodes[plate.ref ?? -1]?.label).toBe(plate.text);
    }
  });

  it('keeps each name touching its own node’s disc', () => {
    // The other half of "a label identifies its node": it is *attached* to the
    // disc it names.
    //
    // This asserted horizontal centring until labels learned to dodge, and the
    // weaker claim is the right one — centring was never what made a name
    // identify its node. That is `ref`, which the test above checks and which
    // is what the reported defect was actually about; a centred label still
    // lies across four other discs on a crowded frame. What a dodge must not
    // do is let a name *drift*, which is the property here: whichever of the
    // four anchors it took, the box hugs its own disc.
    const atlas = atlasWith(['src/hub.ts', 'src/a.ts', 'src/b.ts'], [['src/a.ts', 'src/hub.ts']]);
    const scene = prepare(atlas);
    const all = new Set(scene.nodes.map((node) => node.id));
    const camera = { x: 0, y: 0, scale: 4, bearing: NORTH };
    const stats = drawFrame(stubContext(), {
      scene, camera, viewport: VIEWPORT,
      fog: { surveyed: all, understood: new Set() },
      hovered: null, selected: null, radius: null,
      questions: new Set(), peaks: new Set(), ties: NO_TIES,
  chains: NO_CHAINS, focus: null,
      board: null, chrome: [], regionProgress: new Map<number, number>(),
    });
    expect(stats.nameplates.length).toBeGreaterThan(0);
    for (const plate of stats.nameplates) {
      const node = scene.nodes[plate.ref ?? -1];
      if (node === undefined) throw new Error('nameplate names no node');
      const point = worldToScreen(camera, VIEWPORT, node);
      // The clearance the draw pass leaves around a disc, plus a pixel.
      const reach = Math.max(1.4, node.radius * camera.scale) + 3;
      const dx = Math.max(plate.left - point.x, 0, point.x - (plate.left + plate.width));
      const dy = Math.max(plate.top - point.y, 0, point.y - (plate.top + plate.height));
      expect(Math.hypot(dx, dy), `"${plate.text}"`).toBeLessThanOrEqual(reach);
    }
  });
});

describe('a region label sits inside the box reserved for it', () => {
  /**
   * `placeLabels` returns `y` as the box's **bottom**, and the pair was drawn
   * at `y ∓ height/2` — so the file-count line landed a half-line below the
   * rectangle every other label had been told to avoid. Node labels crossed it
   * legally: `55 files` under `schema.ts` on this repo's own arrival frame.
   *
   * Reserving a rectangle and then drawing outside it is invisible to a
   * collision pass by construction, which is why this is asserted here rather
   * than left to "it looks fine".
   */
  const HEIGHT = 34;
  const BOTTOM = 500;

  it('keeps both lines between the box top and its bottom', () => {
    const line = regionLines(BOTTOM, HEIGHT);
    // Baselines are middles here, so allow half a line of glyph either side.
    for (const y of [line.name, line.count]) {
      expect(y - HEIGHT / 4).toBeGreaterThanOrEqual(BOTTOM - HEIGHT);
      expect(y + HEIGHT / 4).toBeLessThanOrEqual(BOTTOM);
    }
  });

  it('puts the name above the count', () => {
    const line = regionLines(BOTTOM, HEIGHT);
    expect(line.name).toBeLessThan(line.count);
  });

  it('centres the pair on the box', () => {
    const line = regionLines(BOTTOM, HEIGHT);
    expect((line.name + line.count) / 2).toBeCloseTo(BOTTOM - HEIGHT / 2, 6);
  });
});


/**
 * The glyphs land inside the box the frame says they are in.
 *
 * `nameplates` is what the shell hit-tests, and nothing anywhere bound it to
 * where `fillText` actually put the ink. A review demonstrated it: stamping node
 * labels at `label.x + 10` passes all 956 unit tests, and the e2e cannot see it
 * either — it hovers the centre of the published box and `pickName` hit-tests
 * the *same* box, so the instrument and the code share the coordinate and only
 * the pixels are somewhere else. That is the reported "the map names the wrong
 * thing" defect, reintroduced with every gate green.
 *
 * Recording context rather than a stub, because the claim is about arguments to
 * a draw call and there is no other way to see them.
 */
describe('a nameplate is drawn where the frame says it is', () => {
  it('puts every label’s glyphs inside its own published box', () => {
    const drawn: { text: string; x: number; y: number }[] = [];
    const context = stubContext();
    // The halo and the fill both go through `fillText`/`strokeText` at the same
    // point; recording the fill is enough, and recording both would double every
    // row without adding a claim.
    Object.defineProperty(context, 'fillText', {
      value: (text: string, x: number, y: number) => drawn.push({ text, x, y }),
      writable: true,
    });

    const stats = drawFrame(context, frameInput([]));
    expect(stats.nameplates.length).toBeGreaterThan(0);

    for (const plate of stats.nameplates) {
      const ink = drawn.filter((call) => call.text === plate.text);
      expect(ink.length, `"${plate.text}" was never drawn`).toBeGreaterThan(0);
      for (const call of ink) {
        // **The exact centre, not "somewhere in the box".** The first version
        // of this asserted containment and a 10px drift survived it, because a
        // label is wider than 20px and the anchor stayed inside its own
        // rectangle — the loose assertion passed against the defect it was
        // written for, one more time. `textAlign` is centre, so there is one
        // correct x and it is arithmetic.
        expect(call.x, `"${plate.text}" x`).toBeCloseTo(plate.left + plate.width / 2, 6);
        // y keeps containment: the baseline sits a few px above the box bottom
        // and pinning that nudge would be pinning a constant, not a binding.
        expect(call.y, `"${plate.text}" y`).toBeGreaterThanOrEqual(plate.top);
        expect(call.y, `"${plate.text}" y`).toBeLessThanOrEqual(plate.top + plate.height);
      }
    }
  });
});

/**
 * A board marker for a node off the edge of the screen.
 *
 * The mark block iterated the visible set without re-checking the box a marker
 * occupies, which reaches past the disc — so a candidate just outside the frame
 * drew a rounded rectangle clipped by the viewport and lying across the HUD. A
 * frontend engineer on the panel reported it as "a stray white artifact
 * overlapping the header", which is what it looks like if you do not know what
 * it is.
 */
describe('board markers stay inside the frame', () => {
  it('marks a candidate on screen and not one in the cull’s margin', () => {
    // **Inside the margin, not far away.** The first version scrolled 90,000
    // units off, where `visibleNodes` returns nothing and the count is zero
    // with or without the fix — a test that could not fail, for a defect about
    // a node that is *nearly* on screen. `drawFrame` culls at the viewport plus
    // **120px**, so the marks block sees nodes up to 120px outside the frame and
    // drew a box for every one of them. The camera here puts the fixture just
    // inside that band.
    const atlas = atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts'], [['src/b.ts', 'src/a.ts']]);
    const scene = prepare(atlas);
    const base = frameInput([]);
    const board = { subject: null, candidates: new Set([0, 1, 2]), picked: new Set<number>(), hovered: null };
    const centred = drawFrame(stubContext(), { ...base, scene, board });
    expect(centred.boardDrawn).toBeGreaterThan(0);

    // Push the whole fixture past the right edge by a little over half the
    // viewport, so every node lands in the 120px margin rather than in frame.
    const off = { ...base.camera, x: base.camera.x + VIEWPORT.width / 2 + 60 };
    const margin = drawFrame(stubContext(), { ...base, scene, board, camera: off });
    const seen = drawFrame(stubContext(), { ...base, scene, camera: off }).nodesDrawn;
    expect(seen, 'the cull must still hand the marks block these nodes').toBeGreaterThan(0);
    expect(margin.boardDrawn).toBe(0);
  });
});

/**
 * A marked subject is not a clickable answer.
 *
 * `boardDrawn` counts every marker the board layer draws, including the
 * subject's ring. Archaeology's subject is a **file** and its candidates are
 * **commits**, so that board draws exactly one marker and none of it is an
 * input — and a gate that read the merged number concluded the panel should
 * offer click-to-answer on the one board where clicking answers nothing. CI
 * caught it; locally the sweep never reached that verb.
 */
describe('candidate markers are counted apart from the subject’s', () => {
  const [subject, one, two] = [0, 1, 2];

  function marksOf(board: FrameInput['board']): { all: number; candidates: number } {
    const stats = drawFrame(stubContext(), { ...frameInput([]), board });
    return { all: stats.boardDrawn, candidates: stats.candidatesDrawn };
  }

  it('counts a subject-only board as marked and not as clickable', () => {
    // The shape of every Archaeology board: a placed subject, no placed
    // candidate.
    const marks = marksOf({ subject, candidates: new Set(), picked: new Set(), hovered: null });
    expect(marks.all).toBe(1);
    expect(marks.candidates).toBe(0);
  });

  it('counts candidates when the board has them', () => {
    const marks = marksOf({
      subject,
      candidates: new Set([one, two]),
      picked: new Set([one]),
      hovered: null,
    });
    expect(marks.all).toBe(3);
    expect(marks.candidates).toBe(2);
  });
});


describe('the region wash is the map\'s scoreboard', () => {
  // Five rounds of cold playtests asked what gave a sense of progress and the
  // last ten all answered *the map lighting up*; four then asked for the region
  // tally to move onto the map. This is that channel, and it is a colour — so it
  // needs a stub that can see colours, or the assertion is decoration.
  const cleared = (progress: ReadonlyMap<number, number>): number[] => {
    const { context, fills } = recordingContext();
    drawFrame(context, { ...frameInput([]), regionProgress: progress });
    return fills
      .map(alphaOf)
      .filter((alpha): alpha is number => alpha !== null)
      // The washes are the faintest fills on the frame; the discs and text are
      // far stronger. Taking the low tail keeps this about the ground.
      .filter((alpha) => alpha < 0.3)
      .sort((a, b) => b - a);
  };

  it('brightens the ground as a region is answered', () => {
    const untouched = cleared(new Map());
    const half = cleared(new Map([[0, 0.5]]));
    const whole = cleared(new Map([[0, 1]]));
    expect(untouched.length).toBeGreaterThan(0);
    // The brightest ground fill rises monotonically with the fraction.
    expect(half[0]).toBeGreaterThan(untouched[0] as number);
    expect(whole[0]).toBeGreaterThan(half[0] as number);
  });

  it('leaves an untouched map exactly as it was', () => {
    // The channel only ever *adds* — guardrail 6's shape applied to a rendering:
    // nothing a player does can make ground darker than they found it, and an
    // arriving player sees the frame that shipped before this existed.
    const none = cleared(new Map());
    const zero = cleared(new Map([[0, 0]]));
    expect(zero).toEqual(none);
  });
});

describe('the open board’s ring', () => {
  /**
   * `one.ts` and `two.ts` import `hub.ts`; `three.ts → four.ts` is **off** the
   * radius entirely.
   *
   * That last edge is the plant. The shared fixture's only two edges are both
   * inside the radius, so the ordering assertion below had nothing to order
   * against and read `field.length === 0` — an empty control, which is this
   * repo's most-repeated way of passing while testing nothing.
   */
  function cityWithRadius(open: boolean): FrameInput {
    const atlas = atlasWith(
      ['src/hub.ts', 'src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'],
      [
        ['src/one.ts', 'src/hub.ts'],
        ['src/two.ts', 'src/hub.ts'],
        ['src/three.ts', 'src/four.ts'],
      ],
    );
    const scene = prepare(atlas);
    const surveyed = new Set(atlas.nodes.map((node) => node.id));
    const subject = scene.nodes.findIndex((node) => node.path === 'src/hub.ts');
    return {
      ...frameInput([]),
      scene,
      fog: { surveyed, understood: surveyed },
      radius: open
        ? {
            subject,
            dependents: dependents(scene.graph, subject, Number.POSITIVE_INFINITY),
            maxDepth: Number.POSITIVE_INFINITY,
          }
        : null,
    };
  }
  const withRadius = (): FrameInput => cityWithRadius(true);

  it('strokes the ring, and counts what it stroked', () => {
    // Three cold testers reported the map inert during a board, one of them
    // having diffed two frames pixel-for-pixel. "The ring is drawn" is exactly
    // the sort of claim this repo requires a number for.
    const stats = drawFrame(stubContext(), withRadius());
    expect(stats.radiusEdgesDrawn).toBe(2);
    expect(drawFrame(stubContext(), cityWithRadius(false)).radiusEdgesDrawn).toBe(0);
  });

  it('draws the ring after every other edge, so nothing paints over it', () => {
    // **The defect, and it is an ordering one.** A single pass stroked a
    // highlighted edge wherever it fell in `edges` order and let the rest paint
    // over it. No end-state assertion can see that — only the sequence can.
    const { context, strokes } = strokeLog();
    drawFrame(context, withRadius());
    const ring = strokes
      .map((stroke, at) => ({ ...stroke, at }))
      .filter((stroke) => stroke.style.includes('214')); // INK.edgeHighlight
    const field = strokes
      .map((stroke, at) => ({ ...stroke, at }))
      .filter((stroke) => stroke.style.includes('140, 160, 190')); // INK.edge
    expect(ring.length).toBe(2);
    expect(field.length).toBeGreaterThan(0);
    const lastField = Math.max(...field.map((stroke) => stroke.at));
    const firstRing = Math.min(...ring.map((stroke) => stroke.at));
    expect(firstRing).toBeGreaterThan(lastField);
  });

  it('draws the ring thicker, because colour alone did not read', () => {
    // At street zoom the two differed by 0.85 against 0.44 at an identical
    // width — 1.9x, spread over hundreds of lines. A width difference reads at
    // any alpha.
    const { context, strokes } = strokeLog();
    drawFrame(context, withRadius());
    const ring = strokes.filter((stroke) => stroke.style.includes('214'));
    const field = strokes.filter((stroke) => stroke.style.includes('140, 160, 190'));
    expect(ring[0]?.width).toBeGreaterThan((field[0]?.width ?? 0) * 1.5);
    expect(ring[0]?.alpha).toBe(1);
  });

  it('mutes the rest of the field while a board is open, as the nodes already did', () => {
    // `dimmed` has faded every node outside the radius since M2 and nothing did
    // the same for the edges — half a rule, which reads as a design choice once
    // it has been in the tree a milestone.
    const open = strokeLog();
    drawFrame(open.context, withRadius());
    const closed = strokeLog();
    drawFrame(closed.context, cityWithRadius(false));
    const fieldAlpha = (log: typeof open) =>
      log.strokes.find((stroke) => stroke.style.includes('140, 160, 190'))?.alpha ?? 0;
    expect(fieldAlpha(open)).toBeLessThan(fieldAlpha(closed));
  });
});
