/**
 * Semantic zoom (NORTH-STAR §9): detail appears at the zoom level where it is
 * readable, not all at once.
 *
 * Three levels, chosen by camera scale:
 *
 *   territory  the shape of the repo — regions, their labels, nodes as dots
 *   district   individual files, labelled where there is room for a label
 *   street     everything labelled, edges legible, direction visible
 *
 * The thresholds are the point at which a label of ordinary length stops
 * colliding with its neighbours at typical node spacing. They are tuned
 * numbers, not derived ones, and the honest place to revisit them is a
 * playtest, not a formula.
 */

export type ZoomLevel = 'territory' | 'district' | 'street';

export const DISTRICT_SCALE = 0.55;
export const STREET_SCALE = 1.6;

export function levelFor(scale: number): ZoomLevel {
  if (scale < DISTRICT_SCALE) return 'territory';
  if (scale < STREET_SCALE) return 'district';
  return 'street';
}

export interface LevelStyle {
  readonly showRegionLabels: boolean;
  readonly showNodeLabels: boolean;
  /** Cap on node labels drawn, before collision rejection. Infinity at street level. */
  readonly nodeLabelBudget: number;
  readonly showEdges: boolean;
  readonly edgeAlpha: number;
  /** Multiplier on node radius, so dots stay visible when zoomed far out. */
  readonly nodeScale: number;
}

export function styleFor(level: ZoomLevel): LevelStyle {
  switch (level) {
    case 'territory':
      return {
        showRegionLabels: true,
        showNodeLabels: false,
        nodeLabelBudget: 0,
        showEdges: true,
        edgeAlpha: 0.35,
        nodeScale: 1.35,
      };
    case 'district':
      return {
        showRegionLabels: true,
        showNodeLabels: true,
        nodeLabelBudget: 28,
        showEdges: true,
        edgeAlpha: 0.7,
        nodeScale: 1,
      };
    case 'street':
      return {
        showRegionLabels: false,
        showNodeLabels: true,
        nodeLabelBudget: Number.POSITIVE_INFINITY,
        showEdges: true,
        edgeAlpha: 1,
        nodeScale: 1,
      };
  }
}

/** `src/indexer/build.ts` → `build.ts` at street level, full path on hover. */
export function shortLabel(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
