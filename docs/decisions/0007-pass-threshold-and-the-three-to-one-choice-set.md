# ADR-0007 — The pass threshold is 0.5, which forces a 3:1 choice set

- **Status**: accepted
- **Date**: 2026-08-06
- **Extends**: NORTH-STAR §8.2 (grade bands)

## Context

NORTH-STAR §8.2 gives the bands as **S ≥ 0.95, A ≥ 0.78, B ≥ 0.60, C = reached pass** — and never
says what "pass" is. It also states that selecting every candidate on a 20-candidate question with
4 correct answers scores 0.33, *"below any pass threshold"*.

So the threshold is pinned between 0.33 and 0.60 and otherwise unspecified. Something has to
choose, because `bandFor()` needs a number and the generator needs to know which questions are
worth shipping.

## Decision

**`PASS_THRESHOLD = 0.5`**, and `bandFor()` returns `'incomplete'` below it — not `'F'`, and not a
failure state. Guardrail 6: a wrong answer never punishes. Below the threshold the fog simply does
not lift yet.

The interesting part is what the number implies. Selecting everything scores

```
2·|truth| / (|truth| + |candidates|)
```

which is below 0.5 exactly when **`|candidates| > 3·|truth|`**.

So the threshold is not just a display band — it is a **constraint on challenge generation**. A
question whose choice set is less than about four times its answer key can be passed by clicking
everything, and shipping one would quietly retire the anti-gaming property the north star relies on.

`src/verbs/score.ts` therefore exports:

- `selectAllScore(challenge)` — what the exploit would actually score on this question;
- `isGameable(challenge, threshold = PASS_THRESHOLD)` — whether that reaches the threshold.

`tests/atlas/atlas.test.ts` asserts that no shipped challenge is gameable, and
`tests/unit/score.test.ts` walks answer-key sizes 1–12 to check the 3:1 rule holds at each.

## Alternatives rejected

**0.6, reusing the B threshold.** Would collapse C into B and make the four-band scale a
three-band one, contradicting §8.2's explicit "C = reached pass".

**0.4, just above the stated 0.33.** Technically satisfies §8.2 and leaves almost no margin: it
would pass any question with a choice set only 2× its answer key, which is a small enough set that
guessing works.

**No threshold; treat every score as partial credit.** Attractive — there is no fail state anyway —
but progression has to unlock on *something*, and "you understood this" needs a line. Leaving it
implicit would mean each future feature picked its own.

## Consequences

- Blast Radius generation (M2) must build choice sets of at least `3·|truth| + 1`. With
  `DEFAULT_GENERATE_OPTIONS.candidateCount = 20` that caps a shipped answer key at 6 files, which
  also happens to be about as many as a person can hold in their head at once.
- Some subjects will not be challengeable — a hub with 40 direct dependents cannot be asked about
  at 20 candidates. That is a generation problem to solve at M2 (bound the depth, or sample the
  truth set and say so in the prompt), not a reason to lower the threshold.
- The number is one constant in one file. If playtesting says 0.5 is wrong, it moves — and
  `isGameable` moves with it, because both read the same constant.
