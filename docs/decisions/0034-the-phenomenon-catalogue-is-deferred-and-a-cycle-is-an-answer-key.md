# ADR-0034 — The phenomenon catalogue is deferred, and a cycle is an answer key

- **Status**: **deferred, with findings.** No catalogue is built. Two results below outlive the
  decision: a standing disclosure hazard that binds any future surface, and four rules for measuring
  a detector.
- **Date**: 2026-08-11
- **Bears on**: NORTH-STAR risk #1 (transfer), §5 tier 2 (*"SCC detection"*),
  [ADR-0030](./0030-a-twin-is-named-once-its-whole-class-is-cleared.md) (which turns out to be this
  catalogue's entry #1), [ADR-0021](./0021-a-gate-heuristic-is-a-guess-that-needs-no-graph.md)
  (the scoring method used throughout)

---

## 1. What was proposed

A **phenomenon catalogue**: a repo-independent vocabulary of ~30–60 structural phenomena detected
deterministically from the atlas — *this is a hub, this is a cycle, this is a fossil, this is two
files wearing one hat.* `README.md` and `CLAUDE.md` have carried it on the Next list for several
milestones with that size attached.

The motivation is the sharpest risk in the north star. Every question ark asks is about a specific
file in one repo, so **nothing a player learns has a name that carries**. Risk #1: *"Does mapping
repo A make you better at repo B? If it doesn't, this is a per-repo novelty, not a skill-builder."*

Nothing was designed. Fifteen candidate detectors were written and counted first, which is the only
reason this document says what it says.

---

## 2. The measurement, and how much of it was measuring the instrument

Share of **mapped source** nodes, unless the row names another population. ark at `3cda64a`, hono
`7075369e` (**full clone**), hugo `44da08608`, prometheus `4bc98225b`, flask `6a2f545b`.

| | ark | hono | hugo | prom | flask | |
|---|---:|---:|---:|---:|---:|---|
| hotspot (≥3× median churn) | 12.5% | 18.0% | 12.9%◊ | 23.3%◊ | 16.9%◊ | |
| orphan (no edges at all) | 2.2% | 4.4% | 6.0% | 6.2% | 6.0% | |
| giant (≥5× median loc) | 1.5% | 15.7% | 14.3% | 18.5% | 13.3% | |
| twin (identical cone) | 14.7% | 10.2% | 21.7% | 35.7% | 2.4% | already ADR-0030 |
| hub (cone ≥ 10× median cone) | 27.2% | 22.7% | **0.0%** | 1.6% | 26.5% | **unreachable, §3.2** |
| entry (nothing depends on it) | 39.7% | 38.9% | 3.2% | 16.6% | 55.4% | **a test detector, §3.4** |
| tangle (SCC > 5) | 0.0% | 6.0% | **60.4%** | 8.3% | 24.1% | **one instance, §3.3** |
| small cycle (SCC 2–5) | 1.5% | 1.6% | 0.9% | 4.8% | 4.8% | |
| barrel (≥2 out, ≥80% re-export) | 0.7% | 3.7% | 0.9% | 0.8% | **0.0%** | **the scanner, §3.4** |
| fossil (churn ≤1, ≥median loc) | 2.9% | 1.3% | 9.7%◊ | 1.1%◊ | 0.0%◊ | |
| tainted (unresolved import) | 0.0% | 4.2% | 1.4% | 5.6% | 18.1% | a fact about the resolver |
| churny leaf | 4.4% | 6.8% | 0.5%◊ | 2.1%◊ | 4.8%◊ | |
| co-change without import *(of pairs)* | 85.1% | 76.7% | 44.2%◊ | 80.6%◊ | 81.2%◊ | **the norm** |
| layering violation *(of cross-region edges)* | 3.6% | 1.6% | 17.6% | 15.5% | **0.0%** | |
| shotgun commit *(of commits)* | 56.9% | 8.2% | 1.1%◊ | 7.6%◊ | 11.4%◊ | |

**◊ measured on a shallow clone and therefore not usable.** `src/verbs/commits.ts` refuses the whole
history deck on a shallow clone, and ADR-0018's shallow-clone mechanism poisons churn and the
co-change matrix besides — the boundary commit is recorded as adding the entire worktree. Every
history-derived row on hugo, prometheus and flask is an artifact of the clone. This was not a
hypothetical: re-cloning hono at full depth (2,763 commits) moved its `fossil` cell from **6.5% to
1.3%**, a factor of five, and its co-change row from 52.1% to 76.7%.

**And the ark column was wrong by one node in the first run** — 182 against a true 181 — because the
probe files were sitting in `scripts/` while the probe indexed the repo. Ark indexes itself; a
measurement about it that is taken from the working tree includes the measurement. The `tainted`
cell was `1` for the same reason, and is really `0`. This repo's own landmine, walked into inside the
instrument built to avoid walking into others.

---

## 3. Four rules for measuring a detector, each bought with an error

### 3.1 A phenomenon is a property, not a rank

*"Top 2% by churn"* fires on exactly 2% of every repo ever indexed. It cannot distinguish a repo with
a hotspot from a repo without one, so it measures nothing. Every definition must be satisfiable or
not on its own terms — *"changed three times as often as the typical file"* is a claim about a file.

### 3.2 A threshold must be checked against the **achievable range**, not the distribution

`hotspot` was first ≥10× median churn and read **0.0% on ark and hono**. That reads as a finding and
is an artifact: the bar is 30 where ark's maximum possible churn is 29, and 20 where hono's max is
18. Unreachable by construction.

The same error survived into the shipped table one row up, and a reviewer found it: **`hub` is
unreachable on hugo.** Median source cone there is **140** against a maximum of **152**, so the 10×
bar is 1,400. Hugo's `0.0%` is not "hugo has no hubs".

Its cause is worth more than the correction. Hugo's median cone is 140 *because* its 131-node tangle
puts 131 nodes at a cone of at least 130. **The tangle destroyed the hub detector's denominator** —
so detectors calibrated independently against one distribution are not independent, and a
distribution-relative bar inherits every other phenomenon in the repo.

### 3.3 Count instances, not members

Hugo's `tangle 60.4%` is **131 members of one instance**; the SCC sizes are `[131, 2]`. *"Hugo's
package graph is one giant tangle"* is a true, teachable, transferable sentence. *"60% of hugo's
nodes are tangle"* is the same fact in a unit that makes the norm look like a phenomenon. Set-shaped
entries — tangle, twin, shotgun — must be counted both ways, as ADR-0030 already counts twins.

### 3.4 An absent detector and an absent phenomenon are the same cell

- **`barrel` measures the scanner.** Only `src/indexer/scan.ts` emits `kind: 'reexport'` — `goscan`
  and `pyscan` never do. So flask's `0.0%` is ark's blindness, not flask's architecture, and
  `src/flask/__init__.py` is a textbook barrel the detector cannot see. Hugo's two "barrels" are
  `docs/assets/js/…/index.js`: the stray documentation JavaScript, presented as a cell about a Go
  repo. This is the `UNREAD`-list landmine exactly — a whitelist's silence reading as evidence.
- **`entry` measures test files.** Of ark's 54 zero-dependent nodes, **52** are test, script or bench
  paths; hono 140 of 149; flask 45 of 46. Ark's two real entry points are drowned 26 to 1. This
  repo's own landmine says a file with no dependents *may be an entry point — check the manifest*,
  and a degree test is not that check.

---

## 4. The finding that outlives the decision: **a cycle is an answer key**

Scored as ADR-0021 scores a Ctrl+F guess, in the units §8.2 grades in. The guess is *"tick the
candidates in the same strongly connected component as the subject"* — which is precisely what naming
a cycle on the map, in a reveal or in a note would license.

| | Blast Radius boards | fired | beats band A | exact | **impure** | mean when fired |
|---|---:|---:|---:|---:|---:|---:|
| **hugo** | 156 | 112 | **109** | 77 | **0** | **0.955** |
| **prometheus** | 63 | 12 | **11** | 4 | **0** | 0.878 |
| **hono** | 54 | 12 | **7** | 1 | **0** | 0.688 |
| ark | 40 | 1 | 0 | 0 | 0 | 0.286 |

**`impure = 0` everywhere is the point.** This is not a heuristic that scores well — it is a proof.
Strong connectivity is mutual reachability, so every SCC-mate of the subject *is* a transitive
dependent, and ADR-0008's invariant (`candidates ∩ dependents(subject, ∞) = truth`) then forces every
one of them into the answer key. Precision is 1.000 by construction; only recall bounds the score.
And recall is highest exactly where the phenomenon is most *worth naming* — a tangle member's cone is
approximately the tangle.

**So the entry's teaching value and its leak are the same property.** That is ADR-0030's shape at an
order of magnitude: naming a twin decides 4 of 12 eligible pairs at best 0.923; naming a tangle
decides **109 of hugo's 156 boards**, 70% of that repo's Blast Radius deck, outright.

This binds whatever comes later. **Nothing may name a cycle, draw one, or imply SCC membership
without a gate**, and the gate cannot be per-row: ADR-0020's rule is withhold by class or by board,
because a per-row guard makes the absence say which row it was. Note also which repos are worst —
hugo and prometheus, the Go repos, where package-level cycles are structural. The exposure is largest
where the vocabulary would be most honest.

*Verified twice with different algorithms — Tarjan here, Kosaraju in the review — agreeing on every
component (`hugo [131, 2]`, `hono [17, 6, 2, 2, 2]`, `ark [2]`).*

### 4.1 The other leak-scored rows

`hotspot` → Companion best **0.632**, → Placement **0.476**; `giant` → Placement **0.429**; `hub` →
Blast Radius **0.571**; `orphan` elimination ≤ **0.500**. All under the 0.78 bar. The arithmetic
behind that is worth keeping: striking *k* of ~20 candidates against a 4–6 file key caps F1 near
`2t/(20 − k + t)`, so **a small class cannot fire by elimination** — band A needs k ≥ ~13. Those
entries are leak-safe as labels; their problem is content, not disclosure.

One row is not safe and is not new: listing a subject's **co-change partners** is `candidates ∩
companions(subject) = truth`, i.e. Companion's key, exactly, on every board of every repo, provably
and without measurement. It already sits under four standing withholdings (ADR-0016's wire gate,
ADR-0020 decision 4, the deleted sentence in `blastRadius/reveal.ts`, ADR-0023's withheld class).
The catalogue would have made it a fifth.

---

## 5. Decision: deferred, and the pilot is already decided

The catalogue's entire payoff is **transfer**, and transfer is a claim about human learning that
nothing in this repository can measure. This project has already accepted that discipline once: the
walkable world shipped gated on `docs/experiments/0001`, and that experiment is **still unrun**. A
vocabulary is the same bet at larger scale with no experiment even sketched.

The cost side is not speculative — it is this repo's record. Nearly every class of *sentence* the
product has ever spoken about structure was subsequently withheld, gated or deleted after
leak-scoring: the `coChange` witness, Companion's `structural`, Archaeology's `sibling`, the twin
gate, the wire gate, the deleted reveal sentence — roughly an ADR apiece. The catalogue proposes
dozens of new sentence classes, and the two with the most genuine content are the two worst offenders
measured above.

**And the proposal jumps its own queue.** `README.md`'s Next reads: experiment 0001, region arches,
**ADR-0030's twin surface**, then the catalogue. The twin surface *is* the catalogue's entry #1 —
decided, leak-scored, gated, and unbuilt. Building it first prices the per-entry cost of the whole
vocabulary on its cheapest member, because its decision work is already done.

So: **build the twin surface, and let it price the catalogue.** If one entry costs a small, contained
change, the vocabulary is a real bet. If it costs another ADR and another gate, that is the per-entry
price of thirty more, measured rather than guessed.

**The honest size of the catalogue is also not 30–60.** Of fifteen candidates, after removing the
ones that measure the instrument (`barrel`, `entry`, `tainted`), the norm (`co-change without
import`), an unreachable bar (`hub` as defined), and the answer keys (`tangle`, co-change pairs),
what is left is roughly **five**: orphan, giant, hotspot, small cycle, twin. `README.md` and
`CLAUDE.md` should stop saying ~30–60 from atlas fields as they stand.

---

## 6. What would revive it

- `docs/experiments/0001` runs, or an experiment 0002 is designed that could **detect transfer at
  all** — risk #1's own mitigation row prescribes a playtest against a second repo, not a feature.
- The twin surface ships and its per-entry cost is known.
- A named entry survives a leak score in the units above, on **full clones** of named commits.

---

## Alternatives rejected

**A fifth verb — *"which of these is the hub / the fossil / in a cycle?"*** Rejected on the
three-way alignment check every verb gets: "which is the hub" is answered off the drawn height
channel (ADR-0013 draws log₂(cone) ungated on every node), "which is the giant" off drawn node size,
"which is the fossil" off the inspector, which already prints `commits` and `last seen` for every
node. The one verb-shaped candidate is cycles — direction being the thing the map deliberately
withholds — and §4 is why that one cannot be asked without a gate, since its key is a subset of the
same subject's Blast Radius truth.

**Ship the five safe entries now, gate the rest later.** Refused because it inverts the pilot: it
spends the surface budget on the entries with the least content (`giant` and `hotspot` are already
drawn or printed) while deferring the ones a player would actually learn something from.

**Build it and measure transfer afterwards.** This is the sentence ADR-0009 exists to prevent, one
subsystem over.
