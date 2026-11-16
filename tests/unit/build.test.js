import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  BUDGET,
  WORLD_START_ASSETS,
  distFiles,
  isLazy,
  worldStartFiles,
} from '../../build/world-start.js';

// The world-start set (non-lazy dist/ plus the digit atlas and api.js), the lazy chunk list and
// the budget live in build/world-start.js, shared with scripts/bundle-report.mjs.
const worldStartBytes = () => worldStartFiles().reduce((sum, p) => sum + statSync(p).size, 0);

describe('build', () => {
  beforeAll(() => execSync('node node_modules/vite/bin/vite.js build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('emits the GLTF loader, the DSN migration, the audio synth, the effects library and the trigger editor as their own chunks, out of the world-start bundle', () => {
    const lazy = distFiles().filter((p) => isLazy(p));
    const chunk = lazy.find((p) => /model-loader-/.test(p));
    const migration = lazy.find((p) => /migration-/.test(p));
    const synth = lazy.find((p) => /synth-/.test(p));
    const effects = lazy.find((p) => /effects-/.test(p));
    const editor = lazy.find((p) => /trigger-editor-/.test(p));
    const damageEditor = lazy.find((p) => /damage-map-editor-/.test(p));
    const areaEditor = lazy.find((p) => /area-editor-/.test(p));
    const themeBrowser = lazy.find((p) => /theme-browser-/.test(p));
    const appearanceEditor = lazy.find((p) => /appearance-editor-/.test(p));
    const themeForm = lazy.find((p) => /theme-form-/.test(p)); // theme helpers + thumbnailer, shared by the theme browser and the appearance editor
    const damageForm = lazy.find((p) => /damage-map-form-/.test(p)); // shared by the damage map editor and the theme browser
    const soundNames = lazy.find((p) => /sound-names-/.test(p)); // the built-in sound list, shared by the synth and the editor
    const points = lazy.find((p) => /(LineSegments|InterleavedBufferAttribute)-/.test(p)); // three's InterleavedBuffer(Attribute), shared by the effects and model-loader chunks (named after its first export)
    const fontBuilder = lazy.find((p) => /font-builder-/.test(p)); // runtime font atlases (P7-D3)
    const sdfBuilder = lazy.find((p) => /sdf-builder-/.test(p)); // the SDF builder, shared by font-builder and look-extras (icons)
    const fontWorker = lazy.find((p) => /font-worker-/.test(p));
    const benchAdapter = lazy.find((p) => /dicer-adapter-/.test(p)); // game.dice3d.benchmark(): adapter + runner
    const benchApp = lazy.find((p) => /benchmark-app-/.test(p));
    const benchReport = lazy.find((p) => /report-/.test(p)); // the bench library (scenarios, stats, recorder, report)
    const lookExtras = lazy.find((p) => /look-extras-/.test(p)); // new look shader code (dice designs)
    const pets = lazy.find((p) => /^dist\/pet-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the dice pet layer
    const threePoints = lazy.find((p) => /^dist\/Points-[A-Za-z0-9_-]{8}\.js$/.test(p)); // three's Points, shared by the pet chunk and the model loader
    const hand = lazy.find((p) => /^dist\/hand-[A-Za-z0-9_-]{8}\.js$/.test(p)); // rolling by hand (src/hand/hand.js)
    const jb2a = lazy.find((p) => /^dist\/jb2a-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the JB2A player (src/jb2a/jb2a.js)
    const chatTray = lazy.find((p) => /^dist\/chat-tray-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the chat dice tray (src/ui/chat-tray.js)
    const trayDice = lazy.find((p) => /^dist\/tray-dice-[A-Za-z0-9_-]{8}\.js$/.test(p)); // the tray core, shared by the hand and chat-tray chunks
    expect(chatTray).toBeTruthy();
    expect(trayDice).toBeTruthy();
    // docked lazily on the first chat render: dicer.js only names the chunk, never its code or the hand chunk's
    expect(readFileSync(chatTray, 'utf8')).toContain('dicer-chat-tray');
    expect(readFileSync(chatTray, 'utf8')).not.toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-chat-tray');
    expect(readFileSync('dist/dicer.js', 'utf8')).toContain(chatTray.slice('dist/'.length));
    expect(jb2a).toBeTruthy();
    expect(readFileSync(jb2a, 'utf8')).toContain('Library/Generic');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('Library/Generic');
    expect(pets).toBeTruthy();
    // The hand chunk is lazy: only src/hand/hand-loader.js names it (import()); dicer.js never holds its code.
    expect(hand).toBeTruthy();
    expect(readFileSync(hand, 'utf8')).toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-hand-chunk');
    expect(readFileSync('dist/dicer.js', 'utf8')).toContain(hand.slice('dist/'.length));
    // The dice tray (window, throw, styles) is the hand chunk's; world start only adds its tool.
    expect(readFileSync(hand, 'utf8')).toContain('dicer-tray-style');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-tray');
    expect(threePoints).toBeTruthy();
    // lazy for real: only the lazy chunks import it, never the world-start bundle
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain(threePoints.slice('dist/'.length));
    expect(lookExtras).toBeTruthy();
    expect(readFileSync(lookExtras, 'utf8')).toContain('dicer-look-extras');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-look-extras');
    expect(benchAdapter).toBeTruthy();
    expect(benchApp).toBeTruthy();
    expect(benchReport).toBeTruthy();
    expect(readFileSync(benchApp, 'utf8')).toContain('dicer-benchmark');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-benchmark');
    expect(readFileSync(benchReport, 'utf8')).toContain('Dicer benchmark');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('Dicer benchmark');
    expect(fontBuilder).toBeTruthy();
    expect(sdfBuilder).toBeTruthy();
    expect(fontWorker).toBeTruthy();
    // The SDF builder lives in the lazy chunks only; dicer.js just names the worker's URL.
    expect(readFileSync(sdfBuilder, 'utf8')).toContain('nodigits');
    expect(readFileSync(fontWorker, 'utf8')).toContain('nodigits');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('nodigits');
    expect(WORLD_START_ASSETS.some((p) => p.includes('digits-sans'))).toBe(false);
    expect(
      WORLD_START_ASSETS.some((p) => /digits-(blackletter|norse|uncial|scifi|handwritten|deco)/.test(p)),
    ).toBe(false);
    expect(synth).toBeTruthy();
    expect(editor).toBeTruthy();
    expect(soundNames).toBeTruthy();
    // The editor is code + templates' logic; only the settings menu proxy is in the world-start bundle.
    expect(readFileSync(editor, 'utf8')).toContain('dicer-trigger-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-trigger-editor');
    expect(damageEditor).toBeTruthy();
    expect(readFileSync(damageEditor, 'utf8')).toContain('dicer-damage-map-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-damage-map-editor');
    expect(areaEditor).toBeTruthy();
    expect(readFileSync(areaEditor, 'utf8')).toContain('dicer-area-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-area-editor');
    expect(themeBrowser).toBeTruthy();
    expect(readFileSync(themeBrowser, 'utf8')).toContain('dicer-theme-browser');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-theme-browser');
    expect(appearanceEditor).toBeTruthy();
    expect(readFileSync(appearanceEditor, 'utf8')).toContain('dicer-appearance-editor');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-appearance-editor');
    expect(themeForm).toBeTruthy();
    expect(effects).toBeTruthy();
    expect(readFileSync(effects, 'utf8')).toContain('glow-pulse');
    expect(readFileSync(effects, 'utf8')).toContain('shockwave');
    // Effect ids are data (the damage themes name them); the library's shader uniforms are code.
    expect(readFileSync(effects, 'utf8')).toContain('uAlpha');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('uAlpha');
    expect(migration).toBeTruthy();
    expect(chunk).toBeTruthy();
    expect(readFileSync(chunk, 'utf8')).toContain('KHR_draco_mesh_compression');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('KHR_draco_mesh_compression');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('has no Dicer counterpart yet');
    expect(readFileSync(migration, 'utf8')).toContain('has no Dicer counterpart yet');
    expect(lazy.sort()).toEqual(
      [
        chunk,
        migration,
        synth,
        effects,
        editor,
        damageEditor,
        areaEditor,
        themeBrowser,
        appearanceEditor,
        themeForm,
        damageForm,
        soundNames,
        points,
        fontBuilder,
        sdfBuilder,
        fontWorker,
        benchAdapter,
        benchApp,
        benchReport,
        lookExtras,
        pets,
        threePoints,
        hand,
        jb2a,
        chatTray,
        trayDice,
        'dist/draco/draco_decoder.wasm',
        'dist/draco/draco_wasm_wrapper.js',
      ].sort(),
    );
  });
  it("hand chunk is lazy and dist/dicer.js does not contain 'dicer-hand-chunk'", () => {
    const hand = distFiles().find((p) => /^dist\/hand-[A-Za-z0-9_-]{8}\.js$/.test(p));
    expect(hand).toBeTruthy();
    expect(isLazy(hand)).toBe(true);
    expect(worldStartFiles()).not.toContain(hand);
    const chunk = readFileSync(hand, 'utf8');
    expect(chunk).toContain('dicer-hand-chunk');
    expect(chunk).toContain('dicer: a throw recorder threw'); // the hand half of DiceBox lives here
    const main = readFileSync('dist/dicer.js', 'utf8');
    expect(main).not.toContain('dicer-hand-chunk');
    expect(main).not.toContain('dicer: a throw recorder threw');
  });
  it('keeps the built-in theme table under 6 KiB minified (P5-R1)', () => {
    const js = readFileSync('dist/dicer.js', 'utf8');
    const a = js.indexOf('@@dicer-themes-start');
    const b = js.indexOf('@@dicer-themes-end');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const bytes = Buffer.byteLength(js.slice(a, b + 20));
    console.info(`dicer theme table: ${bytes} bytes minified`);
    expect(bytes).toBeLessThanOrEqual(6 * 1024);
  });
  it('leaves api.js out of the bundle: it ships beside module.json, imported at runtime', () => {
    expect(statSync('api.js').isFile()).toBe(true);
    for (const p of distFiles().filter((f) => f.endsWith('.js'))) {
      expect(readFileSync(p, 'utf8')).not.toContain('SETTING_FORMATING');
    }
  });
  it('strips comments and indentation from the shaders in the world-start bundle (Plan 8 Task 6)', () => {
    const js = readFileSync('dist/dicer.js', 'utf8');
    // A comment in three's alphahash_pars_fragment chunk, and one in Dicer's noise library.
    expect(js).not.toContain('Derived from trials only');
    expect(js).not.toContain('Rotate-ish and scale between octaves');
    expect(js).toContain('#include <lights_physical_pars_fragment>');
  });
  it('does not grow the world-start download by more than 2 KB (ratchet, Plan 8 Task 6)', () => {
    // 4_086_989 bytes after Task 6 (GLSL stripping), 107 KB under the 4 MiB budget (H-R9 keeps
    // 4 MiB): the headroom must not be spent unnoticed. Lower this reference whenever world start
    // shrinks. P9-R8 raised it by 650 bytes on purpose (4_087_639): the adaptive-quality drop log
    // the benchmark reads must live in the world-start renderer. P9-R16 re-based it on the bundle
    // as it stood (4_090_248, about 105 KB under the 4 MiB budget) after the single-mesh blob
    // shadows (+565 bytes) spent the last of the allowance; the next 2 KB must again be noticed.
    // The preview buttons re-based it on purpose (4_092_397): api._throwLook lives in the
    // world-start API (the editors call it through game.dice3d). The readable-numbers fix
    // re-based it on purpose (+1_738, 4_094_135): every die's material picks its number colour
    // against the die's own colour, so the contrast rule lives in the world-start renderer.
    // Dice designs plan 1 re-based it on purpose (4_094_135): its option lists, normalisation and
    // the look-extras loader must live in world start (spec Constraints, World-start size); plan 1
    // may spend at most 1,536 bytes of the next 2 KB.
    // Dice designs plan 2 re-based it on purpose (4_095_655): plan 2 may spend at most 1,024
    // bytes of the next 2 KB.
    // Dice designs plan 3 re-based it on purpose (4_096_369): plan 3 may spend at most 768 bytes
    // of the next 2 KB.
    // Dice designs plan 4 re-based it on purpose (4_097_080): plan 4 may spend at most 1,536 bytes
    // of the next 2 KB.
    // dice pet plan: 4,096,854 + 2,048; the plan's cap is 4,096 B over 4,096,854 (controller
    // ruling, ledger). All pet art, animation and sound is lazy.
    // pet splat plan: 1,536 B cap + 64 B controller allowance (ledger) over 4,100,546.
    // pet splat plan: +512 B for the final-review fixes (ledger).
    // pet dodge plan: 512 B over 4,102,587
    // rolling by hand plan: 12,288 B cap over 4,103,020 (owner approval, 2026-11-14). Re-based once,
    // at its Task 1 (pre-flight R1), so no later task re-bases it.
    // living insides plan: re-based on the bundle as it stood after rolling-by-hand plus later plans
    // (4,115,282, i.e. 13.6 KB past the rolling-by-hand base, beyond that plan's 12,288 B cap); this
    // plan may spend 1,536 B (controller ruling during the plan; owner informed at sign-off).
    // edge strips plan (2026-11-15-dicer-edge-strips): +300 B on the same base for the strip look
    // field (owner approval, 2026-11-15).
    // elemental trails: owner raised the allowance by 500 B (1,836 -> 2,336) for trails and bursts.
    // tester requests (2026-11-16): owner approved raising it for the batch; dice above windows
    // +968 B (2,336 -> 3,304).
    const growth = worldStartBytes() - 4_115_282;
    console.info(`dicer world-start growth since the living-insides base: ${growth} bytes`);
    expect(growth).toBeLessThanOrEqual(3_304);
  });
  it('ships no sourcemaps in dist/ (they are made only for scripts/bundle-report.mjs)', () => {
    const maps = readdirSync('dist', { recursive: true }).filter((f) => String(f).endsWith('.map'));
    expect(maps).toEqual([]);
    for (const p of distFiles().filter((f) => f.endsWith('.js'))) {
      expect(readFileSync(p, 'utf8')).not.toContain('sourceMappingURL');
    }
  });
  it('keeps the world-start download (dist/ minus lazy chunks, plus the font atlas and api.js) under 4 MiB (H-R9)', () => {
    const files = worldStartFiles();
    const total = worldStartBytes();
    // Gzip is for information only: Foundry serves these files as they are.
    const gzip = files.reduce((sum, p) => sum + gzipSync(readFileSync(p), { level: 9 }).length, 0);
    console.info(
      `dicer size guard: ${total} of ${BUDGET} bytes (world-start dist/ + ${WORLD_START_ASSETS.join(' + ')}); ` +
        `headroom ${BUDGET - total} bytes; gzip -9 total ${gzip} bytes (information only)`,
    );
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});
