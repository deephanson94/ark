/**
 * Proved chains on the map, and the gate that decides who may see one
 * (`src/player/chains.ts`, ADR-0049).
 *
 * Every assertion here was mutation-checked: the code it names was broken, the
 * test confirmed to fail, and the break reverted by copying the file aside
 * rather than with `git checkout`, which this repository has a landmine about.
 *
 * The block that matters is `the gate`. ADR-0049 §4.3 permits this layer on an
 * argument that is true about nodes and edges and false about **direction**, and
 * `scripts/probe-chain.ts` measures what that costs — 9 of ark's 40 Blast Radius
 * boards handed over at band A or better, 5 of them exactly, at precision 1.000.
 * The rule those tests pin is what takes that column to zero.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, NodeId, NodeRef, VerbId } from '../../src/atlas/index.js';
import { buildGraph, nodeAt } from '../../src/atlas/index.js';
import { NO_CHAINS, chainsAt, chainsProvedBy } from '../../src/player/chains.js';
import { channelOf } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

/**
 * A line rather than a star, because a star cannot tell the gate's two ends
 * apart: every link would have the subject as its head, so a rule that read the
 * *tail* would pass. `far → leaf → mid → hub` gives two interior heads to aim at.
 */
const FILES = [
  'src/hub.ts',
  'src/mid.ts',
  'src/leaf.ts',
  'src/far.ts',
  'src/other.ts',
  'src/lone.ts',
  // Imports **two** subjects, so it stands one hop from each and the tie-break
  // has to choose. Without it the ascending-ref rule is unobservable: every
  // other node in this fixture is nearer to one subject than to the other, and
  // a mutant reversing the sort passed all sixteen assertions.
  'src/fork.ts',
];
const LINKS: readonly (readonly [string, string])[] = [
  ['src/mid.ts', 'src/hub.ts'],
  ['src/leaf.ts', 'src/mid.ts'],
  ['src/far.ts', 'src/leaf.ts'],
  ['src/other.ts', 'src/hub.ts'],
  ['src/fork.ts', 'src/hub.ts'],
  ['src/fork.ts', 'src/mid.ts'],
];

const atlas: Atlas = atlasWith(FILES, LINKS);
const graph = buildGraph(atlas);

function idOf(path: string): NodeId {
  const node = atlas.nodes.find((n) => n.path === path);
  if (node === undefined) throw new Error(`no such fixture file: ${path}`);
  return node.id;
}
function refOf(path: string): NodeRef {
  const ref = graph.refById.get(idOf(path));
  if (ref === undefined) throw new Error(`unresolvable: ${path}`);
  return ref;
}
/**
 * Links rendered as `tail>head` paths, which is what an assertion can read.
 *
 * **Sorted by path here, and never by the order the layer returns.** `links` is
 * ordered by `NodeRef`, and a ref is assigned in byte order of the node's *id*,
 * which is a hash — so an expectation written in path order would be asserting
 * the id sort rather than the content. The draw order is checked once, on the
 * refs, in `orders links…`.
 */
function shown(links: readonly { from: NodeRef; to: NodeRef }[]): string[] {
  return links.map((l) => `${nodeAt(graph, l.from).path}>${nodeAt(graph, l.to).path}`).sort();
}

function board(subject: string, truth: readonly string[], verb: VerbId = 'blastRadius'): Challenge {
  return {
    id: `fixture-${subject}`,
    verb,
    tier: 3,
    difficulty: 0.5,
    subject: idOf(subject),
    candidates: truth.map(idOf),
    truth: truth.map(idOf),
    witness: truth.map(() => '-').join(' '),
    evidence: { kind: 'importGraph', depth: 2 },
  };
}

describe('chainsProvedBy', () => {
  it('draws every hop of the route from a proved member to its subject', () => {
    const { links, withheld } = chainsProvedBy(graph, [board('src/hub.ts', ['src/far.ts'])]);
    // far → leaf → mid → hub: three links, not one "far reaches hub" summary.
    expect(shown(links)).toEqual([
      'src/far.ts>src/leaf.ts',
      'src/leaf.ts>src/mid.ts',
      'src/mid.ts>src/hub.ts',
    ].sort());
    expect(withheld).toBe(0);
  });

  it('issues one link however many chains run along it', () => {
    const { links } = chainsProvedBy(graph, [
      board('src/hub.ts', ['src/far.ts', 'src/leaf.ts']),
    ]);
    // Both members' routes share `leaf → mid → hub`; the layer draws it once.
    expect(shown(links)).toEqual([
      'src/far.ts>src/leaf.ts',
      'src/leaf.ts>src/mid.ts',
      'src/mid.ts>src/hub.ts',
    ].sort());
  });

  it('orders links so the draw order cannot vary between frames', () => {
    const forward = chainsProvedBy(graph, [
      board('src/hub.ts', ['src/far.ts']),
      board('src/mid.ts', ['src/far.ts']),
    ]);
    const backward = chainsProvedBy(graph, [
      board('src/mid.ts', ['src/far.ts']),
      board('src/hub.ts', ['src/far.ts']),
    ]);
    expect(shown(forward.links)).toEqual(shown(backward.links));
    const refs = forward.links.map((l) => l.from * 1000 + l.to);
    expect([...refs].sort((a, b) => a - b)).toEqual(refs);
  });

  describe('the gate', () => {
    it('withholds a link whose head still carries an unanswered board', () => {
      const { links, withheld } = chainsProvedBy(
        graph,
        [board('src/hub.ts', ['src/far.ts'])],
        new Set([refOf('src/mid.ts')]),
      );
      expect(shown(links)).not.toContain('src/leaf.ts>src/mid.ts');
      expect(withheld).toBe(1);
    });

    it('leaves the rest of the same chain drawn', () => {
      // Withhold by head, never by chain: `mid → hub` says nothing about what
      // reaches `mid`, so refusing it too would cost ink the rule does not need.
      const { links } = chainsProvedBy(
        graph,
        [board('src/hub.ts', ['src/far.ts'])],
        new Set([refOf('src/mid.ts')]),
      );
      expect(shown(links)).toEqual(['src/far.ts>src/leaf.ts', 'src/mid.ts>src/hub.ts'].sort());
    });

    it('reads the head and not the tail', () => {
      // A board open on `leaf` must not withhold `leaf → mid`: nothing about
      // that link is an atom of leaf's own key. What it *does* withhold is
      // `far → leaf`, whose head is leaf — and that is the link a walk out of
      // leaf's board would have to take first.
      const { links } = chainsProvedBy(
        graph,
        [board('src/hub.ts', ['src/far.ts'])],
        new Set([refOf('src/leaf.ts')]),
      );
      expect(shown(links)).toContain('src/leaf.ts>src/mid.ts');
      expect(shown(links)).not.toContain('src/far.ts>src/leaf.ts');
    });

    it('leaves no in-edge of an open board drawn, which is the whole rule', () => {
      // The property `scripts/probe-chain.ts` measures to zero: every walk out
      // of an open board must take an edge whose head is that board, so this
      // one assertion is what the gated column of that table rests on.
      const open = new Set([refOf('src/mid.ts'), refOf('src/leaf.ts')]);
      const { links } = chainsProvedBy(
        graph,
        [board('src/hub.ts', ['src/far.ts', 'src/leaf.ts', 'src/other.ts'])],
        open,
      );
      for (const link of links) expect(open.has(link.to)).toBe(false);
    });
  });

  describe('what it refuses to draw at all', () => {
    it('draws nothing for a verb whose channel is not the import graph', () => {
      // The static licence on the contract, never the verb's name — a restored
      // save has no `Reveal` to ask.
      expect(channelOf('companion')).not.toBe('importRadius');
      const { links } = chainsProvedBy(graph, [
        board('src/hub.ts', ['src/far.ts'], 'companion'),
      ]);
      expect(links).toEqual([]);
    });

    it('drops a member the live graph no longer connects to the subject', () => {
      // `routeTo` answers an unreachable member with the one-element chain
      // `[from]`, which must yield no link rather than a link to itself. A save
      // outlives the atlas that produced it (ADR-0011).
      const { links } = chainsProvedBy(graph, [board('src/hub.ts', ['src/lone.ts'])]);
      expect(links).toEqual([]);
    });

    it('drops a subject this atlas no longer has', () => {
      const stale = { ...board('src/hub.ts', ['src/far.ts']), subject: 'n:deadbeefdead' as NodeId };
      expect(chainsProvedBy(graph, [stale])).toEqual(NO_CHAINS);
    });

    it('draws nothing from an empty record', () => {
      expect(chainsProvedBy(graph, [])).toEqual(NO_CHAINS);
    });
  });

describe('the hop count', () => {
  const hopsByPath = (chains: ReturnType<typeof chainsProvedBy>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [ref, hop] of chains.hops) {
      out[nodeAt(graph, ref).path] = `${hop.distance} to ${nodeAt(graph, hop.to).path}`;
    }
    return out;
  };

  it('counts the hops from each node on a route to the subject it ends at', () => {
    const chains = chainsProvedBy(graph, [board('src/hub.ts', ['src/far.ts'])]);
    expect(hopsByPath(chains)).toEqual({
      'src/mid.ts': '1 to src/hub.ts',
      'src/leaf.ts': '2 to src/hub.ts',
      'src/far.ts': '3 to src/hub.ts',
    });
  });

  it('gives the subject itself no hop count, because it is the destination', () => {
    const chains = chainsProvedBy(graph, [board('src/hub.ts', ['src/far.ts'])]);
    expect(chains.hops.has(refOf('src/hub.ts'))).toBe(false);
  });

  it('never counts a hop the gate withheld', () => {
    // **The trap this field exists to avoid.** With `mid` open, `leaf → mid` is
    // not drawn — so `leaf` and `far` are cut off from `hub` on screen. A count
    // taken from the original route would say "leaf is 2 hops from hub", which
    // states exactly the fact the gate withheld: that leaf reaches hub *through
    // mid*. Distance along drawn links cannot say it, because every hop it
    // counts is visible.
    const chains = chainsProvedBy(
      graph,
      [board('src/hub.ts', ['src/far.ts'])],
      new Set([refOf('src/mid.ts')]),
    );
    expect(chains.hops.has(refOf('src/leaf.ts'))).toBe(false);
    expect(chains.hops.has(refOf('src/far.ts'))).toBe(false);
    // And the surviving half still carries its own number.
    expect(hopsByPath(chains)).toEqual({ 'src/mid.ts': '1 to src/hub.ts' });
  });

  it('takes the nearer subject when a node stands on two routes', () => {
    const chains = chainsProvedBy(graph, [
      board('src/hub.ts', ['src/far.ts']),
      board('src/mid.ts', ['src/far.ts']),
    ]);
    // `far` is 2 hops from `mid` and 3 from `hub`.
    expect(hopsByPath(chains)['src/far.ts']).toBe('2 to src/mid.ts');
  });


  it('breaks a tie between two equally near subjects by ascending ref', () => {
    // `fork` imports both `hub` and `mid`, so it is one hop from each. Which
    // one it is *labelled* with must be a property of the repo, not of the order
    // the player answered the boards in — a session-dependent label would make
    // the same map read differently on two machines.
    const chains = chainsProvedBy(graph, [
      board('src/hub.ts', ['src/fork.ts']),
      board('src/mid.ts', ['src/fork.ts']),
    ]);
    const hop = chains.hops.get(refOf('src/fork.ts'));
    expect(hop?.distance).toBe(1);
    expect(hop?.to).toBe(Math.min(refOf('src/hub.ts'), refOf('src/mid.ts')));

    // And answering them the other way round must not move it.
    const swapped = chainsProvedBy(graph, [
      board('src/mid.ts', ['src/fork.ts']),
      board('src/hub.ts', ['src/fork.ts']),
    ]);
    expect(swapped.hops.get(refOf('src/fork.ts'))).toEqual(hop);
  });
  it('indexes links by both ends, so pointing at either brightens the run', () => {
    const chains = chainsProvedBy(graph, [board('src/hub.ts', ['src/far.ts'])]);
    // `leaf` is the head of one link and the tail of another.
    expect(chainsAt(chains, refOf('src/leaf.ts')).length).toBe(2);
    expect(chainsAt(chains, refOf('src/lone.ts'))).toEqual([]);
    expect(chainsAt(chains, null)).toEqual([]);
  });
});
});
