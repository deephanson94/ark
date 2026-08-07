import { defineConfig } from 'vitest/config';

/**
 * Vitest gets its own config so it does not inherit `vite.config.ts`, which
 * roots the *player* at `src/player` for bundling. With that root, vitest looks
 * for tests inside the player directory and finds none.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
