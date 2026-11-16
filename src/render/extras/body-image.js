import * as THREE from 'three';

/**
 * Body image (look-extras chunk): a picture on the die's body (appearance.bodyImage), not on its
 * numbers. Wrap projects it from three sides of the die (die-local position, weighted sharply by
 * the face direction so slanted faces do not ghost); face puts it on every face in that face's own
 * coordinates (bevels fall back to wrap). It is mixed into the body colour after the body's own
 * pattern (marble veins, wood grain: colorPre) and never over the numbers (1 - dcMask). On resin
 * the body colour is the glass's absorption, so the picture shows like stained glass.
 * The texture comes from bodyImages (one per url, refcounted), loaded by DiceBox and the
 * thumbnailer; a material is only patched once it is in (createDiceMaterial's bodyTex).
 */

const PARS = /* glsl */ `
uniform sampler2D uBodyImage;
uniform vec4 uBodyImageMap; // x: 1 each face, 0 wrap; y: scale; z: rotation (rad); w: blend
uniform float uBodyImageTint; // 1: multiplied by the body colour
vec4 dcBodyImageAt( vec2 uv ) {
	float c = cos( uBodyImageMap.z );
	float s = sin( uBodyImageMap.z );
	return texture2D( uBodyImage, mat2( c, - s, s, c ) * uv / uBodyImageMap.y + 0.5 );
}
`;

const COLOR = /* glsl */ `
#ifdef DICER_BODY_IMAGE
	{
		vec4 dcBi;
		if ( uBodyImageMap.x > 0.5 && vFaceId > - 0.5 ) {
			dcBi = dcBodyImageAt( vFaceUV * 0.5 ); // the inradius-1 face over the image
		} else {
			vec3 dcBw = pow( abs( normalize( cross( dFdx( vLocalPos ), dFdy( vLocalPos ) ) ) ), vec3( 4.0 ) );
			dcBw /= dcBw.x + dcBw.y + dcBw.z + 1e-5;
			vec3 dcBp = vLocalPos * 0.5;
			dcBi = dcBodyImageAt( dcBp.yz ) * dcBw.x + dcBodyImageAt( dcBp.xz ) * dcBw.y + dcBodyImageAt( dcBp.xy ) * dcBw.z;
		}
		vec3 dcBc = uBodyImageTint > 0.5 ? dcBi.rgb * diffuseColor.rgb : dcBi.rgb;
		diffuseColor.rgb = mix( diffuseColor.rgb, dcBc, uBodyImageMap.w * dcBi.a * ( 1.0 - dcMask ) );
	}
#endif
`;

/** The patch for a look with a body image whose texture is loaded (ctx.bodyTex); {} otherwise. */
export function bodyImagePatch(a, ctx) {
  const im = a.bodyImage;
  const texture = ctx?.bodyTex?.texture;
  if (!im || !texture) return {};
  return {
    defines: { DICER_BODY_IMAGE: '' },
    uniforms: {
      uBodyImage: { value: texture },
      uBodyImageMap: {
        value: new THREE.Vector4(im.mode === 'face' ? 1 : 0, im.scale, (im.rotation * Math.PI) / 180, im.blend),
      },
      uBodyImageTint: { value: im.tint ? 1 : 0 },
    },
    chunks: { pars: PARS, colorPost: COLOR },
  };
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
    return Promise.race([Promise.resolve().then(() => loadImage(url)), timeout])
      .then((img) => {
        const texture = new THREE.Texture(img);
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
