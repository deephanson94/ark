/**
 * What the map says about itself in the first three seconds.
 *
 * Pillar 6 is *ten minutes to first true insight*, and the panel that measured
 * this product spent its first ten seconds looking at a static cluster of
 * circles with four instrument panels around it. Three of ten testers said so
 * in different words — *"a debug graph visualisation, not a world someone built
 * for you"*, *"no arrival moment"*, *"a static frozen graph"*. Nothing was
 * wrong; nothing happened either.
 *
 * So the map introduces itself: how big this repository is, how many
 * neighbourhoods it fell into, and the name of the file the most other files
 * lean on. All four facts are read off the atlas — guardrail 2 — and none of
 * them is gradeable.
 *
 * ## What it deliberately does not say
 *
 * No per-node counts. The inspector prints `imported by` for whatever you
 * select and the map draws every node's direct importers for free (ADR-0008
 * decision 1), so a *count* here would disclose nothing new — but a security
 * researcher on the panel found that the same number sitting beside a question
 * asking for that set is a shortcut, and an arrival card is exactly where a
 * player has not yet earned anything. Aggregates and one name, which no board
 * asks for.
 *
 * Pure, so the sentence can be asserted without a browser.
 */

import type { Scene } from './scene.js';
import { byteCompare } from '../atlas/index.js';

export interface Arrival {
  readonly name: string;
  /** Files on the map — not files in the repository; ADR-0025's gap is the HUD's. */
  readonly files: number;
  readonly regions: number;
  readonly edges: number;
  /** The most load-bearing file's short label, or `null` on a map with no edges. */
  readonly landmark: string | null;
}

export function arrivalOf(scene: Scene): Arrival {
  // Terrain is ground rather than a neighbourhood, and the legend already says
  // so; counting it here would claim a district the palette does not draw.
  const regions = scene.regions.filter((region) => region.kind !== 'terrain').length;

  // **Elevation, not in-degree.** ADR-0013 makes `elevation` the bit length of
  // the transitive dependent count, which is what "the most other files lean on
  // it" means; in-degree is the direct ring and would name a barrel over the
  // thing the barrel re-exports. Ties break on the direct count and then on the
  // label, so two machines showing the same repo show the same sentence.
  let landmark: { label: string; elevation: number; dependents: number } | null = null;
  for (const node of scene.nodes) {
    if (node.elevation <= 0) continue;
    const better =
      landmark === null ||
      node.elevation > landmark.elevation ||
      (node.elevation === landmark.elevation && node.dependentCount > landmark.dependents) ||
      (node.elevation === landmark.elevation &&
        node.dependentCount === landmark.dependents &&
        byteCompare(node.label, landmark.label) < 0);
    if (better) {
      landmark = { label: node.label, elevation: node.elevation, dependents: node.dependentCount };
    }
  }

  return {
    name: scene.atlas.repo.name,
    files: scene.nodes.length,
    regions,
    edges: scene.edges.length,
    landmark: landmark === null ? null : landmark.label,
  };
}

/**
 * The card's two lines.
 *
 * Templates only, and every specific string came out of the atlas. The second
 * line is dropped rather than fudged on a map with no edges of its own — a
 * Python or Rust repository before its scanner lands, where naming a "most
 * load-bearing file" would be a claim about a graph that has no arrows in it.
 */
export function arrivalLines(arrival: Arrival): readonly string[] {
  const files = `${arrival.files} ${arrival.files === 1 ? 'file' : 'files'}`;
  const regions = `${arrival.regions} ${arrival.regions === 1 ? 'region' : 'regions'}`;
  const edges = `${arrival.edges} ${arrival.edges === 1 ? 'import' : 'imports'} between them`;
  const first = arrival.edges === 0 ? `${files} · ${regions}` : `${files} · ${regions} · ${edges}`;
  if (arrival.landmark === null) return [first];
  return [first, `The most load-bearing file is ${arrival.landmark}.`];
}
