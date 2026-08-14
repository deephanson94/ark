/**
 * Archaeology — M4's third verb (NORTH-STAR §6.2, ADR-0019).
 *
 * The fixture is a small repo with a hand-written history, so every assertion
 * below is against a commit list this file can state in full. Where a number
 * comes from the *real* repo it is in `tests/atlas/`, not here — this suite is
 * about the rules, and rules that hold on a fixture hold on a repo that moves.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge } from '../../src/atlas/index.js';
import {
  buildGraph,
  byteCompare,
  challengeOrder,
  commitIdFor,
  encodeWitness,
  isCommitId,
  readWitness,
  validateAtlas,
} from '../../src/atlas/index.js';
import {
  DEFAULT_GENERATE_OPTIONS,
  PASS_THRESHOLD,
  VERBS,
  channelOf,
  scoreSet,
  touchedFact,
  widthFact,
} from '../../src/verbs/index.js';
import type { DisclosedFact } from '../../src/verbs/index.js';
import { spread } from '../../src/verbs/sample.js';
import { archaeology, generateWithReport } from '../../src/verbs/archaeology/index.js';
import { COMMIT_TRACE_HEURISTICS, gradeCommitHeuristics } from '../../src/verbs/gate.js';
import { commitSupply } from '../../src/verbs/commits.js';
import { atlasWith, challengeFor } from '../fixtures/atlas.js';

/**
 * Twenty-two files, with `src/core/engine.ts` as the busy one and a handful of
 * commits touching its neighbours without touching it. The commit list below
 * owns the counts, and states them in both senses — see there.
 *
 * Filenames deliberately share no tokens with the commit messages except where a
 * test wants them to — otherwise `mentions` would fire everywhere and every
 * board would be refused before the assertion ran.
 */
const PATHS = [
  'src/core/engine.ts',
  'src/core/state.ts',
  'src/core/queue.ts',
  'src/io/reader.ts',
  'src/io/writer.ts',
  'src/io/socket.ts',
  'src/ui/panel.ts',
  'src/ui/badge.ts',
  'src/ui/dialog.ts',
  'src/util/clamp.ts',
  'src/util/merge.ts',
  'src/util/pick.ts',
  'lib/alpha.ts',
  'lib/beta.ts',
  'lib/gamma.ts',
  'lib/delta.ts',
  'lib/epsilon.ts',
  'lib/zeta.ts',
  'lib/eta.ts',
  'lib/theta.ts',
  'lib/iota.ts',
  'lib/kappa.ts',
];

const ENGINE = 0;

interface CommitSpec {
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
  readonly files: readonly number[];
  /** Refused supply by `commitSupply`, but still in the retained record. */
  readonly wide?: boolean;
}

/**
 * Twenty-four commits over **eight** dates, three per date.
 *
 * The date clustering is not decoration. With one commit per date, a file
 * touched exactly twice has a key of `{first, last}` — which is precisely what
 * `endpoints` picks, so the gate refuses it and the fixture ships one board.
 * Real repos land several commits a day, which dilutes that guess; a fixture
 * that did not would have made every assertion below vacuous on a deck of one.
 *
 * `src/core/engine.ts` is touched by **nine retained commits, eight of them
 * eligible** — the ninth is the `wide` one below. Both numbers are stated
 * because the difference between them is a defect this verb shipped once: the
 * reveal counted eligible touchers and the field note counted retained ones, and
 * a comment saying only "nine" or only "eight" is how the next reader picks the
 * wrong one. Eight eligible against a key of six makes the sample genuine, with
 * two real touchers off the board.
 *
 * `src/io/socket.ts` is touched three times inside a **narrow** window, which is
 * what gives the pool-filter assertions something to bite on.
 */
const COMMITS: readonly CommitSpec[] = [
  { sha: 'aa0000000001', date: '2026-01-05', subject: 'start the loop', files: [ENGINE, 1] },
  { sha: 'aa0000000002', date: '2026-01-05', subject: 'guard the intake', files: [2, 12] },
  { sha: 'aa0000000003', date: '2026-01-05', subject: 'trim the frame', files: [ENGINE, 7, 13] },
  { sha: 'aa0000000004', date: '2026-01-19', subject: 'retry on close', files: [5, 14] },
  { sha: 'aa0000000005', date: '2026-01-19', subject: 'budget the waits', files: [ENGINE, 9] },
  { sha: 'aa0000000006', date: '2026-01-19', subject: 'widen the shelf', files: [8, 15] },
  { sha: 'aa0000000007', date: '2026-02-02', subject: 'drop dead frames', files: [ENGINE, 10] },
  { sha: 'aa0000000008', date: '2026-02-02', subject: 'fold the join path', files: [11, 16] },
  { sha: 'aa0000000009', date: '2026-02-02', subject: 'hoist the bound', files: [3, 17] },
  { sha: 'aa000000000a', date: '2026-02-16', subject: 'rework the wire', files: [5, 18] },
  { sha: 'aa000000000b', date: '2026-02-16', subject: 'shrink the shelf', files: [6, 19] },
  { sha: 'aa000000000c', date: '2026-02-16', subject: 'settle the sink', files: [ENGINE, 20] },
  { sha: 'aa000000000d', date: '2026-03-02', subject: 'thread the source', files: [5, 21] },
  { sha: 'aa000000000e', date: '2026-03-02', subject: 'lift the choice', files: [ENGINE, 4] },
  { sha: 'aa000000000f', date: '2026-03-02', subject: 'align the second path', files: [13, 12] },
  { sha: 'aa0000000010', date: '2026-03-16', subject: 'seal the third edge', files: [14, 1] },
  { sha: 'aa0000000011', date: '2026-03-16', subject: 'flush the fourth', files: [15, 2] },
  { sha: 'aa0000000012', date: '2026-03-16', subject: 'even the fifth', files: [16, 6] },
  { sha: 'aa0000000013', date: '2026-03-30', subject: 'close the sixth gap', files: [ENGINE, 17, 7] },
  { sha: 'aa0000000014', date: '2026-03-30', subject: 'tidy the seventh', files: [18, 8] },
  { sha: 'aa0000000015', date: '2026-03-30', subject: 'raise the eighth', files: [19, 9] },
  { sha: 'aa0000000016', date: '2026-04-13', subject: 'settle the ninth', files: [20, 10] },
  { sha: 'aa0000000017', date: '2026-04-13', subject: 'cap the tenth', files: [21, 11] },
  { sha: 'aa0000000018', date: '2026-04-13', subject: 'last of the run', files: [ENGINE, 3] },
  // **Wide, and it touches the engine.** `commitSupply` refuses it, so it is a
  // *retained* toucher that is not an *eligible* one — the exact gap that made
  // the reveal and the field note disagree about how many commits touched a
  // file, and made "that is every commit" false. Without a commit of this shape
  // the assertion about the two agreeing passes vacuously.
  {
    sha: 'aa0000000019',
    date: '2026-03-02',
    subject: 'reformat the tree',
    files: [ENGINE, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    wide: true,
  },
];

function repo(overrides: { readonly contested?: readonly number[] } = {}): Atlas {
  const base = atlasWith(PATHS, [
    ['src/core/state.ts', 'src/core/engine.ts'],
    ['src/core/queue.ts', 'src/core/engine.ts'],
    ['src/io/reader.ts', 'src/io/writer.ts'],
    ['src/ui/panel.ts', 'src/ui/badge.ts'],
  ]);
  const contested = new Set(overrides.contested ?? []);
  const perFile = new Map<number, { first: string; last: string; churn: number }>();
  for (const commit of COMMITS) {
    for (const ref of commit.files) {
      const entry = perFile.get(ref);
      if (entry === undefined) perFile.set(ref, { first: commit.date, last: commit.date, churn: 1 });
      else {
        entry.first = entry.first < commit.date ? entry.first : commit.date;
        entry.last = entry.last > commit.date ? entry.last : commit.date;
        entry.churn++;
      }
    }
  }
  // `atlasWith` orders nodes by id (a path hash), so the fixture's own indices
  // have to be mapped through the finished node list before they mean anything.
  const refOfPath = new Map(base.nodes.map((node, ref) => [node.path, ref]));
  const at = (index: number): number => refOfPath.get(PATHS[index] ?? '') ?? 0;

  return validateAtlas({
    ...base,
    nodes: base.nodes.map((node) => {
      const index = PATHS.indexOf(node.path);
      const facts = perFile.get(index);
      return {
        ...node,
        lineage: contested.has(index) ? 'contested' : 'certain',
        churn: facts?.churn ?? 0,
        authors: facts === undefined ? 0 : 1,
        firstSeen: facts?.first ?? null,
        lastSeen: facts?.last ?? null,
      };
    }),
    repo: { ...base.repo, head: 'f'.repeat(40), headDate: '2026-06-15', root: '0'.repeat(40) },
    history: {
      ...base.history,
      // **`src/io/reader.ts` gets exactly one partner and exactly one import
      // neighbour**, which is what makes the reveal's "relations, never
      // identities" rule testable: over a set of one, the relation *is* the
      // identity. The engine gets two of each, so the arms still fire somewhere.
      coChange: [
        [at(0), at(1), 4],
        [at(0), at(2), 3],
        [at(3), at(4), 3],
      ]
        .map(([a, b, n]) => ((a as number) < (b as number) ? [a, b, n] : [b, a, n]))
        .sort((x, y) => (y[2] as number) - (x[2] as number) || (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)) as [number, number, number][],
      present: true,
      commitsWalked: COMMITS.length,
      commitsRetained: COMMITS.length,
      window: { from: '2026-01-05', to: '2026-06-15' },
      commits: [...COMMITS]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.sha < b.sha ? -1 : 1))
        .map((commit) => ({
          sha: commit.sha,
          date: commit.date,
          subject: commit.subject,
          files: [...commit.files.map(at)].sort((x, y) => x - y),
          wide: commit.wide === true,
          issue: null,
        })),
    },
  });
}

const ATLAS = repo();
const GRAPH = buildGraph(ATLAS);

function engineId(atlas: Atlas): string {
  return atlas.nodes.find((node) => node.path === 'src/core/engine.ts')?.id ?? '';
}

function boards(atlas: Atlas = ATLAS, disclosed = new Set<DisclosedFact>()): readonly Challenge[] {
  return generateWithReport(atlas, { ...DEFAULT_GENERATE_OPTIONS, disclosed }).challenges;
}

function engineBoard(atlas: Atlas = ATLAS, disclosed = new Set<DisclosedFact>()): Challenge {
  const id = engineId(atlas);
  const found = boards(atlas, disclosed).find((challenge) => challenge.subject === id);
  if (found === undefined) throw new Error('fixture produced no board for the engine');
  return found;
}

/**
 * The commits the *generator* could have drawn a key from: eligible, and
 * touching the node. Narrower than `touchersOf`, which is every **retained**
 * toucher — a `wide` commit is in the second and not the first, and conflating
 * them is what made the reveal contradict the field note.
 */
function eligibleTouchersOf(atlas: Atlas, nodeId: string): Set<string> {
  const ref = atlas.nodes.findIndex((node) => node.id === nodeId);
  const out = new Set<string>();
  for (const commit of commitSupply(atlas).eligible) {
    if (commit.files.includes(ref)) out.add(commitIdFor(commit.sha));
  }
  return out;
}

/** Every **retained** commit that touched a node, read straight off the atlas. */
function touchersOf(atlas: Atlas, nodeId: string): Set<string> {
  const ref = atlas.nodes.findIndex((node) => node.id === nodeId);
  const out = new Set<string>();
  for (const commit of atlas.history.commits) {
    if (commit.files.includes(ref)) out.add(commitIdFor(commit.sha));
  }
  return out;
}

describe('the invariant — candidates ∩ touchedBy(subject) = truth', () => {
  it('holds on every board the fixture ships', () => {
    for (const challenge of boards()) {
      const touchers = touchersOf(ATLAS, challenge.subject);
      const overlap = challenge.candidates.filter((id) => touchers.has(id)).sort();
      expect(overlap, challenge.id).toEqual([...challenge.truth].sort());
    }
  });

  it('keeps an unsampled toucher off the board entirely, not merely out of the key', () => {
    const challenge = engineBoard();
    const touchers = touchersOf(ATLAS, challenge.subject);
    expect(touchers.size).toBeGreaterThan(challenge.truth.length);
    const onBoard = new Set(challenge.candidates);
    for (const id of touchers) {
      if (challenge.truth.includes(id)) continue;
      // The whole point: a real toucher the sample left out is nowhere on the
      // board, so there is no boundary for the player to guess at.
      expect(onBoard.has(id), id).toBe(false);
    }
  });

  it('boards commits, not files', () => {
    for (const challenge of boards()) {
      expect(challenge.candidates.every(isCommitId), challenge.id).toBe(true);
      expect(isCommitId(challenge.subject)).toBe(false);
    }
  });

  it('cannot be beaten by selecting everything (ADR-0007)', () => {
    for (const challenge of boards()) {
      expect(scoreSet(challenge.candidates, challenge.truth).score).toBeLessThan(PASS_THRESHOLD);
    }
  });
});

describe('decision 5 — the pool is filtered to the subject’s own lifetime', () => {
  it('dates every candidate inside [firstSeen, lastSeen]', () => {
    const byId = new Map(ATLAS.history.commits.map((c) => [commitIdFor(c.sha), c]));
    for (const challenge of boards()) {
      const node = ATLAS.nodes.find((n) => n.id === challenge.subject);
      expect(node?.firstSeen).not.toBeNull();
      for (const id of challenge.candidates) {
        const date = byId.get(id)?.date ?? '';
        expect(date >= (node?.firstSeen ?? ''), `${challenge.id} ${id}`).toBe(true);
        expect(date <= (node?.lastSeen ?? ''), `${challenge.id} ${id}`).toBe(true);
      }
    }
  });

  it('leaves the free date guess at select-everything, which is below the bar', () => {
    // With the filter on, "tick every commit inside the range" selects the whole
    // board. The bound is the sizing rule rather than a measurement — see
    // decision 5 — so this asserts the *arithmetic*, on every board.
    for (const challenge of boards()) {
      const guess = scoreSet(challenge.candidates, challenge.truth).score;
      expect(guess, challenge.id).toBeLessThan(PASS_THRESHOLD);
    }
  });
});

describe('decision 3 — the key is a cross-section in date order', () => {
  it('spreads over the date ordering rather than the atlas’s', () => {
    const challenge = engineBoard();
    const byId = new Map(ATLAS.history.commits.map((c) => [commitIdFor(c.sha), c]));
    const touchers = [...eligibleTouchersOf(ATLAS, challenge.subject)].sort((a, b) => {
      const x = byId.get(a);
      const y = byId.get(b);
      return (x?.date ?? '') < (y?.date ?? '') ? -1 : (x?.date ?? '') > (y?.date ?? '') ? 1 : 0;
    });
    const expected = spread(touchers, challenge.truth.length).sort();
    expect([...challenge.truth].sort()).toEqual(expected);
  });

  it('keeps both ends of the file’s life, which is what makes the date guesses real', () => {
    const challenge = engineBoard();
    const byId = new Map(ATLAS.history.commits.map((c) => [commitIdFor(c.sha), c]));
    const dates = challenge.truth.map((id) => byId.get(id)?.date ?? '').sort();
    const node = ATLAS.nodes.find((n) => n.id === challenge.subject);
    expect(dates[0]).toBe(node?.firstSeen);
    expect(dates[dates.length - 1]).toBe(node?.lastSeen);
  });
});

describe('decision 7 — a fact an earlier reveal stated is not an answer', () => {
  const id = engineId(ATLAS);
  const touchers = [...touchersOf(ATLAS, id)];

  it('removes a disclosed commit from the board altogether, not just from the key', () => {
    const victim = touchers[0] ?? '';
    const disclosed = new Set<DisclosedFact>([touchedFact(victim, id)]);
    const challenge = engineBoard(ATLAS, disclosed);
    // **The near-miss ADR-0019 records.** Filtering the toucher list before
    // computing membership would drop this commit into the distractor pool — a
    // board offering a commit that really did touch the file, marked wrong.
    expect(challenge.truth).not.toContain(victim);
    expect(challenge.candidates).not.toContain(victim);
  });

  it('refuses the subject once the exclusion takes it below two touchers', () => {
    const disclosed = new Set<DisclosedFact>(
      touchers.slice(0, touchers.length - 1).map((commit) => touchedFact(commit, id)),
    );
    const result = generateWithReport(ATLAS, { ...DEFAULT_GENERATE_OPTIONS, disclosed });
    expect(result.challenges.find((c) => c.subject === id)).toBeUndefined();
    // Counted under its own reason, so the exclusion's cost is a number in the
    // report rather than a counterfactual somebody has to re-run.
    expect(result.report.skipped.find(([reason]) => reason === 'disclosed')?.[1]).toBeGreaterThan(0);
  });

  it('is wired to the accumulator: withholding the facts changes the deck', () => {
    // The live-path check CLAUDE.md's landmine asks for. A disclosure mechanism
    // that changed no output would be infrastructure asserting a behaviour the
    // product does not have.
    const withNothing = boards(ATLAS, new Set()).length;
    const disclosed = new Set<DisclosedFact>(touchers.map((commit) => touchedFact(commit, id)));
    const withFacts = boards(ATLAS, disclosed).length;
    expect(withFacts).toBeLessThan(withNothing);
  });
});

describe('the Ctrl+F gate over a commit board', () => {
  const commits = [
    { sha: 'bb00000000a1', date: '2026-01-01', subject: 'touch the engine', files: [0, 1] },
    { sha: 'bb00000000a2', date: '2026-02-01', subject: 'unrelated work', files: [2] },
    { sha: 'bb00000000a3', date: '2026-03-01', subject: 'more unrelated', files: [3, 4, 5] },
    { sha: 'bb00000000a4', date: '2026-04-01', subject: 'still unrelated', files: [6] },
  ];
  const subject = {
    words: new Set(['engine']),
    firstSeen: '2026-01-01',
    lastSeen: '2026-04-01',
    widthKnown: () => false,
  };

  it('scores `mentions` off the message naming the subject', () => {
    const verdict = gradeCommitHeuristics(subject, commits, [commits[0]!], ['mentions']);
    expect(verdict.scores[0]?.[1]).toBe(1);
    expect(verdict.passed).toBe(false);
  });

  it('scores `endpoints` off the two dates the inspector prints', () => {
    const verdict = gradeCommitHeuristics(subject, commits, [commits[0]!], ['endpoints']);
    // Picks the first and the last: half right, so below the bar but non-zero.
    expect(verdict.scores[0]?.[1]).toBeCloseTo(2 / 3, 5);
  });

  it('scores `oldestK` and `recentK` from opposite ends of the same ordering', () => {
    const oldest = gradeCommitHeuristics(subject, commits, [commits[0]!], ['oldestK']);
    const newest = gradeCommitHeuristics(subject, commits, [commits[0]!], ['recentK']);
    expect(oldest.scores[0]?.[1]).toBe(1);
    expect(newest.scores[0]?.[1]).toBe(0);
  });

  it('scores all five guesses by default, `recentK` included', () => {
    // **`recentK` is in the set and ADR-0019 left it out.** Its probe measured
    // `oldestK` beating 24 hono boards and `recentK` none; the real generator
    // reverses that — 0 and 3 — so excluding it would ship three boards a
    // player beats by ticking the newest rows. Pinned here because the default
    // set is the thing that decides it, and a test passing an explicit list
    // (as the others above do) cannot see the default change.
    expect([...COMMIT_TRACE_HEURISTICS]).toEqual([
      'mentions',
      'endpoints',
      'oldestK',
      'recentK',
      'broadKnown',
    ]);
    const verdict = gradeCommitHeuristics(subject, commits, [commits[0]!]);
    expect(verdict.scores.map(([id]) => id)).toEqual([...COMMIT_TRACE_HEURISTICS]);
  });

  it('scores `broadKnown` only over commits a reveal has priced', () => {
    const blind = gradeCommitHeuristics(subject, commits, [commits[2]!], ['broadKnown']);
    // Nothing priced ⇒ nothing picked ⇒ the guess is unavailable, not free.
    expect(blind.scores[0]?.[1]).toBe(0);
    const priced = gradeCommitHeuristics(
      { ...subject, widthKnown: () => true },
      commits,
      [commits[2]!],
      ['broadKnown'],
    );
    // `a3` is the widest at three files, and it is the answer.
    expect(priced.scores[0]?.[1]).toBe(1);
  });

  it('refuses a board a heuristic beats', () => {
    // Rewrite every commit that touched the engine to name it, and no other. The
    // `mentions` guess then picks exactly the answer key — a board answerable by
    // reading the messages, which pillar 3 says is not a question.
    const engineRef = ATLAS.nodes.findIndex((node) => node.path === 'src/core/engine.ts');
    const shouting = validateAtlas({
      ...ATLAS,
      challenges: [],
      history: {
        ...ATLAS.history,
        commits: ATLAS.history.commits.map((commit) => ({
          ...commit,
          subject: commit.files.includes(engineRef) ? 'rework the engine' : commit.subject,
        })),
      },
    });
    const before = generateWithReport(ATLAS, DEFAULT_GENERATE_OPTIONS);
    const after = generateWithReport(shouting, DEFAULT_GENERATE_OPTIONS);
    const id = engineId(ATLAS);
    expect(before.challenges.some((c) => c.subject === id)).toBe(true);
    expect(after.challenges.some((c) => c.subject === id)).toBe(false);
    expect(after.report.skipped.find(([reason]) => reason === 'ctrlF')?.[1]).toBeGreaterThan(0);
  });
});

describe('guardrail 4 — what it refuses', () => {
  it('asks nothing about a file whose rename lineage is contested', () => {
    // **And it does so without a branch of its own.** `commitSupply` refuses
    // every commit whose file list contains a barred node, so a contested file
    // has zero eligible touchers and never reaches the generator's body. A
    // first version had an explicit `uncertain` refusal here; it was
    // unreachable, which is why it is gone. The guarantee is what matters, so
    // it is asserted here rather than the branch.
    const contested = repo({ contested: [ENGINE] });
    const id = engineId(contested);
    const result = generateWithReport(contested, DEFAULT_GENERATE_OPTIONS);
    expect(result.challenges.find((c) => c.subject === id)).toBeUndefined();
    // Not even considered: it never reaches the body, so it is not a refusal.
    expect(result.report.subjectsConsidered).toBeLessThan(
      generateWithReport(ATLAS, DEFAULT_GENERATE_OPTIONS).report.subjectsConsidered,
    );
  });

  it('refuses the whole repo when the clone is shallow', () => {
    // A `--depth N` clone's oldest commit is diffed against the empty tree, so
    // git reports it as adding the entire worktree — which here would enter
    // *every* file's answer key as a member that never touched it.
    const shallow = validateAtlas({ ...ATLAS, repo: { ...ATLAS.repo, root: null } });
    const result = generateWithReport(shallow, DEFAULT_GENERATE_OPTIONS);
    expect(result.challenges).toHaveLength(0);
    expect(result.report.shallow).toBe(true);
  });

  it('asks nothing about a file with fewer than two eligible touchers', () => {
    for (const challenge of boards()) {
      expect(eligibleTouchersOf(ATLAS, challenge.subject).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the reveal', () => {
  const challenge = engineBoard();
  const grade = archaeology.grade(challenge, { picked: [...challenge.truth] });
  const reveal = archaeology.reveal(ATLAS, GRAPH, challenge, grade);

  it('names the subject file and every pick', () => {
    expect(reveal.subject).toBe('src/core/engine.ts');
    expect(reveal.notes).toHaveLength(challenge.truth.length);
  });

  it('never names another file a commit touched — that is Placement’s key', () => {
    // ADR-0019 decision 9, and ADR-0014's finding 3 running the other way. The
    // notes may state a *relation* ("a file that imports this one") and never an
    // identity.
    const text = [reveal.summary, ...reveal.notes.map((note) => note.note)].join(' ');
    for (const path of PATHS) {
      if (path === 'src/core/engine.ts') continue;
      expect(text, path).not.toContain(path);
    }
  });

  /**
   * The engine board relabelled so every wrong answer is `sibling`.
   *
   * **The generator's own boards here carry only `neighbour` and `distant`** —
   * the fixture's `src/core/` holds nothing that is not also an import
   * neighbour, so `neighbour` claims those commits first and `sibling` never
   * gets supply. Chasing that with a wider fixture would test the *allocator*;
   * what these two cases are about is what the **reveal** does with a label it
   * is handed, so the label is handed to it. `tests/atlas/` covers the
   * generator's real production of the class, at 117 spoken and 7 guarded.
   */
  function labelled(board: Challenge, strategy: string): Challenge {
    const answers = new Set(board.truth);
    return {
      ...board,
      witness: encodeWitness(
        board.candidates,
        new Map(board.candidates.filter((id) => !answers.has(id)).map((id) => [id, strategy])),
      ),
    };
  }

  function witnessesOn(atlas: Atlas, board: Challenge): readonly (string | null)[] {
    const answers = new Set(board.truth);
    const wrong = board.candidates.filter((id) => !answers.has(id));
    const reveal = archaeology.reveal(
      atlas,
      buildGraph(atlas),
      board,
      archaeology.grade(board, { picked: wrong }),
    );
    const witness = readWitness(board);
    return reveal.notes.filter((note) => witness.has(note.id)).map((note) => note.witness);
  }

  /**
   * A repo whose subject shares two tokens with a message — one useless.
   *
   * `src/io/a-reader-queue.ts` tokenises to `['a', 'reader', 'queue']`, and
   * `"a faster reader"` shares `a` **first** and `reader` second. That ordering
   * is the whole fixture: `shared` is in message order, so the first token is
   * the article. Not all three tokens are shared, so `namesTheFile` stays false
   * and the row falls to the gloss arm rather than the strong one.
   */
  function glossRepo(): Atlas {
    const paths = ['src/io/a-reader-queue.ts', 'src/io/sink.ts', 'src/io/tap.ts'];
    const base = atlasWith(paths, [['src/io/sink.ts', 'src/io/a-reader-queue.ts']]);
    const ref = (path: string): number => base.nodes.findIndex((node) => node.path === path);
    const commits = [
      { sha: 'bb0000000002', date: '2026-02-02', subject: 'a faster reader' },
      { sha: 'bb0000000001', date: '2026-01-05', subject: 'a small fix' },
    ];
    return validateAtlas({
      ...base,
      repo: { ...base.repo, head: 'f'.repeat(40), headDate: '2026-06-15', root: '0'.repeat(40) },
      history: {
        ...base.history,
        present: true,
        commitsWalked: commits.length,
        commitsRetained: commits.length,
        window: { from: '2026-01-05', to: '2026-06-15' },
        commits: commits.map((commit) => ({
          ...commit,
          files: [ref('src/io/a-reader-queue.ts')],
          wide: false,
          issue: null,
        })),
      },
    });
  }

  it('quotes a word that carries information, or does not quote one', () => {
    // **A cold playtester was told *"its message talks about “a”"*.** `shared`
    // is in message order and the gloss took `shared[0]`, so a path with a
    // one-letter token plus an English article produced a sentence that is
    // literally true and says nothing — the class-label landmine arriving in a
    // witness line. 36.0% of this repo's own 161 glossed rows quoted a token
    // under three characters, 43 of them the word `a`
    // (`npx tsx scripts/probe-gloss.ts`, at `9b13cf6`).
    const atlas = glossRepo();
    const graph = buildGraph(atlas);
    const subject = atlas.nodes.find((node) => node.path === 'src/io/a-reader-queue.ts')?.id ?? '';
    const ids = atlas.history.commits.map((commit) => commitIdFor(commit.sha));
    const [rich, thin] = ids;
    if (rich === undefined || thin === undefined) throw new Error('fixture lost its commits');
    const board = challengeFor(atlas, {
      verb: 'archaeology',
      subject,
      candidates: [...ids].sort(byteCompare),
      truth: [rich],
      evidence: { kind: 'history', touchedBy: 2 },
    });
    const notes = archaeology.reveal(
      atlas,
      graph,
      board,
      archaeology.grade(board, { picked: [...ids] }),
    ).notes;
    const noteFor = (id: string): string =>
      notes.find((note) => note.id === id)?.note ?? '(no note)';

    // The row that has a real word promotes it over the article.
    expect(noteFor(rich)).toContain('“reader”');
    // The row whose only shared token is the article says nothing about words at
    // all, rather than quoting one. Asserting the *absence of the quote* rather
    // than the presence of a particular fall-through keeps this a claim about
    // the gloss and not about the sentence that replaced it.
    expect(noteFor(thin)).not.toContain('“');
    for (const note of notes) expect(note.note).not.toContain('“a”');
  });

  it('withholds the `sibling` class, whatever the row', () => {
    // **The most expensive silence in the product, and the measurement is why.**
    // This class used to say *"a commit that touched this file's own corner of
    // the tree"* — a string prefix, which is the one hint a player can run
    // knowing nothing about the repo. Pooled across the boards hinting about one
    // commit it scores **0.800** against a 0.78 bar (ADR-0021's re-measure).
    //
    // Withheld by **class**, not by row and not by board: the best single board
    // reaches 0.667 and the 0.800 is the union of three, so no guard that sees
    // one board can bound it.
    const witnesses = witnessesOn(ATLAS, labelled(challenge, 'sibling'));
    // Non-vacuous: the rows are still generated and still on the board — it is
    // the *sentence* that is gone, not the wrong answers.
    expect(witnesses.length).toBeGreaterThan(5);
    for (const text of witnesses) expect(text).toBeNull();
  });

  it('speaks the same class on every row of a board, or on none', () => {
    // ADR-0020's central rule at unit scale. Every guard is a property of the
    // *subject*, so a board either says "a commit that touched this file's own
    // directory" for all of them or for none — a per-row guard would make the
    // absence of a line say which class the row was in.
    const spoken = witnessesOn(ATLAS, labelled(challenge, 'companion'));
    expect(new Set(spoken).size).toBe(1);
  });

  it('never prints a commit’s width, which is `broadKnown`’s input', () => {
    const text = reveal.notes.map((note) => note.note).join(' ');
    for (const commit of ATLAS.history.commits) {
      // The only numbers a note may carry are about the subject, not about how
      // many files a commit touched.
      expect(text).not.toContain(`${commit.files.length} files`);
      expect(text).not.toContain(`${commit.files.length} indexed`);
    }
  });

  it('tells the player something different about each correct pick', () => {
    // **ADR-0018's `whyYes` defect, reproduced once in the verb written to
    // learn from it.** The first version had a names-it/does-not arm and a
    // position clause, so a file whose commits never say its name got the
    // identical sentence under every correct pick — *"six words that told the
    // player nothing they could check"*. A note now carries how long the file
    // sat still before that change, which differs per member and is checkable
    // against the dates on the board.
    const correct = reveal.notes.filter((note) => note.kind === 'correct');
    expect(correct.length).toBeGreaterThan(2);
    expect(new Set(correct.map((note) => note.note)).size).toBe(correct.length);
  });

  // **The `sibling` arm of this guard is gone with the class it guarded.** There
  // used to be a companion test that moved two files into a directory of their
  // own so a corner held exactly one other file, proving the existential could
  // not name it. The corner set went when `sibling` was withheld (ADR-0021's
  // re-measure); the guard itself is still live for the two classes below.
  it('never lets a relation over one file become that file’s name', () => {
    // A subject with exactly one co-change partner or one import neighbour makes
    // "it changed a file that usually moves with this one" name that file — an
    // atom of the commit's Placement key. Measured at 4 such notes on hono
    // before the guard.
    for (const board of boards()) {
      const ref = ATLAS.nodes.findIndex((node) => node.id === board.subject);
      const adjacent = new Set<number>();
      for (const edge of GRAPH.out[ref] ?? []) adjacent.add(edge.to);
      for (const edge of GRAPH.in[ref] ?? []) adjacent.add(edge.from);
      const partners = new Set<number>();
      for (const [a, b] of ATLAS.history.coChange) {
        if (a === ref) partners.add(b);
        else if (b === ref) partners.add(a);
      }
      if (adjacent.size > 1 && partners.size > 1) continue;
      // **Pick the wrong answers**, because `whyNot` only runs for a *spurious*
      // note — grading with an empty answer produces only `missed` notes, which
      // go to `whyYes`, and the assertion passes without executing the code it
      // is about. Two mutants survived this suite before the picks were added.
      const wrong = board.candidates.filter((id) => !board.truth.includes(id));
      expect(wrong.length, board.id).toBeGreaterThan(0);
      const said = archaeology
        .reveal(ATLAS, GRAPH, board, archaeology.grade(board, { picked: wrong }))
        .notes.map((note) => note.note)
        .join(' ');
      if (adjacent.size === 1) expect(said, board.id).not.toContain('import edge');
      if (partners.size === 1) expect(said, board.id).not.toContain('usually moves with');
    }
  });

  it('draws nothing on the map', () => {
    expect(reveal.unlocks).toBe('nothing');
    expect(channelOf('archaeology')).toBe('nothing');
  });

  /**
   * **The reveal and the field note must state the same population**, and an
   * adversarial review found them stating different ones: the summary read the
   * *eligible* toucher count while `noteWeights` counted every *retained*
   * toucher, so the two disagreed on 21 of this repo's 26 boards. Worse, when
   * the eligible count equalled the key the summary printed *"that is every
   * commit in this window that touched X"* — **false of the atlas's own record**
   * on 4 boards, and falsifiable by the player with one `git log`.
   */
  it('agrees with the field note about how many commits touched the file', () => {
    for (const board of boards()) {
      const population = archaeology.noteWeights(GRAPH, board.subject).size;
      expect(board.evidence.kind).toBe('history');
      if (board.evidence.kind !== 'history') continue;
      expect(board.evidence.touchedBy, board.id).toBe(population);
    }
  });

  it('says "that is every commit" only when it is every commit in the record', () => {
    for (const board of boards()) {
      const said = archaeology.reveal(
        ATLAS,
        GRAPH,
        board,
        archaeology.grade(board, { picked: [...board.truth] }),
      ).summary;
      if (!said.includes('That is every commit')) continue;
      // The claim is about the atlas's retained record, so it is checked
      // against that and not against whatever the generator was willing to ask.
      expect(touchersOf(ATLAS, board.subject).size, board.id).toBe(board.truth.length);
    }
  });

  it('states the population as revealed, never folded into the claim', () => {
    const touchers = touchersOf(ATLAS, challenge.subject).size;
    expect(reveal.summary).toContain(String(touchers));
    expect(challenge.evidence.kind).toBe('history');
  });
});

describe('what a pass is worth', () => {
  const challenge = engineBoard();

  it('holds while the commit still names the file, and stops when it does not', () => {
    const member = challenge.truth[0] ?? '';
    expect(archaeology.stillHolds(GRAPH, challenge.subject, member)).toBe(true);
    // A commit that has slid out of the window takes its claim with it.
    const narrowed = validateAtlas({
      ...ATLAS,
      history: {
        ...ATLAS.history,
        commitsRetained: ATLAS.history.commits.length - 1,
        commits: ATLAS.history.commits.filter((c) => commitIdFor(c.sha) !== member),
      },
      challenges: [],
    });
    expect(archaeology.stillHolds(buildGraph(narrowed), challenge.subject, member)).toBe(false);
  });

  it('refuses a member that is not a commit, rather than guessing', () => {
    expect(archaeology.stillHolds(GRAPH, challenge.subject, challenge.subject)).toBe(false);
  });

  it('writes a note about commits, in a unit that has no gradient', () => {
    const weights = archaeology.noteWeights(GRAPH, challenge.subject);
    expect([...weights.values()].every((weight) => weight === 1)).toBe(true);
    expect(weights.size).toBe(touchersOf(ATLAS, challenge.subject).size);
    const prose = archaeology.noteProse({
      subjectLabel: 'src/core/engine.ts',
      proved: [{ label: '2026-01-05  aa0000000001  "start the loop"', weight: 1 }],
      farthest: 1,
      population: 9,
      noun: { one: 'commit', many: 'commits' },
      populationNoun: { one: 'commit', many: 'commits' },
    });
    expect(prose.claim).toContain('1 commit that changed src/core/engine.ts');
    expect(prose.claim).not.toContain('hops');
    expect(prose.revealed).toContain('the other 8 revealed to you, never proved');
  });

  it('labels its subject as a path, because the subject is a file', () => {
    expect(archaeology.subjectLabel(GRAPH, challenge.subject)).toBe('src/core/engine.ts');
    expect(archaeology.subjectLabel(GRAPH, commitIdFor('aa0000000001'))).toBeNull();
  });
});

describe('what it declares to a later verb', () => {
  it('declares each key member as a (commit, file) atom', () => {
    const challenge = engineBoard();
    const facts = [...archaeology.discloses(challenge)].sort();
    const expected = challenge.truth.map((id) => touchedFact(id, challenge.subject)).sort();
    expect(facts).toEqual(expected);
  });

  it('declares no width fact, because its reveal never prints one', () => {
    const challenge = engineBoard();
    for (const fact of archaeology.discloses(challenge)) {
      expect(fact.startsWith('width')).toBe(false);
    }
    // The asymmetry with Placement, pinned: that verb prints `evidence.touched`
    // and declares it; this one is forbidden from printing it and declares none.
    expect(widthFact(commitIdFor('aa0000000001')).startsWith('width')).toBe(true);
  });
});

describe('where it sits in the curriculum', () => {
  it('is tier 5, above the import verbs and below Placement', () => {
    for (const challenge of boards()) expect(challenge.tier).toBe(5);
  });

  it('sorts after a tier-3 question about the same file, despite the id', () => {
    // The hazard ADR-0019 decision 8 names: `archaeology-…` sorts *before*
    // `blast-…` by id, which is the order the atlas stores. The map's click path
    // must use `challengeOrder`, which is tier first.
    const history = { tier: 5, id: 'archaeology-abc' };
    const imports = { tier: 3, id: 'blast-abc' };
    expect([history, imports].sort(challengeOrder)).toEqual([imports, history]);
    expect(history.id < imports.id).toBe(true);
  });

  it('registers in the one list of verbs', () => {
    expect(VERBS.archaeology.id).toBe('archaeology');
  });
});

