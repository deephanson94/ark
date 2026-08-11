/**
 * The minimap — the flat map, small, always on, and **north-up**.
 *
 * ## Why it exists
 *
 * Proposed by the owner. ADR-0033 adopts it as load-bearing rather than as
 * convenience, and the argument is `docs/prior-art.md`'s, not a game
 * convention: studying a map produces **survey** knowledge (relative position,
 * global layout, which node is the hub) and navigating produces **route**
 * knowledge, and survey knowledge is the thing ark is for. A walkable world on
 * its own bets the whole rung on the weaker of the two. The minimap is the only
 * element that keeps both encodings *co-present*, so "where I am standing" can
 * be bound to "where that is on the map" continuously instead of by recall
 * across a mode switch.
 *
 * ## Why north-up, against ADR-0032 §3.5
 *
 * That section said it turns with the player and named the cost. Building it
 * settled the trade the other way, and the reason is worth keeping: a minimap
 * that turns is a *route* instrument — it tells you what is ahead — and a
 * north-up one is a *survey* instrument, which is what the product teaches. It
 * also resolves the tension §9.8 raised with ADR-0017: the fixed frame lives on
 * the minimap, the varied viewpoints live in the world, and the player gets
 * both rather than losing one to the other. Heading is not lost — the hero's
 * arrow carries it, which is the standard way of showing a heading against a
 * fixed frame.
 *
 * It draws **edges**, and that is stated rather than hidden: ADR-0033 §4 records
 * that if a player reads topology off this inset rather than off the world, the
 * honest conclusion is that the 2D map was doing the work — which is exactly
 * what `docs/experiments/0001` has to be able to detect, and why the minimap
 * must be present in both of its arms or in neither.
 */

import type { NodeRef } from '../../atlas/index.js';
import type { Viewport } from '../camera.js';
import type { Fog } from '../fog.js';
import { visibilityOf } from '../fog.js';
import { INK, regionColor, regionSilhouette } from '../palette.js';
import type { World } from './build.js';
import type { Hero } from './hero.js';
import { VIEW_DISTANCE } from './render.js';

export interface MinimapInput {
  readonly world: World;
  readonly hero: Hero;
  readonly viewport: Viewport;
  readonly fog: Fog;
  readonly questions: ReadonlySet<NodeRef>;
  /** Where the guide is sending the player, if anywhere. */
  readonly waypoint: { readonly x: number; readonly y: number } | null;
  /** The world camera's field of view, for the sight cone. */
  readonly fovRadians: number;
}

const SIZE = 176;
const MARGIN = 18;
const PADDING = 10;

export interface MinimapBox {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Where the inset sits. Exported so the frame can keep labels out of it. */
export function minimapBox(viewport: Viewport): MinimapBox {
  return { x: MARGIN, y: viewport.height - SIZE - MARGIN, size: SIZE };
}

export function drawMinimap(context: CanvasRenderingContext2D, input: MinimapInput): number {
  const { world, hero, viewport, fog, questions, waypoint, fovRadians } = input;
  const box = minimapBox(viewport);
  const bounds = world.bounds;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = (box.size - PADDING * 2) / Math.max(spanX, spanY);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const centreX = box.x + box.size / 2;
  const centreY = box.y + box.size / 2;
  const toMap = (x: number, y: number): { x: number; y: number } => ({
    x: centreX + (x - midX) * scale,
    y: centreY + (y - midY) * scale,
  });

  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.size, box.size);
  context.fillStyle = 'rgba(6, 9, 14, 0.82)';
  context.fill();
  context.strokeStyle = 'rgba(150, 172, 205, 0.28)';
  context.lineWidth = 1;
  context.stroke();
  context.clip();

  // **The sight cone, drawn before anything else.** The playtest's sharpest
  // non-bug complaint was that a walker sees a neighbourhood where the flat map
  // shows the whole repo — and this inset *is* the whole repo. What it was
  // missing is the join: which part of it is in front of you right now. A wedge
  // in the facing direction, spanning the world camera's own field of view, is
  // the standard way of binding an egocentric view to a survey one, and it is
  // the mechanism ADR-0033 §6 says the minimap exists for.
  const sight = context.createRadialGradient(0, 0, 0, 0, 0, VIEW_DISTANCE * scale);
  sight.addColorStop(0, 'rgba(255, 236, 190, 0.20)');
  sight.addColorStop(1, 'rgba(255, 236, 190, 0)');
  context.save();
  const eyeAt = toMap(hero.x, hero.y);
  context.translate(eyeAt.x, eyeAt.y);
  context.rotate(hero.facing);
  context.fillStyle = sight;
  context.beginPath();
  context.moveTo(0, 0);
  // Facing 0 is −Y, which is up on this inset, so the wedge opens upward.
  context.arc(0, 0, VIEW_DISTANCE * scale, -Math.PI / 2 - fovRadians / 2, -Math.PI / 2 + fovRadians / 2);
  context.closePath();
  context.fill();
  context.restore();

  context.strokeStyle = 'rgba(140, 160, 190, 0.14)';
  context.lineWidth = 0.6;
  context.beginPath();
  for (const road of world.roads) {
    const a = toMap(road.from.node.x, road.from.node.y);
    const b = toMap(road.to.node.x, road.to.node.y);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.stroke();

  let lit = 0;
  for (const tower of world.towers) {
    const at = toMap(tower.node.x, tower.node.y);
    const state = visibilityOf(fog, tower.node.id);
    const dot = Math.max(0.8, tower.footprint * scale);
    context.beginPath();
    context.arc(at.x, at.y, dot, 0, Math.PI * 2);
    context.fillStyle =
      state === 'silhouette'
        ? regionSilhouette(tower.node.regionIndex, 1)
        : regionColor(tower.node.regionIndex, 1);
    context.fill();
    if (questions.has(tower.ref)) {
      context.beginPath();
      context.arc(at.x, at.y, dot + 2, 0, Math.PI * 2);
      context.strokeStyle = INK.question;
      context.lineWidth = 1;
      context.stroke();
      lit++;
    }
  }

  // The chronicle, so the one landmark that is not a file is findable from the
  // inset too. A diamond, because it is not a node and must not read as one.
  const chronicle = toMap(world.chronicle.x, world.chronicle.y);
  context.beginPath();
  context.moveTo(chronicle.x, chronicle.y - 4);
  context.lineTo(chronicle.x + 4, chronicle.y);
  context.lineTo(chronicle.x, chronicle.y + 4);
  context.lineTo(chronicle.x - 4, chronicle.y);
  context.closePath();
  context.fillStyle = 'rgba(240, 168, 92, 0.9)';
  context.fill();

  // Where the guide is sending you, on the survey view as well as in the world:
  // a ring that is not a node marker, so it cannot be mistaken for a file.
  if (waypoint !== null) {
    const at = toMap(waypoint.x, waypoint.y);
    context.strokeStyle = 'rgba(255, 214, 130, 0.95)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(at.x, at.y, 6, 0, Math.PI * 2);
    context.stroke();
  }

  // The hero: a triangle pointing the way they face. Facing 0 is −Y, which is
  // up on this inset because the inset is the flat map and the flat map's −Y is
  // up — the one identity that makes the two readable as the same place.
  const at = toMap(hero.x, hero.y);
  context.save();
  context.translate(at.x, at.y);
  context.rotate(hero.facing);
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(4.5, 5);
  context.lineTo(0, 2.5);
  context.lineTo(-4.5, 5);
  context.closePath();
  context.fillStyle = '#ffeec9';
  context.fill();
  context.restore();

  context.restore();

  context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = INK.textDim;
  context.fillText('N', box.x + box.size / 2 - 3, box.y + 11);
  return lit;
}
