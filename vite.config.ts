import { defineConfig } from 'vite';

/**
 * The player is a static site rooted at `src/player`. It reads exactly one
 * file at runtime — `atlas.json` from `public/` — and nothing else. Vite is a
 * devDependency: nothing it does survives into the deployed output, which is
 * plain HTML, one CSS file and one JS bundle.
 *
 * `strictPort` is off deliberately. CLAUDE.md says to pick a free port rather
 * than assume one, so a dev server already running on 5173 gets stepped around
 * instead of stepped on.
 */
export default defineConfig({
  root: 'src/player',
  publicDir: 'public',
  build: {
    outDir: '../../dist/player',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5180,
    strictPort: false,
  },
});
