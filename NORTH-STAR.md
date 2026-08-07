# Ark

> A game that teaches you how an unfamiliar codebase is shaped — by making you map it.
> You are not a tourist. You are a cartographer arriving at a shore that already exists.

- **Working title**: `Ark` — **placeholder, expect to rename.** Known collisions: *ARK: Survival Evolved* (Studio Wildcard), ARK Invest, ark.io, KDE's `ark`. Fine for scaffolding; check npm / GitHub / domain before anything public. Candidates: Fathom, Plumb, Sounding.
- **Naming note for agents**: the product name appears in this file, `CLAUDE.md`, `package.json`, and the CLI binary. It does **not** appear in filenames — this doc is `NORTH-STAR.md` on purpose, so a rename is a content edit, never a file move.
- **One-liner**: Point it at any repo. Learn its architecture by proving you understand it.
- **Audience**: Developers with basic coding and data-structure knowledge. Not a "learn to program" product.
- **Status**: Design spec, pre-code. This document is the north star; when it conflicts with a later decision, either update it or don't make the decision.

---

## 0. What this document is

This is the **north star**, modelled on the working pattern that produced Promptasy over 40+ iteration
phases. It deliberately **does not fix** the art style, the challenge wording, or the exact UI. It fixes
only the things that must not drift: the pillars, the loop, the grading contract, and the data format.

Everything else is open and expected to change.

Read this before every work session. Add a line to `CHANGELOG.md` at the end of every one.

---

## 1. The problem, stated honestly

Onboarding onto an unfamiliar codebase is one of the highest-frequency, lowest-support activities in
software. The existing options are:

| Option | Why it falls short |
|---|---|
| README / architecture docs | Written once, stale immediately, describe intent not reality |
| Reading the code top-down | No idea where the top is |
| Asking a teammate | Doesn't scale, and they'll tell you the story they remember, not the graph |
| Asking an LLM | Plausible, unverifiable, and confidently wrong about anything unusual |
| Existing visualizers | Show you a picture. A picture is not understanding — you can look at a dependency graph for an hour and retain nothing |

The gap: **there is no way to find out whether you actually understand a codebase.** Reading feels
like progress and isn't. The only real test is prediction — *if I change this, what breaks?* — and
nothing currently asks you that question.

That question is the product.

---

## 2. The insight this is built on

**The repository is its own answer key.**

Every challenge must be graded against a fact that can be extracted from the repo itself:

- The **import graph** knows exactly what breaks if you change a module's interface.
- The **call graph** knows the real execution path from an entry point.
- **Git history** knows which file fixed issue #4412, because the commit says so.
- **Co-change coupling** knows which files always move together, and therefore which ones are
  secretly one module wearing two hats.
- **Blame** knows which lines are eight years old and untouched, and which are churned monthly.

This is why the product can work on *any* repo without an author writing levels, and why it needs
no model in the loop. There is an infinite supply of questions with objectively correct answers,
already sitting in the `.git` directory.

**Git is the rubric.**

---

## 3. Design pillars

Six. Four of them forbid something, which is the point — a pillar you cannot violate is decoration.

### 1. Ground truth or nothing
Every challenge is graded against a fact mechanically extracted from the repo. No opinion grading,
no "quality" scoring, no LLM in the core loop.
**Violated when**: a challenge's correct answer can't be traced to a specific graph query or commit.

### 2. The repo is the level
Content is *derived*, never authored per-repo. If shipping support for a new repo requires a human to
write challenges for it, it does not ship.
**Violated when**: `atlas.json` contains a hand-written string specific to one project.

### 3. Teach coupling, not trivia
The skill being built is predicting change propagation and locating responsibility. Not memorising
file names.
**Violated when**: a challenge can be answered by `Ctrl+F` rather than by reasoning about structure.

### 4. Geography is topology
The map's layout is derived from the real graph. If a visual choice makes the picture prettier but
less true, it loses.
**Violated when**: a node is moved for aesthetic reasons.

### 5. Local-first, nothing leaves the machine
Indexing runs against a local clone. Source code is never uploaded. This is non-negotiable because
the highest-value use case is proprietary repos on the first day of a new job.
**Violated when**: any code path sends file contents over a network.

### 6. Ten minutes to first true insight
A developer pointing this at a repo must learn something true and non-obvious about it within ten
minutes, with no configuration.
**Violated when**: setup requires a config file, a language server, or a successful build.

> **Guardrail precedence**: pillars beat aesthetics, always. If the map looks worse but reads truer,
> the map looks worse.

---

## 4. Core loop

```
arrive at an unmapped repo   →   see the map, mostly fogged   →   pick a landmark
        →   a challenge tests one claim about its structure
        →   graded against ground truth, with partial credit + evidence
        →   fog lifts around what you proved you understand
        →   deeper challenges unlock   →   pick the next landmark
```

**Fog of war is not a game mechanic bolted on — it is an honest rendering of the player's actual
state.** You genuinely do not know this codebase. The revealed fraction of the map is a real measure
of how much of it you can reason about. This gives us the collection pillar for free and costs nothing
in credibility.

Target session: 10–20 minutes. Target outcome after one session on a medium repo: the player can
name the entry point, the three or four top-level regions, the most-depended-upon module, and one
thing that is surprising about the structure.

---

## 5. Curriculum

Promptasy had 130 authored skills. We can't author ours, so the curriculum must be **derived tiers**
that generalise across every repo. This is the ordered list of what "understanding a codebase" decomposes
into, and it doubles as the difficulty progression.

| Tier | Name | Question shape | Ground truth |
|---|---|---|---|
| 1 | **Orientation** | Where does execution start? What are the top-level regions? What's the largest module? | Manifest, directory tree, LOC |
| 2 | **Topology** | Which way do dependencies point? What's a hub, what's a leaf? Where's the layering violation? | Import graph, SCC detection |
| 3 | **Coupling** | If I change this, what breaks? What always changes alongside this file? | Transitive dependents, co-change matrix |
| 4 | **Flow** | Trace this user action from entry point to output. What's the order? | Call graph traversal |
| 5 | **History** | Why is this file weird? What's churned 40 times and why? What was reverted? | Log, blame, revert detection |
| 6 | **Judgment** | You need to add feature X — where does it go? What's the smell here? | The actual commit that added it |

Tiers 1–3 are achievable with cheap static analysis and should ship first. Tier 4 needs a real call
graph and is the expensive one. Tiers 5–6 need only git, and are disproportionately high-value —
**consider doing tier 5 before tier 4.**

---

## 6. The verbs

A "verb" is one interaction type, analogous to Promptasy's eleven board types. Each verb must declare
how it is graded. **v1 ships one verb well rather than six badly.**

### 6.1 Blast Radius — the v1 verb

> *"You're changing the signature of `parseConfig()` in `src/config/parse.ts`. Select every file that
> will need to change."*

- **Ground truth**: transitive dependents in the import/call graph, depth-bounded.
- **Why this one first**: it is the single clearest separator between someone who has *read* a
  codebase and someone who *knows* it. It's gradeable with only an import graph — the cheapest
  possible analysis. And it's the question people actually ask at work.
- **Distractors**: siblings in the directory tree, nodes at similar graph distance, files with
  confusingly similar names. Distractor quality is the hard part — see §8.3.

### 6.2 Backlog

| Verb | Prompt shape | Ground truth |
|---|---|---|
| **Placement** | "Feature X was added. Which file(s) changed?" | The real commit |
| **Trace** | "Order these calls from entry point to output" | Call graph path |
| **Layering** | "Arrange these modules into layers" | Import direction; no upward edges |
| **Owner** | "Where does this state live? Who mutates it?" | Assignment/mutation sites |
| **Companion** | "Which file changes with this one most often?" | Co-change matrix |
| **Archaeology** | "This file was rewritten three times. What problem kept recurring?" | Commit messages + reverts |

---

## 7. Architecture

Two artifacts, one interface between them. This split is load-bearing — it's what makes pillar 5
(local-first) and static deployment simultaneously possible.

```
┌──────────────────────────────────┐        ┌───────────────────────────────┐
│  INDEXER  (CLI, runs locally)    │        │  PLAYER  (static web app)     │
│                                  │        │                               │
│  npx ark index .            │ atlas  │  reads atlas.json             │
│    ├─ parse imports              │ ─────▶ │    ├─ render map (2D graph)   │
│    ├─ walk git log / blame       │ .json  │    ├─ fog of war state        │
│    ├─ compute co-change matrix   │        │    ├─ serve challenges        │
│    ├─ compute layout (fixed)     │        │    ├─ grade answers           │
│    └─ generate challenge set     │        │    └─ progression + save      │
│                                  │        │                               │
│  TOUCHES YOUR SOURCE             │        │  NEVER TOUCHES YOUR SOURCE    │
└──────────────────────────────────┘        └───────────────────────────────┘
```

Consequences worth noting:

- The player is a **pure function of `atlas.json`** — no filesystem access, no network, deployable to
  GitHub Pages exactly like Promptasy.
- An atlas for a **public** repo can be shared, embedded in docs, or published. An atlas for a
  private repo simply never leaves the machine. Same code path, no special casing.
- The atlas is testable in isolation. The player is testable against fixture atlases.
- **Layout is computed in the indexer, not the player.** Same repo ⇒ same map, every session, on every
  machine. Spatial memory of a codebase must persist, or the whole metaphor is worthless.

### 7.1 Atlas format (sketch — v0)

```jsonc
{
  "version": 1,
  "repo": { "name": "…", "head": "a1b2c3d", "headDate": "2026-07-30", "languages": ["ts"] },

  "nodes": [{
    "id": "src/engine/engine.ts",
    "kind": "file",                    // file | dir | symbol
    "loc": 590,
    "layout": [412.3, 88.1],           // precomputed, deterministic
    "region": "engine",                // derived cluster, not directory
    "exports": ["createEngine"],
    "churn": 14,                       // commits touching this file
    "firstSeen": "2025-11-02",
    "lastSeen":  "2026-07-30"
  }],

  "edges": [{ "from": "src/main.ts", "to": "src/engine/engine.ts", "kind": "import", "weight": 1 }],

  "history": {
    "coChange": [["src/a.ts", "src/b.ts", 31]],
    "commits":  [{ "sha": "…", "subject": "…", "files": ["…"], "issue": 4412 }]
  },

  "challenges": [{
    "id": "blast-engine-01",
    "verb": "blastRadius",
    "tier": 3,
    "difficulty": 0.62,                // computed, see §8.4
    "subject": "src/engine/engine.ts",
    "candidates": ["…"],               // the choice set shown to the player
    "truth": ["…"],                    // the correct subset
    "evidence": { "kind": "importGraph", "depth": 2 }
  }]
}
```

Design notes: `truth` sits in the atlas in plaintext. That is fine — this is a learning tool, not an
exam, and anyone who opens devtools to cheat has opted out of the product. Do not obfuscate it; the
complexity is not worth it.

> **Amended 2026-08-07.** This sketch originally carried `repo.indexedAt`, a wall-clock timestamp.
> It is gone, replaced by `repo.headDate` (HEAD's commit date, a property of the repo rather than of
> when we looked at it). A timestamp and a byte-identical determinism test cannot both exist, and
> determinism is what makes spatial memory of a codebase survive across sessions and machines —
> which is the mechanic §7 puts layout in the indexer to protect. Staleness is answered better by
> `repo.head` anyway: an atlas is stale exactly when its head is not the repo's current HEAD.
> Reasoning and rejected alternatives: [`docs/decisions/0001-no-wall-clock-time-in-the-atlas.md`](./docs/decisions/0001-no-wall-clock-time-in-the-atlas.md).

### 7.2 Language support strategy

1. **v1: TypeScript/JavaScript ES modules only.** An import scanner is ~150 lines and needs no
   toolchain. It is also, conveniently, the language this product is written in — see §11.
2. **v2: tree-sitter.** Gives cheap, build-free parsing for ~40 languages. Grammars ship as WASM.
   Good enough for imports and top-level symbols in most languages.
3. **Never: requiring a successful build or a language server.** That violates pillar 6. Precision
   loses to "works in ten seconds on a repo you just cloned."

Accept the accuracy hit. An 85%-accurate import graph that works everywhere beats a perfect one that
needs `tsc --build` to succeed.

---

## 8. Grading

### 8.1 The contract

Every verb implements one function, deterministic and side-effect-free:

```ts
type Grade = {
  score: number;        // 0..1
  correct:   string[];  // picked ∩ truth
  missed:    string[];  // truth \ picked
  spurious:  string[];  // picked \ truth
  evidence:  string;    // why — derived, never canned
};

type Verb = {
  id: string;
  generate(atlas: Atlas, opts): Challenge[];
  grade(challenge: Challenge, answer: Answer): Grade;
};
```

Same discipline as Promptasy's eleven-boards-one-string seam: **every verb, however different its
interaction, reduces to one `Grade`.** Adding a verb costs nothing downstream.

### 8.2 Set scoring, and why anti-gaming falls out for free

Most verbs are "select the right subset." Score with F1:

```
precision = |picked ∩ truth| / |picked|
recall    = |picked ∩ truth| / |truth|
score     = 2·p·r / (p + r)
```

The naive exploit is "select everything." Under F1 that gives recall 1.0 and precision
`|truth| / |candidates|` — so on a 20-candidate question with 4 correct answers it scores **0.33**,
below any pass threshold. No special-case anti-cheat code needed; the metric does it.

Grade bands, borrowing Promptasy's shape: **S ≥ 0.95, A ≥ 0.78, B ≥ 0.60, C = reached pass.**

### 8.3 Distractors are the actual hard problem

A multiple-choice question is exactly as good as its wrong answers. Random distractors make every
question trivial. Principled generation, in rough order of value:

- **Graph-adjacent**: nodes at distance *n±1* from the subject. The player must know where the boundary is.
- **Tree-siblings**: files in the same directory that are *not* dependents. Punishes "same folder = coupled."
- **Name-similar**: `parseConfig.ts` vs `parse-config.util.ts`. Punishes pattern-matching on filenames.
- **Historically-coupled-but-not-structurally**: files that co-change but don't import. These are the
  *best* distractors, because getting them wrong is itself a lesson.

Ratio to start: 40% graph-adjacent, 25% siblings, 20% name-similar, 15% historical. Tune from playtest.

### 8.4 Difficulty is computed, not authored

```
difficulty(c) = w₁·log(fanOut)          // how much there is to get wrong
              + w₂·maxDepth             // how far the propagation travels
              + w₃·surprise             // ← the interesting term
```

where `surprise = |truth Δ naiveGuess| / |truth|`, and `naiveGuess` is what you'd answer if you
assumed only direct neighbours matter.

**A question is hard exactly when the true answer differs from the obvious one.** That's computable,
which means difficulty tiers need no human tuning and adapt automatically to each repo. This is the
mechanism that lets tier progression work on a codebase nobody has ever seen.

---

## 9. Presentation

**v1 is 2D.** Not because 3D is bad, but because a dependency graph *has an intrinsic topology* and
forcing it into a walkable landscape fights legibility (pillar 4). Promptasy could impose arbitrary
geography because a curriculum has no natural shape; a codebase does.

- **Map**: force-directed layout, computed once in the indexer. Node size = LOC. Edge = import.
  Colour = region. Fog = unexplored.
- **Semantic zoom**, like a real map: repo → package → file → symbol. Detail appears at the zoom level
  where it's readable, not all at once.
- **Challenge panel**: modal over the map, so you never lose spatial context. Promptasy's console
  pattern — the world stays visible and alive behind the scrim.
- **Field notes**: the codex equivalent. Accumulates facts you have *proven* you know, not facts you
  were shown. "You know that `engine.ts` has 14 dependents." That distinction is the whole product.

3D is an earned upgrade, not a v1 goal. If it happens, the layout must still derive from the graph.

---

## 10. Tech stack

| Layer | Choice | Reasoning |
|---|---|---|
| Language | **TypeScript** | The defects worth preventing here are shape errors in the atlas format and verb contracts. That's a type-system problem, not a performance one. (Rust would optimise the part that isn't the bottleneck — the whole workload is graph traversal over a few thousand nodes and DOM rendering.) |
| Indexer | Node CLI | Ships as `npx ark`. Zero install friction. |
| Parsing | Hand-rolled ES-module scanner → tree-sitter (WASM) | Build-free, per pillar 6 |
| Git | `git log --numstat`, `git blame --porcelain` via subprocess | No libgit2 dependency; the plumbing commands are stable and fast |
| Layout | `d3-force` or `webcola`, **run in the indexer** | Determinism |
| Player render | Canvas 2D or SVG. **Not** WebGL for v1 | A few thousand nodes doesn't need it. Revisit above ~5k. |
| UI | Plain DOM + a small overlay factory | Same reasoning as Promptasy — imperative UI at interaction rates doesn't need a reconciler |
| Persistence | localStorage, keyed by repo + HEAD | No account, no backend |
| Deploy | Static | Player is a pure function of the atlas |

---

## 11. The bootstrap: this repo is the first level

**v1's only target repo is Ark itself.**

This is not a shortcut, it's the design:

- The content problem vanishes. We know this repo intimately because we're writing it.
- Every feature we add *becomes a new level*, so development and content generation are the same act.
- It's a forcing function on pillar 6: if the tool can't make its own architecture legible, it
  doesn't work.
- It's honest dogfooding — we experience the onboarding problem on the exact codebase we're building.

Generalising to arbitrary repos is v2. Do not build language-agnostic parsing before the loop is
proven fun on one repo we control.

---

## 12. Non-goals

- Not a code editor, review tool, or IDE plugin (v1).
- Not an LLM explainer. No model in the core loop, ever. An optional "ask about this node" side panel
  is acceptable *only* as a clearly-labelled bonus that the grading never depends on.
- Not teaching programming or a language. Assumes working knowledge of code and data structures.
- No cloud upload of source. Not "encrypted upload." None.
- Not attempting semantic understanding of what code *means*. We teach structure, coupling, and
  history. That's a real and underserved skill; don't dilute it by faking comprehension.
- Not a metrics/quality dashboard. Complexity scores are inputs to difficulty, not outputs to the user.

---

## 13. Roadmap

| Milestone | Deliverable | Proves |
|---|---|---|
| **M0** | Atlas format spec + ES-module indexer for this repo | The data model holds |
| **M1** | 2D map render, fog of war, semantic zoom | The map is legible |
| **M2** | Blast Radius verb + F1 grading + distractor generator | **Is the loop fun?** ← kill point |
| **M3** | Progression, field notes, localStorage save | It's a game, not a demo |
| **M4** | Git-derived verbs (Companion, Placement, Archaeology) | The git-as-rubric thesis |
| **M5** | tree-sitter, 3–4 more languages | Generalisation |
| **M6** | Trace verb (real call graph) | The expensive tier |

**M2 is the kill point.** If Blast Radius isn't engaging on a repo you wrote yourself, stop and
rethink the verb rather than adding a second one. Everything before M2 should be reachable in two
focused weekends.

---

## 14. Open questions and risks

| # | Risk | Why it's serious | Mitigation / test |
|---|---|---|---|
| 1 | **Transfer** | Does mapping repo A make you better at repo B, or only at repo A? If it doesn't transfer, this is a per-repo novelty, not a skill-builder. | Playtest: map repo A, then measure cold performance on repo B against a control |
| 2 | **Scale** | A 10k-file monorepo is an unreadable hairball. | Semantic zoom + region clustering must work before M5. Test on something large early. |
| 3 | **Dynamic languages** | Import graph ≠ call graph. Python/JS with dynamic dispatch will produce a partially wrong ground truth. | Be explicit in-product about confidence. A challenge with uncertain truth must not be generated. |
| 4 | **Fog frustration** | Fog of war can read as "the tool is hiding things from me." | Always show the *silhouette* of unexplored regions — you can see there's something there, just not what |
| 5 | **Distractor quality** | Bad distractors make every question trivial and the product pointless. | §8.3 is a real subsystem, not a helper function. Budget accordingly. |
| 6 | **Prior art** | Sourcetrail, CodeSee, CodeCity, Gource all attacked adjacent ground; several are dead. | **Do this research before M1.** They were all *tools* and all tried to be general immediately. Verify that's the actual failure mode before betting against it. |
| 7 | **Repos without history** | A fresh repo or a squashed-history import has no git signal. | Tiers 1–4 must be fully playable with zero commits |

---

## 15. Definition of done, per iteration

- [ ] One improvement, end to end, actually playable.
- [ ] `npm run dev` runs clean, no console errors.
- [ ] The indexer still produces a valid atlas for this repo.
- [ ] Verb contracts unchanged, or migrated.
- [ ] A line in `CHANGELOG.md`: what changed, and what to do next.

---

## Appendix A — what we're deliberately borrowing from Promptasy

| Pattern | Why it applies here |
|---|---|
| Pillars as arbitration, half of them negative | Proven to prevent scope drift over 40+ phases |
| One seam between all input modes and the grader | Eleven boards → one string became eleven verbs → one `Grade` |
| Deterministic, offline, pure-function grading | Makes the whole thing unit-testable at scale and free to run |
| Partial credit + derived evidence, never canned | "You got 4 of 6; you missed the two reached through the re-export" |
| Budgets measured by script, not estimated | e.g. "atlas ≤ 5 MB, index ≤ 10 s on a 2k-file repo" |
| Data-integrity validation that fails fast at boot | An atlas with a dangling edge must throw, not degrade |
| Never punish a wrong answer | Wrong picks teach; they don't subtract |

## Appendix B — what we're deliberately *not* borrowing

| Pattern | Why not |
|---|---|
| 3D world | Codebases have intrinsic topology; imposed geography fights it (pillar 4) |
| Hand-authored curriculum | Directly violates pillar 2 — the whole point is that it generalises |
| Procedural art / zero assets | Irrelevant. Our visual output is a graph, and it should look like one |
| Vanilla JS | We want types here; the atlas format and verb contracts are exactly what a type system is for |
