import { transformWithEsbuild } from 'vite';

/**
 * Full esbuild minification of every emitted chunk (R10: dist headroom is tight).
 * Vite never strips whitespace in an ES lib build (its own renderChunk pass keeps it, for
 * downstream tree-shaking), but Foundry loads dist/dicer.js and the worker chunk as-is.
 * Runs in generateBundle, after every renderChunk pass.
 *
 * With `sourcemap: true` (BUNDLE_REPORT=1 only, see scripts/bundle-report.mjs) the chunk's Rollup
 * map is fed to esbuild inline, so the emitted .map points the minified bytes at their src/ files.
 */
export function minifyChunksPlugin({ sourcemap = false } = {}) {
  return {
    name: 'dicer:minify-chunks',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const withMap = sourcemap && file.map;
        const input = withMap
          ? `${file.code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(file.map)).toString('base64')}\n`
          : file.code;
        const out = await transformWithEsbuild(input, file.fileName, {
          loader: 'js',
          format: 'esm',
          minify: true,
          legalComments: 'none',
          sourcemap: withMap ? 'external' : false,
        });
        file.code = out.code;
        file.map = null;
        const mapAsset = bundle[`${file.fileName}.map`];
        if (withMap && mapAsset) mapAsset.source = JSON.stringify(out.map);
      }
    },
  };
}
