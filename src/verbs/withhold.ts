/**
 * What a reveal may say when the answer did not earn it.
 *
 * ## The exploit this closes
 *
 * A playtester found it in two clicks and it falsifies the one claim the
 * product makes about itself. Tick **every** candidate; the grade is ~10% and
 * guardrail 6 costs you nothing; the reveal then names the whole truth set with
 * per-member evidence, and — on a Blast Radius board — `unlocks: 'importRadius'`
 * draws the entire cone on the map. Reopen the board, tick the files it just
 * named, and you have `S · 100% · exact`, a pass, and a **field note**. Field
 * notes are NORTH-STAR §9's *"facts you have proven you know, not facts you were
 * shown"*, and that distinction is described there as the whole product.
 *
 * ## The rule, and why precision is the knob
 *
 * **The board explains itself only to an answer that discriminated.** Precision
 * is exactly the question *did you discriminate*,
 * and it separates the two cases cleanly:
 *
 *  - **Select-all cannot reach the bar, structurally.** ADR-0007's choice set is
 *    three-to-one, so select-all's precision is `|truth| / |candidates| ≈ 1/3`.
 *    Measured over **792 boards on graphql-js, kysely and hono its maximum is
 *    0.308 and no board exceeds 0.4** — the bar below sits at 1.6× that worst
 *    case rather than on a knife edge.
 *  - **Picking few and getting them all right is precision 1.0**, so the honest
 *    near-miss — the teaching moment, *"you found 2 of 6, here are the other
 *    four and why"* — is untouched. And it is **not farmable**, because reaching
 *    precision 1.0 means already knowing which ones were right.
 *
 * ## What is withheld: every per-member row, and the first draft of this file
 * got that wrong
 *
 * The obvious rule is *withhold the answers you did not pick*, and it closes
 * nothing: under select-all there **are** no unpicked answers. Every truth
 * member is a `correct` note, because the player picked it along with everything
 * else, and the reveal names them all. The unit test caught it on the first run.
 *
 * Naming only the `spurious` rows fails for the same reason one step later: the
 * wrong answers are the complement of the right ones *within your picks*, so on
 * a board you swept, *"these fourteen are wrong"* is *"those six are right"*.
 * **The partition is the answer**, and any part of it identifies the rest.
 *
 * So below the bar no per-member row is shown at all, and the counts are stated
 * instead — hiding those too would leave the number guessable off the tally
 * anyway. The line is explainable in one sentence: *more of your picks were
 * wrong than right, so the board is not explained this round.* The grade still
 * shows its arithmetic, which is the other half of what a player needs.
 *
 * ## Why a narrower rule does not survive the arithmetic
 *
 * The obvious refinement is to keep the `spurious` rows when the picks did not
 * cover the board — *"you picked one wrong file of twenty; here is why it was
 * offered"* leaks nothing about the six answers hiding among the other nineteen,
 * and it keeps ADR-0020's negative witness alive for the commonest honest
 * mistake. It does not work, and the reason is worth writing down because it
 * looks like it should:
 *
 *  - `picks = correct ∪ spurious`, so naming the spurious rows names the correct
 *    ones **by complement**. There is no hiding one inside the picks.
 *  - And knowing which of your picks were right is enough to *pass next time*
 *    whenever `f1(1, recall) ≥ 0.5`, i.e. **recall ≥ 1/3** — pick six, get two of
 *    a six-file key, learn which two, reopen with those two alone and score
 *    exactly the pass threshold. Recall ≥ 1/3 is not an edge case.
 *
 * So the band where keeping the rows is safe is `recall < 1/3` *and* precision
 * below the bar, which is narrow, and buying it costs a second rule — and every
 * leak in ADR-0014 was a rule that lived twice. One rule, and the cost stated.
 *
 * **The cost is that ADR-0020's negative witness now speaks only to answers
 * above the bar.** That is a real narrowing of a shipped feature and it is named
 * in ADR-0035 §6 rather than discovered later; the e2e's witness step had to
 * start answering precisely, which is how it surfaced.
 *
 * ## Why the map unlock moves with it, and why that is one change and not two
 *
 * `unlocks: 'importRadius'` draws the subject's whole cone, which is a superset
 * of the answer key. Withholding the words while drawing the picture changes
 * nothing at all — the player reads the answer off the map — so the notes, the
 * summary sentence and the unlock have to move together or the fix is theatre.
 * That coupling is the reason this is a policy over a whole `Reveal` rather than
 * a filter on its notes.
 *
 * ## The cost, which is real
 *
 * A player who reasons badly learns least: below the bar they get the score and
 * its arithmetic and no per-candidate lesson. That is the opposite of what a
 * teaching tool wants, and it is accepted because the alternative measured worse
 * — the reveal is *the* teaching surface, and while select-all buys it outright
 * there is no reason for anyone to reason at all. Re-answering costs nothing and
 * the bar is reachable by picking **fewer** things, which is the behaviour the
 * board wants anyway.
 *
 * ## Guardrail 6
 *
 * *"Never punish a wrong answer: no score penalty, no fail state, no lockout."*
 * This is none of those. The score is untouched, nothing is locked, and the
 * board can be answered again immediately at no cost. What it does is decline to
 * *hand over* something, which is the difference between a game that teaches and
 * a game that fills in its own answer sheet. The cost is real and stated in
 * ADR-0035: the player who reasons worst learns least, and the counts and the
 * grade's arithmetic are what they get instead.
 */

import type { Grade, Reveal } from './types.js';

/**
 * The precision an answer must reach for the board to explain itself.
 *
 * Not a round number chosen for its roundness — see the header: select-all's
 * precision is bounded by ADR-0007's three-to-one choice set at ≈ 1/3, measured
 * at a maximum of 0.308 over 792 boards, and this is comfortably above it while
 * still being the point at which *most of what you picked was right*.
 */
export const REVEAL_PRECISION_BAR = 0.5;

/** `correct / picked`, from a grade. Zero picks cannot reach the bar. */
export function precisionOf(grade: Grade): number {
  const picked = grade.correct.length + grade.spurious.length;
  return picked === 0 ? 0 : grade.correct.length / picked;
}

/**
 * The reveal as the player has earned it.
 *
 * Applied once, where the reveal is created, so the panel and the map are
 * handed the *same* object — the property `challenge.ts` already relies on so
 * that "the map and the panel cannot disagree about what was just revealed".
 */
export function asEarned(reveal: Reveal, grade: Grade): Reveal {
  if (precisionOf(grade) >= REVEAL_PRECISION_BAR) return reveal;
  if (reveal.notes.length === 0) return reveal;
  return {
    ...reveal,
    // The verb's own sentence promises what the map is about to draw ("now drawn
    // on the map"), and the map is no longer about to draw it. Replaced rather
    // than appended to, and replaced by a sentence about the *rule* rather than
    // about the relation — which is why a shared module may write it and
    // ADR-0027's seam still holds: nothing here knows what the verb asked.
    summary: earnedSentence(grade),
    notes: [],
    unlocks: 'nothing',
  };
}

function earnedSentence(grade: Grade): string {
  const right = grade.correct.length;
  const wrong = grade.spurious.length;
  return (
    `More of your picks were wrong than right — ${wrong} against ${right} — so this board is ` +
    'not explained here. Pick fewer and more carefully and every choice gets its reason. ' +
    'Answer again whenever you like; nothing is locked.'
  );
}
