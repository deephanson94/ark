import { describe, expect, it } from 'vitest';

import type { GitCommit, GitHistory } from '../../src/indexer/git.js';
import { parseLog } from '../../src/indexer/git.js';
import { DEFAULT_HISTORY_LIMITS, buildHistory } from '../../src/indexer/history.js';

const NUL = String.fromCharCode(0);
const UNIT = String.fromCharCode(31);

function commit(partial: Partial<GitCommit> & Pick<GitCommit, 'sha' | 'date' | 'files'>): GitCommit {
  return {
    author: 'ada',
    subject: 'a change',
    renames: [],
    ...partial,
  };
}

function history(commits: readonly GitCommit[]): GitHistory {
  return {
    present: true,
    head: commits[0]?.sha ?? null,
    headDate: commits[0]?.date ?? null,
    commits,
    totalCommits: commits.length,
  };
}

describe('parseLog', () => {
  it('reads the NUL-delimited numstat stream', () => {
    const log =
      `ARK${UNIT}abc123${UNIT}2026-01-02${UNIT}ada${UNIT}second${NUL}\n` +
      `4\t2\tsrc/b.ts${NUL}` +
      `ARK${UNIT}def456${UNIT}2026-01-01${UNIT}grace${UNIT}first${NUL}\n` +
      `9\t0\tsrc/a.ts${NUL}`;
    const commits = parseLog(log);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ sha: 'abc123', date: '2026-01-02', author: 'ada', subject: 'second' });
    expect(commits[0]?.files).toEqual(['src/b.ts']);
    expect(commits[1]?.files).toEqual(['src/a.ts']);
  });

  it('reads a rename record, which git emits as three fields', () => {
    const log =
      `ARK${UNIT}abc123${UNIT}2026-01-02${UNIT}ada${UNIT}move it${NUL}\n` +
      `1\t0\t${NUL}src/old.ts${NUL}src/new.ts${NUL}`;
    const commits = parseLog(log);
    expect(commits[0]?.renames).toEqual([['src/old.ts', 'src/new.ts']]);
    expect(commits[0]?.files).toEqual(['src/new.ts']);
  });

  it('handles a commit that touched nothing', () => {
    const log =
      `ARK${UNIT}aaa${UNIT}2026-01-02${UNIT}ada${UNIT}empty${NUL}\n` +
      `ARK${UNIT}bbb${UNIT}2026-01-01${UNIT}ada${UNIT}real${NUL}\n` +
      `1\t1\tx.ts${NUL}`;
    const commits = parseLog(log);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.files).toEqual([]);
  });

  it('keeps a subject that contains a tab-separated-looking string', () => {
    const log = `ARK${UNIT}aaa${UNIT}2026-01-02${UNIT}ada${UNIT}fix 1\t2\tthing${NUL}\n`;
    expect(parseLog(log)[0]?.subject).toBe('fix 1\t2\tthing');
  });
});

describe('buildHistory — churn', () => {
  const paths = ['a.ts', 'b.ts'];
  const result = buildHistory(
    history([
      commit({ sha: 'c3', date: '2026-03-01', files: ['a.ts'], author: 'ada' }),
      commit({ sha: 'c2', date: '2026-02-01', files: ['a.ts', 'b.ts'], author: 'grace' }),
      commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'], author: 'ada' }),
    ]),
    paths,
    DEFAULT_HISTORY_LIMITS,
  );

  it('counts commits touching each file', () => {
    expect(result.perFile.get('a.ts')?.churn).toBe(3);
    expect(result.perFile.get('b.ts')?.churn).toBe(1);
  });

  it('gets first and last seen the right way round despite the newest-first log', () => {
    expect(result.perFile.get('a.ts')?.firstSeen).toBe('2026-01-01');
    expect(result.perFile.get('a.ts')?.lastSeen).toBe('2026-03-01');
  });

  it('counts distinct authors', () => {
    expect(result.perFile.get('a.ts')?.authors).toBe(2);
    expect(result.perFile.get('b.ts')?.authors).toBe(1);
  });

  it('reports the window the history covers', () => {
    expect(result.window).toEqual({ from: '2026-01-01', to: '2026-03-01' });
  });

  it('gives a file with no commits a zeroed record rather than omitting it', () => {
    const fresh = buildHistory(history([]), ['new.ts'], DEFAULT_HISTORY_LIMITS);
    expect(fresh.perFile.get('new.ts')).toEqual({
      originPath: 'new.ts',
      churn: 0,
      authors: 0,
      firstSeen: null,
      lastSeen: null,
    });
  });
});

describe('buildHistory — rename lineage', () => {
  it('follows a file back through a rename', () => {
    const result = buildHistory(
      history([
        commit({
          sha: 'c2',
          date: '2026-02-01',
          files: ['src/new.ts'],
          renames: [['src/old.ts', 'src/new.ts']],
        }),
        commit({ sha: 'c1', date: '2026-01-01', files: ['src/old.ts'] }),
      ]),
      ['src/new.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    const record = result.perFile.get('src/new.ts');
    // Without rename following this would be churn 1 and firstSeen February —
    // the file would look new when it is the oldest thing in the repo.
    expect(record?.churn).toBe(2);
    expect(record?.firstSeen).toBe('2026-01-01');
    expect(record?.originPath).toBe('src/old.ts');
  });

  it('follows a chain of renames to the earliest path', () => {
    const result = buildHistory(
      history([
        commit({ sha: 'c3', date: '2026-03-01', files: ['c.ts'], renames: [['b.ts', 'c.ts']] }),
        commit({ sha: 'c2', date: '2026-02-01', files: ['b.ts'], renames: [['a.ts', 'b.ts']] }),
        commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'] }),
      ]),
      ['c.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    expect(result.perFile.get('c.ts')?.originPath).toBe('a.ts');
    expect(result.perFile.get('c.ts')?.churn).toBe(3);
  });

  it('does not hand one file the history of another that reused its path', () => {
    // a.ts became b.ts, then a new a.ts appeared. The old history belongs to
    // whichever claimed it first in log order, and never to both.
    const result = buildHistory(
      history([
        commit({ sha: 'c2', date: '2026-02-01', files: ['b.ts'], renames: [['a.ts', 'b.ts']] }),
        commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'] }),
      ]),
      ['a.ts', 'b.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    const origins = [result.perFile.get('a.ts')?.originPath, result.perFile.get('b.ts')?.originPath];
    expect(new Set(origins).size).toBe(2);
  });
});

describe('buildHistory — co-change', () => {
  const limits = { ...DEFAULT_HISTORY_LIMITS, minCoChangeCount: 2, wideCommitFiles: 3 };

  it('counts pairs that move together', () => {
    const result = buildHistory(
      history([
        commit({ sha: 'c2', date: '2026-02-01', files: ['a.ts', 'b.ts'] }),
        commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts', 'b.ts'] }),
      ]),
      ['a.ts', 'b.ts'],
      limits,
    );
    expect(result.coChange).toEqual([['a.ts', 'b.ts', 2]]);
  });

  it('drops pairs seen fewer times than the threshold', () => {
    const result = buildHistory(
      history([commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts', 'b.ts'] })]),
      ['a.ts', 'b.ts'],
      limits,
    );
    expect(result.coChange).toEqual([]);
  });

  it('excludes a sweeping commit, which would couple everything to everything', () => {
    const wide = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const result = buildHistory(
      history([
        commit({ sha: 'c2', date: '2026-02-01', files: wide }),
        commit({ sha: 'c1', date: '2026-01-01', files: wide }),
      ]),
      wide,
      limits,
    );
    expect(result.coChange).toEqual([]);
    expect(result.commits[0]?.wide).toBe(true);
  });

  it('sorts by count descending', () => {
    const result = buildHistory(
      history([
        commit({ sha: 'c3', date: '2026-03-01', files: ['a.ts', 'b.ts'] }),
        commit({ sha: 'c2', date: '2026-02-01', files: ['a.ts', 'b.ts'] }),
        commit({ sha: 'c1', date: '2026-01-01', files: ['b.ts', 'c.ts'] }),
      ]),
      ['a.ts', 'b.ts', 'c.ts'],
      { ...limits, minCoChangeCount: 1 },
    );
    expect(result.coChange.map(([, , count]) => count)).toEqual([2, 1]);
  });
});

describe('buildHistory — budget', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    commit({ sha: `c${i}`, date: '2026-01-01', files: ['a.ts'] }),
  );

  it('retains only the newest commits and says how many it dropped', () => {
    const result = buildHistory(history(many), ['a.ts'], { ...DEFAULT_HISTORY_LIMITS, maxCommits: 5 });
    expect(result.commits).toHaveLength(5);
    expect(result.truncations).toContainEqual({ what: 'commits', kept: 5, dropped: 15 });
  });

  it('caps the file list of a huge commit and reports it', () => {
    const files = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    const result = buildHistory(
      history([commit({ sha: 'big', date: '2026-01-01', files })]),
      files,
      { ...DEFAULT_HISTORY_LIMITS, maxCommitFiles: 10, wideCommitFiles: 100 },
    );
    expect(result.commits[0]?.files).toHaveLength(10);
    expect(result.truncations).toContainEqual({ what: 'commitFiles', kept: 10, dropped: 30 });
  });

  it('reports nothing when nothing was dropped', () => {
    const result = buildHistory(
      history([commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'] })]),
      ['a.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    expect(result.truncations).toEqual([]);
  });

  it('truncates a long subject rather than carrying it into the atlas', () => {
    const result = buildHistory(
      history([commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'], subject: 'x'.repeat(300) })]),
      ['a.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    expect(result.commits[0]?.subject).toHaveLength(120);
  });

  it('extracts an issue number from the subject', () => {
    const result = buildHistory(
      history([commit({ sha: 'c1', date: '2026-01-01', files: ['a.ts'], subject: 'fix crash (#4412)' })]),
      ['a.ts'],
      DEFAULT_HISTORY_LIMITS,
    );
    expect(result.commits[0]?.issue).toBe(4412);
  });
});
