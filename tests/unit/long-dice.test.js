/**
 * The long dice (bullet d6, crystal d8 and d10): their shape, which faces are read, that no cap can
 * be rested on, and how a look picks them.
 */
import { getShape, shapeTypeFor, baseTypeOf, ALT_SHAPES } from '../../src/core/dice-shapes.js';
import { normalizeAppearance } from '../../src/look/appearance.js';
import { HULL_TYPES } from '../../src/physics/hulls.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The centre's foot on face i's plane lies inside the face: the die can rest on it. */
function restable(s, i) {
  const P = s.faces[i].map((j) => s.vertices[j]);
  const n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
  const l = Math.hypot(...n);
  const u = n.map((x) => x / l);
  const foot = u.map((x) => x * dot(u, P[0]));
  return P.every((p, k) => dot(cross(sub(P[(k + 1) % P.length], p), sub(foot, p)), u) >= 0);
}

const LONG = { d6bullet: 6, d8crystal: 8, d10crystal: 10 };

test.each(Object.entries(LONG))(
  '%s: n read sides valued 1..n, opposites summing to n + 1; caps never rested on',
  (type, n) => {
    const s = getShape(type);
    expect(s.faces).toHaveLength(3 * n);
    expect(s.readFaces).toEqual([...Array(n).keys()]);
    expect([...s.values.slice(0, n)].sort((a, b) => a - b)).toEqual(
      [...Array(n).keys()].map((i) => i + 1),
    );
    for (let k = 0; k < n / 2; k++) expect(s.values[k] + s.values[k + n / 2]).toBe(n + 1);
    expect(s.values.slice(n).every((v) => v === 0)).toBe(true);
    for (let i = n; i < 3 * n; i++) expect(restable(s, i)).toBe(false);
    for (let i = 0; i < n; i++) expect(restable(s, i)).toBe(true);
    // the tip reaches the unit circumradius, as every die does; faces wound CCW from outside
    expect(Math.max(...s.vertices.map((v) => Math.hypot(...v)))).toBeCloseTo(1, 6);
    s.faces.forEach((f) => {
      const P = f.map((j) => s.vertices[j]);
      const c = P.reduce((a, p) => a.map((x, j) => x + p[j] / P.length), [0, 0, 0]);
      expect(dot(cross(sub(P[1], P[0]), sub(P[2], P[0])), c)).toBeGreaterThan(0);
    });
    expect(HULL_TYPES).toContain(type);
  },
);

test('a look picks the shape per die type; anything else stays classic', () => {
  const a = normalizeAppearance({
    shapes: { d4: 'crystal', d6: 'bullet', d8: 'crystal', d10: 'bullet', d20: 'crystal' },
  });
  expect(a.shapes).toEqual({ d4: 'crystal', d6: 'bullet', d8: 'crystal' });
  expect(normalizeAppearance({}).shapes).toEqual({ d4: 'classic' }); // old looks keep their key
  expect(['d4', 'd6', 'd8', 'd10', 'd20'].map((t) => shapeTypeFor(t, a.shapes))).toEqual([
    'd4crystal',
    'd6bullet',
    'd8crystal',
    'd10',
    'd20',
  ]);
  expect(['d4crystal', 'd6bullet', 'd10crystal', 'd20', 'd100'].map(baseTypeOf)).toEqual([
    'd4',
    'd6',
    'd10',
    'd20',
    'd100',
  ]);
  for (const [t, list] of Object.entries(ALT_SHAPES))
    for (const alt of list) expect(() => getShape(`${t}${alt}`)).not.toThrow();
});
