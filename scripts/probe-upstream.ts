/**
 * The second tier-2 reformulation: **"which of these does `X` depend on —
 * directly, or through a chain?"**
 *
 * Blast Radius's relation read along its other axis. NORTH-STAR §8.3 strategy 1
 * calls confusing *imports* with *is imported by* **"a real tier-2 mistake"**,
 * and this is the verb that would grade it. Reachability is unique, so
 * ADR-0043 §7's *"a DAG has many valid layerings"* objection does not apply.
 *
 * ## Why the supply story is different, and better
 *
 * ADR-0003's taint walks the **outgoing** side of every candidate, which is why
 * Blast Radius costs `rate × mean closure` and why typeorm ships 58 boards of
 * 2,248 subjects (ADR-0042). Mirror the relation and the cost mirrors with it: a
 * distractor here must be certified *not reachable from `X`*, which is a fact
 * about **`X`'s** closure, not the candidate's. One closure per board instead of
 * twenty — so this verb could have supply exactly where Blast Radius starves.
 *
 * ## The two things that could kill it
 *
 *  1. **Hover.** Hovering a candidate `Y` highlights `Y`'s importers; if the
 *     subject is among them, `X` imports `Y` and `Y` is in the key. That reads
 *     off the **direct** slice with precision 1.000 — which is Blast Radius's own
 *     situation mirrored, and survivable for the same reason: the depth-1 slice
 *     is what ADR-0008 decision 1 gives away on purpose and §8.4 measures
 *     `surprise` against. Survivable only if the key reaches past it, which is a
 *     number rather than an argument.
 *  1b. **The *other* half of decision 1, which is asymmetric between the two
 *     verbs.** An `understood` node renders its **full** radius on hover, not
 *     just depth 1. Hovering an understood candidate `Y` shows
 *     `dependents(Y, ∞)`, and `X ∈ dependents(Y, ∞)` ⟺ `X` transitively imports
 *     `Y` ⟺ **`Y` is in this key, at any depth**. Blast Radius is untouched by
 *     the same move — its key is `dependents(X)`, and an understood candidate's
 *     radius answers the *reverse* relation — so this exposure exists for this
 *     verb and not for the one already shipped. `tracedRadius` is the set of
 *     subjects whose own board was passed, so the exposure **grows as the player
 *     progresses**, which is the opposite of every other gate in this repo. The
 *     ceiling is measurable now: precision is 1.000 by construction (a distractor
 *     is unreachable from `X`, so it never lights), so the guess scores
 *     `2r/(1+r)` for `r` = the share of the key that could ever be understood,
 *     and it beats band A exactly when **r ≥ 0.639**.
 *  2. **Disclosure.** *"X depends on Y"* and *"Y is depended on by X"* are one
 *     fact. Every shipped Blast Radius reveal that names `X` in the key of a
 *     board about `Y` states an atom of `X`'s key here — ADR-0019 §7's
 *     two-projections problem, in the direction nobody looks.
 *
 *   npx tsx scripts/probe-upstream.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildGraph } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

const TRUTH_CAP = 6;
const CHOICE = 20;
const BAND_A = 0.78;

/** Everything reachable from `from` along import edges, and whether it is clean. */
function closureOf(
  graph: Graph,
  from: number,
  cleanOf: (ref: number) => boolean,
): { reached: Set<number>; clean: boolean } {
  const reached = new Set<number>();
  const queue = [from];
  let clean = cleanOf(from);
  while (queue.length > 0) {
    const at = queue.pop() as number;
    for (const edge of graph.out[at] ?? []) {
      if (edge.confidence !== 'certain') clean = false;
      if (reached.has(edge.to) || edge.to === from) continue;
      reached.add(edge.to);
      if (!cleanOf(edge.to)) clean = false;
      queue.push(edge.to);
    }
  }
  return { reached, clean };
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

console.log(
  '| repo | boards | blast deck (**not** its supply — see the comment) | depth-1 gate | end-game gate | **union gate** | **residual** | **shipped = min(residual, cap)** | fog now | fog after residual |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);

  const cleanOf = (ref: number): boolean => (atlas.nodes[ref]?.unresolved.length ?? 1) === 0;
  const idOf = (ref: number): string => atlas.nodes[ref]?.id ?? '';
  const refById = new Map(atlas.nodes.map((node, ref) => [node.id, ref]));

  // Every atom the shipped Blast Radius deck states: "member depends on subject".
  const blastBoards = atlas.challenges.filter((c) => c.verb === 'blastRadius');
  const stated = new Set<string>();
  for (const board of blastBoards) {
    for (const member of board.truth) stated.add(`${member}->${board.subject}`);
  }

  // **Blast Radius's shipped deck, and it is not the figure to compare against.**
  // ADR-0045's headline divided this verb's *uncapped supply* by that capped
  // deck, crossing the units and flattering the result by 2–4×. In like units —
  // ADR-0042 §1.1's survey, same commits — blast *supply* is 88 / 218 / 331 / 220
  // on ark / hono / kysely / graphql-js, so the honest multiples are 1.7× / 1.4× /
  // **0.99×** / 1.8×. Kysely is *less*.
  let withImports = 0;
  let cleanClosure = 0;
  let boards = 0;
  const hover: number[] = [];
  let disclosedNumer = 0;
  let disclosedDenom = 0;
  const endgame: number[] = [];
  const unionScores: number[] = [];
  const residual: number[] = [];
  const blastSubjects = new Set(blastBoards.map((board) => board.subject));
  // Coverage, which is what made Companion worth building: `progress.ts` promotes
  // a node only as a passed subject or as a correctly picked key member, so a
  // node in neither position is permanently fogged. A verb that only re-covers
  // what the deck already reaches is a second question about the same files.
  const provedByDeck = new Set<string>();
  for (const board of atlas.challenges) {
    provedByDeck.add(board.subject);
    for (const member of board.truth) provedByDeck.add(member);
  }
  const provedByUpstream = new Set<string>();

  for (let subject = 0; subject < atlas.nodes.length; subject += 1) {
    if ((graph.out[subject] ?? []).length === 0) continue;
    withImports += 1;

    const { reached, clean } = closureOf(graph, subject, cleanOf);
    if (!clean || reached.size === 0) continue;
    cleanClosure += 1;

    // Deterministic sample, by node id — the atlas's own order.
    const key = [...reached].sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0)).slice(0, TRUTH_CAP);
    const truth = new Set(key);

    // Distractors: anything the subject cannot reach. Certified by the subject's
    // own closure, which is the whole supply argument.
    const filler: number[] = [];
    for (let ref = 0; ref < atlas.nodes.length && truth.size + filler.length < CHOICE; ref += 1) {
      if (ref === subject || reached.has(ref)) continue;
      filler.push(ref);
    }
    if (truth.size + filler.length < CHOICE) continue;
    boards += 1;

    // The hover guess: every candidate the subject imports **directly**.
    const direct = new Set<number>();
    for (const edge of graph.out[subject] ?? []) if (truth.has(edge.to)) direct.add(edge.to);
    hover.push(f1(direct, truth));

    // The end-game ceiling: every key member that carries a Blast Radius board
    // could one day be `understood`, and an understood candidate's full radius
    // names it outright. Precision is 1.000 — no distractor is reachable from
    // the subject, so none ever lights — so the score is `2r/(1+r)`.
    const reachable = key.filter((ref) => blastSubjects.has(idOf(ref))).length;
    const share = key.length === 0 ? 0 : reachable / key.length;
    endgame.push(share === 0 ? 0 : (2 * share) / (1 + share));

    // **The union is the guess a player actually runs**, and scoring the two
    // channels separately is not the same thing: at end-game they hold both at
    // once — hover an unproven candidate for the direct slice, an understood one
    // for the deep slice. Precision stays 1.000 either way, so the union's recall
    // is what decides. Two independent gates leave boards the union beats.
    const union = new Set<number>(direct);
    for (const ref of key) if (blastSubjects.has(idOf(ref))) union.add(ref);
    const unionShare = key.length === 0 ? 0 : union.size / key.length;
    const unionScore = unionShare === 0 ? 0 : (2 * unionShare) / (1 + unionShare);
    unionScores.push(unionScore);
    if (unionScore < BAND_A) {
      residual.push(subject);
      provedByUpstream.add(idOf(subject));
      for (const member of key) provedByUpstream.add(idOf(member));
    }

    // How much of this key has some shipped Blast Radius reveal already said?
    for (const member of key) {
      disclosedDenom += 1;
      if (stated.has(`${idOf(subject)}->${idOf(member)}`)) disclosedNumer += 1;
    }
  }

  const mean = (list: readonly number[]): number =>
    list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length;
  const beats = hover.filter((score) => score >= BAND_A).length;
  const endBeats = endgame.filter((score) => score >= BAND_A).length;
  const fogged = atlas.nodes.filter((node) => !provedByDeck.has(node.id)).length;
  const foggedAfter = atlas.nodes.filter(
    (node) => !provedByDeck.has(node.id) && !provedByUpstream.has(node.id),
  ).length;
  const unionBeats = unionScores.filter((score) => score >= BAND_A).length;
  const cap = Math.max(40, Math.ceil(atlas.nodes.length / 8));
  console.log(
    `| ${repo} | ${boards} | ${blastBoards.length} | ` +
      `${beats} | ${endBeats} | **${unionBeats}** | **${residual.length}** | ` +
      `**${Math.min(residual.length, cap)}** | ${fogged} | **${foggedAfter}** |`,
  );
  void refById;
  void mean;
}
