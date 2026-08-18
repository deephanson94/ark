/**
 * How much of a board never explains itself, and which classes are silent.
 *
 * The reveal's rows are `picked ∪ truth`, so a player who answers **perfectly**
 * is told nothing at all about the candidates they correctly left alone — on a
 * twenty-candidate board with four right answers, sixteen wrong answers walk off
 * unexamined. §8.3 calls distractors *"a real subsystem, not a helper function"*
 * and ADR-0020 records a reason for every one of them; none of it is spoken
 * unless the player happens to pick the row.
 *
 * The obvious fix — a note for every candidate — runs straight into ADR-0020's
 * rule that a class is withheld **as a class**. If every other row speaks, a
 * silent row says *"I am in the withheld class"*, which is the fact being
 * withheld. The landmine for it is already written down: *"withholding a class
 * hides it only while another class is also silent"*, and it says to take the
 * count nobody was taking — **how many classes are silent, and how many rows
 * does each ship?**
 *
 * This is that count. It drives the shipped `reveal()` with `picked` = every
 * candidate, so every distractor produces a row and the answer comes from the
 * code rather than from re-reading each verb's `WITNESS` map.
 *
 *   npx tsx scripts/probe-silent.ts [repo …]
 */
import { join } from 'node:path';
import { buildGraph } from '../src/atlas/graph.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { VERBS } from '../src/verbs/index.js';
import { readWitness } from '../src/atlas/index.js';
import type { VerbId } from '../src/atlas/index.js';

const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const graph = buildGraph(atlas);
  /** (verb, strategy) → [rows, rows that speak] */
  const tally = new Map<string, { rows: number; spoken: number }>();
  let candidates = 0;
  let explained = 0;
  /** verb → note shape → strategy → rows. */
  const noteShapes = new Map<string, Map<string, Map<string, number>>>();
  /** verb → per board, how many rows and how many distinct sentences. */
  const variety = new Map<string, { rows: number; distinct: number }[]>();
  const boards = new Map<VerbId, number>();

  for (const challenge of atlas.challenges) {
    const verb = VERBS[challenge.verb as keyof typeof VERBS];
    if (verb === undefined) continue;
    boards.set(challenge.verb, (boards.get(challenge.verb) ?? 0) + 1);
    const truth = new Set(challenge.truth);
    candidates += challenge.candidates.length - truth.size;
    // Every candidate picked, so every distractor becomes a `spurious` row and
    // the reveal has to say something about each — or not.
    const grade = verb.grade(challenge, { picked: [...challenge.candidates] });
    const reveal = verb.reveal(atlas, graph, challenge, grade);
    const strategies = readWitness(challenge);
    const sentences = new Set<string>();
    let rowCount = 0;
    for (const note of reveal.notes) {
      if (!truth.has(note.id)) {
        rowCount += 1;
        sentences.add(note.note);
      }
    }
    variety.set(challenge.verb, [
      ...(variety.get(challenge.verb) ?? []),
      { rows: rowCount, distinct: sentences.size },
    ]);
    for (const note of reveal.notes) {
      if (truth.has(note.id)) continue;
      const strategy = strategies.get(note.id) ?? '(none)';
      const key = `${challenge.verb}/${strategy}`;
      const at = tally.get(key) ?? { rows: 0, spoken: 0 };
      at.rows += 1;
      if (note.witness !== null && note.witness !== '') {
        at.spoken += 1;
        explained += 1;
      }
      tally.set(key, at);
      // The shape, not the sentence: paths and hop counts vary per row and the
      // question is whether the *form* of the explanation sorts the classes.
      const shape = note.note
        // Paths and hop counts vary per row; the question is whether the *form*
        // of the explanation sorts the classes, so both are normalised away.
        .replace(/[\w.@-]*\/[\w./@-]+/g, 'X')
        .replace(/\b\d+\b/g, 'N')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const perVerb = noteShapes.get(challenge.verb) ?? new Map<string, Map<string, number>>();
      const perShape = perVerb.get(shape) ?? new Map<string, number>();
      perShape.set(strategy, (perShape.get(strategy) ?? 0) + 1);
      perVerb.set(shape, perShape);
      noteShapes.set(challenge.verb, perVerb);
    }
  }

  // **Does the note text identify the silent class on its own?** Withholding the
  // strategy label is worth nothing if the graph-derived sentence beside it is
  // unique to the class — the three-way alignment ADR-0014 decision 7 asks for,
  // run against the field that would newly appear on every row.
  console.log(`\n${repo}: note shapes, and how well each predicts a strategy`);
  for (const [verb, shapes] of [...noteShapes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const [shape, byStrategy] of [...shapes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const total = [...byStrategy.values()].reduce((n, m) => n + m, 0);
      const top = [...byStrategy].sort((a, b) => b[1] - a[1])[0];
      if (top === undefined) continue;
      const purity = ((top[1] / total) * 100).toFixed(0);
      const silent = (tally.get(`${verb}/${top[0]}`)?.spoken ?? 1) === 0;
      const flag = silent && Number(purity) >= 90 ? '   <-- names a SILENT class' : '';
      console.log(
        `  ${verb}/${shape}`.padEnd(52) +
          `${String(total).padStart(5)} rows  ${purity}% ${top[0]}${flag}`,
      );
    }
  }

  // **How much variety a row set actually carries.** A panel that appends
  // eighteen rows saying the same sentence is longer without being richer, and
  // the honest figure is distinct sentences per board rather than rows.
  console.log(`\n${repo}: distinct sentences among the rows a perfect answer newly sees`);
  for (const [verb, rows] of [...variety].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const meanRows = rows.reduce((n, r) => n + r.rows, 0) / Math.max(1, rows.length);
    const meanDistinct = rows.reduce((n, r) => n + r.distinct, 0) / Math.max(1, rows.length);
    console.log(
      `  ${verb.padEnd(14)} ${rows.length} boards · mean ${meanRows.toFixed(1)} rows, ` +
        `${meanDistinct.toFixed(1)} distinct sentences`,
    );
  }

  const share = ((explained / Math.max(1, candidates)) * 100).toFixed(1);
  console.log(
    `\n${repo}: ${candidates} wrong-answer slots across ${atlas.challenges.length} boards · ` +
      `${explained} would carry a reason (${share}%), ${candidates - explained} silent`,
  );
  for (const [key, at] of [...tally].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const state = at.spoken === at.rows ? 'spoken' : at.spoken === 0 ? 'SILENT' : 'partial';
    console.log(`  ${key.padEnd(34)} ${String(at.rows).padStart(5)} rows  ${state}`);
  }
}
