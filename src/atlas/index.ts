/**
 * The atlas module: the contract between the indexer and the player.
 *
 * Both sides import from here and nowhere else. Nothing in this directory
 * touches the filesystem, the network, or a subprocess — it is pure data and
 * pure functions over that data.
 */

export { ATLAS_VERSION, IMPORTING_LANGS, VERB_IDS, canImport } from './schema.js';
export type {
  Atlas,
  AtlasEdge,
  AtlasId,
  AtlasNode,
  Challenge,
  CoChangePair,
  CommitId,
  CommitRecord,
  Confidence,
  EdgeKind,
  Evidence,
  History,
  IndexReport,
  IsoDate,
  Lang,
  Lineage,
  NodeId,
  NodeKind,
  NodeRef,
  Region,
  RegionKind,
  RepoMeta,
  SkipCount,
  Truncation,
  UnreadableCount,
  VerbId,
} from './schema.js';

export {
  MAPPED_SHARE,
  UNREADABLE_FLOOR,
  coverageBadge,
  coverageSentence,
  sourceCoverage,
  unreadableLanguages,
  unreadableList,
} from './coverage.js';
export type { SourceCoverage } from './coverage.js';

export { commitIdFor, isCommitId, isNodeId, nodeIdFor } from './identity.js';
export { NO_STRATEGY, encodeWitness, isStrategyToken, readWitness, splitWitness } from './witness.js';
export { byKey, byteCompare, challengeOrder, isStrictlySorted, round2, sortedUnique } from './order.js';
export {
  AtlasValidationError,
  coChangeOrder,
  commitOrder,
  edgeOrder,
  parseAtlas,
  validateAtlas,
} from './validate.js';
export { serializeAtlas } from './serialize.js';
export type { Challengeability, Direction, Graph } from './graph.js';
export {
  buildGraph,
  commitAt,
  dependencies,
  dependentRoutes,
  dependents,
  idOf,
  routeTo,
  isChallengeable,
  nodeAt,
  reach,
  refOf,
  taintedRefs,
} from './graph.js';
