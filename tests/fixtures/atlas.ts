/**
 * Fixture atlases for tests that need a graph but not a repo.
 *
 * Everything built here goes through `validateAtlas` before it is returned, so
 * a fixture can never quietly drift out of schema and make a test pass for the
 * wrong reason.
 */

import type { Atlas, AtlasEdge, AtlasNode, Challenge, Graph, Lang } from '../../src/atlas/index.js';
import type { Words } from '../../src/verbs/index.js';
import { wordsFor } from '../../src/verbs/index.js';
import {
  ATLAS_VERSION,
  byteCompare,
  edgeOrder,
  encodeWitness,
  nodeIdFor,
  validateAtlas,
} from '../../src/atlas/index.js';
import { computeElevations } from '../../src/indexer/elevation.js';

const LANG_BY_EXTENSION: Readonly<Record<string, Lang>> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  json: 'json',
  md: 'md',
};

function langOf(path: string): Lang {
  const extension = path.slice(path.lastIndexOf('.') + 1);
  return LANG_BY_EXTENSION[extension] ?? 'other';
}

export type NodeMapper = (node: AtlasNode) => AtlasNode;
export type EdgeMapper = (edge: AtlasEdge, fromPath: string, toPath: string) => AtlasEdge;

/**
 * Build a minimal valid atlas from paths and `[importer, imported]` pairs.
 * All nodes land in one region, positions are a line, and there is no history.
 */
export function atlasWith(
  paths: readonly string[],
  links: readonly (readonly [string, string])[] = [],
  mapNode: NodeMapper = (node) => node,
  mapEdge: EdgeMapper = (edge) => edge,
): Atlas {
  const ordered = [...paths].sort((a, b) => byteCompare(nodeIdFor(a), nodeIdFor(b)));
  const refByPath = new Map(ordered.map((path, ref) => [path, ref]));

  // Edges first, so elevation can be derived here exactly as the indexer
  // derives it. A fixture that hard-coded `elevation: 0` would let a test pass
  // against a value the real pipeline never produces.
  const edges: AtlasEdge[] = [];
  for (const [fromPath, toPath] of links) {
    const from = refByPath.get(fromPath);
    const to = refByPath.get(toPath);
    if (from === undefined || to === undefined) {
      throw new Error(`fixture links an unknown path: ${fromPath} -> ${toPath}`);
    }
    edges.push(mapEdge({ from, to, kind: 'import', confidence: 'certain', weight: 1 }, fromPath, toPath));
  }
  edges.sort(edgeOrder);
  const { layers } = computeElevations(ordered.length, edges);

  const nodes: AtlasNode[] = ordered.map((path, ref) =>
    mapNode({
      id: nodeIdFor(path),
      path,
      originPath: path,
      kind: 'file',
      lang: langOf(path),
      fileCount: 1,
      loc: 10,
      bytes: 100,
      layout: [ref * 10, 0],
      elevation: layers[ref] ?? 0,
      region: 'test',
      exports: [],
      unresolved: [],
      externals: [],
      lineage: 'certain',
      churn: 0,
      authors: 0,
      firstSeen: null,
      lastSeen: null,
    }),
  );

  const languages = [...new Set(nodes.map((node) => node.lang))].sort(byteCompare);

  return validateAtlas({
    version: ATLAS_VERSION,
    repo: {
      name: 'fixture',
      head: null,
      headDate: null,
      root: null,
      languages,
      nodeCount: nodes.length,
      tool: 'ark@test',
    },
    nodes,
    edges,
    regions: [
      { id: 'test', label: 'test', nodeCount: nodes.length, centroid: [0, 0], kind: 'topology' },
    ],
    history: {
      present: false,
      commitsWalked: 0,
      commitsRetained: 0,
      window: null,
      wideLimit: 25,
      coChange: [],
      commits: [],
    },
    challenges: [],
    report: { truncations: [], skipped: [], unreadable: [] },
  });
}

/**
 * A valid challenge over the first four nodes of `atlas`: node 0 is the
 * subject, nodes 1–3 the choice set, node 1 the answer.
 */
export function challengeFor(atlas: Atlas, overrides: Partial<Challenge> = {}): Challenge {
  const ids = atlas.nodes.map((node) => node.id);
  const [subject, ...rest] = ids;
  if (subject === undefined || rest.length < 2) {
    throw new Error('challengeFor needs an atlas with at least three nodes');
  }
  const candidates = [...rest].sort(byteCompare);
  const answer = candidates[0];
  if (answer === undefined) throw new Error('unreachable');
  const base: Challenge = {
    id: 'fixture-01',
    verb: 'blastRadius',
    tier: 3,
    difficulty: 0.5,
    subject,
    candidates,
    truth: [answer],
    witness: '',
    evidence: { kind: 'importGraph', depth: 2 },
    ...overrides,
  };
  if (overrides.witness !== undefined) return base;
  // Derived **after** the overrides, because the witness is positionally aligned
  // with `candidates` and a caller that changes the choice set would otherwise
  // get a fixture the validator rejects for a reason that has nothing to do with
  // the test.
  return { ...base, witness: witnessFor(base.candidates, base.truth) };
}

/**
 * A witness labelling every non-answer with one strategy, aligned by
 * construction.
 *
 * The default is `distant`, which is the one label ADR-0020 never speaks aloud —
 * so a test that wants a witness *sentence* has to name the class it wants,
 * rather than inheriting one and then asserting against what it inherited.
 */
export function witnessFor(
  candidates: readonly string[],
  truth: readonly string[],
  strategy = 'distant',
): string {
  const answers = new Set(truth);
  return encodeWitness(
    candidates,
    new Map(candidates.filter((id) => !answers.has(id)).map((id) => [id, strategy])),
  );
}

/** The same atlas with one challenge attached. */
export function atlasWithChallenge(atlas: Atlas, overrides: Partial<Challenge> = {}): Atlas {
  return validateAtlas({ ...atlas, challenges: [challengeFor(atlas, overrides)] });
}

/**
 * A `Words` for a test that has a graph — the same vocabulary the player uses.
 *
 * Tests that only need a prompt's shape can use `plainWords`, which answers
 * "file" for everything; a test that cares what the noun *is* must build a real
 * graph, because that is the fact the noun comes from.
 */
/**
 * An atlas holding **both** kinds of node — Go packages and files.
 *
 * `atlasWith` derives every node's kind from its extension, which is right for
 * a repo of files and cannot express a `dir` node. A noun is a fact about the
 * kind, so a fixture that could not hold a package would test nothing.
 */
export function goAtlas(): Atlas {
  const packages = new Set(['.', 'store', 'web']);
  return atlasWith(
    ['.', 'store', 'web', 'web/client.ts', 'README.md'],
    [
      ['.', 'store'],
      ['web', 'store'],
    ],
    (node) =>
      packages.has(node.path)
        ? { ...node, kind: 'dir', lang: 'go', fileCount: 2 }
        : node,
  );
}

export function wordsOf(graph: Graph): Words {
  return wordsFor(graph);
}

/** Every id is a file. For tests asserting a prompt's shape, not its nouns. */
export const plainWords: Words = {
  label: (id) => id,
  noun: () => ({ one: 'file', many: 'files' }),
  repo: { one: 'file', many: 'files' },
};
