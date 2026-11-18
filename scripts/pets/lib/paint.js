import * as THREE from 'three';
import { clamp, len, norm, sub } from './math.js';

export { band, fbm, vnoise, hash, lerp3, srgb } from './math.js';

/**
 * Painting the texture from 3D. Each shell texel knows its surface point (interpolated from the
 * triangle that covers it in UV space), so a painter is a function of position:
 *
 *   const canvas = createCanvas(1024);
 *   paintShell(canvas, buf, shellTris, (p, n, ao, out) => write(out, [0.8, 0.8, 0.8], 1));
 *   paintRect(canvas, atlas, rectId, (u, v, out) => write(out, pink, 0));
 *   dilate(canvas, 6);
 *   const map = toTexture(canvas, 'cat_basecolor');
 *
 * Convention (the tint mask): RGB is the colour; ALPHA is 1 (255) where Dicer multiplies by the
 * player's colour (paint those areas a neutral light grey with darker detail) and 0 where the
 * painted colour stays (eyes, noses, mouths, claws, cream bellies...). Untinted texels keep their
 * RGB even at alpha 0 (see export.js for why that needs care).
 */

/** An empty RGBA canvas of N x N texels. */
export function createCanvas(N) {
  return { N, data: new Uint8Array(N * N * 4), best: new Float32Array(N * N).fill(-Infinity) };
}

/** Writes colour c (0..1 sRGB) and alpha a (the tint mask, 0..1) into the 4-byte `out`. */
export function write(out, c, a) {
  out[0] = clamp(Math.round(c[0] * 255), 0, 255);
  out[1] = clamp(Math.round(c[1] * 255), 0, 255);
  out[2] = clamp(Math.round(c[2] * 255), 0, 255);
  out[3] = clamp(Math.round(a * 255), 0, 255);
}

/**
 * Rasterises shell triangles in UV space and paints each texel from its 3D point.
 * @param {object} canvas createCanvas()
 * @param {object} buf the MeshBuffer (uv per vertex)
 * @param {number[][]} tris triangles as buffer vertex ids
 * @param {(p:number[], n:number[], ao:number, out:number[]) => void} painter
 * @param {{pos:(i:number)=>number[], nor:(i:number)=>number[], ao:(i:number)=>number}} src per
 *   buffer vertex: the paint position (model, before fitting), normal and occlusion
 */
export function paintShell(canvas, buf, tris, painter, src) {
  const { N, data, best } = canvas;
  const rgba = [0, 0, 0, 0];
  for (const ids of tris) {
    const uv = ids.map((i) => [buf.uv[i * 2] * N, buf.uv[i * 2 + 1] * N]);
    const P3 = ids.map(src.pos);
    const N3 = ids.map(src.nor);
    const A3 = ids.map(src.ao);
    const area =
      (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const e2 = (a, b) => len(sub([...uv[a], 0], [...uv[b], 0]));
    const el = [e2(2, 1), e2(0, 2), e2(1, 0)];
    const x0 = Math.max(0, Math.floor(Math.min(uv[0][0], uv[1][0], uv[2][0]) - 1.5));
    const x1 = Math.min(N - 1, Math.ceil(Math.max(uv[0][0], uv[1][0], uv[2][0]) + 1.5));
    const y0 = Math.max(0, Math.floor(Math.min(uv[0][1], uv[1][1], uv[2][1]) - 1.5));
    const y1 = Math.min(N - 1, Math.ceil(Math.max(uv[0][1], uv[1][1], uv[2][1]) + 1.5));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let b0 = ((uv[1][0] - px) * (uv[2][1] - py) - (uv[2][0] - px) * (uv[1][1] - py)) / area;
        let b1 = ((uv[2][0] - px) * (uv[0][1] - py) - (uv[0][0] - px) * (uv[2][1] - py)) / area;
        let b2 = 1 - b0 - b1;
        // distance (texels) inside the triangle; a little spill past the edges
        const A = Math.abs(area);
        const dIn = Math.min((b0 * A) / el[0], (b1 * A) / el[1], (b2 * A) / el[2]);
        if (dIn < -1.2 || dIn <= best[y * N + x]) continue;
        best[y * N + x] = dIn;
        b0 = Math.max(b0, 0);
        b1 = Math.max(b1, 0);
        b2 = Math.max(b2, 0);
        const bs = b0 + b1 + b2;
        b0 /= bs;
        b1 /= bs;
        b2 /= bs;
        const p = [0, 1, 2].map((k) => P3[0][k] * b0 + P3[1][k] * b1 + P3[2][k] * b2);
        const n = norm([0, 1, 2].map((k) => N3[0][k] * b0 + N3[1][k] * b1 + N3[2][k] * b2));
        painter(p, n, A3[0] * b0 + A3[1] * b1 + A3[2] * b2, rgba);
        data.set(rgba, (y * N + x) * 4);
      }
  }
}

/** Paints an atlas rectangle (plus a 1-texel rim): painter(u, v, out) with u, v in 0..1. */
export function paintRect(canvas, atlas, r, painter) {
  const { N, data, best } = canvas;
  const rgba = [0, 0, 0, 0];
  const { x: ax, y: ay, w: rw, h: rh } = atlas.rectPixels(r);
  const w = Math.ceil(rw);
  const h = Math.ceil(rh);
  for (let y = ay - 1; y <= ay + h; y++)
    for (let x = ax - 1; x <= ax + w; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      painter(clamp((x + 0.5 - ax) / rw, 0, 1), clamp((y + 0.5 - ay) / rh, 0, 1), rgba);
      data.set(rgba, (y * N + x) * 4);
      best[y * N + x] = 1;
    }
}

/** Spreads painted texels into the empty ones round them (so filtering never reaches black). */
export function dilate(canvas, passes = 6) {
  const { N, data, best } = canvas;
  let filled = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) filled[i] = best[i] > -Infinity ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            const j = yy * N + xx;
            if (!filled[j]) continue;
            r += data[j * 4];
            g += data[j * 4 + 1];
            b += data[j * 4 + 2];
            a += data[j * 4 + 3];
            c++;
          }
        if (!c) continue;
        data.set([r / c, g / c, b / c, a / c], i * 4);
        next[i] = 1;
      }
    filled = next;
  }
}

/** The canvas as a mipmapped sRGB DataTexture (exports as PNG; works under node too). */
export function toTexture(canvas, name = 'basecolor') {
  const map = new THREE.DataTexture(canvas.data, canvas.N, canvas.N, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.name = name;
  map.needsUpdate = true;
  return map;
}
