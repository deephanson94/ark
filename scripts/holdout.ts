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
import { VERB_IDS, serializeAtlas, validateAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { VERBS } from '../src/verbs/index.js';
import type { HoldoutSizes } from '../src/verbs/holdout.js';
import { splitDeck, summary } from '../src/verbs/holdout.js';

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const atlas = await loadAtlas(args.target);

  const sizes: HoldoutSizes = Object.fromEntries(args.verbs.map((v) => [v, args.k]));
  const split = splitDeck(atlas, sizes, VERBS);

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
