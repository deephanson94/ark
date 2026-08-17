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

import type { Atlas, AtlasNode, Challenge, NodeId } from '../atlas/index.js';
import { coverageBadge, coverageSentence, sourceCoverage } from '../atlas/index.js';
import { arrivalLines, arrivalOf } from './arrival.js';
import { guideExhausted, notesEmpty, questsLine } from './empty.js';
import type { Arm, View } from './experiment.js';
import { controlsFor } from './experiment.js';
import type { FieldNote } from './notes.js';
import { noteProse } from './notes.js';
import type { Medal } from './medals.js';
import { earnedCount, provableNodes } from './medals.js';
import { medalSvg, tierPips } from './medalArt.js';
import { VERBS, wordsFor } from '../verbs/index.js';
import { northDegrees } from './camera.js';
import type { Coverage } from './fog.js';
import { regionColor } from './palette.js';
import type { Radius, Scene, SceneNode } from './scene.js';
import { legendRows, provedByRegion } from './scene.js';
import type { TwinClass } from './twins.js';

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

/**
 * Fill `into` with `path`, breakable **at its separators and nowhere else**.
 *
 * A derived region name is often a path — `around src/indexer/build.ts` — and it
 * is wider than a shelf column, so every CSS answer alone is wrong: `nowrap`
 * clipped it to `around src/inde…`, `overflow-wrap: anywhere` broke it *inside*
 * the filename, and `break-word` does the same thing because it also splits a
 * token that cannot fit a line on its own. Six of ten cold playtesters read
 * `around src/indexer/build.t` / `s` and filed it; it survived two CSS fixes.
 *
 * `<wbr>` is the element for this and it adds **nothing** to `textContent`, so a
 * test or an assertion reading the name still sees the string the atlas holds —
 * unlike a zero-width space, which would silently poison every comparison.
 */
function breakablePath(into: HTMLElement, path: string): HTMLElement {
  const parts = path.split('/');
  parts.forEach((part, at) => {
    into.append(at === parts.length - 1 ? part : `${part}/`);
    if (at < parts.length - 1) into.append(document.createElement('wbr'));
  });
  return into;
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
    ringed: number,
    bearing: number,
    /**
     * The control line, recomputed per frame because it is a property of the
     * **view**, not of the session. A playtester measured `f` and `n` as dead
     * in the world while this line still offered both, and `o orbit` while
     * already in the orbit — two of the three views were advertising controls
     * that do nothing.
     */
    keyHint: string,
  ): void;
}

export interface GuideView {
  /** `null` when every question has been passed — or when none was ever asked. */
  readonly next: Challenge | null;
  /**
   * Why this atlas carries no deck at all, when that is why `next` is null.
   *
   * **The two empty states are different claims and the panel must not merge
   * them.** "Every question answered" over a repo that was never asked one is
   * false in the direction this whole rung exists to stop: it reads as a
   * finished game. ADR-0025 refuses a deck when the map is not a map of the
   * repository, and the sentence comes from `src/atlas/coverage.ts` — the same
   * one the indexer printed — so the terminal and the panel cannot drift.
   */
  readonly refusal: string | null;
  /** The suggestion's display name, from the verb that asks about it. */
  readonly path: string | null;
  /**
   * False when the suggestion has no position on the map — a commit subject
   * (ADR-0018), or a node this atlas no longer holds.
   *
   * The control's *action* changes with it, which is the one place ADR-0011's
   * "takes you to a landmark, does not open a question" needs a qualifier: with
   * nowhere to go, panning the map is not a weaker version of the affordance,
   * it is nothing at all. So the button opens the question, and says so, rather
   * than looking live and doing nothing.
   */
  readonly placed: boolean;
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
export function createGuide(onSuggest: () => void, onSkip: () => void): Guide {
  const button = el('button', 'guide-action');
  button.type = 'button';
  button.addEventListener('click', onSuggest);
  /**
   * **"Not this one."** A cold playtester's first three suggestions were the
   * same shape and there was no way past them but to answer one, because *"Where
   * next?"* offered exactly one next. The board is not refused or hidden — it
   * keeps its rank and comes back when the skip list empties (`noteSkip`) — so
   * this is a *preference about the next ten minutes*, which is why it is
   * session-only and never reaches the save.
   */
  const skip = el('button', 'guide-skip', ['not this one']);
  skip.type = 'button';
  skip.title = 'Suggest a different question. Nothing is removed from the deck.';
  skip.addEventListener('click', onSkip);
  const caption = el('div', 'guide-caption');
  const root = el('div', 'guide', [button, skip, caption]);
  return {
    root,
    update({ next, refusal, path, placed, arrived, questionsLeft }) {
      // Nothing to skip *to* when there is nothing left, and a live control that
      // does nothing reads as broken rather than as a refusal (`main.ts`'s own
      // rule about advertising a dead key).
      skip.style.display = next === null ? 'none' : '';
      if (next === null) {
        button.disabled = true;
        // The fork itself lives in `empty.ts` and is unit-tested there. Written
        // inline, the repair to "every question answered over a refused deck"
        // was reachable by no suite at all, so it could return silently.
        const state = guideExhausted(refusal);
        button.textContent = state.label;
        caption.textContent = state.caption;
        return;
      }
      button.disabled = false;
      if (!placed) {
        button.textContent = 'Open the next question';
        caption.textContent = `${questionsLeft} left · next is ${path ?? 'a question with no place on the map'}`;
        return;
      }
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
      // **`northDegrees`, not the same arithmetic written out again.** This line
      // was an inline copy of it for one commit, which made the needle's sign a
      // second implementation of the projection's — and a flip in *this* copy
      // survived the whole suite, because the unit test that checks the needle
      // against the map checks the function the compass was not calling. That
      // is the decoy instrument this compass exists to not be: a dial turning
      // confidently over a map that has not.
      const turned = northDegrees(bearing);
      // CSS rotation is clockwise on screen and so is the projection's, so the
      // dial's angle *is* the bearing — the 'N' ends up where the atlas's north
      // ends up.
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
  // Computed once: it is a property of the repository, not of the frame.
  const answerable = provableNodes(atlas).size;
  const title = el('div', 'hud-title', [atlas.repo.name]);
  const head = el('div', 'hud-sub', [
    atlas.repo.head === null
      ? 'no commits — history tiers unavailable'
      : `${atlas.repo.head.slice(0, 12)} · ${atlas.repo.headDate ?? ''}`,
  ]);
  /**
   * **What this map is missing, said on the map itself.**
   *
   * A count of files, permanently on screen whenever the walk recognised source
   * it could not read — one shell script on this repo, 906 Go files on
   * `gohugoio/hugo`. It is a fact about the atlas and never changes during a
   * session, so unlike everything else in this panel it is computed once.
   *
   * ADR-0025 refuses the *deck* on a threshold; this line has no threshold,
   * because "how much of your repository is on this map" is a measurement and
   * the player is entitled to it whether or not it crossed a bar.
   */
  const source = sourceCoverage(atlas);
  const badgeText = coverageBadge(source);
  const badge = badgeText === null ? null : el('div', 'hud-partial', [badgeText]);
  if (badge !== null) badge.title = coverageSentence(source) ?? '';
  const progress = el('div', 'hud-progress');
  const bar = el('div', 'hud-bar');
  progress.append(bar);
  const counts = el('div', 'hud-counts');
  const quests = el('div', 'hud-quests');
  const detail = el('div', 'hud-detail');
  // A feature reachable only by reading the source does not exist. `f` was
  // already undiscoverable; `o` would have shipped the same way — and `g` did,
  // for a milestone, because this line was not revisited when the world landed.
  // Filled by `update` on every frame: it depends on the view, and two of the
  // three views were advertising keys measured to be dead in them.
  const keys = el('div', 'hud-keys');
  const compass = createCompass(onNorth);

  const root = el('div', 'hud', [
    title,
    head,
    ...(badge === null ? [] : [badge]),
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
    update(coverage, level, stats, questionsLeft, ringed, bearing, keyHint) {
      compass.update(bearing);
      keys.textContent = keyHint;
      bar.style.width = `${(coverage.fraction * 100).toFixed(1)}%`;
      // Two numbers, deliberately separate. Surveyed is what you have looked
      // at; understood is what you have proven. Only the second lifts the fog
      // for real, which is why the bar tracks it and not the larger number.
      counts.textContent = `${coverage.understood} understood · ${coverage.surveyed} surveyed · ${coverage.total} files`;
      // Short enough not to wrap in a 296 px panel: the first version read
      // "N questions left — ringed on the map", took two lines, and pushed the
      // stats line into a third.
      // **Two numbers, because since ADR-0018 they can differ.** A Placement
      // subject is a commit, which carries no ring, so a deck with only those
      // left would have read "36 questions ringed on the map" over a map with
      // none — a sentence about the map, counted off the deck. The short form
      // survives for the case where they agree, which is most of a session.
      // **Three states, not two**, and the fork is in `empty.ts` beside the
      // guide's — they are the same question asked one panel apart, which is
      // how the second one survived the first repair. `deckRefused` is latched
      // from the atlas rather than recomputed because — unlike a pass, which
      // can decay — it cannot change without a reindex.
      // **The provable denominator, not the node count** — the same one the
      // legend's tallies and the medal shelf use. `coverage.total` would read
      // "7 of 271", which is the unreachable-denominator defect this session
      // already fixed in two other places: most nodes carry no board and can
      // never be proved, so counting them makes the arc look smaller than it can
      // ever get. One definition, three readers.
      quests.textContent = questsLine(
        source.deckRefused,
        questionsLeft,
        ringed,
        coverage.understood,
        answerable,
      );
      detail.textContent = `${level} · ${stats}`;
    },
  };
}

/**
 * `a`, `a and b`, `a, b and c`. One place, because the alternative is three
 * call sites that disagree about the last comma.
 */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
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
  /**
   * The twin class this node belongs to, **if it may be named** (ADR-0030).
   *
   * `null` covers both "no twin" and "the gate is closed", and the panel must
   * not be able to tell those apart — a panel that could would be able to
   * render the difference, and the difference is the fact being withheld.
   */
  readonly twins: TwinClass | null;
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
    show({ node, radius, understood, challenge, answered, twins }) {
      body.replaceChildren();
      empty.style.display = node === null ? 'block' : 'none';
      if (node === null) return;

      const atlasNode: AtlasNode | undefined = scene.atlas.nodes[node.ref];
      if (atlasNode === undefined) return;

      // Distinct targets, for the same reason `dependentCount` counts distinct
      // sources: `import { x }` beside `import type { y }` from one module is
      // two edges and one imported file. Both numbers on this panel are counts
      // of files or neither is, and the pair is read as a pair.
      const dependencies = new Set((scene.graph.out[node.ref] ?? []).map((edge) => edge.to)).size;
      const region = scene.regions[node.regionIndex];

      body.append(
        el('h2', 'inspector-path', [atlasNode.path]),
        // **"clusters with", not "region", and the word was the whole defect.**
        // A region is a *derived* cluster — pillar 4, geography is topology — but
        // it is *named* after a directory when one holds at least half of it
        // (`NAMEABLE_SHARE`), so the panel printed `src/indexer/layout.ts` beside
        // `region: scripts` and four cold playtesters read it as the tool
        // claiming the file lives in `scripts/`. One filed it as "regions are
        // mislabelled", one as "the region field lies", and a third said it cost
        // more trust than anything else they saw — while explicitly granting the
        // clustering was probably honest. It was: `layout.ts` really does cluster
        // with the scripts, because the scripts import it.
        //
        // Nothing about the analysis was wrong and nothing about it changed. A
        // locational noun beside a directory-shaped value asserts a location;
        // this asserts the relation the number actually comes from. It is
        // `CLAUDE.md`'s class-label landmine arriving in a single word — the
        // label was right every time and the gloss was a separate claim nobody
        // had checked.
        field('clusters with', region?.label ?? atlasNode.region),
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

      /**
       * **Twins, in the *revealed* register — a shown fact, not a proved one.**
       *
       * ADR-0011 decision 3 draws the line and ADR-0030 decision 3 applies it:
       * this is not *"you proved"*, it is *"nothing in this repository can tell
       * these apart"*. The count is the class's cone size, which is the whole
       * content of the claim — a class reached by one file is thin and true,
       * and the number is what tells the reader so.
       *
       * Here rather than on the map (decision 4): `ties.ts`'s own comment is
       * that *"a wired answer is the map's `Ctrl+F`"*, and a twin relation is
       * static, so an edge would either be permanently drawn — a lookup — or
       * flicker as boards open and close, which is ADR-0016's vanishing-wires
       * defect wearing a new hat.
       */
      if (twins !== null) {
        const others = twins.members.filter((member) => member !== node.ref);
        const names = others
          .map((member) => scene.nodes[member]?.label ?? '')
          .filter((label) => label !== '');
        if (names.length > 0) {
          const places = `${twins.coneSize} place${twins.coneSize === 1 ? '' : 's'}`;
          const reach = twins.members.length === 2 ? 'both of them' : `all ${twins.members.length} of them`;
          body.append(
            el('div', 'inspector-twin', [
              el('span', 'inspector-twin-mark', ['indistinguishable']),
              ` nothing in this repository can tell this apart from ${listOf(names)}: `,
              `${places} reach ${reach}, by the same paths.`,
            ]),
          );
        }
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
          answered ? 'Ask it again' : VERBS[challenge.verb].prompt(challenge, wordsFor(scene.graph)).action,
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

/** Renders `legendRows`, which is where the ordering rules and their reasons live. */
/**
 * The arrival card: the repository introducing itself, then getting out of the
 * way.
 *
 * A `<div>` that fades and is removed, rather than a mode: the map is live and
 * clickable underneath from the first frame, and the first pointer or key
 * dismisses it. A splash you have to wait out would be worse than the silence
 * it replaces.
 */
export interface ArrivalCard {
  readonly root: HTMLElement;
  dismiss(): void;
}

export function createArrival(scene: Scene): ArrivalCard {
  const arrival = arrivalOf(scene);
  const lines = arrivalLines(arrival).map((line, i) =>
    el('div', i === 0 ? 'arrival-counts' : 'arrival-landmark', [line]),
  );
  const root = el('div', 'arrival', [
    el('div', 'arrival-eyebrow', ['you have arrived at']),
    el('div', 'arrival-name', [arrival.name]),
    ...lines,
  ]);
  let gone = false;
  return {
    root,
    dismiss() {
      if (gone) return;
      gone = true;
      root.classList.add('is-gone');
      // Removed rather than left at zero opacity: an invisible element over the
      // canvas is the pointer-events contradiction this stylesheet has three
      // comments about.
      window.setTimeout(() => root.remove(), 700);
    },
  };
}

export interface Legend {
  readonly root: HTMLElement;
  /**
   * Repaint the per-region tallies, and the channel key for the view on
   * screen. Called wherever the HUD's counts are, from the same `fog`.
   */
  update(understood: ReadonlySet<NodeId>, view: 'map' | 'orbit'): void;
}

export function createLegend(scene: Scene): Legend {
  // The same `provableNodes` the medal shelf uses, so the two surfaces cannot
  // print different denominators for one population.
  const provable = provableNodes(scene.atlas);
  const answerable = new Map<number, number>();
  for (const node of scene.nodes) {
    if (!provable.has(node.id)) continue;
    answerable.set(node.regionIndex, (answerable.get(node.regionIndex) ?? 0) + 1);
  }
  const rows = legendRows(scene, answerable);
  const tallies = new Map<number, HTMLElement>();
  const items = rows.map((row) => {
    const swatch = el('span', 'legend-swatch');
    // Straight from the same function the canvas uses — a legend that computes
    // its own colours is a legend that will eventually disagree with the map.
    swatch.style.background = regionColor(row.index, 1);
    // **Something to fill in.** Three of ten cold playtesters said the loop had
    // nothing to build toward — *"no sense of building toward something, a
    // completed region"* — while the one structure the map already has is
    // regions. This is the same derived number the fog draws, per region, so a
    // player can watch a neighbourhood come in and can decide to finish one.
    const tally = el('span', 'legend-tally');
    tallies.set(row.index, tally);
    return el('li', 'legend-item', [swatch, el('span', 'legend-name', [row.text]), tally]);
  });
  const keyBox = el('div', 'legend-key', [
    el('div', 'legend-title', ['what you see']),
    ...keyRows('map'),
  ]);
  let shown: 'map' | 'orbit' = 'map';
  const root = el('div', 'legend', [
    el('div', 'legend-title', ['regions']),
    el('ul', 'legend-list', items),
    keyBox,
  ]);
  return {
    root,
    update(understood, view) {
      if (view !== shown) {
        shown = view;
        keyBox.replaceChildren(el('div', 'legend-title', ['what you see']), ...keyRows(view));
      }
      const proved = provedByRegion(scene, understood);
      for (const row of rows) {
        const tally = tallies.get(row.index);
        if (tally === undefined) continue;
        const n = proved.get(row.index) ?? 0;
        // Silent at zero: a column of `0/46` on arrival is a scoreboard of
        // failure, and guardrail 6's spirit is that nothing shames a player who
        // has not started. It appears with the first thing they prove.
        tally.textContent = n === 0 ? '' : `${n}/${row.answerable}`;
        tally.classList.toggle('is-done', n > 0 && n >= row.answerable);
      }
    },
  };
}

/**
 * What a disc's size, ring and brightness mean — **in the view you are in**.
 *
 * Four of ten cold playtesters could not read the map's own encodings, and one
 * of them then found the sharper version of the same gap: the key does not
 * change when the view does, so the orbit adds a whole channel — height — and
 * names it nowhere. *"A chart-literate viewer is staring at building heights
 * with no key at all."* The map has spent five milestones being careful that
 * every channel is derived and true, and never once said what any of them was.
 *
 * Repo-agnostic (guardrail 2): these are the renderer's channels, not this
 * repository's facts. Ordered with the view's own channel first, because that
 * is the one a reader has just met.
 */
function keyRows(view: 'map' | 'orbit'): readonly HTMLElement[] {
  const shared = [
    row('size', 'lines of code'),
    row('ring', 'has a question you have not answered'),
    row('dim', 'not surveyed yet'),
    row('bright', 'you proved something about it'),
  ];
  if (view === 'orbit') {
    // Height is ADR-0013's elevation: each layer is twice as depended-upon, so
    // "how many" would be a claim the channel does not make.
    return [row('height', 'how much leans on it, through any chain'), ...shared];
  }
  return [...shared, row('box', 'on the question that is open')];
}

function row(mark: string, meaning: string): HTMLElement {
  return el('div', 'legend-key-row', [
    el('span', 'legend-key-mark', [mark]),
    el('span', 'legend-key-what', [meaning]),
  ]);
}

/**
 * The help card: every control this arm and this view actually has.
 *
 * **Built from `controlsFor` and never from a list kept here.** A cold
 * playtester scored the controls 6 out of 10, and the reason was not that they
 * are bad — it is that the HUD's one-line hint was the *only* enumeration of
 * them, so the mouse gestures were written down nowhere and the keyboard pan
 * did not exist. A second hand-kept list would break `experiment.ts`'s rule the
 * first time an arm changed, which is a failure that file already has a
 * screenshot of.
 *
 * `rebuild` rather than a static render, because the live set changes with the
 * view: `f` and `n` are dead in the world, and `o` says *map* from the orbit.
 */
export interface Help {
  readonly root: HTMLElement;
  isOpen(): boolean;
  toggle(arm: Arm | null, view: View): void;
  close(): void;
}

export function createHelp(): Help {
  const list = el('dl', 'help-list');
  const root = el('div', 'help', [el('div', 'help-title', ['controls']), list]);
  root.style.display = 'none';
  let open = false;

  return {
    root,
    isOpen: () => open,
    toggle(arm, view) {
      open = !open;
      root.style.display = open ? 'block' : 'none';
      if (!open) return;
      list.replaceChildren();
      for (const control of controlsFor(arm, view)) {
        list.append(el('dt', 'help-keys', [control.keys]), el('dd', 'help-what', [control.what]));
      }
    },
    close() {
      open = false;
      root.style.display = 'none';
    },
  };
}

export interface Notebook {
  readonly root: HTMLElement;
  readonly toggle: HTMLElement;
  isOpen(): boolean;
  close(): void;
  /**
   * Re-render from the current record. Notes and medals are both **derived,
   * never cached** — a medal is the same kind of claim a note is, and ADR-0011
   * requires every restored claim to be re-checked against the live graph rather
   * than replayed from storage.
   */
  update(notes: readonly FieldNote[], medals: readonly Medal[]): void;
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
export function createNotebook(deckRefused: boolean): Notebook {
  const list = el('ul', 'notes-list');
  // **Two empty states here too, and the second is not "nothing yet".** With the
  // deck refused (ADR-0025) there is no question to answer, so *"answer a
  // question and what you establish is written down here"* invites something the
  // product does not have. It is a weaker defect than the guide's — an
  // impossible instruction rather than a false claim — but it is the same one a
  // panel over.
  const empty = el('div', 'notes-empty', [notesEmpty(deckRefused)]);
  const heading = el('div', 'notes-title', ['FIELD NOTES']);
  const close = el('button', 'console-close', ['✕']);
  close.type = 'button';
  const head = el('div', 'notes-head', [heading, close]);
  // The shelf sits **above** the notes, and that is the point of it: four of ten
  // cold playtesters said the game had no arc, only a counter going down. A note
  // is a fact you proved; a medal is how far through the repository those facts
  // have got you. The two belong on one surface because they are the same
  // register — proved, never merely shown.
  const shelfTitle = el('div', 'medals-title', ['MEDALS']);
  const shelf = el('div', 'medals-shelf');
  const shelfBlock = el('div', 'medals', [shelfTitle, shelf]);
  // **Notes first, shelf second, and that order is a measured correction.** The
  // shelf shipped above the notes, and three of ten cold playtesters said the
  // same thing: *"eleven mostly-empty shields dominate the panel above the single
  // earned sentence, which is the only thing in there with content"*, *"a wall of
  // empty grey shields is a chore list, not an arc"*, *"~80% medal grid and ~20%
  // actual notes"*. On arrival every medal is empty and there is exactly one
  // note, so putting the shelf on top makes the emptiest thing the headline. What
  // you proved leads; what is next follows it.
  const panel = el('div', 'notes-panel', [head, empty, list, shelfBlock]);
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
    update(notes, medals) {
      const won = earnedCount(medals);
      // Both counts on the button. The first draft of this comment said the
      // medal count "only ever goes up", which is false across a reindex and the
      // suite proves it — a completed region whose question no longer exists
      // yields no medal at all (ADR-0011 decision 3, and a unit test asserts it).
      // Monotone within a session; not a property of the number.
      toggle.textContent =
        notes.length === 0 && won === 0
          ? 'field notes'
          : `field notes (${notes.length}) · ${won}/${medals.length} medals`;
      shelfTitle.textContent = `MEDALS — ${won} OF ${medals.length}`;
      shelf.replaceChildren(
        ...medals.map((medal) => {
          const art = el('div', 'medal-frame');
          art.appendChild(medalSvg(medal));
          const pips = tierPips(medal);
          const text = el('div', 'medal-text', [
            breakablePath(el('div', 'medal-name'), medal.name),
            el('div', 'medal-claim', [medal.claim]),
          ]);
          if (pips !== null) {
            const row = el('div', 'medal-pip-row');
            row.appendChild(pips);
            text.appendChild(row);
          }
          const item = el('div', medal.earned ? 'medal is-earned' : 'medal', [art, text]);
          return item;
        }),
      );
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
