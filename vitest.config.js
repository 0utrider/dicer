import { defineConfig } from 'vitest/config';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';

export default defineConfig({
  plugins: [rapierWasmPlugin()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    // The Rapier package is ESM in a non-"type: module" package: let Vite transform it.
    server: { deps: { inline: [/@dimforge\/rapier3d-deterministic/] } },
  },
});
