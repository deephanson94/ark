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
  readWitness,
  validateAtlas,
} from '../../src/atlas/index.js';
import { DEFAULT_GENERATE_OPTIONS, PASS_THRESHOLD, VERBS, channelOf, scoreSet } from '../../src/verbs/index.js';
import { spread } from '../../src/verbs/sample.js';
import { commitSupply } from '../../src/verbs/commits.js';
import { generateWithReport, placement } from '../../src/verbs/placement/index.js';
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
    /** Extra import edges, for a test that needs one to cross a sampling boundary. */
    readonly links?: readonly (readonly [string, string])[];
    /**
     * Co-change pairs, `[a, b, count]` by path.
     *
     * **The fixture had none at all until `coChange` shipped**, which is the
     * degenerate-fixture landmine waiting to happen: the strategy would have had
     * zero supply, every assertion about it would have passed over an empty set,
     * and the suite would have looked complete. Tests that use this count what
     * it actually produced before believing anything else.
     */
    readonly coChange?: readonly (readonly [string, string, number])[];
  } = {},
): Atlas {
  const bare = atlasWith(
    [...CHANGED, ...FILLER],
    [['src/edge/part00.ts', 'src/core/engine.ts'], ...(options.links ?? [])],
  );
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
    // `root` too, not just `head`: a null root means a shallow clone, which
    // ADR-0018 refuses whole — so a fixture without one silently tests nothing.
    repo: { ...bare.repo, head: 'a'.repeat(40), headDate: '2026-01-01', root: 'b'.repeat(40) },
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
      // count desc, then a asc, then b asc — `coChangeOrder`, enforced by the
      // validator, so a fixture that got this wrong would throw rather than
      // quietly test a matrix the player could never see.
      coChange: (options.coChange ?? [])
        .map(([a, b, count]) => {
          const x = refOf(a);
          const y = refOf(b);
          return [Math.min(x, y), Math.max(x, y), count] as const;
        })
        .sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]),
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

/**
 * A matrix for `PLAIN`: three partners of key members that the commit left
 * alone, and one — `lib/alpha.ts` — that it changed.
 *
 * The touched pair is the point. §8.3's best distractor is only a distractor
 * while it is provably *not* an answer, and a partner the commit moved is an
 * answer; the fourth row is what makes "certified wrong" a thing this fixture
 * can fail on rather than a thing it asserts about an empty set.
 *
 * The untouched three avoid `src/edge/part00.ts`, which imports
 * `src/core/engine.ts` and would therefore be a `structural` pick first.
 */
const COUPLED: readonly (readonly [string, string, number])[] = [
  ['src/core/engine.ts', 'src/edge/part05.ts', 9],
  ['src/core/engine.ts', 'lib/alpha.ts', 7],
  ['src/core/parse.ts', 'src/edge/part06.ts', 5],
  ['docs/gamma.md', 'src/edge/part07.ts', 3],
];

/**
 * Churn for the co-change fixture, and it is load-bearing.
 *
 * `busy` runs first and holds the largest quota, and in a fixture where every
 * file has churn 1 it takes six files chosen by id — which swallowed all three
 * partners and made the first version of these tests fail with *"the strategy
 * produced nothing"*. Six decoys above every partner give `busy` its own supply,
 * so what reaches the board through `coChange` reached it as a co-change pick.
 * Each partner's churn is at least its pair count, as a real repo's must be.
 */
const COUPLED_CHURN: Readonly<Record<string, number>> = {
  'src/edge/part10.ts': 20,
  'src/edge/part11.ts': 20,
  'src/edge/part12.ts': 19,
  'src/edge/part13.ts': 19,
  'src/edge/part14.ts': 18,
  'src/edge/part15.ts': 18,
  'src/edge/part05.ts': 9,
  'src/edge/part06.ts': 5,
  'src/edge/part07.ts': 3,
};

const OPTIONS = { ...DEFAULT_GENERATE_OPTIONS, maxChallenges: null, candidateCount: 20 } as const;

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

  it('refuses a shallow clone whole, because its oldest commit lists the entire tree', () => {
    // **The defect this ADR shipped with, and a post-ship review found.** A
    // `--depth N` clone's oldest commit has no parent, so git diffs it against
    // the empty tree and `--name-status` reports it as adding the whole
    // worktree. Reproduced end to end before this test was written: a repo of 8
    // files that grew to 38, cloned at depth 2, shipped a board for "wave one
    // lands" whose key held three files predating it by eight commits.
    //
    // `repo.root` is null exactly when the clone is shallow or the root is
    // unreadable (ADR-0011), which is the same signal ADR-0014 uses.
    const atlas = fixture([PLAIN]);
    const shallow = validateAtlas({ ...atlas, repo: { ...atlas.repo, root: null } });
    const { report } = generateWithReport(shallow, OPTIONS);
    expect(report.shallow).toBe(true);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('shallowClone')).toBe(1);
  });

  it('refuses a cut file list before it refuses a wide one, or the branch is dead', () => {
    // With the shipped limits (`wideCommitFiles` 25 < `maxCommitFiles` 64) every
    // commit long enough to be truncated is already wide, so ordering
    // `truncated` after `wide` makes it a branch that can never be taken — the
    // dead-path landmine, in the change that quotes it. Tested first it reports
    // the guardrail-4 reason instead of the pillar-3 one.
    const atlas = fixture([{ ...PLAIN, paths: [...CHANGED, ...FILLER.slice(0, 2)], wide: true }], {
      fileCap: 6,
    });
    const skips = new Map(generateWithReport(atlas, OPTIONS).report.skipped);
    expect(skips.get('truncated')).toBe(1);
    expect(skips.get('wide')).toBeUndefined();
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
    // Measured, not hypothetical: with no high-churn wrong answer anywhere on
    // the board this gate refuses 10 of ark's eligible commits and 141 of
    // hono's, against 1 and 119 as shipped. (An earlier version of this comment
    // said "25 of 37, a deck of 8" — a prototype's figure that `distractors.ts`
    // and ADR-0018 both retract, and that survived here after they were
    // corrected. A number copied into three places is corrected in one.)
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

  it('refuses a board where the inspector’s "last seen" column gives the answer', () => {
    // **Found by a post-ship review and confirmed by measurement, not argued.**
    // The prompt prints the commit's date and the inspector prints every node's
    // `last seen`, so ticking the candidates whose dates match needs no idea of
    // what changed with what. It beat band A on 16 of hono's 54 boards, at a
    // flat 1.00 on several, and on ark on none — which is why a second repo is
    // not optional. Adding it to the gate cost hono's deck nothing (the cap
    // backfills) and refused 63 more boards.
    const atlas = fixture([PLAIN]);
    const dated = validateAtlas({
      ...atlas,
      nodes: atlas.nodes.map((node) => ({
        ...node,
        // Only the commit's own files carry the commit's date, so the guess is
        // exactly right — the board that must be refused.
        firstSeen: '2026-01-01',
        lastSeen: CHANGED.includes(node.path) ? '2026-01-01' : '2025-06-06',
      })),
    });
    const { report } = generateWithReport(dated, OPTIONS);
    expect(report.generated).toBe(0);
    expect(new Map(report.skipped).get('ctrlF')).toBe(1);
  });

  it('scores exactly the three guesses this board invites, and no others', () => {
    const { report } = generateWithReport(fixture([PLAIN]), OPTIONS);
    // `directory` is absent because a commit has no directory — a heuristic a
    // board cannot invite would delete questions for a strategy nobody could use.
    expect(report.heuristicMean.map(([id]) => id).sort()).toEqual([
      'churn',
      'name',
      'recency',
    ]);
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

  it('keeps the first and last path of a commit wider than its key', () => {
    // **This test has been wrong twice and the second time was informative.**
    // Version one asserted the key spanned more than one directory and survived
    // its own mutation, because `atlasWith` orders nodes by the *hash* of their
    // path so even a slice comes out scattered. Version two asserted both ends
    // of the commit's `files` array — which was the hash order too, so it was
    // testing that a spread spreads over noise.
    //
    // A post-ship review caught what both versions missed: the ADR claimed the
    // sample ran over a **path-sorted** list and the code did not sort. Now it
    // does, and this is the property that makes the claim true — the key reaches
    // the alphabetically first and last file the commit touched, which a slice
    // over any ordering cannot promise.
    // **Specified exactly, not sampled.** A first version asserted only that the
    // key held the alphabetically first and last file, and it *survived* the
    // mutation that removes the sort — with twelve files and a six-file key the
    // hash order happens to include both ends about a quarter of the time, and
    // on this fixture it did. Comparing the whole key against `spread` over the
    // sorted paths leaves no room for a coincidence.
    const wide = [...CHANGED, ...FILLER.slice(0, 8)];
    const atlas = fixture([{ ...PLAIN, paths: wide }]);
    const challenge = only(atlas);
    expect(challenge.truth.length).toBeLessThan(wide.length);
    const idOfPath = (path: string): string =>
      atlas.nodes.find((node) => node.path === path)?.id ?? '';
    const expected = spread([...wide].sort(), challenge.truth.length).map(idOfPath);
    expect([...challenge.truth].sort()).toEqual([...expected].sort());
  });
});

describe('§8.3’s best wrong answer, pointed at a commit', () => {
  function board(): {
    readonly atlas: Atlas;
    readonly challenge: Challenge;
    readonly picked: readonly NodeId[];
    readonly pathOf: (id: NodeId) => string;
  } {
    const atlas = fixture([PLAIN], { coChange: COUPLED, churn: COUPLED_CHURN });
    const challenge = only(atlas);
    const witness = readWitness(challenge);
    const byId = new Map(atlas.nodes.map((node) => [node.id, node.path]));
    return {
      atlas,
      challenge,
      picked: challenge.candidates.filter((id) => witness.get(id) === 'coChange'),
      pathOf: (id) => byId.get(id) ?? '',
    };
  }

  it('offers a file that moves with the change and did not move in it', () => {
    const { challenge, picked, pathOf } = board();
    // Count the population before believing anything about it: an empty matrix
    // makes every line below vacuous, and this fixture had no matrix at all
    // until this strategy existed.
    expect(picked.length, 'the strategy produced nothing').toBeGreaterThan(1);
    // **Strongest coupling first**, asserted as a set against the top of the
    // ranking rather than by reading `picked[0]`: `candidates` is sorted by id,
    // so position in it says nothing about the order the strategy chose in, and
    // a first version of this line asserted the id ordering by accident.
    const byStrength = ['src/edge/part05.ts', 'src/edge/part06.ts', 'src/edge/part07.ts'];
    expect(picked.map(pathOf).sort()).toEqual(byStrength.slice(0, picked.length).sort());
    for (const id of picked) expect(challenge.truth).not.toContain(id);
  });

  it('never offers a partner the commit itself changed, which would be an answer', () => {
    const { atlas, challenge, picked, pathOf } = board();
    // `lib/alpha.ts` is coupled to a key member at count 7 — the second-strongest
    // pair in the matrix — and the commit changed it. Offering it as a wrong
    // answer is the wrong-answer-key failure guardrail 4 exists to prevent.
    for (const id of picked) expect(pathOf(id)).not.toBe('lib/alpha.ts');
    expect(challenge.truth.map(pathOf)).toContain('lib/alpha.ts');
    // And the invariant that guarantees it, re-checked on this fixture rather
    // than assumed from the one three describes up: a matrix is a new way for a
    // touched file to reach the pool.
    const graph = buildGraph(atlas);
    const commit = atlas.history.commits.find((c) => commitIdFor(c.sha) === challenge.subject);
    const touched = new Set((commit?.files ?? []).map((ref) => graph.atlas.nodes[ref]?.id ?? ''));
    expect(challenge.candidates.filter((id) => touched.has(id))).toEqual([...challenge.truth]);
  });

  it('withholds the class, and leaves the row a sentence that is true of it', () => {
    const { atlas, challenge, picked } = board();
    const reveal = placement.reveal(
      atlas,
      buildGraph(atlas),
      challenge,
      placement.grade(challenge, { picked: [...picked] }),
    );
    const rows = reveal.notes.filter((note) => picked.includes(note.id));
    expect(rows).toHaveLength(picked.length);
    for (const note of rows) {
      // The pair is Companion's subject matter and the product does not state
      // it (ADR-0023).
      expect(note.witness, note.label).toBeNull();
      // Withholding a class must not push a row onto a false sentence. A
      // partner is in the matrix because a commit counted it, so its churn is
      // never zero — the one arm of `whyNot` that would be false here.
      expect(note.note, note.label).not.toContain('has touched this file at all');
      expect(note.note.length, note.label).toBeGreaterThan(0);
    }
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

  it('refuses commit evidence under a node subject, and the reverse', () => {
    // The two are the same claim written twice, so disagreeing is a dangling
    // reference in disguise — and the render is `On  a commit landed: ""`,
    // which is the player guessing at a shape (guardrail 5). Checkable without
    // knowing any verb, which is why the validator can hold it.
    const atlas = fixture([PLAIN]);
    const challenge = only(atlas);
    const nodeId = atlas.nodes[0]?.id ?? '';
    expect(() =>
      validateAtlas({
        ...atlas,
        challenges: [
          {
            ...challenge,
            subject: nodeId,
            candidates: challenge.candidates.filter((id) => id !== nodeId),
            truth: challenge.truth.filter((id) => id !== nodeId),
          },
        ],
      }),
    ).toThrow(AtlasValidationError);
    expect(() =>
      validateAtlas({
        ...atlas,
        challenges: [{ ...challenge, evidence: { kind: 'importGraph', depth: 2 } }],
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

  it('names only files its own answer key holds', () => {
    // ADR-0020's found-in-flight defect. `whyYes` used to search the commit's
    // **whole** membership for a neighbour to name, while `placement.discloses`
    // can only declare the sampled key — it has no atlas — so a sentence could
    // state "commit C touched F" for an F the accumulator never heard of, which
    // is an atom of F's Archaeology key. Measured before the fix: 32 sentences
    // across 16 of this repo's 40 boards, 20 of the atoms in a shipped key.
    //
    // `whyYes` runs on every truth member of every board, so this was not
    // conditional on a wrong pick.
    // Ten files against a cap of six, so four members are sampled out, and an
    // import edge from each *changed* file into the tail — because the defect
    // needs a truth member with a neighbour the commit touched and the board
    // does not show. A fixture where no such pair exists cannot exhibit it, and
    // the mutant that restored the old behaviour survived the first version of
    // this test for exactly that reason.
    const tail = FILLER.slice(0, 6);
    const atlas = fixture([{ ...PLAIN, paths: [...CHANGED, ...tail] }], {
      links: CHANGED.filter((path) => path.endsWith('.ts')).flatMap((from, i) =>
        tail.slice(i * 2, i * 2 + 2).map((to) => [from, to] as const),
      ),
    });
    const challenge = only(atlas);
    const graph = buildGraph(atlas);
    const key = new Set(challenge.truth);
    const refOf = (path: string): number =>
      atlas.nodes.findIndex((node) => node.path === path);
    const unsampled = [...CHANGED, ...tail].filter(
      (path) => !key.has(atlas.nodes[refOf(path)]?.id ?? ''),
    );
    // Non-vacuity, twice over: something must have been sampled out, **and** it
    // must be adjacent to something on the board, or the sentence that used to
    // name it never runs.
    expect(unsampled.length).toBeGreaterThan(0);
    const reachable = unsampled.filter((path) => {
      const ref = refOf(path);
      return [...key].some((id) => {
        const member = graph.refById.get(id);
        if (member === undefined) return false;
        return (
          (graph.out[member] ?? []).some((edge) => edge.to === ref) ||
          (graph.in[member] ?? []).some((edge) => edge.from === ref)
        );
      });
    });
    expect(reachable.length, 'no unsampled member neighbours the board').toBeGreaterThan(0);

    const reveal = placement.reveal(
      atlas,
      graph,
      challenge,
      placement.grade(challenge, { picked: challenge.candidates }),
    );
    const text = reveal.notes.map((note) => `${note.note} ${note.witness ?? ''}`).join(' ');
    for (const path of unsampled) expect(text, path).not.toContain(path);
  });

  it('states the class that chose each wrong answer, except the two it withholds', () => {
    // Every class but `coChange` is anchored on the answer key, whose members
    // the board has already named. `coChange` is anchored there too and is
    // still withheld — the pair it would name is Companion's subject matter
    // (ADR-0023, and `blastRadius/reveal.ts` refusing the same relation).
    const atlas = fixture([PLAIN], { coChange: COUPLED, churn: COUPLED_CHURN });
    const challenge = only(atlas);
    const answers = new Set(challenge.truth);
    const wrong = challenge.candidates.filter((id) => !answers.has(id));
    const reveal = placement.reveal(
      atlas,
      buildGraph(atlas),
      challenge,
      placement.grade(challenge, { picked: wrong }),
    );
    const witness = readWitness(challenge);
    const rows = reveal.notes.filter((note) => witness.has(note.id));
    expect(rows.length).toBeGreaterThan(5);
    // Non-vacuity on **both** branches: a fixture with no co-change supply would
    // pass every line below while testing only the speaking half.
    const silent = rows.filter((note) => (witness.get(note.id) ?? '') === 'coChange');
    expect(silent.length, 'no co-change row on this board').toBeGreaterThan(0);
    expect(rows.length - silent.length).toBeGreaterThan(4);
    for (const note of rows) {
      const strategy = witness.get(note.id) ?? '';
      // `distant` is padding, and padding has nothing to teach; `coChange` has
      // something to teach and is not allowed to say it.
      if (strategy === 'distant' || strategy === 'coChange') {
        expect(note.witness, strategy).toBeNull();
      } else expect(note.witness, strategy).not.toBeNull();
    }
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
      proved: [{ label: 'lib/alpha.ts', weight: 1 }],
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

describe('the registry holds four verbs and names none of them anywhere else', () => {
  it('registers placement', () => {
    expect(Object.keys(VERBS).sort()).toEqual([
      'archaeology',
      'blastRadius',
      'companion',
      'placement',
    ]);
    expect(VERBS.placement.id).toBe('placement');
  });
});
