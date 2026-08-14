# ADR-0043 — Tier 2 is unaskable while the map gives away depth 1

- **Status**: accepted (a refusal). **No verb shipped.**
- **Date**: 2026-08-14
- **Bears on**: NORTH-STAR §5 (the curriculum's tier 2, Topology), pillar 3 (*teach coupling, not
  trivia*); ADR-0007 (the pass threshold), ADR-0008 decision 1 (the map shows direct importers),
  ADR-0040 (a progression ascends through each verb's own range), ADR-0042 §4 (the depth-0 refusal)
- **Code shipped by this ADR**: none. `scripts/probe-direction.ts` is the measurement.

---

## 1. The gap this set out to close

`README.md`'s Known gaps has carried this for two milestones:

> **The deck has no tier 1 and no tier 2 content, and that is what the opening still needs.** …the
> four verbs emit tiers 3, 3, 5 and 6, so **Orientation** and **Topology** have no questions at all.

It records the gap and offers no cause, which is why it kept reading as *nobody has got round to it*.
This document is the cause, and it is not that.

The obvious fix is a **Direction** verb — *"which of these does `X` import?"* — NORTH-STAR §5 tier 2's
own headline question, *which way do dependencies point?* It was designed, bounded, and refused.

## 2. It is not a supply problem — the supply is enormous

Blast Radius's truth is the **unbounded transitive** dependent set, so guardrail 4 must walk a
candidate's whole dependency closure and one unresolved import anywhere in it refuses the board
(ADR-0042). A *direct* claim needs only the subject to be clean, and it is sound at depth 0 **because
the claim is at depth 0** — which is precisely the distinction ADR-0042 §4's refusal turned on: that
proposal checked a *transitive* claim *shallowly*, and shipped real dependents into the wrong-answer
column on 30 of nest's 68 unlocked subjects.

Measured before anything was written (`scripts/probe-direction.ts`):

| repo | subjects with ≥1 import | **own imports clean** | blast boards today |
|---|---|---|---|
| typeorm | 3,400 | **3,385** | 58 |
| nest | 1,413 | **1,180** | 120 |
| excalidraw | 555 | **528** | 21 |
| vue-core | 463 | **430** | 7 |

typeorm has **3,385 askable subjects** where the transitive verb has 58. Supply was never the issue.

## 3. The guess the *lines* invite, and the rule that beats it

The map draws import edges as **undirected** lines, so *"tick every candidate with a line to `X`"* is
available to anyone looking at the screen. It takes the whole key (recall 1) plus every candidate
adjacent the **wrong way** — `X`'s own importers. For `t` truth members and `w` such picks:

```
precision = t / (t + w)      recall = 1      F1 = 2t / (2t + w)
```

which falls under ADR-0007's band A exactly when **`w ≥ ⌈0.564·t⌉`**. That is an admission rule
derived from the pass threshold rather than chosen, and it survives: it refuses about half the
buildable boards and still leaves **919 on typeorm, 512 on nest, 191 on excalidraw, 145 on
vue-core**.

Had the story ended here the verb would have shipped.

## 4. What actually kills it: hover answers the question exactly

`src/player/main.ts:502`

```ts
const depthFor = (node: SceneNode): number =>
  tracedRadius.has(node.id) ? FULL_RADIUS : DIRECT_ONLY;
```

`src/player/scene.ts:282`

```ts
export function blastRadius(scene: Scene, ref: NodeRef, maxDepth: number): Radius {
  return { subject: ref, dependents: dependents(scene.graph, ref, maxDepth), maxDepth };
}
```

So hovering a node highlights **the files that import it**. On a Direction board about `X`, hover
each candidate `Y` in turn and tick it when `X` lights up: `X ∈ dependents(Y, 1) ⟺ X imports Y`,
which is the answer key, exactly, by definition rather than by approximation.

**Measured on real generated boards** — not argued from the identity:

| repo | boards | hover guess scores **1.000 exact** |
|---|---|---|
| ark | 25 | **25** |
| hono | 54 | **54** |
| kysely | 75 | **75** |
| graphql-js | 68 | **68** |
| typeorm | 234 | **234** |
| nest | 252 | **252** |
| excalidraw | 98 | **98** |
| prometheus | 63 | **63** |
| **total** | **869** | **869** |

There is no threshold to tune and no distractor mix that helps. Pillar 3 — *violated when a challenge
can be answered by `Ctrl+F` rather than by reasoning about structure* — is violated by construction.

## 5. The general result, and it is bigger than one verb

Hover is not a leak. **ADR-0008 decision 1 gives the depth-1 graph away on purpose**, and says so:

> Depth-1 is not a leak — those edges are already drawn on the canvas. It is also exactly the right
> thing to give away, because §8.4 defines `surprise` against the naive direct-neighbour guess. The
> map hands you the naive baseline for free, and the grade measures precisely what you know beyond
> it.

That is a good decision and this document does not reopen it. But NORTH-STAR §5's tier 2 **is** the
depth-1 graph:

| tier-2 question | expressible as | verdict |
|---|---|---|
| *which way do dependencies point?* | depth-1 edges, directed | **answered by hover** |
| *what's a hub, what's a leaf?* | depth-1 in-degree | **answered by hover**, counting highlights |
| *where's the layering violation?* | cycles / upward edges | not depth-1 — see §7 |

**So two of tier 2's three questions are unaskable while ADR-0008 decision 1 stands, and the third is
a different shape.** The curriculum and the map's most settled decision are in direct conflict, and
the README's gap is the shadow that conflict casts. Nobody had connected them.

## 6. Decision

1. **The Direction verb is refused.** Not on supply, not on the distractor mix, not on a margin —
   on a guess that scores 1.000 on 869 of 869 boards.
2. **Tier 2 is not a backlog item, it is blocked**, and `README.md`'s Known gaps says which decision
   blocks it rather than implying nobody has tried.
3. **Unblocking it is an owner's call**, because every route runs through ADR-0008 decision 1:
   - *gate hover while a board is open* — that ADR explicitly considered and rejected it (it fixes
     nothing at the moment of choosing, and costs §9's *"the world stays visible behind the scrim"*);
   - *show depth-1 only for the subject, not for candidates* — a per-candidate rule, which is
     ADR-0020's withhold-by-row shape and leaks by omission;
   - *accept a tier-2 deck the map answers* — a pillar-3 violation with a number on it.

   None is a session's decision to take.
4. **Tier 1 remains open on different grounds** and is not covered here. Its blocker is recorded and
   unrelated: no entry point is in the atlas, because every TypeScript manifest points into an
   excluded `dist/`, so *where does execution start?* has uncertain ground truth and guardrail 4
   refuses it.

## 7. What would change this

- **The Layering question** (NORTH-STAR §6.2's backlog verb — *"arrange these modules into layers;
  ground truth: import direction, no upward edges"*) is **not** a depth-1 relation and is untouched
  by this measurement. It is also not a set-selection shape and its ground truth is not unique — a
  DAG has many valid layerings — so it needs its own design and its own ADR. **This document does not
  clear it and does not condemn it**; it was not measured.
- **Any change to ADR-0008 decision 1** reopens the whole of §5. If hover ever stops giving away
  depth 1, re-run `scripts/probe-direction.ts` — the supply is still there, and the line-guess
  admission rule in §3 is still the right gate.
- **A tier-2 question over a relation the map does not draw.** Everything in §5's table is the import
  graph, which the map *is*. A tier-2 question about something else — co-change direction, say — is
  not obviously available either, since ADR-0016 already draws co-change ties.

## 8. The lesson, which this repository already had written down

`CLAUDE.md`:

> **A claim about what the *player* can do is not checkable in the verb — go and read the player.**

This probe bounded the question against the **atlas** (supply) and against the **map's lines** (the
undirected guess), and both came back green. The thing that decided it was a hover handler in a file
the probe never opened. The verb was one file in when that was found, which is the whole return on
bounding before building — and the file that found it was `main.ts`, not a measurement.

---

## 9. Route D, measured — 2026-08-14

§6 decision 3 lists three routes to unblocking tier 2 and says every one runs through ADR-0008
decision 1. **There is a fourth, and there is also a second channel this document does not mention.**
Both were found by opening the player rather than by re-reading the ADRs, which is §8's lesson
arriving one level up.

Measured on clean clones of `ark` `9602cc9`, `honojs/hono` `7075369e`, `typeorm/typeorm` `df07bf1e`,
`kysely-org/kysely` `f24018c7` and `graphql/graphql-js` `9c245018`. Reproduce with
`scripts/probe-undirected.ts`, `scripts/probe-surprise.ts` and `scripts/probe-deck.ts`.

### 9.1 The fourth route: hover shows *more* than the argument that licensed it

ADR-0008 decision 1 rests on *"those edges are already drawn on the canvas"*. They are — and
`draw.ts` strokes a plain `moveTo`/`lineTo` with **no arrowhead**. So the canvas draws the edge
**set** undirected while the highlight reveals its **direction**. Making hover undirected is
therefore not an amendment to decision 1; it is bringing the code back to the sentence that licensed
it.

Do that and the hover exploit collapses to the *"tick everything with a line to X"* guess, which §3
already derived an admission rule against: a board of `t` truth and `w` wrong-direction candidates
gives the guess recall 1 and precision `t/(t+w)`, so `F1 = 2t/(2t+w)`, which falls under band A
exactly when **`w ≥ ⌈0.564·t⌉`**.

`w` is a generator's choice, so one number would be a claim about a generator nobody has written.
Two bounds instead — `lean` fills exactly the admission minimum (the guess's best case) and `rich`
fills every wrong-direction candidate available (its worst):

| repo | eligible subjects | boards admitted | undirected guess beats band A | mean F1 | best |
|---|---|---|---|---|---|
| ark | 149 | 50 | **0** / **0** | 0.692 / 0.463 | 0.750 |
| hono | 318 | 127 | **0** / **0** | 0.696 / 0.569 | 0.769 |
| typeorm | 3,385 | 925 | **0** / **0** | 0.686 / 0.592 | 0.769 |
| kysely | 333 | 209 | **0** / **0** | 0.713 / 0.483 | 0.769 |
| graphql-js | 407 | 125 | **0** / **0** | 0.719 / 0.548 | 0.769 |

**0 of 1,436 boards, at either fill.** The best any board reaches is 0.769, which is the admission
rule working exactly as derived rather than a margin anyone chose. So route D closes the hover
channel completely — and typeorm's 3,385 eligible subjects reproduce `probe-direction.ts`'s figure to
the digit, which is the cross-check that says the two instruments are measuring the same population.

### 9.2 And then the inspector reopens it

`ui.ts` prints `imports: N` and `imported by: M` for **every** node, ungated, beside the map. §5's
table says hover answers *"what's a hub, what's a leaf"*; `imported by: 147` answers it as a printed
number with no hover involved.

Worse for route D, one of those two counts partially recovers the direction an undirected hover would
hide. A candidate with **`imported by: 0`** is imported by nothing, so the subject cannot import it
either — an adjacent one is a wrong-direction pick and can be dropped. The refinement can never drop
a truth member (a file the subject imports has in-degree ≥ 1 by construction), so recall stays 1 and
precision only rises:

| repo | boards | undirected guess beats A | **+ the `imported by` count** | mean F1 | best |
|---|---|---|---|---|---|
| ark | 50 | 0 | **26** | 0.800 | 1.000 |
| hono | 127 | 0 | **91** | 0.880 | 1.000 |
| typeorm | 925 | 0 | **589** | 0.854 | 1.000 |
| kysely | 209 | 0 | **8** | 0.718 | 1.000 |
| graphql-js | 125 | 0 | **86** | 0.823 | 1.000 |

**800 of 1,436**, exact on four of five repos. kysely is the outlier at 8 of 209 and the reason is
worth keeping: its importer pools hold few zero-in-degree files, so the elimination rarely has
anything to eliminate.

**The other count is not a lever, and this is an argument rather than a measurement.** Truth
membership means *the subject imports this*, which constrains only the candidate's **in**-degree
(≥ 1). `imports` is the out-degree and can therefore exclude nothing; it can only confirm a candidate
the guess already picks. That closes over both printed fields, so it is bounded — but it is still
reasoning, and this repository's record on impossibility arguments is poor.

So **route D needs the inspector changed too**, and *"amend ADR-0008 decision 1"* was never the whole
of the work.

### 9.3 What it costs Blast Radius: two levers, and they do not add

`surprise` is calibrated against the guess the map hands over — `generate.ts` says so in as many
words — so route D moves it. Recomputed with the undirected baseline:

| repo | blast boards | deck cap | surprise already 1.000 | mean Δsurprise | mean Δdifficulty | rank changes |
|---|---|---|---|---|---|---|
| ark | 40 | 40 (binding) | 4 | +0.275 | +0.137 | **38** of 40 |
| hono | 54 | 54 (binding) | 3 | +0.321 | +0.160 | **52** of 54 |
| typeorm | 58 | 463 | 0 | +0.235 | +0.118 | **54** of 58 |
| kysely | 75 | 75 (binding) | 14 | +0.129 | +0.064 | **73** of 75 |
| graphql-js | 69 | 69 (binding) | 3 | +0.234 | +0.117 | **57** of 69 |

Difficulty rises, which is correct — an undirected highlight is a *worse* free guess, so the gap
between naive and truth is genuinely larger — and the ordering moves almost everywhere.

**The question that matters is whether the served deck changes, and `atlas.json` cannot answer it.**
The first version of that measurement re-ran `retain` over `atlas.challenges`, which is already
`retain`'s output, and printed a cheerful `0 of 40` — a tautology wearing a result. The honest
instrument is the generator run twice with `naive` patched:

```
    for (const edge of graph.out[subject] ?? []) {
      const id = idOfRef(edge.to);
      if (candidateSet.has(id)) naive.push(id);
    }
```

| repo | subjects replaced | of a deck of |
|---|---|---|
| ark | **22** | 40 |
| hono | **33** | 54 |
| typeorm | 2 | 58 |
| kysely | **59** | 75 |
| graphql-js | **31** | 69 |

Deck *size* is identical everywhere — this is a swap of which subjects are asked, not a loss of
supply — but on four of five repos **45–79% of the Blast Radius deck is replaced**.

**And that counterfactual moved two levers while naming one.** `naive` feeds `surpriseOf` *and*
`nonObvious`, which ADR-0012's `dedupe` uses to pick a colliding group's representative. Split:

| repo | both | `surprise` alone | `nonObvious` alone |
|---|---|---|---|
| ark | 22 | 22 | 4 |
| hono | 33 | 33 | 16 |
| typeorm | 2 | **0** | 2 |
| kysely | 59 | 51 | 35 |
| graphql-js | 31 | **33** | 33 |

Two findings in that table. typeorm's entire change is `nonObvious` — its cap does not bind, so
`retain` never consults difficulty, and the swap is ADR-0012's representative moving, which nobody
would have predicted. And on graphql-js the two levers **partially cancel**: 33 apiece, 31 together.
They are not additive, so quoting the combined number as *"the cost of re-scoring difficulty"* would
have been wrong in both directions.

### 9.4 The verdict, which is still the owner's

Route D is buildable and it is **not a rendering change**. It is three things:

1. hover highlights in- and out-neighbours together — small, and arguably a repair rather than an amendment;
2. `imported by` leaves the inspector — without it, 800 of 1,436 boards fall to the counts;
3. most of every cap-limited repo's Blast Radius deck is replaced, through two independent generator
   paths.

(3) is the price. It is not a supply loss and it is not a correctness problem; it is that a player's
learned deck changes wholesale on the next index. ADR-0011 keys progress by `(verb, subject)`, so
passes survive and fog stays lifted — what is lost is the specific questions in flight.

**Nothing here is decided.** §6 decision 3 stands: unblocking tier 2 is an owner's call, and this
section exists so the call is made against measurements rather than against three routes and an
unlisted fourth.
