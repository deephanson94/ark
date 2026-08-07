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

import type { Atlas } from '../atlas/index.js';
import { parseAtlas } from '../atlas/index.js';
import type { Camera } from './camera.js';
import { fit, pan, screenToWorld, zoomAt } from './camera.js';
import { drawFrame } from './draw.js';
import type { Fog } from './fog.js';
import { CLEAR_FOG, coverage, landmarks, survey } from './fog.js';
import type { Radius, Scene, SceneNode } from './scene.js';
import { blastRadius, pick, prepare } from './scene.js';
import { createError, createHud, createInspector, createLegend } from './ui.js';

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

  const hud = createHud(scene.atlas);
  const inspector = createInspector(scene);
  root.replaceChildren(canvas, hud.root, createLegend(scene), inspector.root);

  let viewport = { width: 0, height: 0 };
  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let fog: Fog = { surveyed: new Set(landmarks(scene.nodes)), understood: CLEAR_FOG.understood };
  let hovered: SceneNode | null = null;
  let selected: SceneNode | null = null;
  let radius: Radius | null = null;
  let dirty = true;

  const invalidate = (): void => {
    dirty = true;
  };

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
      const stats = drawFrame(context, { scene, camera, viewport, fog, hovered, selected, radius });
      hud.update(
        coverage(fog, scene.nodes.length),
        stats.level,
        `${stats.nodesDrawn} nodes · ${stats.edgesDrawn} edges · ${stats.labelsDrawn} labels`,
      );
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
    // Hovering previews the M2 question — "change this, what breaks?" — before
    // the challenge that asks it exists.
    radius = found === null ? null : blastRadius(scene, found.ref);
    if (found !== null) inspector.show(found, radius);
    else if (selected !== null) inspector.show(selected, null);
    else inspector.show(null, null);
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
      fog = survey(fog, found.id);
      radius = blastRadius(scene, found.ref);
    } else {
      radius = null;
    }
    inspector.show(found, radius);
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
    if (event.key === 'f') {
      camera = fit(scene.bounds, viewport);
      invalidate();
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
