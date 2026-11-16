import * as THREE from 'three';

function texture(n, alphaAt, rgb) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = rgb;
      data[i + 3] = Math.round(255 * alphaAt(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1));
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** A soft black disc: the contact shadow. */
export const discTexture = () =>
  texture(32, (u, v) => Math.max(0, 1 - Math.hypot(u, v)) ** 2, 0);

/** A white heart (lobes up; a points sprite's row 0 is its bottom), soft-edged: petting's hearts. */
export const heartTexture = () =>
  texture(
    32,
    (u, v) => {
      const x = u * 1.25;
      const y = v * 1.25 + 0.1;
      const f = (x * x + y * y - 1) ** 3 - x * x * y ** 3;
      return Math.max(0, Math.min(1, 0.5 - f * 6));
    },
    255,
  );

/** A white smoke puff: a solid billowy core (three lobes) with a soft rim, for a scorch's smoke. */
export const smokeTexture = () =>
  texture(32, (u, v) => {
    const lobe = (cx, cy, r) => Math.max(0, Math.min(1, (r - Math.hypot(u - cx, v - cy)) / 0.25));
    return Math.max(lobe(0, 0.15, 0.7), lobe(-0.35, -0.2, 0.55), lobe(0.35, -0.25, 0.5));
  }, 255);

/** A soft white disc: a huff's puff. */
export const puffTexture = () => texture(32, (u, v) => Math.max(0, 1 - Math.hypot(u, v)) ** 1.5, 255);

/** A white four-pointed twinkle: a small round core and two thin arms. */
export const starTexture = () =>
  texture(
    32,
    (u, v) => {
      const core = Math.max(0, 1 - Math.hypot(u, v) * 2.2) ** 2;
      const arm = (a, b) => Math.max(0, 1 - Math.abs(a) * 10) * Math.max(0, 1 - Math.abs(b)) ** 2;
      return Math.min(1, core + 0.9 * (arm(u, v) + arm(v, u)));
    },
    255,
  );
