/**
 * Path and filename analysis, shared by every verb.
 *
 * Pure string work with no graph, no atlas and no verb semantics — which is why
 * it sits here rather than inside a verb directory. It moved out of
 * `blastRadius/distractors.ts` when Companion landed: both verbs need to know
 * what a sibling is and what a confusable name is, and the alternative was one
 * verb importing another verb's internals, which is exactly the coupling
 * CLAUDE.md's "verbs are self-contained" forbids.
 *
 * Nothing here is repo-specific (guardrail 2): these are facts about paths.
 */

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function splitDir(path: string): string[] {
  const dir = directoryOf(path);
  return dir === '' ? [] : dir.split('/');
}

export function sharedPrefix(left: readonly string[], right: readonly string[]): number {
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++;
  return shared;
}

/** How many leading directory segments two paths share. */
export function sharedSegments(a: string, b: string): number {
  return sharedPrefix(splitDir(a), splitDir(b));
}

/**
 * Lowercase word tokens of a filename, extension dropped.
 *
 * `parse-config.util.ts` → `parse`, `config`, `util`; `blastRadius.ts` →
 * `blast`, `radius`. The extension goes because otherwise every TypeScript file
 * in the repo shares a token with every other one, and the measure stops
 * measuring anything.
 */
export function nameTokens(path: string): string[] {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot <= 0 ? base : base.slice(0, dot);
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Jaccard overlap of two filenames' tokens. 0..1. */
export function nameSimilarity(a: string, b: string): number {
  return jaccard(nameTokens(a), nameTokens(b));
}
