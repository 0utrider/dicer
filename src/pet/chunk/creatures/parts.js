import * as THREE from 'three';

/**
 * Shared pieces of the three creatures: easing curves, the palette, a disposables kit and the
 * expressive eye (ball + pupil + glint, upper and lower lids). Everything per frame is
 * allocation-free: a pose only writes numbers into existing objects.
 */

export const TAU = Math.PI * 2;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, k) => a + (b - a) * k;
/** 0..1 over [a, b] of t, clamped. */
export const span = (t, a, b) => clamp01((t - a) / (b - a));
export const smooth = (k) => k * k * (3 - 2 * k);
export const outCubic = (k) => 1 - (1 - k) ** 3;
export const inCubic = (k) => k * k * k;
export const inOutSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
/** Overshoots past 1 and settles (s ~1.7 is the classic back ease). */
export const outBack = (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
/** A damped spring settling from 1 to 0: wobble after an impact. */
export const wobble = (k, freq = 3, damp = 5) => Math.exp(-damp * k) * Math.cos(TAU * freq * k);
/** 0 -> 1 -> 0 over [a, b] with smooth shoulders. */
export const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * ((t - a) / (b - a))));
/** Rises over [a, a+r], holds, falls over [b-r, b]. */
export const plateau = (t, a, b, r) => smooth(span(t, a, a + r)) * (1 - smooth(span(t, b - r, b)));

/**
 * Keyframes: k is a flat [t0, v0, t1, v1, ...] (t ascending); smooth-steps between keys, holds
 * the ends. Module-level constant arrays keep it allocation-free.
 */
export function keys(t, k) {
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (t <= k[i]) {
      const a = k[i - 2];
      return lerp(k[i - 1], k[i + 1], smooth((t - a) / (k[i] - a)));
    }
  }
  return k[k.length - 1];
}

/** A pose is a flat object of numbers: copy and blend them field by field. */
export function poseKit(rest) {
  const names = Object.keys(rest);
  return {
    make: () => ({ ...rest }),
    reset(p) {
      for (const n of names) p[n] = rest[n];
      return p;
    },
    blend(dst, a, b, k) {
      for (const n of names) dst[n] = a[n] + (b[n] - a[n]) * k;
      return dst;
    },
  };
}

/** A blink: 0 most of the time, a quick shut every ~3.4 s (seeded per creature by `phase`). */
export function blink(ms, phase = 0) {
  const p = ((ms + phase) % 3400) / 3400;
  return bump(p, 0.94, 0.985);
}

export const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

const WHITE = new THREE.Color(1, 1, 1);
/** Body = the user colour (clamped); accent = it lightened 30% toward white. */
export function palette(color) {
  const body = new THREE.Color();
  try {
    body.set(typeof color === 'string' && color ? color : '#888888');
  } catch {
    body.set('#888888');
  }
  body.r = clamp01(body.r);
  body.g = clamp01(body.g);
  body.b = clamp01(body.b);
  const accent = body.clone().lerp(WHITE, 0.3);
  return { body, accent };
}

/** Detail colours (vertex colours of the shared detail material). */
export const INK = {
  white: new THREE.Color('#f7f5f0'),
  pupil: new THREE.Color('#0b0b10'),
  glint: new THREE.Color('#ffffff'),
  mouth: new THREE.Color('#3a0a14'),
  tongue: new THREE.Color('#ff6f8e'),
  tooth: new THREE.Color('#fffbef'),
};

/** Adds a constant vertex-colour attribute (the detail material multiplies by it). */
export function paint(geo, color) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = color.r;
    a[i * 3 + 1] = color.g;
    a[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Collects every geometry and material a creature makes, so dispose() frees them all. */
export function createKit() {
  const geos = [];
  const mats = [];
  return {
    geo(g) {
      geos.push(g);
      return g;
    },
    mat(m) {
      mats.push(m);
      return m;
    },
    /** A mesh of `geo` under `parent`, optionally placed. */
    mesh(geo, mat, parent, x = 0, y = 0, z = 0, name = '') {
      const m = new THREE.Mesh(this.geo(geo), mat);
      m.position.set(x, y, z);
      if (name) m.name = name;
      parent.add(m);
      return m;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      geos.length = mats.length = 0;
    },
  };
}

/**
 * The detail material: white eyes, near-black pupils, mouth, tongue and teeth, all one glossy
 * material told apart by vertex colour.
 */
export const detailMaterial = (kit) =>
  kit.mat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.22,
      metalness: 0,
    }),
  );

/**
 * An eye looking down its local +Z. `socket` is placed and aimed by the creature; set() turns the
 * ball (pupil) and closes the lids. Lids are shells of the lid material (the body colour).
 * side: +1 for the eye on the creature's +X, -1 for -X (mirrors the lid tilt).
 */
export function createEye(kit, { r, side, detail, lid, lidColor = null, ring = true }) {
  const socket = new THREE.Group();
  const ball = new THREE.Group();
  ball.rotation.order = 'YXZ';
  socket.add(ball);
  kit.mesh(paint(new THREE.SphereGeometry(r, 12, 8), INK.white), detail, ball);
  // The pupil: a cap a hair above the ball, around +Z. A big one reads as cute at small size.
  const pupil = kit.mesh(
    paint(new THREE.SphereGeometry(r * 1.015, 12, 2, 0, TAU, 0, 0.66), INK.pupil),
    detail,
    ball,
    0,
    0,
    0,
    'pupil',
  );
  pupil.rotation.x = Math.PI / 2;
  // A catch-light on the pupil, up and toward the key light.
  const glint = kit.mesh(paint(new THREE.SphereGeometry(r * 0.2, 5, 3), INK.glint), detail, ball);
  glint.position.set(-0.3 * r, 0.32 * r, 0.9 * r);
  // A dark rim behind the ball: an outline that reads on a light body.
  if (ring) {
    kit.mesh(
      paint(new THREE.RingGeometry(r * 0.9, r * 1.16, 16), INK.pupil),
      detail,
      socket,
      0,
      0,
      -0.04 * r,
    );
  }
  const upPivot = new THREE.Group();
  const loPivot = new THREE.Group();
  socket.add(upPivot, loPivot);
  // lidColor: the lids are painted into the detail material instead (an opaque lid on a
  // see-through body).
  const lidGeo = (g) => (lidColor ? paint(g, lidColor) : g);
  const lidMat = lidColor ? detail : lid;
  const up = kit.mesh(
    lidGeo(new THREE.SphereGeometry(r * 1.12, 12, 3, 0, TAU, 0, Math.PI / 2)),
    lidMat,
    upPivot,
  );
  const lo = kit.mesh(
    lidGeo(new THREE.SphereGeometry(r * 1.1, 12, 3, 0, TAU, Math.PI / 2, Math.PI / 2)),
    lidMat,
    loPivot,
  );
  return {
    socket,
    ball,
    /**
     * yaw/pitch turn the pupil (pitch > 0 looks up); upper/lower 0 open .. 1 shut;
     * sad > 0 raises the inner end of the upper lid (worried), < 0 lowers it (cross).
     */
    set(yaw, pitch, upper, lower, sad = 0) {
      ball.rotation.y = yaw;
      ball.rotation.x = -pitch;
      up.rotation.x = -Math.PI / 2 + clamp01(upper) * Math.PI;
      lo.rotation.x = Math.PI / 2 - clamp01(lower) * Math.PI * 0.98;
      upPivot.rotation.z = -side * sad;
      loPivot.rotation.z = side * sad * 0.3;
    },
  };
}

/** Bends a geometry along +Y into an arc of `angle` radians toward +Z (for horns and fangs). */
export function bend(geo, length, angle) {
  if (!angle) return geo;
  const p = geo.attributes.position;
  const R = length / angle;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = (y / length) * angle;
    const rr = R - z;
    p.setY(i, Math.sin(a) * rr);
    p.setZ(i, R - Math.cos(a) * rr);
  }
  geo.computeVertexNormals();
  return geo;
}
