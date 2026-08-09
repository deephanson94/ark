/**
 * Does this map cover the repository, or only the part of it ark can read?
 *
 * **The question this file answers is not "what language is this repo".** It is
 * narrower and it is the only one the filesystem can settle honestly: *is there
 * a body of program source that ark recognised and could not read, and is it
 * larger than what it did read?* A documentation repo, a book, an awesome-list
 * genuinely is its Markdown and must keep its deck (pillar 6); a Go library with
 * a README is not its README, and a deck about that README reads as success
 * while teaching a shadow of the repo. Nothing in the *language mix of the
 * nodes* separates those two — `gohugoio/hugo` maps 1,016 Markdown files and is
 * not a documentation project — so the signal is what the walk **skipped**.
 *
 * The rule and the numbers behind it are ADR-0025. It has two clauses, **each of
 * which changes the verdict on a repo the other would get wrong** — measured
 * across eleven, not asserted:
 *
 *  1. **There is a body of unreadable source at all** (`UNREADABLE_FLOOR`).
 *     Decisive on `sindresorhus/awesome`: seven Markdown files and one shell
 *     script, which clause 2 alone refuses for having no source to be a tenth
 *     of.
 *  2. **The map holds less than a tenth of it** (`MAPPED_SHARE`). Decisive on
 *     `facebook/react` (4,436 mapped against 120 Rust and 16 Shell),
 *     `vercel/next.js` (23,045 against 1,012 Rust) and `sveltejs/svelte` (3,467
 *     against 4,462 `.svelte`), each of which clause 1 alone refuses.
 *
 * Both live here rather than in the indexer because the player states the same
 * fact to the same person, and two surfaces describing one population must agree
 * by construction rather than by care.
 */

import type { Atlas, UnreadableCount } from './schema.js';
import { byteCompare } from './order.js';
import { canImport } from './schema.js';

/**
 * How many recognised-but-unreadable source files make a *body* of source.
 *
 * Measured: of eleven repos, the three carrying fewer than five carry 1, 1 and
 * 1, and the rest carry 27 or more. Any value in [2, 27] gives identical
 * verdicts on all eleven; 5 is the geometric middle of that gap. It is a
 * small-sample guard rather than a tuning knob — below it the share below is
 * computed over too few files to mean anything.
 */
export const UNREADABLE_FLOOR = 5;

/**
 * How small the mapped share of a repository's source has to get before its deck
 * stops being about that repository. One tenth.
 *
 * **The number is the largest gap in the measured distribution, not a
 * preference.** Mapped share of the ten repos this clause decides: hono 99.7%,
 * ark 99.1%, react 97.0%, next.js 95.7%, **svelte 43.7%**, hugo 2.5%, django
 * 1.5%, and cobra, flask and system-design-primer at 0.0%. (`awesome` is the
 * eleventh and is *also* 0.0% — clause 1 removes it before this ratio is
 * consulted, which is why no bar on this axis alone can work.) One tenth sits in
 * the 2.5% → 43.7% gap with a ~4× margin on each side, and every value in that
 * interval gives the same eleven verdicts.
 *
 * A **majority** rule — the first draft, and the one with the nicer English —
 * puts the bar at 50% and **refuses `sveltejs/svelte`**, whose 4,462 `.svelte`
 * files outnumber the 3,467 (3,382 `.js`, 84 `.ts`, 1 `.mjs`) its compiler is
 * actually written in. A JS tool refusing a JS repo is the wrong answer, and
 * the semantics were doing the deciding rather than the data.
 */
export const MAPPED_SHARE = 10;

export interface SourceCoverage {
  /** Nodes on the map in a language the scanner parses. */
  readonly mapped: number;
  /** Files the walk recognised as program source and did not read. */
  readonly unreadable: number;
  /** Sorted by descending count, then by language. Display order. */
  readonly languages: readonly UnreadableCount[];
  /** Clause 1: there is a body of unreadable source, not one stray script. */
  readonly bodyOfSource: boolean;
  /** Clause 2: the map holds less than a tenth of this repository's source. */
  readonly sliver: boolean;
  /**
   * Both clauses. When true the indexer ships the map and **no deck**: a set of
   * questions generated over what is left would not be a set of questions about
   * this repository.
   */
  readonly deckRefused: boolean;
}

export function sourceCoverage(atlas: Atlas): SourceCoverage {
  const mapped = atlas.nodes.reduce((total, node) => total + (canImport(node.lang) ? 1 : 0), 0);
  const unreadable = atlas.report.unreadable.reduce((total, entry) => total + entry.count, 0);
  const languages = [...atlas.report.unreadable].sort(
    (a, b) => b.count - a.count || byteCompare(a.lang, b.lang),
  );
  const bodyOfSource = unreadable >= UNREADABLE_FLOOR;
  // `mapped * MAPPED_SHARE < mapped + unreadable`, in integers so that no
  // rounding sits between a repo and its deck.
  const sliver = mapped * (MAPPED_SHARE - 1) < unreadable;
  return { mapped, unreadable, languages, bodyOfSource, sliver, deckRefused: bodyOfSource && sliver };
}

function prose(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/** `906 Go, 10 Shell and 3 C`. Empty string when nothing is unreadable. */
export function unreadableList(coverage: SourceCoverage): string {
  return prose(coverage.languages.map((entry) => `${entry.count} ${entry.lang}`));
}

/** `Go, Shell and C` — the names alone, for when the counts are already said. */
export function unreadableLanguages(coverage: SourceCoverage): string {
  return prose(coverage.languages.map((entry) => entry.lang));
}

/**
 * The one sentence, for whoever is looking — the terminal or the player.
 *
 * `null` when the map is complete, so neither surface has to decide whether
 * silence is warranted. Three states, and the middle one is the reason this is
 * not simply the refusal's text: a repo whose source ark *mostly* reads still
 * has files missing from its map, and saying so is a measurement rather than an
 * alarm.
 */
export function coverageSentence(coverage: SourceCoverage): string | null {
  if (coverage.unreadable === 0) return null;
  const total = coverage.mapped + coverage.unreadable;
  const files = `${total} source file${total === 1 ? '' : 's'}`;
  // Counts twice in one clause reads as a stammer — "The other 1 are 1 Shell" —
  // so the per-language counts are given only when there is more than one
  // language to apportion between. With one, the total has already said it.
  const rest =
    coverage.languages.length === 1 ? unreadableLanguages(coverage) : unreadableList(coverage);
  const state =
    coverage.mapped === 0
      ? `None of this repository's ${files} ${total === 1 ? 'is' : 'are'} on this map —` +
        ` ${total === 1 ? 'it is' : 'they are'} ${unreadableLanguages(coverage)}, which ark cannot read.`
      : `This map holds ${coverage.mapped} of this repository's ${files}.` +
        ` The other ${coverage.unreadable} ${coverage.unreadable === 1 ? 'is' : 'are'} ${rest},` +
        ` which ark cannot read.`;
  if (!coverage.deckRefused) return state;
  return (
    `${state} So it generated no questions: a deck over what is left would not be` +
    ` a deck about this repository.`
  );
}

/** The short form, for a corner of the HUD. `null` when the map is complete. */
export function coverageBadge(coverage: SourceCoverage): string | null {
  if (coverage.unreadable === 0) return null;
  const noun = coverage.unreadable === 1 ? 'source file' : 'source files';
  return `${coverage.unreadable} ${noun} not on this map`;
}
