# ADR-0005 — History is capped by policy, and every cap that bites is reported

- **Status**: accepted
- **Date**: 2026-08-06
- **Implements**: CLAUDE.md budgets — "atlas ≤ 5 MB @ 2,000 files"

## Context

Everything else in the atlas is bounded by the size of the repo. History is not. A 2,000-file repo
can have 200,000 commits, and a naive `history.commits` listing each commit with its file list is
tens of megabytes before any of the rest of the atlas exists.

The co-change matrix is worse: it is O(files²) in the limit, and a single "reformat everything"
commit contributes a complete graph over every file it touched — 2,000 files in one commit is
~2 million pairs, all of them true and none of them informative.

CLAUDE.md is explicit that going over a budget must be said out loud: *"When a budget is exceeded,
say so out loud in the CHANGELOG. Silent truncation reads as success."*

## Decision

### Layered defence, cheapest first

1. **Indices, not paths** — see ADR-0004. This is the largest single saving and costs nothing.
2. **Aggregate before you retain.** Per-file `churn`, `authors`, `firstSeen` and `lastSeen` are
   accumulated over *every* commit walked, and cost O(files) regardless of history length. The
   expensive per-commit records are then capped. So the cheap signal is complete even when the
   detailed one is truncated.
3. **Caps** (`DEFAULT_HISTORY_LIMITS`):

   | cap | default | rationale |
   |---|---|---|
   | `maxCommits` | 500 | Retained commit records, newest first. Only commits touching an indexed file count. |
   | `maxCommitFiles` | 64 | Files listed per retained commit. |
   | `wideCommitFiles` | 25 | A commit touching more indexed files than this is excluded from co-change and flagged `wide`. |
   | `maxCoChangePairs` | 8000 | Kept by count descending. |
   | `minCoChangeCount` | 2 | A pair seen once is a coincidence, not coupling. |

4. **Dates as `YYYY-MM-DD`, subjects truncated to 120 characters, shas abbreviated to 12.**

### Nothing is dropped silently

Every cap that actually bit produces an entry in `atlas.report.truncations`:

```jsonc
{ "what": "coChange", "kept": 8000, "dropped": 14213 }
```

The CLI prints these. `what` is an enum, not free text, so the report is data rather than prose —
a future budget script can act on it.

### The wide-commit exclusion is a judgement, and it is stated

Excluding wide commits from co-change is the one cap here that changes *meaning* rather than
volume. A vendoring commit or a mass reformat genuinely does couple every file it touches; the
claim is that this coupling is not the kind the player is being taught to see (pillar 3: teach
coupling, not trivia). The commit is still retained with `wide: true`, so the information is
present and labelled, not discarded.

## Alternatives rejected

**Move history to a side-file loaded on demand.** CLAUDE.md names this as the escalation *above*
5 MB. It is the right next step, and it is not needed yet — this repo's atlas is 22.6 KiB. Doing it
now would add a second file, a second fetch, and a loading state to a player that does not exist.
Revisit when a real repo crosses the ceiling.

**Compress the atlas.** Solves bytes-on-disk, not bytes-in-memory or parse time, and costs the
"open it in an editor and read it" property that makes the format debuggable.

**Sample commits instead of taking the most recent.** Uniform sampling over history gives a better
statistical picture and a worse product: the useful question is "what is churning *now*", and
recency is exactly the right bias for it.

## Consequences

- Per-file churn is exact no matter how long the history is. Only the commit *records* are capped.
- `history.commitsWalked` vs `commitsRetained` makes the gap visible in the atlas itself.
- The caps are `IndexOptions` fields, so a user with an unusual repo can raise them without a code
  change, and the atlas will still say what it dropped.
- Not yet built: a `npm run budget` script that measures atlas size, index time and player paint
  against the CLAUDE.md ceilings and fails over them. `tests/atlas/atlas.test.ts` currently asserts
  the two ceilings the indexer controls (5 MB, 10 s). That is the next thing to do here.
