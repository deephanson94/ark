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
import { TOOL, buildIndex, indexOptions } from '../../src/indexer/build.js';
import { isGameable, scoreSet } from '../../src/verbs/index.js';
import { indexCoChange } from '../../src/verbs/companion/index.js';
import { commitIdFor, isCommitId, isNodeId } from '../../src/atlas/index.js';
import { touchedFact } from '../../src/verbs/index.js';
import { placement } from '../../src/verbs/placement/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

let atlas: Atlas;
let declinedReasons: readonly (readonly [string, number])[];
let serialized: string;
let manifest: Manifest;

beforeAll(async () => {
  const built = await buildIndex(indexOptions(ROOT));
  atlas = built.atlas;
  declinedReasons = built.generation.blastRadius.report.skipped;
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

  it('accounts for every subject with a radius — shipped or declined with a reason', () => {
    const withRadius = atlas.nodes.filter(
      (_, ref) => dependents(buildGraph(atlas), ref, Number.POSITIVE_INFINITY).size > 0,
    ).length;
    expect(atlas.challenges.length).toBeGreaterThan(20);
    // Not "every subject ships a question": the guardrails are allowed to
    // refuse, and on this repo the Ctrl+F gate does. What must hold is that
    // nothing goes missing *silently* — every subject with a radius either
    // carries a question or appears in the declined tally with a named reason.
    // `noDependents` is not a refusal — it is a file nothing imports, which
    // carries no question because there is no radius to ask about.
    const blast = atlas.challenges.filter((c) => c.verb === 'blastRadius');
    const refused = declinedReasons
      .filter(([reason]) => reason !== 'noDependents')
      .reduce((total, [, count]) => total + count, 0);
    const noRadius = declinedReasons.find(([reason]) => reason === 'noDependents')?.[1] ?? 0;
    expect(blast.length + refused).toBe(withRadius);
    expect(noRadius).toBe(atlas.nodes.length - withRadius);
    for (const [reason, count] of declinedReasons) {
      expect(reason, 'a refusal must name a guardrail').not.toBe('');
      expect(count).toBeGreaterThan(0);
    }
  });

  it('holds the answer-key invariant against a freshly recomputed graph', () => {
    // ADR-0008's whole algorithm: candidates ∩ dependents(subject, ∞) = truth.
    // Recomputed here from the atlas rather than trusted from the generator —
    // a generator that agrees with itself has proved nothing.
    const graph = buildGraph(atlas);
    const blast = atlas.challenges.filter((c) => c.verb === 'blastRadius');
    expect(blast.length).toBeGreaterThan(0);
    for (const challenge of blast) {
      const reached = dependents(graph, refOf(graph, challenge.subject), Number.POSITIVE_INFINITY);
      const reachedIds = new Set([...reached.keys()].map((ref) => nodeAt(graph, ref).id));
      const intersection = challenge.candidates.filter((id) => reachedIds.has(id));
      expect(intersection, `${challenge.id}`).toEqual([...challenge.truth]);
    }
  });

  it('holds the companion invariant against a freshly recomputed matrix', () => {
    // The M4 equivalent, and it is the same shape on purpose:
    // candidates ∩ companions(subject) = truth. Recomputed from the atlas, not
    // trusted from the generator.
    //
    // The strong form is what makes the question fair: a candidate outside the
    // key is not merely *below* the bar, it is absent from the matrix entirely
    // — so the line the player draws is "coupled" against "never", never a
    // count they could not have known (ADR-0014).
    const graph = buildGraph(atlas);
    const index = indexCoChange(atlas);
    const companions = atlas.challenges.filter((c) => c.verb === 'companion');
    expect(companions.length).toBeGreaterThan(0);
    for (const challenge of companions) {
      const row = index.rows.get(refOf(graph, challenge.subject)) ?? new Map<number, number>();
      const inMatrix = challenge.candidates.filter((id) => row.has(refOf(graph, id)));
      expect(inMatrix, `${challenge.id}`).toEqual([...challenge.truth]);
    }
  });

  it('never asks about a file whose rename lineage was contested', () => {
    // Guardrail 4 on the git side: co-change counts credited to a file two live
    // paths both claimed may belong to the other one.
    const graph = buildGraph(atlas);
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'companion')) {
      for (const id of [challenge.subject, ...challenge.candidates]) {
        expect(nodeAt(graph, refOf(graph, id)).lineage, `${challenge.id}`).toBe('certain');
      }
    }
  });

  it('states a companion minCount that the matrix actually bears out', () => {
    const graph = buildGraph(atlas);
    const index = indexCoChange(atlas);
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'companion')) {
      if (challenge.evidence.kind !== 'coChange') throw new Error('expected coChange evidence');
      const row = index.rows.get(refOf(graph, challenge.subject)) ?? new Map<number, number>();
      const counts = challenge.truth.map((id) => row.get(refOf(graph, id)) ?? 0);
      // Measured, like `importGraph.depth` — the weakest coupling in the key.
      expect(challenge.evidence.minCount, `${challenge.id}`).toBe(Math.min(...counts));
      expect(challenge.evidence.wideLimit).toBe(atlas.history.wideLimit);
    }
  });

  it('states a measured depth, not a bound', () => {
    const graph = buildGraph(atlas);
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'blastRadius')) {
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
    // Blast Radius only: `isChallengeable` asks whether the *import* graph is
    // sound around this board, which is the wrong question for a verb graded on
    // commits. Companion's equivalent guardrail is the lineage check above.
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'blastRadius')) {
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
    // Blast Radius only, and the contrast is the point: a `.md` file cannot be
    // a dependent, so offering one is padding — but it *can* be a companion,
    // and `docs/atlas-format.md` moving with `src/atlas/schema.ts` is one of
    // the better things this repo has to teach. Companion's eligibility is
    // deliberately every language, which is how it reaches the edgeless files
    // the import graph structurally cannot (`docs/prior-art.md` §4.2).
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'blastRadius')) {
      for (const id of challenge.candidates) {
        const node = nodeAt(graph, refOf(graph, id));
        expect(canImport(node.lang), `${challenge.id} offers ${node.path}`).toBe(true);
      }
    }
  });

  it('lets companion reach files the import graph cannot', () => {
    // The measured argument for this verb, asserted on the real atlas rather
    // than quoted from the writeup.
    const graph = buildGraph(atlas);
    const reachable = (verb: string): Set<string> => {
      const ids = new Set<string>();
      for (const challenge of atlas.challenges.filter((c) => c.verb === verb)) {
        ids.add(challenge.subject);
        for (const id of challenge.truth) ids.add(id);
      }
      return ids;
    };
    const blast = reachable('blastRadius');
    const extra = [...reachable('companion')].filter((id) => !blast.has(id));
    expect(extra.length).toBeGreaterThan(0);
    // At least one of them is a file no import edge touches at all, or a file
    // that cannot import in the first place.
    expect(
      extra.some((id) => {
        const ref = refOf(graph, id);
        return !canImport(nodeAt(graph, ref).lang) ||
          (graph.in[ref] ?? []).length + (graph.out[ref] ?? []).length === 0;
      }),
    ).toBe(true);
  });

  /**
   * **The two history verbs read the same record from opposite sides**, so both
   * invariants are checked here against a freshly recomputed incidence — and
   * neither was, before Archaeology landed. Placement's had lived only in a unit
   * test against a fixture, which cannot see a repo that moves.
   */
  it('holds the placement invariant against the commits themselves', () => {
    const graph = buildGraph(atlas);
    const boards = atlas.challenges.filter((c) => c.verb === 'placement');
    expect(boards.length).toBeGreaterThan(0);
    for (const challenge of boards) {
      const commit = atlas.history.commits.find((c) => commitIdFor(c.sha) === challenge.subject);
      expect(commit, challenge.id).toBeDefined();
      const touched = new Set((commit?.files ?? []).map((ref) => nodeAt(graph, ref).id));
      const inCommit = challenge.candidates.filter((id) => touched.has(id));
      expect(inCommit, challenge.id).toEqual([...challenge.truth]);
    }
  });

  it('holds the archaeology invariant against the commits themselves', () => {
    // candidates ∩ touchedBy(subject) = truth — the fourth use of one shape.
    // Every candidate is either in the answer key or a commit whose own recorded
    // file list does not name the subject, with nothing in between (ADR-0019).
    const graph = buildGraph(atlas);
    const boards = atlas.challenges.filter((c) => c.verb === 'archaeology');
    expect(boards.length).toBeGreaterThan(0);
    for (const challenge of boards) {
      const ref = refOf(graph, challenge.subject);
      const touchers = new Set(
        atlas.history.commits
          .filter((commit) => commit.files.includes(ref))
          .map((commit) => commitIdFor(commit.sha)),
      );
      const inHistory = challenge.candidates.filter((id) => touchers.has(id));
      expect(inHistory, challenge.id).toEqual([...challenge.truth]);
    }
  });

  it('boards commits for archaeology and files for everyone else', () => {
    // The member widening, asserted on the real atlas: `AtlasId` is an alias of
    // `string`, so nothing about this is checkable by the compiler.
    for (const challenge of atlas.challenges) {
      const wantCommits = challenge.verb === 'archaeology';
      for (const id of challenge.candidates) {
        expect(isCommitId(id), `${challenge.id} offers ${id}`).toBe(wantCommits);
      }
      expect(isNodeId(challenge.subject)).toBe(challenge.verb !== 'placement');
    }
  });

  it('dates every archaeology candidate inside its subject’s own lifetime', () => {
    // ADR-0019 decision 5. Without it, "tick every commit in the range" has
    // recall 1.0 for free; with it the guess selects the whole board, which
    // ADR-0007's sizing rule already holds below the pass threshold.
    const graph = buildGraph(atlas);
    const byId = new Map(atlas.history.commits.map((c) => [commitIdFor(c.sha), c]));
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'archaeology')) {
      const node = nodeAt(graph, refOf(graph, challenge.subject));
      for (const id of challenge.candidates) {
        const date = byId.get(id)?.date ?? '';
        expect(date >= (node.firstSeen ?? ''), `${challenge.id} ${id}`).toBe(true);
        expect(date <= (node.lastSeen ?? ''), `${challenge.id} ${id}`).toBe(true);
      }
    }
  });

  it('never asks a commit-membership fact an earlier reveal already stated', () => {
    // ADR-0019 decision 7, checked across verbs on the real deck — the one
    // property no single verb can see, and one `test:atlas`'s own `(verb, truth)`
    // uniqueness check structurally cannot express, since one key holds node ids
    // and the other commit ids.
    const stated = new Set<string>();
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'placement')) {
      for (const fact of placement.discloses(challenge)) stated.add(fact);
    }
    expect(stated.size).toBeGreaterThan(0);
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'archaeology')) {
      for (const member of challenge.truth) {
        expect(
          stated.has(touchedFact(member, challenge.subject)),
          `${challenge.id} asks back a fact a placement reveal states`,
        ).toBe(false);
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
