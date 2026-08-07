/**
 * Proof that the integrity checks are real.
 *
 * `atlas.test.ts` asserts that the atlas built from this repo has no dangling
 * edges and that every `challenge.truth` is a subset of its candidates. Those
 * assertions are worth nothing on their own — an atlas with zero challenges
 * passes the second one vacuously, and a validator that checked nothing would
 * pass both. This file breaks each invariant on purpose and requires the
 * validator to notice.
 */

import { describe, expect, it } from 'vitest';

import { AtlasValidationError, nodeIdFor, serializeAtlas, validateAtlas } from '../../src/atlas/index.js';
import { atlasWith, atlasWithChallenge } from '../fixtures/atlas.js';

const VALID = atlasWith(
  ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
  [
    ['b.ts', 'a.ts'],
    ['c.ts', 'b.ts'],
  ],
);
const WITH_CHALLENGE = atlasWithChallenge(VALID);

type Raw = Record<string, unknown>;

/** A deep clone of a valid atlas, with one thing broken. */
function broken(source: unknown, mutate: (raw: Raw) => void): unknown {
  const raw = JSON.parse(serializeAtlas(source as never)) as Raw;
  mutate(raw);
  return raw;
}

function rejects(source: unknown, mutate: (raw: Raw) => void, at: string, message: RegExp): void {
  let thrown: unknown;
  try {
    validateAtlas(broken(source, mutate));
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected the validator to reject this atlas').toBeInstanceOf(AtlasValidationError);
  expect((thrown as AtlasValidationError).at).toBe(at);
  expect((thrown as AtlasValidationError).message).toMatch(message);
}

function nodesOf(raw: Raw): Raw[] {
  return raw['nodes'] as Raw[];
}
function edgesOf(raw: Raw): Raw[] {
  return raw['edges'] as Raw[];
}
function challengesOf(raw: Raw): Raw[] {
  return raw['challenges'] as Raw[];
}

describe('the fixtures themselves', () => {
  it('validate before anything is broken', () => {
    expect(() => validateAtlas(JSON.parse(serializeAtlas(VALID)))).not.toThrow();
    expect(() => validateAtlas(JSON.parse(serializeAtlas(WITH_CHALLENGE)))).not.toThrow();
    expect(WITH_CHALLENGE.challenges).toHaveLength(1);
  });
});

describe('edges', () => {
  it('rejects an edge pointing past the end of the node list', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      if (edge !== undefined) edge['to'] = 99;
    }, 'atlas.edges[0].to', /out of range/);
  });

  it('rejects a negative node index', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      if (edge !== undefined) edge['from'] = -1;
    }, 'atlas.edges[0].from', /expected >= 0/);
  });

  it('rejects a self-edge', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      if (edge !== undefined) edge['to'] = edge['from'];
    }, 'atlas.edges[0]', /self-edge/);
  });

  it('rejects unsorted edges', () => {
    rejects(VALID, (raw) => {
      raw['edges'] = [...edgesOf(raw)].reverse();
    }, 'atlas.edges', /sorted/);
  });

  it('rejects duplicate edges', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      raw['edges'] = [edge, edge];
    }, 'atlas.edges', /free of duplicates/);
  });

  it('rejects a weight of zero', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      if (edge !== undefined) edge['weight'] = 0;
    }, 'atlas.edges[0].weight', /expected >= 1/);
  });

  it('rejects an unknown edge kind', () => {
    rejects(VALID, (raw) => {
      const edge = edgesOf(raw)[0];
      if (edge !== undefined) edge['kind'] = 'telepathy';
    }, 'atlas.edges[0].kind', /expected one of/);
  });
});

describe('nodes', () => {
  it('rejects nodes that are not sorted by id', () => {
    rejects(VALID, (raw) => {
      raw['nodes'] = [...nodesOf(raw)].reverse();
    }, 'atlas.nodes', /sorted by id/);
  });

  it('rejects an id that does not match its origin path', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['id'] = nodeIdFor('somewhere/else.ts');
    }, 'atlas.nodes[0].id', /does not match the hash of originPath/);
  });

  it('rejects a malformed id', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['id'] = 'node-1';
    }, 'atlas.nodes[0].id', /12 hex chars/);
  });

  it('rejects duplicate paths', () => {
    rejects(VALID, (raw) => {
      const [first, second] = nodesOf(raw);
      if (first !== undefined && second !== undefined) second['path'] = first['path'];
    }, 'atlas.nodes', /duplicate paths/);
  });

  it('rejects an absolute path', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['path'] = '/etc/passwd';
    }, 'atlas.nodes[0].path', /relative POSIX path/);
  });

  it('rejects an unsorted exports list', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['exports'] = ['b', 'a'];
    }, 'atlas.nodes[0].exports', /sorted/);
  });

  it('rejects a non-finite layout coordinate', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['layout'] = ['NaN', 0];
    }, 'atlas.nodes[0].layout[0]', /finite number/);
  });

  it('rejects a language missing from the repo summary', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['lang'] = 'jsx';
    }, 'atlas.nodes[0].lang', /missing from atlas.repo.languages/);
  });

  it('rejects a fileCount that disagrees with the node list', () => {
    rejects(VALID, (raw) => {
      (raw['repo'] as Raw)['fileCount'] = 99;
    }, 'atlas.repo.fileCount', /but there are/);
  });

  it('rejects a malformed date', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      if (node !== undefined) node['lastSeen'] = '2026-8-7';
    }, 'atlas.nodes[0].lastSeen', /YYYY-MM-DD/);
  });
});

describe('regions', () => {
  it('rejects a node in a region that does not exist', () => {
    rejects(VALID, (raw) => {
      const node = nodesOf(raw)[0];
      const region = (raw['regions'] as Raw[])[0];
      if (node !== undefined) node['region'] = 'nowhere';
      // Keep the member count honest so the *other* check does not fire first.
      if (region !== undefined) region['nodeCount'] = nodesOf(raw).length - 1;
    }, 'atlas.nodes[0].region', /is not a region in this atlas/);
  });

  it('rejects a region whose member count is wrong', () => {
    rejects(VALID, (raw) => {
      const region = (raw['regions'] as Raw[])[0];
      if (region !== undefined) region['nodeCount'] = 99;
    }, 'atlas.regions', /claims 99 nodes/);
  });
});

describe('challenges', () => {
  it('rejects a truth entry that is not among the candidates', () => {
    // The one that matters most: a player would be marked wrong for not picking
    // something they were never shown.
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['truth'] = [nodeIdFor('ghost.ts')];
    }, 'atlas.challenges[0].truth', /not among the candidates/);
  });

  it('rejects an empty answer key', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['truth'] = [];
    }, 'atlas.challenges[0].truth', /must not be empty/);
  });

  it('rejects an answer key that is the whole choice set', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['truth'] = challenge['candidates'];
    }, 'atlas.challenges[0].truth', /proper subset/);
  });

  it('rejects a subject offered as one of its own candidates', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge === undefined) return;
      const candidates = [...(challenge['candidates'] as string[]), challenge['subject'] as string].sort();
      challenge['candidates'] = candidates;
    }, 'atlas.challenges[0].candidates', /must not contain the subject/);
  });

  it('rejects a subject that is not a node in this atlas', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['subject'] = nodeIdFor('ghost.ts');
    }, 'atlas.challenges[0].subject', /is not a node in this atlas/);
  });

  it('rejects a candidate that is not a node in this atlas', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['candidates'] = [nodeIdFor('ghost.ts')];
    }, 'atlas.challenges[0].candidates', /is not a node in this atlas/);
  });

  it('rejects a difficulty outside 0..1', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['difficulty'] = 7;
    }, 'atlas.challenges[0].difficulty', /expected 0\.\.1/);
  });

  it('rejects an unknown verb', () => {
    rejects(WITH_CHALLENGE, (raw) => {
      const challenge = challengesOf(raw)[0];
      if (challenge !== undefined) challenge['verb'] = 'vibes';
    }, 'atlas.challenges[0].verb', /expected one of/);
  });
});

describe('history', () => {
  it('rejects a co-change reference outside the node list', () => {
    rejects(VALID, (raw) => {
      (raw['history'] as Raw)['coChange'] = [[0, 99, 3]];
    }, 'atlas.history.coChange[0][1]', /out of range/);
  });

  it('rejects an unordered co-change pair', () => {
    rejects(VALID, (raw) => {
      (raw['history'] as Raw)['coChange'] = [[2, 1, 3]];
    }, 'atlas.history.coChange[0]', /expected a < b/);
  });

  it('rejects co-change pairs in the wrong order', () => {
    rejects(VALID, (raw) => {
      (raw['history'] as Raw)['coChange'] = [
        [0, 1, 1],
        [0, 2, 9],
      ];
    }, 'atlas.history.coChange', /sorted by count desc/);
  });

  it('rejects a commit touching a file that is not in the atlas', () => {
    rejects(VALID, (raw) => {
      const history = raw['history'] as Raw;
      history['present'] = true;
      history['commitsWalked'] = 1;
      history['commitsRetained'] = 1;
      history['commits'] = [
        { sha: 'abcdef012345', date: '2026-01-01', subject: 'x', files: [42], wide: false, issue: null },
      ];
    }, 'atlas.history.commits[0].files[0]', /out of range/);
  });

  it('rejects history that claims to be present with no HEAD', () => {
    rejects(VALID, (raw) => {
      const history = raw['history'] as Raw;
      history['present'] = true;
      history['commitsWalked'] = 3;
    }, 'atlas.history.present', /exactly when atlas.repo.head is set/);
  });

  it('rejects a root that is not a full sha', () => {
    // The player keys saved progress on this string (ADR-0011). A truncated or
    // upper-case sha would key a *different* save from the same repo.
    rejects(VALID, (raw) => {
      (raw['repo'] as Raw)['root'] = 'ABCDEF0123456789';
    }, 'atlas.repo.root', /full 40-character lowercase sha/);
  });

  it('rejects a first commit in a repo that has no commits', () => {
    rejects(VALID, (raw) => {
      (raw['repo'] as Raw)['root'] = 'a'.repeat(40);
    }, 'atlas.repo', /repo with no commits cannot have a first commit/);
  });

  it('accepts a head with no root — that is a shallow clone, not a bug', () => {
    // The converse of the rule above, and it must NOT be symmetric: a shallow
    // clone has a HEAD and no knowable root.
    const raw = broken(VALID, (r) => {
      const repo = r['repo'] as Raw;
      repo['head'] = 'c'.repeat(40);
      repo['headDate'] = '2026-01-01';
      repo['root'] = null;
      const history = r['history'] as Raw;
      history['present'] = true;
      history['commitsWalked'] = 1;
    });
    expect(() => validateAtlas(raw)).not.toThrow();
  });

  it('rejects a retained count that disagrees with the commit list', () => {
    rejects(VALID, (raw) => {
      (raw['history'] as Raw)['commitsRetained'] = 5;
    }, 'atlas.history.commitsRetained', /says 5 but commits has 0/);
  });
});

describe('schema version', () => {
  it('demands a reindex rather than guessing at an older shape', () => {
    rejects(VALID, (raw) => {
      raw['version'] = 99;
    }, 'atlas.version', /reindex required/);
  });
});

describe('parse errors', () => {
  it('names the failure rather than throwing a raw SyntaxError', () => {
    expect(() => validateAtlas('not an atlas')).toThrow(AtlasValidationError);
    expect(() => validateAtlas(null)).toThrow(/expected an object/);
  });
});
