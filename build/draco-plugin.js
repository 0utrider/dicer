import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url);
const FILES = ['draco_wasm_wrapper.js', 'draco_decoder.wasm'];

/**
 * Emits three's Draco decoder (wasm build) as dist/draco/, unhashed: DRACOLoader fetches the
 * files by name from the folder src/render/model-loader.js points it at. Some DSN model presets
 * (e.g. daggerheart-duality-dice) are Draco-compressed. Nothing loads these at world start: the
 * decoder is fetched only when such a model is first shown.
 */
export function dracoDecoderPlugin() {
  return {
    name: 'dicer:draco-decoder',
    apply: 'build',
    generateBundle() {
      for (const name of FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `draco/${name}`,
          source: readFileSync(fileURLToPath(new URL(name, DIR))),
        });
      }
    },
  };
}
