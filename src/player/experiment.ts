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

/** Which of the three views is on screen right now. */
export type View = 'map' | 'orbit' | 'world';

/**
 * The HUD's control line, for an arm **and a view**.
 *
 * The view half was missing, and a playtester measured what that cost: in the
 * walkable world this line still read `f fit · n north · o orbit · g walk`
 * while `f` and `n` are **dead there** (canvas hash unchanged across both) and
 * `g` means *map*, not *walk*; in the orbit it offered `o orbit` while already
 * in the orbit. So the rule this file states for locked arms — *do not
 * advertise a key that does nothing* — was being broken by the **unlocked**
 * session, which is the ordinary player and everyone outside the experiment.
 * `main.ts`'s own comment says a keypress that does nothing and says nothing
 * *"reads as a broken control rather than as a refusal"*.
 *
 * A locked arm additionally loses the two keys that would leave it.
 */
export function keyHintFor(arm: Arm | null, view: View): string {
  return controlsFor(arm, view)
    .filter((control) => control.brief !== null)
    .map((control) => `${control.keys} ${control.brief ?? ''}`)
    .join(' · ');
}

/** One control, as the HUD's line and the help card both need it. */
export interface Control {
  /** How the key or gesture is written. */
  readonly keys: string;
  /** The single word the HUD's line uses. `null` keeps it off that line. */
  readonly brief: string | null;
  /** What it does, in a sentence, for the help card. */
  readonly what: string;
}

/**
 * Every control live in this arm and this view, in the order they are offered.
 *
 * **One list, two surfaces, and that is the whole reason this exists.** The HUD
 * line is a projection of this (`keyHintFor`), and the help card is the same
 * list unfiltered. Before it, the short line was the *only* enumeration of the
 * controls and the mouse gestures were written down nowhere at all — a cold
 * playtester scored the controls 6 out of 10 and never found that the flat map
 * could be panned from the keyboard, because it could not.
 *
 * The rule the header states applies to the card exactly as it does to the
 * line: **do not advertise a key this arm has disabled.** A second hand-kept
 * list would break it the first time an arm changed, which is the failure this
 * file already has one screenshot of.
 */
export function controlsFor(arm: Arm | null, view: View): readonly Control[] {
  const controls: Control[] = [];
  if (view === 'orbit') controls.push({ keys: 'drag', brief: 'turn', what: 'Turn the world.' });
  if (view === 'world') {
    controls.push(
      { keys: 'wasd', brief: 'move', what: 'Walk. Hold shift to run.' },
      { keys: 'q/e', brief: 'turn', what: 'Turn on the spot.' },
    );
  } else {
    // `f` and `n` are the flat map's and the orbit's; the world has neither.
    controls.push(
      {
        keys: 'f',
        brief: 'fit',
        what: 'Fit the whole map on screen — at the heading you are on, never back to north.',
      },
      { keys: 'n', brief: 'north', what: 'Face north again.' },
      {
        keys: 'arrows',
        brief: null,
        what: 'Pan, in the direction the screen is pointing rather than the map.',
      },
      { keys: '+ / −', brief: null, what: 'Zoom about the middle of the view.' },
      { keys: 'drag', brief: null, what: 'Pan. Hold shift to turn the map by hand.' },
      { keys: 'scroll', brief: null, what: 'Zoom about the pointer.' },
      { keys: 'click', brief: null, what: 'Survey a file — its name, its size and what imports it.' },
    );
  }
  if (arm === null) {
    // Where each key goes *from here*, not a fixed list: `o` returns to the map
    // from the orbit, and `g` returns to the map from the world.
    controls.push(
      view === 'orbit'
        ? { keys: 'o', brief: 'map', what: 'Back to the flat map.' }
        : { keys: 'o', brief: 'orbit', what: 'Stand the map up and turn it. Height is how much depends on a file.' },
      view === 'world'
        ? { keys: 'g', brief: 'map', what: 'Back to the flat map.' }
        : { keys: 'g', brief: 'walk', what: 'Walk the city. Roads are imports; buildings are files.' },
    );
  }
  controls.push(
    view === 'world'
      ? { keys: 'enter', brief: 'open', what: 'Open the board you are standing at.' }
      : { keys: 'enter', brief: 'ask', what: 'Ask about the file you have selected.' },
    { keys: '?', brief: 'keys', what: 'Show this card. Escape closes it.' },
  );
  return controls;
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
export const LOCKED_KEYS: readonly string[] = ['o orbit', 'o map', 'g walk', 'g map'];
