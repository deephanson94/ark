# ADR-0035 — The board explains itself to an answer that discriminated

- **Status**: **accepted, built, and amended twice the same day.** §3's second
  bullet was false and a playtester farmed the deck through it (§9); and §7's
  first rejected alternative is now the decision, because no reveal policy can
  close what §9.1 describes (§10).
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
  untouched. ~~and it is **not farmable**, because reaching precision 1.0 means
  already knowing which ones were right.~~ **WITHDRAWN — see §9. Reaching
  precision 1.0 means knowing *one*.**

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

- ~~**Record the first attempt's score as the pass.**~~ **NO LONGER REJECTED —
  this is now the decision, see §10.** Smaller, and touches ADR-0011's save
  rather than the reveal. Rejected here by the owner: it makes a retry pointless,
  which cuts against guardrail 6's spirit more than withholding does — a retry
  that cannot improve anything is closer to a lockout than a reveal that declines
  to explain. §9.1 then showed that withholding *cannot* close the farm on its
  own, and §10.1 shows the objection was narrower than it read: a retry keeps the
  reveal, the map unlock and the fog, and loses one notebook entry.
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


---

## 9. Amendment, same day: the claim in §3 was false, and it was the proudest sentence

An independent playtester was asked to attack this rule and did:

> *"One correct pick farms any board's answer key. Three boards fell in **4, 7 and
> 13 submits**, black-box, no atlas, no codebase knowledge — 4.1 probes per board
> across the deck. Field notes then read 'You proved 4 files that depend on
> src/player/ties.ts'."*

**§3's second bullet is withdrawn.** *"Reaching precision 1.0 means already
knowing which ones were right"* is false: it means knowing **one**. A single
lucky pick on a four-of-twenty board scored 40% — *"not yet"* — and was handed
all four members with evidence, and guardrail 6 makes each failed probe free.
This repo's own landmine says the soft spot is where the change is proudest, and
that sentence is the one this document spent the most effort on.

**§4.1 had already derived the fix and this document declined it.** `f1(1, recall)
≥ 0.5 ⟺ recall ≥ 1/3` is written there in as many words, and the second clause
was refused on the grounds that *"every leak in ADR-0014 was a rule that lived
twice"*. That is a real principle applied to the wrong quantity: the two clauses
are not two copies of one rule, they are the two ways an answer can fail to have
earned an explanation — imprecise, and thin. **Both are implemented now**
(`REVEAL_RECALL_BAR`), the sentence says which one fired, because *"pick fewer"*
is advice in the wrong direction for a thin answer.

### 9.1 What this still does not close, and it is not closable here

**The grade line is itself an oracle, and no reveal policy can change that.**
`Found 1 of 4` after a single pick says whether that pick was in the key; so does
a non-zero score. A determined player can therefore establish the whole key in
one probe per candidate — ~20 on a standard board — and then answer perfectly.
Partial credit over a set *is* a Mastermind oracle, and guardrail 6 means a probe
costs nothing by design.

So the honest claim is narrower than §2's: this makes farming **cost more and
teach nothing**, and it stops the product *handing* the key over. It does not make
a pass proof of understanding, which is what NORTH-STAR §9 wants of a field note.

**The only thing that closes that is recording the pass from the first attempt** —
the alternative §7 rejected on the owner's instruction, because it makes a retry
unable to improve anything. That trade now has a measured cost on the other side
of it and goes back to the owner rather than being decided here.

**It went back, and the owner reversed §7. See §10 — this is built.**

### 9.2 A pass is always explained — a second amendment, from a second tester

A cold tester hit **`C · 50% · passed`** beside *"Pick fewer and more carefully
and every choice gets its reason"* **on the first two boards they were served**.
One right and two wrong on a single-answer board is F1 0.5, which passes, and
precision 0.33, which withheld. Two true sentences contradicting each other in
one panel — the failure this repo keeps finding *between* two surfaces, managed
here inside one.

`grade.score >= PASS_THRESHOLD` now short-circuits the withholding. It is not a
hole: `isGameable` refuses to ship a board select-all can pass, so every shipped
board has `n > 3k` (select-all's F1 is `2k / (n + k)`), and a lone lucky pick on a
four-of-twenty board scores 0.4. And a pass is the product's *own* definition of
having understood the board, so refusing to explain one is the rule arguing with
the grader.

**It also found a board the generator would refuse.** `withhold.test.ts`'s
fixture offered five candidates for a two-file key, where select-all scores
**0.571 and passes** — a challenge `isGameable` would never issue. The fixture
had been fine under the old rule and only surfaced when the pass clause landed on
top of it. Eight candidates now, and the reason is in the comment: **a test
fixture has to satisfy the invariants the generator enforces**, or it is asking
about a board that cannot exist.

---

## 10. Amendment, same day: the pass is decided by the first graded attempt

- **Status**: accepted and built. **This reverses §7's first rejected
  alternative**, on the owner's instruction, after §9.1 measured the other side
  of the trade it was rejected on.

§9.1 is the argument and it is short: **the grade line is itself an oracle**.
`Found 1 of 4` after a single pick says whether that pick was in the key, a
non-zero score says the same, and guardrail 6 makes each probe free *by design*.
Partial credit over a set **is** a Mastermind oracle, so a determined player
establishes the whole key in one probe per candidate — ~20 on a standard board —
whatever the reveal does. No reveal policy can close that, which is why §2's rule
was never going to be enough on its own.

So `Progress.attempted` records the `(verb, subject)` keys that have been graded
at least once, and `applyGrade` writes a pass **only on the first**. Everything
else is untouched: the score, the reveal (ADR-0035 §9.2 explains any passing
answer), `unlocks`, the map's radius, `surveyed`, and the board's own
availability.

### 10.1 Why this is not guardrail 6's lockout, and where the tension really is

Guardrail 6 is *"no score penalty, no fail state, no lockout"*, and this is none
of the three: the board opens, the picks tick, the grade computes, the reveal
fires, the cone draws. What changes is what the **notebook** records.

§7 rejected this on the owner's instruction, in these words: *"it makes a retry
pointless, which cuts against guardrail 6's spirit more than withholding does."*
That objection is real and it is **narrower than it reads** — a retry keeps the
reveal, which the same tester who found the exploit called the best thing in the
product, and it keeps the map unlock and the `surveyed` half of the fog. What it
loses is one field-note entry. Against that: without the rule, **every** field
note is obtainable in ~20 free probes, and NORTH-STAR §9 says the
proved-versus-shown distinction *is* the product. A notebook that certifies
persistence is worth less than one that certifies nothing, because it claims to
certify understanding.

The honest summary is a trade between two readings of guardrail 6, and the owner
took the one that keeps the notebook true.

### 10.2 The rule is stated before the answer, twice

**A rule the player learns from its consequence is a trap**, and this one is
invisible until it has already cost something. Two surfaces:

- `keyRule` — every verb's prompt, every board: *"Your first answer is the one
  your notebook keeps; nothing is locked either way."* The second clause is
  guardrail 6 and is literally true of the code beside it.
- `challenge.ts`'s `REANSWER_LINE`, on a board that is already spent, **before
  the answer and again beside the grade**. The second placement is not
  decoration: without it a retry can read `S · 100% · exact` over a notebook that
  records nothing, which is two true surfaces contradicting each other — the
  failure §9.2 was the amendment for, and the one this repo keeps finding
  *between* two states.

`wording.test.ts` holds the first and `test:e2e` holds the second, because the
sentence is the whole mitigation for §10.1's cost.

### 10.3 What the mutation run found, and it is the reason there is an e2e step

Three mutants of `applyGrade` die under `tests/unit`: dropping the `first`
clause, recording the attempt before reading it (the off-by-one whose comment
sits in that function), and keying `attempted` on the subject alone. Four more
die in `save.ts` — the field has to *persist*, because the farm is not a
within-session trick.

**A fifth mutant survived everything.** `main.ts` seeds the selector's attempt
counts from `progress.attempted` at load, because the guide's outermost rank key
is `attempts` and a restored session that starts them at zero opens by offering
the one board in the deck with nothing left to give. Deleting the seed reddened
**no test under `tests/unit`** — it is shell wiring, and no unit test reaches it.
That is what the e2e step is for, and it is the same lesson as this repo's
*count how many times the branch fires*: the unit suite covering three quarters
of a rule looks exactly like a unit suite covering it.

The e2e probes with a **select-all**, which is the one answer `isGameable`
guarantees cannot pass on a shipped board — so the board is certainly still
unanswered and its attempt certainly spent, and no branch of the step depends on
what the deck happened to serve. It asserts the *reload*, which is the only place
the seed is distinguishable from `noteAttempt`.

### 10.4 What is still not closed

**The score line still tells a probing player whether a pick was in the key**,
and it must: a player who cannot see why they scored what they scored has been
handed a verdict, which is the defect `howScored` exists to fix. So the oracle is
not removed, it is **made worthless** — running it now costs the board's pass, so
the information it yields buys a better *reading* of the board and never a
notebook entry.

**And nothing measures how often an honest player wants a second attempt.** That
is the same gap §8 records: attempts are session state and nothing persists a
*count*, only the fact. The number to want is *what fraction of boards a
first-time player would pass on a second try* — if it is large, §10.1's cost is
larger than argued here, and the mitigation to reach for is a better first
attempt (a clearer prompt, a cheaper way to look around before committing)
rather than a second pass.
