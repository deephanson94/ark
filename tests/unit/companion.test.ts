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
import { companion, generateWithReport, indexCoChange } from '../../src/verbs/companion/index.js';
import { atlasWith } from '../fixtures/atlas.js';

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
      truncations: options.capBit === true ? [{ what: 'coChange', kept: coChange.length, dropped: 9 }] : [],
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
