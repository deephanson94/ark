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
  readonly subject: string;
  readonly candidate: string;
  readonly picked: string;
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
  // The open board. Three inks, none of them the question ring's — a board is
  // *this* question, and the deck's other rings are on screen at the same time.
  subject: 'rgba(255, 214, 130, 0.95)',
  candidate: 'rgba(186, 200, 224, 0.65)',
  picked: 'rgba(126, 214, 214, 0.95)',
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
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 52;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 34%, ${alpha})`;
}

/**
 * A node whose **own** question you have passed — the brightest a file gets.
 *
 * **The third rung of a ramp that had only two.** `fog.ts` names three states and
 * the map drew two: silhouette got its own drained fill, and *surveyed* and
 * *understood* shared one, separated by a stroke width of 1.4px against 2.5px.
 * So the reward for the entire core loop — answer a question, prove you
 * understand a file, watch the fog lift — was a line getting one pixel thicker.
 * A cold playtester rated the loop 5 out of 10 and could not tell what passing
 * had changed; NORTH-STAR §4 says the revealed fraction of the map is *"a real
 * measure of how much of it you can reason about"*, and a measure nobody can
 * read is not one.
 *
 * Lightness, because that is the channel with room in it: hue already carries
 * region and saturation already carries terrain, so a third meaning had to go
 * somewhere unoccupied.
 *
 * **The ramp is 22 → 34 → 50 in HSL and that is not the claim**, because HSL
 * lightness is not perceptual and these fills sit on a near-black ground where
 * the bottom of the range is compressed. Measured as WCAG contrast by
 * `npx tsx scripts/probe-ramp.ts`: at region 0 the three fills read
 * **1.49 : 2.16 : 3.75** against the `#0a0d13` ground, steps of **1.45×** and
 * **1.73×**. The larger step is the one the loop rewards, which is the right way
 * round — and the first draft of this paragraph asserted "1.9 : 3.4 : 6.6,
 * roughly 1.8× each" from no measurement at all, which the probe was written to
 * catch and did.
 *
 * **Those are one hue's numbers, and the hues are not alike.** Swept over all 48
 * the palette can produce, the reward step's worst case is **1.47** and the
 * silhouette→surveyed step's is **1.18, at hue 243°** — blue carries little
 * luminance, so an HSL lightness ramp separates well at red and poorly there.
 * The half the loop depends on holds everywhere; the lower half is weak on blue
 * regions and is recorded rather than papered over, because fixing it means
 * varying lightness by hue, which moves every colour on every map and is a
 * decision about the palette rather than about the fog.
 */
export function regionKnown(index: number, alpha = 1): string {
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 56;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 50%, ${alpha})`;
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
 *
 * **Lifted 17% → 22% in the repaint**, with `regionWash` 30% → 34%. Against a
 * `#0a0d13` ground the old values put the whole map inside the bottom fifth of
 * the value range, so the one channel that separates *surveyed* from *not* had
 * almost no room to work in — and lifting an unsurveyed node is the direction
 * risk #4 wants anyway (*you can always see that there is something there*).
 */
export function regionSilhouette(index: number, alpha = 1): string {
  const saturation = isTerrain(index) ? TERRAIN_SATURATION : 28;
  return `hsla(${regionHue(index).toFixed(1)}, ${saturation}%, 22%, ${alpha})`;
}

/**
 * Node radius from lines of code. Square root, so *area* tracks size — a file
 * twice as long looks twice as big, rather than four times.
 */
export function radiusFor(loc: number): number {
  return Math.min(26, Math.max(3.2, Math.sqrt(Math.max(loc, 1)) * 0.75));
}
