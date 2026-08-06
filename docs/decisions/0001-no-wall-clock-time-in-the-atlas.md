# ADR-0001 — No wall-clock time in the atlas

- **Status**: accepted
- **Date**: 2026-08-06
- **Extends**: NORTH-STAR §7.1 (atlas format sketch)
- **Contradicts**: NORTH-STAR §7.1's `repo.indexedAt` field

## Context

The north star's atlas sketch includes `"repo": { …, "indexedAt": "…" }`.

CLAUDE.md's testing strategy requires `test:determinism` to index the repo twice and assert
**byte-identical** output, and explicitly forbids fixing a failure by loosening the test.

These two cannot both hold. A timestamp changes on every run by definition.

The determinism requirement is not incidental. NORTH-STAR §7 makes layout an indexer
responsibility specifically so that "same repo ⇒ same map, every session, on every machine",
because spatial memory of a codebase is the mechanic the whole product rests on. An atlas that
differs byte-for-byte between two runs cannot be cached, diffed, checked into a repo, or compared
against a colleague's.

## Decision

**The atlas contains no wall-clock time.** `indexedAt` is removed. In its place, `repo.headDate`
carries HEAD's commit date — which is a property of the repo, not of the moment we looked at it.

The freshness question `indexedAt` was there to answer is answered better by `repo.head`: an atlas
is stale exactly when its `head` is not the repo's current HEAD, which is a check the player can
make and a human cannot fake.

Anything that needs a real timestamp (a cache entry, a "last indexed" line in a UI) records it
outside the atlas, in the same place the atlas file's mtime already lives.

## Alternatives rejected

**Keep `indexedAt` and have the determinism test ignore it.** This is the tempting one. It fails
for a specific reason: the test's value is that it is a *bytes* comparison. The moment it starts
normalising fields before comparing, every future nondeterminism has an obvious escape hatch —
add it to the ignore list. The canary stops being a canary. CLAUDE.md anticipated this and says
so directly.

**Round `indexedAt` to the day.** Still nondeterministic, just less often, which is worse: the
test would pass all day and fail at midnight, and whoever hit it would spend an hour before
noticing the pattern.

**Make the timestamp an argument.** Passing `--indexed-at` keeps the field deterministic per
invocation but makes it a lie by default, and adds a flag to a tool whose whole pitch is that it
needs no configuration (pillar 6).

## Consequences

- `test:determinism` is satisfiable, and stays a bytes comparison.
- Two atlases of the same commit are identical, so they can be diffed to see what a change did to
  the shape of the codebase. That is a capability the timestamp would have cost us.
- `repo.headDate` is `null` for a repo with no commits, alongside `repo.head`.
- The indexer reads the **working tree**, not HEAD, so an atlas can describe a state that is not
  any commit. `repo.head` names the commit the working tree is based on and nothing stronger.
  This is deliberate: the developer's first day is spent on a dirty checkout as often as a clean
  one, and refusing to index uncommitted work would be the wrong kind of purity.
