# ADR-0029 — `npx ark` is a script, not a checkbox

- **Status**: accepted
- **Date**: 2026-08-10
- **Implements**: NORTH-STAR §10 — *"Indexer: Node CLI. Ships as `npx ark`. Zero install friction."*
- **Bears on**: `CLAUDE.md`'s Definition of done; NORTH-STAR §7 (the indexer/player wall); pillar 6
- **Bumps**: nothing. No atlas change.
- **Code shipped**: `package.json`'s `bin`/`files`/`build:cli`/`prepack`, `tsconfig.cli.json`,
  `cli.ts`'s package-root resolution and entry-point test, `scripts/pack-check.ts`, one CI step.

---

## 1. The thing that was wrong is not that it was unbuilt

NORTH-STAR §10 has said *"ships as `npx ark`, zero install friction"* since M0. `package.json` had no
`bin`, and `build` typechecks the indexer with `tsc --noEmit` rather than emitting it, so there has
never been a file for `npx` to resolve. That is ordinary unfinished work.

What is not ordinary is that **`CLAUDE.md`'s Definition of done said `npx ark index .` still works**,
as a box to tick before shipping, for four milestones. It was noticed a session ago and rewritten to
say *"not `npx ark index .`, which has never worked"* — which is honest, and left the list one item
shorter and still unverifiable. A checklist item nobody can literally satisfy gets ticked from
memory. So the fix is not that the box became tickable. **The fix is that the box is a script**, and
CI runs it.

---

## 2. What "packaging" turned out to mean, measured by packing it

Four things had to change, and **three of them were found by running the tarball rather than by
reasoning about it.** That ratio is the argument for §3.

### 2.1 Emit the indexer

`tsconfig.cli.json` extends the default project, narrows `include` to `src/atlas`, `src/indexer`,
`src/verbs`, and emits to `dist/cli/` with `rootDir: src`. The player is absent, and the `include`
is three lines rather than an exclusion list **because the wall holds**: nothing under those three
directories imports `src/player`, which was grepped rather than assumed.

`declaration` and `sourceMap` are off. Nobody imports ark as a library, so both are bytes in a
tarball no consumer reads.

The shebang goes at the top of `src/indexer/cli.ts`. TypeScript preserves it verbatim, and npm sets
the executable bit on a `bin` target at install time.

### 2.2 The entry-point test was false for every installed copy

```ts
const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) { … }
```

npm installs a `bin` as a **symlink** at `node_modules/.bin/ark`, so `argv[1]` is the link and
`import.meta.url` is the file it points at. They are never equal. The failure is silent and total:
`main` never runs, nothing is printed, and the process exits **0** — a packaged CLI that looks like
it worked and writes no atlas. Both sides go through `realpathSync` now, guarded, because `argv[1]`
can be a path that does not exist under some launchers.

This is the finding worth keeping: **the guard was correct in every mode this repo had ever run**,
and wrong in the first mode packaging introduces.

### 2.3 `dist/player` was resolved against the working directory

```ts
const PLAYER_DIST = 'dist/player';
```

A bare relative path works exactly when you run `ark play` from inside a checkout of ark. An
installed `ark play ~/some/repo` runs with `cwd` at wherever the person is standing, where
`dist/player` is absent or — worse — somebody else's build output. It resolves against the **package** now: the nearest ancestor of the module
holding a `package.json`, which from source is `src/indexer/` → the repo and from the emitted tree is
`dist/cli/indexer/` → the installed package, because `dist/` carries no manifest of its own. One
rule, both modes, and the fallback at the filesystem root makes the error a *missing player* rather
than a crash inside path arithmetic.

### 2.4 `files`

`["dist/cli", "dist/player", "NORTH-STAR.md"]`, plus what npm always includes. `prepack` runs
`npm run build`, which now ends in `build:cli`. The package stays `private: true` — this is not being
published, and `npm pack` does not care.

---

## 3. The check, and the four mutations that prove it is one

`scripts/pack-check.ts` packs the real tarball, installs it into a temp directory **that is not this
repo**, and runs the binary there. That is the whole design and it is not paranoia: §2.2 and §2.3 are
both invisible from inside a checkout, because a checkout has a `dist/player` at its working
directory and a `src/indexer/cli.ts` that `argv[1]` points straight at.

Its gates, because a check that measures nothing looks exactly like good news:

| gate | what it catches |
|---|---|
| the tarball holds `dist/cli/indexer/cli.js`, `dist/player/index.html` and a bundle under `dist/player/assets/` | a `files` list that forgot half the product |
| `node_modules/.bin/ark` exists after install | a missing or misspelled `bin` |
| `ark index <fixture>` writes an atlas the **validator** accepts | §2.2 — the silent exit-0 |
| the atlas has nodes **and** edges **and** challenges | `src/verbs/` missing from the tarball: a valid atlas and an empty deck are the same shape |
| `ark play` serves HTML carrying `id="app"` **and** a `./assets/index-*.js` module script | §2.3, and a placeholder page satisfying a weaker check |

Mutation-tested rather than reasoned about — each of these was broken on purpose and the script went
red: **remove `bin`** → *"installing the tarball produced no `ark` binary"*; **remove `dist/player`
from `files`** → *"the tarball is missing dist/player/index.html"*; **restore the naive entry-point
compare** → *"`ark index` wrote no atlas"*; **restore the relative `PLAYER_DIST`** → `ark play`
exits.

**The fixture's size is a gate, not tidiness.** The first version built a four-file repo, which
indexes to a perfectly valid atlas with **zero** challenges — so asserting on nodes and edges alone
would never touch `src/verbs/`, and the check would have passed with the entire generator missing
from the tarball. It is a hub with nine dependents and nine unrelated files now, over five commits,
which clears ADR-0007's `|candidates| > 3·|truth|` and produces a real deck (20 nodes, 9 edges, 5
challenges).

---

## Decision

1. **`ark index <path>` and `ark play <path>` work from a packed tarball**, installed anywhere. The
   indexer is emitted to `dist/cli/` by `tsconfig.cli.json`; `bin` points at it. **This is not the
   same as `npx ark` off the registry** and the documents say so: the package is `private` and
   unpublished, and `ark` is a placeholder colliding with four things NORTH-STAR's header names.
   What remains between here and §10's literal sentence is a **naming** decision, not packaging
   work — and writing *"run `npx ark play`"* in a README before that decision would be this
   document's own defect committed again, one layer out.
2. **The Definition of done's packaging item is `npm run test:pack`, and CI runs it on every push.**
   An item on that list that cannot be executed is worse than no item, because it is ticked from
   memory — which is precisely how this one survived four milestones.
3. **Anything the CLI resolves on disk is resolved against the package, never the working
   directory.** `dist/player` was the only instance; the rule is written down so the next one is not
   found by a user.
4. **The check runs the binary from outside the checkout.** Running it from the repo would resolve
   `dist/player` by accident and prove nothing, and both of the real defects here were of exactly
   that shape.

---

## Alternatives rejected

**Publish it, so `npx ark` resolves.** That is what NORTH-STAR §10 literally asks for and it is not
packaging work: `ark` collides with *ARK: Survival Evolved*, ARK Invest, ark.io and KDE's `ark`, and
the north star's own header says to check npm and the domain **before anything public**. Shipping a
README that says `npx ark` while the registry serves somebody else's package would be worse than the
checkbox this document is about. The mechanism is done; the name is a decision nobody has taken.

**Ship `tsx` as a runtime dependency and point `bin` at the TypeScript source.** It is one line and
it works. Refused because `npm run budget` prints `player runtime deps 0` and ADR-0026 decision 1
turned down tree-sitter *on that budget* — spending the project's first runtime dependency on a
transpiler, immediately after refusing to spend it on a parser that would have bought accuracy, is
not a trade this repo can make and then explain. `tsc` already runs in `build`; emitting is free.

**Bundle the CLI with vite/esbuild into one file.** Smaller and faster to load, and it puts a bundler
between the source and the thing that runs — so a stack trace names a line in a bundle and the
`--noEmit`/emit distinction that caused this ADR comes back wearing a different hat. `tsc` emit
preserves the file tree, which is also what makes the package-root rule in §2.3 identical in both
modes.

**Put the atlas somewhere other than inside the installed package on `play`.** `ark play` writes
`atlas.json` next to the player it is about to serve, which under `npx` is inside the package in the
npx cache. That is writable and it is where the player looks. A `--out` elsewhere plus a static
server rooted somewhere else is a bigger change than this ADR, and the current behaviour is exactly
what `npm run play` has always done.

**Test the packaging with a unit test.** It needs `npm pack`, `npm install` and a subprocess, takes
~30 s, and touches the network cache. That is a script and a CI step, not a member of a suite whose
budget is five seconds.

---

## Consequences

- **`npm run build` now also emits `dist/cli/`**, so it is a few hundred milliseconds slower and
  `dist/` gains a tree. `dist/` is gitignored and `files` is an allowlist, so nothing about the
  repository changes.
- **`npm run play -- <path>` still works from source** and is still the right thing during
  development: it needs no `build:cli` and picks up edits immediately.
- **The player's zero-runtime-dependency budget is untouched** — `npm run budget` still prints
  `player runtime deps 0`, and `dependencies` remains absent from `package.json`.
- **CI grows a sixth step in the `build and test` job**, ~30 s. There is still one workflow.
- **Verified beyond `test:pack`**, because a script that only exercises a local install is a claim
  about a local install: `npm pack` → `npm i -g --prefix …` → `ark index <repo>` from an unrelated
  working directory writes a valid atlas, and `ark play <repo>` serves the player on
  `http://127.0.0.1:4180/`. That is the sentence the README makes, checked the way the README's
  reader would check it.
- The name is still a placeholder with known collisions (NORTH-STAR's header). `bin` is `ark`, and a
  rename is a content edit in `package.json` and this document — no file moves.

---

## What would change this

- **Publishing.** `private: true` would have to go, the name resolved against npm, and a `prepublishOnly`
  added. Nothing here blocks that; it is a decision about the name, not about the packaging.
- **A CLI that needs the player's toolchain.** `cli.ts` deliberately refuses to shell out to vite
  (its own comment says why), which is what lets `dist/cli` and `dist/player` be two independent
  build products in one tarball. A change that couples them would break the three-line `include` in
  `tsconfig.cli.json` first, which is the early warning.
