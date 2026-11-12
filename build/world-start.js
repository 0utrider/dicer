import { readdirSync, statSync } from 'node:fs';
import { sep } from 'node:path';

/** The world-start download budget: 4 MiB (P3-R7; H-R9 keeps it, withdrawing the 4,000,000 B target of H-D1). */
export const BUDGET = 4 * 1024 * 1024;

/**
 * Loaded at world start besides dist/ (loadDigitAtlas; main.js imports api.js at init). The sans
 * atlas (digits-sans.*) is not: the font layer loads it only when a look uses it.
 */
export const WORLD_START_ASSETS = ['assets/fonts/digits.png', 'assets/fonts/digits.json', 'api.js'];

/**
 * Fetched on demand, never at world start: a die model (dynamic import / DRACOLoader), the DSN
 * migration at ready, the editors and theme browser, the benchmark, runtime fonts, and the like.
 * Paths are relative to the build's output folder (`dist/` by default).
 */
const LAZY =
  /^(model-loader-[^/]+\.js|migration-[^/]+\.js|synth-[^/]+\.js|effects-[^/]+\.js|trigger-editor-[^/]+\.js|damage-map-editor-[^/]+\.js|area-editor-[^/]+\.js|theme-browser-[^/]+\.js|appearance-editor-[^/]+\.js|theme-form-[^/]+\.js|damage-map-form-[^/]+\.js|sound-names-[^/]+\.js|LineSegments-[^/]+\.js|font-builder-[^/]+\.js|dicer-adapter-[^/]+\.js|benchmark-app-[^/]+\.js|report-[^/]+\.js|assets\/font-worker-[^/]+\.js|draco\/)/;

/** `p` is `dist/...` (or `<outDir>/...` with `outDir` given). */
export const isLazy = (p, outDir = 'dist') =>
  p.startsWith(`${outDir}/`) && LAZY.test(p.slice(outDir.length + 1));

/** Every file under `outDir`, as forward-slash paths (`<outDir>/...`). Sourcemaps are not shipped. */
export const distFiles = (outDir = 'dist') =>
  readdirSync(outDir, { recursive: true })
    .map((f) => `${outDir}/${f.split(sep).join('/')}`)
    .filter((p) => statSync(p).isFile() && !p.endsWith('.map'));

/** The files Foundry loads when a world starts: non-lazy build output plus WORLD_START_ASSETS. */
export const worldStartFiles = (outDir = 'dist') => [
  ...distFiles(outDir).filter((p) => !isLazy(p, outDir)),
  ...WORLD_START_ASSETS,
];
