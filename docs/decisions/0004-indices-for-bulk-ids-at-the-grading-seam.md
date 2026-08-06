# ADR-0004 — Node indices in bulk arrays, stable ids at the grading seam

- **Status**: accepted
- **Date**: 2026-08-06
- **Extends**: NORTH-STAR §7.1, §8.1

## Context

The north star's sketch references nodes by path everywhere:

```jsonc
"edges": [{ "from": "src/main.ts", "to": "src/engine/engine.ts", … }],
"history": { "coChange": [["src/a.ts", "src/b.ts", 31]] }
```

At the stated budget — 5 MB at 2,000 files — that is expensive. A 2,000-file repo has roughly
10,000 import edges and can have thousands of co-change pairs and hundreds of retained commits,
each listing the files it touched. At ~30 bytes per repeated path, cross-references alone are a
multi-megabyte cost, and they are the *only* part of the atlas that scales as the product of two
large numbers.

Meanwhile NORTH-STAR §8.1 fixes the grading contract as taking string ids:

```ts
type Grade = { correct: string[]; missed: string[]; spurious: string[]; … };
```

and `grade(challenge, answer)` takes no atlas — so a challenge must be self-describing.

## Decision

Two representations, split on a line that is about purpose rather than convenience:

| where | reference type | why |
|---|---|---|
| `edges[].from`, `edges[].to`, `history.coChange`, `history.commits[].files` | `NodeRef` — an integer index into `nodes` | Thousands to millions of entries. Size dominates, and bounds-checking an index is a stronger integrity check than looking up a string. |
| `challenges[].subject`, `.candidates`, `.truth` | `NodeId` — the stable `n:…` string | Dozens of entries. `grade()` must be self-contained per §8.1, and `Grade`'s three id arrays have to mean something to a player without a lookup table. |

`nodes` is sorted by `id`, so a node's index is a deterministic function of the atlas, not of
insertion order.

## Alternatives rejected

**Paths everywhere (the sketch).** Most readable, and blows the budget on exactly the repos where
the budget matters. It also makes every rename a rewrite of half the file.

**Indices everywhere, including challenges.** Consistent, and it breaks the grading contract:
`grade()` would need the atlas to turn an index into anything a human could read, which turns a
pure two-argument function into a three-argument one and puts atlas plumbing into every future
verb. The saving is a few tens of KB.

**Ids everywhere, including edges.** Consistent in the other direction. A 12-hex-char id is shorter
than a path but still ~15 bytes against 2 for an index, and it gives up the free bounds check.

## Consequences

- Cross-references cost 1–4 bytes instead of 20–60. On this repo the atlas is 22.6 KiB at 40 files;
  the design headroom this buys is what keeps a 2,000-file repo inside 5 MB.
- A dangling edge is a range check, not a set lookup — so the validator catches it unconditionally
  and cheaply.
- Reading raw `atlas.json` is less pleasant: `"from": 12` needs `nodes[12]` to interpret. Accepted;
  the atlas is machine data, and the serialiser prints one record per line so the file is at least
  diffable.
- **Any change to node ordering invalidates every index in the file.** Nothing may reorder `nodes`
  without rebuilding `edges`, `coChange` and `commits[].files` in the same pass. The validator does
  not catch a *consistent* reindexing error, only an out-of-range one — this is the sharp edge of
  the decision and the reason `buildAtlas` computes the ordering once, up front, before anything
  that references it.
