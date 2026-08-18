/**
 * Proved chains: the import route from each thing you proved to the thing you
 * proved it about, and the rule for when the map may draw it.
 *
 * Round 5's most-repeated request was *"make the map itself the scoreboard"*,
 * and four cold playtesters named the same mechanism: *"keep each proved chain
 * drawn"*. **ADR-0049 §4.3 is the one of those asks the product can honour** —
 * it refuses edge direction permanently and permits this, because passing a
 * board already unlocks the cone the chain lies inside.
 *
 * ## The permission was granted on an incomplete argument
 *
 * That paragraph's reason is *"it adds no node and no edge the map is not
 * already drawing"*, which is true about nodes and edges and **false about
 * direction** — the thing decisions 1 and 2 of the same document exist to
 * refuse. A route drawn from a member to the subject, with the subject marked
 * as the subject, states which way every edge on it points however undirected
 * the ink is; decision 2 already calls a hover-scoped arrow *"the same leak paid
 * for in instalments"*, and a chain is a run of arrows.
 *
 * `scripts/probe-chain.ts` measures it, restricting ADR-0049's backwards walk to
 * the edges some drawn chain has revealed the direction of. Precision is 1.000
 * throughout by ADR-0008's invariant, so these are pure **recall** — the map
 * handing over an answer key with no wrong picks:
 *
 * | repo | half the deck answered | all but one | **gated** |
 * |---|---|---|---|
 * | ark | 5 of 40 beat A, 3 exact | 9 of 40, 5 exact | **0** |
 * | hono | 8 of 54, 5 exact | 14 of 54, 11 exact | **0** |
 * | kysely | 6 of 75, 5 exact | 9 of 75, 8 exact | **0** |
 *
 * ## The gate, and why it is one rule rather than two
 *
 * **A link `u → v` is drawn only when `v` carries no unanswered Blast Radius
 * board.** Every walk out of an open board `Q` must take an edge whose head is
 * `Q`, so the rule empties that walk at its first step — by construction, not by
 * threshold, which is what lets the gated column above read 0 rather than
 * "below the bar". Every one of ADR-0014's leaks was a rule that lived twice;
 * this one lives here.
 *
 * It is a gate on the **head node**, never on a row, so it obeys ADR-0020's
 * *withhold by class or by board, never by row*. And the absence it creates
 * discloses nothing: a player cannot tell a withheld link from a node no chain
 * runs through, and that a node carries an open board is already on the map as
 * its question ring.
 *
 * ## What is drawn is what a reveal already said
 *
 * The register is `subjectsPassed(…, 'blastRadius')` — **either** of ADR-0047's,
 * so a wrong answer withholds nothing (guardrail 6) — and the reveal for those
 * boards spells each route into `whyYes` in words before the map draws anything.
 * This is the picture of a sentence already spoken, which is `ties.ts`'s
 * argument for the same reason.
 *
 * Note the asymmetry that makes the gate cheap: a link is withheld only when its
 * *head* is a board subject, and most nodes on a chain are not subjects at all.
 * Measured with half the deck still open, **72.8% of the ink survives on ark,
 * 81.8% on hono, 93.0% on kysely**. That figure is quoted with the number of
 * open boards beside it on purpose — measured with one board open it reads 99%
 * on every repo, which is the bound rather than the session, and counting what a
 * gate emits instead of what survives it is how ADR-0016's wires came to vanish.
 */
import type { Challenge, Graph, NodeRef } from '../atlas/index.js';
import { dependentRoutes, isNodeId, routeTo } from '../atlas/index.js';
import { channelOf } from '../verbs/index.js';

/** One hop of a proved route: `from` imports `to`, one step closer to the subject. */
export interface ChainLink {
  readonly from: NodeRef;
  readonly to: NodeRef;
}

/** How far a node stands from a proved subject, **along links that are drawn**. */
export interface ChainHop {
  readonly distance: number;
  /** The proved subject the route ends at. */
  readonly to: NodeRef;
}

export interface Chains {
  /** Every link the map may draw, sorted for a stable draw order. */
  readonly links: readonly ChainLink[];
  /** Links by endpoint, so brightening one node's routes costs a lookup. */
  readonly byNode: ReadonlyMap<NodeRef, readonly ChainLink[]>;
  /**
   * The hop count round 5 asked for, per node.
   *
   * **Measured over the drawn links and never over the original route**, which
   * is the trap this field exists to avoid: a chain the gate broke in the middle
   * still *has* a length, and printing it would state that the far end reaches
   * the subject across the very hop that was withheld — the leak restated as a
   * number. Distance along drawn links cannot do that, because every hop it
   * counts is on screen. A node beyond a break simply has no entry.
   */
  readonly hops: ReadonlyMap<NodeRef, ChainHop>;
  /**
   * Links the gate refused, so a session can price the rule rather than assume
   * it. Not rendered — this is an instrument, and a layer whose cost nobody
   * counts is how a gate ends up withdrawing most of what it promised.
   */
  readonly withheld: number;
}

export const NO_CHAINS: Chains = {
  links: [],
  byNode: new Map(),
  hops: new Map(),
  withheld: 0,
};

/** Every node's hop count to the nearest proved subject, over `links` only. */
function hopsOver(
  links: readonly ChainLink[],
  subjects: ReadonlySet<NodeRef>,
): Map<NodeRef, ChainHop> {
  const inbound = new Map<NodeRef, NodeRef[]>();
  for (const link of links) {
    const list = inbound.get(link.to);
    if (list === undefined) inbound.set(link.to, [link.from]);
    else list.push(link.from);
  }
  const hops = new Map<NodeRef, ChainHop>();
  // Ascending ref at every step, so two subjects equidistant from one node
  // always resolve the same way. A frontier walked in insertion order would
  // make the label depend on the order boards were answered in, which is a
  // property of the session rather than of the repo.
  let frontier = [...subjects].sort((a, b) => a - b);
  for (const subject of frontier) hops.set(subject, { distance: 0, to: subject });
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const next: NodeRef[] = [];
    for (const at of frontier) {
      const target = hops.get(at)?.to;
      if (target === undefined) continue;
      for (const from of (inbound.get(at) ?? []).slice().sort((a, b) => a - b)) {
        if (hops.has(from)) continue;
        hops.set(from, { distance, to: target });
        next.push(from);
      }
    }
    frontier = next.sort((a, b) => a - b);
  }
  // A subject is not "0 hops from itself" to a reader; it is the destination.
  for (const subject of subjects) hops.delete(subject);
  return hops;
}

/**
 * The chains the player has earned, minus the ones the gate refuses.
 *
 * `answered` is every board whose answer the player has been shown;
 * `openSubjects` is every node still carrying an unanswered board on the same
 * channel. Both come from the shell, which knows the save; this module knows
 * only the graph and the rule.
 *
 * **Every hop is re-derived from the live graph.** A save outlives the atlas
 * that produced it (ADR-0011: the key is `repo.root`, not `repo.head`), so a
 * stored pass can name a subject this atlas no longer connects — and `routeTo`
 * answers an unreachable member with the one-element chain `[from]`, which
 * yields no links and is dropped rather than approximated.
 */
export function chainsProvedBy(
  graph: Graph,
  answered: Iterable<Challenge>,
  openSubjects: ReadonlySet<NodeRef> = new Set(),
): Chains {
  const seen = new Map<string, ChainLink>();
  const subjects = new Set<NodeRef>();
  let withheld = 0;

  for (const challenge of answered) {
    // The verb's own declaration, never its name — a restored save has no
    // `Reveal`, so the licence is the static twin on the contract (`ties.ts`).
    if (channelOf(challenge.verb) !== 'importRadius') continue;
    const subject = graph.refById.get(challenge.subject);
    if (subject === undefined) continue;
    subjects.add(subject);
    const routes = dependentRoutes(graph, subject);
    for (const id of challenge.truth) {
      if (!isNodeId(id)) continue;
      const from = graph.refById.get(id);
      if (from === undefined) continue;
      const hops = routeTo(routes, from);
      for (let i = 0; i + 1 < hops.length; i++) {
        const tail = hops[i] as NodeRef;
        const head = hops[i + 1] as NodeRef;
        if (openSubjects.has(head)) {
          withheld += 1;
          continue;
        }
        seen.set(`${tail}>${head}`, { from: tail, to: head });
      }
    }
  }

  const links = [...seen.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  const byNode = new Map<NodeRef, ChainLink[]>();
  for (const link of links) {
    for (const end of [link.from, link.to]) {
      const list = byNode.get(end);
      if (list === undefined) byNode.set(end, [link]);
      else list.push(link);
    }
  }
  return { links, byNode, hops: hopsOver(links, subjects), withheld };
}

/** The links touching one node, or none. Mirrors `tiesAt`. */
export function chainsAt(chains: Chains, ref: NodeRef | null): readonly ChainLink[] {
  return ref === null ? [] : (chains.byNode.get(ref) ?? []);
}
