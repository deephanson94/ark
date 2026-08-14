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
import type { GradedBoard, Pass, Progress } from './progress.js';
import { EMPTY_PROGRESS, SAVE_VERSION, answerKey } from './progress.js';

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
  const proved = asMemberIds(record['proved']);
  const known = new Set(proved);
  return {
    verb: verb as VerbId,
    subject,
    proved,
    // **Absent means empty, never means "same as proved".** A v1 record has no
    // `shown` and every member in it was minted under the old rule, so it is
    // read as proved — see `parseProgress` for why that is the charitable
    // migration and what it costs.
    shown: asMemberIds(record['shown']).filter((id) => !known.has(id)),
  };
}

/**
 * Graded certificates. Sorted by key, unique, junk dropped.
 *
 * **A bare string is accepted and read as a certificate with no members**, which
 * is the shape this field had for exactly one unmerged commit. Such an entry
 * cannot decay (`gradedKeys` treats an empty member list as "nothing to check"),
 * so it stands until the board is graded again — the conservative direction: it
 * can leave a board unprovable that ought to be provable, and cannot mint proof
 * that was not earned.
 */
function asGraded(value: unknown): GradedBoard[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, GradedBoard>();
  for (const item of value) {
    if (typeof item === 'string') {
      if (!byKey.has(item)) byKey.set(item, { key: item, members: [] });
      continue;
    }
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const key = record['key'];
    if (typeof key !== 'string' || key === '') continue;
    byKey.set(key, { key, members: asMemberIds(record['members']).sort(byteCompare) });
  }
  return [...byKey.values()].sort((a, b) => byteCompare(a.key, b.key));
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
  const version = record['version'];
  if (version !== SAVE_VERSION && version !== 1) return EMPTY_PROGRESS;
  const passes = (Array.isArray(record['passes']) ? record['passes'] : [])
    .map(asPass)
    .filter((pass): pass is Pass => pass !== null);
  // **The v1 → v2 migration, and it is charitable on purpose.** A v1 record
  // predates ADR-0047's first-submission rule, so nothing in it can say which of
  // its passes were earned on a first answer. Discarding them would delete a
  // real notebook to enforce a rule retroactively, which punishes the player for
  // a change they had no part in; re-labelling them all as *shown* would do the
  // same thing more quietly. They are kept as proved, and `graded` is seeded
  // with their keys so the rule engages from here on — a board already passed
  // cannot be farmed for a note it has already minted.
  //
  // **The cost it does not cover, found by review and stated rather than
  // patched**: under ADR-0035's gate a *failed* precision-1.0 answer served the
  // whole annotated key and left **no `Pass`**, so a v1 record cannot show it
  // and this seeding cannot see it. A player holding such a save can, once,
  // type back the key they were handed and mint proof — ADR-0047 §2.1's exploit
  // completed through the version bump. It is unknowable from the stored shape:
  // v1 recorded passes and never attempts, which is the whole reason `graded`
  // exists. One board, one player, one time, and the alternative is discarding
  // every v1 notebook to close it.
  const graded: GradedBoard[] =
    version === SAVE_VERSION
      ? asGraded(record['graded'])
      : passes.map((pass) => ({
          key: answerKey(pass.verb, pass.subject),
          // A v1 record has no certificates at all, so the members it can offer
          // are the ones the pass proved. Narrower than the board's real key —
          // a pass holds a sample — which errs towards the certificate decaying
          // sooner, i.e. towards letting a board be proved again. That is the
          // safe direction: the alternative mints proof nobody earned.
          members: [...pass.proved, ...pass.shown].sort(byteCompare),
        }));
  return {
    version: SAVE_VERSION,
    surveyed: asNodeIds(record['surveyed']),
    passes,
    // **`graded` always covers every pass**, by construction rather than by
    // trusting the file. A save is untrusted input, and a record whose `graded`
    // omitted a key its `passes` carries would let that board be proved a
    // second time — reachable only by hand-editing today, which NORTH-STAR §7.1
    // opts out of, but the invariant is one line and the alternative is a
    // comment claiming nobody will.
    graded: (() => {
      const byKey = new Map(graded.map((entry) => [entry.key, entry] as const));
      for (const pass of passes) {
        const key = answerKey(pass.verb, pass.subject);
        if (!byKey.has(key)) {
          byKey.set(key, { key, members: [...pass.proved, ...pass.shown].sort(byteCompare) });
        }
      }
      return [...byKey.values()].sort((a, b) => byteCompare(a.key, b.key));
    })(),
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
