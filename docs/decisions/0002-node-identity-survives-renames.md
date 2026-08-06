# ADR-0002 — A node's identity is its rename origin, not its current path

- **Status**: accepted
- **Date**: 2026-08-06
- **Extends**: NORTH-STAR §7.1 (`nodes[].id`)

## Context

The north star's sketch uses the file path as the node id: `"id": "src/engine/engine.ts"`.

That works until someone runs `git mv`. Then, on the next index:

- every localStorage key keyed on the old path orphans, so **fog of war resets** for that file;
- **field notes** ("you know that `engine.ts` has 14 dependents") point at nothing;
- a saved challenge's `truth` set silently stops matching any node.

Renames are not an edge case in the situation this product is for. A codebase you are learning is
usually a codebase someone else is actively reorganising, and the files that move are
disproportionately the ones worth learning — the ones being split, merged, or promoted out of a
grab-bag directory.

The information needed to fix this is already in hand: `git log -M` reports renames, and CLAUDE.md
already requires the `-M` flag for churn to be correct.

## Decision

Every node carries three fields instead of one:

| field | meaning |
|---|---|
| `path` | where the file is now. Display, lookup, and human reference. |
| `originPath` | the earliest path git knows the file by, found by following rename records backwards. Equals `path` when there is no history or no rename. |
| `id` | `n:` + 12 hex chars, a hash of `originPath`. **This is identity.** |

Progression state, field notes, and challenge references all key on `id`.

The hash is a hand-rolled FNV-1a in 32-bit arithmetic (`src/atlas/identity.ts`) rather than
`node:crypto`, because the atlas module is imported by the player, and the player must stay a pure
function of the atlas with no Node built-ins. The validator recomputes it and rejects any node
whose `id` does not match its `originPath`, so the two cannot drift.

### Resolving collisions

Two live files can chase the same historical path: `a.ts` is renamed to `b.ts`, then a new `a.ts`
appears. The rule is **first claimant in log order wins**, and the loser keeps its own current path
as its origin. The choice between them is arbitrary; that it is the *same* arbitrary choice on
every machine is not. The indexer additionally throws if two nodes still end up with the same
origin, rather than emitting an atlas with a duplicate identity.

## Alternatives rejected

**Path as id (the sketch).** Simple, and loses the player's progress every time someone tidies a
directory. The failure is silent — nothing errors, the fog just comes back.

**Content hash.** Stable across renames *and* across everything else, including edits. A file
would change identity every time it was touched, which is worse than the problem.

**`git log --follow` per file.** More accurate rename tracking, but it is one subprocess per file:
on a 2,000-file repo that is 2,000 git invocations against a 10-second index budget. The
whole-log `-M` pass costs one.

**A persistent id file checked into the repo.** Requires writing to the user's repo, which the
indexer has no business doing, and does not work on a repo you just cloned.

## Consequences

- `git mv` preserves fog of war, field notes, and challenge references.
- `originPath` is visible in the atlas, so "this file used to live somewhere else" is itself a fact
  the History tier (NORTH-STAR §5) can build a challenge on later.
- Rename detection is a heuristic, and a different git version could in principle pair files up
  differently. This is accepted: it is deterministic for a given git and repo, which is what
  `test:determinism` checks and what a single developer experiences.
- A repo with no git history gets `originPath === path` throughout, and everything above degrades
  to the sketch's behaviour with no special casing.
