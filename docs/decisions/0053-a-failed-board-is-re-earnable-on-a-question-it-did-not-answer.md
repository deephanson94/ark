# ADR-0053 — A failed board is re-earnable, on a question it did not answer for you

- **Status**: **accepted and built.** The outcome was decided by the owner on 2026-08-25 —
  *"yes it should be re-earnable"*. The mechanism is this document, and it was not free to choose.
- **Date**: 2026-08-25
- **Amends**: [ADR-0047](./0047-proof-is-what-the-first-answer-earned.md) decision 2. Everything else
  in that document stands, including its measurement, its two farm sequences and decision 3b.
- **Bears on**: NORTH-STAR §9 (field notes claim only what was proved), §8.1 (`Grade` is honest),
  §4 (the revealed fraction is a real measure), guardrail 6 (never punish a wrong answer),
  guardrail 5 (the atlas contract), [ADR-0012](./0012-an-answer-key-is-issued-once.md),
  [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)
- **Measured with** `npm run probe:retry` (the ceiling) and the shipped generator's
  `report.retriable` (the yield), on clean clones; ark at `e0bb4bf`.

---

## 1. What the player experiences today

Fail a board. Come back a week later having actually read the code. Pass it. The field note says
**"You were shown 4 files…"**, and the map does not light.

That is ADR-0047 decision 2 working exactly as designed, and a round-7 cold tester put the cost
plainly: *"I scored 40% twice. Two of my four boards are now dead content forever."* They were wrong
about the note — one does arrive — and right about the fog, which is the reward every round-5 tester
named as the thing that makes the loop worth playing.

## 2. Why the obvious fix is not available

**A failing submission names the whole answer key on screen, by name.** `Grade.missed` is
`truth \ picked`, NORTH-STAR §8.1 requires an honest grade, and `challenge.ts` renders one `missed`
row per member. Guardrail 6 then makes retries free and unlimited.

So within one board there is **no state after a failed answer in which the player does not know the
answer.** Letting a later pass mint `proved` on the same key would certify a fact the board handed
over one click earlier — which is §2.1 of ADR-0047, the laundering sequence that document exists to
close, restored in full.

This is not a preference and it cannot be designed around. Three variants were considered and each
dies to the same sentence:

| variant | why not |
|---|---|
| Any later pass mints `proved`. | ADR-0047 §2.1 verbatim. `understood` becomes decoration. |
| Hold the reveal until asked; a player who never opened it stays eligible. | ADR-0047 decision 2's own corollary forbids it, and the `sweep` needs no reveal at all — twenty single-pick submissions read the key off the **score**. |
| Require a higher band on the retry. | The farm scores 100% exact. A higher bar filters nobody. |

## 3. Decision 1 — the re-earn is a second, disjoint window

`Challenge.retry` is a second choice set about the same subject whose `truth` shares **no member**
with the board's own. Knowing window 0 tells you nothing about window 1, so passing window 1 proves
something you were never told.

The machinery already existed. ADR-0012's `reask` re-asks a *colliding* subject with a later window
of its own ranking; `secondWindow` runs the same search aimed at a different question — *give this
subject a key **it** has not issued* rather than *one the deck has not issued* — and the deck rule
still applies on top, so a retry key another subject already asks is refused and reserved exactly as
ADR-0012 requires.

**Stored on the board, not as a challenge of its own.** `retain`'s cap decides which *subjects* a
repo can afford to ask about; a retry is not another subject, and it must not compete with one for a
deck slot.

**Computed after the cap.** The cap drops most of what `dedupe` keeps — 95 of 149 on hono — and a
retry for a board nobody will see costs an `assemble` per window and reserves a key that would then
push a real board into `duplicateKey`.

## 4. Decision 2 — proof is a claim about members, not about attempt numbers

ADR-0047's rule was `first submission or nothing`. Its *reason* was about members all along: a later
pass certifies nothing **because the board already named those members**. Stating it that way is
strictly more general, and the change to `applyGrade` is one expression:

```ts
const named = namedMembers(progress, liveness, key);
const told  = named !== null && grade.correct.some((member) => named.has(member));
const register = passed ? (told ? 'shown' : 'proved') : null;
```

Nothing new is stored. ADR-0047 decision 3b already put the members on the certificate so it could
decay by them; **nothing had ever read them for their content.**

The rule reproduces every case the old one decided:

| sequence | before | after |
|---|---|---|
| Pass on the first submission | `proved` | `proved` — nothing was named. |
| Fail, then retype the same key | `shown` | `shown` — every member named. |
| `sweep`: twenty single picks, then type it back | `shown` | `shown` — the *first* sweep submission records a certificate naming that window's whole key. |
| Fail window 0, pass window 1 | `shown` | **`proved`** — the case the attempt-number rule could not express. |

ADR-0047's two farm suites pass **unchanged**, which is the control: they are the reason to believe
this is a generalisation rather than a hole.

### 4.1 The certificate accumulates, inside the board's own member universe

The first draft replaced the certificate on each grading, as ADR-0047 wrote it. That reopens the
laundering sequence one step further out: fail window 0, be served window 1, fail that too — and now
the certificate names only window 1, so window 0 comes back looking un-named and ready to be retyped
for `proved`. **§2.1 rebuilt out of the fix for it.**

The union is taken inside `truth ∪ retry.truth`, which keeps decision 3b's intent rather than arguing
with it: a re-rolled board has different windows, so a member belonging to neither is dropped exactly
as a wholesale replacement would drop it. What survives is only ever something *this* board named.

## 5. Decision 3 — one place chooses the window

`servedBoard(challenge, named)` is pure and returns a **view**: `id`, `verb`, `tier`, `subject` and
`evidence` are the board's, so `(verb, subject)` still keys the save, the deck and the selector, and
every reader downstream takes `candidates`, `truth` and `witness` off what it is handed.

The two windows are **swapped** rather than one being dropped, so `challenge.retry` always names the
other one — which is what lets `applyGrade` take its union over the whole member universe whichever
window it was given.

Three hand-out sites in `main.ts` go through it (`challengeFor`, `nextPlacelessChallenge`,
`refreshGuide`). All three, because `challengeFor` returns the guide's suggestion unchanged on the
node it points at: a suggestion that skipped the window choice would reach the console as window 0
through a path the other two close, and one board would be served in two windows depending on how it
was opened. Every leak in ADR-0014 was a rule that lived twice.

## 6. What it costs and what it reaches

**Yield, through the shipped generator** (`report.retriable`) against the arithmetic ceiling
(`npm run probe:retry`):

| repo | Blast Radius boards | ship a second window | ceiling |
|---|---|---|---|
| ark | 40 | **30 (75%)** | 78% |
| hono | 54 | **27 (50%)** | 56% |
| kysely | 75 | **67 (89%)** | 95% |
| graphql-js | 69 | **61 (88%)** | 88% |

So the gate and the distractor build cost 3–6 points; supply is the constraint, as it was for
ADR-0012.

**Atlas cost**: +3.6% to +5.8% (ark 449.7 → 479.0 KiB). Budget unmoved at 1,681 B/file against a
2,621 ceiling. Index time unmoved. Determinism byte-identical.

## 7. What this does not do, said plainly

**Only Blast Radius ships a second window.** The other three verbs' ceilings are Companion 41–64%,
Archaeology 24–56% and **Placement 4–20%** — that last because its subject is a commit and a commit's
file list is usually about the size of the key sampled from it. Those verbs are unwired, their boards
carry no `retry`, and they behave exactly as they did before this document. That is a **partial
delivery and it is named as one**; this repository has a rule about a decision being recorded as a
delivery, and the next edit of the README's Verbs table must not turn this row green for four verbs.

**It does not make the farm pointless**, and ADR-0047 §6 already conceded that it cannot be. A player
who sweeps the second window still retires the board and still lights `surveyed`. What they do not
get is a claim of knowledge, which is the only thing the save was ever able to defend.

**A board with no second window is unchanged**, including its copy — which is the half of this that
had to be written twice rather than once.

## 8. The two sentences

`belowBarNote` said, to every failing player: *"a later pass is recorded as revealed rather than
proved, because the first answer is the one that can prove a board."* That is now **false on 75% of
this repo's Blast Radius boards**, and a single sentence covering both cases would have to be the
weaker one — which is how the sentence it replaced came to promise less than the product does.

It takes the fact from the board (`challenge.retry !== undefined`) rather than guessing, because
whether a subject can supply a second window is a property of the repository and the console has no
way to know it. The `shown` line moved too: *"this board had already explained itself. The first
answer is the one that counts"* → *"this board had already named these answers to you. Proof is what
you were not told."*

Both are asserted as **true**, per case, in `tests/unit/player-reveal.test.ts` — a test that holds one
sentence to a shape while the product grows a second behaviour is this repository's most expensive
recurring defect.

## 9. Verification

- **`tests/unit/progress.test.ts`** — nine assertions driving the real ledger: the re-earn, the
  retyped key, a sweep *of the second window*, the both-windows-failed accumulation, the re-rolled
  board dropping a carried member, a board with no retry behaving as before, and the control (*a
  first pass proves everything*), which must survive or the suite would be green against a product
  that never proves anything. Four mutants, each killed by exactly the assertion aimed at it:
  the old attempt-number rule, the non-accumulating certificate, the unfiltered union, and a
  `servedBoard` that never swaps.
- **`tests/atlas/atlas.test.ts`** — the ADR-0008 invariant recomputed from the graph for every retry
  window, plus disjointness and equal key size, with a plant (*some board must ship one*) so a clean
  zero cannot mean the check never ran.
- **`npm run check:keys`** — extended to iterate **choice sets** rather than challenges. This is the
  only instrument that reads the repository's *source*, so it is the only one that can see a
  **missing** edge; leaving retry windows out of it would have been covering them with the checks
  that structurally cannot see the defect. 70 sets, 1,002 wrong-answer slots, 0 naming their subject.
- **The generator's own guardrail-4 check** now runs on the retry's candidate set. The authoritative
  check reads `entry.candidateRefs`, which is window 0 and only window 0 — without that line, half of
  each retriable board would be the one choice set in the atlas no authoritative check had seen.
- **`scripts/e2e.ts`** — the whole loop in a browser: fail a board, assert the copy promises a
  re-earn, reopen, assert the choice set changed and that **no answer repeats**, pass the new window,
  assert the panel does *not* say `shown`, and read the field note. It reports
  `window 0 20 rows, window 1 20, 12 in common` and
  `You proved 6 files that depend on src/indexer/elevation.ts`.
- `test:unit` 1074, `test:atlas` 126, `test:determinism` byte-identical, `test:e2e` clean,
  `npm run budget` within every ceiling.

## 10. If the owner declines

Revert the commit. `ATLAS_VERSION` returns to 11 and existing v12 atlases fail with *reindex
required*, which is guardrail 5's mechanism and needs no extra code. Saves are untouched either way —
`SAVE_VERSION` never moved, because the ledger's *shape* did not change, only what is derived from
it, so a v2 notebook is read correctly by both rules.
