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
