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
}

export const NO_HISTORY: GitHistory = {
  present: false,
  head: null,
  headDate: null,
  root: null,
  commits: [],
  totalCommits: 0,
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

    const countText = await tryGit(root, ['rev-list', '--count', 'HEAD'], env);
    if (countText === null) return NO_HISTORY;
    const totalCommits = Number.parseInt(countText.trim(), 10);
    if (!Number.isFinite(totalCommits) || totalCommits === 0) return NO_HISTORY;

    const log = await tryGit(
      root,
      [
        'log',
        '-z',
        '-M',
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
