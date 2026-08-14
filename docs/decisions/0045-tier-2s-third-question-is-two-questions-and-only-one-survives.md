# ADR-0045 — Tier 2's third question is two questions, and only one survives

**Status**: proposed · nothing built · 2026-08-14
**Follows**: [ADR-0043](./0043-tier-2-is-unaskable-while-the-map-gives-away-depth-1.md) §7, which left this
question open in as many words — *"this document does not clear it and does not condemn it; it was
not measured."*
**Bears on**: [ADR-0034](./0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md) §4,
[ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) decision 1,
NORTH-STAR §5 tier 2 and §6.2's Layering backlog verb.

**Measured on** clean clones of `ark` `f5a77bd`, `honojs/hono` `7075369e`, `kysely-org/kysely`
`f24018c7`, `graphql/graphql-js` `9c245018`, `typeorm/typeorm` `df07bf1e`, `gohugoio/hugo` `44da0860`,
`prometheus/prometheus`, `django/django` `c9eb16a87e`. Reproduce with `scripts/probe-layering.ts` and
`scripts/probe-upstream.ts`. **No `src/` change.**

---

## 1. Why this was measured at all

ADR-0043 refused a Direction verb and found that **two of tier 2's three questions are the depth-1
graph**, which ADR-0008 decision 1 gives away on purpose. The third — *"where's the layering
violation?"* — is not a depth-1 relation, so hover and the inspector do not touch it, and it was the
one route to tier-2 content that costs the map nothing.

NORTH-STAR §6.2's Layering verb is *"arrange these modules into layers"*, which ADR-0043 §7 objects
to twice: not a set-selection shape, and a DAG has many valid layerings so the ground truth is not
unique. **Both objections are about assigning layer *numbers*.** Reachability itself is unique, and
two reformulations inherit that:

- **`cycle`** — *"which of these are in a dependency cycle with `X`?"* Truth is `X`'s strongly
  connected component. A cycle is the canonical layering violation and mutual reachability is unique.
- **`upstream`** — *"which of these does `X` depend on, directly or through a chain?"* Truth is `X`'s
  transitive **dependencies**: Blast Radius's relation read along its other axis, which is exactly the
  confusion NORTH-STAR §8.3 strategy 1 calls *"a real tier-2 mistake"*.

## 2. `cycle` is refused, on three grounds

**Ground 1 — it teaches an answer key.** ADR-0034 §4 proved that every SCC-mate of a subject is a
transitive dependent, so ADR-0008's invariant forces every one of them into that subject's Blast
Radius key. Re-derived here with an independent Tarjan pass: **1,326 of 1,326** cycle subjects across
eight repos have their whole component inside their own cone. A verb whose entire content is naming
the component therefore teaches the guess ADR-0034 scored:

| repo | "tick the component" fires | beats band A | of a deck of |
|---|---|---|---|
| hugo | 114 | **111** | 156 |
| kysely | 22 | **21** | 75 |
| prometheus | 7 | 5 | 63 |
| graphql-js | 7 | 1 | 69 |
| hono | 9 | 0 | 54 |
| ark | 2 | 0 | 40 |

ADR-0034 reported hugo as 109 of 112 fired at a different index of that repo; this reads 111 of 114.
Two boards apart on a moved tree, which is agreement rather than drift — the mechanism is a proof,
not a heuristic, so only the deck can move.

ADR-0034 decision: ***"nothing may name a cycle, draw one, or imply SCC membership without a gate."***
A cycle verb is that, as its whole purpose.

**Ground 2 — the only available gate inverts the curriculum it exists to serve.** ADR-0020 allows a
gate by class or by board, never by row, so the shape is ADR-0030's: serve a cycle board only when no
member of its component still carries an unanswered Blast Radius board. Priced — boards open at the
*start* of a session, before anything is answered:

| repo | cycle subjects | open at start |
|---|---|---|
| ark | 2 | **0** |
| hugo | 133 | **0** |
| hono | 29 | 4 |
| kysely | 84 | 4 |
| graphql-js | 24 | 6 |
| prometheus | 49 | 24 |
| typeorm | 757 | 755 |

**Zero on the bootstrap repo and zero on hugo.** A tier-2 question that can only be asked after the
tier-3 deck is cleared is not tier-2 content; NORTH-STAR §5 orders these tiers deliberately, and this
gate reverses the order for the two repos where the phenomenon is most real. (typeorm's 755 is not a
reprieve: its Blast Radius deck is 58 boards of 2,248 subjects, so almost nothing is gated because
almost nothing carries a board.)

**Ground 3 — the bootstrap repo has two subjects.** ark's only non-trivial component is `[2]`. Under
NORTH-STAR §11 ark is the v1 target and pillar 6's forcing function; a verb that ships it two boards
with a key of size one is not a verb this project can develop against.

**One thing the measurement refuted, and it was my own claim.** `probe-layering.ts`'s first header
said the containment means a Blast Radius reveal *"states the cycle key entirely"*. It does not: the
cone is not the key, because ADR-0008 samples truth to a cap of 6. Measured against the **shipped**
reveals it is **3% on hugo, 7% on kysely, 12% on graphql-js, 33% on hono** — the 100%s are on the two
repos with two subjects each. Set containment was the ceiling and the shipped figure is far below it.
The refusal above does not rest on that direction and never needed to.

## 3. `upstream` survives, and its supply argument is structural

**ADR-0003's taint walks the *outgoing* side of every candidate**, which is why Blast Radius costs
`rate × mean closure` and why typeorm ships 58 boards of 2,248 subjects (ADR-0042). Mirror the
relation and the cost mirrors with it: a distractor here must be certified *not reachable from `X`*,
which is a fact about **`X`'s own closure**, not about the candidate's. One closure per board instead
of twenty.

| repo | nodes | closure clean | `upstream` boards | Blast Radius boards |
|---|---|---|---|---|
| ark | 226 | 149 of 149 | **149** | 40 |
| hono | 425 | 309 of 325 | **309** | 54 |
| kysely | 600 | 328 of 408 | **328** | 75 |
| graphql-js | 549 | 404 of 408 | **404** | 69 |
| typeorm | 3,704 | 171 of 3,400 | **171** | 58 |

**Three to seven times Blast Radius's supply on four repos, and three times on typeorm** — the
taint-limited one, where the same 12,000-site closure problem still bites but bites once per board
rather than twenty times.

### 3.1 What it gives away, measured

**Depth-1 hover.** Hovering a candidate `Y` lights `Y`'s importers; if the subject is among them, `X`
imports `Y` and `Y` is in the key. That is Blast Radius's own situation mirrored and survivable for
the same reason — the depth-1 slice is what decision 1 hands over on purpose. It beats band A on
**33 of ark's 149, 57 of hono's 309, 20 of kysely's 328, 67 of graphql-js's 404** — 6–22%, gateable
by scoring the guess per board, exactly as ADR-0021 scores a Ctrl+F heuristic.

**typeorm is the warning: 150 of 171, mean 0.911.** The reason is systematic and worth stating,
because it is a trap any future verb with a closure gate will meet: **guardrail 4 selects for shallow
closures**, and a shallow closure is precisely the one whose key is all direct dependencies. The
safety rule and the leak are correlated by construction. Gated, typeorm keeps 21 boards against its
58 Blast Radius ones — the one repo where this verb would be *worse* supplied than the verb it
extends.

**Full-radius hover, and this one is new in shape.** An `understood` node renders its **whole**
radius, not depth 1. Hovering an understood candidate `Y` shows `dependents(Y, ∞)`, and `X ∈
dependents(Y, ∞)` ⟺ `X` transitively imports `Y` ⟺ **`Y` is in this key, at any depth**. Precision is
1.000 by construction — no distractor is reachable from `X`, so none ever lights — so the guess scores
`2r/(1+r)` for `r` the share of the key that could ever be understood, and beats band A exactly when
`r ≥ 0.639`:

| repo | boards | end-game guess beats A | mean |
|---|---|---|---|
| ark | 149 | **81** | 0.652 |
| hono | 309 | **182** | 0.652 |
| typeorm | 171 | **104** | 0.644 |
| kysely | 328 | 81 | 0.325 |
| graphql-js | 404 | 15 | 0.347 |

**Blast Radius is untouched by the same move** — its key is `dependents(X)`, and an understood
candidate's radius answers the reverse relation — so this exposure belongs to this verb and not to
the one already shipped. And the shape is the opposite of every gate in this repository: it **grows
as the player progresses**, where ADR-0030's twin gate opens as they progress. It is still closable
statically, because `tracedRadius` holds subjects and a generator knows which nodes carry boards:
refuse a board whose key is ≥ 0.639 blast-subjects.

**Disclosure by the existing deck** is mild: *"X depends on Y"* and *"Y is depended on by X"* are one
fact, so every shipped Blast Radius reveal naming `X` in a board about `Y` states an atom here —
**1.7% (kysely), 3.3% (graphql-js), 6.3% (hono), 9.5% (ark)**, against ADR-0019 §7's 55.6% for the
Placement/Archaeology pair. typeorm reads 36.0% of a 342-atom denominator.

### 3.2 What it buys: coverage, which is the Companion argument

`progress.ts` promotes a node only as a passed subject or as a correctly picked key member, so a node
in neither position is permanently fogged whatever the player does.

| repo | fogged by the whole four-verb deck | still fogged with `upstream` |
|---|---|---|
| ark | 60 | **28** |
| hono | 149 | **65** |
| graphql-js | 201 | **83** |
| kysely | 248 | **166** |
| typeorm | 2,563 | 2,494 |

**It roughly halves the permanently-fogged set on four of five repos.** That is the property that
made Companion worth building — reaching files the existing deck structurally cannot — rather than a
fifth question about the same files.

## 4. What is proposed, and what is honestly still unknown

**Proposed**: refuse `cycle` permanently, on §2. Build `upstream` behind two static gates — the
per-board depth-1 score and the `r ≥ 0.639` end-game bound — if the owner wants tier-2-adjacent
content at this price.

**Three things this does not claim.**

1. **`upstream` is not one of tier 2's three questions.** It is a fourth, and it grades the tier-2
   *skill* (imports versus imported-by) rather than answering *"which way do dependencies point"*,
   *"what is a hub"* or *"where is the layering violation"*. Those three remain exactly as ADR-0043
   left them: two blocked by decision 1, one refused here. **This does not close the tier-2 gap; it
   routes around it.**
2. **It is the same mechanic as Blast Radius.** Set selection over transitive reachability, in the
   other direction. Whether reversing the arrow teaches anything the forward question does not is
   unmeasured and is the sort of claim `docs/experiments/0001` exists to settle.
3. **The two gates' combined cost is not measured.** They are scored independently above and their
   overlap is unknown, so *"149 boards minus 33 minus 81"* is not a number anyone should quote. The
   residual deck is the first thing to measure if this is built, and typeorm's is small enough that
   it may not survive at all.
