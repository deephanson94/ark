/**
 * The bootstrap fixture: index *this* repo and assert the result is sound.
 *
 * NORTH-STAR §11 — v1's only target repo is Ark itself, so this file is both
 * the integration test and the first level. If it breaks, the product does not
 * work on the one codebase we understand completely.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import {
  buildGraph,
  dependents,
  parseAtlas,
  serializeAtlas,
  validateAtlas,
} from '../../src/atlas/index.js';
import { TOOL, buildAtlas, indexOptions } from '../../src/indexer/build.js';
import { isGameable, scoreSet } from '../../src/verbs/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** CLAUDE.md budgets, measured rather than estimated. */
const MAX_ATLAS_BYTES = 5 * 1024 * 1024;
const MAX_INDEX_MS = 10_000;

let atlas: Atlas;
let serialized: string;
let elapsedMs: number;

beforeAll(async () => {
  const started = Date.now();
  atlas = await buildAtlas(indexOptions(ROOT));
  elapsedMs = Date.now() - started;
  serialized = serializeAtlas(atlas);
}, 60_000);

describe('the atlas for this repo', () => {
  it('has real content, not an empty shell', () => {
    expect(atlas.nodes.length).toBeGreaterThan(15);
    expect(atlas.edges.length).toBeGreaterThan(20);
    expect(atlas.regions.length).toBeGreaterThan(0);
  });

  it('is schema-valid', () => {
    expect(() => validateAtlas(JSON.parse(serialized))).not.toThrow();
    expect(parseAtlas(serialized).nodes).toHaveLength(atlas.nodes.length);
  });

  it('reports the indexer version that package.json declares', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(TOOL).toBe(`${manifest.name}@${manifest.version}`);
    expect(atlas.repo.tool).toBe(TOOL);
  });

  it('carries no wall-clock time, so the same repo gives the same bytes', () => {
    // ADR-0001. A timestamp anywhere in here would make `test:determinism`
    // impossible to satisfy and spatial memory impossible to keep.
    const thisYear = String(new Date().getUTCFullYear());
    const dates = serialized.match(/\d{4}-\d{2}-\d{2}T/g);
    expect(dates).toBeNull();
    expect(atlas.repo.headDate === null || atlas.repo.headDate <= `${thisYear}-12-31`).toBe(true);
  });
});

describe('graph integrity', () => {
  it('has no dangling edges', () => {
    for (const edge of atlas.edges) {
      expect(atlas.nodes[edge.from]).toBeDefined();
      expect(atlas.nodes[edge.to]).toBeDefined();
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it('has no duplicate node ids or paths', () => {
    expect(new Set(atlas.nodes.map((node) => node.id)).size).toBe(atlas.nodes.length);
    expect(new Set(atlas.nodes.map((node) => node.path)).size).toBe(atlas.nodes.length);
  });

  it('indexes no file from an excluded directory', () => {
    for (const node of atlas.nodes) {
      expect(node.path).not.toMatch(/(^|\/)(node_modules|dist|\.git)\//);
    }
  });

  it('honours .gitignore — atlas.json is ignored, so it is not on the map', () => {
    expect(atlas.nodes.some((node) => node.path === 'atlas.json')).toBe(false);
  });

  it('every co-change pair and commit points at a real node', () => {
    for (const [a, b] of atlas.history.coChange) {
      expect(atlas.nodes[a]).toBeDefined();
      expect(atlas.nodes[b]).toBeDefined();
    }
    for (const commit of atlas.history.commits) {
      for (const ref of commit.files) expect(atlas.nodes[ref]).toBeDefined();
    }
  });

  it('assigns every node to a region that exists', () => {
    const ids = new Set(atlas.regions.map((region) => region.id));
    for (const node of atlas.nodes) expect(ids.has(node.region)).toBe(true);
  });
});

describe('what it found in this repo', () => {
  const find = (path: string) => atlas.nodes.find((node) => node.path === path);

  it('found the schema, which everything else is built on', () => {
    expect(find('src/atlas/schema.ts')).toBeDefined();
  });

  it('traced the indexer to the atlas module it depends on', () => {
    const graph = buildGraph(atlas);
    const schema = graph.refByPath.get('src/atlas/schema.ts');
    expect(schema).toBeDefined();
    const radius = dependents(graph, schema ?? 0, 4);
    const paths = [...radius.keys()].map((ref) => atlas.nodes[ref]?.path ?? '');
    // Reached through the `src/atlas/index.ts` barrel, which is exactly the
    // re-export hop a naive scanner would drop.
    expect(paths).toContain('src/indexer/build.ts');
    expect(paths).toContain('src/verbs/score.ts');
  });

  it('read type-only imports as real couplings', () => {
    expect(atlas.edges.some((edge) => edge.kind === 'type')).toBe(true);
  });

  it('read barrel re-exports as edges', () => {
    expect(atlas.edges.some((edge) => edge.kind === 'reexport')).toBe(true);
  });

  it('resolved every import it found, or said which it could not', () => {
    const unresolved = atlas.nodes.flatMap((node) =>
      node.unresolved.map((specifier) => `${node.path}: ${specifier}`),
    );
    // Not an assertion that the number is zero — it is allowed to be non-zero,
    // and guardrail 4 handles that. It is an assertion that we know what they
    // are, printed on failure so a regression is diagnosable.
    expect(unresolved, unresolved.join('\n')).toHaveLength(0);
  });

  it('did not invent dependencies on packages it cannot see', () => {
    const declared = new Set(['node:', 'vitest', 'typescript', 'tsx', '@types/node']);
    for (const node of atlas.nodes) {
      for (const external of node.externals) {
        expect(
          [...declared].some((name) => external.startsWith(name)),
          `${node.path} claims an external dependency on ${external}`,
        ).toBe(true);
      }
    }
  });
});

describe('challenges', () => {
  it('every challenge answer key is a proper subset of what the player sees', () => {
    for (const challenge of atlas.challenges) {
      const candidates = new Set(challenge.candidates);
      for (const id of challenge.truth) expect(candidates.has(id)).toBe(true);
      expect(challenge.truth.length).toBeLessThan(challenge.candidates.length);
      expect(candidates.has(challenge.subject)).toBe(false);
    }
  });

  it('no shipped challenge can be passed by selecting everything', () => {
    for (const challenge of atlas.challenges) {
      expect(isGameable(challenge), `${challenge.id} is gameable`).toBe(false);
      expect(scoreSet(challenge.candidates, challenge.truth).score).toBeLessThan(0.5);
    }
  });

  it('ships none yet — generation lands with the Blast Radius verb at M2', () => {
    // Stated as an assertion so that when M2 lands, this test fails and forces
    // the checks above to stop being vacuous.
    expect(atlas.challenges).toHaveLength(0);
  });
});

describe('budgets', () => {
  it('stays inside the 5 MB atlas ceiling', () => {
    const bytes = Buffer.byteLength(serialized);
    expect(bytes, `atlas is ${(bytes / 1024).toFixed(1)} KiB`).toBeLessThan(MAX_ATLAS_BYTES);
  });

  it('indexes this repo well inside the 10 s ceiling', () => {
    expect(elapsedMs, `indexing took ${elapsedMs} ms`).toBeLessThan(MAX_INDEX_MS);
  });
});
