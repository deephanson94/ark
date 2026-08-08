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
import type { Grade, Reveal, RevealNote } from '../verbs/index.js';
import { VERBS, bandFor, memberLabel } from '../verbs/index.js';
import type { Scene } from './scene.js';
import { el } from './ui.js';

const BAND_LABEL: Readonly<Record<string, string>> = {
  S: 'exact',
  A: 'strong',
  B: 'solid',
  C: 'passed',
  incomplete: 'not yet',
};

export interface Console {
  readonly root: HTMLElement;
  open(challenge: Challenge): void;
  close(): void;
  isOpen(): boolean;
}

export interface ConsoleHandlers {
  /** Fired once per submitted answer, before the player closes the panel. */
  onGraded(challenge: Challenge, grade: Grade, reveal: Reveal): void;
  onClose(): void;
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
   * What to print for an id — a file's path, or a commit's date and message.
   *
   * Verb-blind, by prefix. This was `pathOf`, a `refById` lookup falling back to
   * the raw id, which for an Archaeology board means twenty rows reading
   * `c:1a2b3c4d5e6f`. Choosing the format by *id kind* rather than by verb is
   * ADR-0018 decision 1 applied to display: the console still does not know what
   * any verb asks.
   */
  const labelOf = (id: AtlasId): string => memberLabel(scene.graph, id);

  const close = (): void => {
    open = null;
    root.hidden = true;
    body.replaceChildren();
    handlers.onClose();
  };

  root.addEventListener('pointerdown', (event) => {
    if (event.target === root) close();
  });

  function renderQuestion(challenge: Challenge): void {
    const verb = VERBS[challenge.verb];
    const prompt = verb.prompt(challenge, labelOf);
    const picked = new Set<AtlasId>();

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
        if (picked.has(row.id)) picked.delete(row.id);
        else picked.add(row.id);
        const on = picked.has(row.id);
        button.classList.toggle('is-picked', on);
        button.setAttribute('aria-pressed', String(on));
        refresh();
      });
      item.append(button);
      list.append(item);
    }

    submit.addEventListener('click', () => {
      const grade = verb.grade(challenge, { picked: [...picked] });
      // The reveal is computed once and handed on, so the map and the panel
      // cannot disagree about what was just revealed.
      const reveal = verb.reveal(scene.atlas, scene.graph, challenge, grade);
      handlers.onGraded(challenge, grade, reveal);
      renderResult(challenge, grade, reveal);
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

  function renderResult(challenge: Challenge, grade: Grade, reveal: Reveal): void {
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
      header(verb.prompt(challenge, labelOf).title, challenge.difficulty),
      el('h2', 'console-question', [reveal.subject]),
      score,
      // `evidence` is assembled from the measured result inside `grade()`, so
      // it cannot drift out of sync with the number above it.
      el('p', 'console-evidence', [grade.evidence]),
      // Written by the verb, for the same reason as the reveal itself: only
      // the verb knows what its answer key sampled away.
      el('p', 'console-instruction', [reveal.summary]),
      notes(reveal.notes),
      el('div', 'console-footer', [el('div', 'console-tally', []), done]),
    );
  }

  function notes(items: readonly RevealNote[]): HTMLElement {
    const list = el('ul', 'console-notes');
    for (const note of items) {
      list.append(
        el('li', `note note-${note.kind}`, [
          el('span', 'note-mark', [
            note.kind === 'correct' ? '✓' : note.kind === 'missed' ? '↯' : '✗',
          ]),
          el('span', 'note-text', [
            el('span', 'note-path', [note.label]),
            el('span', 'note-why', [note.note]),
          ]),
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
    pips.title = `computed difficulty ${difficulty.toFixed(2)} — NORTH-STAR §8.4`;

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
  };
}
