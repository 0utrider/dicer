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
 * Paths are relative to the build's output folder (`dist/` by default). The dice pet chunk, the
 * rolling-by-hand chunk (hand-*, src/hand/hand.js), grab and toss (grab-*, src/grab/grab.js), the JB2A player chunk (jb2a-*, src/jb2a/jb2a.js),
 * the chat dice tray (chat-tray-*, src/ui/chat-tray.js) with the tray core it shares with the hand
 * chunk (tray-dice-*, src/hand/chunk/tray-dice.js), the Roll stats window (roll-stats-*,
 * src/ui/roll-stats.js) with the pet moods it shares with the pet chunk (moods-*), the roll stats
 * recorder (recorder-*, src/stats/recorder.js, loaded at the first roll message) and
 * three's Points (split out because the pet chunk and the model loader share it) and element-of
 * (src/effects/element-of.js, split out because the effects and pet chunks share it) match only the
 * hashed chunk form, as do the atlas reader (atlas-*, src/compat/atlas.js) and the DSN migration
 * report window (dsn-report-*, src/ui/dsn-report.js) and the crit scenes (scenes-*,
 * src/scenes/scenes.js, imported by the effects chunk on a scene's first play), their catalog
 * (scene-catalog-*, shared by the effects chunk and the theme editors) and three's geometries
 * the lazy chunks share (named after one of them, e.g. TorusGeometry-*: the scenes, pet and effects
 * chunks; build.test.js checks dicer.js never imports one statically), so a world-start
 * module that happens to be named pet-* is never counted lazy. The theme API for other modules
 * (theme-api-*, src/api/theme-api.js) loads in Dicer's ready hook (owner approved, 2026-11-22).
 */
const LAZY =
  /^(model-loader-[^/]+\.js|migration-[^/]+\.js|synth-[^/]+\.js|effects-[^/]+\.js|trigger-editor-[^/]+\.js|damage-map-editor-[^/]+\.js|area-editor-[^/]+\.js|theme-browser-[^/]+\.js|appearance-editor-[^/]+\.js|theme-form-[^/]+\.js|damage-map-form-[^/]+\.js|sound-names-[^/]+\.js|(?:LineSegments|InterleavedBufferAttribute)-[^/]+\.js|font-builder-[^/]+\.js|sdf-builder-[^/]+\.js|dicer-adapter-[^/]+\.js|benchmark-app-[^/]+\.js|report-[^/]+\.js|look-extras-[^/]+\.js|pet-[A-Za-z0-9_-]{8}\.js$|hand-[A-Za-z0-9_-]{8}\.js$|grab-[A-Za-z0-9_-]{8}\.js$|roll-filters-[A-Za-z0-9_-]{8}\.js$|pet-window-[A-Za-z0-9_-]{8}\.js$|settings-groups-[A-Za-z0-9_-]{8}\.js$|jb2a-[A-Za-z0-9_-]{8}\.js$|chat-tray-[A-Za-z0-9_-]{8}\.js$|tray-dice-[A-Za-z0-9_-]{8}\.js$|Points-[A-Za-z0-9_-]{8}\.js$|element-of-[A-Za-z0-9_-]{8}\.js$|atlas-[A-Za-z0-9_-]{8}\.js$|tray-editor-[A-Za-z0-9_-]{8}\.js$|tray-[A-Za-z0-9_-]{8}\.js$|tray-model-[A-Za-z0-9_-]{8}\.js$|popout-[A-Za-z0-9_-]{8}\.js$|installed-dice-[A-Za-z0-9_-]{8}\.js$|addon-textures-[A-Za-z0-9_-]{8}\.js$|roll-stats-[A-Za-z0-9_-]{8}\.js$|recorder-[A-Za-z0-9_-]{8}\.js$|moods-[A-Za-z0-9_-]{8}\.js$|dsn-report-[A-Za-z0-9_-]{8}\.js$|scenes-[A-Za-z0-9_-]{8}\.js$|scene-catalog-[A-Za-z0-9_-]{8}\.js$|theme-api-[A-Za-z0-9_-]{8}\.js$|(?:Box|Circle|Cone|Cylinder|Icosahedron|Lathe|Plane|Ring|Sphere|Torus)Geometry-[A-Za-z0-9_-]{8}\.js$|assets\/font-worker-[^/]+\.js|draco\/)/;

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
