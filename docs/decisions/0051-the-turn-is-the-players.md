# ADR-0051 — The turn is the player's

**Status**: accepted — **decision taken by the owner on 2026-08-19**, on round 6's measurement.
**Amends**: [ADR-0017](./0017-the-map-turns-between-challenges.md) decision 1. Decisions 2, 3 and 4
of that document stand unchanged.

---

## 1. What changes

ADR-0017 decision 1: *"After a challenge is graded, the map turns 2π(1 − 1/φ) ≈ 137.5°, animated
over 620 ms, when the console closes."*

**A grade no longer turns the map.** `r` turns it, by the same angle, with the same animation and the
same pivot. Nothing turns the map that the player did not ask for.

## 2. Why — and note that ADR-0017's argument is not the thing that was wrong

The original reasoning still holds and is not disputed here: map-derived spatial memory is
**orientation-locked**, so a map only ever seen north-up teaches an alignment-specific picture rather
than a structure, which is NORTH-STAR risk #1. `docs/prior-art.md` §4.4 is the evidence. Nothing in
this document contradicts that.

What ADR-0017 did not price is **when** the turn lands. Round 6's ten cold playtesters named it
twice, unprompted, as the single biggest problem in the product — including the tester who gave the
round's only 8/8:

> *"The whole map rotates every time you close a graded panel. I had three different orientations in
> three panels. The product's premise is that the map becomes a place you know; re-scrambling my
> mental picture at the exact moment I have just earned a landmark is working against itself. There
> is a compass and an `n` key, but needing them is the symptom."*

> *"The map re-orients after you grade. I learned where `src/verbs` sat, closed the panel, and the
> whole thing had turned — after the second grade I had to hunt for the region I'd just been in."*

The reward beat of the core loop is the moment fog lifts on ground you just earned. Turning at
exactly that moment spends the thing the loop just paid out.

## 3. Why this is an amendment and not a reversal

The mechanism is kept **whole**. `r` turns by `GOLDEN_TURN`, so pressing it walks the identical
sequence ADR-0017's table measured — 80 distinct headings over an 80-question deck, no consecutive
turn of 0°, exactly one board answered from north. Every property that document chose the golden
angle *for* is still available; what changed is who spends it.

That is the difference between this and the rejected alternative "never turn at all", which would
have discarded the transfer argument along with the complaint.

## 4. What this costs, stated rather than assumed

**A player who never presses `r` learns an orientation-locked map**, which is the risk ADR-0017 was
written against. That cost is real and it is now borne by default rather than by exception. Two
things bound it:

- The key is on the **HUD's control line**, not in the help card. A mechanic that no longer fires on
  its own is one nobody discovers, and `experiment.ts`'s own rule is *do not advertise a key that
  does nothing* — the converse obligation is to advertise one that does something.
- ADR-0017 decisions 2–4 are untouched: one heading on the camera, never persisted, and four ways
  back to north.

**Whether the default should be the other way is a question this document does not answer**, because
it needs the measurement round 6 could not make: the transfer claim is about repo B after repo A,
which is `docs/experiments/0001`, still unrun.

## 5. How this is kept honest

`test:e2e` asserted the automatic turn and was the **only** thing that did — 1,057 unit tests passed
with the behaviour deleted. That assertion is inverted rather than removed:

- a grade must leave the heading **unchanged**, asserted as an equality against the pre-grade
  heading rather than as "still north", since the previous board may have left the map anywhere;
- `r` must move it by exactly `GOLDEN_TURN`, derived from the constant the player uses;
- closing a board without answering must still not turn it — the case most likely to regress, since
  the turn used to be armed by a grade and spent on close.

## 6. Rejected

**Turn on every *other* grade, or on a smaller angle.** Both keep the defect (a turn the player did
not ask for, at the moment they earned the picture) and weaken the mechanism. The complaint was not
that the turn was large; it was that it was involuntary.

**Turn only when the player has not moved the camera themselves.** A rule whose condition the player
cannot see, which is how a control comes to read as broken rather than as a refusal.
