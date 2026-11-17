import * as THREE from 'three';
import { layoutLabel } from './sdf-atlas.js';
import { normalizeAppearance, programKey, needsLookExtras, fallbackLook } from '../look/appearance.js';
import { getLookExtras, requestLookExtras, warnLookExtras } from './extras-loader.js';
import { readableNumbers } from '../look/contrast.js';
import {
  ENGRAVE_VERTEX_PARS,
  ENGRAVE_VERTEX,
  ENGRAVE_PARS,
  ENGRAVE_COLOR,
  ENGRAVE_NORMAL,
  ENGRAVE_CLEARCOAT,
  FILL_GLOSS,
  FACE_LAYER_PARS,
  FACE_LAYER_COLOR,
  MAX_FACE_LAYERS,
  DECAL_OPAQUE,
  WEIGHT_SHIFT,
} from './shaders/engrave.js';
import {
  BODY_VERTEX_PARS,
  BODY_VERTEX,
  RESIN,
  INTERIOR_HOOK,
  VEIN_SCALE,
  FX_PARS,
  FX_COLOR,
  FX_EMISSIVE,
  bodyChunks,
  bodyDefines,
} from './shaders/bodies.js';
import { interiorChunk, SHAPE_ROT } from './shaders/interior.js';

/**
 * Layered dice material: a MeshPhysicalMaterial built from a layered Appearance (body,
 * numbers, edges, ...) whose shader is assembled from the modules in ./shaders/.
 *
 * One program per programKey (body type, finish, interior, engraving/glow/safe flags):
 * every colour and numeric look parameter is a uniform or a material property
 * that three uploads as a uniform, never a define.
 */

const TEXELS_PER_FACE = 4;

export const DEFAULT_FLAGS = Object.freeze({
  interiors: true,
  engraving: true,
  glow: true,
  effects: true,
  interiorSteps: 32,
  safe: false,
  insideMotion: true,
});

/**
 * Metal is uncoated, but every dice program compiles the clearcoat lobe so an enamel fill
 * can gloss (FILL_GLOSS); three only defines USE_CLEARCOAT when clearcoat > 0.
 */
const METAL_COAT = 0.001;

/**
 * Body presets: MeshPhysicalMaterial parameters per body type (b: normalized body; color,
 * color2: THREE.Color). The shader side of each body lives in ./shaders/bodies.js.
 * P2-R8: every body honours b.roughness (the curated looks carry the per-finish values).
 */
const BODY_PRESETS = {
  opaque: (b, color) => ({ color, roughness: b.roughness, clearcoat: 0.6 }),
  metal: (b, color) => ({
    color,
    metalness: 1,
    roughness: b.finish === 'mirror' ? 0.02 : b.roughness, // a mirror finish: polished flawless
    clearcoat: METAL_COAT,
    anisotropy: b.finish === 'brushed' ? 0.8 : 0,
  }),
  // P2-R6: environment refraction (DICER_RESIN), no transmission pass. Opaque in the
  // depth/blend sense: the body reads as clear through the refracted environment alone.
  resin: (b, color) => ({
    color,
    ior: RESIN.ior,
    roughness: b.roughness,
    clearcoat: 1,
    clearcoatRoughness: RESIN.coatRoughness,
  }),
  marble: (b, color) => ({
    color,
    roughness: b.roughness,
    clearcoat: 0.4,
    sheen: 0.4,
    sheenColor: color,
  }),
  pearl: (b, color, color2) => ({
    color,
    roughness: b.roughness,
    clearcoat: 1,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 650],
    sheen: 0.6,
    sheenColor: color2,
  }),
};

/** Die-local resin body ellipsoid: the radius-0.85 sphere, flattened to the coin's caps. */
function resinRadii(shape) {
  return shape?.kind === 'coin'
    ? new THREE.Vector3(0.95, 0.125, 0.95)
    : new THREE.Vector3(RESIN.radius, RESIN.radius, RESIN.radius);
}

/**
 * Key light direction for the interior sparkle (uKeyLightDir, world space, towards the
 * light): the studio key strip at (-6, 4, 2) aimed at the origin. DiceBox may later update it
 * from the scene's key light.
 */
export const KEY_LIGHT_DIR = Object.freeze([-6, 4, 2].map((v) => v / Math.hypot(-6, 4, 2)));

/**
 * Share of colors[0] mixed into the resin body colour by the low-tier interior fake, per
 * interior type: sparse glitter and a single small shape barely tint the body (a dark Void
 * Star must not turn olive); clouds and liquids fill it.
 */
export const INTERIOR_TINT = Object.freeze({
  glitter: 0.1,
  shape: 0.2,
  nebula: 0.45,
  liquid: 0.45,
  swirl: 0.45,
});

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * The low-tier tint target: colors[0]'s hue at the body colour's luminance (linear). The fake
 * shifts the body's hue towards the interior without lifting a dark body: a near-black resin
 * with a gold star would otherwise turn olive.
 */
function tintTarget(c0, body) {
  const l = luminance(c0);
  return l > 0 ? c0.clone().multiplyScalar(luminance(body) / l) : body.clone();
}

/**
 * P2-R1: the interior is marched only for a resin body with flags.interiors, steps > 0 and a
 * type. 'fake': the same, but steps 0 (low tier): no march, the body is tinted instead.
 */
function interiorMode(a, f) {
  if (a.body.type !== 'resin' || !f.interiors || a.interior.type === 'none') return 'none';
  return f.interiorSteps > 0 ? 'march' : 'fake';
}

/** Fill PBR: [metalness, roughness, gloss]. */
const FILLS = {
  paint: [0, 0.6, 0],
  gold: [1, 0.3, 0],
  silver: [1, 0.25, 0],
  enamel: [0, 0.15, 1],
};

const after = (anchor, code) => [`#include <${anchor}>`, `#include <${anchor}>\n${code}`];

function patchShader(shader, uniforms, chunks) {
  Object.assign(shader.uniforms, uniforms);
  const vertex = [
    after('common', `${ENGRAVE_VERTEX_PARS}\n${BODY_VERTEX_PARS}`),
    after('begin_vertex', `${ENGRAVE_VERTEX}\n${BODY_VERTEX}`),
  ];
  const fragment = [
    after('common', `${ENGRAVE_PARS}${chunks.facePars ?? ''}\n${chunks.pars}`),
    after(
      'color_fragment',
      `${chunks.colorPre}\n${ENGRAVE_COLOR}${chunks.faceColor ?? ''}\n${chunks.colorPost}`,
    ),
    after(
      'roughnessmap_fragment',
      `${chunks.roughness}\n\troughnessFactor = mix( roughnessFactor, uFillPBR.y, dcMask );`,
    ),
    after(
      'metalnessmap_fragment',
      '\tmetalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );',
    ),
    after('normal_fragment_begin', chunks.tangent),
    after('normal_fragment_maps', `${ENGRAVE_NORMAL}\n${chunks.normal}`),
    after('clearcoat_normal_fragment_begin', ENGRAVE_CLEARCOAT),
    after('emissivemap_fragment', chunks.emissive),
    after(
      'lights_physical_fragment',
      `${FILL_GLOSS}
${chunks.coat}`,
    ),
    after('transmission_fragment', chunks.lighting),
    // Last: the look-extras line replacements, on the assembled fragment shader.
    ...(chunks.replace ?? []),
  ];
  for (const [a, b] of vertex) shader.vertexShader = shader.vertexShader.replace(a, b);
  for (const [a, b] of fragment) shader.fragmentShader = shader.fragmentShader.replace(a, b);
}

let extrasFailed = false;

function faceCountOf(shape, labels) {
  return Math.max(1, shape.faces?.length ?? 0, labels?.length ?? 0);
}

function writeLabels(data, faceCount, labels, atlas) {
  data.fill(0);
  const n = Math.min(faceCount, labels.length);
  for (let f = 0; f < n; f++) data.set(layoutLabel(labels[f], atlas), f * TEXELS_PER_FACE * 4);
}

function makeLabelTexture(shape, labels, atlas) {
  const faceCount = faceCountOf(shape, labels);
  const data = new Float32Array(faceCount * TEXELS_PER_FACE * 4);
  writeLabels(data, faceCount, labels, atlas);
  const tex = new THREE.DataTexture(
    data,
    TEXELS_PER_FACE,
    faceCount,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {object} appearance layered Appearance (normalized here, so a partial or a legacy
 *   Plan 1 flat appearance works too)
 * @param {object} atlas from loadDigitAtlas() (parseAtlas() fields + texture)
 * @param {object} shape ShapeDef from getShape()
 * @param {string[]} labels one label per face (labelFor())
 * @param {{interiors?: boolean, engraving?: boolean, glow?: boolean, interiorSteps?: number}}
 *   [flags] feature flags (quality tier and client settings); missing keys default to on
 * @param {{texture: THREE.DataArrayTexture|null, layers: Int16Array, tint?: Uint8Array}}
 *   [faceTex] rasterized faces (face-textures.js acquire()): layers[i] >= 0 draws face i from
 *   that layer instead of the MSDF label (pass '' as its label). Without a texture the
 *   program is the plain one.
 * @param {{texture: THREE.Texture}} [bodyTex] the look's body image, loaded (bodyImages.acquire in
 *   the look-extras chunk); without it a look with a body image draws its plain body.
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createDiceMaterial(
  appearance,
  atlas,
  shape,
  labels,
  flags = DEFAULT_FLAGS,
  faceTex = null,
  bodyTex = null,
) {
  let a = normalizeAppearance(appearance);
  let f = { ...DEFAULT_FLAGS, ...flags };
  if (f.safe) {
    // P2-R12: plain opaque MeshPhysicalMaterial with the look's body colour and roughness; no
    // Dicer body chunk (resin refraction, border, marble, pearl, brushed/antique), no
    // interior, glow or engraving recess. The label colour mask stays so numbers read.
    a = { ...a, body: { ...a.body, type: 'opaque' }, interior: { ...a.interior, type: 'none' } };
    f = {
      ...f,
      interiors: false,
      engraving: false,
      glow: false,
      effects: false,
      interiorSteps: 0,
      safe: true,
    };
  }
  // The lazy look-extras chunk: its fallback look until it lands (and always under safe flags).
  // A marched inside with insideMotion needs it too (its motion uniforms); without the chunk the
  // die draws today's still inside, keyed with motion off.
  let p;
  const x = getLookExtras();
  if (needsLookExtras(a) || (f.insideMotion && interiorMode(a, f) === 'march')) {
    if (!x) requestLookExtras();
    else if (!f.safe) {
      try {
        p = x.patchMaterial(a, f, { shape, labels, atlas, bodyTex });
      } catch (err) {
        extrasFailed ||= !warnLookExtras(err); // warns once (warnLookExtras returns undefined)
      }
    }
  }
  if (!p) {
    a = fallbackLook(a); // a itself for a look without the new options
    p = {};
    f.insideMotion = false;
  }
  labels = p.labels ?? labels;
  atlas = p.atlas ?? atlas;
  const key = programKey(a, f);

  const body = a.body.type;
  const preset = BODY_PRESETS[body] ?? BODY_PRESETS.opaque;
  const material = new THREE.MeshPhysicalMaterial(
    preset(a.body, new THREE.Color(a.body.color), new THREE.Color(a.body.color2)),
  );

  const [fillMetal, fillRough, fillGloss] = FILLS[a.numbers.fill] ?? FILLS.paint;
  const mode = interiorMode(a, f);
  const c0 = new THREE.Color(a.interior.colors[0]);
  const tint = tintTarget(c0, new THREE.Color(a.body.color));
  // Numbers readable against the die's own colour (look/contrast.js): unchanged when they read.
  const readable = readableNumbers(a);
  const uniforms = {
    uAtlas: { value: atlas.texture ?? null },
    uLabels: { value: makeLabelTexture(shape, labels, atlas) },
    uAtlasInfo: {
      value: new THREE.Vector3(atlas.distanceRange, atlas.scaleW, atlas.scaleH),
    },
    uFillColor: { value: new THREE.Color(readable.fill) },
    uFillPBR: { value: new THREE.Vector2(fillMetal, fillRough) },
    uFillGloss: { value: fillGloss },
    uEngrave: { value: a.numbers.depth },
    uNum: { value: new THREE.Vector2(a.numbers.size, a.numbers.weight * WEIGHT_SHIFT) },
    uBodyColor2: { value: new THREE.Color(a.body.color2) },
    uVeinScale: { value: VEIN_SCALE },
    uGlowColor: { value: new THREE.Color(a.glow.color) },
    uGlowIntensity: { value: readable.glow },
    uResinDensity: { value: shape?.kind === 'coin' ? RESIN.coinDensity : 1.0 },
    uResinFloor: { value: RESIN.floor },
    uResinRadii: { value: resinRadii(shape) },
    uResinTint: {
      value: new THREE.Vector4(
        tint.r,
        tint.g,
        tint.b,
        mode === 'fake' ? (INTERIOR_TINT[a.interior.type] ?? 0) : 0,
      ),
    },
    uInteriorColors: { value: [c0, new THREE.Color(a.interior.colors[1])] },
    uInteriorDensity: { value: a.interior.density },
    uKeyLightDir: { value: new THREE.Vector3(...KEY_LIGHT_DIR) },
    uShapeRot: {
      value: new THREE.Matrix3().fromArray(shape?.kind === 'coin' ? SHAPE_ROT.coin : SHAPE_ROT.die),
    },
    // Trigger effects (die-effects.js) write these on an isolated material; read only in fx1
    // programs, always present so an effect never needs to check.
    uFxTint: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFxFlare: { value: new THREE.Vector3(0, 0, 0) },
  };

  // Keep three's own STANDARD/PHYSICAL defines.
  if (f.engraving) material.defines.DICER_ENGRAVE = '';
  Object.assign(material.defines, bodyDefines(a, f));
  const chunks = { ...bodyChunks(body, a.body.finish) };
  if (f.effects) {
    chunks.pars = `${chunks.pars}
${FX_PARS}`;
    chunks.emissive = `${chunks.emissive}
${FX_EMISSIVE}`;
  }
  if (mode === 'march') {
    material.defines.DICER_INTERIOR = '';
    material.defines.DICER_STEPS = f.interiorSteps;
    const interior = p.interior ?? interiorChunk(a.interior.type, a.interior.shape);
    chunks.pars = `${chunks.pars}
${interior.pars}`;
    chunks.lighting = chunks.lighting.replace(INTERIOR_HOOK, interior.main);
  }
  Object.assign(material.defines, p.defines);
  Object.assign(uniforms, p.uniforms);
  if (p.params) material.setValues(p.params);
  for (const k in p.chunks) chunks[k] += `\n${p.chunks[k]}`;
  // The colour-shift tint runs after the extras' colour code (patina / worn) so it tints their result.
  if (f.effects) {
    chunks.colorPost = `${chunks.colorPost}
${FX_COLOR}`;
  }
  chunks.replace = p.replace;
  // Face layers: a define and a cache-key suffix; appearance.programKey stays pure.
  let cacheKey = key;
  if (faceTex?.texture) {
    material.defines.DICER_FACE_LAYERS = '';
    uniforms.uFaceTex = { value: faceTex.texture };
    uniforms.uFaceLayer = { value: faceLayerUniform(faceTex) };
    chunks.facePars = FACE_LAYER_PARS;
    chunks.faceColor = FACE_LAYER_COLOR;
    for (const [k, code] of Object.entries(chunks)) {
      if (typeof code !== 'string') continue;
      chunks[k] = DECAL_OPAQUE.reduce((c, [from, to]) => c.replaceAll(from, to), code);
    }
    cacheKey = `${key}|fl1`;
  }
  // Body image: its define comes from the patch only once the texture is in; the key follows it.
  if (p.defines?.DICER_BODY_IMAGE !== undefined) cacheKey = `${cacheKey}|bi1`;
  material.userData.uniforms = uniforms;
  material.userData.programKey = cacheKey;
  // The material's own uniforms: an isolated clone (isolateMaterial) binds its copies.
  material.onBeforeCompile = function (shader) {
    patchShader(shader, this?.userData?.uniforms ?? uniforms, chunks);
  };
  material.customProgramCacheKey = () => `dicer-${cacheKey}`;
  return material;
}

/** A uniform value copy: textures are shared (never copied), vectors/colours/matrices cloned. */
function copyValue(v) {
  if (Array.isArray(v)) return v.map(copyValue);
  if (v && typeof v === 'object' && !v.isTexture && typeof v.clone === 'function') return v.clone();
  return v;
}

/**
 * A clone of a die material with its own copies of userData.uniforms, for one die whose
 * uniforms an effect writes (DiceBox.isolate). Unlike cloneForFade (which shares userData),
 * nothing it writes reaches the dice sharing the original. Same program (cache key, defines,
 * compile patch, which binds the clone's uniforms through `this`). Textures stay shared: dispose
 * the clone with material.dispose() only, never its label texture.
 */
export function isolateMaterial(material) {
  const userData = material.userData;
  material.userData = {};
  let clone;
  try {
    clone = material.clone();
  } finally {
    material.userData = userData;
  }
  const uniforms = {};
  for (const [k, u] of Object.entries(userData.uniforms ?? {})) uniforms[k] = { value: copyValue(u.value) };
  clone.userData = { ...userData, uniforms, isolated: true };
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  clone.defines = { ...material.defines };
  return clone;
}

/**
 * Chains a third-party shader hook (a DiceSystem's beforeShaderCompile) after Dicer's own
 * patch, and keys the program by `systemId` and `cacheString` too so three never shares it
 * with a plain Dicer program or another system's. A throwing hook is reported through onError and its changes to the shader
 * are undone: the program compiles as Dicer's own.
 */
export function chainShaderHook(material, systemId, cacheString, hook, onError) {
  const dicerPatch = material.onBeforeCompile;
  const key = material.userData.programKey;
  material.onBeforeCompile = function (shader, renderer) {
    dicerPatch.call(this, shader, renderer);
    const { vertexShader, fragmentShader } = shader;
    const uniforms = shader.uniforms && { ...shader.uniforms };
    const defines = shader.defines && { ...shader.defines };
    try {
      hook(shader, this);
    } catch (err) {
      shader.vertexShader = vertexShader;
      shader.fragmentShader = fragmentShader;
      restoreEntries(shader.uniforms, uniforms);
      restoreEntries(shader.defines, defines);
      onError(err);
    }
  };
  // The system id too: two systems' getCacheString may agree while their hooks differ.
  material.customProgramCacheKey = () => `sys:${systemId}|${cacheString}|dicer-${key}`;
}

/** Puts `target`'s entries back to `saved` in place (the object may be shared with three). */
function restoreEntries(target, saved) {
  if (!target || !saved) return;
  for (const k of Object.keys(target)) if (!(k in saved)) delete target[k];
  Object.assign(target, saved);
}

/** uFaceLayer: per face (layer, 1 = tinted text mask); unused slots (-1, 0). */
function faceLayerUniform({ layers, tint }) {
  return Array.from({ length: MAX_FACE_LAYERS }, (_, i) => {
    const layer = i < (layers?.length ?? 0) ? layers[i] : -1;
    return new THREE.Vector2(layer, layer >= 0 && tint?.[i] ? 1 : 0);
  });
}

/** Rewrites the label texture of a material created by createDiceMaterial, in place. */
export function updateLabels(material, labels, atlas) {
  const tex = material.userData.uniforms.uLabels.value;
  writeLabels(tex.image.data, tex.image.height, labels, atlas);
  tex.needsUpdate = true;
}
