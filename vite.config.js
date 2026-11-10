import { defineConfig } from 'vite';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';
import { minifyChunksPlugin } from './build/minify-plugin.js';
import { dracoDecoderPlugin } from './build/draco-plugin.js';

export default defineConfig({
  root: '.',
  // Relative asset URLs: Foundry serves the module from /modules/dicer/dist/.
  base: './',
  plugins: [rapierWasmPlugin(), minifyChunksPlugin(), dracoDecoderPlugin()],
  worker: { format: 'es', plugins: () => [rapierWasmPlugin(), minifyChunksPlugin()] },
  // Dev: pre-bundling would give the package and sim.js's deep glue import two separate copies
  // of the wasm-bindgen glue (the wasm is bound to one of them), so keep it unbundled.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-deterministic'] },
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
    rollupOptions: {
      // dist/dicer.js keeps the code (no facade re-exporting a hashed chunk) and also exports
      // what the lazy model-loader chunk shares with it.
      preserveEntrySignatures: 'allow-extension',
    },
  },
});
