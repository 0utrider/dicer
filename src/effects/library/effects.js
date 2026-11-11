/**
 * Entry of the lazy `effects` chunk. Rollup names a dynamic-import chunk after its entry file,
 * so importing ./index.js directly would emit an anonymous `index-*.js`; this file gives the
 * chunk its name (dist/effects-*.js, which tests/unit/build.test.js checks).
 */
export * from './index.js';
