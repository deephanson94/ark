/**
 * Git history extraction. Plumbing commands over a subprocess — no libgit2, no
 * native module, nothing to install (NORTH-STAR §10).
 *
 * Three landmines are defused here, all of them silent if you miss them:
 *
 *   LC_ALL=C            git localises `--numstat` and `--porcelain` headers, so
 *                       without this the output — and therefore the atlas —
 *                       differs by machine locale.
 *   -M                  without rename detection, `git log --numstat` reports a
 *                       rename as a delete plus an add, so churn is wrong in
 *                       exactly the files that have moved the most.
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
  /** Newest first. */
  readonly commits: readonly GitCommit[];
  /** Total commits reachable from HEAD, even if we only walked `commits`. */
  readonly totalCommits: number;
}

export const NO_HISTORY: GitHistory = {
  present: false,
  head: null,
  headDate: null,
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
        '--numstat',
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

    const parts = field.split('\t');
    if (parts.length !== 3) continue;
    const path = parts[2] ?? '';
    if (path === '') {
      // Rename: `add<TAB>del<TAB>` then the old and new paths as separate fields.
      const from = fields[i + 1] ?? '';
      const to = fields[i + 2] ?? '';
      i += 2;
      if (from !== '' && to !== '') {
        current.renames.push([from, to]);
        current.files.push(to);
      }
      continue;
    }
    current.files.push(path);
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
