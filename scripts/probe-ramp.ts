/**
 * How far apart the three fog states actually are, in the eye rather than in HSL.
 *
 * `fog.ts` names three states — silhouette, surveyed, understood — and until
 * ADR-0048 the map drew **two**: the top two shared a fill and were separated by
 * a stroke width of 2.5px against 1.4px. So the whole core loop's reward was one
 * pixel, which is why a cold playtester could not say what passing a board had
 * changed.
 *
 * Three HSL lightness numbers that look evenly spaced are not evidence — HSL
 * lightness is not perceptual, and the fills sit on a near-black ground where
 * the bottom of the range is compressed. This prints the WCAG relative-luminance
 * contrast of each state against the ground and against the state below it,
 * which is the number the claim in `palette.ts` is made of.
 *
 *   npx tsx scripts/probe-ramp.ts
 */
import { INK, regionKnown, regionSilhouette, regionWash } from '../src/player/palette.js';

/** `hsla(h, s%, l%, a)` → sRGB 0..1, enough for the strings this palette emits. */
function rgbOf(color: string): [number, number, number] {
  const hsl = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(color);
  if (hsl !== null) {
    const h = Number(hsl[1]) / 360;
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t: number): number => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex === null) throw new Error(`probe-ramp cannot read ${color}`);
  const n = Number.parseInt(hex[1] ?? '0', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** WCAG relative luminance. */
function luminance(color: string): number {
  const [r, g, b] = rgbOf(color).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Region 0's hue. The ramp is a lightness ramp, so the hue only shifts every row
// by the same factor and the *ratios between rows* — the thing being claimed —
// are what this reports.
const states = [
  ['silhouette', regionSilhouette(0, 1)],
  ['surveyed', regionWash(0, 1)],
  ['understood', regionKnown(0, 1)],
] as const;

let previous: string | null = null;
for (const [name, color] of states) {
  const vsGround = contrast(color, INK.ground);
  const vsBelow = previous === null ? null : contrast(color, previous);
  console.log(
    `${name.padEnd(12)} ${color.padEnd(28)} ` +
      `vs ground ${vsGround.toFixed(2)}:1` +
      (vsBelow === null ? '' : ` · vs the state below ${vsBelow.toFixed(2)}:1`),
  );
  previous = color;
}
