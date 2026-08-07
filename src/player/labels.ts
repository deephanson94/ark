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
}

export interface PlacedLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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
}

function overlaps(a: PlacedLabel, b: PlacedLabel): boolean {
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

  const placed: PlacedLabel[] = [];
  for (const candidate of ranked) {
    if (placed.length >= options.budget) break;

    const width = measure(candidate.text) + options.padding * 2;
    const height = options.lineHeight;
    const x = candidate.x;
    const y = candidate.y + candidate.offset + height;
    const box: PlacedLabel = {
      text: candidate.text,
      x,
      y,
      left: x - width / 2,
      top: y - height,
      width,
      height,
    };

    if (box.left + box.width < 0 || box.left > options.width) continue;
    if (box.top + box.height < 0 || box.top > options.height) continue;
    if (placed.some((other) => overlaps(box, other))) continue;

    placed.push(box);
  }
  return placed;
}
