import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';

const BUDGET = 4 * 1024 * 1024;
/**
 * Loaded at world start besides dist/ (loadDigitAtlas; main.js imports api.js at init). The sans
 * atlas (digits-sans.*) is not: the font layer loads it only when a look uses it.
 */
const WORLD_START_ASSETS = ['assets/fonts/digits.png', 'assets/fonts/digits.json', 'api.js'];

/** Fetched on demand: a die model (dynamic import / DRACOLoader), or the DSN migration at ready. */
const isLazy = (p) => /^dist\/(model-loader-[^/]+\.js|migration-[^/]+\.js|synth-[^/]+\.js|effects-[^/]+\.js|trigger-editor-[^/]+\.js|damage-map-editor-[^/]+\.js|area-editor-[^/]+\.js|theme-browser-[^/]+\.js|appearance-editor-[^/]+\.js|theme-form-[^/]+\.js|damage-map-form-[^/]+\.js|sound-names-[^/]+\.js|Points-[^/]+\.js|font-builder-[^/]+\.js|assets\/font-worker-[^/]+\.js|draco\/)/.test(p);

/** Every file under dist/, as forward-slash paths. */
const distFiles = () =>
  readdirSync('dist', { recursive: true })
    .map((f) => `dist/${f.split(sep).join('/')}`)
    .filter((p) => statSync(p).isFile());

function worldStartBytes() {
  const files = distFiles().filter((p) => !isLazy(p));
  return [...files, ...WORLD_START_ASSETS].reduce((sum, p) => sum + statSync(p).size, 0);
}

describe('build', () => {
  beforeAll(() => execSync('node node_modules/vite/bin/vite.js build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('emits the GLTF loader, the DSN migration, the audio synth, the effects library and the trigger editor as their own chunks, out of the world-start bundle', () => {
    const lazy = distFiles().filter(isLazy);
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
    const points = lazy.find((p) => /Points-/.test(p)); // three's Points, shared by the effects and model-loader chunks
    const fontBuilder = lazy.find((p) => /font-builder-/.test(p)); // runtime font atlases (P7-D3)
    const fontWorker = lazy.find((p) => /font-worker-/.test(p));
    expect(fontBuilder).toBeTruthy();
    expect(fontWorker).toBeTruthy();
    // The SDF builder lives in the lazy chunks only; dicer.js just names the worker's URL.
    expect(readFileSync(fontBuilder, 'utf8')).toContain('nodigits');
    expect(readFileSync(fontWorker, 'utf8')).toContain('nodigits');
    expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('nodigits');
    expect(WORLD_START_ASSETS.some((p) => p.includes('digits-sans'))).toBe(false);
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
      [chunk, migration, synth, effects, editor, damageEditor, areaEditor, themeBrowser, appearanceEditor, themeForm, damageForm, soundNames, points, fontBuilder, fontWorker, 'dist/draco/draco_decoder.wasm', 'dist/draco/draco_wasm_wrapper.js'].sort(),
    );
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
  it('keeps the world-start download (dist/ minus lazy chunks, plus the font atlas and api.js) under 4 MB', () => {
    const total = worldStartBytes();
    const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
    console.info(
      `dicer size guard: ${kib(total)} of ${kib(BUDGET)} (world-start dist/ + digits.png + digits.json + api.js); ` +
        `headroom ${kib(BUDGET - total)}`,
    );
    expect(total).toBeLessThanOrEqual(BUDGET);
  });
});
