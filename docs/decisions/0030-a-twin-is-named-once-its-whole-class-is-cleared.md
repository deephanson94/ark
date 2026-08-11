# ADR-0030 — A twin is named once its whole class is cleared, and not before

- **Status**: accepted — **decision only, no surface built.** See Consequences.
- **Date**: 2026-08-10
- **Implements**: `README.md` Known gaps, *"Duplicate-answer-key twins are never mentioned to the
  player"* — open since M2
- **Extends**: [ADR-0012](./0012-an-answer-key-is-issued-once.md) (an answer key is issued once),
  [ADR-0011](./0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md) decision 3
  (a derived fact is *shown*, never proved), [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md)
  (withhold by class or by board, never by row), [ADR-0016](./0016-a-history-wire-is-drawn-only-where-no-board-is-open.md)
  (the shape of a gate on a rendering)
- **Bumps**: nothing.
- **Code shipped**: none. This is a measurement and a decision.

---

## 1. The question, and why it was still open

ADR-0012 makes the generator issue each answer key at most once: a subject whose canonical key is
taken is re-asked with a **disjoint window** of its own dependents, and refused `duplicateKey` when
no distinct window exists. The cause it exists for is `cone(A) = cone(B)` — *"nothing outside the
pair can tell them apart through the import graph"*.

That is a **true derived fact about the repository**, mechanically extracted, and by ADR-0011
decision 3 the player is entitled to it — *shown*, clearly labelled as revealed rather than proved.
Today it is not shown anywhere. It has sat in `README.md`'s Known gaps for four milestones with the
note that it *"needs a decision about where it is shown before any code"*, and nobody had taken the
measurement that would decide it.

It is also, on its own terms, one of the better things this repo has to say. NORTH-STAR §2 sells
co-change as knowing *"which files are secretly one module wearing two hats"*. `cone(A) = cone(B)` is
the **import graph's** version of exactly that sentence, and it is a stronger claim: not *these move
together*, but *nothing downstream can tell these apart*.

---

## 2. Measured first: twins are common, and the brief's hypothesis was wrong

The working assumption going in was *"if it is two on ark and none elsewhere, the honest answer may
be that it does not earn a surface"*. Measured over every repo ark ships a Blast Radius deck for —
equivalence classes of the **full transitive dependent set**, over nodes `canGradeImports` admits:

| repo | subjects with a cone | twin classes | nodes in one | share | largest class |
|---|---|---|---|---|---|
| ark `4dd6db7` | 71 | 5 | 11 | **15.5%** | 3 |
| hono `7075369e` | 217 | 8 | 33 | **15.2%** | 10 |
| hugo `44da08608` | 197 | 6 | 17 | 8.6% | 6 |
| prometheus `5542b00b9` | 288 | 22 | **93** | **32.3%** | **25** |
| cobra `adbc881` | 1 | 0 | 0 | — | — |
| flask, django, sdp | 0 / 2 / 0 | — | — | — | Python never grades (ADR-0028) |

**Nearly a third of prometheus's blast-eligible subjects share a cone with something else**, and its
largest class is 25 packages — every `discovery/*` provider, which are interchangeable to the import
graph by construction because they are plugins behind one registry. That is a real architectural fact
about prometheus and a player would want it.

The classes are not uniformly interesting, and the shape is worth recording because it decides what a
sentence can honestly say:

| | ark | hono | prometheus | hugo |
|---|---|---|---|---|
| classes whose cone is **1 node** | 0 | 5 | 3 | 2 |
| classes whose cone is 2–3 | 0 | 2 | 7 | 2 |
| classes whose cone is **4+** | 5 | 1 | 12 | 2 |

A cone of one is *"these ten benchmark files are all imported by the same single file"* — hono's five
such classes are `benchmarks/routers/src/*`. True, and thin. ark's five classes are all cone-4+, and
the largest is the interesting kind: `src/atlas/{coverage,serialize,graph}.ts`, cone **95**, which is
95 of the repo's 160 nodes reaching all three identically — because all three are re-exported through
one barrel.

**Most twins are never mentioned even implicitly**, which is the cost of the current silence: 4 of
ark's 11 members carry no board, 30 of hono's 33, 83 of prometheus's 93, 11 of hugo's 17.

---

## 3. Naming a twin is a Ctrl-F-grade leak, and the direction is not the obvious one

The obvious worry is the answer key: tell the player `cone(A) = cone(B)` and A's key hands over B's.
**That one is impossible, by ADR-0012's own construction**, and it is proved rather than measured:
windows *tile*, so `truth(A) ∩ truth(B) = ∅`; and ADR-0008's invariant is
`candidates ∩ dependents(subject, ∞) = truth`, so any dependent of B that is not in `truth(B)` is not
on B's board at all. Together, `truth(A) ∩ candidates(B) = ∅`. Measured across every twin pair on
four repos: **0 overlaps**, which is the gate saying the proof describes the code.

The leak runs the **other** way, through the wrong answers. A passed board certifies its distractors
as **non**-dependents of A, hence of B. So on B's board the player can strike out every candidate
that was a distractor on A's. Scored with `scoreSet` — the metric the player is graded by, per
ADR-0021 — where the guess is *"tick everything A did not rule out"*:

| repo | twin pairs where both have boards | mean candidates eliminated (of 20) | **pairs beating band A** | best |
|---|---|---|---|---|
| ark | 4 | 7.5 | **0** | 0.667 |
| hono | 0 | — | 0 | — |
| hugo | 2 | 13.0 | **2 of 2** | **0.923** |
| prometheus | 6 | 10.0 | **2 of 6** | 0.800 |

**Four boards across two repos are decided outright**, and the mechanism is elimination rather than
recall — which is why the obvious check (does A's key appear in B's?) reads clean while the board is
being handed over. This is ADR-0021's framework applied to a disclosure that has no verb: the guess
needs no graph, only two boards and one sentence.

---

## Decision

1. **A twin class may be named only when no member of it still carries an unanswered Blast Radius
   board.** The unit is the **class**, not the pair and not the row — ADR-0020's rule, and here it is
   load-bearing rather than stylistic: a per-row guard would make the *absence* of a twin line say
   *"this one's sibling still has a board open"*, which is the fact being withheld.
2. **The gate is on the boards, not on the fog.** *Answered* rather than *passed*: what the leak
   needs is A's **reveal**, which a player sees whatever they scored, and ark never punishes a wrong
   answer (guardrail 6). Gating on a passing score would leave the leak open to anyone who answered
   badly and read the reveal.
3. **The sentence is a shown fact and says so.** ADR-0011 decision 3: it is not *"you proved"*, it is
   the revealed register — *"nothing in this repository can tell these apart: 95 places reach all
   three of them, by the same paths."* The count is the class's cone size, which is the whole content
   of the claim.
4. **It is drawn where the player is already looking at one of them** — the inspector, beside the
   node's other derived facts — and **not on the map**. `ties.ts`'s own comment is the reason: *"a
   wired answer is the map's `Ctrl+F`"*, and a permanent twin-edge is a lookup where a line in a
   panel is a memory test (ADR-0016's distinction, and the exposure ADR-0022 had to close upstream
   because a rendering gate could not).
5. **A class whose cone is a single node is named anyway.** It is thin — *"these ten are all imported
   by the same one file"* — and it is true, and a rule that suppressed it would need a threshold
   nothing measures. The count in the sentence is what tells a reader how much it is worth.

---

## Alternatives rejected

**Show it with no gate at all.** Refused on §3: 4 of the 12 twin pairs that could carry it are
decided outright, one at 0.923 against a 0.78 bar.

**Gate per pair — hide the twin whose board is still open, show the rest.** This is the tempting
cheap version and it is exactly ADR-0020's forbidden shape. A class of three showing two names says
*"the third one has a board waiting"*, which is a stronger hint than the sentence it replaced,
because it points at a specific node.

**Name twins only where the twin was refused `duplicateKey`** — i.e. where there is provably no key
to leak. Also per-row, with the same absence-speaks failure, and it inverts the value: those are
precisely the members the player will never be asked about, so the fact would be shown exactly where
it teaches least about the deck ahead.

**Draw a twin edge on the map.** Refused by decision 4. It is also the shape ADR-0016's *vanishing
wires* defect came from — a rendering that appears and withdraws as boards open and close — and a
twin relation is static, so it would either be permanently drawn (a lookup) or flicker.

**Put it in the field notes.** Notes claim what was **proved** (ADR-0011), and this is shown. The
revealed register exists there, but a note is keyed to a subject and this fact is about a *set*; it
would have to be written N times or arbitrarily attached to one member.

**Compute it in the indexer and carry it in the atlas.** A `twins: NodeId[][]` array would be a
second encoding of something derivable from `edges`, which ADR-0025's alternatives section refuses on
exactly this ground. The player already has the graph; the classes are one sweep of `dependents`.
Worth revisiting only if that sweep is measured too slow on a large repo — django's 3,035 nodes at a
mean closure of 165 is the case to measure against.

---

## Built — 2026-08-11

**The surface exists**, at `3cda64a`+: `src/player/twins.ts` computes the classes from the graph at
load (no atlas field — the alternatives section refuses that), `nameableClass` applies the gate, and
the inspector draws one line in the *revealed* register. It renders, verified in a browser:

> **INDISTINGUISHABLE** nothing in this repository can tell this apart from `reveal.ts`: 47 places
> reach both of them, by the same paths.

**Both halves of the gate are checked end to end**, because either alone passes against a broken
surface: on a fresh save `src/verbs/companion/reveal.ts` says nothing while its class carries a
board, and with every Blast Radius board answered the line appears. Three mutants die — gating per
row instead of per class, dropping the gate, and treating empty cones as shared.

**The consequences table below has drifted, as it must.** Re-measured at `3cda64a`: ark has **8
classes / 20 members**, of which **1 class is nameable at load** and 8 once the deck is cleared —
against the 5 classes / 0 nameable recorded when this ADR was written. So the sentence *"on ark it
arrives late — every one of its five classes carries a board"* is **no longer true**: one arrives
immediately. ark indexes itself; a figure about it is checkable only against the commit it was taken
at, and the invariant is the one that survives — *the fact arrives as boards are answered, and
nothing is promised and then taken away.*

The first version of the browser check was a **dead-path landmine wearing a test's clothes**: it
looked only at the fresh save, found that neither of the two nameable members fell under a 40×26
grid, printed *"skipping the render check"*, and went green. A liveness gate that reports its own
absence and passes is not a gate.

---

## Consequences

- ~~**This ADR ships no surface, and that is stated rather than implied.**~~ **Built, see above.**
  The clause is kept because the reason it was written still binds: *a decision is not a delivery*,
  and this document carried "decided, unbuilt" for four milestones before anyone built it.
- **This ADR ships no surface, and that is stated rather than implied.** *A decision is not a
  delivery* — `CLAUDE.md` has a landmine about a milestone that read "delivered" for two sessions
  while one of its three verbs existed, and this document must not become the next instance. What is
  decided is where, under what gate, and in what register; what is unbuilt is the inspector line, the
  gate's wiring to the deck, and its tests. `README.md`'s Known-gaps row stays, with its wording
  changed from *"needs a decision"* to *"decided, unbuilt"*.
- **What the gate leaves is measured, not assumed**, because ADR-0016's failure was a payoff that
  appeared and then withdrew:

  | repo | twin classes | nameable **immediately** (no member has a board) | nameable after clearing the class |
  |---|---|---|---|
  | ark | 5 | 0 members | 11 |
  | hono | 8 | 24 of 33 | 33 |
  | prometheus | 22 | 51 of 93 | 93 |
  | hugo | 6 | 2 of 17 | 17 |

  The direction is the opposite of ADR-0016's: nothing is promised and then taken away — the fact
  **arrives** as boards are answered. On ark it arrives late (every one of its five classes carries a
  board), and on prometheus most of it is there from the first frame.
- **The measurement retires the hypothesis the gap was written under.** *"Two on ark and none
  elsewhere"* would have justified closing the row as not worth a surface; it is 15.5%, 15.2%, 8.6%
  and **32.3%** of blast-eligible subjects on the four repos that have a deck.
- **`cone(A) = cone(B)` is computed over the full transitive dependent set**, not over the sampled
  key. Two subjects can share a *key* and differ in cone (ADR-0012 calls that cause B, and svelte had
  6 such groups); that is a sampling artifact and is not this fact.

---

## What would change this

- **A repo where the gate is vacuous** — every twin class carrying an unanswered board forever, so
  the line never appears. ark is the nearest to that and its classes do clear.
- **A cheaper certain gate.** The one refused above is per-pair; a *by-board* gate in ADR-0021's
  sense (suppress the line only while the reader's own board is open) was not scored, because the
  leak is between two boards rather than inside one, and scoring it needs the pair.
- **Python, or any future language whose imports are mapped and never graded.** Its nodes have no
  boards at all, so every twin class in it is nameable immediately — which is correct and worth
  checking rather than assuming, since django's one class is two JavaScript test fixtures rather than
  anything Python.
