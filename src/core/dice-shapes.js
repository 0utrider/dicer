/**
 * Die shape definitions (pure data, no three.js).
 * Vertices have unit circumradius; faces are vertex-index loops, CCW seen from outside.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** All sign combinations of a triple (zero components are not flipped). */
function signs(t) {
  const out = [];
  for (const sx of t[0] === 0 ? [1] : [1, -1])
    for (const sy of t[1] === 0 ? [1] : [1, -1])
      for (const sz of t[2] === 0 ? [1] : [1, -1]) out.push([t[0] * sx, t[1] * sy, t[2] * sz]);
  return out;
}
const cyc = (t) => [t, [t[1], t[2], t[0]], [t[2], t[0], t[1]]];

/** Build a face (CCW vertex loop) from a face normal: the vertices lying on its plane. */
function faceFromNormal(vertices, n) {
  let max = -Infinity;
  for (const v of vertices) max = Math.max(max, dot(v, n));
  const idx = vertices.map((_, i) => i).filter((i) => dot(vertices[i], n) > max - 1e-6);
  const c = [0, 0, 0];
  idx.forEach((i) => vertices[i].forEach((x, k) => (c[k] += x / idx.length)));
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ref, n));
  const w = cross(n, u); // (u, w, n) is right-handed, so increasing angle is CCW from outside
  const ang = (i) => {
    const d = vertices[i].map((x, k) => x - c[k]);
    return Math.atan2(dot(d, w), dot(d, u));
  };
  return idx.sort((a, b) => ang(a) - ang(b));
}

/** Face normal of a vertex loop (Newell's method). */
function loopNormal(vertices, face) {
  const n = [0, 0, 0];
  face.forEach((a, i) => {
    const p = vertices[a];
    const q = vertices[face[(i + 1) % face.length]];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return norm(n);
}

/**
 * Values for centrally symmetric polyhedra: the i-th antipodal pair gets (i+1, n-i),
 * so opposite faces sum to n+1.
 */
function oppositeValues(vertices, faces) {
  const n = faces.length;
  const normals = faces.map((f) => loopNormal(vertices, f));
  const values = new Array(n).fill(0);
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (values[i]) continue;
    const j = normals.findIndex((m) => dot(normals[i], m) < -0.999);
    values[i] = p + 1;
    values[j] = n - p;
    p++;
  }
  return values;
}

function fromNormals(type, rawVertices, normals, valuesFn) {
  const vertices = rawVertices.map(norm);
  const faces = normals.map((n) => faceFromNormal(vertices, norm(n)));
  const values = valuesFn ? valuesFn(vertices, faces) : oppositeValues(vertices, faces);
  return { type, kind: 'polyhedron', vertices, faces, values, readMode: 'up' };
}

const AXES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function buildD4() {
  const raw = signs([1, 1, 1]).filter((v) => v[0] * v[1] * v[2] > 0);
  // Each face lies opposite one vertex, so its normal is the negated vertex.
  const s = fromNormals(
    'd4',
    raw,
    raw.map((v) => v.map((x) => -x)),
    (_v, faces) => faces.map((_, i) => i + 1),
  );
  s.readMode = 'down'; // the result is the face resting on the table
  return s;
}

const buildD6 = () => fromNormals('d6', signs([1, 1, 1]), AXES);
const buildD8 = () => fromNormals('d8', AXES, signs([1, 1, 1]));

const icosaVerts = () => cyc([0, PHI, 1]).flatMap(signs);
const dodecaVerts = () => [...signs([1, 1, 1]), ...cyc([0, 1 / PHI, PHI]).flatMap(signs)];

const buildD12 = () => fromNormals('d12', dodecaVerts(), icosaVerts());
const buildD20 = () => fromNormals('d20', icosaVerts(), dodecaVerts());

/**
 * Pentagonal trapezohedron. Upper ring U_k at angle 72k, height +a; lower ring L_k at
 * 72k+36, height -a; apexes at +-h. Kite planarity requires h = a(1+cos36)/(1-cos36).
 */
function buildD10() {
  const c = Math.cos(Math.PI / 5);
  const a = 1;
  const h = (a * (1 + c)) / (1 - c);
  const r = Math.sqrt(h * h - a * a); // ring points share the apex circumradius
  const ring = (k, y, off) => {
    const t = (2 * Math.PI * k) / 5 + off;
    return [r * Math.cos(t), y, r * Math.sin(t)];
  };
  const raw = [
    [0, h, 0],
    [0, -h, 0],
  ];
  for (let k = 0; k < 5; k++) raw.push(ring(k, a, 0)); // U_k = 2 + k
  for (let k = 0; k < 5; k++) raw.push(ring(k, -a, Math.PI / 5)); // L_k = 7 + k
  const vertices = raw.map(norm);
  const U = (k) => 2 + (k % 5);
  const L = (k) => 7 + (k % 5);
  const faces = [];
  for (let k = 0; k < 5; k++) faces.push([0, U(k), L(k), U(k + 1)]); // top kites
  for (let k = 0; k < 5; k++) faces.push([1, L(k), U(k + 1), L(k + 1)]); // bottom kites
  // Orient every kite CCW seen from outside.
  faces.forEach((f, i) => {
    const n = loopNormal(vertices, f);
    const cen = [0, 0, 0];
    f.forEach((vi) => vertices[vi].forEach((x, d) => (cen[d] += x)));
    if (dot(n, cen) < 0) faces[i] = [f[0], ...f.slice(1).reverse()];
  });
  // Opposite faces sum to 11 (value 10 is labelled "0").
  return {
    type: 'd10',
    kind: 'polyhedron',
    vertices,
    faces,
    values: oppositeValues(vertices, faces),
    readMode: 'up',
  };
}

const buildD2 = () => ({
  type: 'd2',
  kind: 'coin',
  vertices: [],
  faces: [],
  values: [1, 2], // cap 0 (+Y) = 1, cap 1 (-Y) = 2
  readMode: 'up',
});

const BUILDERS = {
  d2: buildD2,
  d4: buildD4,
  d6: buildD6,
  d8: buildD8,
  d10: buildD10,
  d12: buildD12,
  d20: buildD20,
};
const cache = new Map();

/** @returns {ShapeDef} the (cached) shape definition for a die type. */
export function getShape(type) {
  if (!BUILDERS[type]) throw new Error(`dicer: unknown die type "${type}"`);
  if (!cache.has(type)) cache.set(type, BUILDERS[type]());
  return cache.get(type);
}

/** @returns {string|null} die type for a face count, or null when unsupported. */
export function dieTypeForFaces(faces) {
  return [2, 4, 6, 8, 10, 12, 20].includes(faces) ? `d${faces}` : null;
}

/**
 * The Dice So Nice die type of a term: 'd' + a custom DENOMINATION ('c' gives 'dc'), else 'd' +
 * faces. The one helper behind look, fx and damage-theme lookups, so a theme's perType key
 * matches on every path.
 */
export function dsnTypeOf(term) {
  const denom = term?.constructor?.DENOMINATION;
  if (typeof denom === 'string' && denom && denom !== 'd') return `d${denom}`;
  return Number.isInteger(term?.faces) && term.faces > 0 ? `d${term.faces}` : null;
}

/** Text drawn on a face. 6 and 9 carry a "." suffix (rendered as an underline mark). */
export function labelFor(type, value, variant) {
  if (variant === 'd100tens') return value === 100 || value === 0 ? '00' : String(value);
  if (type === 'd10' && value === 10) return '0';
  if (value === 6 || value === 9) return `${value}.`;
  return String(value);
}
