# ADR-0035 — The board explains itself to an answer that discriminated

- **Status**: **accepted and built.**
- **Date**: 2026-08-11
- **Decided by**: the owner, from three options put with their costs.
- **Bears on**: NORTH-STAR §9 (field notes claim only what was proved), guardrail 6
  (*never punish a wrong answer*), [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)
  decision 1 (the map unlock), [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md)
  (withhold by class or by board, never by row)

---

## 1. The exploit

A cold playtester found it in two clicks and reported it as the defect that
falsifies the product's central claim:

1. Tick **every** candidate. Submit.
2. Score ~10%. Guardrail 6 means that costs nothing.
3. The reveal names the whole truth set, with per-member evidence — and on a
   Blast Radius board `unlocks: 'importRadius'` draws the entire cone on the map.
4. Reopen the board. Tick what it just named.
5. **`S · 100% · exact`, a pass, and a field note.**

NORTH-STAR §9 calls field notes *"facts you have proven you know, not facts you
were shown"* and says **that distinction is the whole product**. Every proof of
understanding in the deck was obtainable without understanding anything.

The *score* exploit was already closed — `isGameable` refuses to ship a board
select-all can pass. The *reveal* exploit was not, and nothing had looked at it.

## 2. Decision

**Below a precision bar, the reveal names no candidate at all**, states the
counts, and does not unlock the map. `src/verbs/withhold.ts`, applied once where
the reveal is created so the panel and the map are handed the same object.

The bar is **0.5**, and `precision < 0.5` is *exactly* the sentence the player
reads: **more of your picks were wrong than right**. The prose is the condition
rather than a gloss on it, which is this repo's class-label landmine designed out
rather than guarded against.

## 3. Why precision, and why 0.5

**Precision is the question *did you discriminate*.** The two cases separate:

- **Select-all cannot reach the bar, structurally.** ADR-0007's choice set is
  three-to-one, so select-all's precision is `|truth| / |candidates| ≈ 1/3`.
  Measured over **792 boards on `graphql-js`, `kysely` and `hono`: median 0.30,
  maximum 0.308, and not one board above 0.4.** The bar sits at **1.6× the
  measured worst case**, which is a margin rather than the knife edge ADR-0021
  got caught by.
- **Picking few and getting them all right is precision 1.0.** The honest
  near-miss — *"you found 2 of 6; here are the other four and why"* — is
  untouched, and it is **not farmable**, because reaching precision 1.0 means
  already knowing which ones were right.

Recall is the wrong knob and it is worth saying why: select-all has recall
**1.0**, the maximum. Any rule keyed on recall rewards the exploit.

## 4. What the first draft got wrong, and the unit test caught

The obvious rule is *withhold the answers the player did not pick*. **It closes
nothing.** Under select-all there are no unpicked answers — every truth member is
a `correct` note, because the player picked it along with everything else — so
the filter matched zero rows and the reveal named the key exactly as before. The
first run of `withhold.test.ts` failed on it.

The second draft kept the `spurious` rows as a mitigation, and fails one step
later: on a swept board the wrong answers are the complement of the right ones
*within the picks*, so *"these fourteen are wrong"* is *"those six are right"*.
**The partition is the answer, and any part of it identifies the rest.**

Hence: no per-member row at all, below the bar.

## 4.1 A narrower rule does not survive the arithmetic

The obvious refinement is to keep the `spurious` rows when the picks did not
cover the board: *"you picked one wrong file of twenty, here is why it was
offered"* leaks nothing about the six answers hiding among the other nineteen,
and it would keep [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md)'s
negative witness alive for the commonest honest mistake. It does not work:

- `picks = correct ∪ spurious`, so naming the spurious rows names the correct ones
  **by complement**. Nothing can be hidden inside the picks.
- Knowing which of your picks were right is enough to **pass next time** whenever
  `f1(1, recall) ≥ 0.5`, i.e. **recall ≥ 1/3**: pick six, get two of a six-file
  key, learn which two, reopen with those two alone and score exactly the
  threshold. Recall ≥ 1/3 is not an edge case.

The safe band is therefore `recall < 1/3` **and** precision below the bar, which
is narrow, and buying it costs a second rule — and every leak in ADR-0014 was a
rule that lived twice.

**The cost: ADR-0020's negative witness now speaks only to answers above the
bar.** That is a real narrowing of a shipped feature, and it surfaced because the
e2e's witness step went red — it had been picking a single wrong answer, which is
precision 0, so it measured the new rule instead of the witness. It answers
precisely now (every answer plus one mistake, precision `k/(k+1)`).

## 5. The map unlock moves with the words, and that is one change

`unlocks: 'importRadius'` draws the subject's whole cone, which is a *superset*
of the answer key. **Withholding the words while drawing the picture changes
nothing** — the player reads the answer off the map. This is the coupling that
makes the fix a policy over a whole `Reveal` rather than a filter on its notes,
and it is the reason a naive version of this change would have been theatre.

It also means the verb's own summary sentence must go: it promises *"now drawn on
the map"* and the map is no longer drawing it. The replacement is written by the
shared module rather than by the verb, and ADR-0027's seam survives because the
replacement is a sentence about the **rule** — nothing in it knows what the verb
asked.

## 6. Guardrail 6, and the cost

Guardrail 6 is *"never punish a wrong answer: no score penalty, no fail state, no
lockout"*. This is none of the three. The score is untouched, nothing is locked,
and the board can be answered again immediately at no cost. What it does is
decline to **hand something over**, which is the difference between a game that
teaches and a game that fills in its own answer sheet.

**The cost is real and is not argued away**: the player who reasons worst learns
least. Below the bar they get the score, its arithmetic, and no per-candidate
lesson — and the per-candidate lesson is the best thing in the product, according
to the same tester who found the exploit. It is accepted because the alternative
is worse in a way that is not a matter of degree: while select-all buys the
annotated key outright, there is no reason for anyone to reason at all. The bar
is reachable by picking **fewer** things, which is the behaviour the board wants.

## 7. Alternatives rejected

- **Record the first attempt's score as the pass.** Smaller, and touches
  ADR-0011's save rather than the reveal. Rejected by the owner: it makes a retry
  pointless, which cuts against guardrail 6's spirit more than withholding does —
  a retry that cannot improve anything is closer to a lockout than a reveal that
  declines to explain.
- **Accept it.** NORTH-STAR §7.1 argues this way about `truth` sitting in the
  atlas in plaintext (*"anyone who opens devtools to cheat has opted out"*). It
  does not transfer: this is not devtools, it is the UI's own affordance, and the
  tally *invites* it.

## 8. What is not measured

**How often real players land below the bar.** Nothing instruments attempts
(experiment 0001 §3 records that gap), so the teaching cost in §6 is argued from
the rule rather than counted from play. The number to want is *what fraction of
honest answers score precision < 0.5*, and it needs the same instrumentation M2
does. Until then this is a reasoned trade with a measured **exploit** side and an
unmeasured **cost** side, which is worth saying plainly rather than letting the
792-board figure lend its confidence to both halves.
