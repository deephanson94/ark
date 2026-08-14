/**
 * The challenge console — NORTH-STAR §9.
 *
 * A modal **over** the map, never instead of it: the scrim is translucent and
 * the world stays visible behind it, so the player never loses the spatial
 * context they spent the session building. Nothing here pans or re-frames the
 * camera either — you clicked that node, so it is already where you were
 * looking, and a jump would undo the one thing the fixed layout exists to give
 * you.
 *
 * This file knows nothing about what any verb asks. It looks the verb up in
 * `VERBS` and asks it for its wording, its grade and its reveal. That is the
 * seam CLAUDE.md means by "adding a verb must not require editing the console"
 * — and M4 is where the claim was tested: adding Companion needed `reveal` and
 * the summary sentence moved onto the `Verb` contract, because both were being
 * imported straight out of `blastRadius/`. Nothing below names a verb now.
 *
 * Guardrail 6 is visible in the copy, not just in the arithmetic: there is no
 * fail state, wrong picks cost nothing, and the reveal fires on every grade
 * whatever it scored.
 */

import type { AtlasId, Challenge } from '../atlas/index.js';
import type { Grade, NoteRegister, Reveal, RevealNote } from '../verbs/index.js';
import { VERBS, bandFor, memberLabel, wordsFor } from '../verbs/index.js';
import type { Scene } from './scene.js';
import { el } from './ui.js';

const BAND_LABEL: Readonly<Record<string, string>> = {
  S: 'exact',
  A: 'strong',
  B: 'solid',
  C: 'passed',
  incomplete: 'not yet',
};

/**
 * What the map needs to draw the board that is open.
 *
 * **Ids, never refs, and never a verb.** The console has not known what a verb
 * asks since ADR-0027 and does not start here: it says *these ids are on the
 * board and these are ticked*, and the shell resolves whichever of them have a
 * place. Half of them will not — Placement's subject is a commit and
 * Archaeology's candidates are — which is the union ADR-0018 made real and the
 * landmine about `AtlasId` being an alias for `string`.
 */
export interface BoardView {
  readonly subject: AtlasId;
  readonly candidates: readonly AtlasId[];
  readonly picked: ReadonlySet<AtlasId>;
  /** The row under the pointer, so the map can answer "which one is that?". */
  readonly hovered: AtlasId | null;
}

export interface Console {
  readonly root: HTMLElement;
  open(challenge: Challenge): void;
  close(): void;
  isOpen(): boolean;
  /** The open, unanswered board — `null` while closed or showing a result. */
  board(): BoardView | null;
  /** Tick or untick from outside the panel. What a click on the map calls. */
  toggle(id: AtlasId): void;
  /** Point at a candidate from outside, or clear it. */
  setHovered(id: AtlasId | null): void;
}

export interface ConsoleHandlers {
  /** Fired once per submitted answer, before the player closes the panel. */
  /**
   * Fold the grade into the record, and say which register it landed in.
   *
   * The return value is the one fact the console cannot work out for itself:
   * whether this board had already been answered, which is what decides whether
   * a passing answer *proves* anything (ADR-0047). `null` means it did not pass.
   */
  onGraded(challenge: Challenge, grade: Grade, reveal: Reveal): NoteRegister | null;
  onClose(): void;
  /**
   * The board's picks or pointer moved, so the frame behind is stale.
   *
   * The console does not draw the map and the map does not read the console:
   * this is the one edge between them, and it carries "something changed"
   * rather than what.
   */
  onBoardChanged(): void;
}

export function createConsole(scene: Scene, handlers: ConsoleHandlers): Console {
  const body = el('div', 'console-body');
  const panel = el('section', 'console-panel', [body]);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const root = el('div', 'console-scrim', [panel]);
  root.hidden = true;

  let open: Challenge | null = null;
  /**
   * The live board, or `null` once it has been answered.
   *
   * Cleared on `renderResult` as well as on `close`, because a graded board's
   * markers on the map would be the answer key drawn on the ground — the reveal
   * has just named the truth set, and ADR-0008's radius rendering is the gated
   * surface for that, not this one.
   */
  /** `renderQuestion`'s writer, hoisted so `toggle` can reach it. */
  let pick: ((id: AtlasId, on: boolean) => void) | null = null;
  let live: {
    challenge: Challenge;
    picked: Set<AtlasId>;
    hovered: AtlasId | null;
    rows: Map<AtlasId, HTMLButtonElement>;
  } | null = null;

  /**
   * What to print for an id — a file's path, or a commit's date and message.
   *
   * Verb-blind, by prefix. This was `pathOf`, a `refById` lookup falling back to
   * the raw id, which for an Archaeology board means twenty rows reading
   * `c:1a2b3c4d5e6f`. Choosing the format by *id kind* rather than by verb is
   * ADR-0018 decision 1 applied to display: the console still does not know what
   * any verb asks.
   */
  const labelOf = (id: AtlasId): string => memberLabel(scene.graph, id);
  // The same vocabulary the inspector uses, so the button that opens a question
  // and the question itself cannot disagree about what its answers are.
  const words = wordsFor(scene.graph);

  const close = (): void => {
    open = null;
    live = null;
    pick = null;
    root.hidden = true;
    body.replaceChildren();
    handlers.onClose();
  };

  // **Clicking the map no longer discards the board.** The scrim used to close
  // on any pointerdown that reached it, and the map is *behind* the scrim — so
  // the most natural act available during a challenge (look at the thing the
  // question is about) threw away the answer, silently, with no confirmation.
  // A playtester hit it doing exactly that. The scrim is now pointer-
  // transparent (`styles.css`) so those events reach the canvas instead, and
  // the ways out of a board are the ones that say they are: Escape, and the
  // panel's own control.

  function renderQuestion(challenge: Challenge): void {
    const verb = VERBS[challenge.verb];
    const prompt = verb.prompt(challenge, words);
    const picked = new Set<AtlasId>();
    const buttons = new Map<AtlasId, HTMLButtonElement>();
    live = { challenge, picked, hovered: null, rows: buttons };

    // Sorted by the label, which means alphabetically for files and — because a
    // commit label leads with its date — chronologically for commits. That is
    // the ordering a list of events is read in, and it is not a giveaway kept
    // by accident: every row shows its date whatever the order, so the "tick the
    // oldest K" guess exists either way and `oldestK` scores and refuses it.
    const rows = [...challenge.candidates]
      .map((id) => ({ id, label: labelOf(id) }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

    const submit = el('button', 'console-submit', ['Submit']);
    submit.type = 'button';
    const tally = el('div', 'console-tally');

    /** One writer for the tick, so a map click and a row click cannot diverge. */
    const setPicked = (id: AtlasId, on: boolean): void => {
      if (on) picked.add(id);
      else picked.delete(id);
      const button = buttons.get(id);
      if (button !== undefined) {
        button.classList.toggle('is-picked', on);
        button.setAttribute('aria-pressed', String(on));
      }
      refresh();
      handlers.onBoardChanged();
    };
    pick = setPicked;

    const refresh = (): void => {
      tally.textContent =
        picked.size === 0 ? 'nothing selected' : `${picked.size} selected`;
      submit.disabled = picked.size === 0;
    };

    const list = el('ul', 'console-choices');
    for (const row of rows) {
      const box = el('span', 'choice-box');
      const item = el('li', 'choice');
      const button = el('button', 'choice-button', [box, el('span', 'choice-path', [row.label])]);
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        setPicked(row.id, !picked.has(row.id));
      });
      // Pointing at a row points at it on the map. The panel used to highlight
      // only the row, which is the whole complaint in one behaviour: the list
      // and the map were two documents rather than one instrument.
      button.addEventListener('pointerenter', () => {
        if (live !== null) live.hovered = row.id;
        handlers.onBoardChanged();
      });
      button.addEventListener('pointerleave', () => {
        if (live !== null && live.hovered === row.id) live.hovered = null;
        handlers.onBoardChanged();
      });
      buttons.set(row.id, button);
      item.append(button);
      list.append(item);
    }

    submit.addEventListener('click', () => {
      const grade = verb.grade(challenge, { picked: [...picked] });
      // The reveal is computed once and handed on, so the map and the panel
      // cannot disagree about what was just revealed.
      //
      // **Every answer gets it, and ADR-0047 is why the gate that used to sit
      // here is gone.** ADR-0035 withheld the reveal below a precision bar, to
      // stop select-all buying the answer key. It could not: a single-pick
      // answer scores above zero exactly when the pick is in the key, so the
      // *score* is a membership oracle and guardrail 6 makes retries free. Worse,
      // the gate's own showcase case was the exploit — pick one file correctly,
      // take precision 1.0, get the whole annotated key and the drawn cone
      // without passing, reopen and type it back. What is defended instead is
      // the ledger: `applyGrade` mints proof only on a board's first submission.
      const reveal = verb.reveal(scene.atlas, scene.graph, challenge, grade);
      const register = handlers.onGraded(challenge, grade, reveal);
      renderResult(challenge, grade, reveal, register);
    });

    body.replaceChildren(
      header(prompt.title, challenge.difficulty),
      el('h2', 'console-question', [prompt.question]),
      el('p', 'console-instruction', [prompt.instruction]),
      list,
      el('div', 'console-footer', [tally, submit]),
    );
    refresh();
  }

  function renderResult(
    challenge: Challenge,
    grade: Grade,
    reveal: Reveal,
    register: NoteRegister | null,
  ): void {
    // The board is over: its markers come off the map before the reveal names
    // the truth set.
    live = null;
    pick = null;
    const band = bandFor(grade.score);
    const verb = VERBS[challenge.verb];

    const score = el('div', `console-score band-${band}`, [
      el('span', 'score-band', [band === 'incomplete' ? '·' : band]),
      el('span', 'score-value', [`${Math.round(grade.score * 100)}%`]),
      el('span', 'score-label', [BAND_LABEL[band] ?? band]),
    ]);

    const done = el('button', 'console-submit', ['Back to the map']);
    done.type = 'button';
    done.addEventListener('click', close);

    body.replaceChildren(
      header(verb.prompt(challenge, words).title, challenge.difficulty),
      el('h2', 'console-question', [reveal.subject]),
      score,
      // `evidence` is assembled from the measured result inside `grade()`, so
      // it cannot drift out of sync with the number above it.
      el('p', 'console-evidence', [grade.evidence]),
      // Written by the verb, for the same reason as the reveal itself: only
      // the verb knows what its answer key sampled away.
      el('p', 'console-instruction', [reveal.summary]),
      notes(reveal.notes),
      // **Said here as well as in the notebook, because this is where it is
      // acted on.** A pass on a board that had already explained itself is a
      // pass — the deck retires, the map draws — and it does not prove
      // anything, which the notebook records and this is the only surface that
      // can say *why* while the reason is still on screen. About the rule, so
      // the console still knows nothing about verbs.
      ...(register === 'shown'
        ? [
            el('p', 'console-register', [
              'Recorded as shown rather than proved — this board had already ' +
                'explained itself. The first answer is the one that counts as knowledge.',
            ]),
          ]
        : []),
      el('div', 'console-footer', [el('div', 'console-tally', []), done]),
    );
  }

  function notes(items: readonly RevealNote[]): HTMLElement {
    const list = el('ul', 'console-notes');
    for (const note of items) {
      const text = el('span', 'note-text', [
        el('span', 'note-path', [note.label]),
        el('span', 'note-why', [note.note]),
      ]);
      // The negative witness, when the verb is willing to state it: why the
      // *board* offered this, as against what is true of it. A different claim
      // from `note` and so a separate line — and the console still learns
      // nothing about verbs, because the sentence arrived written.
      if (note.witness !== null) {
        text.append(el('span', 'note-witness', [`Offered as ${note.witness}.`]));
      }
      list.append(
        el('li', `note note-${note.kind}`, [
          el('span', 'note-mark', [
            note.kind === 'correct' ? '✓' : note.kind === 'missed' ? '↯' : '✗',
          ]),
          text,
        ]),
      );
    }
    return list;
  }

  function header(title: string, difficulty: number): HTMLElement {
    const pips = el('span', 'console-pips');
    const filled = Math.max(1, Math.round(difficulty * 5));
    for (let i = 0; i < 5; i++) {
      pips.append(el('span', i < filled ? 'pip is-on' : 'pip'));
    }
    // **No internal document reference in a user-facing tooltip.** Two
    // playtesters found `NORTH-STAR §8.4` here and both filed it; a player has
    // no §8.4. What the number means is worth saying, and it is the honest
    // thing about it: nobody chose this, it was computed from the board.
    pips.title = `difficulty ${difficulty.toFixed(2)} — computed from the graph, not chosen`;

    const dismiss = el('button', 'console-close', ['✕']);
    dismiss.type = 'button';
    dismiss.title = 'close (esc)';
    dismiss.addEventListener('click', close);

    return el('div', 'console-head', [el('span', 'console-verb', [title]), pips, dismiss]);
  }

  return {
    root,
    open(challenge) {
      open = challenge;
      root.hidden = false;
      renderQuestion(challenge);
      const first = panel.querySelector('.choice-button');
      if (first instanceof HTMLElement) first.focus();
    },
    close,
    isOpen: () => open !== null,
    board: () =>
      live === null
        ? null
        : {
            subject: live.challenge.subject,
            candidates: live.challenge.candidates,
            picked: live.picked,
            hovered: live.hovered,
          },
    toggle: (id) => {
      // Only a candidate of the open board, and only while it is unanswered —
      // the map hands in whatever the pointer found and this is where that is
      // checked, rather than trusting the caller.
      if (live === null || pick === null) return;
      if (!live.challenge.candidates.includes(id)) return;
      pick(id, !live.picked.has(id));
    },
    setHovered: (id) => {
      if (live === null) return;
      live.hovered = id !== null && live.challenge.candidates.includes(id) ? id : null;
      handlers.onBoardChanged();
    },
  };
}
