/**
 * The indexer's orchestration layer: repo on disk → validated `Atlas`.
 *
 * Every step below is deliberately ordered so that the output depends only on
 * the repo's content, never on the machine: the walk sorts, the history walk
 * runs under a fixed locale, nodes are keyed by a content-derived id, and the
 * layout is seeded. The result is validated before it is returned, so a bug in
 * any of those steps surfaces here rather than in the player.
 */

import { basename } from 'node:path';

import type {
  Atlas,
  AtlasEdge,
  AtlasNode,
  CoChangePair,
  CommitRecord,
  Confidence,
  EdgeKind,
  Lang,
  Region,
  SkipCount,
  Truncation,
} from '../atlas/index.js';
import {
  ATLAS_VERSION,
  byteCompare,
  coChangeOrder,
  edgeOrder,
  nodeIdFor,
  round2,
  validateAtlas,
} from '../atlas/index.js';
import { readGitHistory } from './git.js';
import { DEFAULT_HISTORY_LIMITS, buildHistory } from './history.js';
import type { HistoryLimits } from './history.js';
import { computeElevations } from './elevation.js';
import { DEFAULT_LAYOUT_OPTIONS, computeLayout } from './layout.js';
import type { LayoutOptions } from './layout.js';
import { detectRegions } from './regions.js';
import { isManifest, loadConfigIndex } from './config.js';
import { resolveSpecifier } from './resolve.js';
import { scanModule } from './scan.js';
import { DEFAULT_WALK_OPTIONS, walk } from './walk.js';
import type { WalkOptions } from './walk.js';
import type { GenerationResult } from '../verbs/blastRadius/index.js';
import { generateWithReport } from '../verbs/blastRadius/index.js';
import type { GenerationResult as CompanionResult } from '../verbs/companion/index.js';
import { generateWithReport as generateCompanionWithReport } from '../verbs/companion/index.js';
import type { GenerateOptions } from '../verbs/index.js';
import { DEFAULT_GENERATE_OPTIONS } from '../verbs/index.js';

/**
 * Identifies the indexer build that produced an atlas. Bump alongside
 * `package.json`; `tests/atlas/atlas.test.ts` asserts the two agree.
 */
export const TOOL = 'ark@0.1.0';

/** Bounds on per-node arrays, so one pathological file cannot blow the budget. */
const MAX_UNRESOLVED_PER_NODE = 20;
const MAX_EXPORTS_PER_NODE = 200;

export interface IndexOptions {
  readonly root: string;
  readonly walk: Omit<WalkOptions, 'root'>;
  readonly history: HistoryLimits;
  readonly layout: LayoutOptions;
  readonly generate: GenerateOptions;
  /** Upper bound on commits read from git, before retention. */
  readonly maxCommitsWalked: number;
}

export const DEFAULT_INDEX_OPTIONS: Omit<IndexOptions, 'root'> = {
  walk: DEFAULT_WALK_OPTIONS,
  history: DEFAULT_HISTORY_LIMITS,
  layout: DEFAULT_LAYOUT_OPTIONS,
  generate: DEFAULT_GENERATE_OPTIONS,
  maxCommitsWalked: 20000,
};

export interface IndexResult {
  readonly atlas: Atlas;
  /** What each verb shipped and what it refused to. Printed by the CLI. */
  readonly generation: {
    readonly blastRadius: GenerationResult;
    readonly companion: CompanionResult;
  };
}

export function indexOptions(root: string, overrides: Partial<IndexOptions> = {}): IndexOptions {
  return { root, ...DEFAULT_INDEX_OPTIONS, ...overrides };
}

interface PendingEdge {
  readonly fromPath: string;
  readonly toPath: string;
  readonly kind: EdgeKind;
  confidence: Confidence;
  readonly specifiers: Set<string>;
}

export async function buildIndex(options: IndexOptions): Promise<IndexResult> {
  const walked = await walk({ root: options.root, ...options.walk });
  // Resolution reads the manifests nearest each importing file, not just the
  // repo root's — see `config.ts`. The walk has already applied .gitignore and
  // the default excludes, so this cannot wander into `node_modules`.
  const configIndex = await loadConfigIndex(
    options.root,
    walked.files.map((file) => file.path).filter(isManifest),
  );
  const paths = walked.files.map((file) => file.path);
  const indexed = new Set(paths);
  const context = {
    indexed,
    onDisk: walked.onDisk,
    configFor: (path: string) => configIndex.for(path),
    workspaceNames: configIndex.workspaceNames,
  };

  // ---- scan and resolve -------------------------------------------------
  const unresolvedByPath = new Map<string, string[]>();
  const externalsByPath = new Map<string, string[]>();
  const exportsByPath = new Map<string, readonly string[]>();
  const pending = new Map<string, PendingEdge>();
  let unresolvedDropped = 0;
  let exportsDropped = 0;

  for (const file of walked.files) {
    if (file.source === null) continue;
    const facts = scanModule(file.source);
    exportsByPath.set(file.path, facts.exports);

    for (const reference of facts.imports) {
      if (reference.specifier === null) {
        push(unresolvedByPath, file.path, reference.raw);
        continue;
      }
      const resolution = resolveSpecifier(file.path, reference.specifier, context);
      switch (resolution.kind) {
        case 'internal': {
          if (resolution.path === file.path) break; // a file importing itself
          const key = `${file.path}\n${resolution.path}\n${reference.kind}`;
          const existing = pending.get(key);
          if (existing === undefined) {
            pending.set(key, {
              fromPath: file.path,
              toPath: resolution.path,
              kind: reference.kind,
              confidence: resolution.confidence,
              specifiers: new Set([reference.specifier]),
            });
          } else {
            existing.specifiers.add(reference.specifier);
            if (resolution.confidence === 'probable') existing.confidence = 'probable';
          }
          break;
        }
        case 'external':
          push(externalsByPath, file.path, resolution.name);
          break;
        case 'offMap':
          break;
        case 'unresolved':
          push(unresolvedByPath, file.path, reference.raw);
          break;
      }
    }
  }

  // ---- history ----------------------------------------------------------
  const git = await readGitHistory(options.root, options.maxCommitsWalked);
  const history = buildHistory(git, paths, options.history);

  // ---- identity and node order -----------------------------------------
  const originByPath = new Map<string, string>();
  const claimed = new Map<string, string>();
  for (const path of paths) {
    const proposed = history.perFile.get(path)?.originPath ?? path;
    const owner = claimed.get(proposed);
    if (owner !== undefined) {
      throw new Error(
        `rename lineage is ambiguous: ${path} and ${owner} both trace back to ${proposed}`,
      );
    }
    claimed.set(proposed, path);
    originByPath.set(path, proposed);
  }

  const idByPath = new Map<string, string>();
  const pathById = new Map<string, string>();
  for (const path of paths) {
    const origin = originByPath.get(path) ?? path;
    const id = nodeIdFor(origin);
    const clash = pathById.get(id);
    if (clash !== undefined) {
      throw new Error(`node id collision: ${origin} and ${originByPath.get(clash)} both hash to ${id}`);
    }
    idByPath.set(path, id);
    pathById.set(id, path);
  }

  const orderedPaths = [...paths].sort((a, b) =>
    byteCompare(idByPath.get(a) ?? '', idByPath.get(b) ?? ''),
  );
  const refByPath = new Map<string, number>();
  for (const [ref, path] of orderedPaths.entries()) refByPath.set(path, ref);

  // ---- edges ------------------------------------------------------------
  const edges: AtlasEdge[] = [];
  for (const edge of pending.values()) {
    const from = refByPath.get(edge.fromPath);
    const to = refByPath.get(edge.toPath);
    if (from === undefined || to === undefined || from === to) continue;
    edges.push({ from, to, kind: edge.kind, confidence: edge.confidence, weight: edge.specifiers.size });
  }
  edges.sort(edgeOrder);

  // ---- regions and layout ----------------------------------------------
  const detected = detectRegions(orderedPaths, edges);
  const regionByRef = new Map<number, string>();
  for (const region of detected) {
    for (const member of region.members) regionByRef.set(member, region.id);
  }

  // Regions before layout, so the layout can pull each cluster together.
  const groupByRef = new Array<number>(orderedPaths.length).fill(0);
  for (const [index, region] of detected.entries()) {
    for (const member of region.members) groupByRef[member] = index;
  }
  const positions = computeLayout(orderedPaths.length, edges, options.layout, groupByRef);
  // The third coordinate: how load-bearing each file is. Derived from the same
  // edges the layout used, so it needs no extra pass over anything, and
  // measured at 7 ms on svelte's 4,059 nodes.
  const { layers } = computeElevations(orderedPaths.length, edges);

  const regions: Region[] = detected.map((region) => {
    let sumX = 0;
    let sumY = 0;
    for (const member of region.members) {
      const point = positions[member] ?? [0, 0];
      sumX += point[0];
      sumY += point[1];
    }
    const size = Math.max(1, region.members.length);
    return {
      id: region.id,
      label: region.label,
      nodeCount: region.members.length,
      centroid: [round2(sumX / size), round2(sumY / size)] as const,
      kind: region.kind,
    };
  });

  // ---- nodes ------------------------------------------------------------
  const byPath = new Map(walked.files.map((file) => [file.path, file]));
  const nodes: AtlasNode[] = orderedPaths.map((path, ref) => {
    const file = byPath.get(path);
    const fileHistory = history.perFile.get(path);
    const unresolved = capped(unresolvedByPath.get(path) ?? [], MAX_UNRESOLVED_PER_NODE);
    const exported = capped(exportsByPath.get(path) ?? [], MAX_EXPORTS_PER_NODE);
    unresolvedDropped += unresolved.dropped;
    exportsDropped += exported.dropped;
    return {
      id: idByPath.get(path) ?? nodeIdFor(path),
      path,
      originPath: originByPath.get(path) ?? path,
      kind: 'file',
      lang: file?.lang ?? 'other',
      loc: file?.loc ?? 0,
      bytes: file?.bytes ?? 0,
      layout: positions[ref] ?? [0, 0],
      elevation: layers[ref] ?? 0,
      region: regionByRef.get(ref) ?? 'root',
      exports: exported.kept,
      unresolved: unresolved.kept,
      externals: dedupeSorted(externalsByPath.get(path) ?? []),
      lineage: fileHistory?.contested === true ? 'contested' : 'certain',
      churn: fileHistory?.churn ?? 0,
      authors: fileHistory?.authors ?? 0,
      firstSeen: fileHistory?.firstSeen ?? null,
      lastSeen: fileHistory?.lastSeen ?? null,
    };
  });

  // ---- history, projected onto node indices -----------------------------
  const coChange: CoChangePair[] = [];
  for (const [a, b, count] of history.coChange) {
    const refA = refByPath.get(a);
    const refB = refByPath.get(b);
    if (refA === undefined || refB === undefined || refA === refB) continue;
    coChange.push(refA < refB ? [refA, refB, count] : [refB, refA, count]);
  }
  coChange.sort(coChangeOrder);

  const commits: CommitRecord[] = history.commits.map((commit) => ({
    sha: commit.sha,
    date: commit.date,
    subject: commit.subject,
    files: commit.files
      .map((path) => refByPath.get(path))
      .filter((ref): ref is number => ref !== undefined)
      .sort((x, y) => x - y),
    wide: commit.wide,
    issue: commit.issue,
  }));

  // ---- report -----------------------------------------------------------
  const truncations: Truncation[] = [...history.truncations];
  if (unresolvedDropped > 0) {
    truncations.push({ what: 'unresolved', kept: MAX_UNRESOLVED_PER_NODE, dropped: unresolvedDropped });
  }
  if (exportsDropped > 0) {
    truncations.push({ what: 'exports', kept: MAX_EXPORTS_PER_NODE, dropped: exportsDropped });
  }
  truncations.sort((a, b) => byteCompare(a.what, b.what));

  const languages = [...new Set(nodes.map((node) => node.lang))].sort(byteCompare) as Lang[];
  const skipped: SkipCount[] = [...walked.skipped];

  const draft: Atlas = {
    version: ATLAS_VERSION,
    repo: {
      name: configIndex.for('package.json').name ?? basename(options.root),
      head: git.head,
      headDate: git.headDate,
      root: git.root,
      languages,
      fileCount: nodes.length,
      tool: TOOL,
    },
    nodes,
    edges,
    regions,
    history: {
      present: git.present,
      commitsWalked: history.commitsWalked,
      commitsRetained: commits.length,
      window: history.window,
      // Part of the contract, not a budget: it changes what the numbers in
      // `coChange` mean, and Companion has to be able to tell the player the
      // rule they are graded under.
      wideLimit: options.history.wideCommitFiles,
      coChange,
      commits,
    },
    // Filled in below. Generation reads the finished graph, so it needs an
    // atlas to run against — and running it against a *validated* draft means
    // a bug in the graph surfaces before it can reach an answer key.
    challenges: [],
    report: { truncations, skipped },
  };

  // Fail here rather than in the player (guardrail 5).
  const validated = validateAtlas(draft);

  // **The cap is per verb, deliberately.** `maxChallengesFor` scales the deck
  // with the repo so a 2,000-file codebase is not exhausted in one sitting; a
  // shared budget would make the second verb's coverage depend on how much
  // supply the first happened to find, which is backwards — the whole measured
  // argument for Companion is that it reaches files Blast Radius cannot. The
  // cost is bounded: a challenge serialises to roughly 600 bytes, so two full
  // decks at 2,000 files is ~300 KiB against a 5 MB ceiling.
  const blast = generateWithReport(validated, options.generate);
  const companionResult = generateCompanionWithReport(validated, options.generate);
  const challenges = [...blast.challenges, ...companionResult.challenges].sort((a, b) =>
    byteCompare(a.id, b.id),
  );

  return {
    atlas: validateAtlas({ ...validated, challenges }),
    generation: { blastRadius: blast, companion: companionResult },
  };
}

/** The atlas alone, for callers that do not care how generation went. */
export async function buildAtlas(options: IndexOptions): Promise<Atlas> {
  return (await buildIndex(options)).atlas;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(byteCompare);
}

function capped(values: readonly string[], limit: number): { kept: string[]; dropped: number } {
  const unique = dedupeSorted(values);
  if (unique.length <= limit) return { kept: unique, dropped: 0 };
  return { kept: unique.slice(0, limit), dropped: unique.length - limit };
}
