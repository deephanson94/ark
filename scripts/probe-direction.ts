/**
 * Bounding a tier-2 **Direction** verb before building it — *"which of these does `X` import?"*
 *
 * NORTH-STAR §5's tier 2 is Topology: *"which way do dependencies point? what's a hub, what's a
 * leaf?"*, and the deck has **no tier-1 or tier-2 content at all** (`README.md`, Known gaps). Every
 * board is a transitive-closure question, so a new player's first question is a hard one.
 *
 * Two things decide whether this verb is worth writing, and ADR-0042's lesson is to measure both
 * before writing any of it.
 *
 * ## 1. Supply — and the reason to expect it where Blast Radius has none
 *
 * Blast Radius's truth is **transitive**, so guardrail 4 has to walk the candidate's whole
 * dependency closure: one unresolved import anywhere in it refuses the board, which is why typeorm
 * ships 58 boards of 2,248 subjects. This verb's truth is **direct** — the answer is exactly the
 * subject's own import list — so a candidate marked *"X does not import this"* is decided by X's
 * own edges and nothing else. The check is therefore *the subject has no unresolved import and no
 * `probable` outgoing edge*, at depth 0.
 *
 * That is not the depth-0 relaxation ADR-0042 §4 **refused**. That one kept a transitive claim and
 * checked it shallowly, which is unsound and shipped wrong keys. This is a shallow claim checked
 * shallowly, which is exactly sound.
 *
 * ## 2. Is it `Ctrl+F`-able? (pillar 3)
 *
 * The map draws edges as **undirected** lines, so *"pick every candidate with a line to X"* is a
 * guess available to anyone looking at the screen. It scores 1.000 unless the choice set contains
 * candidates adjacent to X in the **wrong direction** — X's own importers. So this counts how many
 * importers each subject has available as distractors; a subject with none cannot carry an honest
 * board of this verb.
 *
 * ## The verdict this probe did not reach, and the one that killed the verb
 *
 * Both numbers below came out well — supply is enormous where Blast Radius starves, and the
 * screen-readable *line* guess is beatable by an admission rule derived from the pass threshold. The
 * verb was refused anyway, by a third question this file never asks: **hover**.
 *
 * `main.ts:502`'s `depthFor` gives an un-understood node `DIRECT_ONLY`, and `scene.ts:282`'s
 * `blastRadius()` returns **dependents** — so hovering a candidate `Y` highlights the files that
 * import `Y`. Tick `Y` when the subject lights up, and you have the answer key exactly, without
 * knowing anything. Measured on real generated boards: **1.000 exact on 647 of 647** across eight
 * repos. See ADR-0043.
 *
 * The lesson for the next probe of this shape is the one `CLAUDE.md` already carries: *a claim about
 * what the player can do is not checkable in the verb — go and read the player.* This file bounded
 * the question against the **atlas** and the **map's lines**, and the thing that decided it was a
 * hover handler.
 *
 *   npx tsx scripts/probe-direction.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, nodeAt } from '../src/atlas/graph.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

/** ADR-0007's shape: 20 candidates, at most ⌊(20−1)/3⌋ = 6 of them true. */
const TRUTH_CAP = 6;

console.log(
  '| repo | nodes | with ≥1 import | **own imports clean** | ≥1 importer | buildable | **survives the gate** | blast today |',
);
console.log('|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas, generation } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);

  let withImports = 0;
  let eligible = 0;
  let withCounterExample = 0;
  let honest = 0;
  let admitted = 0;
  const guessScores: number[] = [];

  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const out = graph.out[ref] ?? [];
    if (out.length === 0) continue;
    withImports += 1;

    // Guardrail 4 for a **direct** claim: the subject's own imports must be fully understood.
    const node = nodeAt(graph, ref);
    const clean = node.unresolved.length === 0 && out.every((edge) => edge.confidence === 'certain');
    if (!clean) continue;
    eligible += 1;

    const deps = new Set(out.map((edge) => edge.to));
    const importers = (graph.in[ref] ?? []).map((edge) => edge.from).filter((r) => !deps.has(r));
    if (importers.length === 0) continue;
    withCounterExample += 1;

    // A board ships when there is a truth set and enough wrong answers, at least one of which is
    // adjacent in the wrong direction — otherwise "pick everything with a line to X" wins outright.
    const truth = Math.min(deps.size, TRUTH_CAP);
    const distractorsNeeded = truth * 3;
    const available = atlas.nodes.length - deps.size - 1;
    if (available < distractorsNeeded) continue;
    honest += 1;

    // The screen-readable guess, scored on the board this verb would ship: every candidate with a
    // line to X. It picks the whole truth set (recall 1) plus every importer in the choice set, so
    //
    //     F1 = 2t / (2t + w)     for t truth members and w wrong-direction picks
    //
    // and it falls under band A exactly when `w > 2t(1 − 0.78)/0.78`, i.e. **w ≥ ⌈0.564·t⌉**. That
    // is the admission rule: a subject with too few importers to fill that many slots cannot carry
    // an honest board of this verb, because the answer is readable off the lines on the map.
    const wrongWay = Math.min(importers.length, distractorsNeeded);
    const picked = truth + wrongWay;
    const precision = picked === 0 ? 0 : truth / picked;
    const score = precision === 0 ? 0 : (2 * precision * 1) / (precision + 1);
    guessScores.push(score);
    if (score < 0.78) admitted += 1;
  }

  const blast = generation?.blastRadius.report.generated ?? 0;
  const beatsBar = guessScores.filter((score) => score >= 0.78).length;
  console.log(
    `| ${repo} | ${atlas.nodes.length} | ${withImports} | **${eligible}** | ${withCounterExample} | ${honest} | **${admitted}** | ${blast} |`,
  );
  if (guessScores.length > 0) {
    const mean = guessScores.reduce((a, b) => a + b, 0) / guessScores.length;
    console.log(
      `|   ↳ screen-readable guess | mean F1 **${mean.toFixed(3)}** | beats band A (≥0.78) on **${beatsBar}** of ${guessScores.length} | | | | |`,
    );
  }
}
