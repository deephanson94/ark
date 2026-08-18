/**
 * A medal, drawn.
 *
 * Inline SVG, built with `document.createElementNS` — no asset, no icon font, no
 * fourth runtime dependency (the player's budget is three and it currently uses
 * zero). Everything here is a function of `Medal`, so a shelf cannot show a
 * shape the derivation does not support.
 *
 * ## The thing this file exists not to do
 *
 * **An unearned medal must not render as a dark blob.** The sub-pass badge was
 * built as a conic gradient over a mask, which at 0% is a near-black rounded
 * square — so the fix for a missing visual reproduced the missing-visual defect
 * inside itself, and it took forcing the value to 62% to notice. An unearned
 * medal is the *common* case on arrival: every one of them is empty in the first
 * ten minutes, which is exactly the frame the panel scores.
 *
 * So the shape is always drawn, at full stroke, and only the *fill* is earned.
 * An empty shelf reads as a rack of outlines waiting to be filled — the
 * silhouette risk #4 asks for, applied to a trophy case rather than to terrain.
 *
 * The three shapes come from `Medal.shelf` so a family is recognisable before it
 * is read: a shield for territory, a disc for reach, a star for craft.
 */

import type { Medal, Tier } from './medals.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Bronze, silver, gold.
 *
 * Hue and lightness both move, because a ramp that only moves saturation is the
 * defect `palette.ts` records for the fog's three states — two of them shared
 * one fill and the reward for the whole core loop was a line getting a pixel
 * thicker. These are far enough apart to read at 34px on a dark panel.
 */
const TIER_INK: readonly [string, string, string] = [
  '#b87a4a', // bronze
  '#c3ccd8', // silver
  '#ffd682', // gold — the accent, so the top tier matches the rest of the UI
];

/** The outline every medal keeps, earned or not. */
const EMPTY_INK = 'rgba(120, 140, 170, 0.42)';

function node(name: string, attrs: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

/** The outline for a shelf, as an SVG path over a 40×40 box. */
function outline(shelf: Medal['shelf']): string {
  switch (shelf) {
    // A shield: territory held.
    case 'territory':
      return 'M20 4 L34 9 V21 C34 29 27 34 20 36 C13 34 6 29 6 21 V9 Z';
    // A disc with a rim: reach across the whole map.
    case 'reach':
      return 'M20 5 A15 15 0 1 1 19.99 5 Z';
    // A star: a thing done well.
    case 'craft':
      return 'M20 4 L24.5 15.5 L36.5 16.2 L27 23.6 L30.4 35.2 L20 28.4 L9.6 35.2 L13 23.6 L3.5 16.2 L15.5 15.5 Z';
  }
}

/**
 * How full the medal is, `0..1`.
 *
 * A **graded** medal shows progress toward its next tier so the shelf is a
 * ladder rather than a set of switches; a single-tier medal is binary, because
 * "half of a thing you either did or did not do" would be a made-up number.
 */
export function fillFraction(medal: Medal): number {
  if (medal.tiers === 1) return medal.earned ? 1 : 0;
  if (medal.need <= 0) return 0;
  return Math.max(0, Math.min(1, medal.have / medal.need));
}

export function medalSvg(medal: Medal): SVGElement {
  const svg = node('svg', {
    class: 'medal-art',
    viewBox: '0 0 40 40',
    width: '40',
    height: '40',
    'aria-hidden': 'true',
  });
  const path = outline(medal.shelf);
  // **A single-tier medal is gold, not bronze.** It has no tiers, so `tier` is 0
  // and the ramp's first colour is the wrong reading entirely: "you either did
  // this or you did not" rendered as the lowest rung. Caught by looking at an
  // earned shelf — "Left nothing behind" was a bronze star beside a bronze
  // partial shield, which says the two are at the same standing and they are not.
  const ink = medal.tiers === 1 ? TIER_INK[2] : TIER_INK[medal.tier as Tier];
  const fraction = fillFraction(medal);

  // A clip that rises from the bottom, so partial progress reads as a vessel
  // filling. `height` of 0 is a legitimate empty — the outline below is a
  // separate element and is drawn regardless, which is the whole point.
  const clipId = `medal-clip-${medal.id.replace(/[^a-z0-9]/gi, '-')}`;
  const clip = node('clipPath', { id: clipId });
  clip.appendChild(node('rect', { x: '0', y: String(40 - 40 * fraction), width: '40', height: '40' }));
  const defs = node('defs', {});
  defs.appendChild(clip);
  svg.appendChild(defs);

  if (fraction > 0) {
    const fill = node('path', { d: path, fill: ink, opacity: '0.9', 'clip-path': `url(#${clipId})` });
    svg.appendChild(fill);
  }
  // **Always.** The outline is the medal's identity; the fill is its state.
  svg.appendChild(
    node('path', {
      d: path,
      fill: 'none',
      stroke: medal.earned ? ink : EMPTY_INK,
      'stroke-width': medal.earned ? '2' : '1.4',
      'stroke-linejoin': 'round',
    }),
  );
  return svg;
}

/**
 * The tier pips under a graded medal — one per tier, filled to what is reached.
 *
 * Single-tier medals get none rather than one empty pip, which would read as an
 * unreached tier on a medal that has no tiers.
 */
export function tierPips(medal: Medal): SVGElement | null {
  if (medal.tiers === 1) return null;
  const svg = node('svg', {
    class: 'medal-pips',
    viewBox: `0 0 ${medal.tiers * 8} 6`,
    width: String(medal.tiers * 8),
    height: '6',
    'aria-hidden': 'true',
  });
  // How many tiers are *complete*: `tier` is the one in progress, so a medal at
  // gold with everything done has `tier === 2` and three filled pips.
  const done = medal.earned ? medal.tier + 1 : medal.tier;
  for (let i = 0; i < medal.tiers; i += 1) {
    svg.appendChild(
      node('circle', {
        cx: String(4 + i * 8),
        cy: '3',
        r: '2',
        fill: i < done ? (TIER_INK[i as Tier] ?? EMPTY_INK) : 'none',
        stroke: i < done ? 'none' : EMPTY_INK,
        'stroke-width': '1',
      }),
    );
  }
  return svg;
}
