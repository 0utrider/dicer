import { defineConfig } from 'vite';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';
import { minifyChunksPlugin } from './build/minify-plugin.js';

export default defineConfig({
  root: '.',
  // Relative asset URLs: Foundry serves the module from /modules/dicer/dist/.
  base: './',
  plugins: [rapierWasmPlugin(), minifyChunksPlugin()],
  worker: { format: 'es', plugins: () => [rapierWasmPlugin(), minifyChunksPlugin()] },
  server: { open: '/dev/preview.html' },
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['es'],
      fileName: () => 'dicer.js',
    },
    minify: 'esbuild', // see build/minify-plugin.js for the whitespace pass
    assetsInlineLimit: 0, // never base64 the wasm (lib mode inlines assets by default)
    outDir: 'dist',
    emptyOutDir: true,
  },
});
