/**
 * The budgets from `CLAUDE.md`, in one place.
 *
 * They lived only in `scripts/budget.ts`, which `src/` cannot import — so the CLI, which prints the
 * two measurements these ceilings are about, printed them **naked**: `atlas 9399.5 KiB in 56400 ms`
 * with nothing on the line saying what either number is allowed to be. A user indexing a large repo
 * saw a figure and no verdict, and `npm run budget` (which knows) is a repo script they do not have.
 *
 * ## Rate and absolute are different questions, and the first draft only asked one
 *
 * ADR-0038 spent a milestone establishing that `CLAUDE.md`'s 10 s and 5 MB are quoted **at 2,000
 * files**, so django's 13.5 s at 3,035 files is *inside* the budget and calling it a 35% breach was
 * the error. The first version of this module took that lesson and checked **only** the rate — and
 * fired on **nothing**: measured on the ADR-0042 corpus, typeorm reads 1,060 B/file and 3.99
 * ms/file, django 1,002 and 4.01, webpack 762 and 4.47, all inside 2,621 and 5.00. A check that
 * never fires is worse than no check, because it is code and comments asserting a behaviour the
 * product does not have (`CLAUDE.md`'s never-fires landmine).
 *
 * The absolute is not redundant, and size is where the difference bites. **The player loads the
 * whole atlas over one request**, so 9.18 MiB is a first-paint fact whatever the file count — while
 * index *time* genuinely scales with the repo and an absolute is meaningless there. Both are
 * therefore reported, and each says which kind it is, so a reader cannot mistake one for the other.
 */

/** The scale `CLAUDE.md`'s absolute ceilings are quoted at. */
export const REFERENCE_FILES = 2000;

export const MAX_ATLAS_BYTES = 5 * 1024 * 1024;
export const MAX_INDEX_MS = 10_000;

/** Per-file ceilings — the ones that scale, and therefore the ones that decide a *breach*. */
export const MAX_BYTES_PER_FILE = MAX_ATLAS_BYTES / REFERENCE_FILES;
export const MAX_MS_PER_FILE = MAX_INDEX_MS / REFERENCE_FILES;

export interface BudgetVerdict {
  readonly what: 'atlas size' | 'index time';
  /**
   * `rate` — over the per-file ceiling. This is a **breach**: the repo costs more per file than
   * the budget allows, and it would still be over at any size.
   *
   * `absolute` — inside the per-file ceiling but past the figure `CLAUDE.md` quotes at 2,000 files.
   * Not a breach. Reported because the player loads the whole atlas in one request, so the total is
   * a fact about first paint that the rate does not carry.
   */
  readonly kind: 'rate' | 'absolute';
  readonly line: string;
}

/**
 * What a finished index is over, if anything. Empty when it is inside everything — the caller
 * prints nothing in that case, because a budget line on every successful run is noise, and noise is
 * how the one that matters stops being read.
 */
export function budgetVerdicts(
  files: number,
  bytes: number,
  milliseconds: number,
): readonly BudgetVerdict[] {
  if (files <= 0) return [];
  const verdicts: BudgetVerdict[] = [];

  const bytesPerFile = bytes / files;
  const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;
  if (bytesPerFile > MAX_BYTES_PER_FILE) {
    verdicts.push({
      what: 'atlas size',
      kind: 'rate',
      line:
        `atlas size OVER BUDGET: ${bytesPerFile.toFixed(0)} B/file against a ` +
        `${MAX_BYTES_PER_FILE.toFixed(0)} B/file ceiling (${kib(bytes)} at ${files} files)`,
    });
  } else if (bytes > MAX_ATLAS_BYTES) {
    verdicts.push({
      what: 'atlas size',
      kind: 'absolute',
      line:
        `atlas is ${kib(bytes)}, past the ${kib(MAX_ATLAS_BYTES)} CLAUDE.md quotes at ` +
        `${REFERENCE_FILES} files — inside budget per file (${bytesPerFile.toFixed(0)} of ` +
        `${MAX_BYTES_PER_FILE.toFixed(0)} B/file at ${files} files), but the player loads it all at once`,
    });
  }

  const msPerFile = milliseconds / files;
  if (msPerFile > MAX_MS_PER_FILE) {
    verdicts.push({
      what: 'index time',
      kind: 'rate',
      line:
        `index time OVER BUDGET: ${msPerFile.toFixed(2)} ms/file against a ` +
        `${MAX_MS_PER_FILE.toFixed(2)} ms/file ceiling (${milliseconds} ms at ${files} files)`,
    });
  }
  return verdicts;
}
