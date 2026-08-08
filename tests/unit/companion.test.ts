/**
 * Companion — the M4 verb (NORTH-STAR §6.2), and the guardrail-4 argument that
 * lets it grade against a truncated matrix.
 *
 * Every assertion here was mutation-checked: the code it names was broken, the
 * test was confirmed to fail, and the break reverted. Two of them were rewritten
 * when the first version survived a mutation — noted where that happened.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, NodeId } from '../../src/atlas/index.js';
import { buildGraph, validateAtlas } from '../../src/atlas/index.js';
import { PASS_THRESHOLD, scoreSet } from '../../src/verbs/index.js';
import { VERBS, channelOf } from '../../src/verbs/index.js';
import { companion, generateWithReport, indexCoChange } from '../../src/verbs/companion/index.js';
import { ASSUMED_MIN_CO_CHANGE } from '../../src/verbs/companion/cochange.js';
import { DEFAULT_HISTORY_LIMITS, buildHistory } from '../../src/indexer/history.js';
import { atlasWith } from '../fixtures/atlas.js';

/** Every channel the contract allows. A verb declaring anything else is a typo
 *  the type system catches at build time and this catches in a fixture. */
const VERB_CHANNELS = ['importRadius', 'coChangeTies', 'nothing'];

/** The truncation tag the indexer writes for a capped co-change matrix. */
const COCHANGE_TAG = 'coChange' as const;

/**
 * Twenty-four files, a few import edges, no history. Wide enough that the 3:1
 * rule (ADR-0007) can be satisfied at a full six-file answer key, which is the
 * only way these tests exercise the sizing path the real repos hit.
 */
const SUBJECT = 'src/core/engine.ts';
/** Companions of `SUBJECT`, strongest first. Deliberately spread across
 *  directories and sharing no name token with it, so that when the gate refuses
 *  a board it is the *churn* heuristic talking and not `directory` or `name`. */
const COMPANIONS = [
  'lib/alpha.ts',
  'vendor/beta.ts',
  'docs/gamma.md',
  'tools/delta.ts',
  'web/epsilon.ts',
  'api/zeta.ts',
  'misc/eta.ts',
  'misc/theta.ts',
];
/** Filler that is busy but coupled to nothing — the churn heuristic's supply. */
const FILLER = Array.from({ length: 16 }, (_, i) => `src/core/part${String(i).padStart(2, '0')}.ts`);

function fixtureAtlas(): Atlas {
  const bare = atlasWith([SUBJECT, ...COMPANIONS, ...FILLER, 'src/core/orphan.ts'], [
    ['src/core/part00.ts', SUBJECT],
  ]);
  // Churn that points *away* from the answer: the busiest files are the ones
  // that co-change with nothing. A fixture where the answer is also the busiest
  // set would be refused by the gate, and every test here would be measuring
  // the gate instead of the thing it names.
  //
  // The two **weakest** companions are the busiest files in the repo, and that
  // is load-bearing rather than decorative. They are sampled out of the answer
  // key, so the pool ban is the only thing keeping them off the board — and
  // `busy` ranks distractors by churn, so with the highest churn here they are
  // the *first* thing chosen if the ban is ever loosened. Without that, the
  // fixture cannot tell a correct exclusion from a distractor ranking that
  // happened never to reach them: a mutation weakening the ban survived every
  // assertion in this file twice, at churn 3 and again at churn 99, and is
  // caught only now.
  const weakCompanions = new Set(COMPANIONS.slice(-2));
  return validateAtlas({
    ...bare,
    nodes: bare.nodes.map((node) => ({
      ...node,
      churn: weakCompanions.has(node.path) ? 200 : FILLER.includes(node.path) ? 99 : 3,
    })),
  });
}

/** A fixture atlas with a co-change matrix and, optionally, a `coChange` truncation. */
function withHistory(
  atlas: Atlas,
  pairs: readonly (readonly [string, string, number])[],
  options: { readonly capBit?: boolean; readonly wideLimit?: number } = {},
): Atlas {
  const refOf = (path: string): number => {
    const ref = atlas.nodes.findIndex((node) => node.path === path);
    if (ref === -1) throw new Error(`fixture has no ${path}`);
    return ref;
  };
  const coChange = pairs
    .map(([a, b, count]) => {
      const [x, y] = [refOf(a), refOf(b)].sort((p, q) => p - q) as [number, number];
      return [x, y, count] as const;
    })
    .sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]);
  return validateAtlas({
    ...atlas,
    // `present` must agree with `repo.head`, so a fixture with history needs a
    // head and a headDate — the validator's own cross-field rule.
    repo: {
      ...atlas.repo,
      head: 'a'.repeat(40),
      headDate: '2026-01-01',
      root: 'b'.repeat(40),
    },
    history: {
      present: true,
      commitsWalked: 100,
      commitsRetained: 0,
      window: { from: '2025-01-01', to: '2026-01-01' },
      wideLimit: options.wideLimit ?? 25,
      coChange,
      commits: [],
    },
    report: {
      ...atlas.report,
      // `COCHANGE_TAG` rather than a literal, so this fixture cannot drift from
      // the tag the indexer writes — see the test that pins the two.
      truncations:
        options.capBit === true
          ? [{ what: COCHANGE_TAG, kept: coChange.length, dropped: 9 }]
          : [],
    },
  });
}

const idOf = (atlas: Atlas, path: string): NodeId => {
  const node = atlas.nodes.find((n) => n.path === path);
  if (node === undefined) throw new Error(`fixture has no ${path}`);
  return node.id;
};

describe('the certification bound (ADR-0014)', () => {
  it('sits one above the noise floor when the pair cap did not bite', () => {
    const atlas = withHistory(fixtureAtlas(), [[SUBJECT, 'lib/alpha.ts', 4]]);
    const index = indexCoChange(atlas);
    expect(index.capBit).toBe(false);
    // Absence from the matrix proves "at most once", so a key member needs 2.
    expect(index.floor).toBe(2);
  });

  it('rises to clear the weakest surviving pair when the cap did bite', () => {
    // The whole point of the bound: once the cap fires, absence only proves a
    // count at or below the last kept pair's, so the bar has to clear it.
    // **This is the branch that never fires on ark, hono or svelte** — it is
    // exercised here by constructing the truncation the three repos do not
    // produce, which is the only honest way to test a correctness bound.
    const atlas = withHistory(
      fixtureAtlas(),
      [
        [SUBJECT, 'lib/alpha.ts', 9],
        [SUBJECT, 'vendor/beta.ts', 5],
      ],
      { capBit: true },
    );
    const index = indexCoChange(atlas);
    expect(index.capBit).toBe(true);
    // Last kept pair has count 5, so anything dropped is <= 5 and a key member
    // must have at least 6 for an absent candidate to be a safe exclusion.
    expect(index.floor).toBe(6);
  });
});

describe('generation', () => {
  // Eight companions against a six-file cap, so **two are sampled away** — the
  // case the pool ban exists for. A fixture where every companion fits in the
  // key cannot tell a correct exclusion from a lucky one, and a mutation that
  // let the weak leftovers onto the board survived until this was widened.
  const atlas = withHistory(
    fixtureAtlas(),
    COMPANIONS.map((path, i) => [SUBJECT, path, 9 - i] as const),
  );
  const { challenges } = generateWithReport(atlas);

  it('asks about a file that has companions, and only about that file', () => {
    expect(challenges.length).toBeGreaterThan(0);
    for (const challenge of challenges) {
      expect(challenge.verb).toBe('companion');
      expect(challenge.truth.length).toBeGreaterThan(0);
    }
  });

  it('keeps every candidate outside the answer key off the matrix entirely', () => {
    // The invariant, and the reason there is no count boundary to guess at:
    // `candidates ∩ companions(subject) = truth`. A candidate with a count of 3
    // when the key's weakest is 5 would be the n±1 trap ADR-0008 removed.
    const index = indexCoChange(atlas);
    const graph = buildGraph(atlas);
    for (const challenge of challenges) {
      const subjectRef = graph.refById.get(challenge.subject);
      expect(subjectRef).toBeDefined();
      const row = index.rows.get(subjectRef ?? -1) ?? new Map<number, number>();
      const truth = new Set(challenge.truth);
      for (const id of challenge.candidates) {
        if (truth.has(id)) continue;
        const ref = graph.refById.get(id);
        expect(ref).toBeDefined();
        // Not merely "below the key" — absent, which is what the atlas can prove.
        expect(row.has(ref ?? -1)).toBe(false);
      }
    }
  });

  it('reports a minCount that is measured, not the bound it was allowed', () => {
    const index = indexCoChange(atlas);
    for (const challenge of challenges) {
      expect(challenge.evidence.kind).toBe('coChange');
      if (challenge.evidence.kind !== 'coChange') continue;
      const graph = buildGraph(atlas);
      const row = index.rows.get(graph.refById.get(challenge.subject) ?? -1);
      const counts = challenge.truth.map((id) => row?.get(graph.refById.get(id) ?? -1) ?? 0);
      // The weakest coupling that actually made the key — so it moves with the
      // data rather than sitting at `index.floor` for every question.
      expect(challenge.evidence.minCount).toBe(Math.min(...counts));
      expect(challenge.evidence.minCount).toBeGreaterThanOrEqual(index.floor);
    }
  });

  it('cannot be passed by selecting every candidate (ADR-0007)', () => {
    for (const challenge of challenges) {
      expect(scoreSet(challenge.candidates, challenge.truth).score).toBeLessThan(PASS_THRESHOLD);
    }
  });

  it('produces nothing at all for a repo with no history (risk #7)', () => {
    const bare = fixtureAtlas();
    expect(bare.history.present).toBe(false);
    expect(generateWithReport(bare).challenges).toEqual([]);
  });
});

describe('contested rename lineage is refused (guardrail 4)', () => {
  it('bars a node whose history two live files claimed, in every role', () => {
    const clean = withHistory(
      fixtureAtlas(),
      COMPANIONS.map((path, i) => [SUBJECT, path, 9 - i] as const),
    );
    const before = generateWithReport(clean);
    expect(before.challenges.length).toBeGreaterThan(0);
    expect(before.report.contestedNodes).toBe(0);

    // Mark `src/b.ts` contested. Its counts may belong to another file, so it
    // may be neither a subject, nor an answer, nor a certified wrong answer.
    const tainted = validateAtlas({
      ...clean,
      nodes: clean.nodes.map((node) =>
        node.path === 'lib/alpha.ts' ? { ...node, lineage: 'contested' as const } : node,
      ),
    });
    const after = generateWithReport(tainted);
    expect(after.report.contestedNodes).toBe(1);
    const barred = idOf(tainted, 'lib/alpha.ts');
    for (const challenge of after.challenges) {
      expect(challenge.subject).not.toBe(barred);
      expect(challenge.truth).not.toContain(barred);
      // The pool exclusion is the part that is easy to forget: certifying a
      // distractor on misattributed history is the same wrong answer key.
      expect(challenge.candidates).not.toContain(barred);
    }
  });
});

describe('grading and wording', () => {
  const atlas = withHistory(
    fixtureAtlas(),
    COMPANIONS.map((path, i) => [SUBJECT, path, 9 - i] as const),
    { wideLimit: 30 },
  );
  const challenge = generateWithReport(atlas).challenges[0] as Challenge;

  it('states the bar and the wide-commit rule with their real numbers', () => {
    const prompt = companion.prompt(challenge, (id) => id);
    if (challenge.evidence.kind !== 'coChange') throw new Error('expected coChange evidence');
    expect(prompt.question).toContain(`${challenge.evidence.minCount} separate commit`);
    // The number, not a characterisation of it: "a large fraction of the repo"
    // is false in both directions because the limit is absolute.
    expect(prompt.instruction).toContain('30 files');
  });

  it('explains a grade in commits, never in hops', () => {
    const grade = companion.grade(challenge, { picked: [...challenge.truth] });
    expect(grade.score).toBe(1);
    expect(grade.evidence).toContain('change history');
    // The sentence Blast Radius uses would be a false claim here.
    expect(grade.evidence).not.toContain('hop');
  });

  it('names a coupling the import graph cannot see, when there is one', () => {
    const graph = buildGraph(atlas);
    const grade = companion.grade(challenge, { picked: [...challenge.truth] });
    const reveal = companion.reveal(atlas, graph, challenge, grade);
    expect(reveal.notes.length).toBe(challenge.truth.length);
    for (const note of reveal.notes) {
      expect(note.note).toContain('commit');
      // A co-change pair is not a path through anything. An import route here
      // would be evidence that did not produce the grade.
      expect(note.route).toEqual([]);
    }
    // The summary names the subject and says how much of its history the board
    // left out — the sampling admission ADR-0008 requires, in this verb's unit.
    expect(reveal.summary).toContain(reveal.subject);
    // **It puts history wires on the map, and specifically not the import
    // cone.** Borrowing `importRadius` here would render a cone the player
    // never earned and — by the containment argument in `depthFor` — expose
    // part of the open Blast Radius answer for every file under it. That is the
    // leak this codebase has produced three separate ways; the verb declaring
    // what it revealed is what stops a fourth.
    expect(reveal.unlocks).toBe('coChangeTies');
    // …and it agrees with the *static* twin the map actually reads. Pinned
    // generically over `VERBS` rather than verb by verb, because two literals
    // asserted separately drift the moment a third verb exists — and the map
    // reads `channel`, so a verb whose reveal disagreed would announce one
    // channel and draw into another.
    for (const verb of Object.values(VERBS)) {
      expect(VERB_CHANNELS).toContain(verb.channel);
      expect(channelOf(verb.id)).toBe(verb.channel);
    }
    // **The sentence must not promise a drawing the map will not make.** A wire
    // is withheld while either of its files still carries an open Companion
    // board, so "now drawn on the map" is false for 79% of the pairs named here
    // by the time the panel closes. The claim is about the record; the timing is
    // stated. Asserting the *absence* of the tempting phrase, because that is
    // the regression — a later session tightening the wording back up.
    expect(reveal.summary).toContain('history wire');
    expect(reveal.summary).toContain("once both files' questions are answered");
    expect(reveal.summary).not.toContain('now drawn');
  });
});

describe('a claim decays under its own verb, not the other one', () => {
  it('keeps a co-change claim that no import edge supports', () => {
    // The regression this guards: checking a Companion pass against the import
    // graph would drop it, and 67% of hono's / 89% of svelte's answer-key
    // members have no import edge to their subject.
    const atlas = withHistory(fixtureAtlas(), [[SUBJECT, 'src/core/orphan.ts', 6]]);
    const graph = buildGraph(atlas);
    const subject = idOf(atlas, SUBJECT);
    const member = idOf(atlas, 'src/core/orphan.ts');
    expect(companion.stillHolds(graph, subject, member)).toBe(true);
    // ...and the other verb correctly says it does not, on the same pair.
    expect(
      buildGraph(atlas).atlas.edges.some(
        (edge) =>
          graph.atlas.nodes[edge.from]?.path === 'src/core/orphan.ts' &&
          graph.atlas.nodes[edge.to]?.path === SUBJECT,
      ),
    ).toBe(false);
  });

  it('drops a co-change claim once the pair leaves the matrix', () => {
    const atlas = withHistory(fixtureAtlas(), [[SUBJECT, 'lib/alpha.ts', 6]]);
    const graph = buildGraph(atlas);
    const gone = withHistory(fixtureAtlas(), [['misc/eta.ts', 'misc/theta.ts', 6]]);
    expect(
      companion.stillHolds(graph, idOf(atlas, SUBJECT), idOf(atlas, 'lib/alpha.ts')),
    ).toBe(true);
    expect(
      companion.stillHolds(
        buildGraph(gone),
        idOf(gone, SUBJECT),
        idOf(gone, 'lib/alpha.ts'),
      ),
    ).toBe(false);
  });
});


describe('the two constants that cross the indexer/player wall', () => {
  /**
   * Neither of these can be imported by production code on the player side —
   * that would make the player depend on the indexer — so they are duplicated,
   * and a test is the only thing that can hold them equal. A test may cross the
   * wall; production may not.
   */
  it('assumes exactly the noise floor the indexer actually applies', () => {
    // Getting this wrong in the *raising* direction is not conservative, it is
    // a false certification: with an indexer floor of 5 and an assumption of 2,
    // absent pairs hold counts 2–4 while `evidence.atMost` claims 1.
    expect(ASSUMED_MIN_CO_CHANGE).toBe(DEFAULT_HISTORY_LIMITS.minCoChangeCount);
  });

  it('watches for the same truncation tag the indexer writes', () => {
    // `indexCoChange` decides `capBit` by string-matching this tag. Rename it on
    // either side and the bound silently drops to 2 on every capped repo, with
    // every suite still green — the fixture below would have kept passing
    // because it wrote its own copy of the string.
    const limits = { ...DEFAULT_HISTORY_LIMITS, maxCoChangePairs: 1 };
    const git = {
      present: true,
      head: 'a'.repeat(40),
      headDate: '2026-01-01',
      root: 'b'.repeat(40),
      totalCommits: 2,
      commits: [
        { sha: 'c'.repeat(40), date: '2026-01-01', author: 'a', subject: 'one', files: ['x.ts', 'y.ts', 'z.ts'], renames: [] },
        { sha: 'd'.repeat(40), date: '2026-01-02', author: 'a', subject: 'two', files: ['x.ts', 'y.ts', 'z.ts'], renames: [] },
      ],
    };
    const result = buildHistory(git, ['x.ts', 'y.ts', 'z.ts'], limits);
    const tags = result.truncations.map((entry) => entry.what);
    expect(tags).toContain(COCHANGE_TAG);
  });
});

describe('a walk that stopped short refuses the whole repo (guardrail 4)', () => {
  /**
   * `maxCommitsWalked` is a **fourth** loss channel and the certification bound
   * says nothing about it: a pair coupled only in history the walk never read is
   * absent for a reason no ceiling covers, so it would be offered as a certified
   * exclusion while being a genuine companion.
   *
   * Fires on none of ark, hono or svelte (36 / 2,758 / 11,285 commits against a
   * 20,000 ceiling). It is a refusal rather than a rescue path: without it the
   * first repo past the ceiling ships a wrong answer key.
   */
  const pairs = COMPANIONS.map((path, i) => [SUBJECT, path, 9 - i] as const);

  it('generates nothing, and says why, when the walk was cut short', () => {
    const full = withHistory(fixtureAtlas(), pairs);
    expect(generateWithReport(full).challenges.length).toBeGreaterThan(0);
    expect(generateWithReport(full).report.walkTruncated).toBe(false);

    // Same atlas, except the walk read fewer commits than the repo has: the
    // retention truncation says 40 existed, `commitsWalked` says we saw 30.
    const short = validateAtlas({
      ...full,
      history: { ...full.history, commitsWalked: 30, commitsRetained: 0 },
      report: { ...full.report, truncations: [{ what: 'commits', kept: 0, dropped: 40 }] },
    });
    const result = generateWithReport(short);
    expect(result.report.walkTruncated).toBe(true);
    expect(result.challenges).toEqual([]);
    expect(result.report.skipped).toContainEqual(['windowTruncated', 1]);
  });

  it('refuses a shallow clone, where the count comparison sees nothing wrong', () => {
    // The second way the walk falls short, and the one a count cannot detect:
    // `totalCommits` is `git rev-list --count HEAD`, which on a `--depth` clone
    // counts only what is *present*. So `commitsWalked == totalCommits` and the
    // comparison above is satisfied while history is cut at the graft boundary.
    //
    // `repo.root` is already null in exactly that case (ADR-0011), which is why
    // this needs no new atlas field. Not a corner case: `git.ts` records that
    // both large repos an earlier session measured were `--depth` clones.
    const full = withHistory(fixtureAtlas(), pairs);
    expect(full.repo.root).not.toBeNull();
    expect(generateWithReport(full).challenges.length).toBeGreaterThan(0);

    const shallow = validateAtlas({ ...full, repo: { ...full.repo, root: null } });
    // The count comparison alone would still say everything is fine.
    expect(shallow.history.commitsWalked).toBe(full.history.commitsWalked);
    const result = generateWithReport(shallow);
    expect(result.report.walkTruncated).toBe(true);
    expect(result.challenges).toEqual([]);
  });

  it('still asks about a repo with no history at all, rather than refusing it', () => {
    // `root` is null there too, but `present` is false — risk #7 says tiers 1–4
    // stay playable without git, and a repo with no commits has no co-change
    // matrix to be wrong about. Refusing it would be the false positive that
    // deletes a healthy deck.
    const bare = fixtureAtlas();
    expect(bare.repo.root).toBeNull();
    expect(bare.history.present).toBe(false);
    expect(generateWithReport(bare).report.walkTruncated).toBe(false);
  });
});

describe('the instruction states the certification it can actually make', () => {
  it('says "at most once" when the cap did not bite', () => {
    const atlas = withHistory(fixtureAtlas(), COMPANIONS.map((p, i) => [SUBJECT, p, 9 - i] as const));
    const challenge = generateWithReport(atlas).challenges[0] as Challenge;
    if (challenge.evidence.kind !== 'coChange') throw new Error('expected coChange evidence');
    expect(challenge.evidence.atMost).toBe(1);
    expect(companion.prompt(challenge, (id) => id).instruction).toContain('at most once');
  });

  it('raises the claim with the bound when the cap did bite', () => {
    // The half of the raised branch that was missing: `cochange.ts` computed the
    // higher ceiling correctly and the instruction went on saying "at most
    // once", which is a false certification on exactly the repos the branch
    // exists for.
    const atlas = withHistory(
      fixtureAtlas(),
      [
        [SUBJECT, 'lib/alpha.ts', 40],
        [SUBJECT, 'vendor/beta.ts', 30],
        [SUBJECT, 'docs/gamma.md', 20],
        [SUBJECT, 'tools/delta.ts', 10],
        [SUBJECT, 'web/epsilon.ts', 9],
        [SUBJECT, 'api/zeta.ts', 8],
        [SUBJECT, 'misc/eta.ts', 4],
      ],
      { capBit: true },
    );
    const challenge = generateWithReport(atlas).challenges.find(
      (c) => c.subject === idOf(atlas, SUBJECT),
    );
    expect(challenge).toBeDefined();
    if (challenge?.evidence.kind !== 'coChange') throw new Error('expected coChange evidence');
    expect(challenge.evidence.atMost).toBe(4);
    expect(companion.prompt(challenge, (id) => id).instruction).toContain('at most 4 times');
    expect(companion.prompt(challenge, (id) => id).instruction).not.toContain('at most once');
  });
});
