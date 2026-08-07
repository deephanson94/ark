/**
 * A static file server, so `ark play <repo>` is one command.
 *
 * This exists because of a gap nothing else was going to close: the player was
 * only reachable by cloning Ark, knowing an internal CLI path, and starting a
 * dev server. NORTH-STAR pillar 6 asks for ten minutes to first insight *with
 * no configuration*, and three steps of setup spends most of that before the
 * map has drawn.
 *
 * It is deliberately ~60 lines of `node:http` rather than a dependency. The
 * player's runtime-dependency budget is three and it has used none; a static
 * server for a directory of four files is not where the first one gets spent.
 * It also never leaves the loopback interface — pillar 5 says source never
 * crosses a network, and an atlas of a private repo is derived from source.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export interface Served {
  readonly url: string;
  readonly port: number;
  /** The interface actually bound. Loopback, and asserted rather than assumed. */
  readonly address: string;
  close(): Promise<void>;
}

/**
 * Is this request addressed to *this* server, or to a name that merely resolves
 * here?
 *
 * **Binding loopback does not stop DNS rebinding.** A page you are browsing
 * points `evil.example` at 127.0.0.1, then reads `http://evil.example:4180/atlas.json`
 * — same origin by the browser's rules, served by us, and the atlas of a
 * private repo is paths, export names, commit subjects and co-change pairs.
 * That is derived-from-source data leaving the machine, which is the one thing
 * pillar 5 promises cannot happen. The port range is a sequential probe from
 * 4180, so guessing it is not a barrier either. This is the hole that bit both
 * Vite and webpack-dev-server, and the fix is to check the name the client
 * used: a rebinding attack cannot send `Host: 127.0.0.1` and still reach us
 * from another origin.
 */
export function isLocalHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  // IPv6 literals arrive bracketed: `[::1]:4180`.
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim());
  if (match === null) return false;
  const name = (match[1] ?? '').toLowerCase();
  const stated = match[2];
  if (stated !== undefined && Number(stated) !== port) return false;
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/**
 * Resolve a request path to a file inside `root`, or null.
 *
 * The `startsWith(root + sep)` check is the whole security story and it is not
 * decoration: without it `GET /../../../etc/passwd` is served, and this process
 * is pointed at a directory the user did not choose. `decodeURIComponent` runs
 * *before* normalisation so `%2e%2e` is caught too.
 */
export function resolveWithin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const target = resolve(join(root, relative === '' ? 'index.html' : relative));
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

/** Serve `root` on the first free port at or above `preferred`, loopback only. */
export async function serveDirectory(root: string, preferred = 4180): Promise<Served> {
  let bound = preferred;
  const server: Server = createServer((request, response) => {
    if (!isLocalHost(request.headers.host, bound)) {
      response.writeHead(421).end('this server answers to 127.0.0.1 only');
      return;
    }
    const target = resolveWithin(root, request.url ?? '/');
    if (target === null) {
      response.writeHead(403).end('forbidden');
      return;
    }
    stat(target)
      .then((info) => {
        const file = info.isDirectory() ? join(target, 'index.html') : target;
        response.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          // The atlas is regenerated on every `play`; a cached one would show
          // the previous repo's map and look like a bug in the indexer.
          'cache-control': 'no-store',
        });
        createReadStream(file)
          .on('error', () => response.end())
          .pipe(response);
      })
      .catch(() => {
        response.writeHead(404).end('not found');
      });
  });

  const port = await new Promise<number>((ok, fail) => {
    const attempt = (candidate: number): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        // CLAUDE.md: pick a free port, never assume one. A dev server already
        // on 4180 gets stepped around rather than stepped on.
        if (error.code === 'EADDRINUSE' && candidate < preferred + 20) attempt(candidate + 1);
        else fail(error);
      };
      server.once('error', onError);
      server.listen(candidate, '127.0.0.1', () => {
        // Once we are listening, an error is no longer the retry loop's
        // business — without this, a later socket error re-enters `attempt`
        // and calls `listen` on a live server.
        server.removeListener('error', onError);
        // **Read the port from the socket, never from `candidate`.**
        // `listen(port, host, cb)` registers `cb` as a one-time *'listening'*
        // listener, and a listener that never fired stays attached — so after
        // an EADDRINUSE the stale callback survives and fires when the retry
        // succeeds. Resolving with `candidate` there yields the port we failed
        // to get, and `ark play` prints a url nothing is listening on.
        //
        // Removing the stale listener would fix it too, and that is exactly why
        // it is *not* done here: with both, each masks the other and a mutation
        // run showed neither could be caught by any test. This one is kept
        // because it is the measured value rather than the assumed one, and it
        // is also what makes `preferred = 0` (let the OS choose) work at all.
        // The stale callback still fires; it now resolves with the same, right
        // answer, and `Promise` resolution is idempotent.
        const address = server.address();
        bound = typeof address === 'object' && address !== null ? address.port : candidate;
        ok(bound);
      });
    };
    attempt(preferred);
  });

  const bindAddress = server.address();
  return {
    port,
    address: typeof bindAddress === 'object' && bindAddress !== null ? bindAddress.address : '',
    // `127.0.0.1`, not `localhost`. We bind the IPv4 loopback explicitly, and
    // `localhost` resolves to `::1` first on a dual-stack machine — browsers
    // fall back, Node's `fetch` does not, so a printed `localhost` url is a url
    // that some clients cannot reach. Print the address we actually bound.
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
      }),
  };
}
