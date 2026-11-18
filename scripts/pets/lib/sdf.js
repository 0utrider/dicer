import { add, clamp, cross, dot, len, norm, scl, sub } from './math.js';

/**
 * Signed distance field building blocks. A field is a function (x, y, z) -> distance (negative
 * inside). Primitives return such functions; combine their values with smin / smax.
 *
 *   const head = ellipsoid([0, 1, 0], [0.4, 0.35, 0.36]);
 *   const d = smin(head(x, y, z), ear(x, y, z), 0.04);   // smooth union, blend radius 0.04
 *   const carved = smax(d, -socket(x, y, z), 0.01);      // smooth subtraction
 *
 * Many are approximate (ellipsoid, flattened frames): fine, the mesher pulls vertices onto the
 * zero set with Newton steps, so only the zero set and a non-zero gradient matter.
 */

/** Smooth union (polynomial), blend radius k. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Smooth intersection; smooth subtraction of b from a is smax(a, -b, k). */
export const smax = (a, b, k) => -smin(-a, -b, k);

export function sphere(c, r) {
  return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
}

/** Axis-aligned ellipsoid, centre c, radii r (Inigo Quilez's bound). */
export function ellipsoid(c, r) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  return (x, y, z) => {
    const ax = (x - cx) / rx;
    const ay = (y - cy) / ry;
    const az = (z - cz) / rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const k1 = Math.sqrt((ax / rx) ** 2 + (ay / ry) ** 2 + (az / rz) ** 2);
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

/** A capsule from a (radius r1) to b (radius r2): a tapered limb, horn, ear or cone with round ends. */
export function roundCone(a, b, r1, r2) {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const sg = Math.sign(rr);
  return (x, y, z) => {
    const px = x - a[0];
    const py = y - a[1];
    const pz = z - a[2];
    const yv = px * ba[0] + py * ba[1] + pz * ba[2];
    const zv = yv - l2;
    const qx = px * l2 - ba[0] * yv;
    const qy = py * l2 - ba[1] * yv;
    const qz = pz * l2 - ba[2] * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = sg * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
  };
}
/** A capsule of constant radius. */
export const capsule = (a, b, r) => roundCone(a, b, r, r * 0.9999);

/** An axis-aligned box, centre c, half sizes h, edges rounded by r (r < every h). */
export function roundBox(c, h, r = 0) {
  return (x, y, z) => {
    const qx = Math.abs(x - c[0]) - h[0] + r;
    const qy = Math.abs(y - c[1]) - h[1] + r;
    const qz = Math.abs(z - c[2]) - h[2] + r;
    const o = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return o + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

/** A torus round the Y axis through c (ring radius R, tube radius r). */
export function torus(c, R, r) {
  return (x, y, z) => Math.hypot(Math.hypot(x - c[0], z - c[2]) - R, y - c[1]) - r;
}

/** A half-space: inside where dot(p - origin, n) < 0. */
export function plane(origin, n) {
  const u = norm(n);
  return (x, y, z) => (x - origin[0]) * u[0] + (y - origin[1]) * u[1] + (z - origin[2]) * u[2];
}

/**
 * A local frame at `origin` with an axis `up` (local y) and a facing `front` (local z, made
 * orthogonal to up); local x = cross(up, front). `local(x,y,z)` gives local coordinates,
 * `world(lx,ly,lz)` and `dir(vx,vy,vz)` go back.
 */
export function frame(origin, up, front) {
  const ay = norm(up);
  let az = norm(front);
  az = norm(sub(az, scl(ay, dot(az, ay))));
  const ax = cross(ay, az);
  return {
    origin,
    x: ax,
    y: ay,
    z: az,
    local(x, y, z) {
      const px = x - origin[0];
      const py = y - origin[1];
      const pz = z - origin[2];
      return [
        px * ax[0] + py * ax[1] + pz * ax[2],
        px * ay[0] + py * ay[1] + pz * ay[2],
        px * az[0] + py * az[1] + pz * az[2],
      ];
    },
    dir: (x, y, z) => add(add(scl(ax, x), scl(ay, y)), scl(az, z)),
    world(x, y, z) {
      return add(origin, add(add(scl(ax, x), scl(ay, y)), scl(az, z)));
    },
  };
}

/**
 * A field `fn` (in a frame's local coordinates) squashed along local axes by `s` = [sx, sy, sz]
 * (< 1 flattens): an ear flattened front to back, a flat beak, a disc. Distance is scaled down
 * conservatively.
 */
export function inFrame(fr, fn, s = [1, 1, 1]) {
  const m = Math.min(s[0], s[1], s[2]);
  return (x, y, z) => {
    const [lx, ly, lz] = fr.local(x, y, z);
    return fn(lx / s[0], ly / s[1], lz / s[2]) * m;
  };
}

/**
 * The head's frame tilted up by `tilt` radians about X (the face turns toward Dicer's top-down
 * camera): `fw(x,y,z)` face-local -> model point, `fdir` face-local -> model vector, `wf` model
 * -> face-local. Face-local z is the face's forward, y its up.
 */
export function tiltFrame(center, tilt) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const [hx, hy, hz] = center;
  return {
    center,
    tilt,
    fw: (x, y, z) => [hx + x, hy + y * c + z * s, hz - y * s + z * c],
    fdir: (x, y, z) => [x, y * c + z * s, -y * s + z * c],
    wf: (x, y, z) => {
      const dy = y - hy;
      const dz = z - hz;
      return [x - hx, dy * c - dz * s, dy * s + dz * c];
    },
  };
}

/** A polyline's arc length at the point nearest (x, y, z), and its total: for tails, tentacles. */
export function polyline(points) {
  const lens = [0];
  for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + len(sub(points[i], points[i - 1])));
  const param = (x, y, z) => {
    let best = Infinity;
    let s = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const ab = sub(points[i + 1], a);
      const l2 = dot(ab, ab);
      const t = clamp(((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / l2, 0, 1);
      const d = Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t);
      if (d < best) {
        best = d;
        s = lens[i] + t * Math.sqrt(l2);
      }
    }
    return s;
  };
  return { lens, total: lens[lens.length - 1], param };
}

/** A chain of round cones through points [x, y, z, r]: returns one field per segment. */
export function coneChain(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(roundCone([a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3]));
  }
  return out;
}

/** The field's unit gradient (outward normal) by central differences. */
export function gradient(f, x, y, z, e = 0.0015) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/** Pulls p onto the surface f = 0 (a few Newton steps). */
export function project(f, p) {
  let [x, y, z] = p;
  for (let i = 0; i < 4; i++) {
    const d = f(x, y, z);
    if (Math.abs(d) < 1e-5) break;
    const g = gradient(f, x, y, z);
    x -= g[0] * d;
    y -= g[1] * d;
    z -= g[2] * d;
  }
  return [x, y, z];
}

/**
 * The first surface point marching from `from` along the unit `dir` (sphere tracing), pulled
 * exactly onto the surface: { p, n }.
 */
export function trace(f, from, dir) {
  let p = from;
  for (let i = 0; i < 80; i++) {
    const d = f(p[0], p[1], p[2]);
    if (d < 1e-4) break;
    p = add(p, scl(dir, Math.max(d, 0.001)));
  }
  p = project(f, p);
  return { p, n: gradient(f, ...p) };
}
