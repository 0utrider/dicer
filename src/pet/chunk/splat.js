import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  TAU,
  INK,
  clamp01,
  lerp,
  span,
  smooth,
  outCubic,
  outBack,
  bump,
  palette,
  paint,
  REFORM_IN, // the creatures' 'reform' pops out of the lump from here
} from './creatures/parts.js';

/**
 * The splat a pet leaves: the pet's body squashes into a lump of goo that bursts into a glossy,
 * irregular puddle of the pet's own colour, with droplets arcing out and landing as little splats.
 * The pet's two eyes sit in the puddle; the mimic's lid lies tilted in it (with a loose tooth) and
 * the dragonling's wing sticks out of it. On reform it all pulls back into a lump that the
 * creature pops out of (see the creatures' 'reform' pose, which stays hidden until REFORM_IN).
 * Designed to read from the top-down game camera at ~48 px per die. It stands on y = 0 in the
 * pet's own space and animates only inside its root; a pose allocates nothing.
 *
 * createSplat(kind, color) -> { root, pose(phase: 'burst'|'puddle'|'reform', t), dispose }
 *   burst: t 0..1 (SPLAT_MS): squash, burst, droplets land; t = 1 is the puddle, eyes wide.
 *   puddle: t 0..1 (PUDDLE_MS): the dizzy pupils settle and the eyes blink once; t = 1 is the
 *     resting look (the layer stops posing a resting puddle).
 *   reform: t 0..1 (REFORM_MS): droplets and leftovers hop back, the goo gathers into a lump that
 *     shrinks away as the creature pops out of it; nothing shows from t ~0.7.
 */

const R0 = 0.98; // puddle radius before the lobes
const SEG = 64; // around the puddle
// The puddle's cross-section, centre to edge: radius fraction and height. A thin middle and a
// rounded, slightly raised rim (the goo's surface tension), rolling down to the table.
const RING = [0, 0.8, 0.92, 0.975, 1];
const RING_H = [0.058, 0.076, 0.08, 0.05, 0];
// Splash lobes: [angle, reach, half-width (rad)], blunt fingers of goo toward where some droplets
// land: round-ended (a half-ellipse in angle), so they read as goo, not spikes.
// Irregular and lopsided on purpose: two even lobes over the eyes would read as ears.
const LOBES = [
  [0.35, 0.2, 0.17],
  [1.35, 0.3, 0.23],
  [2.4, 0.14, 0.22],
  [3.35, 0.33, 0.21],
  [4.45, 0.15, 0.24],
  [5.45, 0.24, 0.18],
];
const DROPS = 8;
const EYE_R = 0.27;
const EYE_X = 0.33;
const EYE_Z = 0.12;
const MIN = 1e-3; // a scale never reaches 0, so no matrix is degenerate

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const inQuad = (k) => k * k;
const outQuad = (k) => 1 - (1 - k) * (1 - k);

/** The puddle's edge radius at angle a. */
function edge(a) {
  let r = 1 + 0.05 * Math.sin(2 * a + 0.3) + 0.04 * Math.sin(3 * a + 0.7) + 0.025 * Math.sin(7 * a);
  for (const [la, reach, w] of LOBES) {
    const d = wrapPi(a - la) / w;
    if (d > -1 && d < 1) r += reach * Math.sqrt(1 - d * d);
  }
  return R0 * r;
}

/** Droplets: angle, landing distance, size, peak height, landing time (in the burst). */
const DROP = Array.from({ length: DROPS }, (_, i) => {
  const lobe = LOBES[i % LOBES.length];
  const a = i < LOBES.length ? lobe[0] + 0.05 : (i / DROPS) * TAU + 0.9 + 0.3 * Math.sin(i * 5.1);
  return {
    a,
    reach: edge(a) + 0.3 + 0.55 * ((i * 0.618) % 1),
    size: 0.1 + 0.07 * ((i * 0.37 + 0.2) % 1),
    peak: 0.55 + 0.6 * ((i * 0.29 + 0.1) % 1),
    land: 0.42 + 0.26 * ((i * 0.53) % 1),
  };
});

/** The goo puddle: a polar mesh, glossy, its colour baked in (an edge band a touch darker). */
function puddleGeometry(body) {
  const rings = RING.length;
  const pos = new Float32Array((1 + (rings - 1) * SEG) * 3);
  const col = new Float32Array(pos.length);
  const rim = body.clone().multiplyScalar(0.8);
  const put = (i, x, y, z, c) => {
    pos.set([x, y, z], i * 3);
    col.set([c.r, c.g, c.b], i * 3);
  };
  put(0, 0, RING_H[0], 0, body);
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * TAU;
      const rr = edge(a) * RING[r];
      put(
        1 + (r - 1) * SEG + s,
        Math.sin(a) * rr,
        RING_H[r],
        Math.cos(a) * rr,
        r >= rings - 2 ? rim : body,
      );
    }
  const idx = [];
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SEG));
  for (let r = 1; r < rings - 1; r++)
    for (let s = 0; s < SEG; s++) {
      const a = 1 + (r - 1) * SEG + s;
      const b = 1 + (r - 1) * SEG + ((s + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Highlights on the goo: a long soft streak and two dots, flat, just over the surface. */
function shineGeometry(color) {
  const parts = [
    [-0.34, -0.42, 0.24, 0.07, 0.6],
    [-0.06, -0.58, 0.07, 0.05, 0],
    [0.42, 0.36, 0.06, 0.035, 0.3],
  ].map(([x, z, sx, sz, rot]) =>
    new THREE.CircleGeometry(1, 10)
      .rotateX(-Math.PI / 2)
      .scale(sx, 1, sz)
      .rotateY(rot)
      .translate(x, 0, z),
  );
  const g = mergeFlat(parts);
  for (const p of parts) p.dispose();
  return paint(g, color);
}

/** One non-indexed geometry from several (position, normal, and colour when all have it). */
function mergeFlat(list) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = flat.reduce((k, g) => k + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  const names = flat.every((g) => g.attributes.color)
    ? ['position', 'normal', 'color']
    : ['position', 'normal'];
  for (const name of names) {
    const a = new Float32Array(n * 3);
    let o = 0;
    for (const g of flat) {
      a.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(a, 3));
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== list[i]) flat[i].dispose();
  return out;
}

export function createSplat(kind, color) {
  const { body: petBody, accent: accentColor } = palette(color);
  // A flat face-up puddle catches more light than the pet's rounded body: a touch darker, so
  // the goo reads as the pet's own colour (and the reform hands over without a colour jump).
  const body = petBody.clone().multiplyScalar(0.86);
  const shineColor = body.clone().lerp(new THREE.Color(1, 1, 1), 0.82);
  const geos = [];
  const mats = [];
  const geo = (g) => (geos.push(g), g);
  const mat = (m) => (mats.push(m), m);
  // Goo: glossy, colour from the vertices (body, a darker rim, near-white highlights).
  const goo = mat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.3,
      metalness: 0,
      envMapIntensity: 0.75,
    }),
  );
  // Details: eye whites, pupils, outlines, teeth, the mimic's palate.
  const detail = mat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.22,
      metalness: 0,
    }),
  );
  // The pet's accent: the mimic's strap, the dragonling's wing membrane, the slime's bubbles.
  const accent = mat(
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.3,
      metalness: kind === 'mimic' ? 0.35 : 0,
      side: THREE.DoubleSide,
    }),
  );

  const root = new THREE.Group();
  root.name = 'petSplat';
  const add = (g, m, parent = root, name = '') => {
    const mesh = new THREE.Mesh(g, m);
    if (name) mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  // The puddle, with its highlights riding on it (they counter-turn so the light stays put).
  const puddle = add(geo(puddleGeometry(body)), goo, root, 'splatPuddle');
  const shine = add(geo(shineGeometry(shineColor)), goo, puddle);
  shine.position.y = RING_H[1] + 0.006;

  // The lump: the pet's body squashing (burst) or gathering (reform), a goo dome.
  const lump = add(
    geo(paint(new THREE.SphereGeometry(1, 16, 3, 0, TAU, 0, Math.PI / 2), body)),
    goo,
    root,
    'splatLump',
  );

  const merged = (list) => {
    const g = mergeFlat(list);
    for (const x of list) x.dispose();
    return geo(g);
  };
  // Droplets: goo domes (only their tops ever show from above), each with a glint, so a red one
  // reads as a glossy blob of goo.
  const dropGeo = merged([
    paint(new THREE.SphereGeometry(1, 11, 2, 0, TAU, 0, Math.PI / 2), body),
    paint(new THREE.CircleGeometry(0.28, 5).rotateX(-0.9).translate(-0.3, 0.92, -0.25), shineColor),
  ]);
  const drops = DROP.map(() => add(dropGeo, goo, root, 'splatDrop'));

  // Eyes looking up out of the goo: a white dome with a dark outline ring, a pupil cap (turned by
  // a pivot) with a glint, and a goo-coloured upper lid that sweeps over it from the back.
  const ballGeo = merged([
    paint(new THREE.SphereGeometry(EYE_R, 10, 4, 0, TAU, 0, Math.PI * 0.55), INK.white),
    paint(
      new THREE.RingGeometry(EYE_R * 0.9, EYE_R * 1.2, 12)
        .rotateX(-Math.PI / 2)
        .translate(0, 0.01, 0),
      INK.pupil,
    ),
  ]);
  const pupilGeo = merged([
    paint(new THREE.SphereGeometry(EYE_R * 1.02, 10, 2, 0, TAU, 0, 0.62), INK.pupil),
    paint(
      new THREE.CircleGeometry(EYE_R * 0.2, 6)
        .rotateX(-Math.PI / 2)
        .translate(-0.32 * EYE_R, EYE_R * 1.03, -0.3 * EYE_R),
      INK.glint,
    ),
  ]);
  const lidGeo = geo(
    paint(new THREE.SphereGeometry(EYE_R * 1.08, 10, 3, 0, TAU, 0, Math.PI / 2), body),
  );
  const eyes = [-1, 1].map((side) => {
    const g = new THREE.Group();
    g.name = 'splatEye';
    root.add(g);
    add(ballGeo, detail, g);
    const pivot = new THREE.Group();
    g.add(pivot);
    add(pupilGeo, detail, pivot, 'pupil');
    const lid = add(lidGeo, goo, g);
    return { g, pivot, lid, side };
  });

  // Leftovers.
  let debris = null; // a lid or wing: { obj, x, y, z, rx, ry, rz, spin, loose }; the slime: { bubbles }
  if (kind === 'mimic') {
    const lid = new THREE.Group();
    lid.name = 'splatLid';
    root.add(lid);
    const W = 1.12;
    const D = 0.86;
    const H = 0.24;
    add(geo(paint(new RoundedBoxGeometry(W, H, D, 1, 0.08), body)), goo, lid);
    add(geo(new THREE.BoxGeometry(0.15, 0.05, D + 0.04)), accent, lid).position.y = H / 2 + 0.005;
    const palate = add(
      geo(paint(new THREE.PlaneGeometry(W - 0.16, D - 0.16).rotateX(Math.PI / 2), INK.mouth)),
      detail,
      lid,
    );
    palate.position.y = -H / 2 - 0.004;
    const toothGeo = geo(paint(new THREE.ConeGeometry(0.06, 0.14, 6), INK.tooth));
    // two teeth left on the lid's front edge, pointing down out of it (one mesh)
    const tooth = (x) =>
      paint(
        new THREE.ConeGeometry(0.075, 0.2, 5)
          .rotateX(Math.PI)
          .translate(x, -H / 2 - 0.08, D / 2 - 0.09),
        INK.tooth,
      );
    add(merged([tooth(-0.34), tooth(0.02), tooth(0.36)]), detail, lid, 'splatTooth');
    // a tooth knocked out, lying in the goo
    const loose = add(toothGeo, detail, root, 'splatTooth');
    loose.rotation.set(Math.PI / 2, 0, -2.2);
    loose.position.set(0.72, 0.085, 0.42);
    lid.rotation.order = 'YXZ'; // tilt about its own hinge, then turn
    debris = { obj: lid, x: 0.55, y: 0.27, z: -0.55, rx: -0.55, ry: 0.45, rz: 0.1, spin: 1, loose };
  } else if (kind === 'dragonling') {
    const wing = new THREE.Group();
    wing.name = 'splatWing';
    root.add(wing);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.1);
    shape.quadraticCurveTo(0.18, 0.2, 0.36, 0.2);
    shape.lineTo(0.76, 0.04);
    shape.quadraticCurveTo(0.56, -0.04, 0.62, -0.3);
    shape.quadraticCurveTo(0.42, -0.2, 0.32, -0.42);
    shape.quadraticCurveTo(0.14, -0.22, 0, -0.2);
    shape.lineTo(0, 0.1);
    const S = 1.6;
    add(geo(new THREE.ShapeGeometry(shape, 5).rotateX(Math.PI / 2).scale(S, 1, S)), accent, wing);
    for (const [ax, az, bx, bz, r] of [
      [0, 0.1, 0.36, 0.2, 0.035],
      [0.36, 0.2, 0.76, 0.04, 0.026],
      [0.36, 0.2, 0.62, -0.3, 0.022],
    ]) {
      const len = Math.hypot(bx - ax, bz - az) * S;
      const g = new THREE.CylinderGeometry(r * 0.5, r, len, 5, 1)
        .translate(0, len / 2, 0)
        .rotateZ(-Math.PI / 2);
      g.rotateY(-Math.atan2(bz - az, bx - ax)).translate(ax * S, 0, az * S);
      add(geo(paint(g, body)), goo, wing);
    }
    wing.rotation.order = 'YXZ';
    debris = {
      obj: wing,
      x: -0.62,
      y: 0.06,
      z: -0.5,
      rx: 0.15,
      ry: 2.45,
      rz: 0.8,
      spin: -1,
      loose: null,
    };
  } else {
    // the slime: a couple of bubbles rising in its goo
    const bubbleGeo = geo(new THREE.SphereGeometry(1, 8, 3, 0, TAU, 0, Math.PI / 2));
    const b1 = add(bubbleGeo, accent, root, 'splatBubble');
    const b2 = add(bubbleGeo, accent, root, 'splatBubble');
    debris = { bubbles: [b1, b2] };
  }

  // --- posing (allocation-free: every value is written into existing objects) ---

  const setScale = (o, x, y, z) => {
    o.visible = x > 2 * MIN && y > 2 * MIN;
    o.scale.set(Math.max(MIN, x), Math.max(MIN, y), Math.max(MIN, z));
  };
  /** The puddle at radius scale r and thickness scale h. */
  const setPuddle = (r, h) => setScale(puddle, r, h, r);
  /** The lump: radius w, height h. */
  const setLump = (w, h) => setScale(lump, w, h, w);
  /** Eyes at centre (x, y, z) offsets, scale s, lid 0 open .. 1 shut, gaze (gx right, gz down). */
  function setEye(e, x, y, z, s, close, gx, gz) {
    e.g.position.set(x, y, z);
    setScale(e.g, s, s, s);
    e.pivot.rotation.set(gz, 0, -gx);
    const c = clamp01(close);
    e.lid.visible = c > 0.01;
    e.lid.rotation.x = -Math.PI * (1 - c) * 0.98;
  }
  // The resting gaze: dazed, the pupils a little askew.
  const REST_GAZE = [
    [-0.18, -0.26],
    [0.26, 0.1],
  ];
  /** Dizzy pupils circling, settling onto the resting gaze as `settle` goes 0 -> 1 (into gx, gz). */
  let gx = 0;
  let gz = 0;
  function gazeInto(i, time, settle) {
    const s = smooth(clamp01(settle));
    const amp = 0.42 * (1 - s);
    const w = time * 15 + i * 2.2;
    gx = REST_GAZE[i][0] * s + amp * Math.cos(w);
    gz = REST_GAZE[i][1] * s + amp * Math.sin(i ? -w : w);
  }

  const surface = RING_H[0] + 0.005; // where the eyes sit in a resting puddle

  /** A droplet resting (landed at k = 1 + squish time). */
  function setDrop(i, x, y, z, sx, sy) {
    const m = drops[i];
    m.position.set(x, y, z);
    setScale(m, sx, sy, sx);
  }
  const restDrop = (i, squish) => {
    const d = DROP[i];
    const s = d.size;
    // a landed drop: a flat splat, springing out wide and back on landing
    const wide = 1.45 + 0.4 * squish;
    setDrop(
      i,
      Math.sin(d.a) * d.reach,
      0,
      Math.cos(d.a) * d.reach,
      s * wide,
      s * (0.4 - 0.15 * squish),
    );
  };

  /** The leftover (lid or wing) at its rest, lifted by `up`, spun by `spin` turns, scaled by s. */
  function setDebris(k, up, spinTurns, s, toCentre = 0) {
    if (!debris) return;
    if (debris.bubbles) {
      const b1 = debris.bubbles[0]; // indexed, not destructured: no iterator per frame
      const b2 = debris.bubbles[1];
      const r = s * puddle.scale.x;
      b1.position.set(0.42 * r, surface * puddle.scale.y, -0.3 * r);
      b2.position.set(0.6 * r, surface * puddle.scale.y, -0.08 * r);
      setScale(b1, 0.1 * s, 0.08 * s, 0.1 * s);
      setScale(b2, 0.06 * s, 0.05 * s, 0.06 * s);
      return;
    }
    const o = debris.obj;
    const c = 1 - toCentre;
    o.position.set(debris.x * c * k, debris.y + up, debris.z * c * k);
    o.rotation.set(debris.rx * k, debris.ry + debris.spin * spinTurns * TAU, debris.rz * k);
    setScale(o, s, s, s);
    if (debris.loose) setScale(debris.loose, k >= 1 ? s : 0, k >= 1 ? s : 0, k >= 1 ? s : 0);
  }

  function burst(u) {
    // 1) Squash: the lump the pet was flattens, bulging out (0 .. 0.24).
    const sq = span(u, 0, 0.24);
    setLump(lerp(0.8, 1.1, outCubic(sq)), sq >= 1 ? 0 : lerp(1.05, 0.07, outQuad(sq)));
    // 2) The puddle spreads from under it, overshooting a touch and settling (0.06 .. 0.7).
    const sp = span(u, 0.06, 0.4);
    const r = sp < 1 ? lerp(0.32, 1.08, outCubic(sp)) : 1 + 0.08 * (1 - smooth(span(u, 0.4, 0.7)));
    setPuddle(r, lerp(1.8, 1, smooth(span(u, 0.1, 0.55))));
    // 3) Droplets fly from the lump's rim at 0.1 and land, each with a squish.
    for (let i = 0; i < DROPS; i++) {
      const d = DROP[i];
      const k = span(u, 0.1, d.land);
      if (u < 0.1) {
        setDrop(i, 0, 0, 0, 0, 0);
        continue;
      }
      if (k < 1) {
        const rr = lerp(0.4, d.reach, k);
        const y = lerp(0.35, 0, k) + d.peak * 4 * k * (1 - k);
        const s = d.size;
        setDrop(i, Math.sin(d.a) * rr, y, Math.cos(d.a) * rr, s * 0.85, s * 1.3);
      } else restDrop(i, bump(u, d.land, Math.min(1, d.land + 0.16)));
    }
    // 4) The eyes ride the lump, pop up out of it and plop into the puddle (0.5), wide and dizzy.
    const pop = span(u, 0.14, 0.5);
    const land = bump(u, 0.5, 0.62);
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      const lumpTop = lump.visible ? lump.scale.y : 0;
      const x0 = e.side * 0.22;
      const x = lerp(x0, e.side * EYE_X, smooth(pop));
      const z = lerp(0.18, EYE_Z, smooth(pop));
      const y =
        u < 0.14
          ? lumpTop * 0.8 + 0.02
          : lerp(0.2, surface * puddle.scale.y, pop) +
            0.55 * Math.sin(Math.PI * pop) * (1 - i * 0.15);
      gazeInto(i, u * 0.5, 0);
      setEye(e, x, y, z, lerp(0.85, 1, smooth(pop)) * (1 + 0.15 * land), 0, gx, gz);
    }
    // 5) The leftover flies off in an arc and lands in the goo (0.08 .. 0.56), then settles.
    const dk = span(u, 0.08, 0.56);
    if (debris && !debris.bubbles) {
      if (u < 0.08) setDebris(0, 0.3, 0, 0);
      else
        setDebris(
          dk,
          0.75 * Math.sin(Math.PI * dk) + 0.04 * bump(u, 0.56, 0.7),
          1 - outCubic(dk),
          lerp(0.6, 1, smooth(dk)),
        );
    } else setDebris(1, 0, 0, smooth(span(u, 0.6, 0.85)));
  }

  function puddleRest(u) {
    setLump(0, 0);
    setPuddle(1, 1);
    for (let i = 0; i < DROPS; i++) restDrop(i, 0);
    setDebris(1, 0, 0, 1);
    // the pupils stop circling and settle (0 .. 0.7); one blink (0.42 .. 0.66); then a dazed,
    // heavy-lidded rest.
    const blink = bump(u, 0.42, 0.66);
    const droop = 0.32 * smooth(span(u, 0.6, 1));
    for (let i = 0; i < 2; i++) {
      gazeInto(i, 0.5 + u * 0.6, span(u, 0, 0.7));
      setEye(eyes[i], eyes[i].side * EYE_X, surface, EYE_Z, 1, Math.max(blink, droop), gx, gz);
    }
  }

  function reform(u) {
    // 1) The droplets hop back into the middle (0 .. 0.34, staggered).
    for (let i = 0; i < DROPS; i++) {
      const d = DROP[i];
      const a = 0.03 * (i % 4);
      const k = span(u, a, a + 0.28);
      if (k >= 1) {
        setDrop(i, 0, 0, 0, 0, 0);
        continue;
      }
      const rr = lerp(d.reach, 0.25, inQuad(k));
      const s = d.size * lerp(1, 0.6, k);
      setDrop(
        i,
        Math.sin(d.a) * rr,
        0.45 * 4 * k * (1 - k),
        Math.cos(d.a) * rr,
        s * lerp(1.45, 0.9, smooth(span(k, 0, 0.3))),
        s * lerp(0.4, 1.2, smooth(span(k, 0, 0.3))),
      );
    }
    // 2) The puddle pulls in (0 .. 0.4) and is gone into the lump by 0.62.
    const pull = smooth(span(u, 0, 0.4));
    const r = u < 0.4 ? lerp(1, 0.4, pull) : 0.4 * (1 - smooth(span(u, 0.4, 0.62)));
    setPuddle(r, lerp(1, 1.5, pull));
    // 3) The lump rises out of it (0.06 .. 0.38) with a little overshoot, then shrinks away
    //    around the creature popping out of it (0.4 .. 0.68).
    const rise = span(u, 0.06, REFORM_IN);
    const gone = smooth(span(u, 0.4, 0.68));
    const w = lerp(0.25, 0.5, outCubic(rise)) * (1 - gone);
    const h = (u < 0.06 ? 0 : 0.78 * outBack(rise, 1.6)) * (1 - smooth(span(u, 0.4, 0.6)));
    setLump(w, h);
    // 4) The eyes ride up to the lump's top, wide open and looking up, and fade into the
    //    creature's own as it appears (0.38 .. 0.48).
    const up = smooth(span(u, 0.04, REFORM_IN));
    const s = 1 - smooth(span(u, REFORM_IN, 0.48));
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      const y = lerp(surface * puddle.scale.y, Math.max(surface, lump.scale.y * 0.86), up);
      setEye(
        e,
        e.side * lerp(EYE_X, 0.18, up),
        y,
        lerp(EYE_Z, 0.12, up),
        s * lerp(1, 0.8, up),
        0.32 * (1 - smooth(span(u, 0, 0.15))),
        0,
        0,
      );
    }
    // 5) The leftover flies into the middle and is swallowed (0 .. 0.32).
    const dk = span(u, 0, 0.32);
    if (debris && !debris.bubbles)
      setDebris(1, 0.5 * Math.sin(Math.PI * dk), -0.6 * dk, 1 - smooth(dk), smooth(dk));
    else setDebris(1, 0, 0, 1 - smooth(span(u, 0, 0.2)));
  }

  function pose(phase, t) {
    const u = clamp01(t);
    if (phase === 'burst') burst(u);
    else if (phase === 'reform') reform(u);
    else puddleRest(u);
    // the highlights keep to the light, whichever way the pet faced
    const yaw = root.parent ? root.parent.rotation.y : 0;
    shine.rotation.y = Number.isFinite(yaw) ? -yaw : 0;
  }
  pose('puddle', 1);

  return {
    root,
    pose,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      geos.length = mats.length = 0;
    },
  };
}
