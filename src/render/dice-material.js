import * as THREE from 'three';
import { layoutLabel } from './sdf-atlas.js';
import { normalizeAppearance, programKey } from '../look/appearance.js';
import {
  ENGRAVE_VERTEX_PARS,
  ENGRAVE_VERTEX,
  ENGRAVE_PARS,
  ENGRAVE_COLOR,
  ENGRAVE_NORMAL,
  ENGRAVE_CLEARCOAT,
  FILL_GLOSS,
} from './shaders/engrave.js';
import {
  BODY_VERTEX_PARS,
  BODY_VERTEX,
  RESIN,
  INTERIOR_HOOK,
  VEIN_SCALE,
  bodyChunks,
  bodyDefines,
} from './shaders/bodies.js';
import { interiorChunk, SHAPE_ROT } from './shaders/interior.js';

/**
 * Layered dice material: a MeshPhysicalMaterial built from a layered Appearance (body,
 * numbers, edges, ...) whose shader is assembled from the modules in ./shaders/.
 *
 * One program per programKey (body type, finish, interior, engraving/glow flags, edge
 * style): every colour and numeric look parameter is a uniform or a material property
 * that three uploads as a uniform, never a define.
 */

const TEXELS_PER_FACE = 4;

export const DEFAULT_FLAGS = Object.freeze({
  interiors: true,
  engraving: true,
  glow: true,
  interiorSteps: 32,
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
    roughness: b.roughness,
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
    after('common', `${ENGRAVE_PARS}\n${chunks.pars}`),
    after('color_fragment', `${chunks.colorPre}\n${ENGRAVE_COLOR}\n${chunks.colorPost}`),
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
  ];
  for (const [a, b] of vertex) shader.vertexShader = shader.vertexShader.replace(a, b);
  for (const [a, b] of fragment) shader.fragmentShader = shader.fragmentShader.replace(a, b);
}

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
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createDiceMaterial(appearance, atlas, shape, labels, flags = DEFAULT_FLAGS) {
  const a = normalizeAppearance(appearance);
  const f = { ...DEFAULT_FLAGS, ...flags };
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
  const uniforms = {
    uAtlas: { value: atlas.texture ?? null },
    uLabels: { value: makeLabelTexture(shape, labels, atlas) },
    uAtlasInfo: {
      value: new THREE.Vector3(atlas.distanceRange, atlas.scaleW, atlas.scaleH),
    },
    uFillColor: { value: new THREE.Color(a.numbers.color) },
    uFillPBR: { value: new THREE.Vector2(fillMetal, fillRough) },
    uFillGloss: { value: fillGloss },
    uEngrave: { value: a.numbers.depth },
    uBodyColor2: { value: new THREE.Color(a.body.color2) },
    uVeinScale: { value: VEIN_SCALE },
    uGlowColor: { value: new THREE.Color(a.glow.color) },
    uGlowIntensity: { value: a.glow.intensity },
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
  };

  // Keep three's own STANDARD/PHYSICAL defines.
  if (f.engraving) material.defines.DICER_ENGRAVE = '';
  Object.assign(material.defines, bodyDefines(a, f));
  const chunks = { ...bodyChunks(body, a.body.finish) };
  if (mode === 'march') {
    material.defines.DICER_INTERIOR = '';
    material.defines.DICER_STEPS = f.interiorSteps;
    const interior = interiorChunk(a.interior.type, a.interior.shape);
    chunks.pars = `${chunks.pars}
${interior.pars}`;
    chunks.lighting = chunks.lighting.replace(INTERIOR_HOOK, interior.main);
  }
  material.userData.uniforms = uniforms;
  material.userData.programKey = key;
  material.onBeforeCompile = (shader) => patchShader(shader, uniforms, chunks);
  material.customProgramCacheKey = () => `dicer-${key}`;
  return material;
}

/** Rewrites the label texture of a material created by createDiceMaterial, in place. */
export function updateLabels(material, labels, atlas) {
  const tex = material.userData.uniforms.uLabels.value;
  writeLabels(tex.image.data, tex.image.height, labels, atlas);
  tex.needsUpdate = true;
}
