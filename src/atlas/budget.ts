/**
 * The one budget the CLI is in a position to state, and the three it is not.
 *
 * The ceilings live in `CLAUDE.md` and are enforced by `scripts/budget.ts`, which `src/` cannot
 * import — so the CLI printed the measurements they are about **naked**: `atlas 9399.5 KiB in 56400
 * ms`, with nothing saying what either number is allowed to be. A user of the packaged CLI has the
 * figure and no verdict, and `npm run budget` is a repo script they do not have.
 *
 * ## What this reports, and what three reviewers took out of it
 *
 * Only one thing: **the atlas is larger than the 5 MiB `CLAUDE.md` quotes.** That is worth saying
 * because *the player loads the whole atlas in one request*, so the total is a first-paint fact
 * whatever the file count. It is a pure function of bytes, so it is deterministic.
 *
 * Three richer versions were built and measured, and each was withdrawn:
 *
 * - **A per-file *rate* breach** (`B/file`, `ms/file`), which ADR-0038 established is the row that
 *   decides a *breach*. It is wrong at the low end: the rate is dominated by fixed per-atlas
 *   overhead at small `N`, so it fires on **cobra at 2,801 B/file — a 145 KiB atlas, 2.8% of the
 *   ceiling** — and on flask at 284 KiB. Reporting those as `OVER BUDGET` is ADR-0038's error
 *   pointed the other way. It also fired on **2 of 19** repos, not the 0 an earlier draft of this
 *   file claimed and reasoned from.
 * - **An index-time verdict.** Not reproducible: express tripped `5.21 ms/file` on a cold run and
 *   was silent on five afterwards; flask moved 688 → 563 ms between two runs. `scripts/budget.ts`
 *   marks `index ms/file` `hard: false` for exactly this reason — *"a budget that fails at random
 *   teaches people to ignore budgets"* — and a first version of this module dropped that
 *   distinction and printed the same words for both.
 * - **A second denominator.** `scripts/budget.ts` divides by `atlas.nodes.length`; this divided by
 *   `Σ fileCount`, so the same repo got two rates from the two tools (cobra 7,814 vs 2,801 B/file).
 *   Enforcement belongs to the script, which has the scale context and the hard/soft distinction.
 *
 * Measured on the ADR-0042 corpus, what is left fires on **1 of 19** repos — webpack, whose atlas
 * is 9,399.5 KiB — and is silent on the other 18.
 */

/** The scale `CLAUDE.md`'s absolute ceilings are quoted at. */
export const REFERENCE_FILES = 2000;

/**
 * `CLAUDE.md` says "5 MB". Read as 5 MiB, which is what `scripts/budget.ts` has always enforced —
 * noted because the sentence this module prints names its source, and 5 MB and 5 MiB differ by
 * 237 KiB.
 */
export const MAX_ATLAS_BYTES = 5 * 1024 * 1024;

export interface BudgetVerdict {
  readonly what: 'atlas size';
  readonly line: string;
}

/**
 * What a finished index is over, if anything. Empty when it is inside — the caller prints nothing,
 * because a budget line on every successful run is noise, and noise is how the one that matters
 * stops being read.
 */
export function budgetVerdicts(files: number, bytes: number): readonly BudgetVerdict[] {
  if (bytes <= MAX_ATLAS_BYTES) return [];
  const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;
  return [
    {
      what: 'atlas size',
      line:
        `atlas is ${kib(bytes)}, over the ${kib(MAX_ATLAS_BYTES)} CLAUDE.md quotes at ` +
        `${REFERENCE_FILES} files (this repo has ${files}) — the player loads it all in one request`,
    },
  ];
}
