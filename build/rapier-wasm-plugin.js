import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Forward slashes: Vite module ids are normalised, and a backslash id would load the glue twice.
const PKG_DIR = fileURLToPath(
  new URL('../node_modules/@dimforge/rapier3d-deterministic/', import.meta.url),
).replaceAll(String.fromCharCode(92), '/');
const PKG_MARK = '/@dimforge/rapier3d-deterministic/';
const ENTRY = `${PKG_DIR}rapier.js`;
const GLUE = `${PKG_DIR}rapier_wasm3d_bg.js`;
const WASM = `${PKG_DIR}rapier_wasm3d_bg.wasm`;

/** Import this to get the URL of the Rapier wasm file as a separate asset. */
export const RAPIER_WASM_URL = 'virtual:rapier-wasm-url';
const RESOLVED_URL_ID = '\0virtual:rapier-wasm-url';

/**
 * Rapier wasm handling.
 * 1. The non-compat package imports its wasm through ESM wasm integration
 *    (`import * as wasm from './rapier_wasm3d_bg.wasm'`), which neither Vite nor Node supports.
 *    Redirect that module to the plain wasm-bindgen glue; src/physics/sim.js instantiates the
 *    wasm itself.
 * 2. `virtual:rapier-wasm-url` resolves to a URL for the wasm as a SEPARATE emitted asset
 *    (Vite's own asset pipeline would base64-inline it in lib mode), relative to the importing
 *    chunk, so it works when Foundry serves the module from /modules/dicer/dist/.
 */
export function rapierWasmPlugin() {
  let serve = false;
  let refId = null;
  return {
    name: 'dicer-rapier-wasm',
    enforce: 'pre',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    resolveId(source, importer) {
      if (source === RAPIER_WASM_URL) return RESOLVED_URL_ID;
      // The package has only a "module" field, which Vitest's SSR resolution ignores.
      if (source === '@dimforge/rapier3d-deterministic') return ENTRY;
      if (!importer || !/^\.\/rapier_wasm3d(\.js)?$/.test(source)) return null;
      if (!importer.replaceAll('\\', '/').includes(PKG_MARK)) return null;
      return GLUE;
    },
    load(id) {
      if (id !== RESOLVED_URL_ID) return null;
      if (serve) {
        return `import url from '/@fs/${WASM.replaceAll('\\', '/')}?url'; export default url;`;
      }
      refId ??= this.emitFile({
        type: 'asset',
        name: 'rapier_wasm3d_bg.wasm',
        source: readFileSync(WASM),
      });
      return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
    },
  };
}
