/**
 * What a grade does to the record, and what the record does to the fog.
 *
 * `fog.ts` draws a distinction the whole product rests on — *surveyed* is what
 * you were shown, *understood* is what you proved — and `progress.ts` is the
 * only place that can quietly collapse it. Most of the assertions below are
 * really the same assertion: that a fact you did not earn never becomes a fact
 * you know.
 *
 * The rest are about the seam ADR-0011 opened. `Progress` is now the state and
 * `Fog` is a view of it, which means the restore path is the live path — so
 * these run the derivation rather than the transition, and a save that restored
 * wrongly would break them here.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge, NodeId } from '../../src/atlas/index.js';
import { buildGraph, commitIdFor, validateAtlas } from '../../src/atlas/index.js';
import {
  EMPTY_PROGRESS,
  UNCHECKED,
  answerKey,
  answeredKeys,
  subjectsPassed,
  applyGrade,
  deriveFog,
  livenessOf,
  recordPass,
  recordSurvey,
} from '../../src/player/progress.js';
import { PASS_THRESHOLD, gradeSet } from '../../src/verbs/index.js';
import { PHRASING as BLAST_PHRASING } from '../../src/verbs/blastRadius/index.js';
import { VERBS } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `n:${i.toString(16).padStart(12, '0')}`);
}

const candidates = ids(21);
const subject = candidates[20] ?? '';
const truth = candidates.slice(0, 4);
const challenge: Challenge = {
  id: 'blast-fixture',
  verb: 'blastRadius',
  tier: 3,
  difficulty: 0.5,
  subject,
  candidates: candidates.slice(0, 20),
  truth,
  evidence: { kind: 'importGraph', depth: 2 },
};

/** The fog a record implies, with decay switched off. */
function fogOf(progress: Parameters<typeof deriveFog>[0]) {
  return deriveFog(progress, UNCHECKED);
}

describe('applyGrade', () => {
  it('surveys everything the player was shown, whatever they scored', () => {
    const grade = gradeSet(challenge, { picked: [] }, BLAST_PHRASING);
    const { progress, unlocked } = applyGrade(EMPTY_PROGRESS, challenge, grade);
    expect(unlocked).toBe(false);
    const fog = fogOf(progress);
    expect(fog.surveyed.size).toBe(21);
    for (const id of challenge.candidates) expect(fog.surveyed.has(id)).toBe(true);
    expect(fog.surveyed.has(subject)).toBe(true);
  });

  it('promotes nothing to understood below the pass threshold', () => {
    // Two of four right and three wrong: precision 0.4, recall 0.5, F1 ≈ 0.44.
    // Two-and-two lands exactly *on* 0.5, which would make this pass for the
    // wrong reason.
    const grade = gradeSet(challenge, {
      picked: [...truth.slice(0, 2), candidates[10] ?? '', candidates[11] ?? '', candidates[12] ?? ''],
    }, BLAST_PHRASING);
    expect(grade.score).toBeLessThan(PASS_THRESHOLD);
    const { progress } = applyGrade(EMPTY_PROGRESS, challenge, grade);
    expect(progress.passes).toHaveLength(0);
    expect(fogOf(progress).understood.size).toBe(0);
  });

  it('promotes the subject and the picks that were right, on a pass', () => {
    const grade = gradeSet(challenge, { picked: [...truth.slice(0, 3)] }, BLAST_PHRASING);
    expect(grade.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    const { progress, unlocked } = applyGrade(EMPTY_PROGRESS, challenge, grade);
    expect(unlocked).toBe(true);
    const fog = fogOf(progress);
    expect(fog.understood.has(subject)).toBe(true);
    for (const id of truth.slice(0, 3)) expect(fog.understood.has(id)).toBe(true);
  });

  it('never promotes a member of the answer the player missed', () => {
    // The load-bearing one. Promoting a missed file would write a field note
    // claiming the player knows something they demonstrably did not.
    const grade = gradeSet(challenge, { picked: [...truth.slice(0, 3)] }, BLAST_PHRASING);
    const fog = fogOf(applyGrade(EMPTY_PROGRESS, challenge, grade).progress);
    const missed = truth[3] ?? '';
    expect(grade.missed).toContain(missed);
    expect(fog.understood.has(missed)).toBe(false);
    expect(fog.surveyed.has(missed)).toBe(true);
  });

  it('never promotes a spurious pick', () => {
    const grade = gradeSet(challenge, { picked: [...truth, candidates[9] ?? ''] }, BLAST_PHRASING);
    const fog = fogOf(applyGrade(EMPTY_PROGRESS, challenge, grade).progress);
    expect(fog.understood.has(candidates[9] ?? '')).toBe(false);
  });

  it('takes nothing away — guardrail 6', () => {
    const before = applyGrade(EMPTY_PROGRESS, challenge, gradeSet(challenge, { picked: truth }, BLAST_PHRASING)).progress;
    const after = applyGrade(before, challenge, gradeSet(challenge, { picked: [] }, BLAST_PHRASING)).progress;
    const [was, now] = [fogOf(before), fogOf(after)];
    for (const id of was.understood) expect(now.understood.has(id)).toBe(true);
    for (const id of was.surveyed) expect(now.surveyed.has(id)).toBe(true);
  });
});

describe('the stored record', () => {
  it('is sorted and unique, so the same session serialises the same bytes', () => {
    const a = recordSurvey(EMPTY_PROGRESS, [candidates[3] ?? '', candidates[1] ?? '', candidates[3] ?? '']);
    const b = recordSurvey(EMPTY_PROGRESS, [candidates[1] ?? '', candidates[3] ?? '']);
    expect(a.surveyed).toEqual([candidates[1], candidates[3]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keys a pass by (verb, subject) and unions a second attempt into the first', () => {
    // Answer keys are sampled (ADR-0008), so two passes on one hub can prove
    // different members. The second must not replace the first.
    const once = recordPass(EMPTY_PROGRESS, 'blastRadius', subject, [truth[0] ?? '']);
    const twice = recordPass(once, 'blastRadius', subject, [truth[1] ?? '']);
    expect(twice.passes).toHaveLength(1);
    expect(twice.passes[0]?.proved).toEqual([truth[0], truth[1]]);
  });

  it('stores no understood set — it is derived, and two copies would disagree', () => {
    const { progress } = applyGrade(EMPTY_PROGRESS, challenge, gradeSet(challenge, { picked: truth }, BLAST_PHRASING));
    expect(Object.keys(progress).sort()).toEqual(['passes', 'surveyed', 'version']);
  });

  it('adds the landmarks to the fog without storing them', () => {
    const shore = [candidates[5] ?? ''];
    const fog = deriveFog(EMPTY_PROGRESS, UNCHECKED, shore);
    expect(fog.surveyed.has(candidates[5] ?? '')).toBe(true);
    expect(EMPTY_PROGRESS.surveyed).toHaveLength(0);
  });
});

describe('decay — a restored claim is re-checked against the atlas it is rendered on', () => {
  // b and c import a; d imports nothing. So `a`'s dependents are {b, c}.
  const atlas = atlasWith(
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    [
      ['src/b.ts', 'src/a.ts'],
      ['src/c.ts', 'src/a.ts'],
    ],
  );
  const graph = buildGraph(atlas);
  const idFor = (path: string): NodeId => {
    const ref = graph.refByPath.get(path);
    return ref === undefined ? '' : (atlas.nodes[ref]?.id ?? '');
  };

  it('keeps a claim the graph still supports', () => {
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [idFor('src/b.ts')]);
    const fog = deriveFog(progress, livenessOf(graph, VERBS));
    expect(fog.understood.has(idFor('src/a.ts'))).toBe(true);
    expect(fog.understood.has(idFor('src/b.ts'))).toBe(true);
  });

  it('drops a proved member that no longer depends on the subject', () => {
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [
      idFor('src/b.ts'),
      idFor('src/d.ts'),
    ]);
    const fog = deriveFog(progress, livenessOf(graph, VERBS));
    expect(fog.understood.has(idFor('src/b.ts'))).toBe(true);
    expect(fog.understood.has(idFor('src/d.ts'))).toBe(false);
  });

  it('demotes the subject when every member of a pass has decayed', () => {
    // The subject is still understood as long as *something* it proved holds.
    // When nothing does, the map re-fogs — showing a stale claim as current
    // knowledge would be a worse lie than showing nothing.
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [idFor('src/d.ts')]);
    const fog = deriveFog(progress, livenessOf(graph, VERBS));
    expect(fog.understood.has(idFor('src/a.ts'))).toBe(false);
  });

  it('counts a subject as answered only when it was the subject', () => {
    // Found by looking at an e2e screenshot: reading the question deck off
    // `fog.understood` retired two questions for one pass. Picking `b`
    // correctly proves you know it sits in `a`'s radius — it proves nothing
    // about `b`'s *own* radius, which is a different question.
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [idFor('src/b.ts')]);
    const answered = answeredKeys(progress, livenessOf(graph, VERBS));
    expect(answered.has(answerKey('blastRadius', idFor('src/a.ts')))).toBe(true);
    expect(answered.has(answerKey('blastRadius', idFor('src/b.ts')))).toBe(false);
    // ...even though b *is* understood.
    expect(deriveFog(progress, livenessOf(graph, VERBS)).understood.has(idFor('src/b.ts'))).toBe(true);
  });

  it('brings a question back when its pass has decayed', () => {
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [idFor('src/d.ts')]);
    expect(answeredKeys(progress, livenessOf(graph, VERBS)).size).toBe(0);
  });

  it('ignores ids that name no node, rather than throwing on them', () => {
    const ghost = 'n:ffffffffffff';
    const progress = recordSurvey(
      recordPass(EMPTY_PROGRESS, 'blastRadius', ghost, [ghost]),
      [ghost, idFor('src/b.ts')],
    );
    const fog = deriveFog(progress, livenessOf(graph, VERBS));
    expect(fog.surveyed.has(ghost)).toBe(false);
    expect(fog.understood.has(ghost)).toBe(false);
    expect(fog.surveyed.has(idFor('src/b.ts'))).toBe(true);
    // Ignored at render, retained in storage: reverting a deletion restores it.
    expect(progress.surveyed).toContain(ghost);
  });
});

describe('one verb\'s pass must not unlock another verb\'s answer', () => {
  /**
   * The defect this exists for, found by a post-design review and confirmed
   * against `main.ts`: `deriveFog` promotes every pass's subject into a
   * **verb-blind** `understood` set, and the map reads that set to decide
   * whether to draw a node's full transitive dependent radius on hover
   * (ADR-0008 decision 1). With one verb that is exactly right. With two, a
   * Companion pass on X would have printed the answer to the still-open Blast
   * Radius question about X — the M1 hover leak, re-entered from a direction
   * nothing tested.
   *
   * `subjectsPassed` is the narrower set the radius rule now reads.
   */
  const bare = atlasWith(
    ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    [['src/c.ts', 'src/a.ts']],
  );
  // `src/b.ts` changes with `src/a.ts` and imports nothing — so the companion
  // claim below is one no import-graph check could ever support, which is the
  // case that matters (67% of hono's answer-key members look like this).
  const atlas = validateAtlas({
    ...bare,
    repo: { ...bare.repo, head: 'a'.repeat(40), headDate: '2026-01-01', root: 'b'.repeat(40) },
    history: {
      present: true,
      commitsWalked: 10,
      commitsRetained: 0,
      window: { from: '2025-01-01', to: '2026-01-01' },
      wideLimit: 25,
      coChange: [[0, 1, 5] as const].map(([x, y, n]) => {
        const a = bare.nodes.findIndex((node) => node.path === 'src/a.ts');
        const b = bare.nodes.findIndex((node) => node.path === 'src/b.ts');
        void x;
        void y;
        return (a < b ? [a, b, n] : [b, a, n]) as readonly [number, number, number];
      }),
      commits: [],
    },
  });
  const graph = buildGraph(atlas);
  const idFor = (path: string): NodeId => {
    const ref = graph.refByPath.get(path);
    return ref === undefined ? '' : (atlas.nodes[ref]?.id ?? '');
  };

  it('does not let a companion pass draw the import radius', () => {
    const liveness = livenessOf(graph, VERBS);
    const progress = recordPass(EMPTY_PROGRESS, 'companion', idFor('src/a.ts'), [
      idFor('src/b.ts'),
    ]);

    // The name is earned — you did prove something about that file.
    expect(deriveFog(progress, liveness).understood.has(idFor('src/a.ts'))).toBe(true);
    // The import cone is not.
    expect(subjectsPassed(progress, liveness, 'blastRadius').has(idFor('src/a.ts'))).toBe(false);
    expect(subjectsPassed(progress, liveness, 'companion').has(idFor('src/a.ts'))).toBe(true);
  });

  it('does not unlock a member\'s own radius from someone else\'s question', () => {
    // **The same leak from the third direction, and the one that shipped.**
    // `c` imports `a`, so passing the Blast Radius question about `a` can put
    // `c` in the answer. That proves `c` depends on `a`; it proves nothing
    // about what depends on `c` — and drawing `c`'s cone while `c`'s own board
    // is open hands over that board's key exactly, because ADR-0008 keeps
    // `candidates ∩ dependents(c, ∞) = truth`. Measured before the fix: 26 of
    // this repo's 40 blast boards were exposable this way and all 26 recovered
    // byte-exact.
    //
    // ADR-0008 decision 1 always said the unlock comes from "passing that
    // node's challenge", so the member half was a divergence from the decision
    // of record rather than a decision anyone took.
    const liveness = livenessOf(graph, VERBS);
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', idFor('src/a.ts'), [
      idFor('src/c.ts'),
    ]);
    const traced = subjectsPassed(progress, liveness, 'blastRadius');
    expect(traced.has(idFor('src/a.ts'))).toBe(true);
    expect(traced.has(idFor('src/c.ts'))).toBe(false);
    // ...and the name is still earned, because proving anything about a file is
    // a real reason to know what it is called. It is the radius that is gated.
    expect(deriveFog(progress, liveness).understood.has(idFor('src/c.ts'))).toBe(true);
  });

  it('leaves the other verb\'s question in the deck', () => {
    const liveness = livenessOf(graph, VERBS);
    const progress = recordPass(EMPTY_PROGRESS, 'companion', idFor('src/a.ts'), [
      idFor('src/b.ts'),
    ]);
    const answered = answeredKeys(progress, liveness);
    expect(answered.has(answerKey('companion', idFor('src/a.ts')))).toBe(true);
    // Guardrail: a pass on one verb retiring the other verb's board would
    // silently shrink the deck by half on every repo.
    expect(answered.has(answerKey('blastRadius', idFor('src/a.ts')))).toBe(false);
  });
});

describe('a commit subject moves through the record without ever reaching the map', () => {
  // ADR-0018: Placement's subject is an event, not a place. The record keys on
  // it exactly as it keys on a node — a string is a string — but the *fog* is a
  // property of the map, and a commit has no square on it.
  const atlas = validateAtlas({
    ...atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts']),
    repo: {
      ...atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts']).repo,
      head: 'f'.repeat(40),
      headDate: '2026-01-01',
      root: 'e'.repeat(40),
    },
    history: {
      ...atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts']).history,
      present: true,
      commitsWalked: 1,
      commitsRetained: 1,
      window: { from: '2026-01-01', to: '2026-01-01' },
      commits: [
        {
          sha: 'abcdef123456',
          date: '2026-01-01',
          subject: 'a commit',
          files: [0, 1],
          wide: false,
          issue: null,
        },
      ],
    },
  });
  const graph = buildGraph(atlas);
  const commit = commitIdFor('abcdef123456');
  const nodeIds = atlas.nodes.map((node) => node.id);
  const commitChallenge: Challenge = {
    id: 'placement-abcdef123456',
    verb: 'placement',
    tier: 6,
    difficulty: 0.4,
    subject: commit,
    candidates: [...nodeIds].sort(),
    truth: [nodeIds[0] ?? ''].sort(),
    evidence: { kind: 'commit', subject: 'a commit', date: '2026-01-01', touched: 2 },
  };

  it('never puts a commit id in `surveyed`, which is a set of files', () => {
    const grade = gradeSet(commitChallenge, { picked: commitChallenge.truth }, BLAST_PHRASING);
    const { progress } = applyGrade(EMPTY_PROGRESS, commitChallenge, grade);
    expect(progress.surveyed).not.toContain(commit);
    expect(progress.surveyed).toEqual([...nodeIds].sort());
  });

  it('never puts a commit id in `understood` either, but does promote what was proved', () => {
    const grade = gradeSet(commitChallenge, { picked: commitChallenge.truth }, BLAST_PHRASING);
    const { progress } = applyGrade(EMPTY_PROGRESS, commitChallenge, grade);
    const fog = deriveFog(progress, livenessOf(graph, VERBS));
    expect([...fog.understood]).toEqual([nodeIds[0]]);
  });

  it('keeps the pass while the commit is in the window, and drops it once it is not', () => {
    const passed = recordPass(EMPTY_PROGRESS, 'placement', commit, [nodeIds[0] ?? '']);
    expect(answeredKeys(passed, livenessOf(graph, VERBS))).toContain(
      answerKey('placement', commit),
    );
    const slid = buildGraph(
      validateAtlas({
        ...atlas,
        history: { ...atlas.history, commits: [], commitsRetained: 0 },
      }),
    );
    expect(answeredKeys(passed, livenessOf(slid, VERBS)).size).toBe(0);
  });

  it('offers a commit subject to no map unlock, whatever verb asks for one', () => {
    // `subjectsPassed` feeds the map's radius licence, which resolves each id
    // through `refById`. A commit id would resolve to nothing there — the
    // filter is what keeps that from being a silent miss.
    const passed = recordPass(EMPTY_PROGRESS, 'placement', commit, [nodeIds[0] ?? '']);
    const live = livenessOf(graph, VERBS);
    expect(subjectsPassed(passed, live, 'placement').size).toBe(0);
  });
});
