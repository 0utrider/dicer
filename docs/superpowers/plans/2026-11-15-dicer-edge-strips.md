# Edge Strips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A die look can give its rounded bevel strips their own style (paint, metal, glow), colour and strength.

**Architecture:** A new `edges.strip` field in the look model; an `edgePatch` in the lazy look-extras chunk draws it (mask `vFaceId < -0.5`); `fallbackLook` drops it while the chunk is missing. Editor controls under the Edges section.

**Tech Stack:** three.js r184 `MeshPhysicalMaterial` + `onBeforeCompile`, vitest, Handlebars (Foundry v14 ApplicationV2).

**Spec:** `docs/superpowers/specs/2026-11-15-dicer-edge-strips-design.md`

## Global Constraints

- Worktree `C:/tmp/dicer-edges`, branch `dicer-edge-style`. Never touch `src/effects/library/catalogue.js`, `src/effects/library/particles.js`, `tests/unit/catalogue.test.js`. Never push or merge.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Source files are CRLF: edit with Edit/Write only. Probe scripts as files, never inline `node -e`.
- Run tests with `rtk proxy npx vitest run <file>`; full suite = `npm run build` then `rtk proxy npx vitest run`.
- World-start code (`src/look/appearance.js`) stays minimal; all GLSL lives in `src/render/extras/edges.js` (lazy).
- Default `edges.strip = { style: 'body', color: '#e2b04a', strength: 1 }`; styles exactly `['body', 'paint', 'metal', 'glow']`.
- A look whose strip is inactive must produce the same program key and fragment shader as today.

## Review Focus

- Existing saved look with no `edges.strip` (or `edges: { style: 'sharp' }` legacy) → normalises to default strip, program key unchanged.
- Strip style set on a sharp die (radius 0) → inactive: no extras needed, no `e:` key part, no patch.
- Strength 0 with a style → inactive, same as `body`.
- Resin die with a face-layer decal plus a strip → both the decal line rewrite and the strip apply (strip must not rewrite the refraction line).
- Safe flags or chunk missing → `fallbackLook` gives today's strips and today's key.

---

### Task 1: Look model field

**Files:**
- Modify: `src/look/appearance.js` (DEFAULT_APPEARANCE, normalizeAppearance, programKey, needsLookExtras, fallbackLook)
- Test: `tests/unit/appearance.test.js` (new `describe('edges.strip (styled bevel strips)')`)

**Interfaces:**
- Produces: `export const STRIP_STYLES = Object.freeze(['body', 'paint', 'metal', 'glow'])`; `export const stripActive = (a) => boolean` (true iff `a.edges.strip.style !== 'body' && a.edges.strip.strength > 0 && a.edges.radius > 0`); normalised look has `edges.strip: { style, color, strength }`; `programKey` appends `e:<style>` iff `stripActive`.

- [ ] **Step 1: Write the failing tests**

```js
describe('edges.strip (styled bevel strips)', () => {
  test('default and missing strip normalise to body/#e2b04a/1', () => {
    expect(DEFAULT_APPEARANCE.edges.strip).toEqual({ style: 'body', color: '#e2b04a', strength: 1 });
    expect(normalizeAppearance({ edges: { radius: 0.5 } }).edges.strip).toEqual({ style: 'body', color: '#e2b04a', strength: 1 });
    expect(normalizeAppearance({ edges: { style: 'sharp' } }).edges).toEqual({ radius: 0, style: 'sharp', strip: { style: 'body', color: '#e2b04a', strength: 1 } });
  });
  test('invalid fields fall back per field', () => {
    const s = normalizeAppearance({ edges: { strip: { style: 'neon', color: 'red', strength: 3 } } }).edges.strip;
    expect(s).toEqual({ style: 'body', color: '#e2b04a', strength: 1 });
    expect(normalizeAppearance({ edges: { strip: { style: 'metal', color: '#ABC', strength: 0.4 } } }).edges.strip).toEqual({ style: 'metal', color: '#aabbcc', strength: 0.4 });
  });
  test('stripActive needs a style, strength > 0 and a rounded edge', () => {
    const a = (strip, radius = 0.5) => normalizeAppearance({ edges: { radius, strip } });
    expect(stripActive(a({ style: 'paint' }))).toBe(true);
    expect(stripActive(a({ style: 'body' }))).toBe(false);
    expect(stripActive(a({ style: 'paint', strength: 0 }))).toBe(false);
    expect(stripActive(a({ style: 'paint' }, 0))).toBe(false);
  });
  test('programKey: e:<style> only when active; inactive keys equal today', () => {
    const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
    const plain = normalizeAppearance({});
    expect(programKey(normalizeAppearance({ edges: { strip: { style: 'glow' } } }), flags)).toBe(`${programKey(plain, flags)}|e:glow`);
    expect(programKey(normalizeAppearance({ edges: { radius: 0, strip: { style: 'glow' } } }), flags)).toBe(programKey(normalizeAppearance({ edges: { radius: 0 } }), flags));
  });
  test('needsLookExtras when active; fallbackLook resets the style to body', () => {
    const a = normalizeAppearance({ edges: { strip: { style: 'metal', color: '#c0c0c0' } } });
    expect(needsLookExtras(a)).toBe(true);
    expect(fallbackLook(a).edges.strip).toEqual({ style: 'body', color: '#c0c0c0', strength: 1 });
    expect(needsLookExtras(normalizeAppearance({ edges: { radius: 0, strip: { style: 'metal' } } }))).toBe(false);
  });
  test('every built-in look keeps strip body', () => {
    for (const { appearance } of Object.values(LOOKS)) expect(normalizeAppearance(appearance).edges.strip.style).toBe('body');
  });
});
```

(`LOOKS` from `src/look/looks.js`; check its export name and import it.)

- [ ] **Step 2: Run to verify fail** — `rtk proxy npx vitest run tests/unit/appearance.test.js` → FAIL (`stripActive` not exported / strip undefined).

- [ ] **Step 3: Implement** in `src/look/appearance.js`: add `strip` to `DEFAULT_APPEARANCE.edges`; in `normalizeAppearance` build `strip` from `e.strip` with `pick`/`color`/`num(0,1)`; export `STRIP_STYLES`, `stripActive`; `programKey` pushes `` `e:${style}` `` last when active; `needsLookExtras` ORs `stripActive(a)`; `fallbackLook` adds `edges: { ...a.edges, strip: { ...a.edges.strip, style: 'body' } }`. Keep the code short (world-start bytes).

- [ ] **Step 4: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js tests/unit/looks.test.js tests/unit/resolve-looks.test.js` → PASS (fix any deep-equal fixtures that spell out `edges` by adding the default strip).

- [ ] **Step 5: Commit** `feat(look): edges.strip field for styled bevel strips`.

### Task 2: Edge-strip shader patch

**Files:**
- Create: `src/render/extras/edges.js`
- Modify: `src/render/extras/look-extras.js` (merge `edgePatch(a)` in `patchMaterial`)
- Test: `tests/unit/edge-strips.test.js` (new; copy the `atlas`/`patched`/`beforeAll` setup from `tests/unit/look-extras.test.js:42-104`)

**Interfaces:**
- Consumes: `stripActive(a)` from Task 1.
- Produces: `export const STRIP_PBR = Object.freeze({ paint: [0, 0.45], metal: [1, 0.25], glow: [0, 0.45] })` (metalness, roughness); `export function edgePatch(a) -> ExtrasPatch` (`{}` when inactive).

Patch contents when active:
- `defines: { DICER_EDGE: '', ['DICER_EDGE_' + style.toUpperCase()]: '' }`
- `uniforms: { uEdgeColor: { value: THREE.Color(strip.color) }, uEdgeStrength: { value: strip.strength }, uEdgePBR: { value: Vector2(...STRIP_PBR[style]) } }`
- `chunks.pars`: the three uniform declarations.
- `chunks.colorPost`: `float dcEdge = ( vFaceId < - 0.5 ? 1.0 : 0.0 ) * uEdgeStrength;` then `diffuseColor.rgb = mix( diffuseColor.rgb, uEdgeColor, dcEdge );`
- `chunks.emissive` (glow only): `totalEmissiveRadiance += uEdgeColor * dcEdge;`
- `chunks.lighting`: `#ifdef DICER_RESIN\n\ttotalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );\n#endif` (restores the lit strip over the refracted body).
- `replace`: `['#include <normal_fragment_begin>', '\tmetalnessFactor = mix( metalnessFactor, uEdgePBR.x, dcEdge );\n\troughnessFactor = mix( roughnessFactor, uEdgePBR.y, dcEdge );\n#include <normal_fragment_begin>']` and `['#include <transmission_fragment>', '\tvec3 dcEdgeLit = totalDiffuse;\n#include <transmission_fragment>']`. Neither touches the resin refraction line, so `DECAL_OPAQUE` keeps working.

- [ ] **Step 1: Write the failing tests** (`tests/unit/edge-strips.test.js`)

```js
const mat = (strip, body = { type: 'opaque' }, radius = 0.5) =>
  createDiceMaterial(normalizeAppearance({ body, edges: { radius, strip } }), atlas, s, labels, FLAGS);

test('inactive strip: no patch, no DICER_EDGE, shader identical to a plain look', () => {
  expect(edgePatch(normalizeAppearance({}))).toEqual({});
  expect(edgePatch(normalizeAppearance({ edges: { radius: 0, strip: { style: 'paint' } } }))).toEqual({});
  const plain = patched(createDiceMaterial(normalizeAppearance({ body: { type: 'opaque' } }), atlas, s, labels, FLAGS)).fragmentShader;
  expect(patched(mat({ style: 'body' })).fragmentShader).toBe(plain);
});
test.each(['paint', 'metal', 'glow'])('%s: define, uniforms, key part and both anchors patched once', (style) => {
  const m = mat({ style, color: '#ff0000', strength: 0.5 });
  expect(m.defines).toMatchObject({ DICER_EDGE: '', [`DICER_EDGE_${style.toUpperCase()}`]: '' });
  expect(m.userData.uniforms.uEdgeStrength.value).toBe(0.5);
  expect(m.userData.uniforms.uEdgeColor.value.getHexString()).toBe('ff0000');
  expect(m.userData.uniforms.uEdgePBR.value.toArray()).toEqual(STRIP_PBR[style]);
  expect(m.userData.programKey).toMatch(new RegExp(`\\|e:${style}$`));
  const fs = patched(m).fragmentShader;
  expect(count(fs, 'float dcEdge =')).toBe(1);
  expect(count(fs, 'metalnessFactor = mix( metalnessFactor, uEdgePBR.x, dcEdge );')).toBe(1);
  expect(count(fs, 'totalEmissiveRadiance += uEdgeColor * dcEdge;')).toBe(style === 'glow' ? 1 : 0);
});
test('resin: strip saved before refraction and restored after; refraction line untouched', () => {
  const fs = patched(mat({ style: 'paint' }, { type: 'resin' })).fragmentShader;
  expect(fs.indexOf('vec3 dcEdgeLit = totalDiffuse;')).toBeLessThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
  expect(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcEdgeLit, dcEdge );')).toBeGreaterThan(fs.indexOf('totalDiffuse = mix( totalDiffuse, dcRefracted'));
});
test('safe flags: fallback, no strip', () => {
  const m = createDiceMaterial(normalizeAppearance({ edges: { strip: { style: 'glow' } } }), atlas, s, labels, { ...FLAGS, safe: true });
  expect(m.defines.DICER_EDGE).toBeUndefined();
});
```

Also add a test that the material with a strip compiles in the existing WebGL-less compile check if `tests/unit/dice-material.test.js` has one (grep `compile`); otherwise skip.

- [ ] **Step 2: Run to verify fail** — `rtk proxy npx vitest run tests/unit/edge-strips.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/render/extras/edges.js` per the patch contents above and add `edgePatch(a)` to the `mergePatches(...)` call in `look-extras.js`. Note `lighting` and `emissive` chunks are appended after the world-start ones by `mergePatches`/dice-material; confirm `userData.uniforms` and `defines` carry extras uniforms (they do for other patches).
- [ ] **Step 4: Run** `rtk proxy npx vitest run tests/unit/edge-strips.test.js tests/unit/look-extras.test.js tests/unit/dice-material.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(render): draw styled bevel strips in the look-extras chunk`.

### Task 3: Editor controls

**Files:**
- Modify: `src/ui/appearance-form.js` (`formFromAppearance`, `appearanceFromForm`, `visibleSections`)
- Modify: `src/ui/appearance-editor.js` (context: `strips`, `pct.stripStrength`, `summary.edges`)
- Modify: `templates/appearance-editor.hbs` (Edges section, after the Sharpness field)
- Modify: `lang/en.json`
- Test: `tests/unit/appearance-editor.test.js`

**Interfaces:**
- Consumes: `STRIP_STYLES` (Task 1).
- Produces: form shape `edges: { radius, strip, stripColor, stripStrength }`; `visibleSections(form).strip` (= radius > 0) and `.stripDetails` (= radius > 0 && strip !== 'body').

Template: when `show.strip`: a `dicer-segmented dicer-ae-seg` of `strips` buttons (`data-action="setField" data-field="edges.strip" data-value="{{id}}"`), and when `show.stripDetails` a `dicer-ae-row` with a colour pair (`data-color-for="edges.stripColor"`, `name="edges.stripColor"`) and a range `name="edges.stripStrength" min="0" max="1" step="0.05"` with `<output data-for="edges.stripStrength">`, copying the Glow row markup. When not `show.strip`: `<p class="dicer-hint">{{localize "DICER.Appearance.Edges.StripNeedsRound"}}</p>`.

Lang (under `DICER.Appearance`): `Edges.Strip` "Edge strips", `Edges.StripColor` "Strip colour", `Edges.StripStrength` "Strength", `Edges.StripNeedsRound` "Edge strips need rounded edges."; new group `Strip`: `body` "Match body", `paint` "Paint", `metal` "Metal", `glow` "Glow".

Summary: `edges` = sharpness label, plus ` · <Strip label>` when the strip is active.

- [ ] **Step 1: Write failing tests**: form round-trip (`appearanceFromForm(formFromAppearance(x)).edges.strip` equals `x`'s for `{ style: 'metal', color: '#c0c0c0', strength: 0.6 }`, and string `'0.6'` strength from an input parses); `visibleSections` strip flags for radius 0 / 0.5 and style body / paint; the rendered editor context has 4 `strips` with `body` active by default and `summary.edges` gains ` · Metal` when active. Follow the existing editor test's render/context helpers (read the file's setup first).
- [ ] **Step 2: Run to verify fail** — `rtk proxy npx vitest run tests/unit/appearance-editor.test.js`.
- [ ] **Step 3: Implement** form, context, template, lang.
- [ ] **Step 4: Run** `rtk proxy npx vitest run tests/unit/appearance-editor.test.js` plus the lang check test (`grep -l lang-check tests/unit`) → PASS.
- [ ] **Step 5: Commit** `feat(ui): edge strip controls in the appearance editor`.

### Task 4: Full verification

- [ ] **Step 1:** `npm run build` → success.
- [ ] **Step 2:** `rtk proxy npx vitest run` → all green, including `tests/unit/build.test.js`. If the world-start ratchet fails, shrink the `appearance.js` additions (e.g. inline `stripActive` usage) before anything else; never raise the budget.
- [ ] **Step 3:** Commit any fixups.
