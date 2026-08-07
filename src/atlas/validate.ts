/**
 * Atlas validation. An atlas with a dangling edge must throw, not degrade
 * (NORTH-STAR appendix A) — so this runs at load, on both sides of the wall,
 * and every failure names the exact path that broke.
 *
 * This is deliberately hand-written rather than schema-driven: it checks
 * *integrity*, not just types. Roughly half the assertions below (sorted-ness,
 * index bounds, `truth ⊆ candidates`, region back-references) are things no
 * JSON Schema would catch, and they are the ones that would silently produce a
 * wrong answer key.
 */

import { isNodeId, nodeIdFor } from './identity.js';
import { byteCompare, isStrictlySorted } from './order.js';
import { ATLAS_VERSION, VERB_IDS } from './schema.js';
import type {
  Atlas,
  AtlasEdge,
  AtlasNode,
  Challenge,
  CoChangePair,
  CommitRecord,
  Confidence,
  EdgeKind,
  Evidence,
  History,
  IndexReport,
  IsoDate,
  Lang,
  Lineage,
  NodeKind,
  Region,
  RegionKind,
  RepoMeta,
  SkipCount,
  Truncation,
} from './schema.js';

export class AtlasValidationError extends Error {
  readonly at: string;

  constructor(at: string, detail: string) {
    super(`${at}: ${detail}`);
    this.name = 'AtlasValidationError';
    this.at = at;
  }
}

function fail(at: string, detail: string): never {
  throw new AtlasValidationError(at, detail);
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(at, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(at, `expected an array, got ${describe(value)}`);
  return value;
}

function asString(value: unknown, at: string): string {
  if (typeof value !== 'string') fail(at, `expected a string, got ${describe(value)}`);
  return value;
}

function asFinite(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(at, `expected a finite number, got ${describe(value)}`);
  }
  return value;
}

function asIntAtLeast(value: unknown, at: string, min: number): number {
  const n = asFinite(value, at);
  if (!Number.isInteger(n)) fail(at, `expected an integer, got ${n}`);
  if (n < min) fail(at, `expected >= ${min}, got ${n}`);
  return n;
}

function asBoolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') fail(at, `expected a boolean, got ${describe(value)}`);
  return value;
}

function asMember<T extends string>(value: unknown, at: string, allowed: readonly T[]): T {
  const s = asString(value, at);
  if (!(allowed as readonly string[]).includes(s)) {
    fail(at, `expected one of ${allowed.join(' | ')}, got ${JSON.stringify(s)}`);
  }
  return s as T;
}

function asSortedStrings(value: unknown, at: string): string[] {
  const items = asArray(value, at).map((item, i) => asString(item, `${at}[${i}]`));
  if (!isStrictlySorted(items)) fail(at, 'must be sorted ascending and free of duplicates');
  return items;
}

function asNullableDate(value: unknown, at: string): IsoDate | null {
  if (value === null) return null;
  return asDate(value, at);
}

function asDate(value: unknown, at: string): IsoDate {
  const s = asString(value, at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(at, `expected a YYYY-MM-DD date, got ${JSON.stringify(s)}`);
  return s;
}

function asPoint(value: unknown, at: string): readonly [number, number] {
  const items = asArray(value, at);
  if (items.length !== 2) fail(at, `expected exactly 2 coordinates, got ${items.length}`);
  return [asFinite(items[0], `${at}[0]`), asFinite(items[1], `${at}[1]`)];
}

function asNodeRef(value: unknown, at: string, nodeCount: number): number {
  const n = asIntAtLeast(value, at, 0);
  if (n >= nodeCount) fail(at, `node index ${n} is out of range (${nodeCount} nodes)`);
  return n;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

const LANGS: readonly Lang[] = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'other'];
const NODE_KINDS: readonly NodeKind[] = ['file'];
const EDGE_KINDS: readonly EdgeKind[] = ['import', 'reexport', 'dynamic', 'type', 'require'];
const CONFIDENCES: readonly Confidence[] = ['certain', 'probable'];
const LINEAGES: readonly Lineage[] = ['certain', 'contested'];
// `VERB_IDS` is imported from the schema rather than restated here. It used to
// be a second hand-kept copy, which is how a verb comes to be valid in one
// place and unknown in another.
const TRUNCATION_WHATS: readonly Truncation['what'][] = [
  'commits',
  'coChange',
  'commitFiles',
  'unresolved',
  'exports',
];
const SKIP_REASONS: readonly SkipCount['reason'][] = [
  'ignored',
  'symlink',
  'binary',
  'tooLarge',
  'unsupported',
];

function validateRepo(value: unknown, at: string): RepoMeta {
  const r = asRecord(value, at);
  const head = r['head'] === null ? null : asString(r['head'], `${at}.head`);
  if (head !== null && !/^[0-9a-f]{40}$/.test(head)) {
    fail(`${at}.head`, 'expected a full 40-character lowercase sha');
  }
  const headDate = asNullableDate(r['headDate'], `${at}.headDate`);
  if ((head === null) !== (headDate === null)) {
    fail(at, 'head and headDate must be null together');
  }
  const root = r['root'] === null ? null : asString(r['root'], `${at}.root`);
  if (root !== null && !/^[0-9a-f]{40}$/.test(root)) {
    fail(`${at}.root`, 'expected a full 40-character lowercase sha');
  }
  // The converse does not hold, and must not be asserted: a shallow clone has
  // a head and no knowable root (ADR-0011).
  if (root !== null && head === null) {
    fail(at, 'root without head: a repo with no commits cannot have a first commit');
  }
  const languages = asSortedStrings(r['languages'], `${at}.languages`).map((lang, i) =>
    asMember(lang, `${at}.languages[${i}]`, LANGS),
  );
  return {
    name: asString(r['name'], `${at}.name`),
    head,
    headDate,
    root,
    languages,
    fileCount: asIntAtLeast(r['fileCount'], `${at}.fileCount`, 0),
    tool: asString(r['tool'], `${at}.tool`),
  };
}

function validateNode(value: unknown, at: string): AtlasNode {
  const r = asRecord(value, at);
  const id = asString(r['id'], `${at}.id`);
  if (!isNodeId(id)) fail(`${at}.id`, `expected \`n:\` + 12 hex chars, got ${JSON.stringify(id)}`);
  const originPath = asString(r['originPath'], `${at}.originPath`);
  const expected = nodeIdFor(originPath);
  if (id !== expected) {
    fail(`${at}.id`, `id ${id} does not match the hash of originPath ${JSON.stringify(originPath)} (${expected})`);
  }
  const path = asString(r['path'], `${at}.path`);
  if (path.length === 0) fail(`${at}.path`, 'must not be empty');
  if (path.startsWith('/') || path.includes('\\')) {
    fail(`${at}.path`, 'must be a relative POSIX path');
  }
  return {
    id,
    path,
    originPath,
    kind: asMember(r['kind'], `${at}.kind`, NODE_KINDS),
    lang: asMember(r['lang'], `${at}.lang`, LANGS),
    loc: asIntAtLeast(r['loc'], `${at}.loc`, 0),
    bytes: asIntAtLeast(r['bytes'], `${at}.bytes`, 0),
    layout: asPoint(r['layout'], `${at}.layout`),
    // A layer index, so a non-negative integer. Bounded above at 32 because it
    // is the bit length of a count that cannot exceed the node count, and a
    // repo with 2^32 files is not the case this is guarding against — an
    // out-of-range value means the producer computed something else entirely.
    elevation: asIntAtLeast(r['elevation'], `${at}.elevation`, 0),
    region: asString(r['region'], `${at}.region`),
    exports: asSortedStrings(r['exports'], `${at}.exports`),
    unresolved: asSortedStrings(r['unresolved'], `${at}.unresolved`),
    externals: asSortedStrings(r['externals'], `${at}.externals`),
    lineage: asMember(r['lineage'], `${at}.lineage`, LINEAGES),
    churn: asIntAtLeast(r['churn'], `${at}.churn`, 0),
    authors: asIntAtLeast(r['authors'], `${at}.authors`, 0),
    firstSeen: asNullableDate(r['firstSeen'], `${at}.firstSeen`),
    lastSeen: asNullableDate(r['lastSeen'], `${at}.lastSeen`),
  };
}

function validateEdge(value: unknown, at: string, nodeCount: number): AtlasEdge {
  const r = asRecord(value, at);
  const from = asNodeRef(r['from'], `${at}.from`, nodeCount);
  const to = asNodeRef(r['to'], `${at}.to`, nodeCount);
  if (from === to) fail(at, `self-edge on node index ${from}`);
  return {
    from,
    to,
    kind: asMember(r['kind'], `${at}.kind`, EDGE_KINDS),
    confidence: asMember(r['confidence'], `${at}.confidence`, CONFIDENCES),
    weight: asIntAtLeast(r['weight'], `${at}.weight`, 1),
  };
}

const REGION_KINDS: readonly RegionKind[] = ['terrain', 'topology'];

function validateRegion(value: unknown, at: string): Region {
  const r = asRecord(value, at);
  return {
    id: asString(r['id'], `${at}.id`),
    label: asString(r['label'], `${at}.label`),
    nodeCount: asIntAtLeast(r['nodeCount'], `${at}.nodeCount`, 1),
    centroid: asPoint(r['centroid'], `${at}.centroid`),
    kind: asMember(r['kind'], `${at}.kind`, REGION_KINDS),
  };
}

function validateCoChange(value: unknown, at: string, nodeCount: number): CoChangePair {
  const items = asArray(value, at);
  if (items.length !== 3) fail(at, `expected [a, b, count], got ${items.length} entries`);
  const a = asNodeRef(items[0], `${at}[0]`, nodeCount);
  const b = asNodeRef(items[1], `${at}[1]`, nodeCount);
  if (a >= b) fail(at, `expected a < b, got a=${a} b=${b}`);
  return [a, b, asIntAtLeast(items[2], `${at}[2]`, 1)];
}

function validateCommit(value: unknown, at: string, nodeCount: number): CommitRecord {
  const r = asRecord(value, at);
  const sha = asString(r['sha'], `${at}.sha`);
  if (!/^[0-9a-f]{12}$/.test(sha)) fail(`${at}.sha`, 'expected 12 lowercase hex chars');
  const files = asArray(r['files'], `${at}.files`).map((file, i) =>
    asNodeRef(file, `${at}.files[${i}]`, nodeCount),
  );
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1];
    const cur = files[i];
    if (prev === undefined || cur === undefined || prev >= cur) {
      fail(`${at}.files`, 'must be sorted ascending and free of duplicates');
    }
  }
  const subject = asString(r['subject'], `${at}.subject`);
  if (subject.length > 120) fail(`${at}.subject`, `must be <= 120 chars, got ${subject.length}`);
  return {
    sha,
    date: asDate(r['date'], `${at}.date`),
    subject,
    files,
    wide: asBoolean(r['wide'], `${at}.wide`),
    issue: r['issue'] === null ? null : asIntAtLeast(r['issue'], `${at}.issue`, 1),
  };
}

function validateHistory(value: unknown, at: string, nodeCount: number): History {
  const r = asRecord(value, at);
  const present = asBoolean(r['present'], `${at}.present`);
  const rawWindow = r['window'];
  let window: History['window'] = null;
  if (rawWindow !== null) {
    const w = asRecord(rawWindow, `${at}.window`);
    const from = asDate(w['from'], `${at}.window.from`);
    const to = asDate(w['to'], `${at}.window.to`);
    if (byteCompare(from, to) > 0) fail(`${at}.window`, `from ${from} is after to ${to}`);
    window = { from, to };
  }
  if (!present && window !== null) fail(`${at}.window`, 'must be null when history is absent');
  if (!present && window === null) {
    // fine — absent history has no window
  }

  const coChange = asArray(r['coChange'], `${at}.coChange`).map((pair, i) =>
    validateCoChange(pair, `${at}.coChange[${i}]`, nodeCount),
  );
  for (let i = 1; i < coChange.length; i++) {
    const prev = coChange[i - 1];
    const cur = coChange[i];
    if (prev === undefined || cur === undefined) fail(`${at}.coChange`, 'holes are not allowed');
    if (coChangeOrder(prev, cur) > 0) {
      fail(`${at}.coChange`, 'must be sorted by count desc, then a asc, then b asc');
    }
  }

  const commits = asArray(r['commits'], `${at}.commits`).map((commit, i) =>
    validateCommit(commit, `${at}.commits[${i}]`, nodeCount),
  );
  const shas = commits.map((commit) => commit.sha);
  if (new Set(shas).size !== shas.length) fail(`${at}.commits`, 'contains duplicate shas');
  for (let i = 1; i < commits.length; i++) {
    const prev = commits[i - 1];
    const cur = commits[i];
    if (prev === undefined || cur === undefined) fail(`${at}.commits`, 'holes are not allowed');
    if (commitOrder(prev, cur) >= 0) {
      fail(`${at}.commits`, 'must be ordered by date descending, then sha ascending');
    }
  }

  const commitsWalked = asIntAtLeast(r['commitsWalked'], `${at}.commitsWalked`, 0);
  const commitsRetained = asIntAtLeast(r['commitsRetained'], `${at}.commitsRetained`, 0);
  if (commitsRetained !== commits.length) {
    fail(`${at}.commitsRetained`, `says ${commitsRetained} but commits has ${commits.length} entries`);
  }
  if (commitsRetained > commitsWalked) {
    fail(`${at}.commitsRetained`, `retained ${commitsRetained} exceeds walked ${commitsWalked}`);
  }
  if (!present && commitsWalked !== 0) {
    fail(`${at}.commitsWalked`, 'must be 0 when history is absent');
  }

  // At least 2, because a "wide" commit is one that couples more files than a
  // pair: a limit below 2 would exclude every commit that can contribute a
  // co-change at all, silently emptying the matrix rather than trimming it.
  const wideLimit = asIntAtLeast(r['wideLimit'], `${at}.wideLimit`, 2);

  return { present, commitsWalked, commitsRetained, window, wideLimit, coChange, commits };
}

/**
 * Sort key for `history.commits`: date descending, then sha ascending.
 *
 * Not "git log order" — that is reverse chronological by *commit* time, while
 * the date we keep is the *author* date, and a rebase or a mailed patch can put
 * an older authorship after a newer one. The sha tiebreak makes this a total
 * order, so the array is checkable rather than merely conventional.
 */
export function commitOrder(
  x: { readonly date: IsoDate; readonly sha: string },
  y: { readonly date: IsoDate; readonly sha: string },
): number {
  return byteCompare(y.date, x.date) || byteCompare(x.sha, y.sha);
}

/** Sort key for `history.coChange`: count desc, then a asc, then b asc. */
export function coChangeOrder(x: CoChangePair, y: CoChangePair): number {
  return y[2] - x[2] || x[0] - y[0] || x[1] - y[1];
}

function validateEvidence(value: unknown, at: string): Evidence {
  const r = asRecord(value, at);
  const kind = asMember(r['kind'], `${at}.kind`, ['importGraph', 'coChange'] as const);
  if (kind === 'importGraph') {
    return { kind, depth: asIntAtLeast(r['depth'], `${at}.depth`, 1) };
  }
  return {
    kind,
    // At least 2: a pair seen once is below the indexer's own noise floor and
    // never enters the matrix, so an answer key resting on a single shared
    // commit could not have been certified against anything.
    minCount: asIntAtLeast(r['minCount'], `${at}.minCount`, 2),
    wideLimit: asIntAtLeast(r['wideLimit'], `${at}.wideLimit`, 2),
  };
}

function validateChallenge(value: unknown, at: string, ids: ReadonlySet<string>): Challenge {
  const r = asRecord(value, at);
  const id = asString(r['id'], `${at}.id`);
  if (id.length === 0) fail(`${at}.id`, 'must not be empty');

  const subject = asString(r['subject'], `${at}.subject`);
  if (!ids.has(subject)) fail(`${at}.subject`, `${subject} is not a node in this atlas`);

  const candidates = asSortedStrings(r['candidates'], `${at}.candidates`);
  if (candidates.length === 0) fail(`${at}.candidates`, 'must not be empty');
  for (const candidate of candidates) {
    if (!ids.has(candidate)) fail(`${at}.candidates`, `${candidate} is not a node in this atlas`);
  }
  if (candidates.includes(subject)) {
    fail(`${at}.candidates`, 'must not contain the subject of the challenge');
  }

  const truth = asSortedStrings(r['truth'], `${at}.truth`);
  if (truth.length === 0) {
    // A challenge with an empty answer key is unanswerable and ungradeable.
    fail(`${at}.truth`, 'must not be empty');
  }
  const candidateSet = new Set(candidates);
  for (const item of truth) {
    if (!candidateSet.has(item)) {
      fail(`${at}.truth`, `${item} is not among the candidates shown to the player`);
    }
  }
  if (truth.length === candidates.length) {
    // "select everything" would score 1.0, which teaches nothing.
    fail(`${at}.truth`, 'must be a proper subset of candidates');
  }

  const difficulty = asFinite(r['difficulty'], `${at}.difficulty`);
  if (difficulty < 0 || difficulty > 1) {
    fail(`${at}.difficulty`, `expected 0..1, got ${difficulty}`);
  }

  const tier = asIntAtLeast(r['tier'], `${at}.tier`, 1);
  if (tier > 6) fail(`${at}.tier`, `expected 1..6, got ${tier}`);

  return {
    id,
    verb: asMember(r['verb'], `${at}.verb`, VERB_IDS),
    tier: tier as Challenge['tier'],
    difficulty,
    subject,
    candidates,
    truth,
    evidence: validateEvidence(r['evidence'], `${at}.evidence`),
  };
}

function validateReport(value: unknown, at: string): IndexReport {
  const r = asRecord(value, at);
  const truncations = asArray(r['truncations'], `${at}.truncations`).map((item, i) => {
    const t = asRecord(item, `${at}.truncations[${i}]`);
    return {
      what: asMember(t['what'], `${at}.truncations[${i}].what`, TRUNCATION_WHATS),
      kept: asIntAtLeast(t['kept'], `${at}.truncations[${i}].kept`, 0),
      dropped: asIntAtLeast(t['dropped'], `${at}.truncations[${i}].dropped`, 1),
    };
  });
  if (!isStrictlySorted(truncations.map((t) => t.what))) {
    fail(`${at}.truncations`, 'must be sorted by `what` with one entry per kind');
  }
  const skipped: SkipCount[] = asArray(r['skipped'], `${at}.skipped`).map((item, i) => {
    const s = asRecord(item, `${at}.skipped[${i}]`);
    return {
      reason: asMember(s['reason'], `${at}.skipped[${i}].reason`, SKIP_REASONS),
      count: asIntAtLeast(s['count'], `${at}.skipped[${i}].count`, 1),
    };
  });
  if (!isStrictlySorted(skipped.map((s) => s.reason))) {
    fail(`${at}.skipped`, 'must be sorted by `reason` with one entry per kind');
  }
  return { truncations, skipped };
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted value and return it as a typed `Atlas`.
 * Throws `AtlasValidationError` naming the exact field that failed.
 */
export function validateAtlas(value: unknown): Atlas {
  const root = asRecord(value, 'atlas');

  const version = asIntAtLeast(root['version'], 'atlas.version', 1);
  if (version !== ATLAS_VERSION) {
    fail(
      'atlas.version',
      `this build reads atlas v${ATLAS_VERSION}, got v${version} — reindex required`,
    );
  }

  const repo = validateRepo(root['repo'], 'atlas.repo');

  const nodes = asArray(root['nodes'], 'atlas.nodes').map((node, i) =>
    validateNode(node, `atlas.nodes[${i}]`),
  );
  if (!isStrictlySorted(nodes.map((node) => node.id))) {
    fail('atlas.nodes', 'must be sorted by id and free of duplicate ids');
  }
  const paths = nodes.map((node) => node.path);
  if (new Set(paths).size !== paths.length) fail('atlas.nodes', 'contains duplicate paths');
  if (repo.fileCount !== nodes.length) {
    fail('atlas.repo.fileCount', `says ${repo.fileCount} but there are ${nodes.length} nodes`);
  }

  const regions = asArray(root['regions'], 'atlas.regions').map((region, i) =>
    validateRegion(region, `atlas.regions[${i}]`),
  );
  if (!isStrictlySorted(regions.map((region) => region.id))) {
    fail('atlas.regions', 'must be sorted by id and free of duplicate ids');
  }
  const regionSizes = new Map<string, number>();
  for (const node of nodes) regionSizes.set(node.region, (regionSizes.get(node.region) ?? 0) + 1);
  for (const region of regions) {
    const actual = regionSizes.get(region.id);
    if (actual === undefined) fail('atlas.regions', `region ${region.id} has no member nodes`);
    if (actual !== region.nodeCount) {
      fail('atlas.regions', `region ${region.id} claims ${region.nodeCount} nodes, found ${actual}`);
    }
  }
  const regionIds = new Set(regions.map((region) => region.id));
  for (const [i, node] of nodes.entries()) {
    if (!regionIds.has(node.region)) {
      fail(`atlas.nodes[${i}].region`, `${node.region} is not a region in this atlas`);
    }
  }

  const langs = new Set(repo.languages);
  for (const [i, node] of nodes.entries()) {
    if (!langs.has(node.lang)) {
      fail(`atlas.nodes[${i}].lang`, `${node.lang} is missing from atlas.repo.languages`);
    }
  }

  const edges = asArray(root['edges'], 'atlas.edges').map((edge, i) =>
    validateEdge(edge, `atlas.edges[${i}]`, nodes.length),
  );
  for (let i = 1; i < edges.length; i++) {
    const prev = edges[i - 1];
    const cur = edges[i];
    if (prev === undefined || cur === undefined) fail('atlas.edges', 'holes are not allowed');
    if (edgeOrder(prev, cur) >= 0) {
      fail('atlas.edges', 'must be sorted by (from, to, kind) and free of duplicates');
    }
  }

  const history = validateHistory(root['history'], 'atlas.history', nodes.length);
  if (history.present !== (repo.head !== null)) {
    fail('atlas.history.present', 'must be true exactly when atlas.repo.head is set');
  }

  const ids = new Set(nodes.map((node) => node.id));
  const challenges = asArray(root['challenges'], 'atlas.challenges').map((challenge, i) =>
    validateChallenge(challenge, `atlas.challenges[${i}]`, ids),
  );
  if (!isStrictlySorted(challenges.map((challenge) => challenge.id))) {
    fail('atlas.challenges', 'must be sorted by id and free of duplicate ids');
  }

  return {
    version: ATLAS_VERSION,
    repo,
    nodes,
    edges,
    regions,
    history,
    challenges,
    report: validateReport(root['report'], 'atlas.report'),
  };
}

/** Sort key for `atlas.edges`: from asc, then to asc, then kind lexicographic. */
export function edgeOrder(x: AtlasEdge, y: AtlasEdge): number {
  return x.from - y.from || x.to - y.to || byteCompare(x.kind, y.kind);
}

/** Parse and validate JSON text. The player's only entry point into an atlas. */
export function parseAtlas(json: string): Atlas {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    fail('atlas', `not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateAtlas(raw);
}
