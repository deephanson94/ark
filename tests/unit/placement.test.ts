/**
 * Placement — M4's second verb (NORTH-STAR §6.2), and the subject-shape change
 * that ADR-0018 records.
 *
 * Every assertion here was mutation-checked: the code it names was broken, the
 * test was confirmed to fail, and the break reverted. Where a first version
 * *survived* its own mutation, the note says so and what replaced it.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, CommitRecord, NodeId } from '../../src/atlas/index.js';
import {
  AtlasValidationError,
  buildGraph,
  commitIdFor,
  isNodeId,
  validateAtlas,
} from '../../src/atlas/index.js';
import { PASS_THRESHOLD, VERBS, channelOf, scoreSet } from '../../src/verbs/index.js';
import {
  commitSupply,
  generateWithReport,
  placement,
  spread,
} from '../../src/verbs/placement/index.js';
import { atlasWith } from '../fixtures/atlas.js';

/**
 * Twenty-eight files across several directories, a few import edges.
 *
 * The names deliberately share no tokens with the commit messages below unless
 * a test wants them to, so that when the gate refuses a board it is the *churn*
 * heuristic talking and not `name`.
 */
const CHANGED = [
  'src/core/engine.ts',
  'src/core/parse.ts',
  'lib/alpha.ts',
  'docs/gamma.md',
];
const FILLER = Array.from(
  { length: 24 },
  (_, i) => `src/edge/part${String(i).padStart(2, '0')}.ts`,
);

interface CommitSpec {
  readonly sha: string;
  readonly subject: string;
  readonly paths: readonly string[];
  readonly wide?: boolean;
}

function fixture(
  commits: readonly CommitSpec[],
  options: {
    readonly churn?: Readonly<Record<string, number>>;
    readonly contested?: readonly string[];
    readonly fileCap?: number;
  } = {},
): Atlas {
  const bare = atlasWith([...CHANGED, ...FILLER], [['src/edge/part00.ts', 'src/core/engine.ts']]);
  const refOf = (path: string): number => {
    const ref = bare.nodes.findIndex((node) => node.path === path);
    if (ref === -1) throw new Error(`fixture has no ${path}`);
    return ref;
  };
  const nodes = bare.nodes.map((node) => ({
    ...node,
    churn: options.churn?.[node.path] ?? 1,
    lineage: options.contested?.includes(node.path) === true ? ('contested' as const) : node.lineage,
  }));
  const records: CommitRecord[] = commits.map((commit) => ({
    sha: commit.sha,
    date: '2026-01-01',
    subject: commit.subject,
    files: commit.paths.map(refOf).sort((a, b) => a - b),
    wide: commit.wide === true,
    issue: null,
  }));
  return validateAtlas({
    ...bare,
    // `history.present` and `repo.head` must agree, so a fixture with commits
    // needs a head. Ark's own atlas is the reason that invariant exists.
    repo: { ...bare.repo, head: 'a'.repeat(40), headDate: '2026-01-01' },
    nodes,
    history: {
      ...bare.history,
      present: true,
      commitsWalked: records.length,
      commitsRetained: records.length,
      window: { from: '2026-01-01', to: '2026-01-01' },
      // date descending, then sha ascending — `commitOrder`, which the
      // validator enforces. Every fixture commit shares a date, so this is sha.
      commits: [...records].sort((a, b) => (a.sha < b.sha ? -1 : 1)),
    },
    report: {
      ...bare.report,
      truncations:
        options.fileCap === undefined
          ? []
          : [{ what: 'commitFiles', kept: options.fileCap, dropped: 3 }],
    },
  });
}

/** A single focused commit that no heuristic can guess. */
const PLAIN: CommitSpec = {
  sha: 'aaaaaaaaaaaa',
  subject: 'tighten the retry budget',
  paths: CHANGED,
};

const OPTIONS = { maxChallenges: null, candidateCount: 20 } as const;

function only(atlas: Atlas): Challenge {
  const { challenges } = generateWithReport(atlas, OPTIONS);
  const first = challenges[0];
  if (first === undefined) throw new Error('expected one challenge');
  return first;
}

describe('the answer key is the commit, and everything else is certified out of it', () => {
  it('holds candidates ∩ files(commit) = truth', () => {
    const atlas = fixture([PLAIN]);
    const challenge = only(atlas);
    const commit = atlas.history.commits[0];
    const touched = new Set((commit?.files ?? []).map((ref) => atlas.nodes[ref]?.id));
    const overlap = challenge.candidates.filter((id) => touched.has(id)).sort();
    expect(overlap).toEqual([...challenge.truth].sort());
  });

  it('keeps an unsampled member off the board entirely, rather than grading it wrong', () => {
    // Seven files, a cap of six: exactly one member must be sampled out, and
    // ADR-0018's whole argument is that it goes nowhere near the choice set.
    // The alternative — leaving it as a distractor — marks a player wrong for
    // knowing the commit, which is the trap ADR-0008 and ADR-0014 each removed
    // once already.
    const seven = [...CHANGED, ...FILLER.slice(0, 3)];
    const atlas = fixture([{ ...PLAIN, paths: seven }]);
    const challenge = only(atlas);
    expect(challenge.truth.length).toBeLessThan(seven.length);
    const touched = new Set(seven.map((path) => atlas.nodes.find((n) => n.path === path)?.id));
    const key = new Set(challenge.truth);
    for (const id of challenge.candidates) {
      if (key.has(id)) continue;
      expect(touched.has(id)).toBe(false);
    }
  });

  it('states the commit’s full width, so the reveal can name what sampling left out', () => {
    const seven = [...CHANGED, ...FILLER.slice(0, 3)];
    const challenge = only(fixture([{ ...PLAIN, paths: seven }]));
    expect(challenge.evidence).toMatchObject({ kind: 'commit', touched: 7 });
    expect(challenge.truth.length).toBeLessThan(7);
  });
});

describe('guardrail 4: what this verb refuses to ask about', () => {
  it('refuses a wide commit, whose breadth is what ADR-0005 excluded from co-change', () => {
    const { report } = generateWithReport(fixture([{ ...PLAIN, wide: true }]), OPTIONS);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('wide')).toBe(1);
  });

  it('refuses a commit whose file list the indexer may have cut', () => {
    // The cap is recovered from the truncation entry rather than assumed, and
    // `>=` puts a list ending exactly on the limit on the refusing side.
    const atlas = fixture([{ ...PLAIN, paths: [...CHANGED, ...FILLER.slice(0, 2)] }], {
      fileCap: 6,
    });
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(report.fileCap).toBe(6);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('truncated')).toBe(1);
  });

  it('asks about a commit under the cut, so the refusal is the cap and not the report', () => {
    // The anti-vacuity twin of the test above: with the same truncation entry
    // present, a *short* commit still ships. Without this, deleting the length
    // comparison and refusing every commit whenever the report mentions
    // `commitFiles` would pass.
    const atlas = fixture([{ ...PLAIN, paths: CHANGED.slice(0, 3) }], { fileCap: 6 });
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(report.generated).toBe(1);
  });

  it('bars a commit touching a file with contested rename lineage', () => {
    const atlas = fixture([PLAIN], { contested: ['lib/alpha.ts'] });
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(report.contestedNodes).toBe(1);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('uncertain')).toBe(1);
  });

  it('keeps a contested file out of the choice set of an unrelated commit', () => {
    // Certifying "this commit did not touch that file" on history we know is
    // misattributed is the same defect as putting it in the answer key —
    // ADR-0014 decision 4, and the reason `barred` filters the pool too.
    const atlas = fixture([PLAIN], { contested: ['src/edge/part00.ts'] });
    const challenge = only(atlas);
    const contested = atlas.nodes.find((node) => node.path === 'src/edge/part00.ts')?.id;
    expect(contested).toBeDefined();
    expect(challenge.candidates).not.toContain(contested);
  });

  it('asks nothing at all of a repo with no history', () => {
    // Risk #7: tiers 1–4 stay playable on a repo with no commits, which means
    // this verb contributes nothing rather than throwing.
    const { challenges } = generateWithReport(atlasWith([...CHANGED, ...FILLER]), OPTIONS);
    expect(challenges).toEqual([]);
  });

  it('needs no whole-repo refusal for a truncated walk, unlike Companion', () => {
    // ADR-0014 decision 6 refuses a repo whose commit walk stopped short,
    // because absence from the co-change matrix then certifies nothing. This
    // verb certifies from a commit's *own* recorded list, so a short walk
    // cannot make any board wrong — and a rule copied over "for symmetry"
    // would delete the deck on every large repo for nothing.
    const atlas = fixture([PLAIN]);
    const short = validateAtlas({
      ...atlas,
      history: { ...atlas.history, commitsWalked: 100_000 },
      report: {
        ...atlas.report,
        truncations: [{ what: 'commits', kept: 1, dropped: 99_999 }],
      },
    });
    expect(generateWithReport(short, OPTIONS).report.generated).toBe(1);
  });
});

describe('pillar 3: the Ctrl+F gate reads the commit message', () => {
  it('refuses a board whose message names the files it changed', () => {
    const atlas = fixture([
      {
        sha: 'bbbbbbbbbbbb',
        // Every token of every answer, in the sentence the player is shown.
        subject: 'rewrite engine, parse, alpha and gamma',
        paths: CHANGED,
      },
    ]);
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('ctrlF')).toBe(1);
  });

  it('matches a camel-cased word in the message against a hyphenated filename', () => {
    // `gate.ts` splits at humps for exactly this: a message saying `parseConfig`
    // and a file called `parse-config.ts` are one Ctrl+F apart, and a gate that
    // only matched whole words would miss the leak it was installed for.
    const atlas = fixture([
      { sha: 'cccccccccccc', subject: 'fix coreEngine and coreParse', paths: CHANGED.slice(0, 2) },
    ]);
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(new Map(report.skipped).get('ctrlF')).toBe(1);
  });

  it('refuses a board the busiest-files guess wins, which is this verb’s live threat', () => {
    // Measured, not hypothetical: with no high-churn wrong answers on the board
    // this gate refused 25 of 37 eligible commits on ark and left a deck of 8.
    // Here the answer key *is* the busiest set and nothing else has any churn,
    // which is that situation in miniature.
    const atlas = fixture([PLAIN], {
      churn: Object.fromEntries([
        ...CHANGED.map((path) => [path, 50]),
        ...FILLER.map((path) => [path, 0]),
      ]),
    });
    const { report } = generateWithReport(atlas, OPTIONS);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('ctrlF')).toBe(1);
  });

  it('does not score the directory guess, because a commit has no directory', () => {
    const { report } = generateWithReport(fixture([PLAIN]), OPTIONS);
    expect(report.heuristicMean.map(([id]) => id).sort()).toEqual(['churn', 'name']);
  });
});

describe('the sample is spread across the commit rather than sliced off its front', () => {
  it('takes both ends and the middle', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
  });

  it('never collapses two picks onto one file', () => {
    // The property that matters: `truth` must hold exactly `size` distinct
    // files, or `evidence.touched` stops matching what the board asked.
    for (let length = 1; length <= 40; length++) {
      const files = Array.from({ length }, (_, i) => i);
      for (let size = 1; size <= Math.min(6, length); size++) {
        const picked = spread(files, size);
        expect(new Set(picked).size).toBe(size);
      }
    }
  });

  it('keeps both ends of a commit wider than its key', () => {
    // **The first version of this test asserted the key spanned more than one
    // directory, and it survived its own mutation**: `atlasWith` orders nodes by
    // the *hash* of their path, so slicing a fixture commit already produces a
    // scattered set and the assertion was true either way. What actually
    // separates a spread from a slice is that the spread ends where the commit
    // ends — so that is what this checks.
    const wide = [...CHANGED, ...FILLER.slice(0, 8)];
    const atlas = fixture([{ ...PLAIN, paths: wide }]);
    const files = atlas.history.commits[0]?.files ?? [];
    const challenge = only(atlas);
    expect(challenge.truth.length).toBeLessThan(files.length);
    const idAt = (ref: number | undefined): string => atlas.nodes[ref ?? -1]?.id ?? '';
    expect(challenge.truth).toContain(idAt(files[0]));
    expect(challenge.truth).toContain(idAt(files[files.length - 1]));
  });
});

describe('ADR-0012: an answer key is issued once', () => {
  it('refuses a second commit that touched exactly the same files', () => {
    const atlas = fixture([
      PLAIN,
      { sha: 'dddddddddddd', subject: 'and again, differently', paths: CHANGED },
    ]);
    const { challenges, report } = generateWithReport(atlas, OPTIONS);
    expect(challenges).toHaveLength(1);
    expect(new Map(report.skipped).get('duplicateKey')).toBe(1);
  });
});

describe('a commit subject is a place the map does not have', () => {
  it('is a `c:` id the validator resolves against the retained commits', () => {
    const challenge = only(fixture([PLAIN]));
    expect(challenge.subject).toBe(commitIdFor(PLAIN.sha));
    expect(isNodeId(challenge.subject)).toBe(false);
  });

  it('is refused by the validator when the commit is not in the atlas', () => {
    const atlas = fixture([PLAIN]);
    const challenge = only(atlas);
    expect(() =>
      validateAtlas({
        ...atlas,
        challenges: [{ ...challenge, subject: commitIdFor('ffffffffffff') }],
      }),
    ).toThrow(AtlasValidationError);
  });

  it('refuses a node id that names no node, in the same field', () => {
    // The anti-vacuity twin: the prefix decides *which* section is checked, so
    // dropping the check for either arm has to fail. Accepting "a node id or a
    // commit id, whichever exists" would let a typo pass as the other kind.
    const atlas = fixture([PLAIN]);
    const challenge = only(atlas);
    expect(() =>
      validateAtlas({ ...atlas, challenges: [{ ...challenge, subject: 'n:000000000000' }] }),
    ).toThrow(AtlasValidationError);
  });

  it('reveals nothing on the map, because there is nothing there to reveal', () => {
    expect(placement.channel).toBe('nothing');
    expect(channelOf('placement')).toBe('nothing');
  });

  it('is graded, revealed and phrased entirely by the verb', () => {
    const atlas = fixture([PLAIN]);
    const challenge = only(atlas);
    const graph = buildGraph(atlas);
    const grade = placement.grade(challenge, { picked: challenge.truth });
    expect(grade.score).toBe(1);
    const reveal = placement.reveal(atlas, graph, challenge, grade);
    // The label quotes the commit's own message — derived, never authored.
    expect(reveal.subject).toContain(PLAIN.sha);
    expect(reveal.subject).toContain(PLAIN.subject);
    expect(reveal.unlocks).toBe('nothing');
    expect(reveal.notes).toHaveLength(challenge.truth.length);
    for (const note of reveal.notes) expect(note.route).toEqual([]);
  });

  it('asks its question in the commit’s own words', () => {
    const challenge = only(fixture([PLAIN]));
    const prompt = placement.prompt(challenge, () => 'never used');
    expect(prompt.question).toContain(PLAIN.subject);
    expect(prompt.title).toBe('placement');
    // The certification, stated to the player rather than left in the generator.
    expect(prompt.instruction).toContain('untouched');
  });
});

describe('a stored pass decays with the atlas, not with the repo', () => {
  const atlas = fixture([PLAIN]);
  const graph = buildGraph(atlas);
  const subject = commitIdFor(PLAIN.sha);
  const member = (path: string): NodeId => {
    const id = atlas.nodes.find((node) => node.path === path)?.id;
    if (id === undefined) throw new Error(`no ${path}`);
    return id;
  };

  it('holds while the commit is in the window', () => {
    expect(placement.stillHolds(graph, subject, member('lib/alpha.ts'))).toBe(true);
    expect(placement.stillHolds(graph, subject, member('src/edge/part00.ts'))).toBe(false);
  });

  it('stops holding once the commit has slid out of it', () => {
    const slid = buildGraph(
      validateAtlas({
        ...atlas,
        history: { ...atlas.history, commits: [], commitsRetained: 0 },
      }),
    );
    expect(placement.stillHolds(slid, subject, member('lib/alpha.ts'))).toBe(false);
    expect(placement.subjectLabel(slid, subject)).toBeNull();
  });

  it('writes a note about the commit, in a unit that has no gradient', () => {
    const weights = placement.noteWeights(graph, subject);
    expect([...weights.values()]).toEqual(CHANGED.map(() => 1));
    const prose = placement.noteProse({
      subjectLabel: 'abc — "x"',
      proved: [{ path: 'lib/alpha.ts', weight: 1 }],
      farthest: 1,
      population: 4,
    });
    expect(prose.claim).toContain('changed in abc — "x"');
    // Never "the farthest 1 hops away" — the sentence Blast Radius's template
    // would have produced, which is what made the note contract per-verb.
    expect(prose.claim).not.toContain('hops');
    expect(prose.revealed).toContain('the other 3 revealed to you, never proved');
  });
});

describe('the board cannot be passed by selecting everything', () => {
  it('scores select-all below the pass threshold', () => {
    const challenge = only(fixture([PLAIN]));
    const { score } = scoreSet(challenge.candidates, challenge.truth);
    expect(score).toBeLessThan(PASS_THRESHOLD);
  });
});

describe('the supply report says what it refused', () => {
  it('counts every eligible commit and every refusal', () => {
    const atlas = fixture([
      PLAIN,
      { sha: 'eeeeeeeeeeee', subject: 'vendor everything', paths: CHANGED, wide: true },
    ]);
    const supply = commitSupply(atlas);
    expect(supply.eligible.map((commit) => commit.sha)).toEqual([PLAIN.sha]);
    expect(supply.refused.get('wide')).toBe(1);
  });
});

describe('the registry holds three verbs and names none of them anywhere else', () => {
  it('registers placement', () => {
    expect(Object.keys(VERBS).sort()).toEqual(['blastRadius', 'companion', 'placement']);
    expect(VERBS.placement.id).toBe('placement');
  });
});
