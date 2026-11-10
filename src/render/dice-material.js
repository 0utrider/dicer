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

/** Body presets (Task 4). marble/pearl and the other metal finishes arrive in Task 5. */
const BODY_PRESETS = {
  opaque: (b, color) => ({ color, roughness: b.roughness, clearcoat: 0.6 }),
  metal: (b, color) => ({ color, metalness: 1, roughness: b.roughness, clearcoat: METAL_COAT }),
  resin: (b, color) => ({
    color, // also tints what little the overlay has behind the die to transmit
    transmission: 0.9,
    thickness: 1.2,
    ior: 1.52,
    attenuationColor: color,
    attenuationDistance: 0.8,
    roughness: b.roughness,
    clearcoat: 1,
  }),
};
/** Bodies without their own preset yet (Task 5) render with this one. */
const PRESET_FALLBACK = { marble: 'opaque', pearl: 'opaque' };

/** Fill PBR: [metalness, roughness, gloss]. */
const FILLS = {
  paint: [0, 0.6, 0],
  gold: [1, 0.3, 0],
  silver: [1, 0.25, 0],
  enamel: [0, 0.15, 1],
};

function patchShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${ENGRAVE_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${ENGRAVE_VERTEX}`);
  const transmission = THREE.ShaderChunk.transmission_fragment.replace(
    'material.transmission = transmission;',
    'material.transmission = transmission * ( 1.0 - dcMask ); // the fill is opaque',
  );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${ENGRAVE_PARS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${ENGRAVE_COLOR}`)
    .replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, uFillPBR.y, dcMask );',
    )
    .replace(
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\n\tmetalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );',
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${ENGRAVE_NORMAL}`,
    )
    .replace(
      '#include <clearcoat_normal_fragment_begin>',
      `#include <clearcoat_normal_fragment_begin>\n${ENGRAVE_CLEARCOAT}`,
    )
    .replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>\n${FILL_GLOSS}`,
    )
    .replace('#include <transmission_fragment>', transmission);
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
  const preset = BODY_PRESETS[body] ?? BODY_PRESETS[PRESET_FALLBACK[body] ?? 'opaque'];
  const material = new THREE.MeshPhysicalMaterial(preset(a.body, new THREE.Color(a.body.color)));

  const [fillMetal, fillRough, fillGloss] = FILLS[a.numbers.fill] ?? FILLS.paint;
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
  };

  // Keep three's own STANDARD/PHYSICAL defines.
  if (f.engraving) material.defines.DICER_ENGRAVE = '';
  material.userData.uniforms = uniforms;
  material.userData.programKey = key;
  material.onBeforeCompile = (shader) => patchShader(shader, uniforms);
  material.customProgramCacheKey = () => `dicer-${key}`;
  return material;
}

/** Rewrites the label texture of a material created by createDiceMaterial, in place. */
export function updateLabels(material, labels, atlas) {
  const tex = material.userData.uniforms.uLabels.value;
  writeLabels(tex.image.data, tex.image.height, labels, atlas);
  tex.needsUpdate = true;
}
