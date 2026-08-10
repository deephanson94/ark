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
  Challenge,
  CoChangePair,
  CommitRecord,
  Confidence,
  EdgeKind,
  Lang,
  NodeKind,
  Region,
  SkipCount,
  Truncation,
} from '../atlas/index.js';
import {
  ATLAS_VERSION,
  buildGraph,
  byteCompare,
  coChangeOrder,
  edgeOrder,
  nodeIdFor,
  round2,
  sourceCoverage,
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
import { scanGoModule } from './goscan.js';
import { goPackageDir, isGoMod, loadGoModules, resolveGoImport } from './gomod.js';
import { scanPyModule } from './pyscan.js';
import { loadPyContext, resolvePyImport } from './pyroot.js';
import { DEFAULT_WALK_OPTIONS, walk } from './walk.js';
import type { WalkOptions, WalkedFile } from './walk.js';
import type { GenerationResult } from '../verbs/blastRadius/index.js';
import { generateWithReport } from '../verbs/blastRadius/index.js';
import type { GenerationResult as CompanionResult } from '../verbs/companion/index.js';
import { generateWithReport as generateCompanionWithReport } from '../verbs/companion/index.js';
import type { GenerationResult as PlacementResult } from '../verbs/placement/index.js';
import { generateWithReport as generatePlacementWithReport } from '../verbs/placement/index.js';
import type { GenerationResult as ArchaeologyResult } from '../verbs/archaeology/index.js';
import { generateWithReport as generateArchaeologyWithReport } from '../verbs/archaeology/index.js';
import type { DisclosedFact, GenerateOptions, Verb } from '../verbs/index.js';
import { DEFAULT_GENERATE_OPTIONS, accumulate } from '../verbs/index.js';
import { blastRadius } from '../verbs/blastRadius/index.js';
import { companion } from '../verbs/companion/index.js';
import { placement } from '../verbs/placement/index.js';
import { archaeology } from '../verbs/archaeology/index.js';

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
  /**
   * What each verb shipped and what it refused to. Printed by the CLI.
   *
   * **`null` when the whole deck was refused** (ADR-0025) — not four empty
   * reports, because "this verb found nothing to ask about" and "nobody asked
   * this verb" are different facts and only one of them is about the verb. The
   * generators are not run at all in that case, which is also why a repo ark
   * cannot read now indexes faster rather than slower.
   */
  readonly generation: {
    readonly blastRadius: GenerationResult;
    readonly companion: CompanionResult;
    readonly placement: PlacementResult;
    readonly archaeology: ArchaeologyResult;
  } | null;
}

export function indexOptions(root: string, overrides: Partial<IndexOptions> = {}): IndexOptions {
  return { root, ...DEFAULT_INDEX_OPTIONS, ...overrides };
}

interface PendingEdge {
  readonly fromKey: string;
  readonly toKey: string;
  readonly kind: EdgeKind;
  confidence: Confidence;
  readonly specifiers: Set<string>;
}

/**
 * Which node a walked file belongs to, and what that node is.
 *
 * **This is the whole of mixed granularity.** Every language ark reads is
 * file-granular except Go, whose unit of import is the package — a directory —
 * because a Go file references its own package's siblings with no import
 * statement at all. At file granularity those edges are invisible *and*
 * offered as wrong answers (ADR-0024 §6.1); as one node the reference is
 * inside a node and the class cannot be expressed. ADR-0026.
 *
 * Everything downstream reads a key and a kind and never asks which language
 * produced them.
 */
function nodeKeyOf(file: {
  readonly path: string;
  readonly lang: Lang;
}): { readonly key: string; readonly kind: NodeKind } {
  if (file.lang === 'go') return { key: goPackageDir(file.path), kind: 'dir' };
  return { key: file.path, kind: 'file' };
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

  // ---- node grouping ----------------------------------------------------
  const keyByPath = new Map<string, string>();
  const kindByKey = new Map<string, NodeKind>();
  const membersByKey = new Map<string, WalkedFile[]>();
  for (const file of walked.files) {
    const { key, kind } = nodeKeyOf(file);
    keyByPath.set(file.path, key);
    kindByKey.set(key, kind);
    const bucket = membersByKey.get(key);
    if (bucket === undefined) membersByKey.set(key, [file]);
    else bucket.push(file);
  }
  // `walked.files` is sorted by path, so each bucket is too, and every
  // aggregate below (loc, the origin vote, the export union) reads them in the
  // same order on every machine.
  const nodeKeys = [...membersByKey.keys()];
  const goPackages = new Set(
    nodeKeys.filter((key) => membersByKey.get(key)?.[0]?.lang === 'go'),
  );

  const pyContext = await loadPyContext({
    root: options.root,
    pythonPaths: walked.files.filter((file) => file.lang === 'py').map((file) => file.path),
    onDisk: walked.onDisk,
  });

  const goModules = await loadGoModules(options.root, [...walked.onDisk].filter(isGoMod));
  const goContext = {
    packages: goPackages,
    moduleFor: (path: string) => goModules.moduleFor(path),
    modules: goModules.modules,
  };
  const context = {
    // `indexed` is "paths that became nodes", and a `.go` file does not — its
    // package does. Leaving them in would let an ES specifier name a Go file
    // and produce an edge to something with no `NodeRef`, which the edge loop
    // would then drop in silence.
    indexed: new Set(paths.filter((path) => keyByPath.get(path) === path)),
    onDisk: walked.onDisk,
    configFor: (path: string) => configIndex.for(path),
    workspaceNames: configIndex.workspaceNames,
  };

  // ---- scan and resolve -------------------------------------------------
  const unresolvedByKey = new Map<string, string[]>();
  const externalsByKey = new Map<string, string[]>();
  const exportsByKey = new Map<string, string[]>();
  const pending = new Map<string, PendingEdge>();
  let unresolvedDropped = 0;
  let exportsDropped = 0;

  const addEdge = (
    fromKey: string,
    toKey: string,
    kind: EdgeKind,
    confidence: Confidence,
    specifier: string,
  ): void => {
    const key = `${fromKey}\n${toKey}\n${kind}`;
    const existing = pending.get(key);
    if (existing === undefined) {
      pending.set(key, { fromKey, toKey, kind, confidence, specifiers: new Set([specifier]) });
    } else {
      existing.specifiers.add(specifier);
      if (confidence === 'probable') existing.confidence = 'probable';
    }
  };

  for (const file of walked.files) {
    if (file.source === null) continue;
    const from = keyByPath.get(file.path) ?? file.path;

    if (file.lang === 'go') {
      const facts = scanGoModule(file.source);
      pushAll(exportsByKey, from, facts.exports);
      for (const reference of facts.imports) {
        const resolution = resolveGoImport(file.path, reference.specifier, goContext);
        switch (resolution.kind) {
          case 'internal':
            // A Go import path names one directory exactly — no extension
            // guessing, no index file — so there is no `probable` arm to have.
            // A self-edge here is `foo_test` importing `foo`, which package
            // granularity has already made one node; the edge loop drops it.
            addEdge(from, resolution.dir, 'import', 'certain', reference.specifier);
            break;
          case 'external':
            push(externalsByKey, from, resolution.name);
            break;
          case 'unresolved':
            push(unresolvedByKey, from, reference.specifier);
            break;
        }
      }
      continue;
    }

    if (file.lang === 'py') {
      const facts = scanPyModule(file.source);
      pushAll(exportsByKey, from, facts.exports);
      for (const reference of facts.imports) {
        // **One site, several targets.** `from django.db import models` depends
        // on `django/db/__init__.py` *and* on `django/db/models/__init__.py`;
        // dropping either is a missing edge, which is the class ADR-0026 §4.1
        // says no atlas-derived check can see.
        for (const resolution of resolvePyImport(file.path, reference, pyContext)) {
          switch (resolution.kind) {
            case 'internal':
              if (resolution.path === file.path) break; // `from . import x` inside `__init__.py`
              addEdge(from, resolution.path, 'import', resolution.confidence, reference.raw);
              break;
            case 'external':
              push(externalsByKey, from, resolution.name);
              break;
            case 'unresolved':
              // Every site that does not place leaves something here, including
              // the computed `import_module(expr)` arm. A silently dropped
              // import is worse than a wrong one (CLAUDE.md), and it is the one
              // thing guardrail 4 cannot survive.
              push(unresolvedByKey, from, reference.raw);
              break;
          }
        }
      }
      continue;
    }

    const facts = scanModule(file.source);
    pushAll(exportsByKey, from, facts.exports);

    for (const reference of facts.imports) {
      if (reference.specifier === null) {
        push(unresolvedByKey, from, reference.raw);
        continue;
      }
      const resolution = resolveSpecifier(file.path, reference.specifier, context);
      switch (resolution.kind) {
        case 'internal': {
          if (resolution.path === file.path) break; // a file importing itself
          addEdge(
            from,
            keyByPath.get(resolution.path) ?? resolution.path,
            reference.kind,
            resolution.confidence,
            reference.specifier,
          );
          break;
        }
        case 'external':
          push(externalsByKey, from, resolution.name);
          break;
        case 'offMap':
          break;
        case 'unresolved':
          push(unresolvedByKey, from, reference.raw);
          break;
      }
    }
  }

  // **A member the walk could not read leaves its node incomplete.** A file we
  // meant to parse and dropped for size or for a NUL byte contributes no
  // imports, so the node that owns it has outgoing edges we know are missing.
  // At file granularity that was harmless — the file never became a node, so
  // nothing could depend on it, and an import *pointing at* it already resolves
  // `unresolved` through `onDisk`. A node standing for a **directory** keeps
  // existing, which is how a 600 KiB generated `.pb.go` would turn its package
  // into a certified non-dependent of whatever it imports. Guardrail 4 refuses
  // instead, and the marker says which file did it.
  for (const file of walked.dropped) {
    // `keyByPath` cannot answer this — a dropped file is not in `walked.files`.
    // Only a *grouped* node is at risk: a file node the walk dropped never
    // became a node at all, and an import pointing at it already resolves
    // `unresolved` through `onDisk`.
    // **Python needs nothing here, and that was checked rather than assumed.**
    // A `.py` file is its own node, so a dropped one never becomes a node at
    // all — and `pyroot.ts` resolves a module name against the *indexed* files,
    // so an import naming a dropped file finds nothing, falls past the stdlib
    // and dependency tables, and lands on `unresolved`. The guard below is for
    // *grouped* nodes, which is Go and nothing else today.
    const { key } = nodeKeyOf(file);
    if (key !== file.path && membersByKey.has(key)) {
      push(unresolvedByKey, key, `${file.path} (not read)`);
    }
  }

  // ---- history ----------------------------------------------------------
  const git = await readGitHistory(options.root, options.maxCommitsWalked);
  const history = buildHistory(git, paths, (path) => keyByPath.get(path) ?? path, options.history);

  // ---- identity and node order -----------------------------------------
  const filesByKey = new Map(
    [...membersByKey].map(([key, files]) => [key, files.map((file) => file.path)]),
  );
  const originByKey = claimOrigins(nodeKeys, filesByKey, goPackages, history.originByFile);

  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();
  for (const key of nodeKeys) {
    const origin = originByKey.get(key) ?? key;
    const id = nodeIdFor(origin);
    const clash = keyById.get(id);
    if (clash !== undefined) {
      throw new Error(`node id collision: ${origin} and ${originByKey.get(clash)} both hash to ${id}`);
    }
    idByKey.set(key, id);
    keyById.set(id, key);
  }

  const orderedKeys = [...nodeKeys].sort((a, b) =>
    byteCompare(idByKey.get(a) ?? '', idByKey.get(b) ?? ''),
  );
  const refByPath = new Map<string, number>();
  for (const [ref, key] of orderedKeys.entries()) refByPath.set(key, ref);

  // ---- edges ------------------------------------------------------------
  const edges: AtlasEdge[] = [];
  for (const edge of pending.values()) {
    const from = refByPath.get(edge.fromKey);
    const to = refByPath.get(edge.toKey);
    if (from === undefined || to === undefined || from === to) continue;
    edges.push({ from, to, kind: edge.kind, confidence: edge.confidence, weight: edge.specifiers.size });
  }
  edges.sort(edgeOrder);

  // ---- regions and layout ----------------------------------------------
  const detected = detectRegions(orderedKeys, edges);
  const regionByRef = new Map<number, string>();
  for (const region of detected) {
    for (const member of region.members) regionByRef.set(member, region.id);
  }

  // Regions before layout, so the layout can pull each cluster together.
  const groupByRef = new Array<number>(orderedKeys.length).fill(0);
  for (const [index, region] of detected.entries()) {
    for (const member of region.members) groupByRef[member] = index;
  }
  const positions = computeLayout(orderedKeys.length, edges, options.layout, groupByRef);
  // The third coordinate: how load-bearing each file is. Derived from the same
  // edges the layout used, so it needs no extra pass over anything, and
  // measured at 7 ms on svelte's 4,059 nodes.
  const { layers } = computeElevations(orderedKeys.length, edges);

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
  const nodes: AtlasNode[] = orderedKeys.map((key, ref) => {
    const members = membersByKey.get(key) ?? [];
    const nodeHistory = history.perNode.get(key);
    const unresolved = capped(unresolvedByKey.get(key) ?? [], MAX_UNRESOLVED_PER_NODE);
    const exported = capped(exportsByKey.get(key) ?? [], MAX_EXPORTS_PER_NODE);
    unresolvedDropped += unresolved.dropped;
    exportsDropped += exported.dropped;
    return {
      id: idByKey.get(key) ?? nodeIdFor(key),
      path: key,
      originPath: originByKey.get(key) ?? key,
      kind: kindByKey.get(key) ?? 'file',
      // Every member of a node shares its language by construction. The key is
      // a *path* — a directory for Go, the file itself otherwise — and the
      // reason one key never mixes languages is that only Go groups: a `dir`
      // key can be reached by `.go` files alone, and every other key is one
      // file. A second grouped language would have to keep that true.
      lang: members[0]?.lang ?? 'other',
      fileCount: members.length,
      loc: members.reduce((total, file) => total + file.loc, 0),
      bytes: members.reduce((total, file) => total + file.bytes, 0),
      layout: positions[ref] ?? [0, 0],
      elevation: layers[ref] ?? 0,
      region: regionByRef.get(ref) ?? 'root',
      exports: exported.kept,
      unresolved: unresolved.kept,
      externals: dedupeSorted(externalsByKey.get(key) ?? []),
      lineage: nodeHistory?.contested === true ? 'contested' : 'certain',
      churn: nodeHistory?.churn ?? 0,
      authors: nodeHistory?.authors ?? 0,
      firstSeen: nodeHistory?.firstSeen ?? null,
      lastSeen: nodeHistory?.lastSeen ?? null,
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
      nodeCount: nodes.length,
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
    report: { truncations, skipped, unreadable: walked.unreadable },
  };

  // Fail here rather than in the player (guardrail 5).
  const validated = validateAtlas(draft);

  // **The map ships; the deck does not, when the map is not of this repository.**
  // ADR-0025. Every question below would be graded against ground truth and
  // every answer key would be right — and the whole set would be about the
  // files ark happens to be able to read, which on a Go or Python repo is its
  // documentation. That reads as success, which is worse than an empty deck
  // saying why. The rule is `sourceCoverage`'s and lives in `src/atlas/` because
  // the player states the same fact to the same person.
  const coverage = sourceCoverage(validated);
  if (coverage.deckRefused) return { atlas: validated, generation: null };

  // **The cap is per verb, deliberately.** `maxChallengesFor` scales the deck
  // with the repo so a 2,000-file codebase is not exhausted in one sitting; a
  // shared budget would make the second verb's coverage depend on how much
  // supply the first happened to find, which is backwards — the whole measured
  // argument for Companion is that it reaches files Blast Radius cannot. The
  // cost is bounded: a challenge serialises to roughly 600 bytes, so three full
  // decks at 2,000 files is ~450 KiB against a 5 MB ceiling.
  //
  // **Generation order is load-bearing now, where it used to be arbitrary.**
  // ADR-0019 decision 7: a fact an earlier reveal already states is not a
  // question a later verb may ask, and the tie-break is first-come — so the
  // order of these calls decides which verb keeps a shared fact. Placement runs
  // before Archaeology and therefore keeps the commit-membership atoms its
  // reveal names; Archaeology yields, and `report.skipped`'s `disclosed` entry
  // says how many subjects that cost — a number in the output rather than a
  // counterfactual somebody has to re-run.
  //
  // The accumulator is verb-blind: each verb declares what its own reveal gives
  // away (`Verb.discloses`), this loop collects the declarations, and a later
  // generator reads a set of opaque strings rather than another verb's deck.
  // Nothing here interprets a fact, and nothing downstream names a verb.
  const disclosed = new Set<DisclosedFact>();
  // One graph for every declaration below. `decidedBy` scores a guess against
  // the repo's own relations, which a `Challenge` alone does not carry.
  const declaring = buildGraph(validated);
  const run = <R extends { readonly challenges: readonly Challenge[] }>(
    verb: Verb,
    generate: (atlas: Atlas, options: GenerateOptions) => R,
  ): R => {
    const result = generate(validated, { ...options.generate, disclosed });
    accumulate(disclosed, result.challenges, (c) => verb.discloses(c));
    // The second channel, and it runs in the same order for the same reason:
    // a verdict is only useful to a verb that has not generated yet (ADR-0022).
    accumulate(disclosed, result.challenges, (c) => verb.decidedBy(declaring, c));
    return result;
  };

  const blast = run(blastRadius, generateWithReport);
  const companionResult = run(companion, generateCompanionWithReport);
  const placementResult = run(placement, generatePlacementWithReport);
  const archaeologyResult = run(archaeology, generateArchaeologyWithReport);
  const challenges = [
    ...blast.challenges,
    ...companionResult.challenges,
    ...placementResult.challenges,
    ...archaeologyResult.challenges,
  ].sort((a, b) => byteCompare(a.id, b.id));

  return {
    atlas: validateAtlas({ ...validated, challenges }),
    generation: {
      blastRadius: blast,
      companion: companionResult,
      placement: placementResult,
      archaeology: archaeologyResult,
    },
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

function pushAll(map: Map<string, string[]>, key: string, values: readonly string[]): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [...values]);
  else bucket.push(...values);
}

/**
 * Each node's `originPath` — the thing its identity hashes (ADR-0002).
 *
 * For a file node this is git's answer and nothing more. For a node standing
 * for a directory there is no git answer to have: **git records renames of
 * files, never of directories**, so moving a package shows up as N file
 * renames and the package's own lineage has to be read off them. The rule is
 * the plurality of the members' origin directories, which survives the case
 * that matters — a package moved wholesale, then given a new file, whose own
 * origin is its current path.
 *
 * **Collisions are resolved, not thrown.** The previous version of this loop
 * threw on two nodes proposing one origin, which was safe while every node was
 * a file: `applyRenames` guarantees two live *files* never claim one historical
 * path. A package **split** breaks that — carve `pkg/b` out of `pkg/a` and both
 * live packages trace back to `pkg/a` — and that is an ordinary refactor, not a
 * corrupt repo. So the rule is ADR-0002's own: first claimant in a fixed order
 * keeps it, the loser keeps its current path, and a node's own key can never be
 * taken from it.
 */
export function claimOrigins(
  nodeKeys: readonly string[],
  filesByKey: ReadonlyMap<string, readonly string[]>,
  grouped: ReadonlySet<string>,
  originByFile: ReadonlyMap<string, string>,
): Map<string, string> {
  const ordered = [...nodeKeys].sort(byteCompare);
  const proposals = new Map<string, string>();
  for (const key of ordered) {
    const members = filesByKey.get(key) ?? [];
    if (!grouped.has(key)) {
      proposals.set(key, originByFile.get(members[0] ?? key) ?? key);
      continue;
    }
    proposals.set(key, votedDirectory(members, originByFile, key));
  }

  const live = new Set(ordered);
  const taken = new Set<string>();
  const origins = new Map<string, string>();
  // A node's own key is never available to anybody else — `live` blocks it —
  // so a rename cannot take a live node's identity away from it. There used to
  // be a first pass settling self-claims before this loop; it was a **no-op on
  // every input**, because the `!live.has` test below already produces the same
  // answer for them, and the comment on it claimed to enforce an invariant this
  // line enforces. A guard that cannot change an outcome is worse than none.
  for (const key of ordered) {
    const proposed = proposals.get(key) ?? key;
    const free = proposed !== key && !live.has(proposed) && !taken.has(proposed);
    origins.set(key, free ? proposed : key);
    taken.add(free ? proposed : key);
  }
  return origins;
}

/**
 * The directory a **strict majority** of these files came from, or the node's
 * own key when there is no majority.
 *
 * **A plurality with a byte-order tie-break was the first rule, and it decided
 * real identities by coin flip.** Measured across hugo and prometheus: 316
 * packages, 28 of which trace somewhere other than their own directory — and
 * **15 of the votes are ties**, including `hugolib/versions` splitting 1–1
 * between `hugolib/doctree` and itself, and `langs` splitting 2–2 with
 * `helpers`. A tie-break picks one, and *the other one wins as soon as either
 * side gains a file* — which changes the node's id and silently drops every
 * pass the player has saved against it, the exact asset ADR-0002 exists to
 * protect.
 *
 * A majority cannot tie. It still moves if membership changes enough to shift
 * it, and that residual is stated in ADR-0026 rather than argued away: a `dir`
 * node's identity is inferred where a file node's is recorded.
 */
function votedDirectory(
  members: readonly string[],
  originByFile: ReadonlyMap<string, string>,
  fallback: string,
): string {
  const votes = new Map<string, number>();
  for (const path of members) {
    const directory = goPackageDir(originByFile.get(path) ?? path);
    votes.set(directory, (votes.get(directory) ?? 0) + 1);
  }
  for (const directory of [...votes.keys()].sort(byteCompare)) {
    if ((votes.get(directory) ?? 0) * 2 > members.length) return directory;
  }
  return fallback;
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(byteCompare);
}

function capped(values: readonly string[], limit: number): { kept: string[]; dropped: number } {
  const unique = dedupeSorted(values);
  if (unique.length <= limit) return { kept: unique, dropped: 0 };
  return { kept: unique.slice(0, limit), dropped: unique.length - limit };
}
