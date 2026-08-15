/**
 * Label placement.
 *
 * A map where every label is drawn is a map where none of them can be read. The
 * rule here is: rank labels by how much they are worth, then place greedily,
 * skipping any that would overlap something already placed.
 *
 * Worth is the node's in-degree — how many files depend on it. That is not an
 * aesthetic choice: pillar 3 says the skill being taught is predicting change
 * propagation, so the hubs are the names worth knowing, and they are the ones
 * that survive when space runs out.
 *
 * Pure. Text measurement comes in as a function, so this is testable without a
 * canvas.
 */

export interface LabelCandidate {
  readonly text: string;
  /** Screen position of the thing being labelled. */
  readonly x: number;
  readonly y: number;
  /** Vertical offset from the anchor, usually the node radius. */
  readonly offset: number;
  /** Higher wins the space. */
  readonly priority: number;
  /**
   * The node this label names, when it names one.
   *
   * Carried through to `PlacedLabel` so the shell can make the **text** a hit
   * target for its own node. A label is anchored directly under its disc and is
   * either placed there or skipped — it never drifts — but on a crowded map the
   * text still lies across *other* discs, so pointing at a name picked whatever
   * was underneath it. A cold playtester read that as the map naming the wrong
   * object, and it is the reason they answered every board off the text list
   * instead of the map.
   *
   * Absent for a region label, which names a cluster rather than a node.
   */
  readonly ref?: number;
}

/** A screen rectangle a label may not overlap. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedLabel extends Box {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** @see LabelCandidate.ref */
  readonly ref?: number;
}

export type Measure = (text: string) => number;

export interface PlaceOptions {
  readonly lineHeight: number;
  readonly padding: number;
  /** Stop after this many placements. */
  readonly budget: number;
  /** Skip candidates outside this screen rectangle. */
  readonly width: number;
  readonly height: number;
  /**
   * Rectangles this pass must avoid and never returns: labels an earlier pass
   * committed, **and the DOM chrome standing over the canvas**.
   *
   * The second was missing until now, and the symptom was the whole bug: the
   * HUD, the inspector and the legend are panels *on top of* the canvas, so a
   * label placed underneath one is not a label — it is a slot spent on nothing,
   * out of a budget of about 35. Feeding their rects in here costs one line at
   * the call site and hands the slot to a name the player can actually read.
   */
  readonly occupied?: readonly Box[];
  /**
   * Where a label may sit relative to its anchor, tried in this order.
   *
   * **Dodging is why street zoom has names.** With `below` alone a label is
   * either in its one slot or gone, and at street zoom this repo's discs
   * overlap 30–60%, so the slots overlap too: 68 nodes on screen produced 10
   * names, and the largest disc in the frame — a sixth of the viewport — had
   * none. A reader who zooms in is asking what these things are, and the map
   * was answering with mute circles.
   *
   * `below` stays first so every label that could already be placed is placed
   * in the same spot as before; the alternatives only catch what would
   * otherwise have been dropped. `right` before `left` is the cartographic
   * convention, and both hug the disc — a name that drifts is a name that
   * looks like it belongs to a neighbour.
   */
  readonly anchors?: readonly Anchor[];
}

export type Anchor = 'below' | 'right' | 'left' | 'above';

const DEFAULT_ANCHORS: readonly Anchor[] = ['below'];

/**
 * Where the text's centre goes for one anchor.
 *
 * `offset` is the anchored thing's radius, so it serves as both the vertical
 * clearance under a disc and the horizontal clearance beside one.
 */
function placeAt(
  anchor: Anchor,
  candidate: LabelCandidate,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (anchor) {
    case 'below':
      return { x: candidate.x, y: candidate.y + candidate.offset + height };
    case 'right':
      return { x: candidate.x + candidate.offset + width / 2, y: candidate.y + height / 2 };
    case 'left':
      return { x: candidate.x - candidate.offset - width / 2, y: candidate.y + height / 2 };
    case 'above':
      return { x: candidate.x, y: candidate.y - candidate.offset };
  }
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

export function placeLabels(
  candidates: readonly LabelCandidate[],
  measure: Measure,
  options: PlaceOptions,
): readonly PlacedLabel[] {
  if (options.budget <= 0) return [];

  // Sort by priority, then by text so that equal-priority ties resolve the same
  // way every frame — a label that flickers in and out as you pan is worse than
  // no label.
  const ranked = [...candidates].sort(
    (a, b) => b.priority - a.priority || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );

  // Region labels are placed first and node labels must not overwrite them —
  // two passes that each avoid collisions internally still collide with each
  // other, which is what put `a22.js` through the middle of a region name on
  // vite. The chrome joins them for the same reason.
  //
  // Two lists rather than one with a `reserved` offset: the blockers are `Box`,
  // the results are `PlacedLabel`, and slicing a mixed array back apart was one
  // arithmetic slip away from returning a panel as a label.
  const blockers: Box[] = [...(options.occupied ?? [])];
  const placed: PlacedLabel[] = [];
  const anchors = options.anchors ?? DEFAULT_ANCHORS;
  for (const candidate of ranked) {
    if (placed.length >= options.budget) break;

    const width = measure(candidate.text) + options.padding * 2;
    const height = options.lineHeight;
    for (const anchor of anchors) {
      const { x, y } = placeAt(anchor, candidate, width, height);
      const box: PlacedLabel = {
        text: candidate.text,
        ...(candidate.ref === undefined ? {} : { ref: candidate.ref }),
        x,
        y,
        left: x - width / 2,
        top: y - height,
        width,
        height,
      };

      // **Wholly inside, not merely touching.** This admitted any box that
      // *intersected* the viewport, so a name anchored near an edge drew with
      // its tail cut off — one street-zoom frame of this repo showed
      // `disclosure` sheared at the right edge and two region names surviving
      // as `ots` and `les` at the left. A half-name is worse than no name twice
      // over: it reads as a rendering fault, and the fragment that survives is
      // the *end* of the string, which is the half that identifies nothing.
      //
      // It costs no labels. `continue` does not spend budget, so the slot
      // passes to the next candidate and the frame draws the same count, all
      // readable.
      if (box.left < 0 || box.left + box.width > options.width) continue;
      if (box.top < 0 || box.top + box.height > options.height) continue;
      if (blockers.some((other) => overlaps(box, other))) continue;

      blockers.push(box);
      placed.push(box);
      break;
    }
  }
  return placed;
}
