/**
 * The bootstrap fixture: index *this* repo and assert the result is sound.
 *
 * NORTH-STAR §11 — v1's only target repo is Ark itself, so this file is both
 * the integration test and the first level. If it breaks, the product does not
 * work on the one codebase we understand completely.
 */

import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Atlas } from '../../src/atlas/index.js';
import {
  buildGraph,
  canImport,
  dependents,
  isChallengeable,
  nodeAt,
  parseAtlas,
  refOf,
  serializeAtlas,
  validateAtlas,
} from '../../src/atlas/index.js';
import { TOOL, buildAtlas, indexOptions } from '../../src/indexer/build.js';
import { isGameable, scoreSet } from '../../src/verbs/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

let atlas: Atlas;
let serialized: string;
let manifest: Manifest;

beforeAll(async () => {
  atlas = await buildAtlas(indexOptions(ROOT));
  serialized = serializeAtlas(atlas);
  manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as Manifest;
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

  it('reports the indexer version that package.json declares', () => {
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
    // Read the manifest rather than hard-coding a list: an allowlist written
    // out by hand goes stale the first time someone adds a devDependency, and
    // then fails for a reason that has nothing to do with the indexer.
    const declared = new Set<string>(builtinModules);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const name of Object.keys(manifest[field] ?? {})) declared.add(name);
    }
    for (const node of atlas.nodes) {
      for (const external of node.externals) {
        const name = external.startsWith('node:') ? external.slice(5) : external;
        const base = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        expect(
          declared.has(base ?? name),
          `${node.path} claims an external dependency on ${external}, which package.json does not declare`,
        ).toBe(true);
      }
    }
  });
});

describe('the map reads as clustered', () => {
  // Pillar 4: geography is topology. The cohesion force in the layout was tuned
  // by looking at a screenshot and stopping when it looked right, which is a
  // vibe rather than a budget. This turns that judgement into a number: if a
  // change scatters regions across the map again, this fails instead of
  // quietly making the map worse.
  it('places files nearer their own region than the map is wide', () => {
    const centroids = new Map(atlas.regions.map((region) => [region.id, region.centroid]));

    let withinSum = 0;
    let withinCount = 0;
    for (const node of atlas.nodes) {
      const centroid = centroids.get(node.region);
      if (centroid === undefined) continue;
      withinSum += Math.hypot(node.layout[0] - centroid[0], node.layout[1] - centroid[1]);
      withinCount++;
    }
    const meanWithin = withinSum / Math.max(1, withinCount);

    let betweenSum = 0;
    let betweenCount = 0;
    for (const [i, a] of atlas.regions.entries()) {
      for (const b of atlas.regions.slice(i + 1)) {
        betweenSum += Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1]);
        betweenCount++;
      }
    }
    const meanBetween = betweenSum / Math.max(1, betweenCount);

    const ratio = meanWithin / meanBetween;
    // Measured on this repo: 0.090 with the cohesion force, 0.356 without it.
    // The ceiling sits between the two, so it fails if cohesion is removed or
    // neutered and passes with room for ordinary drift. The first version of
    // this test used 0.75 and passed with cohesion disabled — a threshold that
    // cannot fail is not a test.
    expect(
      ratio,
      `mean intra-region spread ${meanWithin.toFixed(1)} vs inter-region spacing ${meanBetween.toFixed(1)} (ratio ${ratio.toFixed(3)})`,
    ).toBeLessThan(0.2);
  });
});

describe('regions', () => {
  it('gives every region a label no other region claims', () => {
    // The legend prints labels. Two regions sharing one makes the legend say
    // two different colours are the same place, which is a false statement
    // about the map (pillar 4) — and it happened for real the moment
    // `src/verbs/blastRadius/` arrived, because both it and `src/verbs/` have a
    // hub called `index.ts`.
    const labels = atlas.regions.map((region) => region.label);
    expect(new Set(labels).size, `duplicate region label in ${labels.join(', ')}`).toBe(
      labels.length,
    );
  });
});

describe('the region-count bound', () => {
  it('gives every topology region at least the floor, so the count is bounded', () => {
    // ADR-0010 refuses a numeric cap on region count — a magic number with no
    // objective function. What replaces it is a theorem: every *topology*
    // region has >= MIN_REGION members and terrain regions number at most one
    // per top-level directory, so regions <= n/MIN_REGION + topLevelDirs. This
    // asserts the premise the bound rests on.
    const MIN_REGION = 3;
    for (const region of atlas.regions) {
      if (region.kind === 'terrain') continue;
      expect(region.nodeCount, `${region.id} is a topology region of ${region.nodeCount}`)
        .toBeGreaterThanOrEqual(MIN_REGION);
    }
    const topLevel = new Set(atlas.nodes.map((node) => node.path.split('/')[0] ?? ''));
    expect(atlas.regions.filter((r) => r.kind === 'terrain').length).toBeLessThanOrEqual(
      topLevel.size,
    );
    expect(atlas.regions.length).toBeLessThanOrEqual(
      Math.ceil(atlas.nodes.length / MIN_REGION) + topLevel.size,
    );
  });

  it('never marks an edgeless file as belonging to a topology region', () => {
    const graph = buildGraph(atlas);
    const byId = new Map(atlas.regions.map((region) => [region.id, region]));
    for (const [ref, node] of atlas.nodes.entries()) {
      const degree = (graph.in[ref] ?? []).length + (graph.out[ref] ?? []).length;
      if (degree > 0) continue;
      expect(byId.get(node.region)?.kind, `${node.path} has no edges`).toBe('terrain');
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

  it('ships a challenge for most of the repo, so the checks above are not vacuous', () => {
    const withRadius = atlas.nodes.filter(
      (_, ref) => dependents(buildGraph(atlas), ref, Number.POSITIVE_INFINITY).size > 0,
    ).length;
    expect(atlas.challenges.length).toBeGreaterThan(20);
    // Every subject with a radius should carry a question on a repo with zero
    // unresolved imports. If this starts failing, the CLI's `declined` lines
    // say which guardrail refused and why.
    expect(atlas.challenges.length).toBe(withRadius);
  });

  it('holds the answer-key invariant against a freshly recomputed graph', () => {
    // ADR-0008's whole algorithm: candidates ∩ dependents(subject, ∞) = truth.
    // Recomputed here from the atlas rather than trusted from the generator —
    // a generator that agrees with itself has proved nothing.
    const graph = buildGraph(atlas);
    expect(atlas.challenges.length).toBeGreaterThan(0);
    for (const challenge of atlas.challenges) {
      const reached = dependents(graph, refOf(graph, challenge.subject), Number.POSITIVE_INFINITY);
      const reachedIds = new Set([...reached.keys()].map((ref) => nodeAt(graph, ref).id));
      const intersection = challenge.candidates.filter((id) => reachedIds.has(id));
      expect(intersection, `${challenge.id}`).toEqual([...challenge.truth]);
    }
  });

  it('states a measured depth, not a bound', () => {
    const graph = buildGraph(atlas);
    for (const challenge of atlas.challenges) {
      const reached = dependents(graph, refOf(graph, challenge.subject), Number.POSITIVE_INFINITY);
      let furthest = 0;
      for (const id of challenge.truth) furthest = Math.max(furthest, reached.get(refOf(graph, id)) ?? 0);
      expect(challenge.evidence.kind).toBe('importGraph');
      if (challenge.evidence.kind === 'importGraph') {
        expect(challenge.evidence.depth, `${challenge.id}`).toBe(furthest);
      }
    }
  });

  it('never ships a question whose ground truth is uncertain', () => {
    // Guardrail 4, checked on the exact set the player is shown, unbounded.
    const graph = buildGraph(atlas);
    for (const challenge of atlas.challenges) {
      const refs = challenge.candidates.map((id) => refOf(graph, id));
      const verdict = isChallengeable(
        graph,
        refOf(graph, challenge.subject),
        refs,
        Number.POSITIVE_INFINITY,
      );
      expect(verdict.ok, `${challenge.id}: ${verdict.ok ? '' : verdict.reason}`).toBe(true);
    }
  });

  it('offers only files that could have been dependents', () => {
    // A `.md` file cannot import anything, so putting one in a choice set makes
    // the question easier rather than harder. Padding is not a distractor.
    const graph = buildGraph(atlas);
    for (const challenge of atlas.challenges) {
      for (const id of challenge.candidates) {
        const node = nodeAt(graph, refOf(graph, id));
        expect(canImport(node.lang), `${challenge.id} offers ${node.path}`).toBe(true);
      }
    }
  });

  it('computes a difficulty that spans the range rather than clustering', () => {
    const difficulties = atlas.challenges.map((challenge) => challenge.difficulty);
    for (const value of difficulties) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const lowest = Math.min(...difficulties);
    const highest = Math.max(...difficulties);
    // A generator that emitted one difficulty for everything would satisfy
    // "0..1" and be useless for progression, so the spread is the assertion.
    expect(highest - lowest, `difficulty spread ${lowest}..${highest}`).toBeGreaterThan(0.4);
  });
});

// Budgets live in `npm run budget`, not here. A test suite that also polices
// atlas size and index time conflates "is this correct" with "is this within
// its means", and the second question needs a report a human reads, not a
// green tick. See scripts/budget.ts.
