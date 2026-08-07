/**
 * The atlas schema. This file is the single source of truth for the shape of
 * `atlas.json` — the only interface between the indexer and the player.
 *
 * Prose spec: `docs/atlas-format.md`. If you change a type here, change that
 * document in the same commit, and bump `ATLAS_VERSION` (guardrail 5).
 *
 * Two hard rules live in this file's design:
 *
 *  1. Nothing here may carry wall-clock time. Same repo state ⇒ byte-identical
 *     atlas, forever (ADR-0001).
 *  2. Bulk arrays (`edges`, `history`) reference nodes by *index* into `nodes`;
 *     the challenge/grade seam references them by stable *id* string, so
 *     `grade(challenge, answer)` is self-contained (ADR-0004).
 */

/** Bumped whenever the shape below changes incompatibly. */
export const ATLAS_VERSION = 3;

/**
 * A stable node identity: `n:` + 12 hex chars derived from the node's *origin
 * path* (the earliest path git knows it by). Survives renames, so the player's
 * fog-of-war and field notes survive a refactor (ADR-0002).
 */
export type NodeId = string;

/** An index into `Atlas.nodes`. Used everywhere size matters. */
export type NodeRef = number;

/** A `YYYY-MM-DD` calendar date in the committer's local zone, as git reports it. */
export type IsoDate = string;

export type Lang = 'ts' | 'tsx' | 'js' | 'jsx' | 'mjs' | 'cjs' | 'json' | 'md' | 'other';

/**
 * Languages the scanner parses for imports. Sorted.
 *
 * The complement — `json`, `md`, `other` — is terrain: mapped, sized and
 * clustered like everything else, but structurally inert. A file that cannot
 * import anything cannot be a wrong answer worth offering, which is why the
 * challenge generator uses this to decide who may appear in a choice set.
 *
 * Kept next to `Lang` rather than in the indexer because it is a fact about the
 * enum, and both sides of the wall need it.
 */
export const IMPORTING_LANGS: readonly Lang[] = ['cjs', 'js', 'jsx', 'mjs', 'ts', 'tsx'];

export function canImport(lang: Lang): boolean {
  return IMPORTING_LANGS.includes(lang);
}

export type NodeKind = 'file';

/**
 * How much we trust an edge.
 *
 * - `certain`  — the specifier resolved to exactly one file on disk.
 * - `probable` — resolution required a heuristic that had more than one viable
 *                answer (e.g. both `foo.ts` and `foo.js` exist).
 *
 * There is deliberately no `uncertain` member: an import we could not pin to a
 * file produces **no edge at all**, and is recorded on the importing node's
 * `unresolved` list instead. An edge in the atlas always points somewhere real.
 */
export type Confidence = 'certain' | 'probable';

export type EdgeKind =
  /** `import x from 'y'` / `import 'y'` */
  | 'import'
  /** `export … from 'y'` — a barrel hop; a dependent of the barrel depends on `y`. */
  | 'reexport'
  /** `import('y')` with a literal specifier. */
  | 'dynamic'
  /** `import type { X } from 'y'` — erased at runtime, but a real signature coupling. */
  | 'type'
  /** `require('y')` with a literal specifier. */
  | 'require';

export interface AtlasNode {
  /** Stable across renames. See `NodeId`. */
  readonly id: NodeId;
  /** Current repo-relative POSIX path. Display and lookup; not identity. */
  readonly path: string;
  /** Earliest path git knows this file by. Equals `path` when there is no history. */
  readonly originPath: string;
  readonly kind: NodeKind;
  readonly lang: Lang;
  /** Physical lines in the file. */
  readonly loc: number;
  readonly bytes: number;
  /** Precomputed, deterministic, rounded to 2dp. Geography is topology (pillar 4). */
  readonly layout: readonly [number, number];
  /** Id of the region in `Atlas.regions` this node was clustered into. */
  readonly region: string;
  /** Sorted. `default` for a default export, `*` for `export * from …`. */
  readonly exports: readonly string[];
  /**
   * Import specifiers in this file that we could not pin to a file *or* to a
   * declared external package. Sorted. A non-empty list means this file's
   * outgoing edges are incomplete, which makes any truth set that depends on
   * them uncertain — see `isChallengeable` in `./graph.js` (guardrail 4).
   */
  readonly unresolved: readonly string[];
  /** Bare specifiers resolved to a declared dependency or node builtin. Sorted. */
  readonly externals: readonly string[];
  /** Commits touching this file, following renames. 0 when there is no history. */
  readonly churn: number;
  /** Distinct commit authors. 0 when there is no history. */
  readonly authors: number;
  readonly firstSeen: IsoDate | null;
  readonly lastSeen: IsoDate | null;
}

export interface AtlasEdge {
  readonly from: NodeRef;
  readonly to: NodeRef;
  readonly kind: EdgeKind;
  readonly confidence: Confidence;
  /** Distinct specifiers in `from` that produced this edge. */
  readonly weight: number;
}

/** A derived cluster of the import graph. Not a directory (pillar 4). */
export type RegionKind = 'topology' | 'terrain';

export interface Region {
  /** Stable slug, unique within the atlas. */
  readonly id: string;
  /** Human-facing label, derived from the members' common path prefix. */
  readonly label: string;
  readonly nodeCount: number;
  /** Mean of member layout positions, rounded to 2dp. */
  readonly centroid: readonly [number, number];
  /**
   * `topology` — a cluster the import graph produced.
   * `terrain`  — files the graph has nothing to say about, aggregated coarsely.
   *
   * The player must not colour them the same: seven hundred edgeless files
   * eating palette slots is what turned vite's map into confetti (ADR-0010).
   */
  readonly kind: RegionKind;
}

/** `[a, b, count]` with `a < b`, both indices into `Atlas.nodes`. */
export type CoChangePair = readonly [NodeRef, NodeRef, number];

export interface CommitRecord {
  /** Abbreviated to 12 hex chars. */
  readonly sha: string;
  readonly date: IsoDate;
  /** Truncated to 120 chars. */
  readonly subject: string;
  /** Indexed files this commit touched, as node indices, sorted ascending. */
  readonly files: readonly NodeRef[];
  /** True when the commit touched more files than the co-change cap, so it was
   *  excluded from the co-change matrix and its `files` list may be truncated. */
  readonly wide: boolean;
  /** First `#NNNN` in the subject, if any. */
  readonly issue: number | null;
}

export interface History {
  /** False for a repo with no commits, or no git at all (risk #7). */
  readonly present: boolean;
  /** Commits walked, including ones that touched no indexed file. */
  readonly commitsWalked: number;
  /** Commits kept in `commits`. */
  readonly commitsRetained: number;
  /** Oldest and newest commit dates seen. Null when `present` is false. */
  readonly window: { readonly from: IsoDate; readonly to: IsoDate } | null;
  /** Sorted by count desc, then a asc, then b asc. */
  readonly coChange: readonly CoChangePair[];
  /** Newest first. */
  readonly commits: readonly CommitRecord[];
}

export type VerbId = 'blastRadius';

export type Evidence =
  | {
      readonly kind: 'importGraph';
      /**
       * The **measured** furthest hop in this challenge's answer key — not a
       * bound the generator imposed. There is no bound: truth is the unbounded
       * transitive dependent set (ADR-0008), so this is a fact about the
       * question rather than a description of the tool, and `explain()` may
       * state it as one.
       */
      readonly depth: number;
    }
  | { readonly kind: 'coChange'; readonly minCount: number };

export interface Challenge {
  readonly id: string;
  readonly verb: VerbId;
  /** Curriculum tier, NORTH-STAR §5. */
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6;
  /** Computed, never authored. NORTH-STAR §8.4. */
  readonly difficulty: number;
  readonly subject: NodeId;
  /**
   * The choice set shown to the player. Sorted; never contains `subject`.
   *
   * For `blastRadius` this obeys `candidates ∩ dependents(subject, ∞) = truth`
   * — every candidate that depends on the subject at any depth is in the answer
   * key, and any dependent that is not is absent from the board entirely. That
   * is what lets a hub ship a sampled answer key without lying (ADR-0008).
   */
  readonly candidates: readonly NodeId[];
  /** The correct subset. Non-empty, sorted, always a subset of `candidates`. */
  readonly truth: readonly NodeId[];
  readonly evidence: Evidence;
}

/** What the indexer dropped to stay inside a budget. Never silent (CLAUDE.md). */
export interface Truncation {
  readonly what: 'commits' | 'coChange' | 'commitFiles' | 'unresolved' | 'exports';
  readonly kept: number;
  readonly dropped: number;
}

/** Files the walker deliberately skipped, aggregated by reason. */
export interface SkipCount {
  readonly reason: 'ignored' | 'symlink' | 'binary' | 'tooLarge' | 'unsupported';
  readonly count: number;
}

export interface RepoMeta {
  readonly name: string;
  /** Full 40-char HEAD sha, or `null` when there is no history. */
  readonly head: string | null;
  /** HEAD's commit date. Stands in for a wall-clock `indexedAt` (ADR-0001). */
  readonly headDate: IsoDate | null;
  /**
   * Full 40-char sha of the repo's first commit — **identity**, where `head` is
   * **staleness**. The player keys saved progress on this, because a HEAD-keyed
   * save is wiped by every reindex (ADR-0011).
   *
   * Null when there is no history, and null for a shallow clone, whose oldest
   * reachable commit is a graft boundary that moves. Null means the player
   * falls back to a weaker, name-derived key; it is never an error.
   */
  readonly root: string | null;
  /** Sorted. */
  readonly languages: readonly Lang[];
  readonly fileCount: number;
  /** The indexer build that produced this atlas, e.g. `ark@0.1.0`. */
  readonly tool: string;
}

export interface IndexReport {
  /** Sorted by `what`. */
  readonly truncations: readonly Truncation[];
  /** Sorted by `reason`. */
  readonly skipped: readonly SkipCount[];
}

export interface Atlas {
  readonly version: typeof ATLAS_VERSION;
  readonly repo: RepoMeta;
  /** Sorted by `id`. Index into this array is the `NodeRef` used everywhere. */
  readonly nodes: readonly AtlasNode[];
  /** Sorted by `(from, to, kind)`. Unique on that triple. No self-edges. */
  readonly edges: readonly AtlasEdge[];
  /** Sorted by `id`. */
  readonly regions: readonly Region[];
  readonly history: History;
  /** Sorted by `id`. */
  readonly challenges: readonly Challenge[];
  readonly report: IndexReport;
}
