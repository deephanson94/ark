# ADR-0047 — Proof is what the first answer earned, and the ledger is the defence

- **Status**: **built, and it reverses an owner decision — awaiting the owner's ratification.**
  ADR-0035 was *"decided by the owner, from three options put with their costs"*. One of those costs
  was measured wrong: the option chosen does not do what it was said to do, and §2 is the
  measurement. The revert is one commit and §8 says which.
- **Date**: 2026-08-14
- **Supersedes**: [ADR-0035](./0035-a-reveal-is-earned-by-an-answer-that-discriminated.md)
- **Bears on**: NORTH-STAR §9 (field notes claim only what was proved), §8.1 (`Grade` is honest),
  §7.1 (`truth` sits in the atlas in plaintext), guardrail 6 (*never punish a wrong answer*),
  [ADR-0011](./0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)
  decision 3, [ADR-0016](./0016-a-history-wire-is-drawn-only-where-no-board-is-open.md) decision 3
  (a payoff that withdraws), [ADR-0027](./0027-a-board-is-asked-in-the-noun-its-members-are.md)
- **Measured with** `npx tsx scripts/probe-farm.ts /tmp/ark-corpus ark hono kysely graphql-js`, on
  clean clones, at `9b13cf6`.

---

## 1. What went wrong, in one paragraph

ADR-0035 withheld the reveal — the per-candidate explanation panel, which is the product's only
teaching surface — from any answer below precision 0.5. It was built to stop a farm: tick every
candidate, read the annotated answer key off the reveal, reopen, tick what it named, take
`S · 100% · exact` and a **field note**. Field notes are NORTH-STAR §9's *"facts you have proven you
know, not facts you were shown"*, described there as the whole product.

It does not stop that farm, its own showcase case *is* that farm, and the price is paid by the
player the product exists for.

## 2. The measurement

Guardrail 6 makes re-answering free and unlimited, so the attacker's unit is not an answer, it is a
**sequence** of them. ADR-0035 §3 reasons about one answer: *"picking few and getting them all right
is precision 1.0 … and it is **not farmable**, because reaching precision 1.0 means already knowing
which ones were right."* Two sequences the shipped player permits:

| repo | boards | unlock clicks mean / median / max | boards unlockable | grade separates | sweep |
|---|---|---|---|---|---|
| ark | 160 | 5.2 / 4 / 16 | **160/160** | **160/160** | 20.0 per board |
| hono | 216 | 7.0 / 6 / 20 | **216/216** | **216/216** | 20.0 |
| kysely | 300 | 6.0 / 5 / 20 | **300/300** | **300/300** | 20.0 |
| graphql-js | 276 | 5.8 / 5 / 20 | **276/276** | **276/276** | 20.0 |

- **`unlock`** — tick one candidate, submit, repeat. The first pick that lands in the key is
  precision 1.0, which clears the bar and hands over the entire reveal. **Every board on all four
  repos**, in a mean of 5.2 clicks. So "already knowing which ones were right" costs five guesses.
- **`sweep`** — never trigger a reveal at all. A single pick scores `2/(K+1) > 0` **exactly when it
  is in the key**, so the displayed percentage is a membership oracle; `score.ts`'s
  *"N of your 1 picks are right"* merely says it in words. Twenty submissions read the whole key off
  the **grade**. The precision bar does not touch this path.

`grade separates` is the load-bearing row and it is 952 of 952. §8.1 requires an honest grade and
guardrail 6 requires free retries, so **no policy over the reveal can make an answer key
non-extractable**. That is not a new concession: §7.1 already made it for the atlas file — *"anyone
who opens devtools to cheat has opted out of the product"*.

### 2.1 The gate's own showcase case is the exploit

This is the fact that decides it, and it needs no probe. Walk the honest cautious player ADR-0035 §3
calls *"untouched"*:

1. Tick the one file you are sure of. You are right. Precision is 1.0.
2. `asEarned` passes the reveal through — so the panel names **every** key member with its evidence,
   and `main.ts` draws the subject's whole cone on the map.
3. `2/(K+1) < 0.5`, so it is not a pass and the board stays open.
4. Reopen. Tick the members it just named. `S · 100% · exact`.
5. `applyGrade` records `grade.correct` of the *passing* attempt — **the whole key, every member of
   which was on screen one click earlier** — and the note claims all of it as proof.

ADR-0035's terminal state, reached **through** the gate, by the case the ADR held up as the reason
the gate was safe. The gate protects the *first attempt's panel*; `recordPass` launders every attempt
after it.

### 2.2 And the cost was charged to the wrong player

The bar discriminates on **confidence calibration**, not on honesty. Bold-and-wrong — the player who
reasoned, committed, and missed — gets the score and nothing else. Timid-and-right gets the whole
annotated key after one click. A cold playtester picked exactly the six the prompt said to pick,
scored 17%, was told *"Pick fewer and more carefully"* — advice that was **wrong**, they had picked
the stated number — and then guessed blind four more times at 0% with nothing returned. They called
it *"the single biggest thing wrong — nearly made me quit"*.

On the same screen, every prompt ended with *"Nothing is locked by a wrong answer"* while the
explanation was locked. Guardrail 6's own rationale is *"wrong picks teach"*; the gate suspended
exactly that.

## 3. Decision

**Decision 1 — the gate is deleted. Every answer gets its reveal.**

`src/verbs/withhold.ts` and the `asEarned` call in `challenge.ts` are gone. `keyRule`'s two false
clauses go with them.

**Decision 2 — `proved` is minted only by a board's *first* graded submission.**

`Progress.graded` records every `(verb, subject)` that has been answered, passing or not.
`applyGrade` mints `Pass.proved` when the key is absent from it and `Pass.shown` otherwise.

The justification is not "later attempts are suspicious"; it is that `gate.ts` **certifies every
board against guesses assembled from a known information state** — the key size, the direct ring the
map draws, hover. That certification models the first submission and nothing after it. So *proved*
means *claimed under the conditions this board was certified fair for*, which is a sentence the save
can check. Note the two coincide: with no gate, every submission serves a full reveal, so "before the
board explained itself" and "first submission" are the same event. **One rule, not two** — every leak
in ADR-0014 was a rule that lived twice.

*Corollary for whoever adds a "hold the reveal until I ask" pacing control: it must not restore
proved-eligibility, or the sweep reopens.*

**Decision 3 — `graded` lives on `Progress`, not on `Pass`, and it persists.**

A **failed** first attempt leaves no `Pass` to carry the flag — and that is precisely the attempt
after which the board has explained itself. `selector.attempts` answers the same question in memory
and **dies on reload**, so a reload-then-pass would mint a note the player did not earn. `SAVE_VERSION`
goes 1 → 2.

**Decision 4 — three consumers, three answers, and they are deliberately not the same.**

| consumer | reads | why |
|---|---|---|
| `fog.understood` | **proved only** | Its contract is *"you proved you knew something about it, by being graded against ground truth"*, and §4 calls the revealed fraction *"a real measure of how much of it you can reason about"*. A copy-back playthrough must not light the map or that sentence is false and the fog is decoration. |
| deck retirement (`answeredKeys`) | **either** | Re-asking a board whose key was named to this player is theatre. |
| the cone (`subjectsPassed`) | **either** | The reveal already drew it and named every member in words. Taking it back afterwards is ADR-0016 decision 3's vanishing payoff, which this repository has shipped once and has a landmine about. |
| the field note | **either**, in its own register | §9's amendment already says a note *"may state the full radius only when it is labelled as revealed rather than known"*. This is that bullet applied to the claim as well as to the radius. |

A shown member still reaches `surveyed` — that is exactly what it is.

**Decision 5 — a note claims one register, never a mixture, and the verb writes the sentence.**

`NoteFacts.register` is `proved | shown`; each verb opens with `credited(...)` — *"You proved 4
files"* / *"You were shown 4 files"* — and keeps writing its own predicate, because *"that depend on
X"* against *"that landed on X"* is ADR-0027's whole point and templating one opening over a verb's
clause is how *"Map its companion"* happened. A pass holding both registers writes its note from
`proved`, which is byte-identical to the behaviour before this change; a pass that proved nothing
writes from `shown`. The sentence explaining **the rule** is shared, in `notes.ts` and in the result
panel, because it is a fact about the record and reads identically whatever the question was.

## 4. Guardrail 6, checked clause by clause

*"No score penalty, no fail state, no lockout."*

- The score is untouched — same metric, same number, same band.
- Nothing is locked. Every answer is explained now, which is strictly more than before.
- The board can be answered again immediately, as often as the player likes.
- A retry still improves the band, still retires the deck, still unlocks the cone, still writes a
  note.

The only thing a retry cannot do is convert *shown* into *proved*. That is not a punishment for a
wrong answer — the wrong answer is what caused the board to explain itself, which is the reward. It
is a refusal to **relabel** a fact the player was handed, and §9 is the document that asks for it.

This is **not** ADR-0035 §7's owner-rejected *"the first attempt's score is the pass"*: that made a
retry worthless, this makes it worth everything except the word *proved*.

## 5. What was rejected

**Keep the gate, add a class-level lesson below the bar.** Appendix A says *"derived evidence, never
canned"* and `Grade.evidence`'s own docstring says *"never a canned string"*. Worse, it keeps the
gate, so §2.1 is untouched.

**Keep the gate and fix only the two false sentences.** Cheapest, and it leaves the honest reasoner
with nothing while the prober gets everything in five clicks — the cost inverted, which is the defect.

**A per-board lesson below the bar that is provably non-identifying.** Constructible in principle:
below-bar feedback is sequence-safe **iff it is a function of the challenge alone**, so its total
leakage over any sequence is its own content, once, certifiable at generation by ADR-0021's method.
But the obvious instances are treacherous — *"the farthest key member is N hops out"* is safe until
`N = 1`, where it collapses to *"every answer is a direct importer"*, which is a Ctrl+F against the
ring ADR-0008 decision 1 already draws; and withholding it on those boards makes the silence say
`N = 1`, which is this repo's *withholding a class hides it only while another class is also silent*
landmine. Under decision 1 there is no below-bar state, so the family becomes optional pedagogy
rather than defence. Not built.

## 6. What this does not claim

It **polices self-explanation only**. Cross-board disclosure — one verb's reveal stating an atom of
another's key — remains `gate.ts`, `discloses` and `decidedBy`'s job, unchanged.

It does not claim the farm is now pointless, only that it no longer produces a false claim of
knowledge. A player who sweeps twenty times still retires the board and still lights `surveyed`. That
is the honest rendering of what they did.

**How often real players pass on a first submission is unmeasured.** ADR-0037's instrumentation
counts passes and failures per board inside an arm and would answer it; nothing has run. If the
answer is "rarely", decision 2 is charging most of the notebook to the weaker register and the rule
should be revisited — that is the number to take, and it is not a reason to guess now.

## 7. Verification

- **The two farm sequences, driven through the real ledger** (`tests/unit/progress.test.ts`). The
  sweep *reconstructs* the key from the scores rather than reading `challenge.truth`, so it is the
  attack and not a restatement of the fixture. Terminal state: pass, `proved` empty, `understood`
  zero, board retired, cone unlocked. Mutated back to the pre-ADR rule, **four of the five assertions
  redden**; the fifth is the control — *a first answer proves everything* — and it must survive, or
  the suite would pass against a product that never proves anything at all.
- **The whole exploit, in a browser** (`scripts/e2e.ts`). It used to assert the reveal named nothing.
  It now plays *both* steps and asserts where the farm ends:
  `select-all over 20 rows → 20 named, farmed pass recorded as shown, counts held at 0 understood`.
  The 20-named line is the control that keeps the assertion about a real farm.
- `test:unit` 919, `test:atlas` 116, `test:determinism` byte-identical, `test:e2e` clean.

## 8. If the owner declines

Revert this commit. `withhold.ts` and its suite come back, `SAVE_VERSION` returns to 1, and existing
v2 saves are discarded at parse rather than half-read (`parseProgress` already refuses an unknown
version, which is guardrail 5's rule for the atlas applied to the save).

The two **false sentences** should not come back with it: *"Pick fewer and more carefully"* is wrong
advice to a player who picked the stated number, and *"Nothing is locked by a wrong answer"* is false
beside a locked explanation. They are independent of the gate and of each other.
