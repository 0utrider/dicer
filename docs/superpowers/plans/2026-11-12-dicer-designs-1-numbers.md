# Dice Designs Plan 1: Numbers and Markings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four numbers-layer designs the owner chose: crit/fumble icons, six more built-in fonts, raised and glow-ink numbers, and outline and holographic foil fills, each usable wherever looks are used today.

**Architecture:** World-start code gets only the option lists, their normalisation, two pure helpers (`needsLookExtras`, `fallbackLook`), a tiny loader and a hook in `createDiceMaterial`. All new shader code, the icon art and the icon atlas builder live in one lazily imported "look extras" chunk (`src/render/extras/`), whose general `patchMaterial()` interface returns defines, uniforms, chunk code, line replacements, labels and an atlas; plans 2 and 3 (bodies, insides) add to the same chunk. A material built before the chunk has loaded draws the look's fallback for that roll; when the chunk arrives, `main.js` calls `refreshMaterials()`, so later rolls get the real look. The new fonts follow the Sans pattern: a prebuilt MSDF atlas per font, loaded on first use.

**Tech Stack:** three.js r184 (MeshPhysicalMaterial + onBeforeCompile), WebGL2 GLSL, Vite lazy chunks, Vitest, Playwright (the real-GPU gallery `tests/visual/looks.mjs`), msdf-bmfont-xml (`npm run build:sdf`).

**Spec:** `docs/superpowers/specs/2026-11-12-dicer-dice-designs-design.md` (items 1-4 and the Constraints section). Parent: `docs/superpowers/specs/2026-11-10-dicer-design.md` (G2, G3, G4).

## Global Constraints

- G2: "each option costs only when used". A look without the new options gets exactly today's `programKey`, shader text, label texture and atlas. The paint/gold/silver/enamel programs stay unchanged.
- World start: new shader code, icon art and the icon atlas builder live in `src/render/extras/` only, and no world-start module imports that folder statically. World-start code gets only the option lists, normalisation, `needsLookExtras`, `fallbackLook`, `src/render/extras-loader.js` and the hook in `dice-material.js`.
- The world-start ratchet (`tests/unit/build.test.js`) is re-based once, on purpose, in Task 1. All of plan 1 may grow world start by at most 1,536 bytes over that new reference (checked in Task 9), which leaves room for plans 2-3.
- Fallback rule: while the chunk is not loaded, a die draws `fallbackLook(a)`: fill outline→paint, holo→gold, glow→paint; relief engraved; icons off (numbers shown). This applies to that roll only. Once the chunk loads, `refreshMaterials()` runs (rolls in flight keep their materials).
- Safe flags (P2-R12) always draw `fallbackLook(a)`: the safe program stays the single plain one.
- Keep vertex attributes unchanged (WebGL2/ANGLE attribute limits). Add no `THREE.Light`.
- Licences: fonts SIL OFL 1.1 (or equally free); icons are own work. The owner approves every downloaded file (name, source, licence, size) before it is downloaded.
- New built-in font atlases load on demand and are never in `WORLD_START_ASSETS`.
- Every new field is normalised, and unknown values fall back. Each field is part of `appearanceKey` (automatic) and, where it changes the shader, of `programKey`: fill outline/holo/glow and relief raised do. Icons change only labels and atlas, never the shader.
- Lower tiers: the relief needs `DICER_ENGRAVE`, so with engraving off a raised look is flat, as an engraved one is there. The fills are cheap and stay on every non-safe tier.
- UI: every new option is in the appearance editor's numbers section, with strings under `DICER.Appearance.*` in `lang/en.json`.
- Repo practice: use the Grep tool (a shell hook mangles grep). Files are CRLF. Run tests as `rtk proxy npx vitest run <file>`. Lint with `npm run -s lint`.

## Review Focus

- A look with new options rolled before the chunk has loaded (the first roll after world start): the die draws the fallback without throwing, and the next roll after the load draws the real look. Test in Task 2 (dice-box).
- The chunk import fails (offline, a stale cached `dicer.js` after an update): the dice keep the fallback, there is one console warning and no re-import on every roll or material. Test in Task 2 (loader).
- Icons on faces that are not plain numbers (a d2 coin, the d100 tens die, preset glyph/blank/layered faces, ghost dice): they keep their labels. Test in Task 6.
- Saved looks, themes and legacy flat looks without the new fields: identical `programKey` and the same program as before. Test in Task 1 (keys) and Task 2 (no chunk import, same shader).
- Safe flags or engraving off with raised/holo/icons: no extras code and no throw. Safe draws the fallback under the one safe key. Test in Task 1 (key) and Task 2 (material).

---

## File structure

- Modify `src/look/appearance.js`: the new option lists, defaults, normalisation, `programKey` part, `needsLookExtras`, `fallbackLook`, `ICON_IDS`, then (Task 7) six font ids.
- Create `src/render/extras-loader.js` (world start): imports the chunk at most once, keeps it, notifies listeners.
- Modify `src/render/dice-material.js`: the hook (fallback when not loaded, merge `patchMaterial()` output, apply `replace` pairs in `patchShader`).
- Create `src/render/extras/look-extras.js` (chunk entry, `look-extras-*.js`): `ready`, `patchMaterial`, `mergePatches`.
- Create `src/render/extras/relief.js`, `fills.js`, `icons.js`: one design each.
- Modify `src/main.js`: `onLookExtrasReady(() => refreshMaterials())`.
- Modify `src/themes/thumbnailer.js`: thumbnails wait for the chunk; the live preview redraws when it is ready.
- Modify `src/fonts/font-atlas.js`: every built-in id other than serif loads through `loadBundled` and is pinned.
- Add `assets/fonts/<font>.ttf`, `assets/fonts/OFL-<Family>.txt`, `assets/fonts/digits-<id>.png/.json` (6 fonts).
- Modify `src/ui/appearance-form.js`, `src/ui/appearance-editor.js`, `templates/appearance-editor.hbs`, `styles/dicer.css`, `lang/en.json`: the numbers section.
- Modify `build/world-start.js`, `tests/unit/build.test.js`: the new lazy chunks and the re-based ratchet.
- Modify `dev/looks.js`: wait for the chunk, add new-option rows (the real-GPU compile check).
- Modify `README.md`: numbers section.

---

### Task 1: Appearance model (fields, normalisation, keys, fallback)

**Files:**
- Modify: `src/look/appearance.js`
- Modify: `tests/unit/build.test.js` (the ratchet reference, lines 136-148)
- Test: `tests/unit/appearance.test.js`

**Interfaces:**
- Produces in `appearance.js`:
  - Private `FILLS = ['paint','gold','silver','enamel','outline','holo','glow']`, private `RELIEFS = ['engraved','raised']`, `export const ICON_IDS = Object.freeze(['starburst','crown','skull','broken-shield','heart','flame'])`.
  - `DEFAULT_APPEARANCE.numbers` gains `relief: 'engraved'`, `icons: { crit: null, fumble: null }`. `normalizeAppearance` always outputs both (unknown relief → 'engraved'; `icons.crit` / `icons.fumble` are kept only when in `ICON_IDS`, otherwise `null`; a non-object `icons` → both null).
  - `programKey(a, flags)`: when `a.numbers.fill` is outline/holo/glow or `a.numbers.relief === 'raised'`, append one last part `n:<fill>` plus `+r` when raised (e.g. `…|safe0|n:holo`, `…|safe0|n:paint+r`). Otherwise the key is exactly today's. The safe key is unchanged. Icons never enter `programKey`.
  - `needsLookExtras(a: Appearance) -> boolean`: true when the fill is outline/holo/glow, the relief is raised, or either icon is set. Plans 2-3 extend this function.
  - `fallbackLook(a: Appearance) -> Appearance`: returns `a` itself when `!needsLookExtras(a)`. Otherwise it returns a copy with the fill mapped (outline→paint, holo→gold, glow→paint), relief 'engraved' and icons `{crit: null, fumble: null}`. Colour, depth and font are kept.

- [ ] **Step 1: Re-base the world-start ratchet on purpose.** On the untouched tree run `rtk proxy npx vitest run tests/unit/build.test.js`, read N from `dicer size guard: N of …`, set the reference in the growth test to N and add to its comment: "Dice designs plan 1 re-based it on purpose (N): its option lists, normalisation and the look-extras loader must live in world start (spec Constraints, World-start size); plan 1 may spend at most 1,536 bytes of the next 2 KB." Run it → PASS (growth 0).
- [ ] **Step 2: Write the failing tests** in `appearance.test.js`:

```js
// file level (import LOOKS from '../../src/look/looks.js', needsLookExtras, fallbackLook, programKey, appearanceKey)
const F = { interiors: true, engraving: true, glow: true, effects: true, interiorSteps: 32, safe: false };
test('numbers.relief: engraved | raised, anything else engraved', () => {
  expect(normalizeAppearance({ numbers: { relief: 'raised' } }).numbers.relief).toBe('raised');
  for (const r of [undefined, 'emboss', 3, null]) expect(normalizeAppearance({ numbers: { relief: r } }).numbers.relief).toBe('engraved');
});
test('numbers.icons: known ids kept, anything else null', () => {
  expect(normalizeAppearance({ numbers: { icons: { crit: 'crown', fumble: 'skull' } } }).numbers.icons).toEqual({ crit: 'crown', fumble: 'skull' });
  expect(normalizeAppearance({ numbers: { icons: { crit: 'dragon', fumble: 7 } } }).numbers.icons).toEqual({ crit: null, fumble: null });
  expect(normalizeAppearance({ numbers: { icons: 'crown' } }).numbers.icons).toEqual({ crit: null, fumble: null });
  expect(normalizeAppearance({}).numbers.icons).toEqual({ crit: null, fumble: null });
});
test('the new fills normalise; an unknown fill still falls back to gold', () => {
  for (const f of ['outline', 'holo', 'glow']) expect(normalizeAppearance({ numbers: { fill: f } }).numbers.fill).toBe(f);
  expect(normalizeAppearance({ numbers: { fill: 'neon' } }).numbers.fill).toBe('gold');
});
test('old looks keep their program key: no n: part for any curated look or old fill', () => {
  for (const { appearance } of Object.values(LOOKS)) expect(programKey(normalizeAppearance(appearance), F)).not.toMatch(/\|n:/);
  expect(programKey(normalizeAppearance({}), F)).toBe('resin|-|nebula:32|eng1|glow0|fx1|safe0');
  expect(programKey(normalizeAppearance({ body: 'metal', fillMetallic: true }), F)).not.toMatch(/\|n:/); // legacy flat
});
test('programKey gets n:<fill>[+r] only for outline/holo/glow or raised; icons never', () => {
  const k = (numbers) => programKey(normalizeAppearance({ numbers }), F);
  expect(k({ fill: 'holo' })).toMatch(/\|safe0\|n:holo$/);
  expect(k({ fill: 'paint', relief: 'raised' })).toMatch(/\|n:paint\+r$/);
  expect(k({ fill: 'glow', relief: 'raised' })).toMatch(/\|n:glow\+r$/);
  expect(k({ fill: 'gold', icons: { crit: 'crown' } })).toBe(k({ fill: 'gold' }));
  expect(appearanceKey(normalizeAppearance({ numbers: { icons: { crit: 'crown' } } }))).not.toBe(appearanceKey(normalizeAppearance({})));
  expect(programKey(normalizeAppearance({ numbers: { fill: 'holo', relief: 'raised' } }), { ...F, safe: true })).toBe(programKey(normalizeAppearance({}), { ...F, safe: true }));
});
test('needsLookExtras and fallbackLook', () => {
  const plain = normalizeAppearance({});
  expect(needsLookExtras(plain)).toBe(false);
  expect(fallbackLook(plain)).toBe(plain);
  const fancy = normalizeAppearance({ numbers: { fill: 'holo', relief: 'raised', icons: { crit: 'crown' }, color: '#123456', depth: 0.7, font: 'sans' } });
  expect(needsLookExtras(fancy)).toBe(true);
  expect(fallbackLook(fancy).numbers).toEqual({ fill: 'gold', relief: 'engraved', icons: { crit: null, fumble: null }, color: '#123456', depth: 0.7, font: 'sans' });
  expect(fallbackLook(normalizeAppearance({ numbers: { fill: 'outline' } })).numbers.fill).toBe('paint');
  expect(fallbackLook(normalizeAppearance({ numbers: { fill: 'glow' } })).numbers.fill).toBe('paint');
  expect(needsLookExtras(normalizeAppearance({ numbers: { icons: { fumble: 'skull' } } }))).toBe(true);
  expect(fancy.numbers.fill).toBe('holo'); // not mutated
});
```

- [ ] **Step 3: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js` → FAIL (`needsLookExtras is not a function`, missing fields).
- [ ] **Step 4: Implement** in `src/look/appearance.js`. Keep it byte-lean, because every byte here is world start: derive the outline/holo/glow test from `FILLS.indexOf(fill) > 3`, and keep the fallback map as one small object literal.
- [ ] **Step 5: Run** the whole suite (`rtk proxy npx vitest run`). Update the existing tests that compare whole normalised appearances (`toEqual` of `numbers`) to include `relief: 'engraved', icons: { crit: null, fumble: null }` → PASS, including the ratchet.
- [ ] **Step 6: Commit** `feat(look): numbers relief, icons and outline/holo/glow fills in the appearance model`.

### Task 2: The look-extras chunk loader and material hook

**Files:**
- Create: `src/render/extras-loader.js`, `src/render/extras/look-extras.js`
- Modify: `src/render/dice-material.js` (`createDiceMaterial`, `patchShader`), `src/main.js` (`activate` and the not-started cleanup), `build/world-start.js` (LAZY), `tests/unit/build.test.js`, `dev/looks.js`
- Test: `tests/unit/extras-loader.test.js` (new), `tests/unit/dice-material.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- Consumes: `needsLookExtras`, `fallbackLook` (Task 1).
- Produces in `extras-loader.js`:
  - `getLookExtras() -> LookExtras | null`
  - `requestLookExtras() -> Promise<LookExtras | null>`: imports `./extras/look-extras.js` once and awaits `mod.ready`, then keeps the module and calls every listener once. Concurrent calls share one promise. A failed import or `ready` resolves null, warns once (`dicer: look extras unavailable; looks use their fallback`), and is never retried in the session.
  - `onLookExtrasReady(cb: () => void) -> () => void` (unsubscribe). A throwing listener is caught and warned.
  - `_setLookExtrasImport(fn: () => Promise<object>)`: test seam. It also resets the state.
- Produces in `look-extras.js` (the chunk contract plans 2-3 reuse):
  - `export const ready: Promise<void>` (resolved now; later for async assets)
  - `export const EXTRAS_ID = 'dicer-look-extras'` (build-test marker)
  - `export function patchMaterial(a: Appearance, flags: Flags, ctx: { shape, labels: string[], atlas }) -> ExtrasPatch`. For now it returns `mergePatches()` of nothing; Tasks 4-6 add `reliefPatch`, `fillPatch`, `iconPatch`.
  - `ExtrasPatch = { defines?: Record<string,string>, uniforms?: Record<string,{value}>, chunks?: Partial<Record<'pars'|'colorPre'|'colorPost'|'roughness'|'tangent'|'normal'|'emissive'|'coat'|'lighting', string>>, replace?: Array<[from: string, to: string]>, labels?: string[], atlas?: object }`
  - `export function mergePatches(...patches: ExtrasPatch[]) -> ExtrasPatch`: assigns defines and uniforms, joins each chunk slot with `'\n'` and concatenates `replace`. The last `labels`/`atlas` wins.
- `createDiceMaterial` (after the safe block, before `programKey`): if `needsLookExtras(a)`, then when safe or not loaded it sets `a = fallbackLook(a)` and calls `requestLookExtras()` if not loaded; otherwise `p = getLookExtras().patchMaterial(a, f, { shape, labels, atlas })`. A throwing `patchMaterial` is caught: it warns once and uses `fallbackLook(a)`. Then `labels = p.labels ?? labels` and `atlas = p.atlas ?? atlas` (before the label texture and `uAtlas`). After the chunks are built: `Object.assign(material.defines, p.defines)`, `Object.assign(uniforms, p.uniforms)`, each `p.chunks[k]` appended to `chunks[k]` on a new line, and `chunks.replace = p.replace`. `patchShader` ends with `for (const [a, b] of chunks.replace ?? []) shader.fragmentShader = shader.fragmentShader.replace(a, b)`. The cache key stays `programKey(a, f)` (plus `|fl1`). The face-layer loop already skips the non-string `replace`.
- `main.js` `activate`: `stopLookExtras = onLookExtrasReady(() => refreshMaterials())`. It is unsubscribed where `if (!started)` cleans up. One full invalidation per session, when the chunk lands, is accepted: programs are cached by three, and only label textures are rebuilt.
- `build/world-start.js` LAZY gains `look-extras-[^/]+\.js`.

- [ ] **Step 1: Write the failing tests**
  - `extras-loader.test.js`:
    - `requestLookExtras imports once, resolves after ready, and notifies listeners once`: the seam import is a spy returning `{ ready: Promise.resolve(), patchMaterial }`. Two concurrent requests → one import, the same module. `getLookExtras()` is null before and the module after. Listener called once.
    - `a failed import resolves null, warns once and is never retried`: two requests → import called once, `console.warn` once, both null.
    - `a throwing listener does not stop the others`.
  - `dice-material.test.js`:
    - `a look needing extras draws its fallback and requests the chunk while it is not loaded`: the seam returns a never-settling promise. `m = createDiceMaterial(look({ numbers: { fill: 'holo', relief: 'raised', icons: { crit: 'crown' } } }), atlas, s, labels, FLAGS)`. Expect `m.userData.programKey === programKey(fallbackLook(a), FLAGS)` and the import called once. A second create does not import again.
    - `once loaded, the patch's defines, uniforms, chunks and replace reach the program`: a fake module whose `patchMaterial` returns `{ defines: { DICER_X: '' }, uniforms: { uX: { value: 1 } }, chunks: { emissive: '/*x-emissive*/' }, replace: [['float dcDepth = ', 'float dcDepth = 1.0 * ']] }`. After `await requestLookExtras()`, `patched(m).fragmentShader` contains `/*x-emissive*/` after `#include <emissivemap_fragment>` and `float dcDepth = 1.0 * `. `m.defines.DICER_X === ''`, `shader.uniforms.uX.value === 1`, and `m.userData.programKey === programKey(a, FLAGS)`.
    - `the patch's labels and atlas replace the label texture and uAtlas` (`uniforms.uAtlas.value === p.atlas.texture`; the label texel rows follow `layoutLabel(p.labels[i], p.atlas)`).
    - `a throwing patchMaterial draws the fallback look and warns once`.
    - `safe flags never call patchMaterial` (spy not called; safe key).
    - `a look without the new options never imports the chunk and builds today's shader` (import spy not called; the fragment shader equals one built with the extras module loaded).
  - `dice-box.test.js`: `a roll before the chunk loads draws the fallback; after refresh the next roll draws the real look`. Roll an extras look → the die's material `userData.programKey` is the fallback key. Resolve the import, `box.invalidateMaterials()`, roll again → the real key (contains `|n:`). No throw.
  - `build.test.js`: find `lookExtras = lazy.find((p) => /look-extras-/.test(p))`, add it to the sorted lazy list, `expect(readFileSync(lookExtras, 'utf8')).toContain('dicer-look-extras')` and `expect(readFileSync('dist/dicer.js', 'utf8')).not.toContain('dicer-look-extras')`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/extras-loader.test.js tests/unit/dice-material.test.js tests/unit/dice-box.test.js tests/unit/build.test.js` → FAIL.
- [ ] **Step 3: Implement** the loader, the chunk skeleton, the material hook, the main.js wiring and LAZY. In `dev/looks.js`, `await requestLookExtras()` before the first material is built, and let each `VARIANTS` entry take an optional fifth element: a `numbers` patch merged into `LOOKS[base].appearance.numbers` (used by Tasks 4-6).
- [ ] **Step 4: Run** the same tests and the full suite → PASS. Note the ratchet's `growth` figure in the commit body.
- [ ] **Step 5: Commit** `feat(render): lazily loaded look-extras chunk; fallback look until it lands`.

### Task 3: Thumbnails and the live preview wait for the chunk

**Files:**
- Modify: `src/themes/thumbnailer.js` (`thumbnail`, `preview().build`)
- Test: `tests/unit/thumbnailer.test.js`, `tests/unit/thumbnailer-preview.test.js`

**Interfaces:**
- Consumes: `needsLookExtras`, `getLookExtras`, `requestLookExtras` (Tasks 1-2).
- Behaviour: `thumbnail(theme, type)` waits for `requestLookExtras()` before joining the render chain when `needsLookExtras(normalizeAppearance(appearance))` and the chunk is not loaded. This is the same pattern as `awaitAtlas`, combined with any font wait. A null result renders the fallback as a stand-in that is not cached (`loose`). In `preview()`, `build()` with a needing look and no chunk draws the fallback, then on `requestLookExtras()` resolving a module (and not stopped) does `free(); redraw()`.

- [ ] **Step 1: Write the failing tests**: `a thumbnail of a holo look waits for the chunk and is cached once it is drawn with it`; `a failed chunk draws the fallback thumbnail and does not cache it`; `the live preview rebuilds its die once the chunk is ready (one extra material, the old one freed)`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/thumbnailer.test.js tests/unit/thumbnailer-preview.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(themes): thumbnails and the editor preview wait for the look-extras chunk`.

### Task 4: Raised relief

**Files:**
- Create: `src/render/extras/relief.js`
- Modify: `src/render/extras/look-extras.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js` (new)

**Interfaces:**
- Consumes: `ExtrasPatch`, `mergePatches` (Task 2); `DEPTH_SCALE` from `src/render/shaders/engrave.js`.
- Produces `export const RAISED_REPLACE: ReadonlyArray<[string, string]>` and `reliefPatch(a) -> ExtrasPatch` (`{}` for engraved, `{ replace: RAISED_REPLACE }` for raised). The three pairs are whole single lines of `ENGRAVE_COLOR`, written without leading whitespace so that they still match after `build/glsl-minify-plugin.js` strips the shader. They must not reference `dcMask`, which the outline fill rewrites (Task 5):
  1. `` `float dcDepth = uEngrave * ${DEPTH_SCALE.toFixed(4)};` `` → `` `float dcDepth = - uEngrave * ${DEPTH_SCALE.toFixed(4)};` `` (the wall tilt flips: embossed).
  2. `float dcOcc = 1.0 - 0.5 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * dcMask` → `float dcOcc = 1.0 - 0.35 * clamp( uEngrave * 2.0, 0.0, 1.0 ) * ( 1.0 - smoothstep( - dcAA, dcAA, dcD ) )`
  3. `* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, dcD ) );` → `* ( 1.0 - smoothstep( 0.0, 2.5 * dcBand, - dcD ) );` (pairs 2 and 3 move the shadow off the glyph floor to a contact shadow on the body around the glyph).

- [ ] **Step 1: Write the failing tests** (load the real chunk through `_setLookExtrasImport(() => import('../../src/render/extras/look-extras.js'))`):
  - `every RAISED_REPLACE line occurs exactly once in the assembled fragment shader and survives GLSL stripping`: for an engraved material, count `from` in `patched(m).fragmentShader` === 1. `stripGlslParts([ENGRAVE_COLOR]).join('')` contains `from`.
  - `raised: each line is replaced once, the program key ends n:<fill>+r` (for raised the `from` count is 0 and the `to` count is 1).
  - `engraved adds no replacement and keeps today's shader`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/look-extras.test.js` → FAIL.
- [ ] **Step 3: Implement** `relief.js` and add `reliefPatch(a)` to `patchMaterial`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU compile check.** Add gallery rows `['default~raised', 'default', 'raised numbers', {}, { relief: 'raised' }]` and `['dwarven-brass~raised', 'dwarven-brass', 'raised numbers', {}, { relief: 'raised' }]` to `dev/looks.js`. Run `node tests/visual/looks.mjs` → exit 0 with zero shader errors on every tier. Then do the stripped-shader run described in the header of `tests/visual/looks.mjs`: edit the two lines, run, and revert both (`git diff build vite.config.js` must be empty afterwards) → zero shader errors. Look at `artifacts/visual/looks-high.png`: the raised rows' numbers read as embossed.
- [ ] **Step 6: Commit** `feat(extras): raised (embossed) numbers`.

### Task 5: Outline, holographic foil and glow-ink fills

**Files:**
- Create: `src/render/extras/fills.js`
- Modify: `src/render/extras/look-extras.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- Produces `OUTLINE_WIDTH = 0.035` (face units), `GLOW_INK = 1.6`, `FILL_PBR = { outline: [0, 0.6, 0], holo: [1, 0.2, 0], glow: [0, 0.6, 0] }` ([metalness, roughness, gloss]), and `fillPatch(a) -> ExtrasPatch` (`{}` for the four old fills). Every new fill returns `uniforms: { uFillPBR: { value: new THREE.Vector2(m, r) }, uFillGloss: { value: g } }` plus:
  - outline: `replace: [['float dcMask = smoothstep( - dcAA, dcAA, dcD );', `float dcMask = smoothstep( - dcAA, dcAA, dcD ) * ( 1.0 - smoothstep( ${W} - dcAA, ${W} + dcAA, dcD ) );`]]` with `W = OUTLINE_WIDTH.toFixed(4)`. Only a rim of the glyph is filled; the inside shows the body (resin included, through its `dcMask` lighting).
  - holo: `chunks.emissive` (runs after the normal is final, before `lights_physical_fragment` reads `diffuseColor`):

```glsl
vec3 dcV = normalize( vViewPosition );
float dcHue = 1.6 * dot( normal, dcV ) + 0.35 * ( vFaceUV.x + vFaceUV.y );
vec3 dcHolo = 0.55 + 0.45 * cos( 6.2832 * ( dcHue + vec3( 0.0, 0.33, 0.67 ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, dcHolo * mix( vec3( 1.0 ), uFillColor, 0.35 ), dcMask );
```

  - glow: `` chunks.emissive: `totalEmissiveRadiance += uFillColor * ${GLOW_INK.toFixed(2)} * dcMask;` `` (independent of the body glow uniforms).

- [ ] **Step 1: Write the failing tests**:
  - `outline replaces the mask line once with a rim of OUTLINE_WIDTH; the line survives GLSL stripping`.
  - `holo: the rainbow lands after emissivemap_fragment; PBR (1, 0.2), no gloss`.
  - `glow: emissive fill colour x GLOW_INK x dcMask; paint PBR; body glow uniforms untouched`.
  - `each new fill is its own program; paint, gold, silver and enamel still share today's program` (four old keys equal and without `n:`; outline/holo/glow keys distinct).
  - `outline with raised: all four replacements apply once each`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/look-extras.test.js` → FAIL.
- [ ] **Step 3: Implement** `fills.js` and add `fillPatch(a)` to `patchMaterial`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU compile check.** Add rows `default~outline`, `default~holo`, `default~glow` (fill only) and `void-star~glow` (`void-star` with `{ fill: 'glow', relief: 'raised' }`). Run `node tests/visual/looks.mjs` (dev, then stripped as in Task 4, reverted) → zero shader errors on every tier. On `looks-high.png`, the outline rows show rims, holo shows colour bands and glow is bright on the dark row.
- [ ] **Step 6: Commit** `feat(extras): outline, holographic foil and glow-ink number fills`.

### Task 6: Crit and fumble icons

**Files:**
- Create: `src/render/extras/icons.js`
- Modify: `src/render/extras/look-extras.js`, `build/world-start.js`, `tests/unit/build.test.js`, `dev/looks.js`
- Test: `tests/unit/icons.test.js` (new)

**Interfaces:**
- Consumes: `ICON_IDS` (Task 1); `labelFor` (`src/core/dice-shapes.js`); `cropGlyph`, `buildAtlasSteps`, `drain`, `SUPERSAMPLE`, `DISTANCE_RANGE` (`src/fonts/sdf-builder.js`); `parseAtlas` (`src/render/sdf-atlas.js`).
- Produces in `icons.js`:
  - `ICON_PATHS: Record<iconId, string>`: own-work SVG path data in a 0..100 viewBox, filled even-odd. No part is thinner than 8 units, so it survives a 64 px SDF. The exact glyphs are the builder's call.
  - `ICON_CHARS: Record<iconId, string>`: `'\uE000' + index` in `ICON_IDS` order.
  - `iconLabels(labels: string[], shape, icons: {crit, fumble}) -> string[]` (pure). Face i gets `ICON_CHARS[crit]` when `values[i] === Math.max(...values)`, and `ICON_CHARS[fumble]` when `values[i] === 1`, only when `labels[i] === labelFor(shape.type, values[i])` and `shape.kind !== 'coin'`. So the d10's max face is its "0" (value 10). The d100 tens die (labels '00'…'90'), preset glyph/blank/layered faces and ghosts ('') keep their labels. The d100 ones die is a plain d10 and shows d10 icons.
  - `atlasCharsOf(atlas) -> BMFontChar[]`: recovers `{char, x, y, width, height, xoffset, yoffset, xadvance}` from a parsed atlas (`x = round(u0 * scaleW)`, `y = round((1 - v1) * scaleH)`).
  - `composeAtlas(font: { chars, base, width, height, rgba /* bottom-up rows */, distanceRange }, icons: { json, width, height, field }) -> { json, width, height, rgba }` (pure). Width `max(fw, iw)`, height `pot(fh + 2 + ih)`. Font pixels and char boxes stay at their top-down rows; icon chars are placed at top-down rows `fh + 2 + y`. The icon field is copied into R, G and B with A 255, and rows are written bottom-up (GL order, as `buildAtlasSteps` does). `json` is BMFont-shaped, so `parseAtlas` reads it.
  - `iconRaster(inkPx: number, makeCanvas) -> glyph[]`: one `cropGlyph` result per icon, char `ICON_CHARS[id]`, drawn with `Path2D` at ink height `inkPx * SUPERSAMPLE`.
  - `withIcons(atlas, { makeCanvas?, readPixels? } = {}) -> atlas | null`. It returns null (numbers drawn) unless `atlas.distanceRange === DISTANCE_RANGE`. Otherwise it returns `{ ...parseAtlas(composed.json), texture }`: a `DataTexture` (RGBA, `NoColorSpace`, linear, no mipmaps, `flipY` false). Icons are rastered at `inkPx = round(1.15 * atlas.digitHeight)`, with the icon atlas cached per `inkPx`. Font pixels come from `texture.image.data` for a DataTexture (bottom-up) or from a 2D-canvas readback of `texture.image` (flipped to bottom-up). Results are cached per source atlas in an LRU of 4; an evicted composed texture is disposed (three re-uploads it if a live material still binds it).
  - `iconPatch(a, ctx, compose = withIcons) -> ExtrasPatch` (`compose` is the test seam): `{}` when both icons are null or no label changed. Otherwise `{ labels: iconLabels(...), atlas: withIcons(ctx.atlas) }`, or `{}` when `withIcons` is null. There is no shader change, so the program key is unaffected.
- Build: Rollup splits `sdf-builder.js` (now shared by `font-builder` and `look-extras`) into its own lazy chunk. After `npm run build`, `ls dist` shows its exact name: add that pattern to LAZY and to the build test's lazy list, and move the `'nodigits'` content assertion from the font-builder chunk to that chunk (`dist/dicer.js` still must not contain it).

- [ ] **Step 1: Write the failing tests** (`icons.test.js`):
  - `ICON_PATHS and ICON_CHARS cover exactly ICON_IDS; chars are distinct private-use code points`.
  - `iconLabels: crit on the max face, fumble on the 1`: on a d20, the face of value 20 gets the crown char, the face of 1 the skull char, all others are unchanged. On a d10, the face of value 10 (label '0') gets the crit icon. On a d6, the face labelled '6.' does. On a d4, 4 and 1 do. With null icons the labels are returned unchanged.
  - `iconLabels keeps numbers on a coin, the d100 tens die, preset faces and ghosts`: d2 shape → unchanged. The tens labels `values.map(v => labelFor('d10', v * 10, 'd100tens'))` → unchanged. Labels `''` and `'X'` → unchanged.
  - `atlasCharsOf round-trips digits.json`: `atlasCharsOf(parseAtlas(json))` boxes equal `json.chars` boxes.
  - `composeAtlas keeps every font glyph's pixels and boxes and adds the icons below`: a synthetic 8×4 font and a 2-glyph icon build. Check `scaleH` is a power of two and ≥ 4 + 2 + ih, the font chars' x/y are unchanged, the icon chars have y ≥ 6, and sampled RGBA texels match their sources (bottom-up rows).
  - `withIcons returns null for an atlas whose distance range is not 8`.
  - `iconPatch gives labels and atlas only when an icon is on and a label changed` (with a stub `compose`).
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/icons.test.js` → FAIL.
- [ ] **Step 3: Implement** `icons.js` and add `iconPatch(a, ctx)` to `patchMaterial`. Draw the six glyphs (starburst, crown, skull, broken-shield, heart, flame).
- [ ] **Step 4: Run** `icons.test.js`, `look-extras.test.js` and `build.test.js` (after the LAZY update) → PASS.
- [ ] **Step 5: Real-GPU check.** Add one row per icon, `icon-<id>` (the default look with `{ icons: { crit: id } }`), and `ruby-classic~icons` (`{ icons: { crit: 'starburst', fumble: 'broken-shield' }, relief: 'raised', fill: 'holo' }`). The gallery's d4, d6, d8, d12 and d20 columns show their max face (`SHOWN`), so the crit icon is on top there; the d10 "0" face is checked in Task 9. Run `node tests/visual/looks.mjs` → zero shader errors on every tier. On `looks-high.png` each icon is centred on the top face, about the size of a number, and reads at cell size.
- [ ] **Step 6: Commit** `feat(extras): crit and fumble icons drawn into the label atlas`.

### Task 7: Six more built-in fonts

**Files:**
- Add: `assets/fonts/<file>.ttf`, `assets/fonts/OFL-<Family>.txt`, `assets/fonts/digits-<id>.png` and `.json` for each id
- Modify: `src/look/appearance.js` (`FONT_IDS_BUILTIN`), `src/fonts/font-atlas.js` (`produce`, `keep`, the `loadBundled` JSDoc), `tests/unit/build.test.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/font-atlas.test.js`, `tests/unit/sdf-atlas.test.js`

**Interfaces:**
- Produces `FONT_IDS_BUILTIN = ['serif', 'sans', 'blackletter', 'norse', 'uncial', 'scifi', 'handwritten', 'deco']`. In `createFontAtlases`, every built-in id except serif is produced by `loadBundled(id)` and pinned (never evicted). `main.js` already maps the name to `digits-<id>`.

- [ ] **Step 1: The controller gets the owner's approval for this exact list before downloading anything.** The controller states each file's size from its download (a HEAD request or the repo listing). Ship TTF, not woff2: `npm run build:sdf` (msdf-bmfont-xml / opentype.js) cannot read woff2, and clients never download the TTF, only the ~25-30 KB atlas, on first use, as with Sans. The static files are in each family's download zip on fonts.google.com, under `static/`.

| id | Candidate (alternate) | Licence | Source | File to ship |
|---|---|---|---|---|
| blackletter | UnifrakturMaguntia | SIL OFL 1.1 | `https://github.com/google/fonts/tree/main/ofl/unifrakturmaguntia` | `UnifrakturMaguntia-Book.ttf` + its `OFL.txt` |
| norse | Germania One (alt. Metamorphous): angular Latin; runes have no digits | SIL OFL 1.1 (Germania One: verify the OFL.txt in the folder) | `https://github.com/google/fonts/tree/main/ofl/germaniaone` (alt. `ofl/metamorphous`) | `GermaniaOne-Regular.ttf` + `OFL.txt` |
| uncial | Uncial Antiqua: elvish/uncial Latin; Tengwar has no digits | SIL OFL 1.1 | `https://github.com/google/fonts/tree/main/ofl/uncialantiqua` | `UncialAntiqua-Regular.ttf` + `OFL.txt` |
| scifi | Orbitron (alt. Audiowide) | SIL OFL 1.1 | `https://github.com/google/fonts/tree/main/ofl/orbitron` (repo has only the variable `Orbitron[wght].ttf`; the static Bold is in the fonts.google.com zip) | `Orbitron-Bold.ttf` (static) + `OFL.txt` |
| handwritten | Caveat (alt. Kalam) | SIL OFL 1.1 | `https://github.com/google/fonts/tree/main/ofl/caveat` (variable in repo; static Bold in the zip) | `Caveat-Bold.ttf` (static) + `OFL.txt` |
| deco | Limelight (alt. Poiret One: hairline strokes, weak when engraved) | SIL OFL 1.1 (Limelight: verify the OFL.txt in the folder) | `https://github.com/google/fonts/tree/main/ofl/limelight` | `Limelight-Regular.ttf` + `OFL.txt` |

- [ ] **Step 2: Download the approved files** into `assets/fonts/`, saving each licence as `OFL-<Family>.txt`. Check the copyright line in each OFL text names the family. Any font whose licence is not OFL or equally free is dropped and goes back to the owner.
- [ ] **Step 3: Build the atlases**: `npm run build:sdf -- assets/fonts/<file>.ttf assets/fonts digits-<id>` for each id. A font without `_` or any digit fails this or the next step's test; switch to its alternate (with approval).
- [ ] **Step 4: Write the failing tests**:
  - appearance: `FONT_IDS_BUILTIN lists the eight built-in fonts and each normalises to itself` (update the existing `['serif','sans']` assertion).
  - font-atlas: `every built-in font other than serif loads once through loadBundled(id) and is pinned` (request each id; a following burst of 7 runtime fonts with `cacheSize: 2` never evicts them; `loadBundled` called once per id).
  - sdf-atlas: `every bundled digits-<id>.json has 0-9 and the "." mark, size 64, distanceRange 8, and its png and OFL text exist` (`readdirSync('assets/fonts')`).
  - build: `expect(WORLD_START_ASSETS.some((p) => /digits-(blackletter|norse|uncial|scifi|handwritten|deco)/.test(p))).toBe(false)`.
- [ ] **Step 5: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js tests/unit/font-atlas.test.js tests/unit/sdf-atlas.test.js` → FAIL.
- [ ] **Step 6: Implement** the two source changes.
- [ ] **Step 7: Run** those tests and `build.test.js` → PASS.
- [ ] **Step 8: Commit** (only the approved font files, licences, atlases and code) `feat(fonts): six more built-in fonts (blackletter, Norse, uncial, sci-fi, handwritten, Art Deco)`.

### Task 8: Appearance editor: relief, fills, icons, fonts

**Files:**
- Modify: `src/ui/appearance-form.js`, `src/ui/appearance-editor.js` (`_prepareContext`), `templates/appearance-editor.hbs` (numbers section, lines 98-137), `styles/dicer.css` (fill swatches near line 1172, the font chip row), `lang/en.json`
- Test: `tests/unit/appearance-editor.test.js`, `tests/visual/editors.mjs`

**Interfaces:**
- Consumes: `FONT_IDS_BUILTIN`, `ICON_IDS` (Tasks 1, 7).
- Produces in `appearance-form.js`: `FILLS` gains `'outline','holo','glow'`; `RELIEFS = ['engraved','raised']`; `ICON_CHOICES = ['none', ...ICON_IDS]`; `FONT_KINDS = [...FONT_IDS_BUILTIN, 'css', 'file']`. The form's `numbers` gains `relief`, `critIcon`, `fumbleIcon` ('none' or an icon id). `formFromAppearance` maps `icons.crit ?? 'none'`. `appearanceFromForm` passes `{ relief, icons: { crit: critIcon, fumble: fumbleIcon } }`, and normalisation turns 'none' into null. `fontParts` / `fontIdOf` / `fontInvalid` treat every `FONT_IDS_BUILTIN` id as a kind. `visibleSections().numberColor` is true for every fill except gold and silver.
- Editor context: `reliefs`, `critIcons`, `fumbleIcons` (via `active(...)`); `fills` and `fontKinds` from the extended lists. In the template, relief is a segmented control (`data-field="numbers.relief"`). Crit and fumble are chip radiogroups (`numbers.critIcon`, `numbers.fumbleIcon`), each showing the hint string. The font picker becomes a wrapping chip radiogroup, keeping `data-field="numbers.fontKind"` and `data-value`.
- `lang/en.json` under `DICER.Appearance`: `Fill.outline` "Outline", `Fill.holo` "Holo foil", `Fill.glow` "Glow ink"; `Numbers.Relief` "Relief", `Numbers.CritIcon` "Icon on the highest face", `Numbers.FumbleIcon` "Icon on the 1", `Numbers.IconsHint` "Icons replace the number on those faces. Coins and the tens die of a d100 keep their numbers."; `Numbers.Depth` becomes "Depth"; `Relief.engraved` "Engraved", `Relief.raised` "Raised"; `Icon.none` "Off", `Icon.starburst` "Starburst", `Icon.crown` "Crown", `Icon.skull` "Skull", `Icon.broken-shield` "Broken shield", `Icon.heart` "Heart", `Icon.flame` "Flame"; `FontKind.blackletter` "Blackletter", `FontKind.norse` "Norse", `FontKind.uncial` "Uncial", `FontKind.scifi` "Sci-fi", `FontKind.handwritten` "Handwritten", `FontKind.deco` "Art Deco".
- CSS: `.dicer-ae-fill-outline` (a ring in `--c`), `.dicer-ae-fill-holo` (a conic rainbow gradient), `.dicer-ae-fill-glow` (`--c` with a soft box-shadow in `--c`).

- [ ] **Step 1: Write the failing tests** (`appearance-editor.test.js`):
  - `form round-trips relief, icons, every fill and every built-in font` (for each value: `appearanceFromForm(formFromAppearance(a))` deep-equals `a`).
  - `'none' icon picks give null icons`.
  - `the form's option lists are exactly what normalisation accepts`: each id in `FILLS`/`RELIEFS`/`ICON_IDS`/`FONT_IDS_BUILTIN` survives `normalizeAppearance` unchanged, and `'nope'` does not.
  - `numberColor shows for paint, enamel, outline, holo and glow, not for gold or silver`.
  - `the numbers section renders relief, icon and font chips with their labels`. Extend the existing i18n-key table at line 645: `'Fill.'` has 7 ids, `'FontKind.'` has 10, plus `'Relief.'` and `'Icon.'`, and every key resolves in `lang/en.json`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/appearance-editor.test.js tests/unit/templates.test.js` → FAIL.
- [ ] **Step 3: Implement** the form helpers, context, template, CSS and strings.
- [ ] **Step 4: Run** those tests and the full suite → PASS. Then `npm run test:visual:editors` → passes. Its `numbers.fontKind` / `sans` click still finds its chip.
- [ ] **Step 5: Commit** `feat(ui): relief, new fills, crit/fumble icons and the new fonts in the appearance editor`.

### Task 9: Owner look check, budgets and docs

**Files:**
- Modify: `README.md` (the Numbers paragraph near line 106 and the fonts list near line 114: the new fills, relief, icons, the six fonts with their names and OFL credit)

- [ ] **Step 1:** `rtk proxy npx vitest run` and `npm run -s lint` → all pass. Read `dicer world-start growth since …` from the build test output: it must be ≤ 1,536. If it is larger, move code out of world start (into the chunk or the editor) before going on.
- [ ] **Step 2:** `npm run test:visual` (`tests/visual/looks.mjs`) → zero shader errors on every tier. The program-count assertion holds, and the existing rows' programs are unchanged (same distinct `programKey` count for them as before plan 1).
- [ ] **Step 3: Owner look check in Foundry.** Open Dicer's appearance editor, and in the numbers section try each option in the live preview: relief raised vs engraved; fills outline, holo (turn the die and watch the colour shift), glow (on a dark body); crit crown and fumble skull (drag the preview to the 1); each of the six new fonts. Press Throw (`game.dice3d._throwLook`) for each and look at d4-d20 on the table, including a d10 whose "0" face carries the crit icon. Then roll `/r 1d100` with an icon look: the tens die shows numbers. Then roll with a world theme and a per-type override that use the new options. The owner signs off. Rejected looks go back to Tasks 4-8.
- [ ] **Step 4:** `npm run test:live:bench -- --quick --only throttled` → no new failures beyond the known first-frame rows.
- [ ] **Step 5:** Update the README. Commit `docs(numbers): raised and glow-ink numbers, outline and holo fills, crit icons and six fonts`.
