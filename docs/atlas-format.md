# The atlas format

**Schema version: 3**

`atlas.json` is the only interface between the indexer and the player. The indexer touches your
source; the player never does. Everything the player knows about a codebase, it knows from this
file.

- **Types**: [`src/atlas/schema.ts`](../src/atlas/schema.ts) — the single source of truth. This
  document explains it; it does not redefine it.
- **Validation**: [`src/atlas/validate.ts`](../src/atlas/validate.ts) — every rule below is
  enforced at load, and a violation throws with the exact field path.
- **Canonical bytes**: [`src/atlas/serialize.ts`](../src/atlas/serialize.ts).

---

## 1. Invariants

These hold for every valid atlas. The validator checks all of them; nothing downstream is allowed
to assume anything weaker.

1. **Deterministic.** The same repo state produces byte-identical output, on any machine, forever.
   No wall-clock time appears anywhere in the file ([ADR-0001](decisions/0001-no-wall-clock-time-in-the-atlas.md)).
2. **Totally ordered.** Every array has a defined order, stated in §3. Insertion order is not an
   order. Sorting is by UTF-16 code unit, never `localeCompare`.
3. **No dangling references.** Every node index is in range; every region, subject and candidate
   id names a node that exists.
4. **Every edge points at something real.** An import we could not resolve produces *no* edge
   ([ADR-0003](decisions/0003-unresolved-imports-produce-no-edge.md)).
5. **Every answer key is answerable.** `truth` is non-empty and a *proper* subset of `candidates`;
   the subject is never one of its own candidates.
6. **Fail fast.** An atlas that violates any of the above throws at load. It never degrades.

---

## 2. Shape

```jsonc
{
  "version": 3,
  "repo":       { … },   // §3.1
  "nodes":      [ … ],   // §3.2  — index into this array is a NodeRef
  "edges":      [ … ],   // §3.3
  "regions":    [ … ],   // §3.4
  "history":    { … },   // §3.5
  "challenges": [ … ],   // §3.6
  "report":     { … }    // §3.7
}
```

### How things reference each other

Two representations, split by purpose ([ADR-0004](decisions/0004-indices-for-bulk-ids-at-the-grading-seam.md)):

| reference | type | used by |
|---|---|---|
| `NodeRef` | integer index into `nodes` | `edges`, `history.coChange`, `history.commits[].files` |
| `NodeId` | `"n:"` + 12 hex chars | `challenges.subject`, `.candidates`, `.truth` |

Bulk arrays use indices because size dominates there. The challenge fields use ids because
`grade(challenge, answer)` must be self-contained (NORTH-STAR §8.1) and a `Grade`'s id arrays have
to mean something without a lookup table.

---

## 3. Sections

### 3.1 `repo`

| field | type | notes |
|---|---|---|
| `name` | `string` | `package.json` name, falling back to the directory name. |
| `head` | `string \| null` | Full 40-char sha. `null` when the repo has no commits, or is not a repo. |
| `headDate` | `"YYYY-MM-DD" \| null` | HEAD's commit date. Null exactly when `head` is null. |
| `root` | `string \| null` | Full 40-char sha of the repo's **first** commit. See below. |
| `languages` | `Lang[]` | Sorted, unique. Every node's `lang` appears here. |
| `fileCount` | `number` | Equals `nodes.length`. Redundant on purpose — it is a cheap integrity check. |
| `tool` | `string` | The indexer build, e.g. `ark@0.1.0`. |

There is no `indexedAt`. See [ADR-0001](decisions/0001-no-wall-clock-time-in-the-atlas.md).

**The indexer reads the working tree, not `HEAD`.** `repo.head` names the commit the working tree
is based on and nothing stronger — an atlas can describe a dirty checkout, and usually will.

#### `root` is identity; `head` is staleness

They answer different questions and must not be collapsed into one. `head` tells you *whether this
atlas is current*: it is stale exactly when it is not the repo's HEAD. `root` tells you *which repo
this is*, and the player keys saved progress on it — a HEAD-keyed save would be wiped by every
reindex, which is the opposite of what [ADR-0002](decisions/0002-node-identity-survives-renames.md)
and NORTH-STAR §7 exist to protect.

It is the first commit on HEAD's **first-parent chain**, not simply a parentless commit. A subtree
merge or an imported history adds a second root, so "any commit with no parents" is not a stable
answer; the first-parent walk is linear and has exactly one.

`root` is `null` in two cases, and `null` is not an error — the player falls back to a weaker,
name-derived key:

- the repo has no commits, or is not a repo (`head` is null too);
- the clone is **shallow**, where the oldest reachable commit is a graft boundary that looks
  parentless but moves on every `fetch --deepen`. Here `head` is set and `root` is not, so the two
  are *not* null together.

Full reasoning: [ADR-0011](decisions/0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md).

### 3.2 `nodes`

**Order: by `id`, ascending, unique.** A node's position in this array is its `NodeRef`.

| field | type | notes |
|---|---|---|
| `id` | `NodeId` | `"n:"` + 12 hex. A hash of `originPath`. The validator recomputes it. |
| `path` | `string` | Current repo-relative POSIX path. Display and lookup — **not** identity. |
| `originPath` | `string` | Earliest path git knows the file by. Equals `path` with no history. |
| `kind` | `"file"` | `"dir"` and `"symbol"` are reserved for semantic zoom. |
| `lang` | `Lang` | `ts \| tsx \| js \| jsx \| mjs \| cjs \| json \| md \| other`. |
| `loc` | `number` | Physical lines. |
| `bytes` | `number` | File size. |
| `layout` | `[number, number]` | Precomputed, deterministic, 2dp. |
| `region` | `string` | A `regions[].id`. |
| `exports` | `string[]` | Sorted. `"default"` for a default export, `"*"` for `export * from`. |
| `unresolved` | `string[]` | Sorted. Import specifiers we could **not** pin down. Drives guardrail 4. |
| `externals` | `string[]` | Sorted. Specifiers resolved to a declared dependency, builtin or URL. |
| `churn` | `number` | Commits touching this file, following renames. `0` without history. |
| `authors` | `number` | Distinct commit authors. |
| `firstSeen`, `lastSeen` | `"YYYY-MM-DD" \| null` | Null without history. |

#### Identity across renames

`id` hashes `originPath`, not `path`, so `git mv` does not reset the player's fog of war or
invalidate their field notes. The rename chain is read from one `git log -M` pass; when two live
files chase the same historical path, the first claimant in log order keeps it. Full reasoning and
alternatives: [ADR-0002](decisions/0002-node-identity-survives-renames.md).

#### What becomes a node

Indexed and scanned for imports: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`.
Indexed but not scanned: `.json .jsonc .md` — they are part of the terrain and carry real history.
Everything else is skipped and counted in `report.skipped`.

Also skipped: anything matching `.gitignore` (root and nested), the built-in excludes
(`node_modules/ dist/ build/ coverage/ .next/ vendor/`), `.git`, **all symlinks** (a loop would hang
the walk), files over 512 KiB, and anything containing a NUL byte.

### 3.3 `edges`

**Order: by `(from, to, kind)`, ascending. Unique on that triple. No self-edges.**

| field | type | notes |
|---|---|---|
| `from`, `to` | `NodeRef` | `from` imports `to`. |
| `kind` | `EdgeKind` | `import`, `reexport`, `dynamic`, `type`, `require`. |
| `confidence` | `"certain" \| "probable"` | See below. |
| `weight` | `number` | Distinct specifiers in `from` producing this edge. ≥ 1. |

Resolution reads the `package.json` and `tsconfig.json` **nearest the importing file**, then
upward — which is what Node and TypeScript do, and what a monorepo requires. Dependencies union up
the tree; `#` subpath imports come from the nearest package boundary only; `paths` and `baseUrl`
come from the nearest tsconfig, following relative `extends`. A package name declared by any
`package.json` inside the repo is **never** `external`, whatever a manifest says about it — calling
a workspace sibling external asserts that nothing outside the repo can import back in, about an
import that does exactly that.

`type` edges — `import type { X } from 'y'` — are real couplings. They vanish at runtime and they
absolutely break when `y` changes its signature, which is exactly the question Blast Radius asks.

#### Edge confidence

- **`certain`** — the specifier resolved to exactly one file.
- **`probable`** — more than one target was viable and we took the first in a fixed priority order.
  The live case is `./x.js` when both `x.js` and `x.ts` exist.

There is no `uncertain`. An import we could not resolve produces **no edge**, and lands on the
importing node's `unresolved` list instead.

A challenge may only be built where the answer key does not depend on a guess. `isChallengeable()`
in [`src/atlas/graph.ts`](../src/atlas/graph.ts) refuses when any candidate — or anything on its
outgoing side, to the depth the caller states — has an unresolved import, or is reached over a
`probable` edge. Blast Radius states `Infinity`, because a bounded check would certify a distractor
that reaches the subject one hop past the bound. `taintedRefs()` is the same verdict computed once
for the whole graph.
The asymmetry that makes this the right rule (unknown edges can only *add* reachability, so the
truth set is sound and only the distractors are at risk) is set out in
[ADR-0003](decisions/0003-unresolved-imports-produce-no-edge.md).

### 3.4 `regions`

**Order: by `id`, ascending, unique.**

| field | type | notes |
|---|---|---|
| `id` | `string` | Slug of the members' shared directory, `-2` suffixed on collision. |
| `label` | `string` | The shared directory itself, or `"root"`. |
| `nodeCount` | `number` | Must equal the number of nodes claiming this region. |
| `centroid` | `[number, number]` | Mean member position, 2dp. |
| `kind` | `"topology" \| "terrain"` | Whether the graph produced this cluster, or the graph had nothing to say. |

Regions are derived from the import graph by label propagation, **not** from the directory tree
(pillar 4). [ADR-0006](decisions/0006-layout-and-regions-are-computed-in-the-indexer.md).

#### `topology` versus `terrain`

A **topology** region is a cluster the import graph produced, and it always has at least three
members. A **terrain** region is the honest fallback: files with no edges at all, plus connected
components below that floor, aggregated by **top-level path segment** — one `docs`, one `playground`,
not one per directory.

The distinction is load-bearing rather than cosmetic. On `vitejs/vite`, 56% of files have no edge in
either direction, and grouping those by exact directory produced **771 regions** whose labels covered
the map in overlapping text. Terrain says the true thing (`841 files under playground/ import
nothing`) instead of five hundred precise useless ones, and the player draws all terrain in one
desaturated wash so colour stays reserved for claims the graph actually supports.

There is deliberately **no cap** on region count. The bound is a consequence rather than a tuning:
`regions ≤ nodes / 3 + topLevelDirectories`, asserted in `test:atlas`.
[ADR-0010](decisions/0010-terrain-islands-and-the-ctrl-f-gate.md).

### 3.5 `history`

| field | type | notes |
|---|---|---|
| `present` | `boolean` | False for a repo with no commits, or no git. True exactly when `repo.head` is set. |
| `commitsWalked` | `number` | Commits read from git. |
| `commitsRetained` | `number` | Equals `commits.length`. |
| `window` | `{from, to} \| null` | Oldest and newest commit dates seen. |
| `coChange` | `[NodeRef, NodeRef, number][]` | `a < b`. **Order: count desc, then a asc, then b asc.** |
| `commits` | `CommitRecord[]` | **Order: newest first.** |

`CommitRecord`: `sha` (12 hex), `date`, `subject` (≤ 120 chars), `files` (`NodeRef[]`, ascending,
unique), `wide` (the commit touched more files than the co-change cap), `issue` (first `#NNNN` in
the subject, or null).

#### Staying inside the budget

History is the only part of the atlas that grows without bound. Four things keep it inside
5 MB @ 2,000 files:

1. **Indices, not paths** — the largest single saving (ADR-0004).
2. **Aggregate before you retain.** Per-file `churn`/`authors`/`firstSeen`/`lastSeen` accumulate
   over every commit walked and cost O(files). Only the detailed commit *records* are capped, so
   the cheap signal stays complete however long the history is.
3. **Caps**: 500 retained commits, 64 files listed per commit, 8,000 co-change pairs, pairs seen
   at least twice, commits touching more than 25 indexed files excluded from co-change (a mass
   reformat couples everything to everything — true, and useless).
4. **Compact fields**: `YYYY-MM-DD` dates, 12-char shas, truncated subjects.

Every cap that actually bit appears in `report.truncations`. Nothing is dropped silently.
[ADR-0005](decisions/0005-history-budget-by-capping-and-reporting.md).

**A repo with no history is normal, not an error.** `present: false`, empty arrays, null dates
throughout, and tiers 1–4 remain fully playable (NORTH-STAR risk #7).

### 3.6 `challenges`

**Order: by `id`, ascending, unique.**

| field | type | notes |
|---|---|---|
| `id` | `string` | Stable within an atlas. |
| `verb` | `VerbId` | `blastRadius` today. |
| `tier` | `1..6` | Curriculum tier, NORTH-STAR §5. |
| `difficulty` | `number` | `0..1`. **Computed, never authored** (NORTH-STAR §8.4). Generators normalise. |
| `subject` | `NodeId` | The file the question is about. Never appears in `candidates`. |
| `candidates` | `NodeId[]` | Sorted. The choice set. Non-empty. |
| `truth` | `NodeId[]` | Sorted. Non-empty. A **proper** subset of `candidates`. |
| `evidence` | `Evidence` | `{kind: "importGraph", depth}` or `{kind: "coChange", minCount}`. |

`truth` sits here in plaintext, deliberately. This is a learning tool, not an exam; anyone who opens
devtools to read the answer has opted out of the product. Do not obfuscate it.

**`id` is stable within an atlas and nowhere else.** It is a convenience for ordering and lookup, not
an identity that survives a reindex — the generator may renumber freely when the deck changes. So
nothing outside the atlas may key on it: the player's save records a pass by `(verb, subject)`,
because `subject` is a `NodeId` and *that* is stable by construction
([ADR-0011](decisions/0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)).

A challenge should also not be passable by selecting everything. That requires
`|candidates| > 3·|truth|`, which follows from the 0.5 pass threshold —
[ADR-0007](decisions/0007-pass-threshold-and-the-three-to-one-choice-set.md). It is checked by
`isGameable()` at generation time rather than by the validator, because it is game-design policy
rather than data integrity.

#### `evidence.depth` is measured, not prescribed

For `kind: "importGraph"` it is the **furthest hop the answer key actually reaches**, computed from
the subject's dependent tree. It is not a bound the generator applied: Blast Radius has no depth
bound at all. The validator only requires an integer ≥ 1, so nothing about the shape changed when
the bound went away.

#### The generator's invariant

`blastRadius` maintains, for every challenge it emits:

```
candidates ∩ dependents(subject, ∞) = truth
```

Every candidate that depends on the subject at any depth is in `truth`, and any dependent that is
not in `truth` never appears in `candidates`. That is what makes a *sampled* answer key honest on a
hub — the files left out are not on the board, and the prompt says "which of these", never "which
files". The reasoning, and why the prompt promises dependence rather than required change:
[ADR-0008](decisions/0008-truth-is-unbounded-and-the-prompt-promises-dependence.md).

Choice sets contain only nodes whose `lang` is in `IMPORTING_LANGS`. A `.md` or `.json` file cannot
import anything, so offering one as a wrong answer makes the question easier rather than harder —
padding is not a distractor (NORTH-STAR §8.3).

A challenge is also refused when a **structure-blind heuristic** would earn band A on it: "select
every candidate in the subject's directory", or "select every candidate sharing a name token". That
is pillar 3's *"answerable by Ctrl+F"* made computable, scored with the same `scoreSet` the player is
graded by. [ADR-0010](decisions/0010-terrain-islands-and-the-ctrl-f-gate.md).

> **Status at M2**: `blastRadius` generates. On this repo that is one challenge per subject with a
> non-empty radius. The CLI prints how many it declined and why, and how much of each choice set
> came from a principled distractor strategy rather than from `distant` padding.

### 3.7 `report`

What the indexer dropped, and why. `truncations` is `{what, kept, dropped}` sorted by `what`;
`skipped` is `{reason, count}` sorted by `reason`. Both are enums, not prose, so a future budget
script can act on them.

---

## 4. Compatibility

`version` is `2`. **A change to any shape above bumps it**, and ships either a migration or an
explicit "reindex required" error (guardrail 5). The validator already produces the latter: loading
a v2 atlas into a v1 build fails with

```
atlas.version: this build reads atlas v1, got v2 — reindex required
```

The player must never guess at a shape.

Changes that do **not** need a bump: adding an enum member the player already ignores safely
(it doesn't — the validator rejects unknown members, which is the point), or changing a *default*
in `IndexOptions`. Changing a default does change the bytes, and therefore the atlas, but not the
contract.

---

## 5. Serialisation

`serializeAtlas()` produces the canonical bytes:

- **Object keys sorted alphabetically.** JS preserves insertion order, so without this a harmless
  refactor of the builder would change every byte of the file and `test:determinism` would start
  reporting drift that isn't there.
- Arrays longer than 8 print one element per line, so `git diff` on an atlas is readable.
- Numbers via `JSON.stringify`, whose shortest-round-trip representation ECMAScript specifies
  exactly. Non-finite numbers throw rather than silently becoming `null`.
- One trailing newline.

---

## 6. Reading an atlas

```ts
import { parseAtlas, buildGraph, dependents } from './src/atlas/index.js';

const atlas = parseAtlas(await readFile('atlas.json', 'utf8')); // throws on any violation in §1
const graph = buildGraph(atlas);

const subject = graph.refByPath.get('src/atlas/schema.ts')!;
const radius = dependents(graph, subject, 3);  // NodeRef → distance
```

Nothing in `src/atlas/` touches the filesystem, the network or a subprocess. It is pure data and
pure functions over that data, on both sides of the wall.
