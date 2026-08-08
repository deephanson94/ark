/**
 * Colour, derived deterministically from the atlas.
 *
 * Region hues come from the region's *index* in `atlas.regions`, which is
 * sorted by id — so the same repo gets the same colours on every machine and in
 * every session, exactly like the layout does. A palette that shuffled between
 * runs would undo the spatial memory the whole map is built to create.
 *
 * Hues are spaced by the golden angle rather than evenly divided, so adding a
 * region does not renumber the colours of the ones already there — it drops
 * into the largest remaining gap.
 */

const GOLDEN_ANGLE = 137.508;

export interface Ink {
  /** Background of the map. */
  readonly ground: string;
  /** Fog over what the player has not surveyed. */
  readonly fog: string;
  /** Silhouette fill for unsurveyed nodes — visible shape, withheld identity. */
  readonly silhouette: string;
  readonly edge: string;
  readonly edgeHighlight: string;
  /**
   * A co-change wire: two files history says move together.
   *
   * A **third** meaning that can share the screen with the other two — a node
   * can carry an open question, sit in a drawn blast cone and have a history
   * wire at the same time — so it gets its own family rather than a shade of
   * one of theirs. Ember, against gold `edgeHighlight` and teal `question`.
   */
  readonly tie: string;
  /** The same wire at rest, once the moment of the grade has passed. */
  readonly tieRest: string;
  /** Ring on a node that still carries an unanswered question. */
  readonly question: string;
  readonly text: string;
  readonly textDim: string;
}

export const INK: Ink = {
  ground: '#0a0d13',
  fog: 'rgba(10, 13, 19, 0.72)',
  silhouette: '#2b3444',
  edge: 'rgba(140, 160, 190, 0.16)',
  edgeHighlight: 'rgba(255, 214, 130, 0.85)',
  tie: 'rgba(240, 122, 92, 0.92)',
  tieRest: 'rgba(240, 122, 92, 0.30)',
  // Deliberately not the highlight colour: a question marker and a blast-radius
  // highlight appear at the same time and must not read as the same thing.
  question: 'rgba(126, 214, 214, 0.62)',
  text: '#e6edf7',
  textDim: '#7c8798',
};

/**
 * Terrain — files with no edges — is drawn in one desaturated grey rather than
 * given a hue. A hue is a claim of topological kinship; terrain has none.
 */
const TERRAIN_HUE = 220;
const TERRAIN_SATURATION = 8;

function isTerrain(index: number): boolean {
  return index < 0;
}

/** Hue in degrees for the region at `index` in the atlas's sorted region list. */
export function regionHue(index: number): number {
  return isTerrain(index) ? TERRAIN_HUE : (index * GOLDEN_ANGLE) % 360;
}

export function regionColor(index: number, alpha = 1): string {
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 58;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 62%, ${alpha})`;
}

/** A darker companion for fills that sit behind the node colour. */
export function regionWash(index: number, alpha = 1): string {
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 48;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 30%, ${alpha})`;
}

/**
 * An unsurveyed node: its region's hue, drained almost to the background.
 *
 * Risk #4 says fog must never read as the tool hiding things — you should
 * always see the *silhouette* of what you have not explored. A uniform grey
 * disc fails that, and it also throws away the map's main legibility device:
 * with every unsurveyed node the same colour, the regional structure the
 * indexer worked out is invisible until you have clicked most of the repo.
 *
 * Tinting the silhouette shows you the neighbourhoods and their shape from the
 * first frame, while still withholding the thing you have not earned — which
 * is the name, and what depends on it.
 */
export function regionSilhouette(index: number, alpha = 1): string {
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 26;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 17%, ${alpha})`;
}

/**
 * Node radius from lines of code. Square root, so *area* tracks size — a file
 * twice as long looks twice as big, rather than four times.
 */
export function radiusFor(loc: number): number {
  return Math.min(26, Math.max(3.2, Math.sqrt(Math.max(loc, 1)) * 0.75));
}
