import * as THREE from 'three';
import { splitCrop, cropImage } from '../image-crop.js';
import { addonTextures, normalFor } from './addon-textures.js';

/**
 * Body image (look-extras chunk): a picture on the die's body (appearance.bodyImage), not on its
 * numbers. Wrap projects it from three sides of the die (die-local position, weighted sharply by
 * the face direction so slanted faces do not ghost); face puts it on every face the way Dice So
 * Nice lays a texture on a face (FACE_FIT, measured from its baked dice), so a module's texture art
 * fits the face as its author drew it (bevels fall back to wrap). It is mixed into the body colour after the body's own
 * pattern (marble veins, wood grain: colorPre) and never over the numbers (1 - dcMask). On resin
 * the covered part is a lit print on the surface (LIGHTING): the refraction is replaced by the
 * ordinary diffuse light of the image there, so dark glass cannot swallow the art.
 * The texture comes from bodyImages (one per url, refcounted), loaded by DiceBox and the
 * thumbnailer; a material is only patched once it is in (createDiceMaterial's bodyTex).
 */

/** Most faces of any die (the d20): the per-face rotation array's length. */

const MAX_FACES = 20;

const PARS = /* glsl */ `
uniform sampler2D uBodyImage;
uniform vec4 uBodyImageMap; // x: 1 each face, 0 wrap; y: scale; z: rotation (rad); w: blend
uniform float uBodyImageTint; // 1: multiplied by the body colour
uniform vec3 uBodyImageFit; // each face: inradius in image units, face centre in the image (x right, y down)
uniform float uBodyImageRot[ ${MAX_FACES} ]; // each face: the turn that puts its "up" (FACE_FIT) at the top
// uv: centred image coordinates (y up); the user's rotation and scale turn and zoom about the centre
vec2 dcBodyUv( vec2 uv ) {
	float c = cos( uBodyImageMap.z );
	float s = sin( uBodyImageMap.z );
	return mat2( c, - s, s, c ) * uv / uBodyImageMap.y + 0.5;
}
vec4 dcBodyImageAt( vec2 uv ) {
	return texture2D( uBodyImage, dcBodyUv( uv ) );
}
#ifdef DICER_BODY_RELIEF
uniform sampler2D uBodyNormal; // the texture's bump map as a normal map (addon-textures.js)
vec2 dcBodyNUv = vec2( 0.0 ); // where the image is read (each face); 0 coverage: no relief
float dcBodyNOn = 0.0;
// three's perturbNormal2Arb: the tangent frame from the screen slopes of position and uv
vec3 dcBodyNormal( vec3 eye, vec3 n, vec2 uv, vec3 mapN, float faceDir ) {
	vec3 q0 = dFdx( eye );
	vec3 q1 = dFdy( eye );
	vec2 st0 = dFdx( uv );
	vec2 st1 = dFdy( uv );
	vec3 q1p = cross( q1, n );
	vec3 q0p = cross( n, q0 );
	vec3 T = q1p * st0.x + q0p * st1.x;
	vec3 B = q1p * st0.y + q0p * st1.y;
	float det = max( dot( T, T ), dot( B, B ) );
	float k = det == 0.0 ? 0.0 : faceDir * inversesqrt( det );
	return normalize( T * ( mapN.x * k ) + B * ( mapN.y * k ) + mapN.z * n );
}
#endif
`;

const COLOR = /* glsl */ `
#ifdef DICER_BODY_IMAGE
	float dcBodyPrint = 0.0; // how much of this fragment the image covers (resin: LIGHTING)
	{
		vec4 dcBi;
		if ( uBodyImageMap.x > 0.5 && vFaceId > - 0.5 ) {
			float dcBr = uBodyImageRot[ clamp( int( floor( vFaceId + 0.5 ) ), 0, ${MAX_FACES - 1} ) ];
			vec2 dcBq = mat2( cos( dcBr ), sin( dcBr ), - sin( dcBr ), cos( dcBr ) ) * vFaceUV;
			vec2 dcBu = vec2( uBodyImageFit.y - 0.5, 0.5 - uBodyImageFit.z ) + uBodyImageFit.x * dcBq;
			dcBi = dcBodyImageAt( dcBu );
			#ifdef DICER_BODY_RELIEF
			dcBodyNUv = dcBodyUv( dcBu );
			dcBodyNOn = 1.0;
			#endif
		} else {
			vec3 dcBw = pow( abs( normalize( cross( dFdx( vLocalPos ), dFdy( vLocalPos ) ) ) ), vec3( 4.0 ) );
			dcBw /= dcBw.x + dcBw.y + dcBw.z + 1e-5;
			vec3 dcBp = vLocalPos * 0.5;
			dcBi = dcBodyImageAt( dcBp.yz ) * dcBw.x + dcBodyImageAt( dcBp.xz ) * dcBw.y + dcBodyImageAt( dcBp.xy ) * dcBw.z;
		}
		vec3 dcBc = uBodyImageTint > 0.5 ? dcBi.rgb * diffuseColor.rgb : dcBi.rgb;
		dcBodyPrint = uBodyImageMap.w * dcBi.a * ( 1.0 - dcMask );
		diffuseColor.rgb = mix( diffuseColor.rgb, dcBc, dcBodyPrint );
		#ifdef DICER_ADDON_METAL
		// Dice So Nice lights its metal twice as strongly (envMapIntensity 2); Dicer's dice take
		// the scene's environment, so the metal's colour (its reflectance) doubles instead
		diffuseColor.rgb = mix( diffuseColor.rgb, min( diffuseColor.rgb * 2.0, vec3( 1.0 ) ), dcBodyPrint );
		#endif
		#ifdef DICER_BODY_RELIEF
		dcBodyNOn *= dcBodyPrint; // never under the numbers
		#endif
	}
#endif
`;

/** After the normal maps: the texture's bump map, as Dice So Nice lays it on each face. */
const NORMAL = /* glsl */ `
#ifdef DICER_BODY_RELIEF
	{
		vec3 dcBn = dcBodyNormal( - vViewPosition, normal, dcBodyNUv, texture2D( uBodyNormal, dcBodyNUv ).xyz * 2.0 - 1.0, faceDirection );
		normal = normalize( mix( normal, dcBn, dcBodyNOn ) );
	}
#endif
`;

/** After the resin refraction (transmission_fragment): the covered part is lit as a surface print. */
const LIGHTING = /* glsl */ `
#if defined( DICER_BODY_IMAGE ) && defined( DICER_RESIN )
	totalDiffuse = mix( totalDiffuse, reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, dcBodyPrint );
#endif
`;

/**
 * How Dice So Nice lays a texture on one face of each die (measured from its baked dice, version
 * 6.4.5): [inradius in image units, the face centre's y in the image (y down; x is 0.5)]. Its
 * "up" is a vertex on triangles and pentagons, an edge on the square, the sharp pole on the d10's
 * kite. Other shapes fit the face's outer circle in the image, centred.
 */
export const FACE_FIT = Object.freeze({
  d4: [0.284, 0.567],
  d6: [0.489, 0.5],
  d8: [0.267, 0.537],
  d10: [0.269, 0.626],
  d12: [0.418, 0.521],
  d20: [0.288, 0.577],
});

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((x) => x / l);
};

/**
 * Each face's turn, in Dicer's face frame (chamfer.js: V towards the first vertex or labelUp, U =
 * V x n), from V to the face's "up": a regular odd face keeps V (a vertex), a regular even face
 * turns to an edge's middle, any other face to its farthest vertex (the d10 kite's sharp pole).
 * And the fit: FACE_FIT for the die type, else the face's outer circle in the image.
 */
export function faceFit(shape) {
  const rot = new Float32Array(MAX_FACES);
  let outer = 1;
  (shape?.faces ?? []).slice(0, MAX_FACES).forEach((f, i) => {
    const pts = f.map((vi) => shape.vertices[vi]);
    const c = pts.reduce((s, p) => s.map((x, k) => x + p[k] / pts.length), [0, 0, 0]);
    let n = [0, 0, 0];
    pts.forEach((p, j) => (n = n.map((x, k) => x + cross(p, pts[(j + 1) % pts.length])[k])));
    n = unit(n);
    const plane = (v) => unit(sub(v, n.map((x) => x * dot(v, n))));
    const v = plane(shape.labelUp ?? sub(pts[0], c));
    const u = cross(v, n);
    const dist = pts.map((p) => Math.hypot(...sub(p, c)));
    const regular = Math.max(...dist) - Math.min(...dist) < 1e-3 * Math.max(...dist);
    let up;
    if (regular && pts.length % 2 === 1) up = v;
    else if (regular) up = plane(sub(pts[0].map((x, k) => (x + pts[1][k]) / 2), c));
    else up = plane(sub(pts[dist.indexOf(Math.max(...dist))], c));
    rot[i] = Math.atan2(dot(up, u), dot(up, v));
    // the outer circle in inradius units (the inradius: the nearest edge line)
    const r = Math.min(...pts.map((p, j) => Math.hypot(...cross(sub(pts[(j + 1) % pts.length], p), sub(c, p))) / Math.hypot(...sub(pts[(j + 1) % pts.length], p))));
    outer = Math.max(outer, Math.max(...dist) / r);
  });
  const fit = FACE_FIT[shape?.type] ?? [0.5 / outer, 0.5];
  return { fit: new THREE.Vector3(fit[0], 0.5, fit[1]), rot };
}

/** The patch for a look with a body image whose texture is loaded (ctx.bodyTex); {} otherwise. */
export function bodyImagePatch(a, ctx) {
  const im = a.bodyImage;
  const texture = ctx?.bodyTex?.texture;
  if (!im || !texture) return {};
  // A Dice So Nice add-on's texture: its bump map as a normal map, on each face (once built); on
  // metal, Dice So Nice's stronger reflections (DICER_ADDON_METAL).
  const addon = addonTextures.get(im.src);
  const normal = im.mode === 'face' ? normalFor(im.src) : null;
  const relief = !!normal;
  return {
    defines: {
      DICER_BODY_IMAGE: '',
      ...(relief && { DICER_BODY_RELIEF: '' }),
      ...(addon !== undefined && a.body.type === 'metal' && { DICER_ADDON_METAL: '' }),
    },
    uniforms: {
      ...(relief && { uBodyNormal: { value: normal } }),
      uBodyImage: { value: texture },
      uBodyImageMap: {
        value: new THREE.Vector4(im.mode === 'face' ? 1 : 0, im.scale, (im.rotation * Math.PI) / 180, im.blend),
      },
      uBodyImageTint: { value: im.tint ? 1 : 0 },
      ...(im.mode === 'face' ? faceUniforms(ctx.shape) : { uBodyImageFit: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uBodyImageRot: { value: new Float32Array(MAX_FACES) } }),
    },
    chunks: { pars: PARS, colorPost: COLOR, lighting: LIGHTING, ...(relief && { normal: NORMAL }) },
  };
}

function faceUniforms(shape) {
  const { fit, rot } = faceFit(shape);
  return { uBodyImageFit: { value: fit }, uBodyImageRot: { value: rot } };
}

function defaultLoadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

/**
 * Body image textures, one per url, refcounted. acquire(url) -> Promise<{texture}|null> (null:
 * the image failed or timed out; the die keeps its plain body, one warning per url); release(url)
 * disposes the texture once nobody holds it.
 */
export function createBodyImages({ loadImage = defaultLoadImage, timeoutMs = 4000, warn = console.warn } = {}) {
  const cache = new Map(); // url -> { refs, promise }
  const warned = new Set();
  function build(url) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${url} timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    const { src, crop } = splitCrop(url); // an atlas frame: its sheet, cropped
    return Promise.race([Promise.resolve().then(() => loadImage(src)), timeout])
      .then((img) => {
        const texture = new THREE.Texture(crop ? cropImage(img, crop) : img);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return { texture };
      })
      .catch((err) => {
        if (!warned.has(url)) {
          warned.add(url);
          warn(`dicer: cannot use body image ${url}; the die keeps its plain body`, err);
        }
        return null;
      })
      .finally(() => clearTimeout(timer));
  }
  return {
    acquire(url) {
      let entry = cache.get(url);
      if (!entry) {
        entry = { refs: 0 };
        entry.promise = build(url).then((r) => {
          if (cache.get(url) !== entry) r?.texture.dispose(); // released while loading
          return r;
        });
        cache.set(url, entry);
      }
      entry.refs++;
      return entry.promise;
    },
    release(url) {
      const entry = cache.get(url);
      if (!entry || --entry.refs > 0) return;
      cache.delete(url);
      entry.promise.then((r) => r?.texture.dispose());
    },
    get size() {
      return cache.size;
    },
  };
}

/** The chunk's shared cache: DiceBox's rolls and every thumbnailer use it. */
export const bodyImages = createBodyImages();
