/**
 * Route D from ADR-0043's post-decision discussion: **if hover stopped showing
 * direction, would tier 2 become askable?**
 *
 * ADR-0008 decision 1 licenses the depth-1 highlight on the ground that *"those
 * edges are already drawn on the canvas"*. They are — but `draw.ts` strokes a
 * plain `moveTo`/`lineTo` with **no arrowhead**, so the canvas draws the edge
 * *set* undirected while hover reveals its *direction*. The highlight gives away
 * strictly more than the argument that licensed it.
 *
 * So: make hover highlight in- and out-neighbours together, and the hover
 * exploit that killed the Direction verb (**1.000 exact on 869 of 869 boards**)
 * collapses to the *"tick everything with a line to X"* guess, which ADR-0043 §3
 * derived an admission rule against. This measures whether that actually holds
 * on boards a real generator could ship.
 *
 * ## What it measures, and the two bounds
 *
 * A board is `{t truth, w wrong-direction, filler}` in 20 slots. The undirected
 * guess picks everything adjacent to the subject either way, so it has recall 1
 * and precision `t/(t+w)`:
 *
 *     F1 = 2t / (2t + w)     which is < 0.78 exactly when w ≥ ⌈0.564·t⌉
 *
 * `w` is a **generator choice**, so a single number here would be a claim about
 * a generator nobody has written. Two rows instead: `lean` fills exactly the
 * admission minimum (the fewest wrong-direction slots the rule allows — the
 * guess's *best* case, and the honest one to quote) and `rich` fills every
 * wrong-direction candidate available (its worst).
 *
 * ## And the second channel, which ADR-0043 does not list
 *
 * `ui.ts` prints `imports: N` and `imported by: M` for every node, ungated. Those
 * counts partially recover the direction an undirected hover would hide:
 *
 *  - a candidate with **`imported by: 0`** cannot be imported by the subject, so
 *    an adjacent one is a wrong-direction pick — drop it;
 *  - a candidate with **`imports: 0`** cannot import the subject, so an adjacent
 *    one is truth — keep it.
 *
 * The `refined` column is the undirected guess with both eliminations applied.
 * If it climbs back over the bar, route D needs the inspector changed too, and
 * "amend ADR-0008 decision 1" was never the whole of the work.
 *
 *   npx tsx scripts/probe-undirected.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph, nodeAt } from '../src/atlas/graph.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

/** ADR-0007: 20 candidates, at most ⌊(20−1)/3⌋ = 6 of them true. */
const CHOICE = 20;
const TRUTH_CAP = 6;
/** NORTH-STAR §8.2's band A, the bar every gate in this repo is measured against. */
const BAND_A = 0.78;

/** The admission rule, derived from the bar rather than chosen. */
function admissionMinimum(truth: number): number {
  return Math.ceil((2 * truth * (1 - BAND_A)) / BAND_A);
}

function f1(picked: ReadonlySet<number>, truth: ReadonlySet<number>): number {
  if (picked.size === 0 || truth.size === 0) return 0;
  let hit = 0;
  for (const ref of picked) if (truth.has(ref)) hit += 1;
  if (hit === 0) return 0;
  const precision = hit / picked.size;
  const recall = hit / truth.size;
  return (2 * precision * recall) / (precision + recall);
}

interface Row {
  readonly label: string;
  readonly boards: number;
  readonly beats: number;
  readonly mean: number;
  readonly best: number;
}

function summarise(label: string, scores: readonly number[]): Row {
  return {
    label,
    boards: scores.length,
    beats: scores.filter((score) => score >= BAND_A).length,
    mean: scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length,
    best: scores.length === 0 ? 0 : Math.max(...scores),
  };
}

console.log(
  '| repo | subjects | eligible | admitted | fill | **undirected guess** beats A | mean | best | **+ inspector counts** beats A | mean | best |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);
  const idOf = (ref: number): string => atlas.nodes[ref]?.id ?? '';

  for (const fill of ['lean', 'rich'] as const) {
    const plain: number[] = [];
    const refined: number[] = [];
    let eligible = 0;
    let admitted = 0;

    for (let subject = 0; subject < atlas.nodes.length; subject += 1) {
      const out = graph.out[subject] ?? [];
      if (out.length === 0) continue;

      // Guardrail 4 for a **direct** claim: the subject's own imports must be
      // fully understood. No closure walk — the answer is the subject's own edge
      // list, so a candidate marked "X does not import this" is decided by that
      // list and nothing else. This is not ADR-0042 §4's refused depth-0
      // relaxation, which kept a *transitive* claim and checked it shallowly.
      const node = nodeAt(graph, subject);
      if (node.unresolved.length > 0) continue;
      if (!out.every((edge) => edge.confidence === 'certain')) continue;
      eligible += 1;

      // Deterministic pools, sorted by node id — the atlas's own order.
      const imports = [...new Set(out.map((edge) => edge.to))].sort((a, b) =>
        idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0,
      );
      const truth = new Set(imports.slice(0, TRUTH_CAP));
      const importers = [...new Set((graph.in[subject] ?? []).map((edge) => edge.from))]
        .filter((ref) => !truth.has(ref) && ref !== subject)
        .sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));

      const need = admissionMinimum(truth.size);
      if (importers.length < need) continue;

      const wrongWay = importers.slice(0, fill === 'lean' ? need : Math.min(importers.length, CHOICE - truth.size));
      const adjacent = new Set([...truth, ...wrongWay]);

      // Filler: anything the subject neither imports nor is imported by. Those
      // are certified non-answers by the subject's own edge list.
      const neighbours = new Set<number>([
        subject,
        ...out.map((edge) => edge.to),
        ...(graph.in[subject] ?? []).map((edge) => edge.from),
      ]);
      const filler: number[] = [];
      for (let ref = 0; ref < atlas.nodes.length && truth.size + wrongWay.length + filler.length < CHOICE; ref += 1) {
        if (!neighbours.has(ref)) filler.push(ref);
      }
      if (truth.size + wrongWay.length + filler.length < CHOICE) continue;
      admitted += 1;

      // The guess: everything with a line to the subject, either way. Filler is
      // non-adjacent by construction, so this is exactly `adjacent`.
      plain.push(f1(adjacent, truth));

      // The same guess, refined by what `ui.ts` prints for free. Of the two
      // count fields only one is a lever: `imported by: 0` means nothing imports
      // this file, so the subject cannot either, and an adjacent one is a
      // wrong-direction pick. (`imports: 0` says an adjacent candidate *is*
      // truth, which adds nothing when the guess already keeps everything
      // adjacent — it would matter to a guess that discarded rows.)
      //
      // The refinement can only remove wrong-direction picks, never truth: a
      // file the subject imports has in-degree ≥ 1 by construction. So recall
      // stays 1 and precision can only rise — `refined ≥ plain`, always.
      const sharpened = new Set<number>();
      for (const ref of adjacent) {
        if ((graph.in[ref] ?? []).length === 0) continue;
        sharpened.add(ref);
      }
      refined.push(f1(sharpened, truth));
    }

    const a = summarise('plain', plain);
    const b = summarise('refined', refined);
    console.log(
      `| ${repo} | ${atlas.nodes.length} | ${eligible} | ${admitted} | ${fill} | ` +
        `**${a.beats}** of ${a.boards} | ${a.mean.toFixed(3)} | ${a.best.toFixed(3)} | ` +
        `**${b.beats}** of ${b.boards} | ${b.mean.toFixed(3)} | ${b.best.toFixed(3)} |`,
    );
  }
}
