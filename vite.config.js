import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { rapierWasmPlugin } from './build/rapier-wasm-plugin.js';
import { minifyChunksPlugin } from './build/minify-plugin.js';
import { dracoDecoderPlugin } from './build/draco-plugin.js';
import { glslMinifyPlugin } from './build/glsl-minify-plugin.js';

// scripts/bundle-report.mjs sets this: sourcemaps that map minified bytes back to src/ files.
const REPORT = process.env.BUNDLE_REPORT === '1';

const THREE_SRC = fileURLToPath(new URL('./node_modules/three/src/Three.js', import.meta.url));

export default defineConfig({
  root: '.',
  // Bare `three` (ours and three/examples/jsm's) resolves to three's per-file sources, not the
  // prebuilt three.core.js: Rollup can then leave the classes only GLTFLoader uses in the lazy
  // model-loader chunk. There is still one copy of three (every import goes through this).
  resolve: {
    alias: [{ find: /^three$/, replacement: THREE_SRC }],
  },
  // Relative asset URLs: Foundry serves the module from /modules/dicer/dist/.
  base: './',
  plugins: [
    rapierWasmPlugin(),
    glslMinifyPlugin(),
    minifyChunksPlugin({ sourcemap: REPORT }),
    dracoDecoderPlugin(),
  ],
  worker: {
    format: 'es',
    plugins: () => [rapierWasmPlugin(), minifyChunksPlugin({ sourcemap: REPORT })],
  },
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
    sourcemap: REPORT,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // dist/dicer.js keeps the code (no facade re-exporting a hashed chunk) and also exports
      // what the lazy model-loader chunk shares with it.
      preserveEntrySignatures: 'allow-extension',
      // The pet chunk (src/pet/chunk/pets.js) is named pet-*.js, which build/world-start.js lists as lazy.
      output: { chunkFileNames: (c) => (c.name === 'pets' ? 'pet-[hash].js' : '[name]-[hash].js') },
    },
  },
});
