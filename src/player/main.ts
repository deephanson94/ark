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
import type { Camera } from './camera.js';
import { centreOn, fit, pan, screenToWorld, zoomAt } from './camera.js';
import { createConsole } from './challenge.js';
import { drawFrame } from './draw.js';
import type { Fog } from './fog.js';
import { coverage, landmarks } from './fog.js';
import type { Progress } from './progress.js';
import { answeredSubjects, applyGrade, deriveFog, livenessOf, recordSurvey } from './progress.js';
import { browserStore, loadProgress, saveProgress, storageKeyFor } from './save.js';
import type { Radius, Scene, SceneNode } from './scene.js';
import { DIRECT_ONLY, FULL_RADIUS, blastRadius, pick, prepare } from './scene.js';
import type { SelectorState } from './selector.js';
import { NO_HISTORY, noteAttempt, suggestNext } from './selector.js';
import { createError, createGuide, createHud, createInspector, createLegend } from './ui.js';
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
  let camera: Camera = { x: 0, y: 0, scale: 1 };

  // `progress` is the state; `fog` is a view of it (ADR-0011). Everything the
  // player earns is written to the record and the fog is re-derived, so there
  // is exactly one place a promotion can happen and the reload path is the same
  // code as the live one — a save that restores wrongly would be a bug in a
  // function the whole session already exercised.
  const store = browserStore();
  const saveKey = storageKeyFor(scene.atlas.repo);
  const liveness = livenessOf(scene.graph);
  const shore = landmarks(scene.nodes);
  let progress: Progress = loadProgress(store, saveKey);
  let fog: Fog = deriveFog(progress, liveness, shore);

  const remember = (next: Progress): void => {
    progress = next;
    fog = deriveFog(progress, liveness, shore);
    saveProgress(store, saveKey, progress);
  };

  let hovered: SceneNode | null = null;
  let selected: SceneNode | null = null;
  let radius: Radius | null = null;
  let dirty = true;

  const invalidate = (): void => {
    dirty = true;
  };

  // One question per subject, looked up by node id. Challenges the player has
  // passed drop out of `unanswered`, which is what the map's rings and the
  // HUD's counter both read.
  const challengeById = new Map(scene.atlas.challenges.map((c) => [c.subject, c]));
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
    const answered = answeredSubjects(progress, liveness);
    unanswered.clear();
    for (const [id] of challengeById) {
      const ref = scene.graph.refById.get(id);
      if (ref !== undefined && !answered.has(id)) unanswered.add(ref);
    }
    // The selector reads the *same* set, so the HUD counter, the map's rings
    // and the button can never disagree about what is left.
    selector = { ...selector, answered };
  };
  retally();

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
  const depthFor = (node: SceneNode): number =>
    fog.understood.has(node.id) ? FULL_RADIUS : DIRECT_ONLY;

  const challengeFor = (node: SceneNode | null): Challenge | null =>
    node === null ? null : (challengeById.get(node.id) ?? null);

  const describe = (node: SceneNode | null): void => {
    inspector.show({
      node,
      radius: node === null ? null : radius,
      understood: node !== null && fog.understood.has(node.id),
      challenge: challengeFor(node),
    });
  };

  const hud = createHud(scene.atlas);
  const challengePanel = createConsole(scene, {
    onGraded(challenge, grade) {
      const progression = applyGrade(progress, challenge, grade);
      remember(progression.progress);
      retally();
      // Both paths into a challenge converge here, which is why the selector's
      // history is updated here and nowhere else: a map-click answer shapes the
      // next suggestion exactly as a suggested one does, because a byte-identical
      // answer key is felt the same however the question arrived.
      selector = {
        ...selector,
        previous: challenge,
        attempts: progression.unlocked
          ? selector.attempts
          : noteAttempt(selector.attempts, challenge.subject),
      };
      const ref = scene.graph.refById.get(challenge.subject);
      if (ref !== undefined) {
        // The reveal fires on every grade, pass or fail — guardrail 6 says a
        // wrong answer never takes anything away, so seeing the true shape is
        // not a reward, it is the point of having answered at all.
        selected = scene.nodes[ref] ?? selected;
        radius = blastRadius(scene, ref, FULL_RADIUS);
      }
      describe(selected);
      invalidate();
    },
    onClose() {
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
    selected = node;
    hovered = null;
    remember(recordSurvey(progress, [node.id]));
    // Far enough in that the destination's name is drawn — arriving at an
    // unlabelled dot is arriving nowhere.
    camera = centreOn(camera, node, DISTRICT_SCALE);
    radius = blastRadius(scene, node.ref, depthFor(node));
    describe(node);
    invalidate();
  });

  root.replaceChildren(
    canvas,
    hud.root,
    createLegend(scene),
    inspector.root,
    guide.root,
    challengePanel.root,
  );

  function resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    invalidate();
  }

  function frame(): void {
    if (dirty) {
      dirty = false;
      const stats = drawFrame(context, {
        scene,
        camera,
        viewport,
        fog,
        hovered,
        selected,
        radius,
        questions: unanswered,
      });
      hud.update(
        coverage(fog, scene.nodes.length),
        stats.level,
        `${stats.nodesDrawn} nodes · ${stats.edgesDrawn} edges · ${stats.labelsDrawn} labels`,
        unanswered.size,
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
  let moved = 0;
  let lastX = 0;
  let lastY = 0;

  const localPoint = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
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
      camera = pan(camera, dx, dy);
      invalidate();
      return;
    }
    const local = localPoint(event);
    const world = screenToWorld(camera, viewport, local);
    const found = pick(scene, world.x, world.y, camera.scale);
    if (found === hovered) return;
    hovered = found;
    // Hovering previews the question — "change this, what imports it?" — at the
    // depth `depthFor` allows, which for anything unproven is one hop.
    radius = found === null ? null : blastRadius(scene, found.ref, depthFor(found));
    if (found !== null) describe(found);
    else if (selected !== null) {
      radius = blastRadius(scene, selected.ref, depthFor(selected));
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

    const local = localPoint(event);
    const world = screenToWorld(camera, viewport, local);
    const found = pick(scene, world.x, world.y, camera.scale);
    selected = found;
    if (found !== null) {
      remember(recordSurvey(progress, [found.id]));
      radius = blastRadius(scene, found.ref, depthFor(found));
    } else {
      radius = null;
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
      camera = zoomAt(camera, viewport, localPoint(event), factor);
      invalidate();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && challengePanel.isOpen()) {
      challengePanel.close();
      return;
    }
    if (challengePanel.isOpen()) return;
    if (event.key === 'f') {
      camera = fit(scene.bounds, viewport);
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
      camera = fit(scene.bounds, viewport);
      framed = true;
    }
  });
  observer.observe(canvas);

  resize();
  camera = fit(scene.bounds, viewport);
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
