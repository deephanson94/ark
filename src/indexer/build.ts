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
import { DEFAULT_LAYOUT_OPTIONS, computeLayout } from './layout.js';
import type { LayoutOptions } from './layout.js';
import { detectRegions } from './regions.js';
import { loadProjectConfig, resolveSpecifier } from './resolve.js';
import { scanModule } from './scan.js';
import { DEFAULT_WALK_OPTIONS, walk } from './walk.js';
import type { WalkOptions } from './walk.js';

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
  /** Upper bound on commits read from git, before retention. */
  readonly maxCommitsWalked: number;
}

export const DEFAULT_INDEX_OPTIONS: Omit<IndexOptions, 'root'> = {
  walk: DEFAULT_WALK_OPTIONS,
  history: DEFAULT_HISTORY_LIMITS,
  layout: DEFAULT_LAYOUT_OPTIONS,
  maxCommitsWalked: 20000,
};

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

export async function buildAtlas(options: IndexOptions): Promise<Atlas> {
  const walked = await walk({ root: options.root, ...options.walk });
  const config = await loadProjectConfig(options.root);
  const paths = walked.files.map((file) => file.path);
  const indexed = new Set(paths);
  const context = { indexed, onDisk: walked.onDisk, config };

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
      region: regionByRef.get(ref) ?? 'root',
      exports: exported.kept,
      unresolved: unresolved.kept,
      externals: dedupeSorted(externalsByPath.get(path) ?? []),
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

  const atlas: Atlas = {
    version: ATLAS_VERSION,
    repo: {
      name: config.name ?? basename(options.root),
      head: git.head,
      headDate: git.headDate,
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
      coChange,
      commits,
    },
    // M0 ships the schema and the verb contracts; generation lands with the
    // Blast Radius verb at M2. An empty set is valid and honest.
    challenges: [],
    report: { truncations, skipped },
  };

  // Fail here rather than in the player (guardrail 5).
  return validateAtlas(atlas);
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
