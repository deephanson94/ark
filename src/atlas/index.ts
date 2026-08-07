/**
 * The atlas module: the contract between the indexer and the player.
 *
 * Both sides import from here and nowhere else. Nothing in this directory
 * touches the filesystem, the network, or a subprocess — it is pure data and
 * pure functions over that data.
 */

export { ATLAS_VERSION } from './schema.js';
export type {
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
  NodeId,
  NodeKind,
  NodeRef,
  Region,
  RepoMeta,
  SkipCount,
  Truncation,
  VerbId,
} from './schema.js';

export { isNodeId, nodeIdFor } from './identity.js';
export { byKey, byteCompare, isStrictlySorted, round2, sortedUnique } from './order.js';
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
  dependencies,
  dependents,
  idOf,
  isChallengeable,
  nodeAt,
  reach,
  refOf,
} from './graph.js';
