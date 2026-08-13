/**
 * `npm run holdout` — cut a repo's deck into the atlas the arms play and the
 * quiz they are scored on. `docs/experiments/0001` §9's first piece of harness.
 *
 *   npm run holdout -- <repo> --out <dir> [-k 6] [--verbs blastRadius,companion]
 *
 * Writes `<dir>/atlas.json` (the played atlas, schema-valid) and `<dir>/quiz.json`
 * (the held-out boards plus the split's own report). The played atlas is what a
 * participant is served; the quiz is administered on paper one day later and
 * scored with the same `scoreSet` the product grades by, so a quiz score and a
 * played board's score are the same number in the same units.
 *
 * The shell. `src/verbs/holdout.ts` is the pure part and is where the reasoning
 * lives — in particular why this prints **two kinds of zero** and refuses to add
 * them together.
 *
 * ## What this prints that a reader must not misread
 *
 * On a healthy atlas the disclosure check refuses **nothing**, and that is the
 * result this script is most likely to be believed about wrongly. `unchecked`
 * and `0 refused` are different sentences:
 *
 *   unchecked   the verb's answer key cannot be expressed as a disclosed fact at
 *               all, so the check did not run. Blast Radius and Companion, which
 *               are §4.4's entire discriminating tier.
 *   0 refused   the check ran and found nothing — a measurement, and on the
 *               history verbs a real one, because ADR-0019 decision 7 excluded
 *               the overlap at generation time and this proves the exclusion
 *               survives an arbitrary subset of the deck.
 *
 * `--verify` re-runs the check against the written artifacts and exits non-zero
 * if the played atlas fails validation or the quiz is short. Use it in anger:
 * a split that quietly shipped five items where six were asked for is an
 * instrument nobody can compare across arms.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import type { Atlas, VerbId } from '../src/atlas/index.js';
import { VERB_IDS, buildGraph, serializeAtlas, validateAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { CTRL_F_THRESHOLD, VERBS, scoreSet } from '../src/verbs/index.js';
import type { HoldoutBar, HoldoutSizes } from '../src/verbs/holdout.js';
import { splitDeck, summary } from '../src/verbs/holdout.js';
import { findTwins } from '../src/player/twins.js';

/**
 * §4.4's quiz: six Blast Radius boards and six Companion boards.
 *
 * The two verbs of tier 3, which is the tier that discriminates. Orientation and
 * topology items are asked from the atlas rather than from the deck, so nothing
 * is held out for them.
 */
const DEFAULT_VERBS: readonly VerbId[] = ['blastRadius', 'companion'];
const DEFAULT_K = 6;

interface Args {
  readonly target: string;
  readonly out: string;
  readonly k: number;
  readonly verbs: readonly VerbId[];
  readonly verify: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let target = '';
  let out = '';
  let k = DEFAULT_K;
  let verbs = DEFAULT_VERBS;
  let verify = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') out = argv[++i] ?? '';
    else if (arg === '-k' || arg === '--count') k = Number(argv[++i] ?? DEFAULT_K);
    else if (arg === '--verify') verify = true;
    else if (arg === '--verbs') {
      const list = (argv[++i] ?? '').split(',').filter((s) => s.length > 0);
      const unknown = list.filter((v) => !(VERB_IDS as readonly string[]).includes(v));
      if (unknown.length > 0) fail(`unknown verb(s): ${unknown.join(', ')}`);
      verbs = list as VerbId[];
    } else if (arg !== undefined && !arg.startsWith('-')) target = arg;
  }
  if (target === '') fail('usage: holdout <repo-or-atlas.json> --out <dir> [-k 6] [--verbs a,b]');
  if (out === '') fail('--out <dir> is required');
  if (!Number.isInteger(k) || k <= 0) fail(`-k must be a positive integer, got ${String(k)}`);
  return { target, out, k, verbs, verify };
}

function fail(message: string): never {
  process.stderr.write(`holdout: ${message}\n`);
  process.exit(2);
}

/**
 * A built atlas, from either an atlas file or a repo path.
 *
 * Taking a repo path matters more than it looks: the split has to run on the
 * *exact* artifact the arms play, and `test:determinism` is the assertion that
 * indexing a named commit twice produces the same bytes. Indexing here rather
 * than trusting a file somebody left lying around is what makes the two rounds
 * of §4.2 provably the same instrument.
 */
async function loadAtlas(target: string): Promise<Atlas> {
  if (target.endsWith('.json')) {
    return validateAtlas(JSON.parse(await readFile(target, 'utf8')));
  }
  return buildAtlas(indexOptions(target));
}

/**
 * A board may not be held out if removing it would let the twin surface name its
 * own answer key.
 *
 * `main.ts` gates ADR-0030's class on *"no member still carries an **unanswered**
 * Blast Radius board"*, and asks it as `challengesById.get(id) ?? []`. A held-out
 * board is not unanswered — it is **absent** — so the bucket is empty, the guard
 * passes vacuously, and the inspector volunteers `cone(S) = cone(T)` for a
 * subject the participant is about to be quizzed on. With ADR-0008's invariant
 * that is the key byte-exact: **4 of kysely's 6 held-out Blast Radius boards at
 * F1 1.000**, 3 of graphql-js's 6.
 *
 * So the bar is *"the subject shares a cone with anything else"*, which is
 * deliberately blunter than the gate it protects. The precise rule — bar only
 * when a sibling still carries a **served** board — depends on what else was held
 * out, which would put it inside the fixpoint; and at quiz time the participant
 * has cleared the served deck, so every sibling's board is answered and the gate
 * is open regardless of which of them were removed. The blunt rule and the
 * precise one agree on the state the quiz is actually taken in.
 *
 * `findTwins` is the player's own, imported rather than reimplemented: two
 * definitions of *twin* is the failure this repo has a landmine about, and the
 * one that matters is the one the inspector uses.
 */
function twinBar(atlas: Atlas): HoldoutBar {
  const graph = buildGraph(atlas);
  const twins = findTwins(graph, atlas.nodes.map((n) => n.id));
  return (challenge) => {
    // Only Blast Radius keys are reconstructible from a shared cone. A commit
    // subject has no cone at all, and `refById` would not resolve it.
    if (challenge.verb !== 'blastRadius') return null;
    const ref = graph.refById.get(challenge.subject);
    if (ref === undefined) return null;
    const index = twins.classOf.get(ref);
    if (index === undefined) return null;
    const size = twins.classes[index]?.members.length ?? 0;
    return `twin class of ${String(size)} — removing this board opens ADR-0030's gate on its own key`;
  };
}

/**
 * A board the map already answers is not a quiz item.
 *
 * Hovering a node paints its **direct importers** in gold — ADR-0008 decision 1,
 * available to everyone, gated by nothing, in every arm. On the boards where the
 * answer key is mostly direct importers that guess is not a hint, it is the
 * answer: measured on hono, ticking exactly what the hover paints beats band A on
 * **17 of 54** Blast Radius boards (31.5%), and on the easy end it is close to
 * total — mean F1 **0.890** for difficulty ≤ 0.50 against **0.095** for ≥ 0.80,
 * Spearman ρ = **−0.826**.
 *
 * The product ships those boards deliberately: `gate.ts` declines to refuse the
 * guess because §8.4 already prices it and the progression needs easy rungs. A
 * quiz is not a progression. An item every arm can answer by pointing measures
 * nothing about the arms and spends one of six slots, so it is barred here even
 * though it is a perfectly good board to *play*.
 *
 * **This is a bar and not a change to `preferenceOrder`, and the difference is
 * the point.** Ranking the quiz by descending difficulty would also close the
 * channel — the same measurement shows top-6-by-difficulty taking it to 0 of 6 —
 * but it does so by taking one end of the range, and §6 names a floor and a
 * ceiling as the same instrument failure wearing opposite signs. Barring the
 * decided boards removes exactly the items that are compromised and leaves the
 * spread intact.
 *
 * Uses the product's own bar (`CTRL_F_THRESHOLD`, band A) and the product's own
 * metric (`scoreSet`), because ADR-0020's landmine is that an exposure reported
 * in units the product does not grade in cannot be compared to any threshold.
 */
function naiveBar(atlas: Atlas): HoldoutBar {
  const graph = buildGraph(atlas);
  return (challenge) => {
    if (challenge.verb !== 'blastRadius') return null;
    const ref = graph.refById.get(challenge.subject);
    if (ref === undefined) return null;
    // The direct importers of the subject, restricted to the choice set — which
    // is what a player can actually tick.
    const candidates = new Set(challenge.candidates);
    const painted: string[] = [];
    for (const edge of graph.in[ref] ?? []) {
      const id = atlas.nodes[edge.from]?.id;
      if (id !== undefined && candidates.has(id)) painted.push(id);
    }
    if (painted.length === 0) return null;
    const score = scoreSet(painted, challenge.truth).score;
    if (score < CTRL_F_THRESHOLD) return null;
    return `the map's hover paint scores ${score.toFixed(3)} on this key, at or above band A`;
  };
}

/**
 * A Companion board whose key a served **Placement** reveal already assembles.
 *
 * The third channel, and the one that reaches the quiz's *other* verb. A
 * Placement reveal names the files a commit touched, so any two of them are
 * co-commit partners — and "changed in the same commit" is the relation Companion
 * grades, arrived at without touching the co-change matrix. Ticking the
 * candidates that share a served reveal's commit with the subject beats band A on
 * **1 of 6** held-out boards on ark (best F1 0.800) and on **1 of 6** on kysely
 * (best **0.909**), which is one of the two repos the experiment is run on. On
 * graphql-js and hono it does not fire (best 0.500 and 0.286).
 *
 * Note what this is *not*: it is not `discloses` failing. `placement.discloses`
 * declares these atoms honestly and the accumulator holds them — but they are
 * `touched` facts about a **commit**, and a Companion key is a relation between
 * files, so `keyFacts` cannot see the connection. Decision 1's blindness is not
 * merely a missing string; it hides a channel that fires.
 *
 * Built from the **whole** deck rather than the served remainder, deliberately:
 * holding a Placement board out only removes reveals, so the full deck is the
 * conservative superset and the bar cannot become weaker because of what else was
 * removed. That also keeps it outside the fixpoint.
 */
function coCommitBar(atlas: Atlas): HoldoutBar {
  const partners = new Map<string, Set<string>>();
  for (const challenge of atlas.challenges) {
    if (challenge.verb !== 'placement') continue;
    for (const a of challenge.truth) {
      let bucket = partners.get(a);
      if (bucket === undefined) {
        bucket = new Set();
        partners.set(a, bucket);
      }
      for (const b of challenge.truth) if (a !== b) bucket.add(b);
    }
  }
  return (challenge) => {
    if (challenge.verb !== 'companion') return null;
    const shared = partners.get(challenge.subject);
    if (shared === undefined) return null;
    const picked = challenge.candidates.filter((id) => shared.has(id));
    if (picked.length === 0) return null;
    const score = scoreSet(picked, challenge.truth).score;
    if (score < CTRL_F_THRESHOLD) return null;
    return `a served Placement reveal's co-commit set scores ${score.toFixed(3)} on this key`;
  };
}

/** Every bar, first reason wins. */
function barsFor(atlas: Atlas): HoldoutBar {
  const bars = [twinBar(atlas), naiveBar(atlas), coCommitBar(atlas)];
  return (challenge) => {
    for (const bar of bars) {
      const reason = bar(challenge);
      if (reason !== null) return reason;
    }
    return null;
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const atlas = await loadAtlas(args.target);

  const sizes: HoldoutSizes = Object.fromEntries(args.verbs.map((v) => [v, args.k]));
  const split = splitDeck(atlas, sizes, VERBS, barsFor(atlas));

  // The played atlas must be a *valid* atlas, not merely a smaller object.
  // Removing challenges preserves the id sort and every referential check, but
  // asserting it is the difference between believing that and knowing it — and
  // this is the artifact twelve people are served.
  const played = validateAtlas(split.played);

  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'atlas.json'), serializeAtlas(played));
  await writeFile(
    join(args.out, 'quiz.json'),
    `${JSON.stringify(
      {
        repo: { name: atlas.repo.name, head: atlas.repo.head, headDate: atlas.repo.headDate },
        // Named so a quiz artifact can be checked against the atlas it was cut
        // from. §4.2's two rounds are weeks apart and must play one instrument.
        playedChallenges: played.challenges.length,
        report: split.report,
        items: split.quiz,
      },
      null,
      2,
    )}\n`,
  );

  const out = process.stdout;
  out.write(`${atlas.repo.name} @ ${atlas.repo.head}  (${atlas.repo.headDate})\n`);
  out.write(`deck ${atlas.challenges.length} → played ${played.challenges.length}`);
  out.write(` + quiz ${split.quiz.length}\n\n`);
  for (const line of summary(split.report)) out.write(`  ${line}\n`);

  const short = split.report.perVerb.filter((v) => v.shortfall > 0);
  const blind = split.report.perVerb.filter((v) => !v.expressible);
  if (blind.length > 0) {
    out.write(
      `\n  NOTE: the disclosure check is structurally blind on ` +
        `${blind.map((v) => v.verb).join(', ')} — their answer keys are relations\n` +
        `  between files and every disclosable fact names a commit. Read those rows as\n` +
        `  "not checked", never as "clean". The mutual-membership column is the channel\n` +
        `  that can fire on them, and it is reported rather than refused on.\n`,
    );
  }
  if (split.report.exhausted) fail('the swap loop did not settle — inspect report.refused');
  if (short.length > 0) {
    fail(
      `short quiz: ${short.map((v) => `${v.verb} by ${String(v.shortfall)}`).join(', ')} — ` +
        'the arms would be scored on different numbers of items',
    );
  }
  if (args.verify) {
    const rewritten = validateAtlas(JSON.parse(await readFile(join(args.out, 'atlas.json'), 'utf8')));
    if (rewritten.challenges.length !== played.challenges.length) {
      fail('the written atlas does not round-trip');
    }
    out.write('\n  verified: played atlas round-trips and validates\n');
  }
}

void main();
