/**
 * The experiment harness — one query parameter, and what it locks.
 *
 * `docs/experiments/0001` is a **between-subjects** design: one participant,
 * one repo, one mode. Nothing in the player enforced that. Every view is one
 * keystroke from every other (`o`, `g`, Escape), so a participant in the map
 * arm who pressed `o` out of curiosity would have silently moved themselves
 * into the orbit arm, and the run would have no way of knowing. An arm that
 * cannot be held is not an arm, so this is a precondition on running the
 * experiment at all rather than a convenience for whoever runs it.
 *
 * `?arm=map | orbit | world` fixes the mode the session starts in and refuses
 * the keys that would leave it. **Absent or unrecognised means today's player,
 * unchanged** — the deployed page has no query string, so nothing about the
 * ordinary product moves.
 *
 * ## Why the world arm's minimap loses its edges
 *
 * ADR-0033 §4 records the confound and frames it as a binary: the inset *"must
 * be present in both arms or in neither"*. Measurement produced a third option
 * and the owner took it (experiment 0001 §4.3). The inset is not showing *more*
 * topology than the world around it — sampling 121 standing positions on the
 * two experiment repos, the world's own view reaches a mean of 98.7% and 99.0%
 * of the edge set — it is showing the *same* topology in the exocentric
 * projection `docs/prior-art.md` §2 says wins. So the world arm contains a
 * small instance of the map arm, and a world win could not be attributed to
 * walking.
 *
 * Dropping the road layer removes exactly the duplicated channel. The dots, the
 * hero arrow, the sight cone and the waypoint stay, because the alternative —
 * no inset at all — costs the arm its orientation support, and disorientation
 * is the confound Richardson et al. 1999 report for virtual-environment
 * traversal. A loss under *that* configuration would be ambiguous in the other
 * direction.
 *
 * **What this buys is attribution, not a shipping decision.** A win here
 * licenses the world with an edgeless minimap, which is not the build that
 * ships today.
 */

/** One arm of `docs/experiments/0001`. */
export type Arm = 'map' | 'orbit' | 'world';

const ARMS: readonly Arm[] = ['map', 'orbit', 'world'];

/**
 * The arm this session is locked to, or `null` for the ordinary player.
 *
 * Deliberately total: an unrecognised value is `null` rather than an error,
 * because the failure a run can afford is "the lock did not engage and the
 * facilitator can see the keys still work", not "the participant's twenty
 * minutes opened on a stack trace".
 */
export function armFromSearch(search: string): Arm | null {
  const value = new URLSearchParams(search).get('arm');
  if (value === null) return null;
  return ARMS.find((arm) => arm === value) ?? null;
}

/**
 * The HUD's control line for an arm.
 *
 * A locked arm must not advertise a key that does nothing: `main.ts`'s own
 * comment about swallowing `o` in the world says a keypress that does nothing
 * and says nothing *"reads as a broken control rather than as a refusal"*, and
 * a participant hunting for a control that has been disabled is spending their
 * twenty minutes on the harness.
 */
export function keyHintFor(arm: Arm | null): string {
  switch (arm) {
    case 'map':
      return 'f fit · n north · enter ask';
    case 'orbit':
      return 'drag turn · enter ask';
    case 'world':
      return 'wasd move · q/e turn · enter ask';
    case null:
      // Unlocked. `g` is listed because the world has shipped since this line
      // was written and a feature reachable only by reading the source does
      // not exist — which is what the comment above this line in `ui.ts`
      // already said about `f` and `o`.
      return 'f fit · n north · o orbit · g walk · enter ask';
  }
}

/**
 * The world's own control line, painted on the canvas rather than in the DOM.
 *
 * **It lives here beside the HUD's line and not next to the code that paints
 * it**, because it is the same rule — *do not advertise a key this arm has
 * disabled* — and the first version of this change implemented that rule in
 * the HUD only. The world then rendered its own hint offering *"g map"* in a
 * locked `?arm=world` session, which a screenshot caught and no assertion
 * would have. A rule that lives twice diverges; this file is where it lives.
 */
export function worldHintFor(arm: Arm | null): string {
  const base = 'WASD move · Q/E turn · shift run · enter open';
  return arm === null ? `${base} · g map` : base;
}

/** Keys a locked arm refuses, as they appear in a hint. For the suite. */
export const LOCKED_KEYS: readonly string[] = ['o orbit', 'g walk', 'g map'];
