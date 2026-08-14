/**
 * Git history extraction. Plumbing commands over a subprocess — no libgit2, no
 * native module, nothing to install (NORTH-STAR §10).
 *
 * Three landmines are defused here, all of them silent if you miss them:
 *
 *   LC_ALL=C            git localises `--name-status` and `--porcelain`
 *                       headers, so without this the output — and therefore the
 *                       atlas — differs by machine locale.
 *   -M                  without rename detection, git reports a rename as a
 *                       delete plus an add, so churn is wrong in exactly the
 *                       files that have moved the most.
 *   config isolation    `diff.renames`, `log.date` and friends live in the
 *                       user's global config. Two developers with different
 *                       dotfiles would produce different atlases for the same
 *                       commit. `safe.directory=*` is re-added by hand because
 *                       it is the one global setting we actually need.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Field separator inside a commit header. */
const UNIT = '\u001f';
const RECORD = `ARK${UNIT}`;
const MAX_BUFFER = 256 * 1024 * 1024;

const BASE_ARGS = [
  '-c',
  'safe.directory=*',
  '-c',
  'core.quotepath=false',
  '-c',
  'log.showSignature=false',
];

export interface GitCommit {
  readonly sha: string;
  /** `YYYY-MM-DD`, author date. */
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  /** Paths as of this commit. For a rename, the new path. */
  readonly files: readonly string[];
  /** `[from, to]` pairs detected by `-M`. */
  readonly renames: readonly (readonly [string, string])[];
}

export interface GitHistory {
  readonly present: boolean;
  readonly head: string | null;
  readonly headDate: string | null;
  /**
   * The repo's first commit — its identity, as opposed to `head`, which is its
   * state. The player keys saved progress on it (ADR-0011), so it has to be a
   * sha that does not move when the repo does.
   *
   * Null for a repo with no history *and* for a shallow clone, where the
   * oldest reachable commit is a graft boundary that moves on every fetch. See
   * `readRootCommit`.
   */
  readonly root: string | null;
  /** Newest first. */
  readonly commits: readonly GitCommit[];
  /** Total commits reachable from HEAD, even if we only walked `commits`. */
  readonly totalCommits: number;
  /**
   * The repo-relative directory being indexed, when it is **not** the repository root — and `null`
   * when it is. Non-null means rename detection was **off** for this walk; see `readGitHistory`.
   */
  readonly subtree: string | null;
}

export const NO_HISTORY: GitHistory = {
  present: false,
  head: null,
  headDate: null,
  root: null,
  commits: [],
  totalCommits: 0,
  subtree: null,
};

interface Isolation {
  readonly env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

/**
 * An environment in which git reads no configuration but the repo's own.
 *
 * `GIT_CONFIG_GLOBAL` points at a real empty file in a temp directory rather
 * than at a null device. `/dev/null` does not exist on Windows, and
 * `os.devNull` there is `\\.\nul`, which git does not read as a config file —
 * either way it can fall back to the user's real global config, silently
 * reintroducing the machine dependence this exists to remove. An empty regular
 * file means the same thing on every platform.
 */
async function isolate(): Promise<Isolation> {
  const directory = await mkdtemp(join(tmpdir(), 'ark-git-'));
  const emptyConfig = join(directory, 'gitconfig');
  await writeFile(emptyConfig, '', 'utf8');
  return {
    env: {
      ...process.env,
      // Locale and timezone both leak into git's output formatting.
      LC_ALL: 'C',
      LANG: 'C',
      TZ: 'UTC',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_TERMINAL_PROMPT: '0',
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function git(root: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('git', [...BASE_ARGS, ...args], {
    cwd: root,
    maxBuffer: MAX_BUFFER,
    env,
  });
  return stdout;
}

async function tryGit(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    return await git(root, args, env);
  } catch {
    return null;
  }
}

/**
 * The sha of the first commit on HEAD's first-parent chain, or null.
 *
 * `--first-parent` is not decoration. Without it, `--max-parents=0` lists
 * *every* root in the repo, and a subtree merge or an imported history adds
 * one — so a repo that had a single root last week can have two today, and any
 * "pick one" rule that reads the whole list can change its mind. The
 * first-parent walk from HEAD is a linear chain, so exactly one commit on it
 * has no parent: the root of this repo's own mainline. Merging someone else's
 * history in does not move it.
 *
 * Null for a **shallow clone**, where the oldest reachable commit is a graft
 * boundary rather than a root: it looks parentless, but it moves on every
 * `fetch --deepen` and differs between two clones of the same repo. Keying a
 * save on it would silently rotate the save. Not a corner case — of the repos
 * this was measured against, both large ones were `--depth` clones.
 */
async function readRootCommit(root: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const shallow = await tryGit(root, ['rev-parse', '--is-shallow-repository'], env);
  if (shallow === null || shallow.trim() !== 'false') return null;
  const roots = await tryGit(root, ['rev-list', '--max-parents=0', '--first-parent', 'HEAD'], env);
  const first = roots?.split('\n')[0]?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(first) ? first : null;
}

/**
 * The repo-relative directory being indexed, or `null` when it **is** the repository root.
 *
 * Both paths are canonicalised before comparing, because a session may be indexing through a
 * symlink and `git rev-parse --show-toplevel` always answers with the real path — comparing the two
 * raw would call every symlinked root a subtree and silently turn rename detection off.
 */
function subtreeOf(toplevel: string | null, root: string): string | null {
  if (toplevel === null || toplevel === '') return null;
  let a = toplevel;
  let b = root;
  try {
    a = realpathSync(toplevel);
    b = realpathSync(root);
  } catch {
    // An unreadable path is not a reason to guess; fall back to the raw strings.
  }
  const top = a.replace(/[/\\]+$/, '');
  const here = b.replace(/[/\\]+$/, '');
  if (here === top) return null;
  const prefix = here.startsWith(`${top}/`) ? here.slice(top.length + 1) : null;
  return prefix === null || prefix === '' ? null : prefix;
}

/**
 * Read history. Returns `NO_HISTORY` for a directory that is not a repo, or a
 * repo with no commits — tiers 1–4 must stay fully playable without git
 * (NORTH-STAR risk #7), so this is a normal outcome, not an error.
 */
export async function readGitHistory(root: string, maxCommits: number): Promise<GitHistory> {
  const isolation = await isolate();
  try {
    const { env } = isolation;

    const gitDir = await tryGit(root, ['rev-parse', '--git-dir'], env);
    if (gitDir === null) return NO_HISTORY;

    // **Where are we relative to the repository?** `--relative` below makes git report paths
    // relative to `cwd`, which is what a subtree index needs — but it also restricts the tree diff
    // to the prefix **before rename detection runs**, so `-M` re-pairs adds with deletes *inside*
    // the subtree and invents renames the repository does not contain. Measured on `honojs/hono`:
    // at the root git pairs `src/adapter.ts → deno_dist/helper/adapter/index.ts`, and from `src/`
    // it pairs `adapter.ts → helper/adapter/index.ts` — a different rename graph, which
    // `applyRenames` writes as `lineage: 'certain'` because the invented source path is dead and
    // the `contested` branch never fires. Six such pairs on `hono/src`, and a synthetic fixture
    // turns one into a Placement answer key naming a file the commit never touched.
    //
    // So rename detection is **on only where git can see the whole tree**. In a subtree a rename
    // reports as delete + add: churn is split across the two paths and lineage is lost, which is
    // the documented cost of dropping `-M` (CLAUDE.md) and is the safe direction — a missing
    // lineage costs a challenge, an invented one is a wrong answer key. It is reported rather than
    // absorbed: `subtree` is non-null exactly when this happened, and the CLI says so.
    const toplevel = (await tryGit(root, ['rev-parse', '--show-toplevel'], env))?.trim() ?? null;
    const subtree = subtreeOf(toplevel, root);

    const countText = await tryGit(root, ['rev-list', '--count', 'HEAD'], env);
    if (countText === null) return NO_HISTORY;
    const totalCommits = Number.parseInt(countText.trim(), 10);
    if (!Number.isFinite(totalCommits) || totalCommits === 0) return NO_HISTORY;

    const log = await tryGit(
      root,
      [
        'log',
        '-z',
        // Rename detection only at the repository root — see the comment above `toplevel`.
        //
        // **`--no-renames` rather than merely dropping `-M`.** git has detected renames by
        // default since 2.9, so removing the flag changes nothing: measured on `hono/src`, the
        // default still reports **30** rename records and only `--no-renames` takes it to 0. A
        // first version of this guard dropped `-M` and was silently inert.
        ...(subtree === null ? ['-M'] : ['--no-renames']),
        // **`--name-status`, not `--numstat`** — a 13× difference, measured.
        //
        // Nothing downstream uses the added/deleted line counts: `parseLog`
        // read the third tab-separated field and threw the first two away, and
        // churn, authorship, co-change and rename lineage all need only *which*
        // files a commit touched. But `--numstat` makes git diff the content of
        // every file in every commit to produce them. On vitejs/vite (3,730
        // commits) that was **4,027 ms**; `--name-status`, which needs no
        // content diff, is **308 ms** for the same information and a slightly
        // smaller payload. It was 42% of the whole index.
        '--name-status',
        // **`--relative`, because the index root and the repository root are not the same string.**
        //
        // `git log` runs with `cwd` set to the directory being indexed, but it reports paths
        // relative to the **repository** root regardless. Point the CLI at `packages/rxjs/src` of a
        // monorepo and every commit's file list reads `packages/rxjs/src/every.ts` while every node
        // is keyed `every.ts`, so **no commit intersects any node**: `commits.ts` drops all of them
        // for `touched.size === 0` and all three history verbs ship zero boards. Measured on rxjs
        // `54796b38`: 5,976 commits walked, **0 retained**, 231 nodes, **1 challenge**.
        //
        // `--relative` makes the diff output relative to `cwd` *and* drops files outside it, which
        // is both halves of what a subtree index needs. It is a no-op when `cwd` is the repository
        // root, which is why every existing atlas is byte-identical across this change (asserted by
        // `test:determinism` and the golden atlas).
        //
        // This is ADR-0026's cobra defect a third time — *a path prefix and a node key are not the
        // same string* — now between git and the walk rather than inside either. ADR-0042 §7.
        '--relative',
        // `short` renders each commit in *its own* recorded timezone, so a repo
        // with contributors in two zones produces dates that do not decrease
        // along the log, and two commits made at the same instant get different
        // dates. `short-local` renders them all in TZ, pinned to UTC above.
        '--date=short-local',
        `--format=${RECORD}%H${UNIT}%ad${UNIT}%an${UNIT}%s`,
        '-n',
        String(maxCommits),
      ],
      env,
    );
    if (log === null) return NO_HISTORY;

    const commits = parseLog(log);
    const head = commits[0];
    if (head === undefined) return NO_HISTORY;

    return {
      present: true,
      head: head.sha,
      headDate: head.date,
      root: await readRootCommit(root, env),
      subtree,
      commits,
      totalCommits,
    };
  } finally {
    await isolation.cleanup();
  }
}

interface MutableCommit {
  sha: string;
  date: string;
  author: string;
  subject: string;
  files: string[];
  renames: [string, string][];
}

export function parseLog(stdout: string): GitCommit[] {
  const fields = stdout.split('\u0000');
  const commits: GitCommit[] = [];
  let current: MutableCommit | null = null;

  for (let i = 0; i < fields.length; i++) {
    // The `--format` output is NUL-terminated, but git still writes the newline
    // that separated it from the numstat block, so it lands at the head of the
    // next field.
    const field = (fields[i] ?? '').replace(/^\n+/, '');
    if (field.length === 0) continue;

    if (field.startsWith(RECORD)) {
      if (current !== null) commits.push(freeze(current));
      const parts = field.slice(RECORD.length).split(UNIT);
      current = {
        sha: parts[0] ?? '',
        date: parts[1] ?? '',
        author: parts[2] ?? '',
        subject: parts.slice(3).join(UNIT),
        files: [],
        renames: [],
      };
      continue;
    }

    if (current === null) continue;

    // `--name-status -z` writes a status field, then the path(s) it applies to,
    // each NUL-separated: `M`, `A`, `D`, `T` take one path; `R100` and `C075`
    // take two, old then new. The similarity score is part of the status field,
    // so match on the first character only.
    const status = field[0] ?? '';
    if (status === 'R' || status === 'C') {
      const from = fields[i + 1] ?? '';
      const to = fields[i + 2] ?? '';
      i += 2;
      if (from !== '' && to !== '') {
        // A copy is not a rename — the original still exists — so only `R`
        // contributes to the lineage that node identity is built on (ADR-0002).
        if (status === 'R') current.renames.push([from, to]);
        current.files.push(to);
      }
      continue;
    }
    if (!/^[A-Z]$/.test(status) || field.length !== 1) continue;
    const path = fields[i + 1] ?? '';
    i += 1;
    if (path !== '') current.files.push(path);
  }

  if (current !== null) commits.push(freeze(current));
  return commits;
}

function freeze(commit: MutableCommit): GitCommit {
  return {
    sha: commit.sha,
    date: commit.date,
    author: commit.author,
    subject: commit.subject,
    files: commit.files,
    renames: commit.renames,
  };
}
