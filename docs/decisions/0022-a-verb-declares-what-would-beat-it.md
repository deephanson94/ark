# ADR-0022 — A verb declares what would beat it

- **Date**: 2026-08-09
- **Status**: accepted, and built.
- **Extends**: [ADR-0016](./0016-a-history-wire-is-drawn-only-where-no-board-is-open.md) (the wire
  gate, whose scope this re-measures at its own invitation) and
  [ADR-0019](./0019-archaeology-asks-a-place-what-happened-to-it.md) decision 7 (a fact an earlier
  reveal states is not an answer — this is the same mechanism for a *verdict*). Closes the exposure
  [ADR-0021](./0021-a-gate-heuristic-is-a-guess-that-needs-no-graph.md) accepted and its post-ship
  review refuted.
- **Bumps**: nothing. No schema change, no `ATLAS_VERSION` move, no migration — the verdict never
  reaches the atlas.
- **Measured on**: clean clones of ark at **`3cc69ea`** and of `honojs/hono` at **`cf78528`**.

---

## The exposure, and why it is not where it looked

ADR-0021 accepted a measured leak on the argument that running the guess *"needs a relation the
player has to have learned"*. Its post-ship review refuted that from the player's own code:
`main.ts` builds `openBoards` from challenges whose channel is `coChangeTies` **only**, so an open
**Placement** board suppresses no wire, and `ties.ts` draws every pair an answered Companion reveal
named — over a map §9 keeps visible behind the challenge scrim. Measured through **only the wires a
player can see**, the guess beats band A on **3 of ark's 40 Placement boards** (0 of hono's, whose
subjects carry no Companion board). `ties.ts`'s own comment names the state exactly: *"a wired answer
is the map's `Ctrl+F`."*

**ADR-0016 did not diverge from its own rule, and ADR-0021 said it did.** That claim is withdrawn.
ADR-0016 scoped the gate to Companion boards deliberately, measured the *Blast Radius* case
(*"12 of 40 blast boards have a candidate wired to their subject … 41% are blast truth against a 27%
base rate"*), concluded that widening it *"would delete a teaching signal rather than close a leak"*,
and closed with an instruction: **"Re-measure if a repo's two decks overlap much more than this
one's."** Placement did not exist then. The gap is a decision correctly scoped to the verbs of its
day and never re-run when a third verb with node candidates shipped — which is what this document is,
rather than a repair of a rule-versus-code divergence.

## Decision 1 — the wire gate is **not** widened, and the measurement is why

The obvious fix is to put Placement's candidates into `openBoards`. Both shapes were built and
measured, at the state that maximises the layer (every Companion board answered) as *k* of the
Placement deck is answered:

| Placement boards answered | wires today | **A**: either endpoint a candidate | **B**: both endpoints on one board |
|---|---|---|---|
| 0 of 40 | 175 | **1** | 21 |
| 20 of 40 | 175 | 1 | 36 |
| 30 of 40 | 175 | 6 | 63 |
| 40 of 40 | 175 | 175 | 175 |

*(hono, same states: 204 → **13** / 101 at k=0.)*

- **A closes the leak completely — 3 boards beaten → 0, best score 0.000 — and deletes the layer.**
  Placement's candidates cover **74% of this repo's nodes** and 57% of hono's, so nearly every wire
  has a shielded endpoint. The history layer would be empty until the tier-6 deck is cleared, which
  is the whole of ADR-0016's payoff withheld from the verb it exists to serve, and the selector
  serves Companion *first*. A reward that never arrives is worse than one that arrives late.
- **B keeps the layer and does not close the leak.** Best 0.750 against a 0.78 bar — under it, but by
  coincidence rather than by construction, because the decisive wire runs from the *off-board* seed
  to a candidate and B only suppresses pairs with both ends on the board. A gate whose correctness is
  a coincidence on two repos is not a gate.

So the lever is wrong. **The exposure is not a rendering problem; it is a disclosure problem**, and
ADR-0021 decision 4 had already designed the instrument for it and declined to build it.

## Decision 2 — `Verb.decidedBy`: the verdict, not the deck

`Verb.discloses(challenge)` says *what my reveal states*. The new method says *what would beat me*:

```ts
decidedBy(graph: Graph, challenge: C): Iterable<DisclosedFact>;
```

Placement scores the co-change guess against its own answer key — every seed wired to one of its
candidates, using `scoreSet` and `CTRL_F_THRESHOLD`, so a change to §8.2's bands moves this with them
— and declares `decidedFact(commit, seed, 'coChange')` for each one that reaches band A. Archaeology,
which generates later, **does not offer that commit at all** on that subject's board.

Three properties make this affordable where the wire gate was not:

- **It is a bit, not a deck.** The fact is one verdict per (board, seed); nothing about the answer key
  crosses. **36 verdicts** on this repo, 22 on hono — against 800 candidate slots a deck would carry.
- **It takes the graph, which `discloses` could not.** ADR-0020 recorded that limit and worked around
  it; a verdict has to be scored against the repo's own relations, so the signature meets it head on.
- **It runs in the direction that already works.** Placement generates before Archaeology
  (ADR-0019 decision 7), so the verdict exists before the verb that needs it. Neither names the other;
  `build.ts` decides who runs first, exactly as for `touchedFact`.

**Required rather than optional**, for `discloses`'s reason verbatim: an optional member is one a verb
author never notices. Three verbs answer `decidedByNothing()` and it is a measured answer — Blast
Radius's and Companion's candidates are files, and a relation between files is *their own question*
rather than a shortcut past it; Archaeology's candidates are commits, over which no verb states a
relation.

## Decision 3 — the commit is off the board, not the sentence withheld

ADR-0021's sketch withheld the witness class. This removes the **candidate**, which is ADR-0019
decision 7's shape and strictly better:

- The witness *and* `whyNot`'s partner arm both state the hint, so withholding would have to silence
  two surfaces to close one chain.
- **A candidate never offered cannot signal anything by its absence**, where a class withheld from
  some rows makes the silence say which class they were — ADR-0020 decision 3, avoided rather than
  worked around.
- The pool filter cannot touch the answer key: `truth` is sampled from `usable`, and only the
  *distractor* pool is filtered, so the invariant `candidates ∩ touchedBy(subject) = truth` is
  untouched.

## What it cost, and what it fires

| | ark @ `3cc69ea` | hono @ `cf78528` |
|---|---|---|
| verdicts declared | **36**, over 16 of 40 Placement boards | **22**, over 15 of 54 |
| Placement deck | 40 → 40 | 54 → 54 |
| Archaeology deck | 33 → **36** | 54 → 54 |
| Placement boards a co-change hint decides | 3 → **0** | 0 → 0 |
| best score any hint still reaches | 0.857 → **0.750** | 0.667 → 0.667 |

The Archaeology deck *grew*: removing decidable commits from distractor pools changed which boards
collide on `duplicateKey`. Nothing was paid for this.

**The residual is bounded by the threshold, by construction.** The best surviving guess reads 0.750
because everything at or above 0.78 is excluded by definition — the same reason a gated deck's best
`ctrlF` score is always just under the bar. That is the difference between this and variant B, whose
identical-looking 0.750 was a coincidence.

## Found while building it

**The e2e picked its board by predicting what the shell would serve, four hundred lines from where
that was already fixed.** `atlas.challenges.find(subject matches)` is **id** order — `archaeology-`
sorts before `blast-` and `companion-` — while the console serves a node's bucket in **tier** order.
It passed while the first-by-id board happened to be the served one, and went red the moment a
subject gained an Archaeology board: `find` returned a board whose truth is *commits*, no choice
matched, and the submit button never enabled. The witness step below it already reads the choice set
off the screen and matches the board whose candidates those are — CLAUDE.md's `.first()` landmine,
fixed once and left standing one step over. It now uses the same pattern.

## Rejected alternatives

**Widening `openBoards` to every open board's candidates (variant A).** Closes it; 175 wires → 1.
See decision 1.

**Suppressing only pairs with both ends on one board (variant B).** Keeps the layer; does not close
the leak. 0.750 by coincidence.

**Withholding the `companion` witness class.** ADR-0021's sketch. Two surfaces to silence, and
449 of this repo's 540 wrong-answer rows fall through to the generic sentence — 83% of the reveal's
content to close 3 boards.

**Transient gating — suppress wires only while a board is on screen.** ADR-0016 decision 3 rejected a
transient layer for the payoff-that-withdraws reason, and it is defeated by closing the panel.

**Declaring all three relations.** The subtree and import-neighbour guesses were measured at **zero**
boards decided on both repos (ADR-0021). Declaring them would ship a path that never fires. The
relation token is in the key so the first one that fires is a token and not a format change.

## What this does not decide

- **Whether the wire gate should know about open boards at all.** It still does not, and ADR-0016's
  Blast Radius measurement still stands. If a repo's Placement and Companion decks overlap much more
  than these two, the table in decision 1 is the one to re-run — that instruction is now inherited
  twice.
- **Whether Placement wants a co-change distractor strategy.** It would lower the guess's precision at
  the source rather than gating it, and §8.3 calls that class the best wrong answers. Still backlog.
- **Whether `decidedBy` should be scored for guesses a *later* verb has not been written yet.** It
  cannot be: a verdict is only declarable against relations that exist. A fifth verb naming a fourth
  relation gets no verdict and leaks silently until someone adds the token — the anticipation cost
  ADR-0021 named, unchanged and still real.
