/**
 * The static server behind `ark play`.
 *
 * Almost all of this file is about `resolveWithin`, because that function is
 * the only thing standing between "serve four files from `dist/player`" and
 * "serve the user's home directory to anything that can reach the port". It is
 * loopback-only, which limits the blast radius, but pillar 5 is a promise about
 * source never leaving the machine and a traversal bug is how that promise
 * breaks. The rest of the server is a `createReadStream` pipe.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { isLocalHost, resolveWithin, serveDirectory } from '../../src/indexer/serve.js';

const ROOT = resolve('/srv/player');

/**
 * A directory with one file in it, made here rather than borrowed from
 * `dist/player`.
 *
 * **The three tests below used to serve the built player**, which gave this
 * file an undeclared dependency on `npm run build`: on a fresh clone `dist/`
 * does not exist, `atlas.json` 404s where a 200 is expected, and
 * `npm run test:unit` fails 2 of 617 for a reason that has nothing to do with
 * the change in front of you. It stayed green in CI for four milestones because
 * `ci.yml` happens to order `build` before `test:unit`, while the testing table
 * lists them as independent rows at the same frequency — so following the table
 * went red and following CI did not.
 *
 * Nothing was gained by using the real bundle. The property under test is the
 * *server* — that the url it prints answers, and that a rebound Host is refused
 * — and a directory holding one file exercises it identically while depending
 * on nothing.
 */
let served_root = '';

beforeAll(async () => {
  served_root = await mkdtemp(join(tmpdir(), 'ark-serve-'));
  await writeFile(join(served_root, 'atlas.json'), '{"version":9}\n', 'utf8');
});

/**
 * One GET, over `node:http` rather than `fetch`.
 *
 * `fetch` works against this server from a plain script and **hangs inside a
 * vitest worker** — undici's connection handling under the pool, not anything
 * the server does. Using the same module the server is written in removes the
 * layer that was failing and keeps the test about the server.
 */
function fetchStatus(url: string): Promise<{ status: number; port: string }> {
  return new Promise((ok, fail) => {
    const request = get(url, (response) => {
      response.resume(); // drain, or the socket never closes
      ok({ status: response.statusCode ?? 0, port: new URL(url).port });
    });
    request.on('error', fail);
    request.setTimeout(3000, () => request.destroy(new Error(`no answer from ${url}`)));
  });
}

describe('resolveWithin — what may be served', () => {
  it('serves index.html for the root path', () => {
    expect(resolveWithin(ROOT, '/')).toBe(resolve(ROOT, 'index.html'));
  });

  it('serves a file inside the root', () => {
    expect(resolveWithin(ROOT, '/atlas.json')).toBe(resolve(ROOT, 'atlas.json'));
    expect(resolveWithin(ROOT, '/assets/index.js')).toBe(resolve(ROOT, 'assets/index.js'));
  });

  it('drops a query string rather than treating it as a filename', () => {
    expect(resolveWithin(ROOT, '/atlas.json?v=2')).toBe(resolve(ROOT, 'atlas.json'));
  });

  /**
   * The property that actually matters, asserted as a property.
   *
   * The first draft of these tests asserted `toBeNull()` for every climb, and
   * three of them failed — not because the guard is weak but because
   * `normalize` *clamps* `..` at an absolute path's root, so `/../../etc/passwd`
   * becomes `/etc/passwd` and lands harmlessly inside the served directory as a
   * 404. Asserting null was asserting an implementation detail. What must never
   * happen is a resolved path outside the root, so that is what is checked.
   */
  const escapes = (urlPath: string): boolean => {
    const target = resolveWithin(ROOT, urlPath);
    return target !== null && target !== ROOT && !target.startsWith(`${ROOT}/`);
  };

  it('never resolves outside the root, however the path climbs', () => {
    for (const attack of [
      '/../../../etc/passwd',
      '/assets/../../secret',
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/%2E%2E/secret',
      '/../player-private/keys', // sibling sharing a name prefix with the root
      '/.././.././etc/shadow',
      '//etc/passwd',
      '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ]) {
      expect(escapes(attack), attack).toBe(false);
    }
  });

  it('refuses a request path that is relative rather than absolute', () => {
    // The case the `startsWith(root + sep)` guard is genuinely load-bearing
    // for: with no leading slash there is nothing for `normalize` to clamp
    // against, so `join` walks straight out of the directory. A well-formed
    // client always sends a leading slash — which is exactly why an attacker
    // would not.
    expect(resolveWithin(ROOT, '../secret')).toBeNull();
    expect(resolveWithin(ROOT, '%2e%2e%2fsecret')).toBeNull();
    expect(escapes('../secret')).toBe(false);
  });

  it('refuses a NUL byte and malformed encoding rather than throwing', () => {
    expect(resolveWithin(ROOT, '/atlas.json%00.png')).toBeNull();
    expect(resolveWithin(ROOT, '/%zz')).toBeNull();
  });
});

describe('serveDirectory', () => {
  it('binds loopback only, and reports the port it actually got', async () => {
    const served = await serveDirectory(served_root, 4271);
    try {
      expect(served.port).toBeGreaterThanOrEqual(4271);
      expect(served.url).toBe(`http://127.0.0.1:${served.port}/`);
      // **The bind address, from the socket.** This test carried the phrase
      // "binds loopback only" in its name while checking a url string the code
      // fabricates — so binding every interface passed it. The one
      // security-relevant property in the title was the one not asserted.
      expect(served.address).toBe('127.0.0.1');
    } finally {
      await served.close();
    }
  });

  it('steps around a port already in use, and the url it prints actually answers', async () => {
    // CLAUDE.md: never assume a port is free. Two servers, one preference.
    //
    // The assertion is **fetch the url**, not compare port numbers, and that is
    // the whole point of this test. `listen(port, host, cb)` registers `cb` as a
    // one-time 'listening' listener, so a callback that never fired is still
    // attached: after an EADDRINUSE the stale one fires on the retry and can
    // resolve with the port we *failed* to get. The symptom is not a wrong
    // number, it is a printed url that refuses the connection — so that is what
    // is checked. Comparing ports let two independent fixes mask each other,
    // which a mutation run found.
    const first = await serveDirectory(served_root, 4281);
    const second = await serveDirectory(served_root, 4281);
    try {
      expect(second.port).not.toBe(first.port);
      const response = await fetchStatus(`${second.url}atlas.json`);
      expect(response.status).toBe(200);
      // ...and it is the second server answering, not the first.
      expect(response.port).toBe(String(second.port));
    } finally {
      await first.close();
      await second.close();
    }
  });
});


describe('isLocalHost — the DNS-rebinding guard', () => {
  it('accepts the names this server is actually reachable by', () => {
    for (const host of ['127.0.0.1:4180', 'localhost:4180', '[::1]:4180', '127.0.0.1', 'LocalHost:4180']) {
      expect(isLocalHost(host, 4180), host).toBe(true);
    }
  });

  it('refuses a name that merely resolves here', () => {
    // The attack: a page you are browsing points `evil.example` at 127.0.0.1
    // and reads the atlas same-origin. Loopback binding does not stop it;
    // checking the name the client used does. The atlas of a private repo is
    // derived-from-source data, and pillar 5 says that never leaves the machine.
    for (const host of [
      'evil.example:4180',
      'attacker.test',
      'a.127.0.0.1.nip.io:4180',
      '127.0.0.1.evil.example:4180',
      '0.0.0.0:4180',
      '[::ffff:127.0.0.1]:4180',
      undefined,
      '',
    ]) {
      expect(isLocalHost(host, 4180), String(host)).toBe(false);
    }
  });

  it('refuses a right name carrying the wrong port', () => {
    // A second server of ours on another port is a different origin, and a
    // mismatched port is a sign the request was routed rather than addressed.
    expect(isLocalHost('127.0.0.1:4181', 4180)).toBe(false);
  });

  it('turns a rebound request away over the wire', async () => {
    const served = await serveDirectory(served_root, 4291);
    try {
      expect((await fetchStatus(`${served.url}atlas.json`)).status).toBe(200);
      const spoofed = await new Promise<number>((ok, fail) => {
        const request = get(
          { host: '127.0.0.1', port: served.port, path: '/atlas.json', headers: { host: 'evil.example' } },
          (response) => {
            response.resume();
            ok(response.statusCode ?? 0);
          },
        );
        request.on('error', fail);
      });
      expect(spoofed).toBe(421);
    } finally {
      await served.close();
    }
  });
});
