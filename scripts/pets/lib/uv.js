import { cross, dot, norm, sub } from './math.js';

/**
 * UV atlas for a pet: the shell is cut into charts by facing (six axis directions, grown greedily
 * so no chart overlaps itself in its projection) and extra parts get rectangles; all are shelf-
 * packed into one square texture at the largest common scale.
 *
 *   const atlas = createAtlas({ size: 1024, pad: 3 });
 *   const shell = atlas.addShell(pos, tris);     // charts of the shell
 *   const lid = atlas.addRect(0.36, 0.17);       // a rectangle (model units) for an extra part
 *   atlas.layout();
 *   atlas.shellUV(t, p)   // uv of point p on shell triangle t
 *   atlas.rectUV(lid, u, v)  // uv of (u, v) in 0..1 inside the rectangle
 *   atlas.rectPixels(lid) // { x, y, w, h } in texels (for painting it)
 */

// --------------------------------------------------------------------------------- UV charts

const AXES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const BASIS = [
  [
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 1, 0],
  ],
];

/**
 * Charts of a closed mesh: faces labelled by the axis they face most, then grown greedily from
 * seeds into charts whose projections never overlap. Returns per-face chart ids and the charts
 * (axis, 2D bounds in model units).
 */
export function makeCharts(pos, tris) {
  const nt = tris.length / 3;
  const V = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const fn = [];
  const label = new Int8Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = V(tris[t * 3]);
    const n = norm(cross(sub(V(tris[t * 3 + 1]), a), sub(V(tris[t * 3 + 2]), a)));
    fn.push(n);
    let best = -2;
    AXES.forEach((ax, i) => {
      const d = dot(n, ax);
      if (d > best) {
        best = d;
        label[t] = i;
      }
    });
  }
  // face adjacency
  const edgeMap = new Map();
  const adj = Array.from({ length: nt }, () => []);
  const nv = pos.length / 3;
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      const o = edgeMap.get(key);
      if (o === undefined) edgeMap.set(key, t);
      else {
        adj[t].push(o);
        adj[o].push(t);
      }
    }
  // smooth the labels (fewer ragged chart borders)
  for (let pass = 0; pass < 4; pass++)
    for (let t = 0; t < nt; t++) {
      const cnt = new Map();
      for (const o of adj[t]) cnt.set(label[o], (cnt.get(label[o]) ?? 0) + 1);
      for (const [l, c] of cnt) if (l !== label[t] && c >= 2 && dot(fn[t], AXES[l]) > 0.3) label[t] = l;
    }
  const proj = (p, l) => [dot(p, BASIS[l][0]), dot(p, BASIS[l][1])];
  const chart = new Int32Array(nt).fill(-1);
  const charts = [];
  const CELL = 0.004;
  const order = [...Array(nt).keys()].sort((a, b) => dot(fn[b], AXES[label[b]]) - dot(fn[a], AXES[label[a]]));
  for (const seed of order) {
    if (chart[seed] >= 0) continue;
    const l = label[seed];
    const id = charts.length;
    const occ = new Map();
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const claim = (t) => {
      const q = [0, 1, 2].map((k) => proj(V(tris[t * 3 + k]), l));
      const cells = [];
      const x0 = Math.floor(Math.min(q[0][0], q[1][0], q[2][0]) / CELL);
      const x1 = Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]) / CELL);
      const y0 = Math.floor(Math.min(q[0][1], q[1][1], q[2][1]) / CELL);
      const y1 = Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]) / CELL);
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (area <= 0) return null; // folds back in this projection
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) * CELL;
          const py = (y + 0.5) * CELL;
          const w0 = (q[1][0] - px) * (q[2][1] - py) - (q[2][0] - px) * (q[1][1] - py);
          const w1 = (q[2][0] - px) * (q[0][1] - py) - (q[0][0] - px) * (q[2][1] - py);
          const w2 = area - w0 - w1;
          if (w0 > 0 && w1 > 0 && w2 > 0) {
            const key = x * 100003 + y;
            if (occ.has(key)) return null;
            cells.push(key);
          }
        }
      return { cells, q };
    };
    const take = (t, c) => {
      chart[t] = id;
      for (const key of c.cells) occ.set(key, t);
      for (const p of c.q) {
        box[0] = Math.min(box[0], p[0]);
        box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]);
        box[3] = Math.max(box[3], p[1]);
      }
    };
    const c0 = claim(seed);
    if (!c0) {
      // a face that folds in its own axis' projection: use its exact normal's best axis
      continue;
    }
    take(seed, c0);
    const queue = [seed];
    while (queue.length) {
      const t = queue.shift();
      for (const o of adj[t]) {
        if (chart[o] >= 0 || label[o] !== l) continue;
        const c = claim(o);
        if (c) {
          take(o, c);
          queue.push(o);
        }
      }
    }
    charts.push({ axis: l, box });
  }
  // stragglers (rare): each its own chart on its best axis
  for (let t = 0; t < nt; t++) {
    if (chart[t] >= 0) continue;
    let l = 0;
    let best = -2;
    AXES.forEach((ax, i) => {
      const d = dot(fn[t], ax);
      if (d > best) {
        best = d;
        l = i;
      }
    });
    const q = [0, 1, 2].map((k) => proj(V(tris[t * 3 + k]), l));
    chart[t] = charts.length;
    charts.push({
      axis: l,
      box: [Math.min(q[0][0], q[1][0], q[2][0]), Math.min(q[0][1], q[1][1], q[2][1]), Math.max(q[0][0], q[1][0], q[2][0]), Math.max(q[0][1], q[1][1], q[2][1])],
    });
  }
  return { chart, charts, proj };
}

/** Shelf packing of rectangles (w, h in model units) into an N x N atlas; finds the largest scale. */
export function pack(rects, N, pad) {
  const tryScale = (s) => {
    const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h);
    let x = 0;
    let y = 0;
    let row = 0;
    const out = new Array(rects.length);
    for (const i of order) {
      const w = Math.ceil(rects[i].w * s) + 2 * pad;
      const h = Math.ceil(rects[i].h * s) + 2 * pad;
      if (x + w > N) {
        x = 0;
        y += row;
        row = 0;
      }
      if (w > N) return null;
      out[i] = [x + pad, y + pad];
      x += w;
      row = Math.max(row, h);
    }
    return y + row <= N ? out : null;
  };
  let lo = 10;
  let hi = 2000;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (tryScale(m)) lo = m;
    else hi = m;
  }
  return { s: lo, at: tryScale(lo) };
}

/**
 * @param {{size?:number, pad?:number}} [o] texture size and padding (texels) round each chart
 */
export function createAtlas({ size = 1024, pad = 3 } = {}) {
  const rects = [];
  let shell = null;
  let first = 0;
  let packed = null;
  const atlas = {
    size,
    rects,
    /** Adds a closed mesh's charts; returns { chart, charts, proj }. */
    addShell(pos, tris) {
      shell = makeCharts(pos, tris);
      first = rects.length;
      for (const c of shell.charts) rects.push({ w: c.box[2] - c.box[0], h: c.box[3] - c.box[1] });
      return shell;
    },
    /** A rectangle w x h (model units, so it gets the same texel density); returns its id. */
    addRect(w, h) {
      rects.push({ w, h });
      return rects.length - 1;
    },
    layout() {
      packed = pack(rects, size, pad);
      atlas.scale = packed.s; // texels per model unit
      return atlas;
    },
    rectUV(r, u, v) {
      const [x, y] = packed.at[r];
      return [(x + u * rects[r].w * packed.s) / size, (y + v * rects[r].h * packed.s) / size];
    },
    rectPixels(r) {
      const [x, y] = packed.at[r];
      return { x, y, w: rects[r].w * packed.s, h: rects[r].h * packed.s };
    },
    /** The chart id of shell triangle t (for splitting vertices along chart seams). */
    chartOf: (t) => shell.chart[t],
    shellUV(t, p) {
      const ci = shell.chart[t];
      const c = shell.charts[ci];
      const q = shell.proj(p, c.axis);
      const r = first + ci;
      return atlas.rectUV(r, (q[0] - c.box[0]) / (rects[r].w || 1), (q[1] - c.box[1]) / (rects[r].h || 1));
    },
  };
  return atlas;
}
