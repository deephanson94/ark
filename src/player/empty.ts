/**
 * What the panels say when there is nothing to say — the three sentences a
 * player sees over a deck that is empty, and the one thing they must never do,
 * which is agree with each other about *why*.
 *
 * **This is a module because the wiring was the untested half.** ADR-0025 fixed
 * the guide and the HUD saying *"every question answered"* over a repo that was
 * never asked one, and a post-ship review then showed the repair itself was
 * unprotected: reverting the guide's branch left **every suite green** — 606
 * unit tests, 102 atlas tests, a clean build — because a sentence assembled
 * inside a DOM callback is reachable by nothing the fast suite can run, and
 * `vitest.config.ts` has no DOM environment. A repair to a defect the ADR calls
 * *"the last hiding place"* could therefore return silently.
 *
 * `src/player/` is imperative shell by convention (`CLAUDE.md`) and the pure
 * core is what gets tested, so the decision moves here and the callbacks keep
 * only the assignment. Nothing in this file touches the DOM.
 */

/** A control's label and the line under it. */
export interface EmptyState {
  readonly label: string;
  readonly caption: string;
}

/**
 * The "Where next?" panel with no question left to suggest.
 *
 * **Two states, and merging them is the defect.** `refusal` non-null means the
 * indexer generated no deck at all because the map is not a map of the
 * repository (ADR-0025); null means the player has answered everything. Both
 * arrive here as "no next challenge", and only one of them is an achievement.
 */
export function guideExhausted(refusal: string | null): EmptyState {
  if (refusal !== null) return { label: 'no questions for this repo', caption: refusal };
  // Derived, never canned: the pointer is the only true thing left to say — a
  // newer HEAD generates a new deck.
  return { label: 'every question answered', caption: 'Reindex at a newer commit for more.' };
}

/**
 * The HUD's question count — the same fork, one panel over and in different
 * words, which is how it survived the first repair.
 *
 * `ringed` is how many of the remaining questions have a place on the map. It
 * can be lower than `questionsLeft` because a commit subject carries no ring
 * (ADR-0018), and the short form is kept for the case where they agree, which
 * is most of a session.
 */
export function questsLine(deckRefused: boolean, questionsLeft: number, ringed: number): string {
  if (deckRefused) return 'no questions for this repo';
  if (questionsLeft === 0) return 'every question answered';
  const plural = questionsLeft === 1 ? '' : 's';
  if (ringed === questionsLeft) return `${questionsLeft} question${plural} ringed on the map`;
  return `${questionsLeft} left · ${ringed} ringed on the map`;
}

/**
 * The field notes with nothing in them.
 *
 * The weakest of the three and still worth the fork: over a refused repo,
 * *"answer a question and what you establish is written down here"* invites an
 * action the product does not have.
 */
export function notesEmpty(deckRefused: boolean): string {
  if (deckRefused) {
    return (
      'Nothing to prove here. Ark could not read enough of this repository ' +
      'to ask a question about it, so there is nothing to write down.'
    );
  }
  return (
    // **This used to end *"only what you proved, never what you were shown"*,
    // and ADR-0047 made it false in the same commit that made it checkable one
    // click later**: a board answered a second time writes a note that opens
    // *"You were shown…"*, by design, because that is §9's other register and
    // the notebook is where the distinction is kept rather than hidden. The
    // sentence now says what the page will actually show.
    'Nothing here yet. Answer a question and what you establish is written down — ' +
    'and each note says whether you proved it or were shown it.'
  );
}
