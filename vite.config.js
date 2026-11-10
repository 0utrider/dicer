import { defineConfig } from 'vite';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';

export default defineConfig({
  root: '.',
  // Relative asset URLs: Foundry serves the module from /modules/dicer/dist/.
  base: './',
  plugins: [rapierWasmPlugin()],
  worker: { format: 'es', plugins: () => [rapierWasmPlugin()] },
  server: { open: '/dev/preview.html' },
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['es'],
      fileName: () => 'dicer.js',
    },
    assetsInlineLimit: 0, // never base64 the wasm (lib mode inlines assets by default)
    outDir: 'dist',
    emptyOutDir: true,
  },
});
