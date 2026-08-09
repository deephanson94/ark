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
export const ATLAS_VERSION = 9;

/**
 * A stable node identity: `n:` + 12 hex chars derived from the node's *origin
 * path* (the earliest path git knows it by). Survives renames, so the player's
 * fog-of-war and field notes survive a refactor (ADR-0002).
 */
export type NodeId = string;

/**
 * A commit identity: `c:` + the 12-hex abbreviated sha in `CommitRecord.sha`.
 *
 * Not interchangeable with a `NodeId` and deliberately shaped so that no code
 * can mistake one for the other — see `AtlasId`.
 */
export type CommitId = string;

/**
 * A place in the repo, or an event in its history — whichever role it is in.
 *
 * Until M4's second verb this was always a `NodeId`, and the whole player read
 * it as one — the fog promotes it, the map flies to it, the deck indexes
 * questions by it. Placement's subject is a **commit** (NORTH-STAR §6.2), which
 * has no position on a map and no fog to lift, so the type had to admit both.
 *
 * The two arms are told apart by the id's own prefix (`isNodeId` /
 * `isCommitId`) rather than by a companion kind field, and rather than by asking
 * the verb. That matters for one specific reason recorded in ADR-0018: *"can
 * this be drawn?"* is a question about the id, not about the verb that used it,
 * and every leak this codebase has found came from verb-blind state being
 * interpreted by verb-specific code. A prefix keeps the answer verb-blind and
 * total.
 *
 * **This was called `SubjectId` until M4's third verb, and the rename is part of
 * ADR-0019 decision 1 rather than tidying.** It was named for the one role it
 * had. Archaeology's *members* are commits, so the union now covers `subject`,
 * `candidates` and `truth` alike — and a type named for a role invites exactly
 * the *which role is this?* reasoning that produced ADR-0018's nine defects. One
 * union, one name, no second field.
 *
 * **Nothing about this is checkable by the compiler.** `NodeId` and `CommitId`
 * are both aliases of `string`, so widening a field from `NodeId` to `AtlasId`
 * produces **zero** type errors and every assumption the old type licensed is
 * still sitting in its readers. They are found by grepping every read and asking
 * *what am I assuming this names?* — see ADR-0019's consequences for the list
 * that exercise produced.
 */
export type AtlasId = NodeId | CommitId;

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

/**
 * How much we trust this node's *history*, as opposed to its edges.
 *
 * - `certain`   — the rename walk followed this file's lineage without a
 *                 contested claim.
 * - `contested` — two live files claimed the same historical path, so
 *                 `applyRenames` resolved it arbitrarily (deterministically,
 *                 but arbitrarily) and some of this node's `churn`, dates and
 *                 co-change counts may belong to a different file.
 *
 * This is `Confidence`'s counterpart for the git side, and it exists for the
 * same reason: a verb graded against history may not ask about a file whose
 * history we know is a guess (guardrail 4). Blast Radius never needed it —
 * co-change only ranks its distractors — but Companion puts these counts in an
 * answer key, at which point "arbitrary but deterministic" stops being enough.
 *
 * Measured: 0 contested nodes on this repo and on `sveltejs/svelte`, **7 on
 * `honojs/hono`** — where a pair of files was renamed to each other's paths and
 * back, so both paths are live and each claims the other's history.
 */
export type Lineage = 'certain' | 'contested';

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
  /**
   * How load-bearing this file is: the bit length of its transitive dependent
   * count. 0 dependents → 0, 1 → 1, 2–3 → 2, 4–7 → 3. One layer up is twice as
   * depended-upon, and a layer means the same thing in every repo.
   *
   * **Deliberately not a third entry in `layout`.** `layout` is the force
   * simulation's output — a seeded, iterative, whole-graph computation whose
   * stability argument is ADR-0006's. This is a pure per-node graph query with
   * a different provenance and different stability: it depends on the node's
   * own cone and on nothing else in the repo. Folding them into one tuple would
   * imply they are computed together and would make `asPoint` and
   * `Region.centroid` disagree about how many dimensions a position has.
   *
   * It is an attribute, like `loc` and `churn`, and the renderer decides what
   * visual channel it drives — which is what ADR-0009's "additive, preserving
   * today's X,Y" asks for. See `src/indexer/elevation.ts`.
   */
  readonly elevation: number;
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
  /**
   * Whether this file's rename lineage was contested. See `Lineage`.
   *
   * `certain` for every node in a repo with no history: nothing was inferred,
   * so nothing was guessed.
   */
  readonly lineage: Lineage;
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
  /**
   * True when the commit touched more indexed files than `History.wideLimit`,
   * so it was excluded from the co-change matrix entirely (ADR-0005).
   *
   * **It says nothing about truncation, and an earlier version of this comment
   * implied it did** ("its `files` list may be truncated"). Wideness and
   * truncation are independent caps — `wideCommitFiles` 25 against
   * `maxCommitFiles` 64 — so a wide commit's list is complete unless it is also
   * long, and a *cut* list announces itself in `report.truncations` with its own
   * limit in `kept`. The distinction matters because one is a pillar-3
   * judgement and the other is a guardrail-4 failure.
   */
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
  /**
   * A commit touching more than this many indexed files was excluded from
   * `coChange` entirely — it couples every file to every other file, which is
   * true and useless.
   *
   * Part of the contract rather than an indexer detail, because it is not a
   * budget: it changes what the numbers in `coChange` *mean*. A reader who does
   * not know it will read "changed together 4 times" as a claim about all
   * commits, and it is a claim about focused ones. Companion copies it into
   * each challenge's `Evidence` so the pure `prompt()` — which sees a
   * `Challenge` and nothing else — can tell the player the rule they are being
   * graded under.
   */
  readonly wideLimit: number;
  /** Sorted by count desc, then a asc, then b asc. */
  readonly coChange: readonly CoChangePair[];
  /** Newest first. */
  readonly commits: readonly CommitRecord[];
}

export type VerbId = 'archaeology' | 'blastRadius' | 'companion' | 'placement';

/**
 * Every verb id, sorted. **The only list.**
 *
 * It lives beside the type rather than in `src/verbs/` because the atlas
 * validator needs it and cannot import from the verbs (that direction is
 * circular — verbs are built on the atlas). Before M4 there were two hand-kept
 * copies, one here and one in `src/player/save.ts`, and the save-side copy is
 * the dangerous one: a stored pass naming a verb missing from that list is
 * dropped at parse and erased by the next write, so a stale list silently
 * destroys a player's progress rather than merely failing to validate.
 */
export const VERB_IDS: readonly VerbId[] = [
  'archaeology',
  'blastRadius',
  'companion',
  'placement',
];

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
  | {
      readonly kind: 'coChange';
      /**
       * The **measured** weakest coupling in this answer key: every truth
       * member changed with the subject in at least this many commits, and the
       * weakest of them in exactly this many.
       *
       * Measured rather than prescribed, exactly as `importGraph.depth` is
       * (ADR-0008 §5). It is not a threshold the generator applied and then
       * graded against — a count boundary would be the depth-bound mistake
       * reborn, marking a player wrong over a 4-versus-5 they could not know.
       * Instead every candidate that is *not* in the answer key is certified to
       * have co-changed at most once, so the line the player draws is
       * "coupled" against "never", with the whole middle of the range kept off
       * the board (ADR-0014).
       */
      readonly minCount: number;
      /**
       * A commit touching more than this many indexed files was not counted at
       * all — a vendoring commit or a mass reformat couples every file to every
       * other file, which is true and useless.
       *
       * Carried into the atlas so the *player* can be told the exact rule they
       * are graded under. The instruction line first read "commits touching a
       * large fraction of the repo", which is false in both directions: the
       * limit is absolute, so on a small repo it admits a commit touching a
       * quarter of the files, and on a monorepo it excludes an ordinary feature
       * landing. A number the player can read is the only honest version.
       */
      readonly wideLimit: number;
      /**
       * What a candidate *outside* the answer key is certified at: it changed
       * with the subject at most this many times. Normally 1 — a pair seen once
       * is below the matrix's noise floor — but the pair cap can raise it.
       *
       * Carried for the same reason as `wideLimit`: the instruction line said
       * "at most once" unconditionally, which is a **false certification** on
       * any repo where the cap bit. A branch that raises the bar correctly and
       * leaves the sentence describing the old one is half a fix.
       */
      readonly atMost: number;
    }
  | {
      readonly kind: 'commit';
      /**
       * The commit's subject line, exactly as `CommitRecord.subject` records
       * it. Carried here because `prompt()` is pure over `(challenge, pathOf)`
       * and has no atlas to look it up in — the same reason `coChange` carries
       * `wideLimit`.
       *
       * It is **derived, not authored**: guardrail 2 forbids hand-written
       * content about a particular project, and quoting what the repo already
       * says about itself is the opposite of writing it.
       */
      readonly subject: string;
      readonly date: IsoDate;
      /**
       * How many indexed files the commit touched **in all**. `truth` is a
       * sample of them (ADR-0018), so this is what the reveal states as
       * *revealed* rather than proved — the same distinction ADR-0011 draws
       * between a note's claim and its radius.
       */
      readonly touched: number;
    }
  | {
      readonly kind: 'history';
      /**
       * How many commits the atlas is willing to ask about touched this file
       * **in all** — the population `truth` samples from (ADR-0019 decision 3).
       *
       * Measured, like every other variant's number, and stated by the *reveal*
       * rather than by the prompt. The prompt may not state it, and the reason
       * is specific: the inspector already prints `churn`, which counts every
       * **walked** commit that touched the file, while this counts the
       * **eligible** ones. Two counts of nearly the same thing, differing by
       * whatever the guardrails refused, is a number a player would reasonably
       * read as the answer's size and be wrong about. So the board never states
       * either, and the reveal states this one as revealed-not-proved.
       */
      readonly touchedBy: number;
    };

export interface Challenge {
  readonly id: string;
  readonly verb: VerbId;
  /** Curriculum tier, NORTH-STAR §5. */
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6;
  /** Computed, never authored. NORTH-STAR §8.4. */
  readonly difficulty: number;
  /**
   * A node id for a verb that asks about a file, a commit id for one that asks
   * about an event. Told apart by prefix — see `AtlasId`.
   */
  readonly subject: AtlasId;
  /**
   * The choice set shown to the player. Sorted; never contains `subject`.
   *
   * For `blastRadius` this obeys `candidates ∩ dependents(subject, ∞) = truth`
   * — every candidate that depends on the subject at any depth is in the answer
   * key, and any dependent that is not is absent from the board entirely. That
   * is what lets a hub ship a sampled answer key without lying (ADR-0008).
   *
   * The other three hold the same shape against their own relation:
   * `candidates ∩ companions(subject) = truth` (ADR-0014),
   * `candidates ∩ files(commit) = truth` (ADR-0018) and
   * `candidates ∩ touchedBy(subject) = truth` (ADR-0019). Four verbs, one rule
   * — every candidate is either in the answer key or certified out of it, and
   * the middle of the range is kept off the board rather than graded.
   *
   * **A member is a place or an event, exactly as a subject is** (ADR-0019
   * decision 1). Three verbs put node ids here; `archaeology` puts commit ids,
   * because it asks a file which commits landed on it. Every candidate on one
   * board is the same kind — the validator derives which from `evidence.kind`
   * and checks it, since a board mixing files and commits would be two
   * questions wearing one prompt.
   */
  readonly candidates: readonly AtlasId[];
  /** The correct subset. Non-empty, sorted, always a subset of `candidates`. */
  readonly truth: readonly AtlasId[];
  /**
   * **Why each wrong answer is here** — one space-separated token per candidate,
   * positionally aligned with `candidates`, `-` where the candidate is in
   * `truth` and so was never *chosen* as anything (ADR-0020).
   *
   * Each other token is the id of the §8.3 strategy that put that candidate on
   * the board: a directory sibling, a name-alike, a structurally-near
   * non-dependent, a co-change ghost, a commit whose message names a file it
   * never touched. The strategy sets are per verb and live in each verb's
   * `distractors.ts`; the *format* lives in `witness.ts` beside this file,
   * because the validator has to refuse a malformed one and cannot import from
   * `src/verbs/`.
   *
   * It is recorded rather than re-derived because the two disagree: measured
   * across every shipped board, the reason a reveal reconstructs from the graph
   * names the strategy that actually chose the candidate on 53.9% of this
   * repo's distractor slots and 47.9% of `honojs/hono`'s. A candidate satisfies
   * several predicates at once, and which one *chose* it was decided by a quota.
   *
   * **Plaintext here, gated in the panel.** Like `truth` (§7.1), this is not
   * obfuscated — a reader with the file has opted out. What a *reveal* may state
   * is a separate and stricter question, and two classes are deliberately never
   * spoken aloud; see ADR-0020.
   */
  readonly witness: string;
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

/**
 * Program source the walk recognised and could not read, by language.
 *
 * A **refinement of `skipped`'s `unsupported`**, not a new bucket: every file
 * counted here is also counted there, so that number stays comparable across
 * atlas versions. The refinement is the whole point — `unsupported` cannot tell
 * a PNG from a Go file, and the difference between those two is the difference
 * between *"this repo is its Markdown"* and *"this repo has 906 Go files we
 * cannot see"* (ADR-0025).
 *
 * `lang` is a display name (`Go`, `Python`, `C++`), because it is printed to a
 * human on both sides of the wall and there is no second table mapping a code to
 * a name. The extension table is `walk.ts`'s `UNREAD`.
 */
export interface UnreadableCount {
  readonly lang: string;
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
  /** Sorted by `lang`. Empty when the walk saw no source it cannot read. */
  readonly unreadable: readonly UnreadableCount[];
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
