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

import type { Atlas, Challenge, NodeId, NodeRef } from '../atlas/index.js';
import { parseAtlas } from '../atlas/index.js';
import type { Camera, Point } from './camera.js';
import {
  NORTH,
  centreOn,
  facingNorth,
  fit,
  pan,
  pivotAround,
  rotate,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './camera.js';
import { createConsole } from './challenge.js';
import { drawFrame, drawOrbitFrame } from './draw.js';
import type { Fog } from './fog.js';
import { coverage, landmarks } from './fog.js';
import { GOLDEN_TURN, TURN_MS, bearingDuring } from './heading.js';
import type { Orbit } from './orbit.js';
import { DEFAULT_ORBIT, pickColumn, tip } from './orbit.js';
import type { Progress } from './progress.js';
import { VERBS, channelOf } from '../verbs/index.js';
import { answerKey, answeredKeys, applyGrade, deriveFog, livenessOf, recordSurvey, subjectsPassed } from './progress.js';
import { browserStore, loadProgress, saveProgress, storageKeyFor } from './save.js';
import type { Radius, Scene, SceneNode } from './scene.js';
import { DIRECT_ONLY, FULL_RADIUS, blastRadius, pick, prepare } from './scene.js';
import type { Ties } from './ties.js';
import { NO_TIES, tiesNamedBy } from './ties.js';
import type { SelectorState } from './selector.js';
import { NO_HISTORY, noteAttempt, suggestNext } from './selector.js';
import { fieldNotes } from './notes.js';
import {
  createError,
  createGuide,
  createHud,
  createInspector,
  createLegend,
  createNotebook,
} from './ui.js';
import { DISTRICT_SCALE } from './zoom.js';

const ATLAS_URL = 'atlas.json';
/** Pointer movement below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

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

function start(scene: Scene, root: HTMLElement): void {
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
  let progress: Progress = loadProgress(store, saveKey);
  let fog: Fog = deriveFog(progress, liveness, shore);
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

  const retie = (): void => {
    const answered = answeredKeys(progress, liveness);
    const passed: Challenge[] = [];
    const openBoards = new Set<NodeRef>();
    for (const bucket of challengesById.values()) {
      for (const challenge of bucket) {
        if (channelOf(challenge.verb) !== 'coChangeTies') continue;
        const ref = scene.graph.refById.get(challenge.subject);
        if (answered.has(answerKey(challenge.verb, challenge.subject))) passed.push(challenge);
        else if (ref !== undefined) openBoards.add(ref);
      }
    }
    ties = tiesNamedBy(scene.atlas, scene.graph, passed, openBoards);
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
  const pickAt = (local: { x: number; y: number }): SceneNode | null => {
    if (orbit !== null) return pickColumn(scene.nodes, camera, viewport, orbit, local);
    const world = screenToWorld(camera, viewport, local);
    return pick(scene, world.x, world.y, camera.scale);
  };

  const remember = (next: Progress): void => {
    progress = next;
    fog = deriveFog(progress, liveness, shore);
    tracedRadius = subjectsPassed(progress, liveness, 'blastRadius');
    retie();
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
    const bucket = challengesById.get(challenge.subject);
    if (bucket === undefined) challengesById.set(challenge.subject, [challenge]);
    else bucket.push(challenge);
  }
  const unanswered = new Set<NodeRef>();
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
    // The selector reads the *same* set, so the HUD counter, the map's rings
    // and the button can never disagree about what is left.
    selector = { ...selector, answered };
  };
  retally();
  // Wires a restored save has already earned, before the first frame.
  retie();

  const regionOf = (subject: NodeId): string => {
    const ref = scene.graph.refById.get(subject);
    return ref === undefined ? '' : (scene.atlas.nodes[ref]?.region ?? '');
  };
  const nextUp = (): Challenge | null =>
    suggestNext(scene.atlas.challenges, regionOf, selector);

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
   * Which question a click on this node opens.
   *
   * The first one the player has not passed, in the atlas's own order, so a
   * node carrying both verbs offers Blast Radius until it is answered and then
   * Companion. Falling back to the first challenge when everything is answered
   * keeps the inspector able to say what the node was asked about.
   */
  const challengeFor = (node: SceneNode | null): Challenge | null => {
    if (node === null) return null;
    const bucket = challengesById.get(node.id);
    if (bucket === undefined || bucket.length === 0) return null;
    return bucket.find((c) => !selector.answered.has(answerKey(c.verb, c.subject))) ?? bucket[0] ?? null;
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
    });
  };

  // Notes are re-derived on every open, never cached: a claim can decay between
  // sessions and a cached sentence would go on asserting something the graph has
  // stopped supporting (ADR-0011 decision 3).
  const notebook = createNotebook();
  const refreshNotes = (): void => {
    notebook.update(fieldNotes(scene.graph, progress, liveness));
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
      const progression = applyGrade(progress, challenge, grade);
      remember(progression.progress);
      retally();
      refreshNotes();
      // Both paths into a challenge converge here, which is why the selector's
      // history is updated here and nowhere else: a map-click answer shapes the
      // next suggestion exactly as a suggested one does, because a byte-identical
      // answer key is felt the same however the question arrived.
      selector = {
        ...selector,
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
    },
    onClose() {
      if (turnPending) {
        turnPending = false;
        turnTo(camera.bearing + GOLDEN_TURN, pivotOn(selected));
      }
      invalidate();
    },
  });
  const inspector = createInspector(scene, (challenge) => challengePanel.open(challenge));

  /**
   * Take the player to the next landmark. Deliberately does **not** open the
   * question: §4's loop is "pick a landmark", and ADR-0011 calls suggested-next
   * an affordance rather than a mode. The map stays the frame; the existing
   * "answer this" control is one keystroke away once you arrive.
   */
  const guide = createGuide(() => {
    const challenge = nextUp();
    if (challenge === null) return;
    const ref = scene.graph.refById.get(challenge.subject);
    const node = ref === undefined ? undefined : scene.nodes[ref];
    if (node === undefined) return;
    // Before touching the camera: a turn in flight owns `x`/`y` every frame.
    landTurn();
    selected = node;
    hovered = null;
    remember(recordSurvey(progress, [node.id]));
    // Far enough in that the destination's name is drawn — arriving at an
    // unlabelled dot is arriving nowhere.
    camera = centreOn(camera, node, DISTRICT_SCALE);
    radius = blastRadius(scene, node.ref, depthFor(node));
    tieFocus = focusFor(node);
    describe(node);
    invalidate();
  });

  root.replaceChildren(
    canvas,
    hud.root,
    createLegend(scene),
    inspector.root,
    guide.root,
    notebook.root,
    challengePanel.root,
  );

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
    invalidate();
  }

  function frame(): void {
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
        radius,
        questions: unanswered,
        peaks,
        ties,
        tieFocus,
      };
      const stats =
        orbit === null
          ? drawFrame(context, frameInput)
          : drawOrbitFrame(context, frameInput, orbit);
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
        `${stats.nodesDrawn} nodes · ${stats.edgesDrawn} edges · ${stats.labelsDrawn} labels · ${stats.peaksDrawn} peaks · ${stats.tiesDrawn} wires`,
        unanswered.size,
        camera.bearing,
      );
      // Recomputed, never latched: a pass can decay and a reindex can resurrect
      // its question, so a stored "you are finished" would go on lying.
      const upcoming = nextUp();
      const upcomingRef =
        upcoming === null ? undefined : scene.graph.refById.get(upcoming.subject);
      guide.update({
        next: upcoming,
        path: upcomingRef === undefined ? null : (scene.nodes[upcomingRef]?.label ?? null),
        arrived: upcoming !== null && selected?.id === upcoming.subject,
        questionsLeft: unanswered.size,
      });
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
    dragging = true;
    turningDrag = event.shiftKey;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && challengePanel.isOpen()) {
      challengePanel.close();
      return;
    }
    if (event.key === 'Escape' && notebook.isOpen()) {
      notebook.close();
      return;
    }
    if (challengePanel.isOpen() || notebook.isOpen()) return;
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
    if (event.key === 'o') {
      // One key there, the same key back. ADR-0009's D1 — the overview survives
      // — is only a real promise if leaving it costs one keystroke, so the flat
      // map is never more than `o` away and it is what the player arrives in.
      // A pivot is a flat-map screen point and means nothing once the world
      // is tipped, so the turn lands before the view changes under it.
      landTurn();
      orbit = orbit === null ? DEFAULT_ORBIT : null;
      invalidate();
    }
    if (event.key === 'Enter') {
      const challenge = challengeFor(selected);
      if (challenge !== null) {
        event.preventDefault();
        challengePanel.open(challenge);
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
  frame();
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('missing #app');
  try {
    const atlas = await loadAtlas(ATLAS_URL);
    start(prepare(atlas), root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    root.replaceChildren(createError(message));
    console.error(error);
  }
}

void main();
