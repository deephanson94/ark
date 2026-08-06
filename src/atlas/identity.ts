/**
 * Node identity.
 *
 * A node's id is derived from its *origin path* — the earliest path git knows
 * the file by — not its current path. That is what lets a player's fog of war
 * and field notes survive `git mv` (ADR-0002).
 *
 * The hash is FNV-1a, hand-rolled in 32-bit arithmetic rather than pulled from
 * `node:crypto`, because this module is on the player's side of the wall too
 * and the player must stay a pure function of the atlas with no Node built-ins.
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET_A = 0x811c9dc5;
/** A second, arbitrary basis. Two independent 32-bit digests give us 64 bits. */
const FNV_OFFSET_B = 0x7f4a7c15;

function fnv1a(input: string, basis: number): number {
  let hash = basis;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
    // charCodeAt gives UTF-16 units; fold the high byte in so non-ASCII paths
    // do not collide with their low-byte-equal neighbours.
    hash ^= (input.charCodeAt(i) >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0');
}

/** `n:` + 12 lowercase hex chars (48 bits) derived from `originPath`. */
export function nodeIdFor(originPath: string): string {
  const digest = hex8(fnv1a(originPath, FNV_OFFSET_A)) + hex8(fnv1a(originPath, FNV_OFFSET_B));
  return `n:${digest.slice(0, 12)}`;
}

/** Shape check only — says nothing about whether the id is in a given atlas. */
export function isNodeId(value: string): boolean {
  return /^n:[0-9a-f]{12}$/.test(value);
}
