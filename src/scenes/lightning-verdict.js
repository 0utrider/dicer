import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Lightning Verdict (a natural 20): a storm of light and smoke, a bolt that strikes the die.
 *
 * 0-700     the storm gathers: a dark pall spreads over the table, storm smoke wheels in a ring high
 *           above the die (the eye over it), lightning flickers inside the clouds
 * 350-700   the charge: the die glows blue, static crackles off it, motes of light are drawn in
 * 700       the strike: a jagged white-hot bolt with a blue halo and branches slams into the die,
 *           then re-strikes twice; a light burst, a shockwave, sparks raking out, a scorch ring of
 *           light; the screen shakes; the die jolts and hops with a spin; the title card slams in
 * 900-2100  residual crackle: little arcs of light flicker around the die, spitting glints
 * 1100-1700 the storm clears; 1450 the glint
 * 1700-2600 ozone wisps and blue embers rise as the scorch ring cools to deep blue
 * Every bolt is drawn from a fixed table and a hash: every player sees the same strike.
 * Reduced: the storm gathers and flickers over the die, the die glows, the card fades in.
 */
export const DURATION = 2600;
const T = { lead: 400, gather: [0, 650], charge: [350, 700], strike: 700, hop: [700, 1250], bounce: [1250, 1450], crackle: [900, 2100], clear: [1100, 1700], cool: [700, 2400], glint: 1450, wisps: [1700, 2500] };
const STRIKES = [700, 860, 1030]; // the strike and two re-strikes
const STRIKE_PEAK = [1.25, 1, 0.9];
const STRIKE_TURN = [0, 0.38, -0.3]; // each re-strike comes from a little to one side

const WHITE = '#ffffff';
const ICE = '#e6f2ff';
const BOLT = '#9fd0ff';
const ARC = '#5a9cff';
const DEEP = '#1c2f8a';
const FLICKER = [1, 0.15, 0.9, 0.3, 0.05, 1, 0.5, 0.1, 0.8, 0.2];

/** Its title card, at the strike. */
const CARD = Object.freeze({
  seed: 1907,
  glow: '#7fc8ff',
  lines: [
    { text: 'Critical', size: 0.12, at: 0.3, fill: ['#ffffff', '#bfe4ff'], edge: '#10306e', enter: 'slam', tilt: -3 },
    { text: 'Hit!', size: 0.3, at: 0.62, fill: ['#ffffff', '#7fc8ff'], edge: '#0a1f5a', enter: 'slam', delay: 170, tilt: 2 },
  ],
  flash: '#eaf6ff',
  sparks: { colors: ['#ffffff', '#cfe6ff', '#7fc8ff', '#3a7cff'], count: 110 },
  vignette: 'rgba(2,6,30,0.8)',
  shake: 1,
  hold: 900,
  exit: 'shatter',
});

const SHADE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A soft dark disc (premultiplied "over"): the storm's pall, the scorch mark.
const SHADE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** A flat soft dark disc of radius 1 (local: the kit has no darkening glow). set(opacity, radius, x, y, z). */
function makeShade(kit, root, color) {
  const mat = kit.add(
    new THREE.ShaderMaterial({
      vertexShader: SHADE_VERTEX,
      fragmentShader: SHADE_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
    }),
  );
  const mesh = new THREE.Mesh(kit.add(new THREE.PlaneGeometry(2, 2)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.set = (opacity, radius, x, y, z) => {
    mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity));
    mesh.visible = opacity > 0.002;
    if (radius !== undefined) mesh.scale.setScalar(Math.max(1e-3, radius));
    if (x !== undefined) mesh.position.set(x, y, z);
    return mesh;
  };
  mesh.set(0);
  return mesh;
}

/** A fixed pseudo-random 0..1 for (i, seed): the bolts' jag, the same on every screen. */
function hash(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A jagged line from a to b (Vector3s): midpoint displacement sideways (across the line, on the
 * table: the camera looks down) and a little up and down, `levels` times. 2^levels + 1 points.
 */
function jagged(a, b, levels, rough, seed) {
  let pts = [a.clone(), b.clone()];
  const side = new THREE.Vector3();
  let k = 0;
  for (let l = 0; l < levels; l++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const len = p.distanceTo(q);
      side.set(-(q.z - p.z), 0, q.x - p.x);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();
      const m = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
      m.addScaledVector(side, (hash(k++, seed) - 0.5) * 2 * rough * len);
      m.y += (hash(k++, seed) - 0.5) * 0.5 * rough * len;
      out.push(m, q);
    }
    pts = out;
    rough *= 0.62;
  }
  return pts;
}

/** Lays a polyline into a ribbon, the last point the ribbon's head (its widest, hottest end). */
function draw(ribbon, pts) {
  ribbon.reset();
  for (const p of pts) ribbon.push(p);
}

export const lightningVerdict = Object.freeze({
  id: 'scene-lightning-verdict',
  name: 'Lightning Verdict',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the storm finds the tumbling die. A dark storm shadow spreads on the table under it,
   * lightning flickers in the clouds high over it, a blue charge glow wraps it and static crackles
   * off it in sparks and little arcs, building the longer it rolls. At landing the show goes
   * straight to the last of the charge (the gathering skipped): the bolt strikes ~300 ms later.
   */
  intro(env) {
    let pall;
    let halo;
    let clouds;
    let arc;
    let last = null;
    let acc = 0;
    let smoke = 0;
    let step = -1;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        pall = makeShade(c.kit, c.root, '#02030a');
        halo = c.glow(BOLT, { core: ICE, width: 0.5 });
        clouds = [0, 1, 2].map(() => c.glow('#8fbaff', { core: ICE, width: 0.5 }));
        arc = c.ribbon({ head: WHITE, tail: ARC, width: c.r * 0.07, length: 5 });
      },
      frame(t, c, p) {
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const r = c.r;
        const k = easeOut(span(t, 0, 900));
        // the storm shadow and the charge end where the full form picks up at its introSkip
        pall.set(0.47 * k, r * lerp(1.5, 4, k), 0, 0.011, 0);
        halo.set(k * 0.6 * (0.6 + 0.25 * FLICKER[Math.floor(t / 45) % FLICKER.length]), r * 1.7, 0, p.y, 0);
        clouds.forEach((g, i) => {
          const a = (i * TAU) / clouds.length + t / 1400;
          const f = FLICKER[(Math.floor(t / 60) + i * 3) % FLICKER.length];
          g.set(k * f * 0.7, r * 1.7, Math.cos(a) * r * 2.1, p.y + r * 3.3, Math.sin(a) * r * 2.1);
        });
        // a little arc of static jumping off the die, redrawn every 60 ms
        const st = Math.floor(t / 60);
        if (st !== step) {
          step = st;
          const a = st * 2.39;
          from.set(p.x + Math.cos(a) * r * 0.6, p.y + r * (0.3 * hash(st, 3) - 0.1), p.z + Math.sin(a) * r * 0.6);
          to.set(from.x + Math.cos(a + 0.5) * r * 0.8, from.y - r * 0.2, from.z + Math.sin(a + 0.5) * r * 0.8);
          draw(arc, jagged(to, from, 2, 0.45, st * 7));
          arc.on = (st * 7) % 5 < 2 && k > 0.2;
          if (arc.on) c.emit({ count: 1, origin: { x: to.x, y: to.y, z: to.z }, speed: 0.6, spread: 1, life: 0.25, size: r * 0.18, kind: KIND.GLINT, color: WHITE, colorEnd: ARC });
        }
        arc.opacity(arc.on ? k : 0);
        if (dt <= 0) return;
        // static crackling off it
        acc += dt * 34 * k;
        const n = Math.floor(acc);
        acc -= n;
        if (n > 0) c.emit({ count: n, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 2.4, spread: 1.2, life: 0.18, size: r * 0.07, kind: KIND.SPARK, color: WHITE, colorEnd: BOLT, gravity: -4 });
        // a little storm smoke wheeling high over it
        smoke += dt * 8 * k;
        if (smoke >= 1) {
          smoke -= 1;
          const a = t / 260;
          c.emit({ count: 1, origin: { x: p.x + Math.cos(a) * r * 2.5, y: p.y + r * 3.4, z: p.z + Math.sin(a) * r * 2.5 }, dir: { x: -Math.sin(a), y: 0, z: Math.cos(a) }, speed: 0.8, spread: 0.35, life: 1.4, size: r * 1.1, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#262b4a', colorEnd: '#0b0d1a', alpha: 0.45 });
        }
      },
    });
  },
  play(ctx) {
    let pall; // the storm's dark pall on the table
    let char; // the scorch mark
    let clouds; // lightning flickering inside the clouds
    let halo; // the charge on the die
    let floor; // the strike's light on the table
    let scorch; // the scorch ring of light, cooling
    let core; // the bolt: white-hot core, blue halo, two branches
    let glowBolt;
    let branches;
    let arcs; // the residual crackle
    let paths; // each strike's bolt and branch polylines
    let lastEmit = null;
    let accSmoke = 0;
    let accStatic = 0;
    let struck = 0;
    let arcStep = -1;
    let glinted = false;
    let carded = false;
    const pos = new THREE.Vector3();
    const o = new THREE.Vector3();
    const c = new THREE.Color();
    const deep = new THREE.Color(DEEP);

    const storm = (t, s, gather, fade, dt, calm = false) => {
      const r = s.r;
      const k = gather * (1 - fade);
      pall.set(0.5 * k, r * lerp(1.2, 4.2, gather), s.rest.x, 0.011, s.rest.z);
      clouds.forEach((g, i) => {
        const a = (i * TAU) / clouds.length + t / 1400;
        const f = FLICKER[(Math.floor(t / 60) + i * 3) % FLICKER.length];
        g.set(k * f * 0.85, r * 1.7, s.rest.x + Math.cos(a) * r * 2.1, s.rest.y + r * 3.3, s.rest.z + Math.sin(a) * r * 2.1);
      });
      if (calm || dt <= 0 || k <= 0.05) return;
      // storm smoke wheeling in a ring high over the die, the eye left open over it
      accSmoke += dt * 34 * k;
      const n = Math.floor(accSmoke);
      accSmoke -= n;
      for (let i = 0; i < n; i++) {
        const a = t / 260 + (i % 2) * Math.PI + i * 0.7;
        o.set(s.rest.x + Math.cos(a) * r * 2.5, s.rest.y + r * 3.4, s.rest.z + Math.sin(a) * r * 2.5);
        s.emit({ count: 1, origin: o, dir: { x: -Math.sin(a), y: 0, z: Math.cos(a) }, speed: 0.8, spread: 0.35, life: 1.8, size: r * 1.3, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#262b4a', colorEnd: '#0b0d1a', alpha: 0.55 });
      }
    };

    // the strike (and the re-strikes): a fresh bolt each, sparks at the impact
    const strike = (s, i) => {
      const r = s.r;
      draw(core, paths[i].bolt);
      draw(glowBolt, paths[i].bolt);
      branches.forEach((b, j) => draw(b, paths[i].branches[j]));
      const top = { x: s.rest.x, y: s.rest.y + r * 0.9, z: s.rest.z };
      s.emit({ count: i === 0 ? 20 : 10, origin: top, dir: { x: 0, y: 1, z: 0 }, speed: 3.4, spread: 1.4, life: 0.35, size: r * 0.14, kind: KIND.SPARK, shape: SHAPE.GLINT, color: WHITE, colorEnd: BOLT, gravity: -9, halo: 0.8 });
      if (i > 0) return;
      s.shake(0.45, 300);
      s.card(CARD);
      carded = true;
      s.effect('light-burst', { color: ICE, intensity: 1.4, duration: 750 });
      s.effect('shockwave', { color: BOLT, intensity: 1, duration: 900 });
      const g = { x: s.rest.x, y: 0.12, z: s.rest.z };
      for (let j = 0; j < 30; j++) {
        const a = (j / 30) * TAU + (j % 3) * 0.07;
        s.emit({ count: 1, origin: g, dir: { x: Math.cos(a), y: 0.3, z: Math.sin(a) }, speed: 7 + (j % 4), spread: 0.08, life: 0.45, size: r * 0.18, kind: KIND.STREAK, color: WHITE, colorEnd: ARC, gravity: -9, floor: 0.04 });
      }
      s.emit({ count: 8, origin: g, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 2, size: r * 1, sizeEnd: 3, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#3a4258', colorEnd: '#15182a', alpha: 0.45, gravity: 0.5 });
    };

    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.lead, // its storm and charge built mid-roll: it lands charged, the bolt follows
      setup(s) {
        const r = s.r;
        pall = makeShade(s.kit, s.root, '#02030a');
        char = makeShade(s.kit, s.root, '#04050c');
        clouds = [0, 1, 2].map(() => s.glow('#8fbaff', { core: ICE, width: 0.5 }));
        halo = s.glow(BOLT, { core: ICE, width: 0.5 });
        floor = s.glow(BOLT, { core: WHITE, width: 0.5 });
        scorch = s.glow(BOLT, { ring: 0.6, width: 0.14 });
        core = s.ribbon({ head: WHITE, tail: ICE, width: r * 0.16, length: 17 });
        glowBolt = s.ribbon({ head: BOLT, tail: '#3a6cff', width: r * 0.95, length: 17 });
        branches = [0, 1].map(() => s.ribbon({ head: ICE, tail: ARC, width: r * 0.08, length: 9 }));
        arcs = [0, 1].map(() => s.ribbon({ head: WHITE, tail: ARC, width: r * 0.07, length: 5 }));
        // every strike's path, fixed up front: from high above and out to one side down onto the die
        const base = Math.atan2(s.side.z, s.side.x) - 0.5;
        const impact = s.rest.clone().setY(s.rest.y + r * 0.85);
        paths = STRIKES.map((_, i) => {
          const a = base + STRIKE_TURN[i];
          const sky = s.rest.clone().add(new THREE.Vector3(Math.cos(a) * r * 5.5, 0, Math.sin(a) * r * 5.5)).setY(s.rest.y + r * 6);
          const bolt = jagged(sky, impact, 4, 0.32, 11 + i * 7); // sky first: the impact is the head
          const fork = [5, 9].map((at, j) => {
            const root = bolt[at];
            const fa = a + (j ? -1 : 1) * 0.95;
            const tip = root.clone().add(new THREE.Vector3(Math.cos(fa) * r * 2, 0, Math.sin(fa) * r * 2)).setY(root.y * 0.4);
            return jagged(tip, root, 3, 0.35, 41 + i * 5 + j);
          });
          return { bolt, branches: fork };
        });
        pos.copy(s.rest);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        storm(t, s, easeOut(span(t, ...T.gather)), span(t, ...T.clear), dt);
        // --- the charge: the die glows, static crackles off it, motes drawn in ---
        // introduced: the charge carries on from the intro's glow rather than starting from nothing
        const charge = s.introduced ? lerp(0.6, 1, span(t, T.lead, T.strike)) : span(t, ...T.charge);
        if (t < T.strike && charge > 0 && dt > 0) {
          accStatic += dt * 40 * charge;
          const n = Math.floor(accStatic);
          accStatic -= n;
          if (n > 0) {
            s.emit({ count: n, origin: { x: s.rest.x, y: s.rest.y + r * 0.5, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 2.4, spread: 1.2, life: 0.18, size: r * 0.07, kind: KIND.SPARK, color: WHITE, colorEnd: BOLT, gravity: -4 });
            const a = t / 70;
            o.set(s.rest.x + Math.cos(a) * r * 2.2, s.rest.y + r * 1.4, s.rest.z + Math.sin(a) * r * 2.2);
            s.emit({ count: 1, origin: o, dir: { x: -Math.cos(a), y: -0.5, z: -Math.sin(a) }, speed: r * 3.4, spread: 0.1, life: 0.5, size: r * 0.2, kind: KIND.GLINT, color: ICE, colorEnd: ARC });
          }
        }
        // --- the strikes ---
        while (struck < STRIKES.length && t >= STRIKES[struck]) strike(s, struck++);
        let level = 0;
        STRIKES.forEach((ts, i) => {
          if (t >= ts) level = Math.max(level, STRIKE_PEAK[i] * Math.exp(-(t - ts) / 75));
        });
        const fl = level * (0.8 + 0.2 * FLICKER[Math.floor(t / 30) % FLICKER.length]);
        const boltOn = t >= T.strike && t < 1300 ? fl : 0;
        core.opacity(Math.min(1.3, boltOn * 1.3));
        glowBolt.opacity(boltOn * 0.75);
        for (const b of branches) b.opacity(boltOn * 0.9);
        floor.set(Math.min(1.2, fl), r * 3.6, s.rest.x, 0.02, s.rest.z);
        // the charge on the die, blazing at the strike, then fading
        const after = t >= T.strike ? 1 - span(t, T.strike, 1700) : 0;
        halo.set(Math.max(charge * (0.6 + 0.25 * FLICKER[Math.floor(t / 45) % FLICKER.length]) * (t < T.strike ? 1 : 0), after * 1.1), r * (1.7 + after * 0.8), pos.x, pos.y, pos.z);
        // the scorch: a ring of light cooling from ice white to deep blue, a dark mark under it
        const ck = span(t, ...T.cool);
        if (t >= T.strike) {
          c.set(BOLT).lerp(deep, ck);
          scorch.tint(c).set((1 - ck) ** 1.3 * 1.1, r * lerp(1.1, 2.3, easeOut(span(t, T.strike, T.strike + 300))), s.rest.x, 0.019, s.rest.z);
          char.set(0.4 * (1 - span(t, 1600, DURATION)), r * 1.6, s.rest.x, 0.012, s.rest.z);
        }
        // --- the die: jolted sideways, a hop with a spin, a small bounce ---
        if (t >= T.strike) {
          const k = span(t, ...T.hop);
          pos.copy(s.rest).addScaledVector(s.side, -r * 0.18 * bump(span(t, T.strike, 900)));
          pos.y += r * 0.8 * bump(k) + r * 0.15 * bump(span(t, ...T.bounce));
          s.die.pose(pos, easeOut(k));
        } else {
          pos.copy(s.rest);
          s.die.pose(pos, 0);
        }
        // --- residual crackle: little arcs of light around the die, redrawn every 60 ms ---
        const env = span(t, T.crackle[0], T.crackle[0] + 100) * (1 - span(t, 1700, T.crackle[1]));
        const step = Math.floor(t / 60);
        if (env > 0 && step !== arcStep) {
          arcStep = step;
          arcs.forEach((ribbon, i) => {
            const a = step * 2.39 + i * Math.PI;
            const from = pos.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.7, r * (0.1 + 0.3 * hash(step, i)), Math.sin(a) * r * 0.7));
            const to = from.clone().add(new THREE.Vector3(Math.cos(a + 0.5) * r * 0.9, -r * 0.35, Math.sin(a + 0.5) * r * 0.9));
            draw(ribbon, jagged(to, from, 2, 0.45, step * 7 + i));
            ribbon.on = (step * 7 + i * 3) % 5 < 3;
            if (ribbon.on && dt > 0) s.emit({ count: 1, origin: to, speed: 0.6, spread: 1, life: 0.3, size: r * 0.2, kind: KIND.GLINT, color: WHITE, colorEnd: ARC });
          });
        }
        for (const ribbon of arcs) ribbon.opacity(env > 0 && ribbon.on ? env : 0);
        // --- aftermath: ozone wisps and blue embers rising off the scorch ---
        if (t >= T.wisps[0] && t < T.wisps[1] && dt > 0 && Math.round(t / 16) % 4 === 0) {
          s.emit({ count: 1, origin: { x: s.rest.x, y: 0.1, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 1.3, size: r * 0.11, kind: KIND.EMBER, color: ICE, colorEnd: DEEP, gravity: 0.7 });
          if (Math.round(t / 16) % 12 === 0) s.emit({ count: 1, origin: { x: s.rest.x, y: 0.15, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 0.4, spread: 0.8, life: 1.8, size: r * 0.7, sizeEnd: 2.6, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a5268', colorEnd: '#1a1d2a', alpha: 0.3, gravity: 0.4 });
        }
        if (t >= T.glint && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the storm gathers and flickers over the die, the die glows; the die stays put
        const k = bump(t / 1600);
        storm(t, s, k, 0, 0, true);
        halo.set(k * (0.55 + 0.3 * FLICKER[Math.floor(t / 60) % FLICKER.length]), s.r * 1.8, s.rest.x, s.rest.y, s.rest.z);
        floor.set(k * 0.4, s.r * 2.6, s.rest.x, 0.02, s.rest.z);
        if (t >= 450 && !carded) {
          carded = true;
          s.card(CARD);
          s.emit({ count: 8, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 0.8, size: s.r * 0.18, kind: KIND.GLINT, color: WHITE, colorEnd: BOLT });
        }
        if (t >= 600 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
