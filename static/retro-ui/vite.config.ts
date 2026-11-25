import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Forge serves Custom UI from a sub-path, so asset URLs must be relative.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Domain types/rules/catalogues shared with the Forge backend.
      '@shared': here('../../src/shared'),
      // Local Mock Adapter: the real resolvers, run in-browser against shims below.
      // Only the lazily-loaded mock chunk imports these; Jira builds never execute them.
      '@backend': here('../../src'),
      '@forge/kvs': here('./src/mock/forge-kvs.ts'),
      '@forge/realtime': here('./src/mock/forge-realtime.ts'),
      '@forge/api': here('./src/mock/forge-api.ts'),
      '@forge/resolver': here('./src/mock/forge-resolver.ts'),
      'node:crypto': here('./src/mock/node-crypto.ts'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
});
