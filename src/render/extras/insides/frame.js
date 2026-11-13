/**
 * The up-facing frame shared by the inside cards that face the die's up (dragon, magic circle,
 * weapons): n = the die's up, t1 = a constant axis projected off n (the axis's .zxy where they are
 * parallel), t2 = n x t1. Right-handed (never mirrored), and with no switch on any component of up
 * the frame turns smoothly while the die tumbles. upFrame is the JS mirror (tests), upFrameGLSL the
 * GLSL that builds the same frame.
 */

/**
 * The axis of the dragon and the magic circle (canonical frame): the direction furthest from every
 * die's resting up and from the coin's caps. Rounded as the GLSL gets it.
 */
export const CARD_AXIS = Object.freeze([-0.8469, 0.3853, -0.3665]);

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** @returns {{ t1: number[], t2: number[], n: number[] }} for a unit n and an axis (arrays of 3) */
export function upFrame(n, axis) {
  const a = axis;
  let t = a.map((x, i) => x - dot3(a, n) * n[i]);
  if (dot3(t, t) < 1e-6) {
    const alt = [a[2], a[0], a[1]];
    t = alt.map((x, i) => x - dot3(alt, n) * n[i]);
  }
  const l = Math.hypot(...t);
  const t1 = t.map((x) => x / l);
  const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  return { t1, t2, n };
}

/**
 * GLSL lines (one tab each, to sit in a function body) that set `<prefix>T1` and `<prefix>T2`
 * from `<prefix>N` (a unit vec3 the caller has set) and `axisExpr` (a vec3 expression). The caller
 * declares `<prefix>N`, `<prefix>T1` and `<prefix>T2` (locals or globals); the lines declare
 * `<prefix>A` and `<prefix>T` as locals.
 */
export function upFrameGLSL(prefix, axisExpr) {
  const [A, T, N, T1, T2] = ['A', 'T', 'N', 'T1', 'T2'].map((s) => prefix + s);
  return [
    `vec3 ${A} = ${axisExpr};`,
    `vec3 ${T} = ${A} - dot( ${A}, ${N} ) * ${N};`,
    `if ( dot( ${T}, ${T} ) < 1e-6 ) ${T} = ${A}.zxy - dot( ${A}.zxy, ${N} ) * ${N};`,
    `${T1} = normalize( ${T} );`,
    `${T2} = cross( ${N}, ${T1} );`,
  ]
    .map((l) => `\t${l}`)
    .join('\n');
}
