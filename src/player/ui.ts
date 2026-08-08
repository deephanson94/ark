/**
 * The DOM overlay: a small element factory and the two panels that sit over the
 * map.
 *
 * No framework (NORTH-STAR §10). Imperative UI at interaction rates does not
 * need a reconciler, and the player's runtime dependency budget is three — a
 * number chosen to make exactly this point.
 *
 * Everything shown here is a *derived fact*: a count, a date, a path that came
 * out of the atlas. Nothing is authored per repo (guardrail 2), and nothing is
 * inferred — if the panel says 14 dependents, a graph query said 14.
 */

import type { Atlas, AtlasNode, Challenge } from '../atlas/index.js';
import type { FieldNote } from './notes.js';
import { noteProse } from './notes.js';
import { VERBS } from '../verbs/index.js';
import type { Coverage } from './fog.js';
import { regionColor } from './palette.js';
import type { Radius, Scene, SceneNode } from './scene.js';

type Children = readonly (Node | string)[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  children: Children = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  for (const child of children) node.append(child);
  return node;
}

function field(label: string, value: string, title?: string): HTMLElement {
  const row = el('div', 'field');
  const key = el('span', 'field-key', [label]);
  const val = el('span', 'field-value', [value]);
  if (title !== undefined) val.title = title;
  row.append(key, val);
  return row;
}

export interface Hud {
  readonly root: HTMLElement;
  update(
    coverage: Coverage,
    level: string,
    stats: string,
    questionsLeft: number,
    bearing: number,
  ): void;
}

export interface GuideView {
  /** `null` when every question has been passed. */
  readonly next: Challenge | null;
  /** The suggestion's display name. */
  readonly path: string | null;
  /** True when the player is already standing on the suggestion. */
  readonly arrived: boolean;
  readonly questionsLeft: number;
}

export interface Guide {
  readonly root: HTMLElement;
  update(view: GuideView): void;
}

/**
 * "Where next?" — the progression affordance.
 *
 * It **takes you to a landmark; it does not open a question**. §4's loop is
 * "pick a landmark", and ADR-0011 is explicit that suggested-next is an
 * affordance and not a mode: sending the player straight into a modal would
 * quietly turn a cartography game into a quiz deck, which nothing in the spec
 * licenses. So the button pans the map, selects the subject, and leaves the
 * existing "answer this" control one keystroke away.
 *
 * The exhausted state is **recomputed every frame, never latched**. A pass can
 * decay (ADR-0011 decision 3) and a reindex can resurrect its question, so a
 * stored "done" would go on lying.
 */
export function createGuide(onSuggest: () => void): Guide {
  const button = el('button', 'guide-action');
  button.type = 'button';
  button.addEventListener('click', onSuggest);
  const caption = el('div', 'guide-caption');
  const root = el('div', 'guide', [button, caption]);
  return {
    root,
    update({ next, path, arrived, questionsLeft }) {
      if (next === null) {
        button.disabled = true;
        button.textContent = 'every question answered';
        // Derived, never canned: the count is the deck's, and the pointer is
        // the only true thing left to say — a newer HEAD generates a new deck.
        caption.textContent = 'Reindex at a newer commit for more.';
        return;
      }
      button.disabled = false;
      // Once you are standing on the suggestion the button has already done its
      // job, and saying "next is draw.ts" while you are on draw.ts reads as a
      // control that did nothing. It stays live — panning away and pressing it
      // brings you back — but it stops pretending there is somewhere to go.
      button.textContent = arrived ? 'Back to the suggestion' : 'Where next?';
      caption.textContent = arrived
        ? `${questionsLeft} left · you are on ${path ?? 'it'}`
        : `${questionsLeft} left · next is ${path ?? 'somewhere'}`;
    },
  };
}

/**
 * The compass — where north went, and the way back.
 *
 * The map turns between challenges (`heading.ts`), which is an intervention on
 * the player's *memory* and must never become an intervention on their ability
 * to find anything: guardrail 6 says a wrong answer takes nothing away, and a
 * world that has silently rotated with no indicator would take away the map. So
 * the dial says which way the atlas's north now points, and clicking it — or
 * pressing `n` — turns back to it.
 *
 * The heading is in the accessible name as well as the dial, because a rotating
 * needle is not a value anything can read: `npm run test:e2e` asserts on this
 * string, and a screen reader gets the same sentence a sighted player infers.
 */
function createCompass(onNorth: () => void): { root: HTMLElement; update(bearing: number): void } {
  const dial = el('div', 'compass-dial', [el('span', 'compass-north', ['N'])]);
  const root = el('button', 'hud-compass', [dial]);
  root.type = 'button';
  root.addEventListener('click', onNorth);
  return {
    root,
    update(bearing) {
      // Normalised only here, at the point of display. The camera's bearing
      // accumulates on purpose so an animation never has to unwrap it.
      const turned = (((bearing * 180) / Math.PI) % 360 + 360) % 360;
      // CSS rotation is clockwise on screen and so is the projection's, so the
      // dial's angle *is* the bearing — the 'N' ends up where the atlas's north
      // ends up. No sign to get wrong, which is why the dial is not a canvas.
      dial.style.transform = `rotate(${turned.toFixed(1)}deg)`;
      const label = `turned ${Math.round(turned)}° — click to face north`;
      root.title = label;
      root.setAttribute('aria-label', label);
    },
  };
}

export function createHud(
  atlas: Atlas,
  onNorth: () => void,
  extra: readonly Node[] = [],
): Hud {
  const title = el('div', 'hud-title', [atlas.repo.name]);
  const head = el('div', 'hud-sub', [
    atlas.repo.head === null
      ? 'no commits — history tiers unavailable'
      : `${atlas.repo.head.slice(0, 12)} · ${atlas.repo.headDate ?? ''}`,
  ]);
  const progress = el('div', 'hud-progress');
  const bar = el('div', 'hud-bar');
  progress.append(bar);
  const counts = el('div', 'hud-counts');
  const quests = el('div', 'hud-quests');
  const detail = el('div', 'hud-detail');
  // A feature reachable only by reading the source does not exist. `f` was
  // already undiscoverable; `o` would have shipped the same way.
  const keys = el('div', 'hud-keys', ['f fit · n north · o orbit · enter ask']);
  const compass = createCompass(onNorth);

  const root = el('div', 'hud', [
    title,
    head,
    progress,
    counts,
    quests,
    detail,
    keys,
    compass.root,
    ...extra,
  ]);

  return {
    root,
    update(coverage, level, stats, questionsLeft, bearing) {
      compass.update(bearing);
      bar.style.width = `${(coverage.fraction * 100).toFixed(1)}%`;
      // Two numbers, deliberately separate. Surveyed is what you have looked
      // at; understood is what you have proven. Only the second lifts the fog
      // for real, which is why the bar tracks it and not the larger number.
      counts.textContent = `${coverage.understood} understood · ${coverage.surveyed} surveyed · ${coverage.total} files`;
      // Short enough not to wrap in a 296 px panel: the first version read
      // "N questions left — ringed on the map", took two lines, and pushed the
      // stats line into a third.
      quests.textContent =
        questionsLeft === 0
          ? 'every question answered'
          : `${questionsLeft} question${questionsLeft === 1 ? '' : 's'} ringed on the map`;
      detail.textContent = `${level} · ${stats}`;
    },
  };
}

export interface InspectorView {
  readonly node: SceneNode | null;
  readonly radius: Radius | null;
  /**
   * True when the player has proved they know this node's **import radius** —
   * i.e. passed a Blast Radius question about it. Gates the transitive count
   * below, and nothing else.
   */
  readonly understood: boolean;
  /** The question this node carries, if any. */
  readonly challenge: Challenge | null;
  /** True when `challenge` has already been passed. Labels the button. */
  readonly answered: boolean;
}

export interface Inspector {
  readonly root: HTMLElement;
  show(view: InspectorView): void;
}

export function createInspector(
  scene: Scene,
  onChallenge: (challenge: Challenge) => void,
): Inspector {
  const empty = el('div', 'inspector-empty', [
    'Click a landmark to survey it. Hover to see what imports it — the rest of the radius is earned.',
  ]);
  const body = el('div', 'inspector-body');
  const root = el('aside', 'inspector', [empty, body]);

  return {
    root,
    show({ node, radius, understood, challenge, answered }) {
      body.replaceChildren();
      empty.style.display = node === null ? 'block' : 'none';
      if (node === null) return;

      const atlasNode: AtlasNode | undefined = scene.atlas.nodes[node.ref];
      if (atlasNode === undefined) return;

      const dependencies = (scene.graph.out[node.ref] ?? []).length;
      const region = scene.regions[node.regionIndex];

      body.append(
        el('h2', 'inspector-path', [atlasNode.path]),
        field('region', region?.label ?? atlasNode.region),
        field('lines', String(atlasNode.loc)),
        field('imports', String(dependencies)),
        // "imported by", not "depended on by": the second reads as transitive,
        // and this number is the direct in-degree. On a repo with a barrel the
        // two differ by an order of magnitude, and conflating them is the exact
        // mistake the verb exists to correct.
        field('imported by', String(node.dependentCount)),
      );

      // What the map is allowed to tell you before you have proved anything.
      //
      // M1 printed `blast radius (≤3 hops): 38 files` here for every node, which
      // is the answer to the question the game is about to ask — handed over on
      // hover, involuntarily, to a player who never chose to cheat. ADR-0008
      // decision 1: direct importers are free (they are drawn on the canvas
      // already, and §8.4 measures `surprise` against exactly that guess); the
      // transitive count is a fact you earn by passing this node's challenge.
      if (understood && radius !== null && radius.subject === node.ref) {
        body.append(
          field(
            'blast radius',
            `${radius.dependents.size} file${radius.dependents.size === 1 ? '' : 's'}`,
          ),
        );
      }

      if (atlasNode.originPath !== atlasNode.path) {
        // Rename lineage is a fact worth surfacing: this file is older than its
        // path suggests, which is exactly the kind of thing a newcomer misses.
        body.append(field('was', atlasNode.originPath));
      }

      if (scene.atlas.history.present) {
        body.append(
          field('commits', String(atlasNode.churn)),
          field('authors', String(atlasNode.authors)),
          field('first seen', atlasNode.firstSeen ?? '—'),
          field('last seen', atlasNode.lastSeen ?? '—'),
        );
      }

      if (atlasNode.exports.length > 0) {
        body.append(
          field(
            'exports',
            atlasNode.exports.length > 4
              ? `${atlasNode.exports.slice(0, 4).join(', ')} +${atlasNode.exports.length - 4}`
              : atlasNode.exports.join(', '),
            atlasNode.exports.join('\n'),
          ),
        );
      }

      if (challenge !== null) {
        // The verb names its own question. This button read "Map its blast
        // radius" for *every* challenge until M4, so a Companion question was
        // opened by a control promising an import radius — the console's
        // verb-blindness held, and the inspector's did not. Nothing in the test
        // suite noticed; it was visible in the e2e screenshot.
        const action = el('button', 'inspector-action', [
          answered ? 'Ask it again' : VERBS[challenge.verb].prompt(challenge, (id) => id).action,
        ]);
        action.type = 'button';
        action.addEventListener('click', () => onChallenge(challenge));
        body.append(action, el('div', 'inspector-hint', ['or press enter']));
      }

      if (atlasNode.unresolved.length > 0) {
        // Guardrail 4 made visible: these are the imports we could not pin
        // down, and their presence is why this file may carry no challenge.
        const warn = el('div', 'inspector-warn', [
          `${atlasNode.unresolved.length} unresolved import${atlasNode.unresolved.length === 1 ? '' : 's'} — ground truth here is incomplete`,
        ]);
        warn.title = atlasNode.unresolved.join('\n');
        body.append(warn);
      }
    },
  };
}

export function createError(message: string): HTMLElement {
  return el('div', 'fatal', [el('h1', undefined, ['This atlas will not load']), el('pre', undefined, [message])]);
}

export function createLegend(scene: Scene): HTMLElement {
  const items = scene.regions.map((region) => {
    const swatch = el('span', 'legend-swatch');
    // Straight from the same function the canvas uses — a legend that computes
    // its own colours is a legend that will eventually disagree with the map.
    swatch.style.background = regionColor(region.index, 1);
    return el('li', 'legend-item', [swatch, `${region.label} (${region.nodeCount})`]);
  });
  return el('div', 'legend', [
    el('div', 'legend-title', ['regions']),
    el('ul', 'legend-list', items),
  ]);
}

export interface Notebook {
  readonly root: HTMLElement;
  readonly toggle: HTMLElement;
  isOpen(): boolean;
  close(): void;
  /** Re-render from the current record. Notes are derived, never cached. */
  update(notes: readonly FieldNote[]): void;
}

/**
 * Field notes — NORTH-STAR §9's codex, over the map.
 *
 * Same scrim pattern as the challenge console, for the same reason: the world
 * stays visible and alive behind it, so reading what you know never costs you
 * the spatial context you built it from.
 *
 * Everything here is **re-derived on open**. Nothing about a note is cached,
 * because a claim can decay between sessions and a cached sentence would go on
 * asserting something the graph stopped supporting (ADR-0011 decision 3).
 */
export function createNotebook(): Notebook {
  const list = el('ul', 'notes-list');
  const empty = el('div', 'notes-empty', [
    'Nothing proved yet. Answer a question and what you establish is written down here — ',
    'only what you proved, never what you were shown.',
  ]);
  const heading = el('div', 'notes-title', ['FIELD NOTES']);
  const close = el('button', 'console-close', ['✕']);
  close.type = 'button';
  const head = el('div', 'notes-head', [heading, close]);
  const panel = el('div', 'notes-panel', [head, empty, list]);
  const root = el('div', 'notes-scrim', [panel]);
  root.hidden = true;

  const toggle = el('button', 'hud-notes');
  toggle.type = 'button';
  toggle.textContent = 'field notes';

  // Tracked here rather than read back off `root.hidden`, whose DOM type also
  // admits the string `"until-found"`.
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    root.hidden = !next;
  };
  close.addEventListener('click', () => setOpen(false));
  root.addEventListener('click', (event) => {
    if (event.target === root) setOpen(false);
  });
  toggle.addEventListener('click', () => setOpen(!open));

  return {
    root,
    toggle,
    isOpen: () => open,
    close: () => setOpen(false),
    update(notes) {
      toggle.textContent = notes.length === 0 ? 'field notes' : `field notes (${notes.length})`;
      empty.hidden = notes.length > 0;
      const items = notes.map((note) => {
        const { claim, revealed } = noteProse(note);
        const children: Node[] = [el('div', 'field-note-claim', [claim])];
        // Kept visually and grammatically apart from the claim: one is
        // knowledge, the other is something the map showed you.
        if (revealed !== null) children.push(el('div', 'field-note-revealed', [revealed]));
        return el('li', 'field-note', children);
      });
      list.replaceChildren(...items);
    },
  };
}
