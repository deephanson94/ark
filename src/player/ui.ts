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

import type { Atlas, AtlasNode } from '../atlas/index.js';
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
  update(coverage: Coverage, level: string, stats: string): void;
}

export function createHud(atlas: Atlas): Hud {
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
  const detail = el('div', 'hud-detail');

  const root = el('div', 'hud', [title, head, progress, counts, detail]);

  return {
    root,
    update(coverage, level, stats) {
      bar.style.width = `${(coverage.fraction * 100).toFixed(1)}%`;
      // Two numbers, deliberately separate. Surveyed is what you have looked
      // at; understood is what you have proven. Only the second lifts the fog
      // for real, and until the Blast Radius verb lands it is honestly zero.
      counts.textContent = `${coverage.understood} understood · ${coverage.surveyed} surveyed · ${coverage.total} files`;
      detail.textContent = `${level} · ${stats}`;
    },
  };
}

export interface Inspector {
  readonly root: HTMLElement;
  show(node: SceneNode | null, radius: Radius | null): void;
}

export function createInspector(scene: Scene): Inspector {
  const empty = el('div', 'inspector-empty', [
    'Click a landmark to survey it. Hover to see what would break if you changed it.',
  ]);
  const body = el('div', 'inspector-body');
  const root = el('aside', 'inspector', [empty, body]);

  return {
    root,
    show(node, radius) {
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
        field('depended on by', String(node.dependentCount)),
      );

      if (radius !== null && radius.subject === node.ref) {
        body.append(
          field(
            `blast radius (≤${radius.maxDepth} hops)`,
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
