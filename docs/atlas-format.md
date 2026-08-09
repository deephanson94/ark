# The atlas format

**Schema version: 9**

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
  "version": 10,
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
| `NodeId` | `"n:"` + 12 hex chars | a challenge's `subject`, `candidates` and `truth` wherever it names a **file** |
| `CommitId` | `"c:"` + the 12-hex `sha` of a retained commit | the same three fields wherever they name a **commit** |

`AtlasId` is the union of the last two, and **the prefix is the discriminator** — there is no
companion kind field. A place or an event, and *"can this be drawn on the map?"* has to be
answerable without knowing which verb asked, because the fog, the save, the deck and the console all
read these ids and only one of the two kinds belongs on a canvas.
[ADR-0018](decisions/0018-a-subject-is-a-place-or-an-event.md) widened `subject`;
[ADR-0019](decisions/0019-archaeology-asks-a-place-what-happened-to-it.md) widened `candidates` and
`truth`, and renamed the union off `SubjectId` — it was named for the one role it had, and a type
named for a role invites exactly the *which role is this?* reasoning that produced ADR-0018's nine
defects.

> **Nothing about that widening is checkable by a type system**, and both ADRs say so for the same
> reason: `NodeId` and `CommitId` are both aliases of `string`. Widening a field produced **zero**
> compiler errors on either occasion while every assumption the old type licensed sat untouched in
> its readers. They are found by grepping each read and asking *what am I assuming this names?*

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
| `nodeCount` | `number` | Equals `nodes.length`. Redundant on purpose — it is a cheap integrity check. It was called `fileCount` until a node stopped being a file; *files* are counted by `nodes[].fileCount`. |
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
| `kind` | `"file" \| "dir"` | One file, or a directory standing for the source files in it. See below. `"symbol"` is still reserved for semantic zoom. |
| `lang` | `Lang` | `ts \| tsx \| js \| jsx \| mjs \| cjs \| go \| json \| md \| other`. |
| `fileCount` | `number` | Files on disk this node stands for. `1` for a `file` node, always. |
| `loc` | `number` | Physical lines, summed over the members. |
| `bytes` | `number` | File size, summed over the members. |
| `layout` | `[number, number]` | Precomputed, deterministic, 2dp. |
| `elevation` | `number` | Layer index — how load-bearing the file is. See below. |
| `region` | `string` | A `regions[].id`. |
| `exports` | `string[]` | Sorted. `"default"` for a default export, `"*"` for `export * from`. |
| `unresolved` | `string[]` | Sorted. Import specifiers we could **not** pin down. Drives guardrail 4. |
| `externals` | `string[]` | Sorted. Specifiers resolved to a declared dependency, builtin or URL. |
| `lineage` | `"certain" \| "contested"` | Whether the rename walk had to guess this file's history. See below. |
| `churn` | `number` | Commits touching this file, following renames. `0` without history. |
| `authors` | `number` | Distinct commit authors. |
| `firstSeen`, `lastSeen` | `"YYYY-MM-DD" \| null` | Null without history. |

#### `lineage` — `Confidence`'s counterpart on the git side

`contested` means two live files both claimed the same historical path, so the rename walk resolved
it arbitrarily — deterministically, but arbitrarily — and some of this node's `churn`, dates and
co-change counts may belong to a different file. `certain` for every node in a repo with no history:
nothing was inferred, so nothing was guessed.

It exists for the same reason `Confidence` does. Blast Radius never needed it — co-change only ranks
its distractors — but a verb **graded** on these counts may not ask about a file whose history is a
coin-flip (guardrail 4). Companion refuses a contested node as subject, as answer and as distractor.

Measured: 0 contested nodes on this repo and on `sveltejs/svelte` (18,240 renames, none contested),
**7 on `honojs/hono`**, where two files were renamed to each other's paths and back so each live
file claims the other's history.

#### `elevation` — the third coordinate

**The bit length of the file's transitive dependent count.** 0 dependents → `0`, 1 → `1`, 2–3 → `2`,
4–7 → `3`, and so on. One layer up means twice as depended-upon, and a layer number means the same
thing in every repo — layer 8 is 128–255 dependents, here and anywhere.

It is **not** a third entry in `layout`, deliberately. `layout` is the force simulation's output: a
seeded, iterative, whole-graph computation whose stability rests on [ADR-0006](decisions/0006-layout-and-regions-are-computed-in-the-indexer.md).
`elevation` is a pure per-node graph query that depends on the node's own cone and nothing else in
the repo — different provenance, different stability. It is an *attribute*, like `loc` and `churn`,
and a renderer decides which visual channel it drives. That is what
[ADR-0009](decisions/0009-third-person-is-a-presentation-layer-over-the-same-atlas.md)'s "additive,
preserving today's X,Y" asks for: adding it changes no existing coordinate.

Quantised rather than continuous because spatial memory for item locations degrades as freedom in a
third dimension grows, and quantised **by bit length** rather than by rank or percentile because a
rank is a function of every *other* node's cone — one new file would restack the landscape, and the
save is keyed to the repo rather than to the commit ([ADR-0011](decisions/0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)).
Every edge kind counts, including `type` and `probable`: this is the shape of the place, not an
answer key, and guardrail 4 governs what may be *asked*, never what may be *drawn*. Reasoning and
measurements: [`docs/prior-art.md`](prior-art.md) §4.3, `src/indexer/elevation.ts`.

The distribution is lumpy, and that is terrain rather than a defect — 56% of this repo, 74% of
`vite` and 90% of `svelte` sit at layer 0 because nothing imports them.

#### `kind` — a node is a file, except in Go, where it is a package

Every language ark reads is file-granular but Go, whose **unit of import is the directory**. A Go
file references its own package's siblings with no import statement at all, so a file-granular Go
atlas is missing every intra-package edge — and `treeSibling`, which offers *same-directory
non-dependents* as wrong answers, then offers those siblings. Measured at up to 71 slots across 46 of
`gohugoio/hugo`'s 244 boards ([ADR-0024](decisions/0024-a-language-ships-on-its-deck-not-on-its-map.md) §6.1).
With the package as the node, the reference is *inside* a node and the class cannot be expressed.

So one Go node is one directory: `path` is the directory (`.` at the repo root), `fileCount` is how
many `.go` files it holds, `loc` and `bytes` are sums, `exports` is the union of the package's
exported declarations, and `churn` counts commits touching **any** member — once per commit, not once
per file. A directory holding both `foo` and its external test package `foo_test` is one node; a
non-Go file in a Go directory is still its own `file` node.
[ADR-0026](decisions/0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md).

#### Identity across renames

`id` hashes `originPath`, not `path`, so `git mv` does not reset the player's fog of war or
invalidate their field notes. The rename chain is read from one `git log -M` pass; when two live
files chase the same historical path, the first claimant in log order keeps it. Full reasoning and
alternatives: [ADR-0002](decisions/0002-node-identity-survives-renames.md).

**git records renames of files, never of directories**, so a `dir` node has no lineage of its own to
read. Its `originPath` is the directory most of its members came from — which follows a package moved
wholesale, and survives one that has since gained a file. Two nodes proposing one origin (a package
*split*) is an ordinary refactor rather than a corrupt repo, so the first claimant in path order keeps
it and the other keeps its current path; a node's own key can never be taken from it.

#### What becomes a node

Indexed and scanned for imports: `.ts .tsx .mts .cts .js .jsx .mjs .cjs` one node per file, and
`.go` one node per **directory**.
Indexed but not scanned: `.json .jsonc .md` — they are part of the terrain and carry real history.
Everything else is skipped and counted in `report.skipped`, and program source among it is counted
again by language in `report.unreadable`.

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
| `wideLimit` | `number` | A commit touching more indexed files than this contributed **nothing** to `coChange`. ≥ 2. |
| `coChange` | `[NodeRef, NodeRef, number][]` | `a < b`. **Order: count desc, then a asc, then b asc.** |
| `commits` | `CommitRecord[]` | **Order: newest first.** |

`CommitRecord`: `sha` (12 hex), `date`, `subject` (≤ 120 chars), `files` (`NodeRef[]`, ascending,
unique), `wide` (the commit touched more files than the co-change cap), `issue` (first `#NNNN` in
the subject, or null).

**`wideLimit` is part of the contract, not a budget.** It does not change how *many* numbers
`coChange` holds — it changes what they **mean**. A reader who does not know it will take "changed
together 4 times" as a claim about all commits when it is a claim about focused ones. Companion
copies it into each challenge's `evidence` so the player can be told the exact rule they are graded
under ([ADR-0014](decisions/0014-companion-truth-is-a-gap-not-a-threshold.md)).

**Absence from `coChange` is not proof of zero.** Three separate rules drop pairs — the noise floor,
the wide-commit exclusion and the pair cap — so a verb that reads absence as "never changed
together" will offer a genuine companion as a wrong answer. The provable bound, and the only way to
use this matrix in an answer key, is in ADR-0014.

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
| `verb` | `VerbId` | `archaeology`, `blastRadius`, `companion` or `placement`. The full list is `VERB_IDS` in the schema — **the only one**. |
| `tier` | `1..6` | Curriculum tier, NORTH-STAR §5. |
| `difficulty` | `number` | `0..1`. **Computed, never authored** (NORTH-STAR §8.4). Generators normalise. |
| `subject` | `AtlasId` | What the question is about: an `n:` node for every verb but `placement`, which asks about a `c:` retained commit. Never appears in `candidates`. |
| `candidates` | `AtlasId[]` | Sorted. The choice set. Non-empty. **All one kind**, derived from `evidence.kind` — see below. |
| `truth` | `AtlasId[]` | Sorted. Non-empty. A **proper** subset of `candidates`. |
| `witness` | `string` | **Why each wrong answer is here.** One space-separated token per candidate, positionally aligned with `candidates`; `-` where the candidate is in `truth`. See below. |
| `evidence` | `Evidence` | `{kind: "importGraph", depth}`, `{kind: "coChange", minCount, wideLimit, atMost}`, `{kind: "commit", subject, date, touched}`, or `{kind: "history", touchedBy}`. |

**`evidence.kind` decides what kind of id each role holds, and the validator enforces it.** It is not
an extra fact anyone has to be told — `commit` evidence describes an event and `history` evidence
describes a file's history, so the two are the same claim written twice and a disagreement is a
dangling reference in disguise:

| `evidence.kind` | `subject` | `candidates` / `truth` | verb |
|---|---|---|---|
| `importGraph` | node | nodes | `blastRadius` |
| `coChange` | node | nodes | `companion` |
| `commit` | commit | nodes | `placement` |
| `history` | node | **commits** | `archaeology` |

Note the validator never reads `verb` to do this, so a fifth verb reusing an existing evidence kind
needs no edit there.

Every `evidence` variant carries a **measured** quantity rather than a bound the generator imposed:
`depth` is the furthest hop this answer key actually travels
([ADR-0008](decisions/0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) §5),
`minCount` is the weakest coupling that made this key
([ADR-0014](decisions/0014-companion-truth-is-a-gap-not-a-threshold.md)), `touched` is how many
indexed files the commit changed in all, and `touchedBy` is how many eligible commits touched the
subject file in all.

Each verb's prompt may state its own as a fact — **except `touchedBy`, which only the reveal may
state**, and the exception is the point. The inspector already prints `churn`, which counts every
*walked* commit that touched a file, while `touchedBy` counts the *eligible* ones; two counts of
nearly the same thing, differing by whatever the guardrails refused, is a number a player would
reasonably read as the answer's size and be wrong about
([ADR-0019](decisions/0019-archaeology-asks-a-place-what-happened-to-it.md)).

The `commit` variant also carries the commit's own `subject` line and `date`, because `prompt()` is
pure over `(challenge, pathOf)` and has no atlas to look them up in — the same reason `coChange`
carries `wideLimit`. Quoting a commit message is **derived** content, not authored: guardrail 2
forbids writing prose about a particular project, and repeating what the repo already says about
itself is the opposite of writing it.

`atMost` is the other half of a Companion board's claim: what a candidate **outside** the answer key
is certified at. Normally 1, raised when the pair cap bit. It exists because the instruction line
said "at most once" unconditionally, which is a false certification on any repo where the cap fired —
a bound that raises correctly while the sentence describing it does not is half a fix.

`truth` sits here in plaintext, deliberately. This is a learning tool, not an exam; anyone who opens
devtools to read the answer has opted out of the product. Do not obfuscate it.

#### `witness` — the strategy that chose each wrong answer

Every distractor is picked by a named §8.3 strategy, and `witness` is the record of which. It is a
single string, one token per candidate, aligned by position with `candidates`:

```jsonc
"candidates": ["n:0a…", "n:1b…", "n:2c…", "n:3d…"],
"truth":      ["n:1b…"],
"witness":    "treeSibling - nameSimilar distant"
```

Three rules, all enforced by the validator:

1. the token count equals the candidate count;
2. a token is `-` **exactly** where the candidate is in `truth` — nothing chose an answer;
3. every other token matches `[a-zA-Z]+`.

Rule 2 is the load-bearing one. Alignment is the whole contract, so a witness that has drifted by one
position describes every candidate after it wrongly **and parses cleanly**; nothing downstream
re-derives the mapping, so if it is not checked here it is not checked anywhere.

The token is a strategy id belonging to the challenge's **own verb**. Those sets live in each verb's
`distractors.ts` and are deliberately not restated here — the validator cannot import from
`src/verbs/` (verbs are built on the atlas), so it checks the shape and `tests/atlas/` checks
membership. As shipped:

| verb | strategies |
|---|---|
| `blastRadius` | `graphAdjacent`, `treeSibling`, `nameSimilar`, `coChange`, `distant` |
| `companion` | `structural`, `busy`, `treeSibling`, `nameSimilar`, `distant` |
| `placement` | `busy`, `structural`, `treeSibling`, `nameSimilar`, `mentioned`, `distant` |
| `archaeology` | `neighbour`, `sibling`, `mentions`, `companion`, `distant` |

`distant` is in every set and is **not a strategy** — it is what fills a board when the others run
dry, labelled rather than hidden so `report.distractorMix` can say how much of a choice set was
padding.

It is recorded rather than re-derived because the two disagree. Measured across every shipped board,
the reason a reveal reconstructs from the graph names the strategy that actually chose the candidate
on **53.9%** of this repo's distractor slots and **47.9%** of `honojs/hono`'s: a candidate satisfies
several predicates at once, and which one *chose* it was settled by a quota rather than by a
predicate. Seven of the seventeen (verb, strategy) pairs are re-derived correctly zero times on
either repo
([ADR-0020](decisions/0020-a-wrong-answer-carries-the-reason-it-was-offered.md)).

**Plaintext here, gated in the panel.** Like `truth`, this is not obfuscated. What a *reveal* may say
out loud is a separate and stricter question — two classes are recorded and never spoken, because
naming them would hand another verb its answer key — and that gate lives in each verb's reveal, not
in the data.

**`id` is stable within an atlas and nowhere else.** It is a convenience for ordering and lookup, not
an identity that survives a reindex — the generator may renumber freely when the deck changes. So
nothing outside the atlas may key on it: the player's save records a pass by `(verb, subject)`,
because a `SubjectId` is stable by construction — a `NodeId` hashes the origin path, and a `c:` id
is a commit sha
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

**No two `blastRadius` challenges in one atlas have the same `truth` set.** Subjects whose certain
dependent sets are equal would otherwise produce byte-identical answer keys — one question wearing
two subjects, and 61% of `sveltejs/svelte`'s deck before this rule. A colliding subject is re-asked
with a disjoint window of its own dependents where the cone allows one, and refused as
`duplicateKey` where it does not.
[ADR-0012](decisions/0012-an-answer-key-is-issued-once.md).

This is a **within-verb** property, deliberately not a schema rule the validator enforces: two
different verbs may honestly share an answer set, because they are asking different questions about
the same files.

#### The same invariant, three times

Each verb keeps `candidates` split cleanly between the answer key and files certified *out* of it,
with nothing in between for the player to guess at:

| verb | invariant | what a distractor is certified as |
|---|---|---|
| `blastRadius` | `candidates ∩ dependents(subject, ∞) = truth` | reaches the subject by no import chain at all |
| `companion` | `candidates ∩ companions(subject) = truth` | has co-changed at most `atMost` times |
| `placement` | `candidates ∩ files(commit) = truth` | was not in that commit's recorded file list |
| `archaeology` | `candidates ∩ touchedBy(subject) = truth` | its own recorded file list does not name the subject |

The last two are the two projections of one incidence relation — *commit → which files?* and
*file → which commits?* — so they read the same record and share `src/verbs/commits.ts`'s
eligibility rule entirely. Both are certified from a **positive** record rather than from absence,
which is why neither needs the truncated-walk refusal ADR-0014
decision 6 gives Companion: how far back the walk went cannot make a commit's own file list wrong.
What it does refuse is a commit whose list the indexer may have cut (`report.truncations` with
`what: "commitFiles"` — the entry's `kept` **is** the limit, so the affected commits are identifiable
exactly), a `wide` commit, and any commit touching a node with contested rename lineage. Both
*do* need the shallow-clone refusal, for a mechanism the walk-window argument does not cover: a
`--depth N` clone's oldest commit is diffed against the empty tree, so git reports it as adding the
entire worktree. [ADR-0018](decisions/0018-a-subject-is-a-place-or-an-event.md),
[ADR-0019](decisions/0019-archaeology-asks-a-place-what-happened-to-it.md).

**Archaeology adds one rule the other three do not have: a commit may not be an answer for a file
whose membership an *earlier verb's reveal* already stated.** Placement's reveal names the files a
commit touched, and each of those is an atom of that file's Archaeology key read the other way —
measured at 58.9% of this repo's key members before the rule existed. The commit is then off the
board entirely rather than merely out of the key, because it *did* touch the file and the invariant
above forbids a candidate that is neither. This is ADR-0012 generalised from answer *keys* to the
facts inside them, and it is the first time one verb's output constrains another's; the coupling is a
verb-blind set of opaque facts (`src/verbs/disclosure.ts`), so neither verb names the other.

> **Status at M4**: four verbs generate. On this repo that is one challenge per subject with a
> non-empty radius, minus what the guardrails refuse. The CLI prints how many it declined and why,
> how many subjects it re-asked with a second key, how much of each choice set came from a
> principled distractor strategy rather than from `distant` padding, and **how many nodes no
> question can ever reveal** — the coverage a refusal costs, which a deck count alone hides.

### 3.7 `report`

What the indexer dropped, and why. `truncations` is `{what, kept, dropped}` sorted by `what`;
`skipped` is `{reason, count}` sorted by `reason`. Both are enums, not prose, so a future budget
script can act on them.

#### `unreadable` — what this map is missing

`{lang, count}` sorted by `lang`, one entry per language, counts ≥ 1. Empty when the walk saw no
program source it could not read.

It is a **refinement of `skipped`'s `unsupported`, not a bucket beside it**: every file counted here
is also counted there, so that number stays comparable across atlas versions. The refinement is the
whole point — `unsupported` cannot tell a PNG from a Go file, and that difference is the difference
between *this repo is its Markdown* and *this repo has 906 Go files we cannot see*
([ADR-0025](./decisions/0025-a-deck-is-refused-when-the-map-is-not-of-the-repository.md)).

`lang` is a **display name** (`Go`, `Python`, `C++`) rather than a code, because it is printed to a
human on both sides of the wall and a second table mapping codes to names is a second place to be
wrong. The vocabulary is deliberately **open**: the validator checks the shape and not the set,
because the extension table lives in `src/indexer/walk.ts` and adding a language to it must not be a
schema change. The reading rule is `src/atlas/coverage.ts`, shared by the indexer and the player so
that the terminal and the panel cannot drift.

**A deck may be legitimately empty.** When `sourceCoverage` refuses it, `challenges` is `[]` and this
field says why; the map, regions, history and layout are all present and valid as usual.

---

## 4. Compatibility

`version` is `10`. **A change to any shape above bumps it**, and ships either a migration or an
explicit "reindex required" error (guardrail 5). The validator already produces the latter: loading
an older atlas into a newer build fails with

```
atlas.version: this build reads atlas v10, got v9 — reindex required
```

The player must never guess at a shape.

**v9 → v10 has no migration either, and it could not have one.** `nodes[].fileCount` is a new
required field, `repo.fileCount` is renamed to `repo.nodeCount`, `NodeKind` gains `dir` and `Lang`
gains `go`. On an atlas whose nodes are all files a default of `1` would even be *correct* — and the
reason to refuse it anyway is that on the atlases where it is wrong, it is wrong silently and in the
direction that decides a deck: `sourceCoverage` weighs mapped files against unreadable ones, and a Go
atlas defaulted to 1 would weigh 193 packages against a repo's Python.

Cost, measured byte-for-byte through the real serialiser on clean clones of ark `837970f2` and hono
`7075369e`: **+2,273 B (0.72%)** and **+6,207 B (1.01%)** — one integer per node. Both decks are
**byte-identical**, as are their nodes minus the new field, edges, regions, history and report.

**v8 → v9 has no migration, and it is the cheapest bump yet — but the *reason* is new.**
`report.unreadable` is a new required field, and unlike every earlier bump the missing information is
not merely unrecoverable, it is unrecoverable **by design**: the fact lives on the filesystem the
player is forbidden to touch (pillar 5). A default of `[]` would validate and would assert that
nothing is missing from the map, which is precisely the false claim this version exists to stop. So
the "reindex required" error is the correct outcome and `npm run index` is the whole of it.

Cost, measured byte-for-byte through the real serialiser against the same repos indexed by a clean
clone of `e6fe5e4`: **+60 bytes** on this repo, on `honojs/hono` and on `sindresorhus/awesome` — one
entry each (`1 Shell`), and the same 60 bytes because the field is bounded by the number of
*languages*, not the number of files. The atlases that move are the ones whose deck is now refused,
and they move the other way: `gohugoio/hugo` 635,373 → 485,408 bytes, `django/django` 181,635 →
102,736.

**v7 → v8 has no migration either, and it is the cheapest bump so far.** `challenges[].witness`
is a new required field carrying a fact only the generator knows — which strategy chose each wrong
answer. Nothing can synthesise it from a v7 atlas, because the information was thrown away at the
return statement; a default of all-`distant` would validate and would be a lie about every board. So
this is a reindex, and `npm run index` is the whole of it.

Cost, measured through the real serialiser on a clean clone of `4bb1996`: **+27.0 KiB on this repo
(10.8% of the atlas) and +40.5 KiB on `honojs/hono` (7.3%)**, taking this repo from 1851 to
2050 bytes per file against a 2621 ceiling, and hono from 1343 to 1441. The per-file figure is the tight one and it is tight
because `maxChallengesFor` has a **floor** of 40 boards per verb, which a 140-file repo pays in full;
at the 2,000 files the ceiling is quoted for, the deck scales with the repo and the witness is a
few per cent of the atlas.

**v6 → v7 has no migration, and reindexing is the whole of it** — the same shape as v5 → v6 before
it. `challenges[].candidates` and `.truth` widened from `NodeId[]` to `AtlasId[]`, `Evidence` gained
a `history` variant, and `VerbId` gained `archaeology`. A v6 atlas is *readable* — every v6 member is
a node id and still validates — but it contains no Archaeology questions, and synthesising them would
mean inventing an answer key. The atlas is a derived artifact with a one-command rebuild
(`npm run index`), so the error above is the correct outcome rather than a gap.

**A save survives, and this bump tested that claim rather than repeating it.** `SAVE_VERSION` is
independent of this number and `(verb, subject)` keys are unchanged — but a stored `proved` list now
admits commit ids, and the parser that reads it filtered members with `isNodeId`, so every
Archaeology pass would have been dropped at load and **erased by the next write**. Widening that
filter is part of the same change. Every restored claim is still re-checked against the live graph
([ADR-0011](decisions/0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)
decision 3).

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
