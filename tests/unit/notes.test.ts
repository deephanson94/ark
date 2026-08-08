/**
 * Field notes.
 *
 * §9 says notes accumulate facts you have *proven*, not facts you were shown,
 * and calls that distinction the whole product. Under ADR-0008 the answer key is
 * a **sample**, so the strongest honest claim is about the members — never the
 * count, which was revealed rather than earned. §9's own example gets that
 * wrong; ADR-0011 decision 3 amends it. Most of this file is that one line.
 */

import { describe, expect, it } from 'vitest';

import type { NodeId } from '../../src/atlas/index.js';
import { buildGraph, commitIdFor, validateAtlas } from '../../src/atlas/index.js';
import { fieldNotes, noteProse } from '../../src/player/notes.js';
import { EMPTY_PROGRESS, livenessOf, recordPass } from '../../src/player/progress.js';
import { VERBS } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

// hub ← mid ← far, and `wide` also imports hub. `loner` imports nothing.
const atlas = atlasWith(
  ['src/hub.ts', 'src/mid.ts', 'src/far.ts', 'src/wide.ts', 'src/loner.ts'],
  [
    ['src/mid.ts', 'src/hub.ts'],
    ['src/far.ts', 'src/mid.ts'],
    ['src/wide.ts', 'src/hub.ts'],
  ],
);
const graph = buildGraph(atlas);
const liveness = livenessOf(graph, VERBS);
const idFor = (path: string): NodeId => {
  const ref = graph.refByPath.get(path);
  return ref === undefined ? '' : (atlas.nodes[ref]?.id ?? '');
};

const passOn = (subject: string, proved: readonly string[]) =>
  recordPass(EMPTY_PROGRESS, 'blastRadius', idFor(subject), proved.map(idFor));

describe('what a note is built from', () => {
  it('names the files that were proved, with how far each reaches', () => {
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/far.ts']), liveness);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.subjectLabel).toBe('src/hub.ts');
    expect(notes[0]?.proved).toEqual([
      { label: 'src/mid.ts', weight: 1 },
      { label: 'src/far.ts', weight: 2 },
    ]);
    expect(notes[0]?.farthest).toBe(2);
  });

  it('keeps the full radius separate from what was proved', () => {
    // hub's real radius is {mid, far, wide} = 3; the player proved 1 of them.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    expect(notes[0]?.population).toBe(3);
    expect(notes[0]?.proved).toHaveLength(1);
  });

  // These two assert an end-to-end property — a stale claim never renders — and
  // that property is enforced one layer up, by `livePasses`. `notes.ts`'s own
  // guards are unreachable; the comment there says so. Testing the behaviour
  // rather than the layer is the point: it must hold however the code moves.
  it('drops a member the graph no longer supports', () => {
    // `loner` imports nothing, so it was never in hub's radius. A save claiming
    // it must not render — a stale claim shown as knowledge is a worse lie than
    // showing nothing.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/loner.ts']), liveness);
    expect(notes[0]?.proved.map((member) => member.label)).toEqual(['src/mid.ts']);
  });

  it('goes dormant rather than half-rendering when nothing survives', () => {
    expect(fieldNotes(graph, passOn('src/hub.ts', ['src/loner.ts']), liveness)).toEqual([]);
  });

  it('goes dormant when the subject itself is gone', () => {
    const ghost = recordPass(EMPTY_PROGRESS, 'blastRadius', 'n:ffffffffffff', [idFor('src/mid.ts')]);
    expect(fieldNotes(graph, ghost, liveness)).toEqual([]);
  });

  it('orders by radius so the biggest thing you know comes first', () => {
    const both = recordPass(passOn('src/mid.ts', ['src/far.ts']), 'blastRadius', idFor('src/hub.ts'), [
      idFor('src/wide.ts'),
    ]);
    const notes = fieldNotes(graph, both, liveness);
    expect(notes.map((note) => note.subjectLabel)).toEqual(['src/hub.ts', 'src/mid.ts']);
  });

  it('follows a rename, because the record keys on node identity', () => {
    // The note resolves NodeId → path through the atlas currently loaded, so a
    // moved file appears under its new name rather than vanishing. That is the
    // job ADR-0002 exists to do.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    expect(notes[0]?.proved[0]?.label).toBe(nodePathOf('src/mid.ts'));
  });
});

function nodePathOf(path: string): string {
  const ref = graph.refByPath.get(path);
  return ref === undefined ? '' : (atlas.nodes[ref]?.path ?? '');
}

describe('the prose claims exactly what was proved', () => {
  it('states the members, not the count of dependents', () => {
    // The load-bearing assertion. §9's "engine.ts has 14 dependents" is a claim
    // about the *radius*, which the player was shown and never proved.
    const notes = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness);
    const note = notes[0];
    expect(note).toBeDefined();
    if (note === undefined) return;
    const { claim, revealed } = noteProse(note);
    expect(claim).toContain('You proved 1 file');
    expect(claim).toContain('src/mid.ts');
    // The radius is 3. It must not appear in the sentence that says "proved".
    expect(claim).not.toContain('3');
    expect(revealed).toContain('3 files');
    expect(revealed).toContain('revealed');
  });

  it('says nothing about a radius the player has fully proved', () => {
    const notes = fieldNotes(graph, passOn('src/mid.ts', ['src/far.ts']), liveness);
    const note = notes[0];
    expect(note?.population).toBe(1);
    expect(note === undefined ? null : noteProse(note).revealed).toBeNull();
  });

  it('describes reach in the graph’s terms, not a fixed phrase', () => {
    const direct = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    const deep = fieldNotes(graph, passOn('src/hub.ts', ['src/far.ts']), liveness)[0];
    expect(direct === undefined ? '' : noteProse(direct).claim).toContain('direct importers');
    expect(deep === undefined ? '' : noteProse(deep).claim).toContain('2 hops away');
  });

  it('agrees with itself on singular and plural', () => {
    const one = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    const two = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts', 'src/wide.ts']), liveness)[0];
    expect(one === undefined ? '' : noteProse(one).claim).toContain('1 file that depends on');
    expect(two === undefined ? '' : noteProse(two).claim).toContain('2 files that depend on');
  });

  it('mentions no repo of its own — every specific string came from the atlas', () => {
    // Guardrail 2. The template may only contribute numbers and connective words.
    const note = fieldNotes(graph, passOn('src/hub.ts', ['src/mid.ts']), liveness)[0];
    if (note === undefined) throw new Error('fixture');
    const { claim, revealed } = noteProse(note);
    // Split on separators only — not on `.`, which is inside every filename.
    const words = `${claim} ${revealed ?? ''}`
      .split(/[\s,—]+/)
      .map((word) => word.replace(/\.$/, ''))
      .filter((word) => word.includes('/'));
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect([note.subjectLabel, ...note.proved.map((f) => f.label)]).toContain(word);
    }
  });
});

describe('a note reads in the unit its verb measures in', () => {
  /**
   * Before M4 `fieldNotes` computed import distances unconditionally, so a
   * Companion pass would have found no distance for any member and been
   * **silently dropped** — the note simply absent, with nothing saying so. The
   * two verbs have different rulers and neither converts into the other.
   */
  const bare = atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts'], [['src/c.ts', 'src/a.ts']]);
  const atlas = validateAtlas({
    ...bare,
    repo: { ...bare.repo, head: 'a'.repeat(40), headDate: '2026-01-01', root: 'b'.repeat(40) },
    history: {
      present: true,
      commitsWalked: 40,
      commitsRetained: 0,
      window: { from: '2025-01-01', to: '2026-01-01' },
      wideLimit: 25,
      coChange: (() => {
        const a = bare.nodes.findIndex((n) => n.path === 'src/a.ts');
        const b = bare.nodes.findIndex((n) => n.path === 'src/b.ts');
        return [(a < b ? [a, b, 12] : [b, a, 12]) as readonly [number, number, number]];
      })(),
      commits: [],
    },
  });
  const companionGraph = buildGraph(atlas);
  const id = (path: string): string =>
    atlas.nodes[companionGraph.refByPath.get(path) ?? -1]?.id ?? '';

  it('states a companion claim in shared commits, not in hops', () => {
    const progress = recordPass(EMPTY_PROGRESS, 'companion', id('src/a.ts'), [id('src/b.ts')]);
    const notes = fieldNotes(companionGraph, progress, livenessOf(companionGraph, VERBS));
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note?.verb).toBe('companion');
    // The weight is the co-change count, which no import distance could equal
    // here: `src/b.ts` imports nothing at all.
    expect(note?.proved[0]?.weight).toBe(12);
    const prose = noteProse(note!);
    expect(prose.claim).toContain('changes with');
    expect(prose.claim).toContain('12 commits');
    expect(prose.claim).not.toContain('hops');
  });

  it('still states a blast-radius claim in hops', () => {
    const progress = recordPass(EMPTY_PROGRESS, 'blastRadius', id('src/a.ts'), [id('src/c.ts')]);
    const notes = fieldNotes(companionGraph, progress, livenessOf(companionGraph, VERBS));
    const prose = noteProse(notes[0]!);
    expect(prose.claim).toContain('depend');
    expect(prose.claim).not.toContain('commit');
  });
});

describe('a note about a commit, which is not a file', () => {
  // The seam's last gap, and the reason ADR-0018 put three more members on the
  // `Verb` contract. `weightsFor` and `noteProse` were both
  // `verb === 'companion' ? … : …` with Blast Radius as the *else*, and
  // `subjectPath` resolved the subject through `refById` — so a Placement pass
  // would have been dropped in silence, and if it had survived it would have
  // claimed its members were direct importers of a sha.
  const base = atlasWith(['src/one.ts', 'src/two.ts', 'src/three.ts']);
  const withHistory = validateAtlas({
    ...base,
    repo: { ...base.repo, head: 'b'.repeat(40), headDate: '2026-02-02', root: 'c'.repeat(40) },
    history: {
      ...base.history,
      present: true,
      commitsWalked: 1,
      commitsRetained: 1,
      window: { from: '2026-02-02', to: '2026-02-02' },
      commits: [
        {
          sha: '0123456789ab',
          date: '2026-02-02',
          subject: 'move the retry budget',
          files: [0, 1],
          wide: false,
          issue: null,
        },
      ],
    },
  });
  const commitGraph = buildGraph(withHistory);
  const commit = commitIdFor('0123456789ab');
  const first = withHistory.nodes[0]?.id ?? '';
  const record = recordPass(EMPTY_PROGRESS, 'placement', commit, [first]);

  it('renders at all, rather than vanishing because the subject is not a node', () => {
    const notes = fieldNotes(commitGraph, record, livenessOf(commitGraph, VERBS));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.subjectLabel).toBe('2026-02-02  0123456789ab  "move the retry budget"');
  });

  it('says what changed in the commit, and never how many hops away it was', () => {
    const notes = fieldNotes(commitGraph, record, livenessOf(commitGraph, VERBS));
    const note = notes[0];
    expect(note).toBeDefined();
    if (note === undefined) return;
    const prose = noteProse(note);
    expect(prose.claim).toContain('changed in 2026-02-02  0123456789ab');
    expect(prose.claim).not.toContain('hops');
    expect(prose.claim).not.toContain('depend');
    // Two files touched, one proved: the gap is stated as revealed, never
    // folded into the claim.
    expect(prose.revealed).toContain('the other 1 revealed to you, never proved');
  });

  it('goes dormant when the commit slides out of the window', () => {
    const slid = buildGraph(
      validateAtlas({
        ...withHistory,
        history: { ...withHistory.history, commits: [], commitsRetained: 0 },
      }),
    );
    expect(fieldNotes(slid, record, livenessOf(slid, VERBS))).toEqual([]);
  });
});
