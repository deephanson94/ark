# ADR-0011 — Progress is keyed to the repo, and a field note claims only what was proved

- **Status**: accepted
- **Date**: 2026-08-07
- **Amends**: NORTH-STAR §10 (the Persistence row) and §9 (the field-notes example). Both point here.
- **Extends**: ADR-0002 (node identity survives renames), ADR-0008 (sampled answer keys)
- **Bumps**: `ATLAS_VERSION` 2 → 3. `RepoMeta` gains `root`.
- **Reviewed by**: Fable, before implementation. It killed the persistence key this ADR started
  from and found an unprovable claim in the north star itself. Both are recorded below.

## Context

M3 is "progression, field notes, localStorage — proves it's a game, not a demo". Three questions had
to be settled before any of it was written, because all three end up in the same stored object.

## Decision 1 — the save is keyed to the repo's **root commit**, not to HEAD

NORTH-STAR §10 says persistence is *"localStorage, keyed by repo + HEAD"*. That cannot stand
alongside ADR-0002, which exists so that *"the player's fog-of-war and field notes survive a
refactor"*, or §7, which puts layout in the indexer so spatial memory persists across sessions:
**HEAD changes on every commit, so a HEAD-keyed save is wiped every time the repo is reindexed.**
The head key never bought the staleness check it implied, either — the player cannot compare against
the live repo, because it never touches the source.

So: **`ark:<repo.root>`**, where `repo.root` is the sha of the repo's first commit — a new atlas
field. `root` is identity; `head` is staleness. They answer different questions and a future session
must not simplify one into the other.

**`repo.root` is null, and the key falls back to `ark:name:<repo.name>`, in two cases**: a repo with
no history at all (risk #7), and a **shallow clone** — where `git rev-list --max-parents=0` returns
the graft boundary, which moves on every fetch, so keying on it would silently rotate the save. Not
a corner case: of the three repos this was tested against, `vitejs/vite` and `vllm` were both cloned
with `--depth` and both report `is-shallow-repository: true`.

**Why not key on `repo.name` alone.** This was the first draft's answer and it is unsafe for a
reason worth writing down: `NodeId` is a hash of `originPath` (ADR-0002) and is therefore
**repo-independent** — two unrelated repos that both contain `src/index.ts` produce the *same* node
id. Under a shared key, an `understood` promotion earned in one repo appears in the other, and a node
in `fog.understood` unlocks the full transitive radius on hover. That silently reopens the leak
ADR-0008 decision 1 was written to close. The name fallback keeps that hazard for the no-history and
shallow cases, and it is accepted and documented rather than hidden — those repos have weaker
identity everywhere by construction.

**Accepted failure mode**: a history rewrite (`filter-repo`, a squashed import) rotates the root and
resets progress. That is the right outcome anyway — a rewrite also rewrites rename chains, so the
`originPath`-derived node ids were going to orphan regardless. The save was already dead.

## Decision 2 — what is stored, and what is derived

```jsonc
{ "version": 1, "surveyed": [NodeId], "passes": [{ "verb", "subject": NodeId, "proved": [NodeId] }] }
```

- **`fog.understood` is derived at load**, as subjects ∪ proved members. Storing it as well would be
  two representations of one fact, and they would disagree after a reindex. `surveyed` *is* stored,
  because map clicks are not reconstructible from anything else.
- **A pass is keyed by `(verb, subject)`, never by `challenge.id`.** `docs/atlas-format.md` promises
  only that a challenge id is "stable within an atlas", so keying a save on it would depend on a
  cross-atlas guarantee the format explicitly declines to make.
- **Nothing region-derived is ever persisted, and neither is a cursor.** `CLAUDE.md`'s landmine says
  regions are stable for a commit and not across commits; position in the progression is recomputed
  from the answered set on every load.

**Reindex behaviour.** Stored ids that match no node are **retained in storage and ignored at
render** — retention is what makes reverting a deletion restore your map, and it costs a few KB.
Coverage counts intersect with live nodes so the HUD never claims progress on files that are gone.

## Decision 3 — a field note claims what was proved, and nothing else

NORTH-STAR §9 gives the example *"You know that `engine.ts` has 14 dependents."* **Under ADR-0008
that is not provable, and the north star is amended here.** A hub's answer key is a deterministic
*sample*: the player proved six of thirty-nine dependents. The number 39 was *shown* to them in the
reveal — shown, not proven, which is exactly the line `fog.ts` draws between `surveyed` and
`understood`, and the line §9 itself says "is the whole product".

So a note reads:

> *You proved 4 files that depend on `engine.ts` — `a`, `b`, `c`, `d` — the farthest 3 hops away.*

The full radius may still appear, **labelled as revealed** ("its full radius — 39 files — is unlocked
on your map"), never as knowledge. Correct *exclusions* get no note either: `progress.ts` already
declined to promote unpicked boxes, and a note must not claim more than the fog does.

**Prose is derived at render, never stored.** The stored `passes` records *are* the notes; templates
live in code and are repo-agnostic. Names resolve `NodeId → path` through the current atlas, which is
what makes a note follow a rename — ADR-0002 doing the job it was written for.

**Facts decay, and that is correct.** Provenance ("you proved this") is immutable in storage; the
claim about *today* is validated at render — each proved member is re-checked against
`dependents(subject, ∞)`, and a pair that no longer holds is dropped from display. A subject that no
longer exists goes dormant: retained, hidden. Showing a stale claim as current knowledge would be a
worse lie than showing nothing. A fully decayed pass also demotes its subject from derived
`understood` — the map re-fogs, honestly, because the thing the player proved is no longer true.

## Decision 4 — the serving rule, and why it has exactly two constraints

> **Suggested-next** = the first unanswered challenge in ascending `(tier, difficulty, id)` order
> whose **(a)** `truth` is not byte-equal to the previously served challenge's, and whose **(b)**
> subject's region differs from the previously served subject's. Drop **(b)**, then **(a)**, when
> nothing satisfies them. It never blocks; it always serves something.

`(tier, difficulty)` rather than bare difficulty because §5's tiers *are* the progression. Every
challenge is tier 3 today, so it currently reduces to ascending difficulty — writing `tier` now stops
an M4 session re-deriving the ordering when the git verbs land.

**Why (a) is byte-equality and not a similarity threshold.** The measured defect is *identical*
answer keys, and identity needs no threshold. A Jaccard cutoff or a longer look-back window would be
a magic number with no objective function — the class of patch `CLAUDE.md`'s landmines warn about.
It does not get added until repetition at a window of one is *measured* as still felt.

**The mechanism, which is why this is the right lever.** Difficulty is a pure function of the cone —
fanOut, depth, surprise — so two subjects with identical cones get **identical difficulty by
construction**. Measured: 5 of 6 identical-key groups on this repo share a difficulty to the byte, 21
of 22 on vite. Any ascending-difficulty sort therefore places them adjacent, and the id tiebreak then
sorts sibling paths together. The ordering key was *creating* the adjacency.

**Both constraints were measured before they were written** (the landmine about machinery that never
fires):

| | identical | j ≥ 0.8 | consecutive same-region | (a) fired | (b) fired |
|---|---:|---:|---:|---:|---:|
| ark, (a) only | 0 | 0 | 9 | 4 | — |
| ark, (a)+(b) | 0 | 0 | **0** | 3 | 9 |
| vite, (a) only | 0 | 0 | 5 | 1 | — |
| vite, (a)+(b) | 0 | 0 | **1** | 1 | 5 |

So they earn their places for **different** reasons, and the ADR records both: **(a) fixes the
measured repetition defect** — on its own, it takes ark from 5 consecutive identical pairs to 0. **(b)
changes the repetition numbers not at all**; what it buys is the tour — it stops the player being
marched through nine consecutive questions inside `src/atlas`, which is §4's "pick the next landmark"
read as movement across the map. Neither is speculative; both fire on both repos.

**Rejected: region round-robin**, which was this ADR's first plan. It does not work. Near-identical
keys do *not* reliably share a region — measured at 78% on ark and **52%** on vite, and one identical
pair on this very repo (`src/player/draw.ts`, `src/player/challenge.ts`) spans two regions. It also
degenerates: `src-atlas-index` holds 12 of 39 challenges, so once every other region is dry the tail
of the game is one region in ascending difficulty, which is precisely where the identical pairs live.
Round-robin defers the clustering rather than removing it.

**Rejected: greedy novelty** (serve whichever question introduces the most unseen files). Measured
*worse than doing nothing* — 4 consecutive identical pairs on ark against the plain sort's 5 — and it
destroys the on-ramp, opening vite at difficulty 0.60.

**Two failure modes the rule is built around.** Only *passed* challenges leave the unanswered set, so
a naive "first unanswered" rule re-serves a failed question forever, hammering a stuck player;
a session-scoped attempted set rotates past failures. Guardrail 6 forbids punishing a wrong answer,
not remembering that it happened.

**Suggested-next is an affordance, not a mode.** §4's loop is *"pick a landmark"* — the player
chooses. Clicking a disc on the map stays the primary path; the suggestion is a button that feeds the
same state. Otherwise M3 quietly turns a cartography game into a quiz deck, which nothing in the spec
licenses.

## Consequences

- `ATLAS_VERSION` → 3 for `repo.root`. The validator already reports "reindex required"; there is no
  installed base. `docs/atlas-format.md` §3.1 changes in the same commit.
- NORTH-STAR §9 and §10 carry amendment notes pointing here.
- **The M3 deadline in `CLAUDE.md`'s landmine — "spatial memory across a repo's *evolution* … will
  need a decision by M3" — is deliberately punted, and this is the record of the punt.** Nothing in
  the save or the serving rule references a region, so the question stays open rather than being
  answered by accident.
- Three rungs, not one: persistence, then suggested-next, then the notes panel. The seam is this
  stored shape, which is why it is decided once, here, before any of them.
- Identical cones are ultimately a *generation* artifact — those pairs are arguably one question
  wearing two subjects — and a generator-side dedupe is the deeper fix. It changes deck inventory,
  so it belongs to its own session, not to this one.
