/**
 * Persistence. The player's only edge onto the outside world besides `fetch`.
 *
 * Everything above this file is pure (`progress.ts` owns what a record *means*);
 * this file owns bytes and `localStorage`, and it is deliberately paranoid,
 * because a save is untrusted input in exactly the way an atlas is not. An
 * atlas that violates its schema throws, loudly, because a wrong atlas would
 * produce a wrong answer key. A corrupt save must do the opposite: **the game
 * still starts**. Losing progress is bad; refusing to load is worse, and
 * bricking the player on a string a user could paste into devtools would be a
 * self-inflicted denial of service.
 *
 * ADR-0011 decides the key. The short version: `head` is *staleness* and `root`
 * is *identity*, and a save keyed on HEAD is wiped by every reindex — which is
 * the exact opposite of what ADR-0002 and §7 exist to protect.
 */

import type { AtlasId, NodeId, RepoMeta, VerbId } from '../atlas/index.js';
import { VERB_IDS, byteCompare, isCommitId, isNodeId } from '../atlas/index.js';
import type { Pass, Progress } from './progress.js';
import { EMPTY_PROGRESS, SAVE_VERSION } from './progress.js';

/** The subset of `Storage` this needs. Lets a test pass a plain object. */
export interface SaveStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where this repo's progress lives.
 *
 * `ark:<root>` — the sha of the repo's first commit. Identity, not state.
 *
 * `ark:name:<name>` when `root` is null: a repo with no history at all
 * (NORTH-STAR risk #7), or a shallow clone, whose oldest reachable commit is a
 * graft boundary that moves on every fetch.
 *
 * The fallback is **weaker on purpose and documented as such**. `NodeId` is a
 * hash of `originPath` (ADR-0002) and is therefore repo-*independent*: two
 * unrelated repos that both contain `src/index.ts` produce the same node id. So
 * two repos sharing a key would share each other's *passes* — and a Blast
 * Radius pass unlocks that node's full transitive radius on hover, silently
 * reopening the leak ADR-0008 decision 1 closes. (Since M4 the unlock is keyed
 * on a pass in that verb specifically rather than on the verb-blind
 * `understood` set, which narrows what a shared key leaks without closing it:
 * a shared Blast Radius pass still leaks.) Two repos with the same
 * `package.json` name *and* no usable history is a much smaller class than two
 * repos with the same file layout, which is why the fallback is on the name.
 *
 * The two forms cannot collide: a 40-hex sha never begins `name:`.
 */
export function storageKeyFor(repo: Pick<RepoMeta, 'root' | 'name'>): string {
  return repo.root === null ? `ark:name:${repo.name}` : `ark:${repo.root}`;
}

/**
 * `surveyed` — **node ids only, and this one really is node-only.**
 *
 * `surveyed` is a set of squares on the map: it records what the player was
 * shown, and a commit has no square. `progress.ts` filters non-nodes out on the
 * way in for the same reason, so a `c:` id here could only have come from a
 * hand-edited save.
 */
function asNodeIds(value: unknown): NodeId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NodeId => typeof item === 'string' && isNodeId(item));
}

/**
 * `proved` — a place **or** an event, and this function is why the widening
 * mattered.
 *
 * This was `asNodeIds`, and the comment beside its caller stated the rule in
 * words: *"`proved` stays node-only, because a member is always a file whatever
 * the subject is."* ADR-0019 makes that false — Archaeology proves **commits** —
 * and the failure mode is the silent one this file already has two records of:
 * a member this filter drops is gone at parse and **erased by the next write**,
 * so an Archaeology pass would survive its own session and die on the second,
 * with nothing anywhere to say so. Third instance of that exact class in this
 * one file, after `VERB_IDS` and `asPass`.
 *
 * The filter is not removed, only widened: an id matching neither shape is still
 * junk, and a save is untrusted input.
 */
function asMemberIds(value: unknown): AtlasId[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AtlasId => typeof item === 'string' && (isNodeId(item) || isCommitId(item)),
  );
}

function asPass(value: unknown): Pass | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const verb = record['verb'];
  const subject = record['subject'];
  // `VERB_IDS` comes from the schema, which is the only list. This used to be a
  // second copy kept by hand here, and this is the dangerous place to keep one:
  // a pass naming a verb missing from the list is dropped at parse and erased by
  // the next write, so a stale copy destroys progress rather than failing loudly.
  if (typeof verb !== 'string' || !(VERB_IDS as readonly string[]).includes(verb)) return null;
  // **A subject is a node id *or* a commit id** (ADR-0018). This read
  // `!isNodeId(subject)` until Placement landed, which is the identical
  // failure the paragraph above describes for `VERB_IDS`, one field down: a
  // pass this rejects is dropped at parse and erased by the next write, so
  // every Placement pass would have been silently destroyed on the second
  // session rather than failing anywhere a test could see it.
  //
  // **And so is a member** (ADR-0019) — see `asMemberIds`, where the same
  // sentence was written down as a rule and was false one verb later.
  if (typeof subject !== 'string' || !(isNodeId(subject) || isCommitId(subject))) return null;
  return { verb: verb as VerbId, subject, proved: asMemberIds(record['proved']) };
}

/**
 * Read a stored record. Never throws; anything it cannot make sense of becomes
 * an empty record.
 *
 * A record from a *newer* `SAVE_VERSION` is discarded rather than guessed at —
 * the same rule guardrail 5 applies to the atlas. There is no installed base
 * and no downgrade path, so this costs nothing today and stops a future shape
 * from being half-read.
 */
export function parseProgress(text: string | null): Progress {
  if (text === null || text === '') return EMPTY_PROGRESS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_PROGRESS;
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== SAVE_VERSION) return EMPTY_PROGRESS;
  const passes = (Array.isArray(record['passes']) ? record['passes'] : [])
    .map(asPass)
    .filter((pass): pass is Pass => pass !== null);
  // `attempted` is additive: a record written before it existed parses to an
  // empty list, so an older save stays valid and every board's next attempt is
  // its first (ADR-0035 §10). Filtered to strings rather than trusted, like
  // everything else here.
  const attempted = (Array.isArray(record['attempted']) ? record['attempted'] : [])
    .filter((key): key is string => typeof key === 'string')
    .sort(byteCompare);
  return {
    version: SAVE_VERSION,
    surveyed: asNodeIds(record['surveyed']),
    passes,
    attempted: [...new Set(attempted)],
  };
}

export function serializeProgress(progress: Progress): string {
  return JSON.stringify(progress);
}

/**
 * `window.localStorage`, or null where it is unavailable.
 *
 * Reading the property itself throws in a browser with storage disabled, and
 * in some sandboxed iframes — so this is a `try` around the *access*, not
 * around a call. A null store means the game runs, and forgets.
 */
export function browserStore(): SaveStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadProgress(store: SaveStore | null, key: string): Progress {
  if (store === null) return EMPTY_PROGRESS;
  try {
    return parseProgress(store.getItem(key));
  } catch {
    return EMPTY_PROGRESS;
  }
}

/**
 * Write, and say whether it landed. Quota exhaustion and private-mode Safari
 * both throw from `setItem`; neither is a reason to stop the game, but the
 * caller may want to say so once.
 */
export function saveProgress(store: SaveStore | null, key: string, progress: Progress): boolean {
  if (store === null) return false;
  try {
    store.setItem(key, serializeProgress(progress));
    return true;
  } catch {
    return false;
  }
}
