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
  canGradeImports,
  canImport,
  dependents,
  isChallengeable,
  nodeAt,
  parseAtlas,
  readWitness,
  refOf,
  serializeAtlas,
  validateAtlas,
} from '../../src/atlas/index.js';
import { TOOL, buildIndex, indexOptions } from '../../src/indexer/build.js';
import { VERBS, isGameable, scoreSet, wordsFor } from '../../src/verbs/index.js';
import { prepare } from '../../src/player/scene.js';
import { findTwins, nameableClass } from '../../src/player/twins.js';
import { FOOTPRINT_SCALE, buildWorld } from '../../src/player/world/build.js';
import { HERO_RADIUS } from '../../src/player/world/hero.js';
import { indexCoChange } from '../../src/verbs/companion/index.js';
import {
  MAPPED_SHARE,
  UNREADABLE_FLOOR,
  commitIdFor,
  coverageSentence,
  isCommitId,
  isNodeId,
  sourceCoverage,
} from '../../src/atlas/index.js';
import { decidedFact, touchedFact } from '../../src/verbs/index.js';
import { placement } from '../../src/verbs/placement/index.js';
import { TARGET_MIX as BLAST_MIX } from '../../src/verbs/blastRadius/index.js';
import { TARGET_MIX as COMPANION_MIX } from '../../src/verbs/companion/index.js';
import { TARGET_MIX as PLACEMENT_MIX } from '../../src/verbs/placement/index.js';
import { TARGET_MIX as ARCHAEOLOGY_MIX } from '../../src/verbs/archaeology/index.js';

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
  // A refused deck (ADR-0025) would make every deck assertion below vacuous
  // rather than red, so it fails here with the reason rather than there with a
  // count of zero.
  if (built.generation === null) {
    throw new Error(`the bootstrap repo's deck was refused: ${coverageSentence(sourceCoverage(atlas)) ?? ''}`);
  }
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

describe('what this map is missing (ADR-0025)', () => {
  it('counts unreadable source as a refinement of `unsupported`, never beside it', () => {
    // The claim `UnreadableCount`'s doc-comment makes: every file counted here
    // was also counted as skipped-unsupported. If the tally ever ran on a file
    // the walk indexed — or on one it skipped for another reason — the sum would
    // outrun its parent and the ratio the refusal rests on would be measuring
    // two populations.
    const unsupported = atlas.report.skipped.find((s) => s.reason === 'unsupported')?.count ?? 0;
    const unreadable = atlas.report.unreadable.reduce((total, u) => total + u.count, 0);
    expect(unreadable).toBeLessThanOrEqual(unsupported);
    // Non-vacuous: this repo really does carry source the scanner cannot read
    // (a shell script), so the assertion above is comparing two live numbers.
    expect(unreadable).toBeGreaterThan(0);
  });

  it('does not fire on the bootstrap repo, and not narrowly', () => {
    const coverage = sourceCoverage(atlas);
    expect(coverage.deckRefused).toBe(false);
    // **Both clauses, separately.** A conjunction asserted only as a conjunction
    // can have one half rot into a no-op. Each of these is a margin rather than
    // a bit: this repo is two orders of magnitude clear of the floor's other
    // side, and its mapped share is far above a tenth.
    expect(coverage.bodyOfSource).toBe(false);
    expect(coverage.unreadable).toBeLessThan(UNREADABLE_FLOOR);
    expect(coverage.sliver).toBe(false);
    expect(coverage.mapped).toBeGreaterThan(coverage.unreadable * MAPPED_SHARE);
  });

  it('counts files on both sides of its ratio, not nodes on one and files on the other', () => {
    // `unreadable` has always been a count of **files**. `mapped` counted
    // *nodes*, which was exactly right while every node was a file and is a
    // category error the moment one is not — a Go repo's map is packages
    // (ADR-0026). Both sides are files now, and the check that keeps them in
    // the same unit is per node rather than per atlas.
    const coverage = sourceCoverage(atlas);
    const mappedFiles = atlas.nodes
      .filter((node) => canImport(node.lang))
      .reduce((total, node) => total + node.fileCount, 0);
    expect(coverage.mapped).toBe(mappedFiles);
    // And this repo is still file-granular in every node, so the numerator is
    // also the old node count. If TypeScript were ever grouped, this goes red
    // rather than the deck moving quietly.
    expect(atlas.nodes.every((node) => node.kind === 'file' && node.fileCount === 1)).toBe(true);
    expect(coverage.mapped).toBe(atlas.nodes.filter((node) => canImport(node.lang)).length);
    expect(atlas.repo.nodeCount).toBe(atlas.nodes.length);
  });

  it('calls this repo’s boards files, because every node here is one', () => {
    // The bootstrap repo is file-granular, so the noun mechanism must be a
    // **no-op** on it — verified byte-for-byte against the pre-change rendering
    // of all 160 prompts. This is the standing half of that: if TypeScript were
    // ever grouped, or `memberNoun` broke, ark's own wording would move and
    // this goes red rather than the sentences quietly changing.
    const words = wordsFor(buildGraph(atlas));
    expect(words.repo).toEqual({ one: 'file', many: 'files' });
    let asked = 0;
    for (const challenge of atlas.challenges) {
      const prompt = VERBS[challenge.verb].prompt(challenge, words);
      // **The noun slot, not the sentence.** A first draft searched the whole
      // prompt for `/packages?/` and went red on a *filename* —
      // `0026-a-go-node-is-a-package-…md` — which is this repo's own
      // substring-is-a-position landmine, in the assertion written to check the
      // wording. A prompt quotes paths and commit messages; only these slots
      // are ark's own claim about what a member is.
      const members = /Which of these (\w+)/.exec(prompt.question)?.[1];
      expect(members, `${challenge.id}: ${prompt.question}`).toBe(
        challenge.verb === 'archaeology' ? 'commits' : 'files',
      );
      if (challenge.verb !== 'archaeology') asked++;
    }
    expect(asked).toBeGreaterThan(20);
  });

  it('names a language ark could not have indexed anyway', () => {
    // The tables are disjoint (`tests/unit/coverage.test.ts`), so nothing on the
    // map can also be counted as missing from it. Checked here against the real
    // walk rather than against the table.
    const langs = new Set(atlas.nodes.map((node) => node.lang));
    for (const entry of atlas.report.unreadable) {
      expect(entry.count).toBeGreaterThan(0);
      expect(langs.has(entry.lang as never)).toBe(false);
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

  /**
   * **The invariant `src/player/ties.ts`'s endpoint gate now rests on, checked on
   * the real deck rather than on a fixture.**
   *
   * `companion/generate.ts`'s `claimed` set makes a co-change pair answerable
   * once — `T ∈ truth(S) ⟹ S ∉ truth(T)` — which is what closed the leak
   * `ties.ts` used to record as open at *"up to 6 of 6 on this repo"*. The unit
   * suite pins it with a hand-built two-board atlas; nothing checked it on a
   * generated deck, which is the half that decides whether the gate is guarding
   * anything today. Measured across ark, hono, kysely and graphql-js: 0.
   *
   * If this goes red the gate stops being defence in depth and becomes
   * load-bearing again, and `ties.ts`'s header says so.
   */
  it('no two Companion boards carry each other — one matrix cell, one question', () => {
    const companion = atlas.challenges.filter((challenge) => challenge.verb === 'companion');
    const keys = new Map(companion.map((challenge) => [challenge.subject, new Set(challenge.truth)]));
    const mutual: string[] = [];
    for (const challenge of companion) {
      for (const member of challenge.truth) {
        if (keys.get(member)?.has(challenge.subject) === true) {
          mutual.push(`${challenge.subject} ↔ ${member}`);
        }
      }
    }
    expect(mutual, `mutual companion keys: ${mutual.join(', ')}`).toEqual([]);
    // The apparatus, so a zero here is a measurement rather than an empty deck:
    // members that *could* have carried the subject back, because they carry a
    // board of their own at all.
    const reachable = companion.flatMap((challenge) =>
      challenge.truth.filter((member) => keys.has(member)),
    );
    expect(reachable.length).toBeGreaterThan(0);
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
        // **`canGradeImports`, not `canImport`.** `docs/atlas-format.md` §3.6
        // and ADR-0028 both say the choice set is the *narrower* predicate, and
        // this assertion kept the wider one for a milestone — a Python node
        // leaking into a Blast Radius board would have passed the only
        // integration test of that contract. Unreachable on ark, which has no
        // Python, which is exactly how a stale assertion survives.
        expect(canGradeImports(node.lang), `${challenge.id} offers ${node.path}`).toBe(true);
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

  it('never offers a commit whose own board its hint would decide', () => {
    // **ADR-0022**, and the second cross-verb property no single verb can see.
    // Archaeology's reveal says *"it touched a file that usually moves with this
    // one"*; ADR-0016's wire gate knows nothing about an open Placement board,
    // so the map draws that seed's partners beside the commit's own board and
    // the sentence becomes a lookup — measured at band A on 3 of this repo's 40
    // Placement boards, through the visible wires alone.
    //
    // The fix is decision 7's shape, not a withheld sentence: Placement scores
    // the guess against its own key and declares a verdict, and the commit is
    // never offered. This asserts the result on the shipped deck.
    const graph = buildGraph(atlas);
    const verdicts = new Set<string>();
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'placement')) {
      for (const fact of placement.decidedBy(graph, challenge)) verdicts.add(fact);
    }
    // Vacuity guard, and it is the whole reason this test can be trusted: a
    // declaration that fires nowhere would satisfy every assertion below while
    // asserting a behaviour the product does not have. Measured at 36 verdicts
    // over 16 boards here and 22 over 15 on hono @ `cf78528`.
    expect(verdicts.size, 'placement declared no verdicts at all').toBeGreaterThan(5);

    let checked = 0;
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'archaeology')) {
      const truth = new Set(challenge.truth);
      for (const candidate of challenge.candidates) {
        if (truth.has(candidate)) continue;
        checked++;
        expect(
          verdicts.has(decidedFact(candidate, challenge.subject, 'coChange')),
          `${challenge.id} offers ${candidate}, whose placement board its co-change hint decides`,
        ).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('labels every wrong answer with a strategy its own verb declares', () => {
    // ADR-0020. `validateAtlas` already checks the shape — one token per
    // candidate, `-` exactly on the answers — so what is left to check here is
    // the thing the format cannot express: that the token names a strategy the
    // **challenge's own verb** has, rather than some other verb's.
    //
    // Without this, a witness could carry `coChange` on a Companion board and
    // every existing assertion would pass while the panel said something no
    // generator ever meant.
    const declared: Readonly<Record<string, readonly string[]>> = {
      blastRadius: [...BLAST_MIX.map(([id]) => id), 'distant'],
      companion: [...COMPANION_MIX.map(([id]) => id), 'distant'],
      placement: [...PLACEMENT_MIX.map(([id]) => id), 'distant'],
      archaeology: [...ARCHAEOLOGY_MIX.map(([id]) => id), 'distant'],
    };
    let labelled = 0;
    for (const challenge of atlas.challenges) {
      const witness = readWitness(challenge);
      const truth = new Set(challenge.truth);
      for (const candidate of challenge.candidates) {
        if (truth.has(candidate)) continue;
        const strategy = witness.get(candidate);
        labelled++;
        expect(
          declared[challenge.verb]?.includes(strategy ?? ''),
          `${challenge.id} labels ${candidate} ${JSON.stringify(strategy)}`,
        ).toBe(true);
      }
    }
    // Vacuity guard. Every assertion above is inside a loop over distractors,
    // so a deck of boards with no wrong answers — impossible, but so was a
    // fixture that shipped one board — would pass this without executing once.
    expect(labelled).toBeGreaterThan(100);
  });

  it('speaks a witness class for every row of a board or for none of them', () => {
    // ADR-0020's central rule, and the reason it exists: a witness withheld from
    // *some* rows of a board makes the absence of a line say which class the row
    // was in, which is the fact being withheld. Every guard is therefore a
    // property of the subject, and this is what checks that none of them has
    // quietly become a property of the candidate.
    let checked = 0;
    for (const challenge of atlas.challenges) {
      const verb = VERBS[challenge.verb];
      const witness = readWitness(challenge);
      const truth = new Set(challenge.truth);
      const distractors = challenge.candidates.filter((id) => !truth.has(id));
      const reveal = verb.reveal(atlas, buildGraph(atlas), challenge, {
        score: 0,
        correct: [],
        missed: [...challenge.truth],
        spurious: distractors,
        evidence: '',
      });
      const spoken = new Map<string, boolean>();
      for (const note of reveal.notes) {
        const strategy = witness.get(note.id);
        if (strategy === undefined) {
          // An answer: nothing chose it, so nothing may claim to have.
          expect(note.witness, `${challenge.id} witnesses an answer`).toBeNull();
          continue;
        }
        checked++;
        const seen = spoken.get(strategy);
        if (seen === undefined) spoken.set(strategy, note.witness !== null);
        else {
          expect(
            seen,
            `${challenge.id} speaks ${strategy} on some rows and not others`,
          ).toBe(note.witness !== null);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('never states the two classes that would hand another verb its key', () => {
    // The trap this rung walks into, pinned. `blastRadius/reveal.ts` deleted a
    // co-change sentence for the measured reason ADR-0014 finding 3 records, and
    // a witness naming that class is the same sentence wearing a label. Same for
    // Companion's `structural`, which walks the import graph unbounded and so
    // states an undrawn cone edge on the rows beyond the direct ring.
    //
    // Asserted over the shipped deck rather than over the tables, because a
    // table is exactly what a future edit changes.
    let seen = 0;
    for (const challenge of atlas.challenges) {
      if (challenge.verb !== 'blastRadius' && challenge.verb !== 'companion') continue;
      const verb = VERBS[challenge.verb];
      const witness = readWitness(challenge);
      const truth = new Set(challenge.truth);
      const reveal = verb.reveal(atlas, buildGraph(atlas), challenge, {
        score: 0,
        correct: [],
        missed: [...challenge.truth],
        spurious: challenge.candidates.filter((id) => !truth.has(id)),
        evidence: '',
      });
      const barred = challenge.verb === 'blastRadius' ? 'coChange' : 'structural';
      for (const note of reveal.notes) {
        if (witness.get(note.id) !== barred) continue;
        seen++;
        expect(note.witness, `${challenge.id} names ${barred} for ${note.id}`).toBeNull();
      }
    }
    // Both classes are on this repo's deck — **12 co-change and 219 structural on
    // a clean clone of `4bb1996`**, which is the tree ADR-0020's tables were
    // measured on. (The first version of this comment said 13 and 218, taken
    // from an uncommitted working tree and naming no commit: the self-indexing
    // landmine, in a comment.) A zero here means the assertion has stopped
    // reaching the thing it is about, not that the leak is gone.
    expect(seen).toBeGreaterThan(50);
  });

  it('speaks no witness that is false of the row it is on', () => {
    // **The defect an adversarial review found and nothing here could see.** A
    // witness sentence glosses its class, and three of them glossed §8.3's
    // *definition* of the class rather than the strategy that ships — which
    // widens outward when its first bucket runs dry. So "a directory sibling"
    // was false on 100 of this repo's 231 such rows and 193 of hono's 297, and
    // "this file's own directory" was false on 14 archaeology rows here and 40
    // on hono. Falsifiable by a player reading the two paths in one row, or with
    // one `git show --stat`.
    //
    // A test on the wording pins whatever wording is there. This one asserts the
    // **claim**: for the two glosses that make a checkable structural claim,
    // check it against the atlas on every row that speaks them.
    const graph = buildGraph(atlas);
    const dirOf = (path: string): string =>
      path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let treeRows = 0;
      for (const challenge of atlas.challenges) {
      const verb = VERBS[challenge.verb];
      const truth = new Set(challenge.truth);
      const witness = readWitness(challenge);
      const reveal = verb.reveal(atlas, graph, challenge, {
        score: 0,
        correct: [],
        missed: [...challenge.truth],
        spurious: challenge.candidates.filter((id) => !truth.has(id)),
        evidence: '',
      });
      const subjectRef = graph.refById.get(challenge.subject);
      for (const note of reveal.notes) {
        if (note.witness === null || subjectRef === undefined) continue;
        const strategy = witness.get(note.id);

        // **Check the strongest claim the sentence makes, not the weakest.** The
        // first version of this asserted only the shared-segment property, so a
        // gloss that said "a directory sibling" *and* "directory tree" passed —
        // the mutant reintroducing the original defect survived. A sentence
        // claiming the narrower relation is held to the narrower relation.
        const subjectPath = nodeAt(graph, subjectRef).path;
        if (strategy === 'treeSibling') {
          treeRows++;
          const sameDirectory = dirOf(note.label) === dirOf(subjectPath);
          const sameBranch = note.label.split('/')[0] === subjectPath.split('/')[0];
          expect(
            note.witness.includes('sibling') ? sameDirectory : sameBranch,
            `${challenge.id}: "${note.witness}" is false of ${note.label} against ${subjectPath}`,
          ).toBe(true);
        }

        // **Archaeology's `sibling` arm used to be checked here** — that the
        // commit really did touch the subject's corner of the tree. It is gone
        // because the sentence is: the class is withheld (ADR-0021's
        // re-measure), so there is no claim left to be false. The silence is
        // asserted directly by the test below.
      }
    }
    // The population must exist, or the loop above proved nothing.
    expect(treeRows).toBeGreaterThan(50);
  });

  it('speaks no structure-blind hint at all, which is why none can decide a board', () => {
    // **ADR-0021's re-measure, and the answer that ADR named in advance.**
    // Archaeology's `sibling` witness used to say *"a commit that touched this
    // file's own corner of the tree"* — an existential over a subtree, and
    // therefore a weakened atom of that commit's **Placement** answer key: go to
    // that board and tick the candidates whose paths sit under the hinted
    // directory. Of the three existentials the reveal states it was the only one
    // a player could run knowing nothing about the repo, because a subtree is a
    // string prefix, which is pillar 3's `Ctrl+F` word for word.
    //
    // ADR-0021 held it *below* the bar instead of closing it, at a measured
    // union of **0.769** against 0.78 — a margin of 0.011 that this repo's own
    // landmine calls a knife edge recorded as a plateau. Ark indexes itself, so
    // one more commit re-rolled the Placement deck and the union reached
    // **0.800** at `1220b9b`. The old version of this test is what caught it,
    // and its closing line said what to do: *gate it, or withhold the class.*
    //
    // **Both cheaper guards were measured and both are refuted.** By board —
    // where ADR-0021's review left this — cannot bound it: the best single board
    // reaches 0.667 and the 0.800 is the union of **three**. Narrowing the class
    // to the subject's exact directory scores **0.800 too**, because the subject
    // sits in a leaf directory and subtree and directory are the same set. So
    // ADR-0020's escalation runs out at *by class*, and the class is withheld.
    //
    // What is asserted now is the silence itself, which is a stronger claim than
    // a score under a threshold: there is no bar left to drift across.
    const graph = buildGraph(atlas);
    let cornerRows = 0;
    let spokenSeeds = 0;
    for (const challenge of atlas.challenges) {
      if (challenge.verb !== 'archaeology') continue;
      const truth = new Set(challenge.truth);
      const witness = readWitness(challenge);
      const reveal = VERBS.archaeology.reveal(atlas, graph, challenge, {
        score: 0,
        correct: [],
        missed: [...challenge.truth],
        spurious: challenge.candidates.filter((id) => !truth.has(id)),
        evidence: '',
      });
      for (const note of reveal.notes) {
        if (witness.get(note.id) !== 'sibling') continue;
        cornerRows++;
        if (note.witness !== null) spokenSeeds++;
        expect(
          note.witness,
          `${challenge.id} speaks the subtree class on ${note.label}`,
        ).toBeNull();
      }
    }
    // **The vacuity guard, and it is the half that matters.** The rows are still
    // generated and still on the boards — it is the sentence that is gone, not
    // the wrong answers. A zero here would mean the class stopped being *picked*,
    // and this assertion would be proving nothing about what the reveal says.
    expect(cornerRows, 'no sibling row reached a reveal').toBeGreaterThan(20);
    expect(spokenSeeds).toBe(0);
  });

  it('names only files its own answer key holds', () => {
    // Placement's reveal used to search the commit's **whole** membership for a
    // neighbour to name, while `placement.discloses` can only declare the
    // sampled key — so 32 sentences across 16 of this repo's boards named a file
    // the accumulator was never told about, 20 of them members of a shipped
    // Archaeology key. ADR-0019 decision 7 routed around by a sentence written a
    // milestone earlier.
    const graph = buildGraph(atlas);
    const pathOf = new Map(atlas.nodes.map((node) => [node.id, node.path]));
    const everyPath = new Set(pathOf.values());
    let checked = 0;
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'placement')) {
      const truth = new Set(challenge.truth);
      const reveal = placement.reveal(atlas, graph, challenge, {
        score: 0,
        correct: [...challenge.truth],
        missed: [],
        spurious: challenge.candidates.filter((id) => !truth.has(id)),
        evidence: '',
      });
      const allowed = new Set(challenge.truth.map((id) => pathOf.get(id) ?? ''));
      for (const note of reveal.notes) {
        // Any indexed path the sentence mentions, other than the row's own.
        for (const [named] of note.note.matchAll(/[\w./-]+\.[a-z]+/g)) {
          if (!everyPath.has(named) || named === note.label) continue;
          checked++;
          expect(
            allowed.has(named),
            `${challenge.id} names ${named}, which is not on its board`,
          ).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('offers a co-change wrong answer that really co-changes, and never names the pair', () => {
    // ADR-0023, and it is ADR-0020's rule applied to a class that is *silent*:
    // **test the claim, not the wording.** There is no sentence to check here,
    // so what is checkable is the label — that a row the generator called
    // `coChange` is a pair the matrix actually holds against a member of this
    // board's own answer key, and that the panel still says nothing about it.
    //
    // Five false witness sentences shipped on this repo before anything checked
    // one against its class; a withheld class has the same failure mode with no
    // surface to notice it on.
    const graph = buildGraph(atlas);
    const partners = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      const bucket = partners.get(a);
      if (bucket === undefined) partners.set(a, new Set([b]));
      else bucket.add(b);
    };
    for (const [a, b] of atlas.history.coChange) {
      link(nodeAt(graph, a).id, nodeAt(graph, b).id);
      link(nodeAt(graph, b).id, nodeAt(graph, a).id);
    }

    let rows = 0;
    for (const challenge of atlas.challenges.filter((c) => c.verb === 'placement')) {
      const witness = readWitness(challenge);
      const truth = new Set(challenge.truth);
      const picked = challenge.candidates.filter((id) => witness.get(id) === 'coChange');
      if (picked.length === 0) continue;
      const reveal = placement.reveal(atlas, graph, challenge, {
        score: 0,
        correct: [...challenge.truth],
        missed: [],
        spurious: challenge.candidates.filter((id) => !truth.has(id)),
        evidence: '',
      });
      const spoken = new Map(reveal.notes.map((note) => [note.id, note.witness]));
      // The other half of §8.3's class name — "co-change **but don't import**".
      // Enforcing only the first clause put 67 of hono's 141 rows under a
      // purely historical label while they were also graph-adjacent.
      const ring = new Set<string>();
      for (const member of challenge.truth) {
        const ref = graph.refById.get(member);
        if (ref === undefined) continue;
        for (const edge of graph.out[ref] ?? []) ring.add(nodeAt(graph, edge.to).id);
        for (const edge of graph.in[ref] ?? []) ring.add(nodeAt(graph, edge.from).id);
      }
      for (const id of picked) {
        rows++;
        expect(
          challenge.truth.some((member) => partners.get(id)?.has(member) === true),
          `${challenge.id} calls ${id} a co-change pick with no pair to a key member`,
        ).toBe(true);
        expect(
          ring.has(id),
          `${challenge.id} offers ${id} as historically-coupled-but-not-structurally, and it imports the change`,
        ).toBe(false);
        expect(spoken.get(id), `${challenge.id} speaks the withheld class for ${id}`).toBeNull();
      }
    }
    // The population, counted before the assertions above are believed. An
    // empty matrix — or a mix that never reaches this class — makes every line
    // of this test pass over nothing.
    expect(rows, 'no co-change wrong answer shipped at all').toBeGreaterThan(20);
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

/**
 * The walkable world, over the real graph (ADR-0033).
 *
 * These live here rather than in `tests/unit/world.test.ts` for a reason a
 * mutation found: the unit fixture's edges are all short, so *"a road for every
 * edge"* passed there against a build that silently dropped every edge over 200
 * units. The fixture could not express the defect. This repo's own graph can.
 */
describe('the walkable world stands on the real atlas', () => {
  it('lays exactly one road per edge, at whatever length the layout gives', () => {
    const scene = prepare(atlas);
    const world = buildWorld(scene);
    expect(world.roads).toHaveLength(atlas.edges.length);
    // The population, so the equality is not satisfied by two empty lists — and
    // the *long* ones specifically, which is the class the unit fixture lacks
    // and the class that exercises the painter's chopping in `render.ts`.
    //
    // Measured on this repo at `1827ff93`: 545 roads, lengths 13.8 / 55.9 /
    // 118.5 / 209.7 (min, median, p90, max), of which **412 are longer than the
    // 34-unit chop**. The bars are an order below those, because the assertion
    // is *"this graph has long-range edges at all"* and not a fingerprint of
    // one commit's layout — ark indexes itself, so a tight bar here would go
    // red on somebody else's unrelated change.
    const longest = Math.max(...world.roads.map((road) => road.length));
    const chopped = world.roads.filter((road) => road.length > 34).length;
    expect(world.roads.length, 'no roads at all').toBeGreaterThan(100);
    expect(longest, `longest road ${longest.toFixed(1)}`).toBeGreaterThan(100);
    expect(chopped, `roads longer than the chop: ${chopped}`).toBeGreaterThan(50);
  });

  it('gives every node a tower whose footprint is the map’s own radius', () => {
    const scene = prepare(atlas);
    const world = buildWorld(scene);
    expect(world.towers).toHaveLength(atlas.nodes.length);
    for (const tower of world.towers) {
      expect(tower.footprint).toBeCloseTo(tower.node.radius * FOOTPRINT_SCALE, 9);
    }
    // What the scalar was chosen for: the fraction of the repo with no
    // body-width gap to its nearest neighbour. Unscaled it is 89.8% here and
    // 60.2% on hono, which is a solid block rather than a city.
    //
    // **This bar caught a real regression by going red, and the first reading of
    // that was wrong.** It was written when ark measured 3.3% against 0.15 — a
    // 4.5× margin — and ark's reading climbed to **12.4% at an unchanged
    // scalar** as the repo grew into the same layout bounds, tipping over the
    // bar on a commit that added one script file. The margin was a timer, which
    // is this repo's own landmine, and the fix is to close it rather than to
    // move the bar: `scripts/probe-walkable.ts` shows 0.4 leaving **graphql-js
    // and prometheus at 17–18% blocked**, so the constant was under-tuned on
    // three repos this test cannot see. At 0.25 every measured repo is under 5%
    // and ark is 0.0%, so the margin this line was written with is back.
    //
    // It stays loose for the original reason — ark indexes itself and the layout
    // moves every commit — and the number to watch is in `build.ts`'s header,
    // measured across five repos rather than this one.
    let blocked = 0;
    for (const a of world.towers) {
      let clearance = Number.POSITIVE_INFINITY;
      for (const b of world.towers) {
        if (a.ref === b.ref) continue;
        const gap =
          Math.hypot(a.node.x - b.node.x, a.node.y - b.node.y) - a.footprint - b.footprint;
        if (gap < clearance) clearance = gap;
      }
      if (clearance < HERO_RADIUS * 2) blocked++;
    }
    const share = blocked / world.towers.length;
    expect(share, `${(share * 100).toFixed(1)}% of towers have no walkable gap`).toBeLessThan(0.15);
  });

  it('has somewhere to answer every board whose subject is not a node', () => {
    // ADR-0033 decision 2 in the form that matters: the fraction of the deck a
    // node-only world could not serve. On this repo it is a quarter and on
    // django it is 77%, which is why the chronicle exists. If this ever reads
    // zero the assertion has stopped testing anything — hence the floor.
    const placeless = atlas.challenges.filter((challenge) => !isNodeId(challenge.subject));
    expect(placeless.length, 'no commit-subject board in the deck at all').toBeGreaterThan(5);
    const scene = prepare(atlas);
    const world = buildWorld(scene);
    // Every one of them is served from one landmark, and that landmark stands
    // outside the map — never among the files a commit touched, which would be
    // Placement's own answer key drawn on the ground.
    expect(world.chronicle.y).toBeLessThan(scene.bounds.minY);
    for (const tower of world.towers) {
      const gap = Math.hypot(tower.node.x - world.chronicle.x, tower.node.y - world.chronicle.y);
      expect(gap).toBeGreaterThan(world.chronicle.radius + tower.footprint);
    }
  });
});

/**
 * Twins on the real graph, and the gate's arrival curve (ADR-0030).
 *
 * The ADR's own consequences table is asserted here rather than quoted: what a
 * gate *leaves* has to be measured, because ADR-0016's failure was a payoff
 * that appeared and then withdrew. This one runs the other way — the fact
 * arrives as boards are answered — and on ark it arrives late, which is exactly
 * why "does this surface ever fire" is a question a fixture cannot answer.
 */
describe('twin classes on this repo', () => {
  it('finds classes of files nothing can tell apart', () => {
    const graph = buildGraph(atlas);
    const twins = findTwins(graph, atlas.nodes.map((node) => node.id));
    // The population, before anything below is believed. ADR-0030 measured
    // twins as *common* — 15.5% of ark's blast-eligible subjects — and retired
    // the "two on ark and none elsewhere" hypothesis the gap was written under.
    expect(twins.classes.length, 'no twin class at all on this repo').toBeGreaterThan(0);
    for (const found of twins.classes) {
      expect(found.members.length).toBeGreaterThan(1);
      // A class exists because its members share a *non-empty* cone.
      expect(found.coneSize).toBeGreaterThan(0);
    }
  });

  it('names nothing on a fresh save, and something once the boards are cleared', () => {
    const graph = buildGraph(atlas);
    const twins = findTwins(graph, atlas.nodes.map((node) => node.id));
    const blastSubjects = new Set(
      atlas.challenges.filter((c) => c.verb === 'blastRadius').map((c) => c.subject),
    );
    const hasBoard = (member: number): boolean => {
      const id = atlas.nodes[member]?.id;
      return id !== undefined && blastSubjects.has(id);
    };

    let nameableFresh = 0;
    let nameableCleared = 0;
    for (const found of twins.classes) {
      // Fresh: every board is open, so a class touching any subject is silent.
      if (nameableClass(twins, found.members[0] as number, hasBoard) !== null) nameableFresh++;
      // Cleared: no board is open, so every class may be named.
      if (nameableClass(twins, found.members[0] as number, () => false) !== null) nameableCleared++;
    }
    // **This is the liveness gate, and it needs both halves.** Asserting only
    // that the cleared count is positive would pass against a surface with no
    // gate at all; asserting only the fresh count would pass against a surface
    // that never fires. The pair is what says "gated, and reachable".
    expect(nameableCleared, 'no class is nameable even with every board answered').toBeGreaterThan(0);
    expect(nameableFresh).toBeLessThan(nameableCleared);
  });
});

/**
 * The free hint is a subset of the answer, and the map used to draw it.
 *
 * ADR-0008 decision 1 draws every node's **direct importers** on the canvas for
 * free — the arrival tip promises it, and §8.4 measures `surprise` against
 * exactly that guess. A Blast Radius key is a sample of the **transitive**
 * dependent set, which contains the direct one. So a board open on `S` drew a
 * gold line from `S` to some of its own answers: measured on this repo, **37 of
 * 40 boards and 81 of 216 key members**, and 94–96% of hono's and graphql-js's
 * boards.
 *
 * The renderer no longer draws that channel while a board is open (`main.ts`,
 * ADR-0016's rule). This is the *supply-side* half: it records that the overlap
 * exists and is large, so nobody re-derives "direct importers are free" as safe
 * to draw beside an open board. If this ever measures zero, the leak has moved
 * rather than closed — check the generator before deleting the test.
 */
describe('the direct ring is part of the answer', () => {
  it('overlaps the key on most boards, which is why the map may not draw it', () => {
    const graph = buildGraph(atlas);
    let boards = 0;
    let leaking = 0;
    let drawn = 0;
    for (const challenge of atlas.challenges) {
      if (challenge.verb !== 'blastRadius' || !isNodeId(challenge.subject)) continue;
      const ref = graph.refById.get(challenge.subject);
      if (ref === undefined) continue;
      boards += 1;
      const direct = new Set((graph.in[ref] ?? []).map((edge) => edge.from));
      let hit = 0;
      for (const id of challenge.truth) {
        const memberRef = isNodeId(id) ? graph.refById.get(id) : undefined;
        if (memberRef !== undefined && direct.has(memberRef)) hit += 1;
      }
      drawn += hit;
      if (hit > 0) leaking += 1;
    }
    // Non-vacuous: there have to be boards to measure.
    expect(boards).toBeGreaterThan(10);
    // The overlap is the *reason* for the rendering rule, so it is asserted
    // rather than hoped for. A repo where it vanished would be one where the
    // free hint stopped being part of the answer, which the generator does not
    // promise and no version of it has ever produced.
    expect(leaking).toBeGreaterThan(boards / 2);
    expect(drawn).toBeGreaterThan(0);
  });
});
