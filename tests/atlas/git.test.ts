/**
 * `repo.root` against real git.
 *
 * This is the one field in the atlas that exists purely for the player's save
 * (ADR-0011), and it has a failure mode no fixture can reproduce: in a
 * **shallow clone** the oldest reachable commit is a graft boundary, not a
 * root. It looks parentless to `rev-list --max-parents=0`, but it moves on
 * every `fetch --deepen` and differs between two clones of the same repo — so
 * keying a save on it would silently rotate the save.
 *
 * That is not a hypothetical: both large repos this was measured against were
 * `--depth` clones. So the guard is exercised here against an actual shallow
 * clone rather than asserted about in a comment.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readGitHistory } from '../../src/indexer/git.js';

const run = promisify(execFile);

/** Identity and dates pinned so the fixture is the same commit every run. */
const AUTHOR = {
  GIT_AUTHOR_NAME: 'Ark Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Ark Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
} as const;

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'safe.directory=*', ...args], {
    cwd,
    env: { ...process.env, ...AUTHOR, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return stdout;
}

let origin = '';
let shallow = '';
let firstCommit = '';

beforeAll(async () => {
  origin = await mkdtemp(join(tmpdir(), 'ark-root-origin-'));
  shallow = await mkdtemp(join(tmpdir(), 'ark-root-shallow-'));

  await git(origin, ['init', '-q', '-b', 'main']);
  for (const [n, text] of [
    ['a', 'export const a = 1;\n'],
    ['b', 'export const b = 2;\n'],
    ['c', 'export const c = 3;\n'],
  ] as const) {
    await writeFile(join(origin, `${n}.ts`), text, 'utf8');
    await git(origin, ['add', '-A']);
    await git(origin, ['commit', '-q', '-m', `add ${n}`]);
  }
  firstCommit = (await git(origin, ['rev-list', '--max-parents=0', 'HEAD'])).trim();

  // `--depth` is ignored for a plain local path — git hardlinks the object
  // store instead — so the clone has to go through the file:// transport to
  // actually be shallow.
  await git(shallow, ['clone', '-q', '--depth', '1', `file://${origin}`, 'clone']);
}, 30_000);

afterAll(async () => {
  await rm(origin, { recursive: true, force: true });
  await rm(shallow, { recursive: true, force: true });
});

describe('repo.root', () => {
  it('is the first commit, not HEAD', async () => {
    const history = await readGitHistory(origin, 100);
    expect(history.root).toBe(firstCommit);
    expect(history.head).not.toBe(history.root);
    expect(history.root).toMatch(/^[0-9a-f]{40}$/);
  });

  it('does not move when HEAD does — the whole reason the save keys on it', async () => {
    const before = await readGitHistory(origin, 100);
    await writeFile(join(origin, 'd.ts'), 'export const d = 4;\n', 'utf8');
    await git(origin, ['add', '-A']);
    await git(origin, ['commit', '-q', '-m', 'add d']);
    const after = await readGitHistory(origin, 100);
    expect(after.head).not.toBe(before.head);
    expect(after.root).toBe(before.root);
  });

  it('is null in a shallow clone, where the oldest commit is a graft boundary', async () => {
    const history = await readGitHistory(join(shallow, 'clone'), 100);
    expect(history.present).toBe(true);
    expect(history.head).toMatch(/^[0-9a-f]{40}$/);
    // The graft boundary *looks* parentless. Reporting it as the root would key
    // the save on a sha that changes with `fetch --deepen`.
    const boundary = (await git(join(shallow, 'clone'), ['rev-list', '--max-parents=0', 'HEAD'])).trim();
    expect(boundary).toMatch(/^[0-9a-f]{40}$/);
    expect(history.root).toBeNull();
  });

  it('ignores a root merged in from an unrelated history', async () => {
    // Why `--first-parent` is in the query. `--max-parents=0` alone lists
    // *every* root, and a subtree merge or an imported history adds one — so a
    // repo with a single root last week has two today, and a "pick one from the
    // list" rule can change its mind and rotate every player's save. The
    // first-parent walk is linear, so exactly one commit on it has no parent:
    // this repo's own mainline root, which a merge cannot move.
    const dir = await mkdtemp(join(tmpdir(), 'ark-root-merge-'));
    try {
      await git(dir, ['init', '-q', '-b', 'main']);
      await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n', 'utf8');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-q', '-m', 'mainline root']);
      const mainlineRoot = (await git(dir, ['rev-parse', 'HEAD'])).trim();

      await git(dir, ['checkout', '-q', '--orphan', 'vendor']);
      await git(dir, ['rm', '-rq', '--cached', '.']);
      await writeFile(join(dir, 'vendored.ts'), 'export const v = 1;\n', 'utf8');
      await git(dir, ['add', 'vendored.ts']);
      // Dated *after* the mainline root on purpose: `rev-list` without
      // `--first-parent` orders by commit date, so this is the sha a naive
      // query would return first.
      await run('git', ['commit', '-q', '-m', 'vendored root'], {
        cwd: dir,
        env: {
          ...process.env,
          ...AUTHOR,
          GIT_AUTHOR_DATE: '2026-06-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2026-06-01T00:00:00Z',
        },
      });
      const vendoredRoot = (await git(dir, ['rev-parse', 'HEAD'])).trim();

      // `rm --cached` left a.ts untracked in the worktree, and checkout refuses
      // to overwrite an untracked file with a tracked one.
      await rm(join(dir, 'a.ts'));
      await git(dir, ['checkout', '-q', 'main']);
      await git(dir, ['merge', '-q', '--no-ff', '--allow-unrelated-histories', '-m', 'vendor', 'vendor']);

      // The premise: there really are two roots now, and the vendored one comes
      // out first. Without this the assertion below could pass vacuously.
      const roots = (await git(dir, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n');
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(vendoredRoot);

      const history = await readGitHistory(dir, 100);
      expect(history.root).toBe(mainlineRoot);
      expect(history.root).not.toBe(vendoredRoot);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('is null for a directory that is not a repo', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ark-root-none-'));
    try {
      const history = await readGitHistory(empty, 100);
      expect(history.present).toBe(false);
      expect(history.root).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
