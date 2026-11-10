import { transformWithEsbuild } from 'vite';

/**
 * Full esbuild minification of every emitted chunk (R10: dist headroom is tight).
 * Vite never strips whitespace in an ES lib build (its own renderChunk pass keeps it, for
 * downstream tree-shaking), but Foundry loads dist/dicer.js and the worker chunk as-is.
 * Runs in generateBundle, after every renderChunk pass.
 */
export function minifyChunksPlugin() {
  return {
    name: 'dicer:minify-chunks',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const out = await transformWithEsbuild(file.code, file.fileName, {
          loader: 'js',
          format: 'esm',
          minify: true,
          legalComments: 'none',
          sourcemap: false,
        });
        file.code = out.code;
        file.map = null;
      }
    },
  };
}
