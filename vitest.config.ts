import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Lets tests import UI modules (static/retro-ui/src/lib/*) that use the @shared alias.
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'] },
});
