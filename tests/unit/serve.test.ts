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

import { describe, expect, it } from 'vitest';
import { get } from 'node:http';
import { resolve } from 'node:path';

import { resolveWithin, serveDirectory } from '../../src/indexer/serve.js';

const ROOT = resolve('/srv/player');

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
    const served = await serveDirectory(resolve('dist/player'), 4271);
    try {
      expect(served.port).toBeGreaterThanOrEqual(4271);
      expect(served.url).toBe(`http://127.0.0.1:${served.port}/`);
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
    const first = await serveDirectory(resolve('dist/player'), 4281);
    const second = await serveDirectory(resolve('dist/player'), 4281);
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
