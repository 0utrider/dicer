import { DEG, add, cross, dot, lerp3, mix, norm, rotateAbout, scl, srgb, sstep, sub, toLinear, vnoise } from './math.js';
import { smax, trace } from './sdf.js';
import { MeshBuffer } from './rig.js';
import { paintRect, write } from './paint.js';

/**
 * Face parts. Each extra part of `Body` is an object with three steps, called in order:
 *   part.reserve(atlas)            before atlas.layout(): asks for its texture rectangle
 *   part.build(buf, atlas, wts)    adds its vertices/triangles/shape keys to the Body buffer
 *   part.paint(canvas, atlas)      paints its rectangle
 *
 *   const eyes = placeEyes(fNoSockets, head, { r: 0.13, x: 0.168, y: 0.04, yaw: 0.1, open: 42 * DEG });
 *   const f = (x, y, z) => carveSockets(fNoSockets(x, y, z), x, y, z, eyes, 0.13 * 1.13);
 *   const face = surfaceAt(f, head);      // (qx, qy) face-local -> { p, n } on the surface
 *   const lids = eyelids(eyes, { r: 0.13 }); const mouth = mouthInside(face, head, { y: -0.112 });
 *   const eyeBuf = eyeballs(eyes, { r: 0.13, bones: { L: BI.eye_L, R: BI.eye_R } });
 *
 * An eye is { side (+1 = the pet's left, +X), E centre, F forward, U up, X = cross(U, F),
 * top, bottom (opening angles above / below F) }. The head frame comes from sdf.tiltFrame.
 */

/**
 * Places two eyes at face-local (+-x, y), turned out by `yaw`, pushed in or out so each eyeball
 * (radius r) shows `open` radians above its centre through the surface of `f` (no sockets yet).
 */
export function placeEyes(f, head, { r, x, y, yaw = 0.1, open = 42 * DEG, range = [0.05, 0.4] }) {
  const eyes = [];
  for (const side of [1, -1]) {
    const F = norm(head.fdir(Math.sin(yaw) * side, 0, Math.cos(yaw)));
    let U = head.fdir(0, 1, 0);
    U = norm(sub(U, scl(F, dot(U, F))));
    const X = cross(U, F);
    const at = (ze) => head.fw(x * side, y, ze);
    const opening = (E, dir) => {
      for (let a = 0; a < 89 * DEG; a += 0.25 * DEG) {
        const p = add(E, scl(add(scl(F, Math.cos(a)), scl(U, Math.sin(a) * dir)), r));
        if (f(p[0], p[1], p[2]) < 0) return a;
      }
      return 89 * DEG;
    };
    let [lo, hi] = range;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (opening(at(m), 1) < open) lo = m;
      else hi = m;
    }
    const E = at((lo + hi) / 2);
    eyes.push({ side, r, E, F, U, X, top: opening(E, 1), bottom: opening(E, -1) });
  }
  return eyes;
}

/**
 * Carves eye sockets into distance d at (x, y, z): a sphere of `radius` round each eye centre,
 * only in front of a plane `back` behind the centre (so no hidden hollow behind the eyeball).
 */
export function carveSockets(d, x, y, z, eyes, radius, { back = 0.03, k = 0.008 } = {}) {
  for (const e of eyes) {
    const px = x - e.E[0];
    const py = y - e.E[1];
    const pz = z - e.E[2];
    const sph = Math.sqrt(px * px + py * py + pz * pz) - radius;
    const pl = -(px * e.F[0] + py * e.F[1] + pz * e.F[2] + back);
    d = smax(d, -Math.max(sph, pl), k);
  }
  return d;
}

/** The surface point under face-local (qx, qy), traced back along the face's forward: { p, n }. */
export function surfaceAt(f, head, from = 0.6) {
  const back = scl(head.fdir(0, 0, 1), -1);
  return (qx, qy) => trace(f, head.fw(qx, qy, from), back);
}

/**
 * Eyelid shells round each eyeball (upper and lower), hidden in the socket at rest; shape keys
 * turn them about the eye's X (linear morphs, so each turn is kept under ~55 degrees and the shell
 * a little larger than the eyeball, so it never cuts in halfway). Defaults are the cat's:
 * motions: per key [upper, lower], each a number (degrees, + closes), {deg, roll} (slanted:
 * roll > 0 drops the inner end) or {close} (a fraction of fully shut). `blink` and `squint` are
 * per side (made blink_L / blink_R ...).
 */
export const LID_MOTIONS = {
  blink: [{ close: 1 }, { close: 1 }],
  squint: [{ close: 0.5 }, { close: 0.32 }],
  happy: [6, 13],
  sad: [{ deg: 16, roll: -0.6 }, 0],
  angry: [{ deg: 24, roll: 0.75 }, 8],
  surprised: [-6, -6],
};
export function eyelids(eyes, o = {}) {
  const {
    rUp = 1.1,
    rLo = 1.065,
    margin = 4 * DEG,
    meet = -5 * DEG,
    extra = 30 * DEG,
    nphi = 14,
    nth = 6,
    phi0 = 14 * DEG,
    motions = LID_MOTIONS,
    rect = [0.36, 0.17],
    fur = 0.8,
    lash = srgb(52, 44, 50),
  } = o;
  const lids = [];
  for (const eye of eyes) for (const upper of [true, false]) lids.push({ eye, upper, rect: -1 });
  return {
    lids,
    reserve(atlas) {
      for (const l of lids) l.rect = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      for (const lid of lids) {
        const { eye, upper } = lid;
        const R = eye.r * (upper ? rUp : rLo);
        const edge = upper ? eye.top + margin : -(eye.bottom + margin); // leading edge at rest
        const close = upper ? edge - meet : meet - edge; // > 0
        const ext = (upper ? eye.top : eye.bottom) + extra;
        const sgn = upper ? -1 : 1; // the closing direction in theta
        const at3 = (th, ph) =>
          add(eye.E, scl(add(scl(eye.X, Math.cos(ph)), scl(add(scl(eye.F, Math.cos(th)), scl(eye.U, Math.sin(th))), Math.sin(ph))), R));
        const turn = (p, dth, roll = 0) => {
          const k = norm(add(scl(eye.X, Math.cos(roll)), scl(eye.F, Math.sin(roll) * eye.side * -sgn)));
          return sub(add(eye.E, rotateAbout(sub(p, eye.E), k, -sgn * dth)), p);
        };
        const L = eye.side > 0 ? 'L' : 'R';
        const base = buf.count;
        for (let j = 0; j <= nth; j++)
          for (let i = 0; i <= nphi; i++) {
            const u = i / nphi;
            const v = j / nth;
            const ph = phi0 + (Math.PI - 2 * phi0) * u;
            const th = edge - sgn * ext * v; // v = 0 the leading edge
            const p = at3(th, ph);
            const nClosed = norm(sub(at3(th + sgn * close, ph), eye.E)); // seen only when shut
            const mo = {};
            for (const [key, spec] of Object.entries(motions)) {
              const m = spec[upper ? 0 : 1];
              const name = key === 'blink' || key === 'squint' ? `${key}_${L}` : key;
              if (typeof m === 'number') mo[name] = m ? turn(p, m * DEG) : [0, 0, 0];
              else if (m.close !== undefined) mo[name] = turn(p, close * m.close);
              else mo[name] = turn(p, m.deg * DEG, m.roll ?? 0);
            }
            buf.addVertex(p, nClosed, atlas.rectUV(lid.rect, u, v), wts, mo);
          }
        buf.grid(base, nth, nphi, (a) => sub(buf.P(a), eye.E));
      }
    },
    paint(canvas, atlas) {
      for (const { upper, rect: r } of lids)
        paintRect(canvas, atlas, r, (u, v, out) => {
          // v = 0 the leading edge (lashes, untinted), tinted fur beyond
          const fv = fur + 0.05 * (vnoise(u * 30, v * 12, upper ? 1 : 7) - 0.5);
          const k = sstep(0.07, 0.025, v);
          write(out, lerp3([fv, fv, fv], lash, k), 1 - k);
        });
    },
  };
}

/**
 * The mouth's dark inside: a disc collapsed behind the lips at rest; each key opens it into an
 * oval laid on the face surface (offset out a little). shapes: key -> [dy below the mouth line,
 * half width, half height, top flattening, offset]. `face` is surfaceAt(). Painted dark red with a
 * tongue and two fangs (colours in o.colors).
 */
export function mouthInside(face, head, o = {}) {
  const {
    y = -0.112,
    shapes = { mouthOpen: [-0.042, 0.068, 0.06, 0.6, 0.009], surprised: [-0.042, 0.032, 0.034, 1, 0.009], tongue: [-0.022, 0.028, 0.022, 0.6, 0.008] },
    rect = [0.1, 0.1],
    rings = 4,
    segs = 18,
    colors = {},
    fangs = true,
  } = o;
  const col = { mouth: srgb(96, 34, 44), deep: [0.2, 0.06, 0.08], tongue: srgb(232, 116, 132), tooth: [0.97, 0.96, 0.93], ...colors };
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      const J = face(0, y);
      const shapeAt = ([dy, ax, ay, flat, off]) => (rho, a) => {
        const s = Math.sin(a);
        const pt = face(ax * rho * Math.cos(a), y + dy + ay * rho * s * (s > 0 ? flat : 1));
        return add(pt.p, scl(pt.n, off));
      };
      const rest = (rho, a) => add(J.p, add(scl(head.fdir(Math.cos(a), 0, 0), 0.004 * rho), scl(J.n, -0.007)));
      const targets = Object.entries(shapes).map(([k, s]) => [k, shapeAt(s)]);
      const base = buf.count;
      for (let ri = 0; ri <= rings; ri++)
        for (let s = 0; s < (ri === 0 ? 1 : segs); s++) {
          const rho = ri / rings;
          const a = (s / segs) * Math.PI * 2;
          const p0 = rest(rho, a);
          const mo = Object.fromEntries(targets.map(([k, t]) => [k, sub(t(rho, a), p0)]));
          buf.addVertex(p0, J.n, atlas.rectUV(r, 0.5 + 0.5 * rho * Math.cos(a), 0.5 + 0.5 * rho * Math.sin(a)), wts, mo);
        }
      const ring = (ri, s) => (ri === 0 ? base : base + 1 + (ri - 1) * segs + (s % segs));
      for (let ri = 0; ri < rings; ri++)
        for (let s = 0; s < segs; s++) {
          if (ri === 0) buf.idx.push(ring(0, 0), ring(1, s), ring(1, s + 1));
          else buf.idx.push(ring(ri, s), ring(ri + 1, s), ring(ri + 1, s + 1), ring(ri, s), ring(ri + 1, s + 1), ring(ri, s + 1));
        }
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => {
        const x = u - 0.5;
        const yy = v - 0.5;
        let c = lerp3(col.mouth, col.deep, sstep(0.4, 1, Math.hypot(x, yy) * 2));
        c = lerp3(c, col.tongue, sstep(1, 0.85, Math.hypot(x / 0.36, (yy + 0.32) / 0.3)));
        if (fangs)
          for (const s of [1, -1]) {
            const fx = Math.abs(x - 0.22 * s);
            if (yy > 0.2 && fx < (yy - 0.2) * 0.35) c = col.tooth;
          }
        write(out, c, 0);
      });
    },
  };
}

/** A tongue hidden in the head; its key slides it out under the mouth line (a "blep"). */
export function tongue(face, head, o = {}) {
  const { y = -0.112, key = 'tongue', length = 0.045, width = 0.03, thick = 0.011, below = 0.05, out = 0.022, depth = 0.085, color = srgb(232, 116, 132), groove = srgb(196, 92, 110), rect = [0.12, 0.08], nu = 12, nv = 8 } = o;
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(rect[0], rect[1]);
    },
    build(buf, atlas, wts) {
      const bl = face(0, y - below);
      const A = norm(add(head.fdir(0, 0, 1), scl(head.fdir(0, -1, 0), 0.75)));
      const W = head.fdir(1, 0, 0);
      const Tn = norm(cross(A, W));
      const tip = add(bl.p, scl(bl.n, out));
      const cOut = sub(tip, scl(A, length));
      const cIn = add(face(0, y).p, add(scl(head.fdir(0, 0, 1), -depth), scl(head.fdir(0, -1, 0), 0.01)));
      const base = buf.count;
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const v = (j / nv) * Math.PI;
          const u = (i / nu) * Math.PI * 2;
          const loc = add(add(scl(A, length * Math.cos(v)), scl(W, width * Math.sin(v) * Math.cos(u))), scl(Tn, thick * Math.sin(v) * Math.sin(u)));
          const n = norm(add(add(scl(A, Math.cos(v) / length), scl(W, (Math.sin(v) * Math.cos(u)) / width)), scl(Tn, (Math.sin(v) * Math.sin(u)) / thick)));
          buf.addVertex(add(cIn, loc), n, atlas.rectUV(r, i / nu, j / nv), wts, { [key]: sub(cOut, cIn) });
        }
      buf.grid(base, nv, nu, (a) => sub(buf.P(a), cIn));
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, o2) => {
        const g = sstep(0.04, 0.0, Math.abs(Math.sin(u * Math.PI * 2)) * Math.sin(v * Math.PI)) * 0.3;
        write(o2, lerp3(color, groove, g), 0);
      });
    },
  };
}

/** Whiskers: thin tapered strands (3-sided) from the whisker pads, `count` per side. */
export function whiskers(face, head, o = {}) {
  const { y = -0.112, x = 0.085, count = 3, spacing = 0.016, length = 0.31, droop = 0.035, r0 = 0.0065, r1 = 0.0016, color = srgb(238, 236, 230), segs = 5 } = o;
  let r = -1;
  return {
    reserve(atlas) {
      r = atlas.addRect(0.02, 0.02);
    },
    build(buf, atlas, wts) {
      const uv = atlas.rectUV(r, 0.5, 0.5);
      for (const side of [1, -1])
        for (let w = 0; w < count; w++) {
          const mid = (count - 1) / 2;
          const root = face(x * side, y - 0.004 + spacing * (mid - w));
          const D = norm(head.fdir(side, 0.16 - 0.17 * (w - mid + 1), 0.18));
          const down = head.fdir(0, -1, 0);
          const Lw = length - 0.02 * Math.abs(w - mid);
          const ring = [];
          for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            const c = add(add(sub(root.p, scl(root.n, 0.012)), scl(D, (Lw + 0.012) * t)), scl(down, droop * t * t));
            const rad = mix(r0, r1, t);
            const a1 = norm(cross(D, [0, 1, 0]));
            const a2 = norm(cross(a1, D));
            const pts = [];
            for (let k = 0; k < 3; k++) {
              const ang = (k / 3) * Math.PI * 2;
              const off = add(scl(a1, Math.cos(ang)), scl(a2, Math.sin(ang)));
              pts.push(buf.addVertex(add(c, scl(off, rad)), off, uv, wts));
            }
            ring.push(pts);
          }
          for (let s = 0; s < segs; s++)
            for (let k = 0; k < 3; k++) {
              const a = ring[s][k];
              const b = ring[s][(k + 1) % 3];
              const c = ring[s + 1][k];
              const d = ring[s + 1][(k + 1) % 3];
              const nOut = add(buf.nor.slice(a * 3, a * 3 + 3), buf.nor.slice(b * 3, b * 3 + 3));
              const pa = buf.P(a);
              const n = cross(sub(buf.P(b), pa), sub(buf.P(c), pa));
              if (dot(n, nOut) > 0) buf.idx.push(a, b, c, b, d, c);
              else buf.idx.push(a, c, b, b, c, d);
            }
        }
    },
    paint(canvas, atlas) {
      paintRect(canvas, atlas, r, (u, v, out) => write(out, color, 0));
    },
  };
}

/**
 * The `Eyes` mesh: one vertex-coloured UV sphere per eye (poles on its forward axis, rings at the
 * colour edges so they stay crisp), each wholly on its bone, plus two glints. iris(t, lit) gives
 * the iris colour (sRGB 0..1) from t = 0 at the pupil to 1 at the rim, lit = 0..1 lighter below.
 * A `surprised` shape key (keys: ['surprised']) shrinks the pupils.
 * @returns {MeshBuffer}
 */
export function eyeballs(eyes, o = {}) {
  const {
    bones,
    pupil = 22 * DEG,
    iris = 44 * DEG,
    irisColor = (t, lit) => [mix(0.62, 0.3, t) + 0.18 * lit, mix(0.78, 0.6, t) + 0.12 * lit, mix(0.24, 0.16, t)],
    pupilColor = srgb(16, 18, 24),
    rimColor = srgb(40, 54, 30),
    linerColor = srgb(36, 30, 34),
    white = srgb(240, 238, 232),
    rings: ringDeg = [0, 7, 14, 20.5, 21.5, 23, 28, 34, 39, 42.5, 43.5, 45, 47, 52, 62, 78, 100, 125, 150, 180],
    na = 30,
    glints = [
      [24 * DEG, 0.55, 0.032],
      [27 * DEG, 0.55 + Math.PI, 0.014],
    ],
    keys = ['surprised'],
  } = o;
  const b = new MeshBuffer(keys);
  const rings = ringDeg.map((d) => d * DEG);
  const shrink = (pol) => {
    if (pol <= pupil + 1.2 * DEG) return pol * 0.5;
    if (pol <= iris) return mix(pupil * 0.5 + 0.6 * DEG, iris, (pol - pupil - 1.2 * DEG) / (iris - pupil - 1.2 * DEG));
    return pol;
  };
  const has = keys.includes('surprised');
  for (const eye of eyes) {
    const R = eye.r;
    const wts = [[eye.side > 0 ? bones.L : bones.R, 1]];
    const base = b.count;
    const at = (pol, az) => add(scl(eye.F, Math.cos(pol)), add(scl(eye.X, Math.sin(pol) * Math.cos(az)), scl(eye.U, Math.sin(pol) * Math.sin(az))));
    for (let r = 0; r < rings.length; r++)
      for (let a = 0; a < na; a++) {
        const pol = rings[r];
        const az = (a / na) * Math.PI * 2;
        const n = at(pol, az);
        let c;
        if (pol < pupil - 1 * DEG) c = pupilColor;
        else if (pol < iris - 1 * DEG) {
          const t = (pol - pupil) / (iris - pupil);
          c = irisColor(t, 0.5 + 0.5 * -Math.sin(az) * Math.sin(pol));
          if (pol > iris - 4 * DEG) c = c.map((v) => v * 0.7);
        } else if (pol < iris + 1.5 * DEG) c = rimColor;
        else if (pol < iris + 7 * DEG) c = linerColor; // the eyeliner: only its edge shows
        else c = white;
        const mo = has ? { surprised: scl(sub(at(shrink(pol), az), n), R) } : {};
        b.addVertex(add(eye.E, scl(n, R)), n, null, wts, mo, toLinear(c));
      }
    for (let r = 0; r + 1 < rings.length; r++)
      for (let a = 0; a < na; a++) {
        const i0 = base + r * na + a;
        const i1 = base + r * na + ((a + 1) % na);
        const j0 = i0 + na;
        const j1 = i1 + na;
        if (r === 0) b.idx.push(i0, j0, j1);
        else b.idx.push(i0, j0, j1, i0, j1, i1);
      }
    // glints: the same direction for both eyes (one light)
    for (const [pol, az, rad] of glints) {
      const n0 = at(pol, az);
      const c0 = add(eye.E, scl(n0, R + 0.002));
      const gb = b.count;
      const t1 = norm(cross(n0, [0, 1, 0]));
      const t2 = cross(t1, n0);
      const seg = 10;
      const glow = [1.6, 1.6, 1.6];
      b.addVertex(add(c0, scl(n0, 0.004)), n0, null, wts, {}, glow);
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const p = add(c0, add(scl(t1, Math.cos(a) * rad), scl(t2, Math.sin(a) * rad * 0.85)));
        b.addVertex(add(eye.E, scl(norm(sub(p, eye.E)), R + 0.0015)), n0, null, wts, {}, glow);
      }
      for (let s = 0; s < seg; s++) b.idx.push(gb, gb + 1 + ((s + 1) % seg), gb + 1 + s);
    }
  }
  return b;
}
