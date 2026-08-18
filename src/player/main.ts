/**
 * The player's imperative shell.
 *
 * Loads `atlas.json`, validates it, and wires a canvas to the pure modules
 * around it. This is the only file that owns mutable state, and it owns all of
 * it: camera, fog, hover, selection.
 *
 * The player is a pure function of the atlas (NORTH-STAR §7). It reads one
 * file over `fetch` and touches nothing else — no filesystem, no source code,
 * and nothing leaves the machine. That is pillar 5, and it is a property of the
 * architecture rather than of anyone's discipline: the player has no access to
 * the repo at all.
 */

import type { Atlas, Challenge, NodeId, NodeRef, AtlasId } from '../atlas/index.js';
import {
  challengeOrder,
  coverageSentence,
  isNodeId,
  parseAtlas,
  sourceCoverage,
} from '../atlas/index.js';
import type { Camera, Point } from './camera.js';
import {
  NORTH,
  centreOn,
  facingNorth,
  fit,
  pan,
  pivotAround,
  rotate,
  sameCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './camera.js';
import { createConsole } from './challenge.js';
import type { BoardMarks } from './draw.js';
import { drawFrame, drawOrbitFrame } from './draw.js';
import type { Box, PlacedLabel } from './labels.js';
import type { Fog } from './fog.js';
import type { Arm, View } from './experiment.js';
import { armFromSearch, keyHintFor, worldHintFor } from './experiment.js';
import { coverage, landmarks } from './fog.js';
import { GOLDEN_TURN, TURN_MS, bearingDuring } from './heading.js';
import type { Orbit } from './orbit.js';
import { DEFAULT_ORBIT, pickColumn, tip } from './orbit.js';
import type { Progress } from './progress.js';
import { PASS_THRESHOLD, VERBS, channelOf } from '../verbs/index.js';
import { answerKey, answeredKeys, applyGrade, deriveFog, gradedKeys, livenessOf, recordSurvey, subjectsPassed, verbOfKey } from './progress.js';
import { browserStore, loadProgress, saveProgress, storageKeyFor } from './save.js';
import type { Tally } from './tally.js';
import { EMPTY_TALLY, noteGrade, parseTally, serializeTally, summarise, tallyKeyFor } from './tally.js';
import type { Radius, Scene, SceneNode } from './scene.js';
import {
  DIRECT_ONLY,
  FULL_RADIUS,
  answerableByRegion,
  blastRadius,
  clearedByRegion,
  pick,
  prepare,
} from './scene.js';
import type { Twins } from './twins.js';
import { findTwins, nameableClass } from './twins.js';
import type { Ties } from './ties.js';
import { NO_TIES, tiesNamedBy } from './ties.js';
import type { Chains } from './chains.js';
import { NO_CHAINS, chainsProvedBy } from './chains.js';
import type { WorldMode } from './world/index.js';
import { createWorldMode } from './world/index.js';
import type { SelectorState } from './selector.js';
import { NO_HISTORY, noteAttempt, noteSkipped, suggestNext } from './selector.js';
import { fieldNotes } from './notes.js';
import { answeredNodes, medalsFor, provableNodes } from './medals.js';
import {
  createError,
  createGuide,
  createHud,
  createInspector,
  createHelp,
  createArrival,
  createLegend,
  createNotebook,
} from './ui.js';
import { DISTRICT_SCALE } from './zoom.js';

const ATLAS_URL = 'atlas.json';
/**
 * How long the arrival card stays before it withdraws on its own.
 *
 * Two short lines at reading speed, and every playtest that complained about
 * the opening complained about *nothing happening* rather than about waiting —
 * so this is the shortest interval that is still an event.
 */
const ARRIVAL_MS = 3200;

/** Pointer movement below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;
/**
 * How far one arrow press moves the view, in screen pixels. Shift multiplies it.
 *
 * Screen pixels rather than world units on purpose: a keyboard pan should cover
 * the same fraction of the screen whatever the zoom, which is what a reader
 * means by "a bit to the left".
 */
const PAN_STEP = 90;
/** One `+`/`-` press. The wheel's own factor, so the two feel like one control. */
const ZOOM_STEP = 1.2;

async function loadAtlas(url: string): Promise<Atlas> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${url} (${response.status}). Run \`npm run index\` to generate one.`,
    );
  }
  // parseAtlas throws on a dangling edge, an out-of-order array or a truth set
  // that is not a subset of its candidates. Failing here is the point — the
  // player must never guess at a shape (guardrail 5).
  return parseAtlas(await response.text());
}

function start(scene: Scene, root: HTMLElement, arm: Arm | null): void {
  /**
   * **True when this session is one arm of `docs/experiments/0001`.**
   *
   * The design is between subjects — one participant, one mode — and until
   * this existed nothing held that: `o`, `g` and Escape move between all three
   * views, so a participant could put themselves in another arm with one
   * keystroke and no record of it. `locked` is read at every place a view
   * changes; `null` (the ordinary player, and the deployed page, which has no
   * query string) leaves every one of them exactly as it was.
   */
  const locked = arm !== null;
  const canvas = document.createElement('canvas');
  canvas.className = 'map';
  const maybeContext = canvas.getContext('2d');
  if (maybeContext === null) throw new Error('This browser has no 2D canvas context.');
  const context = maybeContext;

  let viewport = { width: 0, height: 0 };
  /**
   * Where the player is looking, including **which way up**.
   *
   * The bearing is session state and is **never persisted**, like the
   * selector's attempt counts and for the same reason — ADR-0011 decision 2
   * forbids storing a cursor, and an orientation into the rotation is one.
   * Arriving north-up every session is the point rather than a limitation:
   * north-up is the canonical map and ADR-0009's D1 overview, and a restored
   * heading would anchor the player back to one alignment, which is the thing
   * `heading.ts` exists to break.
   */
  let camera: Camera = { x: 0, y: 0, scale: 1, bearing: NORTH };

  /**
   * The view a board borrowed, and what it turned it into.
   *
   * `null` whenever no board has panned the map — including a board whose
   * subject is a commit, which has nowhere to pan to (ADR-0018) and so borrows
   * nothing. See `openBoard` and the console's `onClose`.
   */
  let borrowed: { own: Camera; lent: Camera } | null = null;

  /**
   * What holds still while the world turns, and where on screen it holds.
   *
   * `null` turns about the middle of the viewport. After a grade it is the file
   * just graded, at wherever it was standing — so the landmark whose radius is
   * on screen stays put and the map revolves around it. That is the difference
   * between the turn reading as *this place has other angles* and reading as
   * *the tool shuffled the map*.
   */
  type Pivot = { anchor: Point; at: Point } | null;
  /**
   * A turn in flight: where the map was facing, where it is going, when it set
   * off, and how long it takes.
   *
   * `ms` is on the record rather than a constant at the point of use because
   * `prefers-reduced-motion` is a *zero-length* turn, not a separate code path.
   * Written as a branch that skipped the animation, the reduced-motion route
   * never called `bearingDuring` at all — so its `duration <= 0` case was dead
   * in the product while a unit test exercised it under that very name. A
   * tested branch nothing calls is the landmine this session already caught
   * once in `easeTurn`; the fix is to make the words true rather than to
   * rewrite them.
   */
  let turning: { from: number; to: number; startedAt: number; ms: number; pivot: Pivot } | null =
    null;
  /**
   * Some people should not be shown a spinning world. The turn still happens —
   * the map has to end up where the next question is asked from — it just takes
   * no time to get there.
   */
  const stillness =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /**
   * What the map should turn about: the given node if it is on screen, else
   * nothing, which means the middle of the viewport.
   *
   * On screen is a real condition rather than a nicety. Pivoting about a point
   * beyond the edge swings the whole view through an arc whose radius is the
   * distance to it, which is a camera flying sideways rather than a world
   * turning.
   */
  const pivotOn = (node: SceneNode | null): Pivot => {
    if (node === null) return null;
    // **Flat map only.** In the orbit a node's disc is drawn at its column's
    // *top* — turned, foreshortened, lifted, and offset by headroom — so
    // `worldToScreen` names a point where nothing is drawn, and the on-screen
    // test below would be answered by the wrong projection too. That is this
    // file's oldest scar (the flat inverse driving a tipped view) arriving in a
    // new function, and the ADR already gives the fallback: nothing to anchor
    // on means turn about the middle of the screen.
    if (orbit !== null) return null;
    const at = worldToScreen(camera, viewport, node);
    if (at.x < 0 || at.x > viewport.width || at.y < 0 || at.y > viewport.height) return null;
    return { anchor: { x: node.x, y: node.y }, at };
  };

  const applyBearing = (bearing: number, pivot: Pivot): void => {
    camera =
      pivot === null
        ? { ...camera, bearing }
        : pivotAround(camera, viewport, pivot.anchor, pivot.at, bearing);
  };

  const turnTo = (target: number, pivot: Pivot): void => {
    turning = {
      from: camera.bearing,
      to: target,
      startedAt: performance.now(),
      ms: stillness ? 0 : TURN_MS,
      pivot,
    };
    invalidate();
  };

  /**
   * End a turn in flight, right now, at its destination.
   *
   * **Every camera command that is not itself about the heading calls this
   * first**, and the reason is that a pivoted turn rewrites `camera.x/y` on
   * every frame it runs: without this, pressing "Where next?" within 620 ms of
   * closing a console selects the node, records the survey and updates the
   * inspector while the camera is dragged straight back by the turn — a control
   * that visibly does nothing, with the state and the screen disagreeing. Same
   * for `f`, for `o`, and for a resize, whose new viewport makes the pivot's
   * captured screen point a lie.
   *
   * It *lands* rather than cancels, so the schedule still delivers the heading
   * it promised. A **drag** is the one exception and clears `turning` outright
   * (below): a drag is itself a bearing-and-pan gesture, so the player's hand
   * takes the value over rather than waiting for it.
   */
  const landTurn = (): void => {
    if (turning === null) return;
    applyBearing(turning.to, turning.pivot);
    turning = null;
  };

  // `progress` is the state; `fog` is a view of it (ADR-0011). Everything the
  // player earns is written to the record and the fog is re-derived, so there
  // is exactly one place a promotion can happen and the reload path is the same
  // code as the live one — a save that restores wrongly would be a bug in a
  // function the whole session already exercised.
  const store = browserStore();
  const saveKey = storageKeyFor(scene.atlas.repo);
  // `docs/experiments/0001` M2's instrumentation, in its own record beside the
  // save. **Nothing reads this back into the game** — it is written here and
  // read by a facilitator out of `localStorage`, which is what keeps it a
  // measurement rather than the cursor ADR-0011 decision 2 forbids. See
  // `tally.ts`; `tests/unit/tally.test.ts` asserts the selector never imports it.
  const tallyKey = tallyKeyFor(scene.atlas.repo);
  // `getItem` is wrapped for the reason `save.ts`'s `loadProgress` wraps the
  // identical call: reading storage throws outright in some sandboxed frames,
  // and this was the player's only unguarded `getItem`.
  const storedTally = (): string | null => {
    try {
      return store?.getItem(tallyKey) ?? null;
    } catch {
      return null;
    }
  };
  let tally: Tally = locked ? parseTally(storedTally()) : EMPTY_TALLY;
  // **The readout, and the reason it is here rather than on screen.** M2's datum
  // has to leave a finished session somehow, and showing a participant their own
  // pre-registered measure changes the thing being measured. So it is a function
  // the facilitator calls once, at minute 20, and it exists only in an arm —
  // `docs/experiments/0001` §9 names it. Guardrail 6 is untouched because the
  // player is never shown it and nothing in the game reads it.
  if (locked) {
    (globalThis as unknown as Record<string, unknown>)['arkTally'] = (): unknown =>
      summarise(tally);
  }
  const liveness = livenessOf(scene.graph, VERBS);
  const shore = landmarks(scene.nodes);
  // The same set the fog gives away for free, drawn as summits. One rule, two
  // consequences: what you start knowing the name of, and what dominates the
  // skyline, are the same files — which is what makes "pick a landmark" a real
  // instruction rather than a hint you have to hunt for.
  const peaks = new Set(
    shore.map((id) => scene.graph.refById.get(id)).filter((ref): ref is number => ref !== undefined),
  );
  // The orbit view. `null` is the flat map, which stays the default and the
  // arrival state — ADR-0009's D1 says the overview survives, and the evidence
  // in `docs/prior-art.md` §2 says the flat map is what teaches survey
  // knowledge. Turning the world is an *addition*, one keystroke away and one
  // keystroke back.
  let orbit: Orbit | null = null;
  /**
   * The walkable world (ADR-0033), entered with `g` and left with `g` or Escape.
   *
   * Third of three views over one atlas and the last of ADR-0009's rungs. It is
   * a **mode**, not the arrival state: D1's promise is that the fitted overview
   * survives and stays a keystroke away, and `docs/experiments/0001` has not
   * been run, so nothing here may become the default. `enter` takes the flat
   * map's selection as the place to stand, which is §3.4's fast travel — pick
   * on the map, walk from there.
   */
  const world: WorldMode = createWorldMode();
  let progress: Progress = loadProgress(store, saveKey);
  let fog: Fog = deriveFog(progress, liveness, shore);
  /**
   * The **answered** population, and the per-region fractions read off it.
   *
   * One set, three readers: the legend's tallies, the medal shelf, and the map's
   * region wash. Passing `fog.understood` to one and the answered set to another
   * is how two panels came to print `2/37` and `3/37` for the same region on a
   * retried board — the shape ADR-0019's reveal and its own field note had on 21
   * of 26 boards, where each surface is right and they disagree.
   *
   * Kept beside `fog` and recomputed with it, because the two decay together: a
   * pass whose subject has left the atlas leaves both.
   */
  const answerableByRegionMap = answerableByRegion(scene, provableNodes(scene.atlas));
  let answeredSet: ReadonlySet<NodeId> = answeredNodes(progress, liveness);
  let regionProgress: ReadonlyMap<number, number> = clearedByRegion(
    scene,
    answeredSet,
    answerableByRegionMap,
  );
  /**
   * What may have its **import** radius drawn — the subjects and members proved
   * through Blast Radius, and nothing else.
   *
   * Deliberately narrower than `fog.understood`, which is verb-blind. ADR-0008
   * decision 1 gives the full cone only to a player who proved they knew it;
   * with two verbs, reading that rule off the verb-blind set means passing a
   * *Companion* question prints the answer to the still-open *Blast Radius*
   * question about the same file. Same leak M1 had on hover, arriving from a
   * direction no existing test looks at.
   */
  let tracedRadius: ReadonlySet<NodeId> = subjectsPassed(progress, liveness, 'blastRadius');

  /**
   * The history wires the map may currently draw, and which of them burn bright.
   *
   * **Not the members, and that is the first half of the rule.** The obvious
   * move was to reuse a helper that returns subjects *and the members the
   * player picked correctly in someone else's question*. Simulated over this
   * repo's deck, that gate draws **89 members of still-open answer keys in a
   * single frame**, across 28 of 40 subjects — co-change has no containment, so
   * a member's row reaches anywhere on the map. Fifth instance of ADR-0014's bug
   * class, caught by measuring instead of by reading — ADR-0016. The helper it
   * would have reused no longer returns members at all: the import side had the
   * same defect, bounded by containment and therefore *exactly* an answer key
   * (`subjectsPassed`).
   *
   * **And there is exactly one gate, which is the second half.** An earlier
   * version of this file drew every pair the open reveal named — ungated, on
   * the argument that the panel a few pixels away was naming them anyway — and
   * kept the gated layer underneath. It was measurably wrong: **79% of the
   * wires that flash at the grade vanish when the panel closes**, 6 promised
   * and 1 kept on the board the e2e happens to play, and nothing at all on 4 of
   * 40. That is the exact defect the `onGraded` comment below records shipping
   * once already — a panel saying "now drawn on the map" beside a map that is
   * not drawing it. One rule, one place: every one of ADR-0014's leaks was a
   * rule that lived twice.
   */
  let ties: Ties = NO_TIES;
  let tieFocus: NodeRef | null = null;
  let chains: Chains = NO_CHAINS;

  /**
   * Rebuild both **earned** map layers — the history wires and the proved
   * chains — from the record.
   *
   * One function and one pass, because the two are the same shape: a channel
   * (`Verb.channel`), the boards on it whose answer the player has seen, and
   * the boards on it still open, which is what each layer's gate is written
   * against. Two functions would be two places to remember to call, and this
   * file's own comment above records that every one of ADR-0014's leaks was a
   * rule that lived twice.
   *
   * The gates themselves are **not** here. `tiesNamedBy` and `chainsProvedBy`
   * each own theirs, for the same reason `draw.ts` owns none: a module that
   * decides who may see what has to be the one that knows what is being asked.
   */
  const relayer = (): void => {
    const answered = answeredKeys(progress, liveness);
    const namedTies: Challenge[] = [];
    const openTies = new Set<NodeRef>();
    const provedChains: Challenge[] = [];
    const openChains = new Set<NodeRef>();
    for (const bucket of challengesById.values()) {
      for (const challenge of bucket) {
        const channel = channelOf(challenge.verb);
        if (channel !== 'coChangeTies' && channel !== 'importRadius') continue;
        const ref = scene.graph.refById.get(challenge.subject);
        const seen = answered.has(answerKey(challenge.verb, challenge.subject));
        const [shown, open] =
          channel === 'coChangeTies' ? [namedTies, openTies] : [provedChains, openChains];
        if (seen) shown.push(challenge);
        else if (ref !== undefined) open.add(ref);
      }
    }
    ties = tiesNamedBy(scene.atlas, scene.graph, namedTies, openTies);
    chains = chainsProvedBy(scene.graph, provedChains, openChains);
  };

  /**
   * What is under the pointer, in whichever view is on screen.
   *
   * One function, used by hover and by click, because the two paths disagreeing
   * about which projection is in force is precisely the defect this replaced:
   * orbit shipped with the flat inverse still driving both, so the inspector
   * described one file while the cursor sat on another — and the click wrote
   * that wrong file into the saved `surveyed` set.
   */
  /**
   * The node labels the last frame drew, so the **text** can be pointed at.
   *
   * A label is anchored directly under its own disc and never drifts, but on a
   * crowded map it lies across other discs — so pointing at a name picked
   * whatever was beneath it. A cold playtester reported that as the map naming
   * the wrong objects, answered all eight of their boards off the panel's text
   * list, and never used the map once. A name you cannot point at is not a
   * handle, and the map not being a handle is the whole thesis not pulling.
   */
  let nameplates: readonly PlacedLabel[] = [];

  const pickAt = (local: { x: number; y: number }): SceneNode | null => {
    // **Names first, in both views.** A nameplate is a screen box wherever it
    // was drawn, so this loop is view-agnostic; only the fall-through differs.
    //
    // **The order is a live trade, not a settled one, and it is measured.**
    // `placeLabels` blocks against other labels and the chrome and never against
    // the *discs*, so a name lies across other people's nodes and one of the two
    // has to lose every contested pixel. `scripts/probe-nameplate.ts` hovers
    // both populations through this very function, at `4e39701`:
    //
    //   names first (shipped)  35 of ark's 273 discs and 33 of hono's 425 name
    //                          someone else at dead centre; **6 and 6 answer
    //                          nowhere within 20px**. 0 of 15 and 0 of 12 names
    //                          mis-point.
    //   bodies first           4 and 14 discs, all of them to another disc; but
    //                          **9 of 15 and 5 of 12 names** mis-point.
    //
    // Neither is right and the third option — making the discs blockers so the
    // overlap cannot happen — closes it completely (0 by name, both repos) and
    // takes ark from **15 drawn labels to 2**, which pays for the fix out of the
    // thing five rounds of playtesters said was already scarcest. So it stays as
    // it reads, the cost is in `README.md`'s Known gaps with these numbers, and
    // the probe is what stops the next session re-deriving all three from
    // scratch. Note which way the residual errs: names-first is the arrangement
    // whose losers are *nodes*, and the e2e's own `pointed at N names` step
    // guards the other direction — so a flip here would go red there, on purpose.
    const named = pickName(local);
    if (named !== null) return named;
    if (orbit !== null) return pickColumn(scene.nodes, camera, viewport, orbit, local);
    const world = screenToWorld(camera, viewport, local);
    return pick(scene, world.x, world.y, camera.scale);
  };

  /**
   * The node whose drawn **name** is under this point.
   *
   * The text is on top of the discs visually, so it has to be on top of them
   * for the pointer too, or the two disagree about what is in front.
   *
   * Iterated in reverse for a stable order and **not** because a later label
   * paints over an earlier one: `placeLabels` adds every placed box to its own
   * blockers, so two placed labels cannot overlap and the direction cannot
   * change an answer. *(The comment here claimed the painter's-order reason
   * until a review pointed out the mechanism does not exist — and the edit that
   * was supposed to correct it silently matched nothing, so the wrong sentence
   * shipped one commit longer than its correction claimed.)*
   */
  const pickName = (local: { x: number; y: number }): SceneNode | null => {
    for (let i = nameplates.length - 1; i >= 0; i -= 1) {
      const label = nameplates[i];
      if (label === undefined || label.ref === undefined) continue;
      if (
        local.x >= label.left &&
        local.x <= label.left + label.width &&
        local.y >= label.top &&
        local.y <= label.top + label.height
      ) {
        const node = scene.nodes[label.ref];
        if (node !== undefined) return node;
      }
    }
    return null;
  };

  /**
   * `progress.surveyed` as a set.
   *
   * Kept beside the record rather than derived at the call site because the
   * walk asks "have I seen this?" for every building in reach, every frame —
   * `Array.includes` over 3,035 nodes at 60 Hz is the shape of an O(n) trap
   * django would find for us.
   */
  let surveyedIds = new Set<NodeId>(loadProgress(store, saveKey).surveyed);
  const remember = (next: Progress): void => {
    progress = next;
    surveyedIds = new Set(next.surveyed);
    fog = deriveFog(progress, liveness, shore);
    // Recomputed with the fog, from the same record, so the three surfaces that
    // read it cannot fall a frame out of step with the map.
    answeredSet = answeredNodes(progress, liveness);
    regionProgress = clearedByRegion(scene, answeredSet, answerableByRegionMap);
    tracedRadius = subjectsPassed(progress, liveness, 'blastRadius');
    relayer();
    saveProgress(store, saveKey, progress);
  };

  let hovered: SceneNode | null = null;
  let selected: SceneNode | null = null;
  let radius: Radius | null = null;
  let dirty = true;

  const invalidate = (): void => {
    dirty = true;
  };

  // **Questions per subject, plural since M4.** A file can be the subject of a
  // Blast Radius question *and* a Companion one — they ask different things
  // about it — so this was a `Map<NodeId, Challenge>` that silently kept
  // whichever challenge the atlas happened to list second. Challenges the
  // player has passed drop out of `unanswered`, which is what the map's rings
  // and the HUD's counter both read.
  const challengesById = new Map<NodeId, Challenge[]>();
  for (const challenge of scene.atlas.challenges) {
    // **Node subjects only.** This map is the map's click path — "what does this
    // file get asked about" — and a commit is not a file. Keying one in here
    // would put a bucket in the deck's tally that no node can ever resolve, so
    // the HUD's "questions left" would count a ring nobody can see.
    if (!isNodeId(challenge.subject)) continue;
    const bucket = challengesById.get(challenge.subject);
    if (bucket === undefined) challengesById.set(challenge.subject, [challenge]);
    else bucket.push(challenge);
  }
  // **Ordered by tier, explicitly, and that is a fix rather than a flourish.**
  // `scene.atlas.challenges` is sorted by challenge **id**, and an id begins
  // with its verb's name — so `archaeology-…` sorts before `blast-…`, and a
  // click on a disc would have opened the tier-5 history question before the
  // tier-3 import one, on every subject carrying both. §5's tiers *are* the
  // curriculum, and `selector.ts` calls this path the primary one; inheriting an
  // alphabetical accident here would invert the progression everywhere the
  // suggestion button is not used, and falsify `challengeFor`'s own comment
  // below. ADR-0019 decision 8.
  for (const bucket of challengesById.values()) bucket.sort(challengeOrder);
  const unanswered = new Set<NodeRef>();
  /**
   * How many questions are left **in the deck**, which is not the same number as
   * `unanswered.size`.
   *
   * `unanswered` is a set of *nodes* carrying an open question — it draws the
   * map's rings, and a node with two open verbs is one ring. The HUD and the
   * guide were reading it as a question count, which was right only while every
   * subject was a node and every node carried at most one. Placement's subjects
   * are commits (ADR-0018), so reading the ring set would have shown "0 left"
   * over a third of a deck nobody had played.
   */
  let openQuestions = 0;
  // Session-scoped, never persisted: ADR-0011 decision 2 forbids storing a
  // cursor, and a position in the rotation is a cursor.
  let selector: SelectorState = NO_HISTORY;
  const retally = (): void => {
    // Derived from the record, not tracked alongside it, so a restored session
    // starts with the deck it left with — and a pass whose claim has decayed
    // puts its question back, which is the honest outcome.
    //
    // Read off `answeredSubjects` rather than `fog.understood`: a file you
    // picked correctly in someone else's question is understood, but its *own*
    // radius is a question you have not been asked.
    const answered = answeredKeys(progress, liveness);
    unanswered.clear();
    for (const [id, bucket] of challengesById) {
      const ref = scene.graph.refById.get(id);
      // A node still carries a question while *any* of its verbs is unanswered.
      const open = bucket.some((c) => !answered.has(answerKey(c.verb, c.subject)));
      if (ref !== undefined && open) unanswered.add(ref);
    }
    openQuestions = scene.atlas.challenges.filter(
      (challenge) => !answered.has(answerKey(challenge.verb, challenge.subject)),
    ).length;
    // The selector reads the *same* set, so the HUD counter, the map's rings
    // and the button can never disagree about what is left.
    selector = { ...selector, answered };
  };
  retally();
  /**
   * **A board this player has already been shown does not come back as fresh.**
   *
   * `selector.attempts` counts boards served and not passed, and it lived only
   * in memory — so a reload made every failed board look untried. A cold
   * playtester hit exactly that: the guide kept re-offering a board they had
   * answered at 18%, ahead of 155 boards they had never seen. Under ADR-0047
   * that board is the *worst* possible suggestion, because it has already
   * explained itself and can never mint proof again, so re-serving it ahead of
   * an unseen one is the deck spending its best asset on nothing.
   *
   * Seeded from `graded`, which persists and decays — so a board whose key has
   * since re-rolled comes back genuinely fresh, which it is. Seeded **once**,
   * before any grading, so in-session increments accumulate on top rather than
   * being flattened by the next `retally`.
   */
  {
    const seen = gradedKeys(progress, liveness);
    let attempts = selector.attempts;
    // **And the verbs, for the same reason and from the same record.** A review
    // caught this one field over: `unmetVerb` lifts the first board of a verb
    // the player has not met, and `metVerbs` lived only in memory — so every
    // reload re-ran the whole out-of-tier introduction for verbs this player
    // had already answered. The rank comment's "inert forever after" was true
    // within one session and nowhere else, and nothing said per-session
    // re-introduction had been chosen. The argument is the paragraph above,
    // verbatim, with `attempts` swapped for `metVerbs`; the fix is the line
    // below, four lines from the block that proves it is ADR-0011-legal.
    const metVerbs = new Set(selector.metVerbs);
    for (const key of seen) {
      metVerbs.add(verbOfKey(key));
      if (!selector.answered.has(key)) attempts = noteAttempt(attempts, key);
    }
    // Answered boards are met too — `gradedKeys` decays with its pass, so a
    // board whose key re-rolled is absent from it, and meeting a verb is not a
    // claim that decays.
    for (const key of selector.answered) metVerbs.add(verbOfKey(key));
    selector = { ...selector, attempts, metVerbs };
  }
  // Wires a restored save has already earned, before the first frame.
  relayer();

  /**
   * Twin classes, computed once at load.
   *
   * `cone(A) = cone(B)` over the **full** transitive dependent set, derived from
   * the graph rather than carried in the atlas — a `twins` field would be a
   * second encoding of something `edges` already determines (ADR-0030's
   * alternatives). One sweep of `dependents`; the cost to watch is django's
   * 3,035 nodes at a mean closure of 165, which is the case that would justify
   * moving it into the indexer.
   */
  const twins: Twins = findTwins(
    scene.graph,
    scene.atlas.nodes.map((node) => node.id),
  );

  const regionOf = (subject: AtlasId): string | null => {
    const ref = scene.graph.refById.get(subject);
    return ref === undefined ? null : (scene.atlas.nodes[ref]?.region ?? null);
  };
  // ADR-0046: the rank demotes a board about a fixture, a benchmark or a
  // manifest so a cold player is not opened on one. `null` for a commit subject,
  // which is not demoted — it has no path rather than a sideshow one.
  const pathOf = (subject: AtlasId): string | null => {
    const ref = scene.graph.refById.get(subject);
    return ref === undefined ? null : (scene.atlas.nodes[ref]?.path ?? null);
  };
  const nextUp = (): Challenge | null =>
    suggestNext(scene.atlas.challenges, regionOf, selector, pathOf);

  /**
   * How far a node's radius may be drawn.
   *
   * ADR-0008 decision 1, and the whole of it: **direct importers for everyone,
   * the full cone only for what you have proved you know**. The rule does not
   * depend on whether a challenge is open, because the leak it closes happens
   * at the moment of *choosing* a subject — hovering to pick a landmark used to
   * print the complete answer before the click that asked the question.
   *
   * Suppressing it for the subject alone would not have worked either: if D
   * imports S then `dependents(D) ⊆ dependents(S)`, so hovering any suspected
   * member of the answer reads off the rest.
   */
  /**
   * Whose wires burn bright.
   *
   * A node with no drawn wires focuses nothing, so this is `null` for every
   * unproven node **and** for every proven one the history has nothing to say
   * about — which is the honest rendering of an edgeless file rather than a
   * special case for it.
   *
   * Note what this deliberately does *not* do: it never asks whether the node
   * is understood, proved or surveyed. `ties` was already gated when it was
   * built; asking a second question here would be a second place for the rule
   * to live, and every one of ADR-0014's leaks was a rule that lived twice.
   */
  const focusFor = (node: SceneNode | null): NodeRef | null =>
    node !== null && ties.byNode.has(node.ref) ? node.ref : null;

  const depthFor = (node: SceneNode): number =>
    tracedRadius.has(node.id) ? FULL_RADIUS : DIRECT_ONLY;

  /**
   * The board the guide is currently offering, kept in step with its caption.
   *
   * Assigned in `refreshGuide` from the same `nextUp()` the caption is written
   * from, so the two cannot drift — which is the whole defect: a caption saying
   * *"next is empty.ts"* over an `Enter` that opened something else.
   */
  let suggested: Challenge | null = null;

  /**
   * Which question a click on this node opens.
   *
   * The first one the player has not passed, **in tier order**, so a node
   * carrying several verbs offers the tier-3 import question first and the
   * tier-5 history question after it. Falling back to the first challenge when
   * everything is answered keeps the inspector able to say what the node was
   * asked about.
   */
  const challengeFor = (node: SceneNode | null): Challenge | null => {
    if (node === null) return null;
    // **The guide's own suggestion wins on the node it sent you to**, and this is
    // the round-5 defect rather than a nicety. `suggestNext` picks a board partly
    // for *verb variety* — `unmetVerb` lifts the first board of a kind you have
    // never met, and `sameVerb` breaks a run — and then this function threw that
    // away, because it returns the node's first unpassed board in **tier order**
    // and Blast Radius is tier 3. Measured on this repo: the two disagree on
    // **3 of the first 12 suggestions, including board two**.
    //
    // Six of ten cold playtesters hit it. Three reported the symptom as "both
    // questions I was served were the same verb" while the medal shelf beside
    // them read *"1 of 4 kinds of question answered"*; the sharpest report was a
    // skip that moved the caption to a different file while `Enter` opened the
    // **old** board — *"two different ask affordances bound to one key"*.
    //
    // A direct click keeps tier order: that is the node's own question and
    // nothing advertised otherwise. Only the node the guide is currently
    // pointing at honours the suggestion, which is the promise the caption makes.
    if (suggested !== null && suggested.subject === node.id) {
      if (!selector.answered.has(answerKey(suggested.verb, suggested.subject))) return suggested;
    }
    const bucket = challengesById.get(node.id);
    if (bucket === undefined || bucket.length === 0) return null;
    return bucket.find((c) => !selector.answered.has(answerKey(c.verb, c.subject))) ?? bucket[0] ?? null;
  };

  /**
   * The next board whose subject is **not** a node, in tier order.
   *
   * ADR-0033 decision 2: a commit has no `layout` and therefore nowhere to
   * stand, so the walkable world serves these from the chronicle rather than
   * from a place. Placing a commit's marker among the files it touched would be
   * Placement's own answer key drawn on the ground — the leak that decision
   * exists to refuse.
   *
   * `!isNodeId` rather than `isCommitId`, deliberately: a future id kind with
   * no `layout` should land here rather than silently vanish from the world,
   * which is the *subject-is-not-a-node* landmine met with the lesson learned.
   */
  const nextPlacelessChallenge = (): Challenge | null => {
    const open = scene.atlas.challenges.filter(
      (challenge) =>
        !isNodeId(challenge.subject) &&
        !selector.answered.has(answerKey(challenge.verb, challenge.subject)),
    );
    return [...open].sort(challengeOrder)[0] ?? null;
  };

  const describe = (node: SceneNode | null): void => {
    const challenge = challengeFor(node);
    inspector.show({
      node,
      answered:
        challenge !== null && selector.answered.has(answerKey(challenge.verb, challenge.subject)),
      radius: node === null ? null : radius,
      // `tracedRadius`, not `fog.understood`: this flag gates the *transitive
      // dependent count* in the inspector, which is Blast Radius's answer.
      // Verb-blind, a Companion pass printed the number the Blast Radius
      // question about the same file was about to ask for — the same leak as
      // `depthFor`, one panel over, and visible only in an e2e screenshot.
      understood: node !== null && tracedRadius.has(node.id),
      challenge,
      // ADR-0030. The gate is *answered*, not *passed* — what the leak needs is
      // the other board's reveal, which a player sees whatever they scored, and
      // guardrail 6 forbids punishing a wrong answer. And it is the whole
      // class: a per-row guard would make the absence of this line point at the
      // member whose board is still open.
      twins:
        node === null
          ? null
          : nameableClass(twins, node.ref, (member) => {
              const id = scene.nodes[member]?.id;
              if (id === undefined) return false;
              const bucket = challengesById.get(id) ?? [];
              return bucket.some(
                (c) =>
                  c.verb === 'blastRadius' && !selector.answered.has(answerKey(c.verb, c.subject)),
              );
            }),
    });
  };

  /**
   * Why this atlas has no deck, or `null` when the deck is simply finished.
   *
   * A property of the atlas, so it is read once — the only latched thing near
   * the guide, and the exception proves the rule: everything else there is
   * recomputed because a pass can decay, and nothing can un-refuse a deck
   * without a reindex.
   */
  const mapCoverage = sourceCoverage(scene.atlas);
  const deckRefusal = mapCoverage.deckRefused ? coverageSentence(mapCoverage) : null;

  // Notes are re-derived on every open, never cached: a claim can decay between
  // sessions and a cached sentence would go on asserting something the graph has
  // stopped supporting (ADR-0011 decision 3).
  const notebook = createNotebook(mapCoverage.deckRefused);
  const refreshNotes = (): void => {
    // **The same `fog` the map is drawing**, handed to the medals rather than
    // re-derived inside them. Two surfaces computing one population separately is
    // how the Archaeology reveal and its own field note came to disagree on 21 of
    // 26 boards, each internally consistent and each with passing tests.
    notebook.update(
      fieldNotes(scene.graph, progress, liveness),
      medalsFor(scene, progress, liveness, fog),
    );
  };
  notebook.toggle.addEventListener('click', refreshNotes);

  const hud = createHud(scene.atlas, () => turnTo(facingNorth(camera), null), [notebook.toggle]);

  /**
   * Set by a grade, spent when the panel closes: **the map turns between
   * challenges, not during one.**
   *
   * Two callbacks rather than one because the two moments are different. The
   * turn is worth nothing behind the scrim — the player would close the console
   * onto a world that had silently moved, which is disorientation without the
   * correspondence that makes it teachable. Turning as the map comes back means
   * the reveal is on screen while it happens, so there is a shape to follow
   * round.
   *
   * Every grade, pass or fail, exactly like the reveal itself: guardrail 6 says
   * a wrong answer never costs anything, and a heading that only advanced on a
   * pass would make the turn a reward and the flat map a punishment.
   */
  let turnPending = false;
  const challengePanel = createConsole(scene, {
    onGraded(challenge, grade, reveal) {
      // **The two channels do not behave alike here, and that is deliberate.**
      // `importRadius` below draws the cone on *any* grade, pass or fail,
      // because its reveal has already named every member and withholding the
      // picture would make the sentence a lie. Wires do the opposite: they wait
      // for the pass, and Companion's summary is worded to promise only that
      // ("drawn once both files' questions are answered"). An earlier version
      // drew them on every grade like the cone, and 79% of what it promised was
      // gone by the next click — ADR-0016 decision 3.
      // The real `liveness`, not the default: a `graded` key certifies the board
      // it was earned on, and a board whose pass has decayed is a new question
      // with the same name (ADR-0047, `gradedKeys`). Passing `UNCHECKED` here
      // would make every re-rolled board permanently unprovable.
      const progression = applyGrade(progress, challenge, grade, PASS_THRESHOLD, liveness);
      remember(progression.progress);
      // Handed back to the console so the panel can say which register this
      // answer landed in while the board that decided it is still on screen.
      const register = progression.register;
      // Every graded submission, pass or fail — which is the difference between
      // this and the `attempts` map below, and the reason M2's datum did not
      // exist before. That one counts only the boards that did *not* pass, so a
      // board answered correctly first time was invisible to it.
      // **Only in an arm.** `experiment.ts`'s rule is that no query string is
      // today's player, unchanged — the deployed page has none — so an ordinary
      // session stores nothing at all, and ADR-0011 decision 2 has no surface to
      // be argued about. The instrument exists for the twenty minutes it is
      // measuring and at no other time.
      //
      // **One guard, not two.** The first version tested `locked` twice — once
      // to update the record and once to write it — and the two drifting apart
      // is not a cosmetic bug: `tally` is `EMPTY_TALLY` in an unlocked session,
      // so a write that escaped the guard would put `{"entries":[]}` over a
      // finished arm's record and **erase a participant's data**. A rule that
      // lives twice, in a file whose own comments call that the failure mode.
      if (locked) {
        tally = noteGrade(tally, challenge.verb, challenge.subject, progression.unlocked);
        try {
          store?.setItem(tallyKey, serializeTally(tally));
        } catch {
          // Quota or a private-mode store. An instrument that cannot write must
          // not take the session down with it — the run is still valid, the
          // engagement half of it is simply unrecorded, and the facilitator
          // finds out by the key being absent rather than by a stack trace at
          // minute 3.
        }
      }
      retally();
      refreshNotes();
      // Both paths into a challenge converge here, which is why the selector's
      // history is updated here and nowhere else: a map-click answer shapes the
      // next suggestion exactly as a suggested one does, because a byte-identical
      // answer key is felt the same however the question arrived.
      selector = {
        ...selector,
        // The run this board continues, or the start of a new one. Maintained
        // here because this is where "the player was served a board" happens —
        // both paths into a challenge converge on this handler.
        verbRun:
          selector.previous !== null && selector.previous.verb === challenge.verb
            ? selector.verbRun + 1
            : 1,
        // A verb the player has now met. One-shot: `unmetVerb` goes inert once
        // this set covers the deck.
        metVerbs: new Set([...selector.metVerbs, challenge.verb]),
        previous: challenge,
        attempts: progression.unlocked
          ? selector.attempts
          : noteAttempt(selector.attempts, answerKey(challenge.verb, challenge.subject)),
      };
      const ref = scene.graph.refById.get(challenge.subject);
      if (ref !== undefined) {
        // The reveal fires on every grade, pass or fail — guardrail 6 says a
        // wrong answer never takes anything away, so seeing the true shape is
        // not a reward, it is the point of having answered at all.
        //
        // **The verb says what it revealed; the map draws that and nothing
        // more.** Hard-coded to `FULL_RADIUS`, this drew the complete import
        // cone after *any* grade — so a Companion answer rendered a cone nobody
        // had earned, and by the containment argument `depthFor` sets out (if D
        // imports S then `dependents(D) ⊆ dependents(S)`) that exposes part of
        // the open Blast Radius answer for every file below it.
        //
        // Routing it through `depthFor` instead was the *first* fix and it was
        // also wrong, in the other direction: `depthFor` reads a set only a
        // **passed** challenge writes to, so a Blast Radius answer that came
        // apart stopped drawing the radius while the panel went on saying "now
        // drawn on the map". Guardrail 6 — a wrong answer takes nothing away —
        // and a false sentence, from one line meant to close a leak.
        const node = scene.nodes[ref];
        if (node !== undefined) {
          selected = node;
          radius = blastRadius(
            scene,
            ref,
            reveal.unlocks === 'importRadius' ? FULL_RADIUS : depthFor(node),
          );
          tieFocus = focusFor(node);
        }
      }
      turnPending = true;
      describe(selected);
      invalidate();
      return register;
    },
    onClose() {
      // **Give back the pan the board took.** `openBoard` slides the subject to
      // 30% from the left so the panel does not sit on top of it — the
      // product's camera move, never the player's — and nothing was undoing it.
      // The turn then swung the map about that off-centre point, so the frame a
      // player lands in after *every* grade had the map huddled in one corner
      // and the other half of the screen empty. That is the reward beat of the
      // core loop and it was the worst-composed frame the product made.
      //
      // Only when the camera is still exactly where the board left it. The map
      // stays live behind an open board on purpose (ADR-0016 and the docked
      // panel), so a camera the player has moved since is theirs and restoring
      // it would be the same theft in the other direction.
      if (borrowed !== null && sameCamera(camera, borrowed.lent)) camera = borrowed.own;
      borrowed = null;
      if (turnPending) {
        turnPending = false;
        turnTo(camera.bearing + GOLDEN_TURN, pivotOn(selected));
      }
      invalidate();
    },
    // The map draws the open board (`draw.ts`'s `BoardMarks`), so a tick or a
    // pointer move is a stale frame. One edge, carrying "something changed".
    onBoardChanged() {
      invalidate();
    },
  });
  const inspector = createInspector(scene, (challenge) => openBoard(challenge));

  /**
   * Take the player to the next landmark. Deliberately does **not** open the
   * question: §4's loop is "pick a landmark", and ADR-0011 calls suggested-next
   * an affordance rather than a mode. The map stays the frame; the existing
   * "answer this" control is one keystroke away once you arrive.
   *
   * **Unless there is no landmark.** A commit subject has no position
   * (ADR-0018), so there is nothing to pan to and the rule above has nothing to
   * protect — its whole argument is that the map should stay the frame, and a
   * button that silently does nothing does not keep it there, it just breaks.
   * So a placeless suggestion opens its question, and `ui.ts` labels the control
   * for what it will actually do.
   */
  const guide = createGuide(() => {
    const challenge = nextUp();
    if (challenge === null) return;
    const ref = scene.graph.refById.get(challenge.subject);
    const node = ref === undefined ? undefined : scene.nodes[ref];
    if (node === undefined) {
      openBoard(challenge);
      return;
    }
    // Before touching the camera: a turn in flight owns `x`/`y` every frame.
    landTurn();
    selected = node;
    hovered = null;
    remember(recordSurvey(progress, [node.id]));
    // **In the world, move the hero — the camera is not what is on screen.**
    // This moved the flat map's camera unconditionally, so in the world the
    // button did nothing visible and the caption then said *"you are on
    // labels.ts"*. A cold playtester proved the avatar never moved by hashing
    // the canvas before and after, twice, on two nodes. `travelTo` is ADR-0032
    // §3.4's fast travel, which the world already does on entry.
    if (world.isActive()) {
      world.travelTo(node);
      describe(node);
      invalidate();
      return;
    }
    // Far enough in that the destination's name is drawn — arriving at an
    // unlabelled dot is arriving nowhere.
    camera = centreOn(camera, node, DISTRICT_SCALE);
    radius = blastRadius(scene, node.ref, depthFor(node));
    tieFocus = focusFor(node);
    describe(node);
    invalidate();
  }, () => {
    // Skip: wave this board away for the session and re-suggest. The deck is
    // untouched — `noteSkip` clears the list rather than let the player run it
    // to empty, so "158 left" can never sit over a guide with nothing to offer.
    const challenge = nextUp();
    if (challenge === null) return;
    const remaining = scene.atlas.challenges
      .map((board) => answerKey(board.verb, board.subject))
      .filter((key) => !selector.answered.has(key));
    // One call, because a skip has two consequences and the shell forgetting
    // the second was invisible to every test (`selector.noteSkipped`).
    selector = noteSkipped(
      selector,
      challenge.verb,
      answerKey(challenge.verb, challenge.subject),
      remaining,
    );
    retally();
    invalidate();
  });

  const legend = createLegend(scene);
  const help = createHelp();
  /**
   * **The repository introduces itself, for about three seconds.**
   *
   * Not in an arm. `docs/experiments/0001` is between-subjects and its whole
   * point is that the two arms differ in one thing; a card that says *"the most
   * load-bearing file is X"* before either arm has been played is a free hint
   * in both, and an unequal one if it ever fails to render. `?arm=` gets the
   * opening the experiment was designed around, which is the one without it.
   *
   * **And not to someone who has been here before.** It said *"you have arrived
   * at ark"* to a returning player with 61 files surveyed and a field note
   * already written, which a cold playtester filed as a bug and is one: an
   * arrival is an event, and replaying it says the session before did not
   * happen. Read off `progress` rather than off the fog, because the fog's
   * `surveyed` carries the landmark head start (`deriveFog`'s `base`) and is
   * therefore non-empty for a player who has done nothing at all — the same
   * "24 surveyed before I touched anything" two testers queried in the HUD.
   */
  const returning = progress.passes.length > 0 || progress.surveyed.length > 0;
  const arrival = arm === null && !returning ? createArrival(scene) : null;
  root.replaceChildren(
    canvas,
    hud.root,
    legend.root,
    inspector.root,
    guide.root,
    notebook.root,
    help.root,
    challengePanel.root,
    ...(arrival === null ? [] : [arrival.root]),
  );
  if (arrival !== null) {
    canvas.classList.add('is-arriving');
    // Long enough to read two short lines, and gone on the first sign of a
    // player — an opening you have to sit through is worse than no opening.
    const leave = (): void => {
      arrival.dismiss();
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(leave, ARRIVAL_MS);
    for (const event of ['pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(event, leave, { once: true, passive: true });
    }
  }

  /** Which of the three views is on screen, for the arm-aware control list. */
  const viewNow = (): View => (world.isActive() ? 'world' : orbit === null ? 'map' : 'orbit');

  /**
   * Where the DOM panels stand over the canvas, so labels are not placed
   * underneath them.
   *
   * **Measured on change, not per frame.** `getBoundingClientRect` forces a
   * layout, and the HUD's text is rewritten every frame just above the draw
   * call, so reading it in the render path would mean a forced reflow at 60 Hz
   * for geometry that moves only when a panel opens, closes or reflows. A
   * `ResizeObserver` gives the exact update for free; `resize()` covers the
   * corner-anchored panels that *move* without changing size.
   */
  let chrome: Box[] = [];
  // The console's *panel*, never its scrim: the scrim is `inset: 0` and would
  // block every label on the canvas. See `Console.panel` for what it was
  // costing while it was missing from this list.
  const panels = [hud.root, legend.root, inspector.root, guide.root, challengePanel.panel];
  function measureChrome(): void {
    const host = root.getBoundingClientRect();
    chrome = panels
      .filter((panel) => panel.isConnected && panel.offsetParent !== null)
      .map((panel) => {
        const box = panel.getBoundingClientRect();
        return {
          left: box.left - host.left,
          top: box.top - host.top,
          width: box.width,
          height: box.height,
        };
      })
      .filter((box) => box.width > 0 && box.height > 0);
  }
  const chromeObserver = new ResizeObserver(() => {
    measureChrome();
    invalidate();
  });
  for (const panel of panels) chromeObserver.observe(panel);

  function resize(): void {
    // The pivot's screen point was captured in the *old* viewport; a resized
    // one would hold the anchor at coordinates that no longer mean anything,
    // possibly outside the window entirely.
    landTurn();
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // A corner-anchored panel moves on a resize without changing size, so the
    // observer above never fires for it.
    measureChrome();
    invalidate();
  }

  /**
   * One frame of the walkable world, plus the two things drawn over it.
   *
   * The prompt and the control hint are painted on the **canvas** rather than
   * added to the DOM chrome, because they belong to a mode: a DOM panel would
   * have to be created, hidden, shown and measured into `chrome`, and every one
   * of those is a place for the two views to disagree about what is on screen.
   */
  function drawWorld(): void {
    const placeless = nextPlacelessChallenge();
    // Where the guide is pointing, resolved to a place by the shell — the world
    // never asks what a challenge is about, only where to go (ADR-0027's seam).
    const upcoming = nextUp();
    const targetRef =
      upcoming === null ? undefined : scene.graph.refById.get(upcoming.subject);
    const target = targetRef === undefined ? null : (scene.nodes[targetRef] ?? null);
    // **The hero's position, for the e2e, published from the path that draws
    // it.** The walk is canvas-only, so a browser test has no other way to ask
    // whether the avatar moved — and a canvas hash is not a substitute: the
    // guide selects, describes and repaints a waypoint regardless, so "some
    // pixel changed" is true whether or not the hero went anywhere. A gate
    // written that way survived a `travelTo` that did nothing at all, which is
    // this repo's instrument-that-measures-nothing landmine reading as good
    // news. The first version of this publish sat in the *flat map's* draw
    // branch, which never runs here — so it reported `null` in the one mode it
    // was about.
    const standing = world.hero();
    (globalThis as unknown as { __arkHero?: unknown }).__arkHero =
      standing === null ? null : { x: Math.round(standing.x), y: Math.round(standing.y) };
    const stats = world.draw(context, {
      viewport,
      chrome,
      target,
      targetIsPlaceless: upcoming !== null && targetRef === undefined,
      fog,
      questions: unanswered,
      chronicleLit: placeless !== null,
      // The one place the world arm differs from the shipping world. See
      // `experiment.ts` for why the inset keeps everything else.
      minimapRoads: arm !== 'world',
    });
    const focus = world.focus(unanswered, placeless !== null, target);
    drawWorldChrome(context, viewport, focus, placeless);
    // The world is a view, not a second product: the guide is refreshed here for
    // the same reason the HUD is, and leaving it out was measured as a blank
    // panel for a whole `?arm=world` session and a counter one behind the HUD's
    // in the unlocked one.
    refreshGuide(openQuestions);
    hud.update(
      coverage(fog, scene.nodes.length),
      'world',
      // Measured, not asserted — the same rule the map's `peaksDrawn` and
      // `tiesDrawn` are here for. `roads` is the one to watch: ADR-0033's whole
      // argument is that the ground carries the import graph, so a frame that
      // draws zero roads is that argument silently not shipping.
      `${stats.towersDrawn} towers · ${stats.skylineDrawn} skyline · ${stats.roadsDrawn} roads · ${stats.archesDrawn} arches · ${stats.labelsDrawn} labels · ${stats.beaconsDrawn} beacons`,
      openQuestions,
      unanswered.size,
      // North is north: the minimap is north-up and the world does not turn
      // under the walker, so the compass has one thing to say and says it.
      NORTH,
      keyHintFor(arm, 'world'),
    );
  }

  function drawWorldChrome(
    target: CanvasRenderingContext2D,
    view: { width: number; height: number },
    focus: ReturnType<WorldMode['focus']>,
    placeless: Challenge | null,
  ): void {
    target.save();
    target.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
    target.textAlign = 'center';
    if (focus !== null) {
      // The chronicle names what it would open using the **verb's** own label
      // for its subject, which is the same string the guide already shows —
      // the shell asks *what is this called* and never *what is it about*
      // (ADR-0027). Writing "a commit" here instead would be the console
      // guessing at a noun, which is the mistake ADR-0027 exists to prevent.
      const subject =
        placeless === null
          ? null
          : (VERBS[placeless.verb as keyof typeof VERBS]?.subjectLabel(
              scene.graph,
              placeless.subject,
            ) ?? null);
      const label =
        focus.kind === 'chronicle'
          ? `Enter — the chronicle${subject === null ? '' : ` · ${subject}`}`
          : `Enter — ${focus.tower.node.label}`;
      const width = target.measureText(label).width + 26;
      const x = view.width / 2;
      const y = view.height - 84;
      target.fillStyle = 'rgba(8, 12, 18, 0.86)';
      target.fillRect(x - width / 2, y - 20, width, 28);
      target.strokeStyle = 'rgba(126, 214, 214, 0.7)';
      target.lineWidth = 1;
      target.strokeRect(x - width / 2, y - 20, width, 28);
      target.fillStyle = '#e6edf7';
      target.fillText(label, x, y);
    }
    // Bottom centre, clear of the minimap on the left and the guide on the
    // right. The first version put it bottom-right, underneath the guide panel,
    // which is the chrome-collision the map solves with `measureChrome` — the
    // world paints on the canvas instead, so it has to keep its own distance.
    target.textAlign = 'center';
    target.fillStyle = 'rgba(124, 135, 152, 0.9)';
    target.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    // **`g map` only when `g` does something.** The DOM HUD's control line is
    // arm-aware (`keyHintFor`) and this one is painted on the canvas, so the
    // rule lived in two places and the first version fixed one of them — an
    // `?arm=world` screenshot showed the world's own hint still offering the
    // way out. Same defect this file already has a comment about, one surface
    // over.
    target.fillText(worldHintFor(arm), view.width / 2, view.height - 22);
    target.restore();
  }

  /**
   * "Where next?", recomputed.
   *
   * **Called from every view, which it was not.** This lived inline in the
   * map/orbit branch of `frame`, so in the walkable world the panel was never
   * updated: under `?arm=world` it rendered as an enabled, clickable, *empty*
   * pill for the entire session — measured by a playtester as `["",""]` after
   * four seconds, a walk and a click — and in the unlocked world it went stale,
   * showing "160 left" beside a HUD reading "159 left" in the same frame after
   * a pass. The world is a first-class view (ADR-0033) and the arm the recall
   * experiment runs in, so the one affordance telling a participant where to go
   * cannot be a property of which branch drew the frame.
   *
   * Recomputed, never latched: a pass can decay and a reindex can resurrect its
   * question, so a stored "you are finished" would go on lying.
   */
  /**
   * The open board, resolved to places the map can draw.
   *
   * **Both halves of `AtlasId` arrive here and neither is assumed.** A
   * Placement subject is a commit and has no ref; an Archaeology candidate is a
   * commit and has none either. `refById` answers for both by returning
   * `undefined`, and the caller drops what has no place rather than this
   * function inventing one — the chronicle is where a placeless subject is
   * answered (ADR-0033 decision 2) and it is not a marker on the flat map.
   */
  function boardMarks(): BoardMarks | null {
    const view = challengePanel.board();
    if (view === null) return null;
    const refOf = (id: AtlasId): NodeRef | undefined => scene.graph.refById.get(id);
    const candidates = new Set<NodeRef>();
    const picked = new Set<NodeRef>();
    for (const id of view.candidates) {
      const ref = refOf(id);
      if (ref === undefined) continue;
      candidates.add(ref);
      if (view.picked.has(id)) picked.add(ref);
    }
    const subject = refOf(view.subject);
    const hovered = view.hovered === null ? undefined : refOf(view.hovered);
    return {
      subject: subject ?? null,
      candidates,
      picked,
      hovered: hovered ?? null,
    };
  }

  /**
   * Open a board, and put its subject somewhere the player can see it.
   *
   * **The markers are worth nothing under the panel.** The console is docked to
   * the right, so a subject the camera happened to leave on that side is marked
   * and hidden — the marking layer firing and the player seeing nothing, which
   * is the same class of defect as a layer that never fires. Placing it at 30%
   * of the width leaves it in the open half at every panel size this uses.
   *
   * Only when the subject *has* a place: Placement's is a commit, which has
   * none, and there is nothing to pan to (ADR-0018).
   */
  /** What the console has open, for the e2e's caption-vs-board check. */
  let openChallenge: Challenge | null = null;

  function openBoard(challenge: Challenge): void {
    openChallenge = challenge;
    const ref = scene.graph.refById.get(challenge.subject);
    const node = ref === undefined ? undefined : scene.nodes[ref];
    if (node !== undefined) {
      landTurn();
      const anchor = screenToWorld(camera, viewport, {
        x: viewport.width * 0.5,
        y: viewport.height * 0.5,
      });
      const wanted = screenToWorld(camera, viewport, {
        x: viewport.width * 0.3,
        y: viewport.height * 0.5,
      });
      const own = camera;
      camera = centreOn(camera, {
        x: node.x + (anchor.x - wanted.x),
        y: node.y + (anchor.y - wanted.y),
      });
      // What the view was before this pan, and what the pan made of it. `close`
      // gives the first back if the second is still on screen untouched.
      borrowed = { own, lent: camera };
    }
    challengePanel.open(challenge);
    invalidate();
  }

  function refreshGuide(openQuestions: number): void {
    const upcoming = nextUp();
    suggested = upcoming;
    const upcomingRef = upcoming === null ? undefined : scene.graph.refById.get(upcoming.subject);
    // **What the guide is offering, as the selector's own key.** The e2e used to
    // identify a suggestion by its rendered caption, which names the *subject*
    // and not the verb — so two boards asking different questions about one file
    // read as the same suggestion and a correct pair scored as a repeat. The key
    // is `(verb, subject)` everywhere else in the player and it is not on screen
    // anywhere, so the test needs it from here rather than from a sentence.
    (globalThis as unknown as { __arkNextKey?: unknown }).__arkNextKey =
      upcoming === null ? null : answerKey(upcoming.verb, upcoming.subject);
    // What the console actually has open, for the same reason: the caption and
    // the opened board drifted apart and only a browser can see it.
    (globalThis as unknown as { __arkOpenKey?: unknown }).__arkOpenKey =
      openChallenge === null ? null : answerKey(openChallenge.verb, openChallenge.subject);
    // **Whether this suggestion is a case that could disagree** — the suggested
    // subject also carries an unanswered board the tier order would have picked
    // first. Published so the e2e can *gate itself*: without it the check lands
    // on a subject carrying one board, the two trivially agree, and a mutant
    // deleting the whole fix passes. That happened on the first run of it.
    // The **counterfactual**, computed exactly: what would `challengeFor` return
    // for this subject if it consulted tier order alone? When that differs from
    // the suggestion, this is a board where the defect was visible.
    //
    // The first version asked a weaker question — "does the subject carry another
    // unanswered board at the same tier or lower?" — which is true on plenty of
    // subjects where the suggestion *is* the tier-first board, so the two agreed
    // anyway and a mutant deleting the whole fix passed **twice**. A gate has to
    // model the disagreement, not a precondition for it.
    // **A node subject, and that qualifier is the third correction to this one
    // line.** `challengeFor` is only ever called with a node; a commit subject
    // has no place on the map (ADR-0018), so the guide opens it directly and the
    // code under test never runs. Without this the gate found its "rival" on a
    // Placement board about a commit and a mutant deleting the fix passed a
    // **third** time — the subject-is-not-a-node landmine, in a gate, after two
    // other attempts to make that gate honest.
    (globalThis as unknown as { __arkNextRival?: unknown }).__arkNextRival =
      upcoming === null || !isNodeId(upcoming.subject)
        ? false
        : ((challengesById.get(upcoming.subject) ?? []).find(
            (other) => !selector.answered.has(answerKey(other.verb, other.subject)),
          )?.id ?? null) !== upcoming.id;
    guide.update({
      next: upcoming,
      // Only when the deck is empty *because it was refused*. A repo whose
      // questions have all been answered gets the other sentence, and merging
      // the two would tell a Go-repo player they had finished (ADR-0025).
      refusal: deckRefusal,
      // The map's own short label when the subject is on the map; otherwise the
      // verb's name for its subject, because only the verb knows what a commit
      // is called. The shell asks *whether* it is placed and *what* it is
      // called, and never what it is about.
      path:
        upcomingRef !== undefined
          ? (scene.nodes[upcomingRef]?.label ?? null)
          : upcoming === null
            ? null
            : (VERBS[upcoming.verb as keyof typeof VERBS]?.subjectLabel(
                scene.graph,
                upcoming.subject,
              ) ?? null),
      placed: upcomingRef !== undefined,
      arrived: upcoming !== null && selected?.id === upcoming.subject,
      questionsLeft: openQuestions,
    });
  }

  function frame(): void {
    if (world.isActive()) {
      // A walk is continuous, so this view drives itself: `advance` integrates
      // real elapsed time and says whether anything moved. It is the one place
      // in the player that redraws without an event, and it stops the moment
      // the keys are released rather than spinning a frame budget on a still
      // picture.
      if (world.advance(performance.now())) {
        dirty = true;
        // Walking past a building is looking at it. The flat map surveys on a
        // click; this is the same act with legs, through the same recorder, so
        // the fog cannot end up with two definitions of "seen" (ADR-0011).
        const fresh = world
          .surveyable()
          .filter((node) => !surveyedIds.has(node.id))
          .map((node) => node.id);
        if (fresh.length > 0) remember(recordSurvey(progress, fresh));
      }
      if (dirty) {
        dirty = false;
        drawWorld();
      }
      requestAnimationFrame(frame);
      return;
    }
    if (turning !== null) {
      const elapsed = performance.now() - turning.startedAt;
      applyBearing(bearingDuring(turning.from, turning.to, elapsed, turning.ms), turning.pivot);
      if (elapsed >= turning.ms) turning = null;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      const frameInput = {
        scene,
        camera,
        viewport,
        fog,
        hovered,
        selected,
        // **Depth 1 is drawn on every board, which is ADR-0008 decision 1 as
        // written** — and this line spent two sessions contradicting the
        // decision it cited.
        //
        // A cold playtester used a subject's ring as a lookup and it was
        // measured (37 of ark's 40 Blast Radius boards drew at least one key
        // member), so the channel was switched off while a board was open, then
        // narrowed to import-graded boards. No ADR was written, and the comment
        // that shipped with it named decision 1 as its authority on the line
        // that nulled it.
        //
        // Decision 1 had already reasoned about exactly this and **rejected**
        // it, in sentences that are still right: *"no modal special-casing and
        // no per-subject suppression: the rule must not depend on whether a
        // challenge is open, because the leak happens at the moment of choosing
        // the subject"*; *"depth 1 is not a leak — those edges are already drawn
        // on the canvas"*; and *"suppress everything while a challenge is open —
        // fixes nothing at the moment of choosing"*. Which is true: close the
        // board, hover, reopen. It was a speed bump, not a gate.
        //
        // The cost was not a speed bump. §8.4 defines `surprise` against the
        // naive direct-neighbour guess, so a player who cannot see direct
        // neighbours cannot form the baseline difficulty is calibrated against —
        // and `gate.ts` declines to score that guess for the same reason, in
        // writing: *"a question that strategy passes is an easy question, which
        // the progression needs."* Measured by `scripts/probe-depth1.ts`, it
        // scores **0.985 / 1.000 / 0.611 / 0.800 over the first fifteen boards
        // the shipped selector serves** and **0.531 / 0.561 / 0.293 / 0.467
        // deck-wide** (ark, hono, kysely, graphql-js). That is the difficulty
        // curve: it wins the opening, which is what an opening is *for*, and
        // loses most of the deck. Taking it away made the boards designed to be
        // winnable unwinnable — three cold rounds of "my first three boards
        // scored zero".
        //
        // What stays gated is what decision 1 actually gates: the **full** cone,
        // on `subjectsPassed`. ADR-0016's wire gate is untouched — a co-change
        // wire *is* Companion's answer relation, where this is the baseline
        // Blast Radius measures departure from.
        radius,
        chrome,
        questions: unanswered,
        peaks,
        ties,
      chains,
        tieFocus,
      regionProgress,
        board: boardMarks(),
      };
      const stats =
        orbit === null
          ? drawFrame(context, frameInput)
          : drawOrbitFrame(context, frameInput, orbit);
      // **What the import channel actually carried this frame**, for the e2e.
      // The leak this guards is ink on a canvas, so a browser test needs the
      // renderer's own answer rather than a pixel heuristic: `none` means no
      // import radius was handed to the frame at all.
      // The depth too, because the rule ADR-0008 decision 1 states has two
      // halves — depth 1 always, the full cone only for a proved subject — and
      // a gate that reads only "is there a radius" cannot tell them apart.
      (globalThis as unknown as { __arkRadius?: unknown }).__arkRadius =
        frameInput.radius === null
          ? 'none'
          : `subject ${frameInput.radius.subject} depth ${frameInput.radius.maxDepth}`;
      // The view, for the e2e's composition gate. A board pans the map and
      // gives the pan back on close; a canvas hash cannot tell that from the
      // turn that follows it, and the camera is the thing the rule is about.
      // How many *candidate* markers this frame drew, as against how many marks
      // in total. An Archaeology board marks its subject — a file — and none of
      // its candidates, which are commits, so the two numbers differ on exactly
      // the verb where the click hint must not appear.
      (globalThis as unknown as { __arkCandidateMarks?: unknown }).__arkCandidateMarks =
        stats.candidatesDrawn;
      // **The other half of ADR-0008 decision 1**, from the same set the frame
      // gated on. `__arkRadius` alone says depth 1 or the full cone; it cannot
      // say which of those is *correct*, because the answer depends on whether
      // the subject is one the player proved. So a gate reading it alone has to
      // guess that the board it happened to open is on an unproved subject —
      // which is a prediction about a deck that re-rolls on every commit, and it
      // went red on a commit that added two scripts, reporting a full cone the
      // decision explicitly grants as *"the full cone is earned, not shown"*.
      (globalThis as unknown as { __arkTraced?: unknown }).__arkTraced = [
        ...tracedRadius,
      ].flatMap((id) => {
        const ref = scene.graph.refById.get(id);
        return ref === undefined ? [] : [ref];
      });
      (globalThis as unknown as { __arkCamera?: unknown }).__arkCamera = {
        x: camera.x,
        y: camera.y,
        scale: camera.scale,
      };
      // What the frame just drew is what the pointer may hit. Kept from the
      // frame rather than recomputed, so the two can never disagree about where
      // a name is.
      nameplates = stats.nameplates;
      // **For the e2e only, and it is a measurement rather than a hook.** The
      // labels live on the canvas, so a browser test has no way to find where a
      // name was drawn — and the defect this closes was precisely that pointing
      // at a name selected someone else. Publishing the boxes is what lets the
      // suite point at one.
      (globalThis as unknown as { __arkNameplates?: unknown }).__arkNameplates =
        stats.nameplates.map((plate) => ({
          text: plate.text,
          // **The path, not just the label.** Comparing an inspector path
          // against a label with `endsWith` is a substring match: this repo has
          // seven `index.ts` nodes, so pointing at one name and surveying a
          // different file passed that check — the exact defect this whole
          // change is about, invisible to its own gate. It fails the other way
          // too, since `shortLabel` truncates a long name with `…` and a
          // truncated label can never suffix-match its own path.
          path: scene.atlas.nodes[plate.ref ?? -1]?.path ?? '',
          x: plate.left + plate.width / 2,
          y: plate.top + plate.height / 2,
        }));
      // The regions filling in, from the same `fog` the HUD's coverage reads —
      // so the panel and the map can never disagree about what is proved.
      legend.update(answeredSet, orbit === null ? 'map' : 'orbit');
      hud.update(
        coverage(fog, scene.nodes.length),
        orbit === null ? stats.level : 'orbit',
        // `peaks` is in the HUD because it is the only measured proof that
        // ADR-0013's elevation reaches a pixel. CLAUDE.md: a measurement of
        // "how many X" needs a gate proving X happened, and the e2e reads this.
        // `wires` is here for the identical reason and it is the newer of the
        // two claims, so it is the one more likely to be quietly false: a gate
        // that never opens draws a layer nobody ever sees, and simulating the
        // supply in node proves the *arithmetic*, not that a stroke happened.
        // `chains` joins them for the third time and the same reason: it is the
        // newest gated layer, its gate is what makes ADR-0049 §4.3 legal at all,
        // and a gate that never opens draws a layer nobody sees.
        `${stats.nodesDrawn} nodes · ${stats.edgesDrawn} edges · ${stats.islandsDrawn} isles · ${stats.labelsDrawn} labels · ${stats.peaksDrawn} peaks · ${stats.tiesDrawn} wires · ${stats.chainsDrawn} chains · ${stats.boardDrawn} marks`,
        openQuestions,
        unanswered.size,
        camera.bearing,
        keyHintFor(arm, orbit === null ? 'map' : 'orbit'),
      );
      refreshGuide(openQuestions);
    }
    requestAnimationFrame(frame);
  }

  // ---- interaction ------------------------------------------------------
  let dragging = false;
  /**
   * Whether this drag turns the map instead of moving it.
   *
   * Read once, at pointer-down, rather than per move: a shift key pressed or
   * released mid-drag would otherwise switch the gesture under the player's
   * hand. In the orbit every drag turns, which is the rung's whole intervention.
   */
  let turningDrag = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;

  const localPoint = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    // A walk owns the pointer for looking, not for panning a map that is not on
    // screen. Nothing here has a meaning in the world view yet — mouse-look is
    // deliberately not wired, because the keyboard turn is enough to walk with
    // and a pointer-lock gesture is a decision of its own.
    if (world.isActive()) return;
    dragging = true;
    turningDrag = event.shiftKey;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (world.isActive()) return;
    // Pointing at a candidate on the map points at its row, the mirror of the
    // row pointing at the marker. One instrument, read from either end.
    if (challengePanel.isOpen() && !dragging) {
      const over = pickAt(localPoint(event));
      challengePanel.setHovered(over?.id ?? null);
      return;
    }
    if (dragging) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = event.clientX;
      lastY = event.clientY;
      // The player's hand wins, and here it takes the *value* over rather than
      // waiting for it — this gesture is itself a pan or a turn, so snapping to
      // the schedule's destination mid-drag would be the map fighting you,
      // which is the defect `zoomAt` documents for zoom. Every other camera
      // command lands the turn instead; see `landTurn`.
      turning = null;
      if (orbit === null) {
        // Shift-drag turns the flat map. The map turns on its own between
        // challenges; this is the player's own hand on it, and it is the same
        // gesture the orbit uses, on the same value.
        if (turningDrag) camera = rotate(camera, dx * 0.006);
        else camera = pan(camera, dx, dy);
      } else {
        // Drag turns the world. This is the whole intervention: motion parallax
        // over a structure you stay outside of is what the measured 3D win is
        // made of, and it beat stereo in the study that separated them
        // (`docs/prior-art.md` §2). Horizontal turns the camera — the *same*
        // bearing the flat map uses, so `o` never changes which way you face —
        // and vertical tips the eye, which only this view has.
        camera = rotate(camera, dx * 0.006);
        orbit = tip(orbit, -dy * 0.004);
      }
      invalidate();
      return;
    }
    const found = pickAt(localPoint(event));
    if (found === hovered) return;
    hovered = found;
    // Hovering previews the question — "change this, what imports it?" — at the
    // depth `depthFor` allows, which for anything unproven is one hop.
    radius = found === null ? null : blastRadius(scene, found.ref, depthFor(found));
    tieFocus = focusFor(found);
    if (found !== null) describe(found);
    else if (selected !== null) {
      radius = blastRadius(scene, selected.ref, depthFor(selected));
      tieFocus = focusFor(selected);
      describe(selected);
    } else describe(null);
    canvas.style.cursor = found === null ? 'grab' : 'pointer';
    invalidate();
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (moved > DRAG_THRESHOLD) return;

    const found = pickAt(localPoint(event));
    // **With a board open, a click on the map answers it.** The scrim is
    // pointer-transparent now, so this is where those clicks land, and the
    // console decides whether the node is one of its candidates — the shell
    // hands over what the pointer found and never inspects the challenge. A
    // click on anything else does nothing rather than closing the board, which
    // is what it used to do, silently, taking the ticks with it.
    if (challengePanel.isOpen()) {
      if (found !== null) challengePanel.toggle(found.id);
      return;
    }
    selected = found;
    if (found !== null) {
      remember(recordSurvey(progress, [found.id]));
      radius = blastRadius(scene, found.ref, depthFor(found));
      tieFocus = focusFor(found);
    } else {
      radius = null;
      tieFocus = null;
    }
    describe(found);
    invalidate();
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // The world has no zoom: the eye is a body's eye, and a scroll wheel that
      // pushed it through a wall would be a camera control in a view whose one
      // claim is that you are standing somewhere.
      if (world.isActive()) return;
      const factor = Math.exp(-event.deltaY * 0.0015);
      // In orbit, zoom about the viewport centre rather than the pointer.
      // `zoomAt` keeps the world point *under the cursor* fixed, and it works
      // that out with the flat inverse. That inverse now carries the bearing —
      // so the *turn* is no longer the discrepancy — but pitch, foreshortening
      // and lift still live outside it, so in a tipped view the cursor still
      // names a different place than the one being pointed at and the map would
      // slide out from under the wheel. Centre-anchored zoom stays the honest
      // version here until the orbit has an inverse of its own; `pickColumn` is
      // that inverse for hit-testing and does it in screen space instead.
      camera = zoomAt(
        camera,
        viewport,
        orbit === null ? localPoint(event) : { x: viewport.width / 2, y: viewport.height / 2 },
        factor,
      );
      invalidate();
    },
    { passive: false },
  );

  /**
   * Panels that are about the *map* and are wrong at street level.
   *
   * The inspector says "click a landmark, hover to see what imports it", which
   * describes a mouse on a map; the legend sits exactly where the minimap goes.
   * Hidden rather than rebuilt for the world, because a second inspector is a
   * second place for the two views to disagree about what a node is — and this
   * repo's landmine about a rule living twice has been paid for four times.
   */
  const mapOnlyPanels = [legend.root, inspector.root];

  function enterWorld(): void {
    landTurn();
    for (const panel of mapOnlyPanels) panel.style.display = 'none';
    // Standing where the map was looking. `selected` is the flat map's own
    // pick, so the two views agree about where "here" is without the world
    // needing to know how a selection was made.
    world.enter(scene, selected);
    measureChrome();
    invalidate();
  }

  function leaveWorld(): void {
    world.exit();
    for (const panel of mapOnlyPanels) panel.style.removeProperty('display');
    // The flat map is not re-framed on the way out, for the same reason the
    // orbit is not: a camera the player moved is theirs, and spatial memory
    // lives in the frame they left.
    measureChrome();
    invalidate();
  }

  window.addEventListener('keyup', (event) => {
    if (world.keyUp(event.key)) invalidate();
  });

  // A tab that loses focus keeps no key down. Without this, alt-tabbing mid
  // stride leaves the hero walking into a wall until you come back.
  window.addEventListener('blur', () => {
    world.releaseAll();
  });

  window.addEventListener('keydown', (event) => {
    // **The help card first, and Escape closes it before anything else.** It is
    // the one control that has to work from every view, or it is not help.
    if (event.key === '?' && !challengePanel.isOpen() && !notebook.isOpen()) {
      help.toggle(arm, viewNow());
      if (world.isActive()) world.releaseAll();
      return;
    }
    if (event.key === 'Escape' && help.isOpen()) {
      help.close();
      return;
    }
    if (event.key === 'Escape' && challengePanel.isOpen()) {
      challengePanel.close();
      return;
    }
    if (event.key === 'Escape' && notebook.isOpen()) {
      notebook.close();
      return;
    }
    if (event.key === 'Escape' && world.isActive() && !locked) {
      leaveWorld();
      return;
    }
    if (challengePanel.isOpen() || notebook.isOpen()) {
      // A key held when the console opened would otherwise still be held when it
      // closes, and the hero would walk off on its own. Releasing everything is
      // the cheap fix and it is the right one: a modal takes the keyboard.
      if (world.isActive()) world.releaseAll();
      return;
    }
    if (event.key.toLowerCase() === 'g' && !locked) {
      // ADR-0033. In from wherever the map has selected — §3.4's fast travel,
      // so crossing django to reach one file is a click and not a commute —
      // and out to the flat map, which stays the arrival state and is never
      // more than this one keystroke away (ADR-0009 D1).
      if (world.isActive()) leaveWorld();
      else enterWorld();
      return;
    }
    if (world.isActive()) {
      if (event.key === 'o' && !locked) {
        // Three views over one atlas, and the keys move between all of them.
        // `o` was silently swallowed here — a keypress that does nothing and
        // says nothing reads as a broken control rather than as a refusal.
        leaveWorld();
        landTurn();
        orbit = DEFAULT_ORBIT;
        camera = fit(scene.bounds, viewport, camera.bearing);
        invalidate();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const upcoming = nextUp();
        const targetRef =
          upcoming === null ? undefined : scene.graph.refById.get(upcoming.subject);
        const focus = world.focus(
          unanswered,
          nextPlacelessChallenge() !== null,
          targetRef === undefined ? null : (scene.nodes[targetRef] ?? null),
        );
        if (focus === null) return;
        event.preventDefault();
        const challenge =
          focus.kind === 'chronicle' ? nextPlacelessChallenge() : challengeFor(focus.tower.node);
        // **Drop the keyboard here, not on the next keydown.** A whole grade can
        // be mouse-only — pick rows, submit, close — so a `w` held at the moment
        // Enter was pressed kept the hero walking and surveying behind the
        // scrim, measured at 51 → 65 surveyed during one panel. The modal takes
        // the keyboard the instant it opens.
        if (challenge !== null) {
          world.releaseAll();
          openBoard(challenge);
        }
        return;
      }
      if (world.keyDown(event.key)) {
        // Arrows scroll the page and space would too; a walk owns them while it
        // is running.
        event.preventDefault();
        invalidate();
      }
      return;
    }
    // **Keyboard pan and zoom, and the map had neither.** A cold playtester
    // scored the controls 6 of 10; the flat map could only be moved with a
    // mouse, which is a real gap on a laptop trackpad and an absolute one for
    // anyone who does not use a pointer. Screen-space deltas through the same
    // `pan` the drag uses, so the arrows move the *view* and keep meaning the
    // same thing after the map has turned — which it does between every
    // challenge (ADR-0017).
    const nudge = PAN_STEP * (event.shiftKey ? 3 : 1);
    const arrow: Record<string, readonly [number, number]> = {
      ArrowLeft: [nudge, 0],
      ArrowRight: [-nudge, 0],
      ArrowUp: [0, nudge],
      ArrowDown: [0, -nudge],
    };
    const step = arrow[event.key];
    if (step !== undefined) {
      event.preventDefault();
      landTurn();
      camera = pan(camera, step[0], step[1]);
      invalidate();
      return;
    }
    if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_') {
      event.preventDefault();
      landTurn();
      // About the middle of the view rather than the pointer, which may be
      // anywhere or nowhere: a keyboard zoom has no anchor to keep fixed except
      // the one the player is looking at.
      camera = zoomAt(
        camera,
        viewport,
        { x: viewport.width / 2, y: viewport.height / 2 },
        event.key === '+' || event.key === '=' ? ZOOM_STEP : 1 / ZOOM_STEP,
      );
      invalidate();
      return;
    }
    if (event.key === 'f') {
      // Fit *at the current heading*, never back to north: `f` answers "show me
      // all of it", and a fit that also straightened the map would quietly undo
      // the turn every time the player used the most ordinary control there is.
      // Landing first so "the current heading" is the one the turn was taking
      // us to, rather than wherever it had got to this frame.
      landTurn();
      camera = fit(scene.bounds, viewport, camera.bearing);
      invalidate();
    }
    if (event.key === 'n') {
      // The way back. Guardrail 6 in a keystroke: the map turning between
      // challenges must never be something the player cannot get out of.
      // About the middle of the screen, not about a selection — "straighten
      // this view" is a claim about the view.
      turnTo(facingNorth(camera), null);
    }
    if (event.key === 'o' && !locked) {
      // One key there, the same key back. ADR-0009's D1 — the overview survives
      // — is only a real promise if leaving it costs one keystroke, so the flat
      // map is never more than `o` away and it is what the player arrives in.
      // A pivot is a flat-map screen point and means nothing once the world
      // is tipped, so the turn lands before the view changes under it.
      landTurn();
      orbit = orbit === null ? DEFAULT_ORBIT : null;
      // **Re-fit on the way in, and only on the way in.** The orbit lifts every
      // column above its footing and pushes the whole world down by a headroom
      // term, so a camera framed for the flat map puts the tallest files off the
      // top edge — you press `o` and the thing the view exists to show is the
      // thing that leaves. Fitting the *flat* bounds is the honest frame for
      // that: X and Y are untouched by the projection (ADR-0009's "additive,
      // preserving today's X,Y"), and the extra height is what `fitScale` gives
      // margin for.
      //
      // Coming back out does **not** re-fit, because the flat map is where
      // spatial memory lives and a camera the player moved is theirs. The
      // asymmetry is the point, not an omission.
      if (orbit !== null) camera = fit(scene.bounds, viewport, camera.bearing);
      invalidate();
    }
    if (event.key === 'Enter') {
      const challenge = challengeFor(selected);
      if (challenge !== null) {
        event.preventDefault();
        openBoard(challenge);
      }
    }
  });

  // Frame the map once, on the first layout that has a real size. Re-fitting on
  // every resize would throw away wherever the player had navigated to, which
  // is the opposite of building spatial memory.
  let framed = false;
  const observer = new ResizeObserver(() => {
    resize();
    if (!framed && viewport.width > 1 && viewport.height > 1) {
      camera = fit(scene.bounds, viewport, camera.bearing);
      framed = true;
    }
  });
  observer.observe(canvas);

  // A restored session may already have notes; the toggle has to say so before
  // it is ever clicked.
  refreshNotes();
  resize();
  // The arrival state is north-up: the canonical map, the one every previous
  // session learned, and ADR-0009's D1 overview. The heading is never restored
  // from the save (ADR-0011 decision 2) — it is earned again, one grade at a
  // time.
  camera = fit(scene.bounds, viewport, NORTH);
  // An arm starts *in* its view. Arriving in the flat map and being walked into
  // the other one would give every participant a look at the control condition
  // first, which is the contamination the between-subjects design exists to
  // prevent — and the orbit's entry re-fit is the same one `o` does, because a
  // camera framed for the flat map puts the tallest columns off the top edge.
  if (arm === 'orbit') {
    orbit = DEFAULT_ORBIT;
    camera = fit(scene.bounds, viewport, NORTH);
  }
  if (arm === 'world') enterWorld();
  frame();
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('missing #app');
  try {
    const atlas = await loadAtlas(ATLAS_URL);
    start(prepare(atlas), root, armFromSearch(window.location.search));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    root.replaceChildren(createError(message));
    console.error(error);
  }
}

void main();
