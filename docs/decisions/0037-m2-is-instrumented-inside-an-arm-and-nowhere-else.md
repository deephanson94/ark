# ADR-0037 — M2 is instrumented inside an arm and nowhere else

- **Status**: accepted
- **Date**: 2026-08-13
- **Discharges**: [`docs/experiments/0001`](../experiments/0001-does-the-world-beat-the-map.md) §9
  item 2 — M2's instrumentation
- **Does not amend**: [ADR-0011](./0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)
  decision 2. That is the point of the shape below, and the first draft of this document *did* amend
  it, was put to three independent reviewers, and was **refuted by all three**.
- **Corrects**: `docs/experiments/0001` §3, which describes a field the code does not have

## Context

§3 pre-registers two measures and its table says both are instrumented. One is not. **M2 is
"challenges attempted within the fixed 20 minutes"**, and the engagement half of S1 cannot be read off
a finished session.

## Finding — the datum did not exist, and persistence was the second problem

§3 says *"`noteAttempt` keeps attempt counts in `selector.ts`'s session state and nothing persists
them"*, which credits the code with more than it has. `main.ts` increments that map **only when the
grade did not pass**:

```ts
attempts: progression.unlocked ? selector.attempts : noteAttempt(…)
```

So `selector.attempts` is a count of **failures** — `selector.ts`'s own docstring says *"served and
not passed"*, honestly — and summed it is `grades − passes`. Persisting it would have answered
*"challenges attempted"* with a number that **falls as participants do better**, anti-correlated with
the quantity it is pre-registered to measure, on exactly the between-arm comparison §3 exists to make.
A participant who passed every board first time would leave an empty map.

This is the class-label landmine arriving in a schema: the name says attempts, the docstring says
failures, and the experiment's prose says attempts. Three populations, one identifier. **The new field
is called `graded`** and never `attempts`, because the old one is load-bearing for the rotation
exactly as it is.

## What was refuted

The first draft proposed a per-`(verb, subject)` tally **inside `Progress`**, on the argument that
storing it is not the cursor ADR-0011 decision 2 forbids *provided the selector never reads it* — the
ADR's own sentence being that *"position in the progression is recomputed from the answered set on
every load"*. Three reviewers were told to refute it, given different lenses, and defaulting to
refuted. All three did. The objections that changed the design:

- **It inverts rule and rationale.** Decision 2 says *"neither is a cursor"* — a prohibition — and the
  clause about recomputation is the **reason**. Promoting the reason to the operative test permits
  anything that satisfies it. Decision 2 also *prints the record's schema as a JSON literal*, so any
  new key is a change to it however it is justified.
- **The code had already classified this datum, the other way.** `selector.ts` does not say attempts
  happen to be session-scoped; it says *"a position in the rotation **is** a cursor"*, citing this
  ADR. Ship the first draft and the ADR and the header both say attempts are never persisted while the
  code persists them — a rule that lives twice.
- **The proposed proof was vacuous.** *"Delete the read path and nothing changes, because there is no
  read path"* passes on every tree containing the field, including the tree where the next session
  wires it in. It asserts the absence of a caller, not a property of the field.
- **There is no decay analogue.** Everything in `Progress` is re-checked against the live graph
  (decision 3) because it asserts something *about the graph*. An attempt count asserts something
  about the player's history, which no graph query can falsify — so it would be the first entry
  structurally exempt from decision 3, and an exception in a table is indistinguishable from a design
  choice one milestone later.
- **The version cost is real now.** `parseProgress` discards on **any** version mismatch, so a bump
  destroys every existing save; and `save.ts`'s *"there is no installed base"* predates ADR-0031,
  which made the repo public and put the player on Pages.

## Decision 1 — it is written only inside an arm

`main.ts` writes the record only when `?arm=` locked the session. That is `experiment.ts`'s existing
rule — *"absent or unrecognised means today's player, unchanged"*, and the deployed page has no query
string.

This is what makes ADR-0011 decision 2 **untouched rather than argued with**: for the ordinary player
there is no record at all, not a record nobody reads. The instrument exists for the twenty minutes it
is measuring and at no other time.

## Decision 2 — it lives beside the save, never inside it

Its own key, `ark:tally:<root>` — the same identity rule as `storageKeyFor`, since `head` moves on
every commit. `SAVE_VERSION` does not move, `parseProgress` is untouched, and
`tests/unit/progress.test.ts`'s key-list assertion keeps its teeth.

And the shapes are **deliberately incompatible**: a sorted array of rows against
`ReadonlyMap<string, number>`. Feeding this to `suggestNext` is a rewrite, not a one-word edit. That
is the enforcement a comment cannot give, and it is what a reviewer asked for in place of the vacuous
mutation test. `tests/unit/tally.test.ts` also asserts against the **source text** that
`selector.ts` never mentions the module, so wiring it in goes red.

## Decision 3 — it counts every grade, and records which attempt first passed

`graded` is every submission, pass or fail; summed, it is M2's *challenges attempted*. `passedOn`
latches the attempt number of the first pass, or `0`.

`passedOn` is carried because a bare count cannot separate *tried once, got it* from *tried once, gave
up*, and those are opposite engagement readings. It is also the figure that prices any rule which
spends a player's first attempt: the fraction of boards passed on a **second** try is `passedOn ≥ 2`.

## Decision 4 — there is a readout, because a record with no reader is not an instrument

§9 offered *"a counter in the save, or a facilitator's tally"* — a schema change or a clipboard — and
missed the option that dominates both. The count already existed in memory; what M2 lacked was any way
to get it out of a finished session. So `summarise()` is typed and tested, and `main.ts` exposes it as
`arkTally()` **in an arm only**.

The participant is never shown it. Showing someone their own pre-registered measure changes the thing
being measured, and it is also what keeps guardrail 6 untouched: a wrong answer costs nothing because
nothing the player can see reads this.

## What this deliberately is not

**Not windowed.** M2 says *within the fixed 20 minutes* and this carries no clock, so the reading is a
total for the key. That is sound only because §4 fixes one participant to one repo they have never
seen, so the record is empty at minute 0 **by construction**. That is a property of the protocol, not
of the datum, and it is written down because the next use may not have it.

**Not a replacement for `selector.attempts`.** Its failure-only semantics is load-bearing for the rank
— an always-failing player must cycle rather than be handed one board eighty times — and widening it
would change a docstring's meaning for no gain.

## How it is proved to fire

A unit suite over a pure module cannot see shell wiring, and this repo has the scar: a mutant deleting
the guide's attempt-count seed reddened **no unit test at all**. So `test:e2e` plays a board under
`?arm=map`, asserts the reading moved to 1, reloads, and asserts it survived. Deleting the `noteGrade`
call reddens **both** assertions — checked, not assumed.

## What it does not measure, named rather than left implied

A post-ship sweep found three, and the first is a correction to this session's own §9 edit:

- **Time to first correct answer** (§5, a *reported* measure) has no clock behind it. Nothing the
  player stores carries a timestamp. Facilitator-timed, and §9 now says so — briefly it said the
  harness was complete instead, which is the exact defect §3's note exists to record.
- **A board opened and abandoned** is not an attempt here, because the record counts graded
  submissions. The arms differ in what it costs to *reach* a board — in the world arm Enter opens one
  only when the hero is in range — so the gap is not symmetric between them.
- **The record does not reset.** A facilitator dry-run on the same machine and repo accumulates into
  the same key, and the reading carries no provenance. §9 tells the facilitator to clear it; that is
  a procedure rather than a mechanism, and it is written down as one.

## Revisit when

- **A use needs the window rather than the total.** Then this needs per-grade timestamps, which is a
  larger change and a product question nobody has raised.
- **Anything outside an arm wants the number.** That is the decision this document declines, and it
  puts ADR-0011 decision 2 back on the table rather than around it.
- **`passedOn ≥ 2` comes back large from a real session.** Then a rule that spends the first attempt
  is expensive, and the honest fix is a better first attempt rather than a second pass.
