/**
 * `npm run check:keys` — **does any board mark a real dependent as a wrong answer?**
 *
 * ADR-0008's invariant is `candidates ∩ dependents(subject, ∞) = truth`. Everything that enforces
 * it — the generator, the validator, `tests/atlas/` — reads the **atlas**, and ADR-0026 §4.1 is the
 * finding that an atlas-derived check *structurally cannot see a missing edge*: three such checks
 * were run on M5's Go work and all three were vacuous, while the one that read the repository's
 * **source** found two wrong answer keys. This is that instrument, kept.
 *
 * So the only atlas input is the board itself — subject, candidates, truth — and each node's path.
 * Everything else is the file text and the filesystem, read with this file's own regex lexer rather
 * than `scan.ts`, because ADR-0028 §8.1's defect survived two instruments that shared one blindness.
 *
 * ## It gates itself, every run
 *
 * A zero here is worthless unless the detector can be shown to fire, so **the plant runs first**:
 * one member of each board's answer key is moved into the distractor set, and the check fails if
 * that catches nothing. This is not belt-and-braces — the narrow version of this probe reported a
 * clean `0` on rxjs and nest while being blind to 63% of their dependency relation, and only the
 * plant's *rate* exposed it.
 *
 * ## What it does not see, stated so the zero is not over-read
 *
 * - **Transitive-only dependents.** It matches a specifier naming the subject's own path, so it
 *   detects direct importers. The answer key is the unbounded dependent set, and the share of key
 *   members that are direct runs from 12% (hugo) to 74% (webpack).
 * - **tsconfig `paths` aliases and `baseUrl`.** Relative and workspace specifiers only.
 *
 * It is therefore a **regression detector on the classes it covers**, not a proof of the invariant.
 * Both are worth having; only one of them is what the exit code means.
 *
 *   npm run check:keys            # this repo
 *   npm run check:keys -- <path>  # any repo
 */
import process from 'node:process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scanBoards } from './probe-wrongkey.js';

const root = process.argv[2] ?? '.';

const { atlas } = await buildIndex(indexOptions(root));

const planted = scanBoards(root, atlas, true);
if (planted.hits.length === 0) {
  console.error(
    `check:keys: FAIL — the plant caught nothing across ${planted.boards} board(s). The detector is ` +
      'inert, so a clean run would mean nothing. This is the gate, not the check.',
  );
  process.exit(1);
}

const real = scanBoards(root, atlas, false);
const rate = planted.boards === 0 ? 0 : (planted.byBoard / planted.boards) * 100;
console.log(
  `check:keys: gate ok — the plant was caught on ${planted.byBoard} of ${planted.boards} board(s) ` +
    `(${rate.toFixed(0)}%; the rest are transitive-only, which this instrument does not see)`,
);

if (real.hits.length > 0) {
  console.error(
    `check:keys: FAIL — ${real.hits.length} candidate(s) marked as a wrong answer import the subject:`,
  );
  for (const hit of real.hits.slice(0, 20)) {
    console.error(`  ${hit.board}\n    ${hit.candidate} imports '${hit.specifier}' → ${hit.subject}  (${hit.line})`);
  }
  process.exit(1);
}

console.log(
  `check:keys: ok — ${real.slots} wrong-answer slot(s) across ${real.boards} board(s), none of which ` +
    'names its subject',
);
