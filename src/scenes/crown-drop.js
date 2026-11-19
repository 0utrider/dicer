import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Crown Drop (a natural 20). A real gold crown (polished metal, faceted rubies and sapphires,
 * pearls on its points) crowns the die; everything else is light and glitter.
 *
 * 0-700     a warm pool of light gathers on the table under the die; the crown falls from high
 *           above, turning (seen from above it shrinks as it falls), a pale gold ribbon of light
 *           behind it, shedding glitter
 * 700       coronation: the crown lands on the die, which hops; a gold light burst and shockwave,
 *           gold sparks raking out over the table, twinkles thrown up, gold leaf fluttering down;
 *           the card drops and stamps in
 * 900-2200  the crown sits in state: a soft halo over it, glints winking from its pearls in turn
 * 2200-2800 it lifts away in its ribbon of light and dissolves into a shower of golden sparkles
 */
export const DURATION = 2800;
const T = { lead: 380, fall: [0, 700], impact: 700, hop: [700, 1050], ring: [700, 1300], shine: 1100, gleam: [900, 2200], lift: [2200, 2800], fade: [2450, 2800], dissolve: 2450 };

const GOLD = '#ffcc4d';
const HOT = '#fff6d6';
const AMBER = '#ffb02e';
const DEEP = '#a8660a';
const POINTS = 5;

/** Its title card, at the coronation. */
const CARD = Object.freeze({
  seed: 2802,
  glow: '#ffc83d',
  font: 'display',
  lines: [
    { text: 'Crowned', size: 0.12, at: 0.3, fill: ['#fff7d6', '#f2c14e'], edge: '#5a3a00', enter: 'drop', tilt: -3 },
    { text: 'Critical!', size: 0.25, at: 0.6, fill: ['#fff3b0', '#e0a020'], edge: '#6a2a00', enter: 'stamp', delay: 420, tilt: 2 },
  ],
  rays: { colors: ['#ffd76a', '#b8862a'], spin: 0.08 },
  confetti: { colors: ['#ffd23f', '#f2c14e', '#7a3cff', '#ffffff', '#e0245e'], count: 100 },
  shake: 0.5,
  hold: 900,
  exit: 'fade',
});

export const crownDrop = Object.freeze({
  id: 'scene-crown-drop',
  name: 'Crown Drop',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the tumbling die is being chosen. A gold glow gathers over it, glitter spirals in
   * toward it from all around, and a warm pool of light swells on the table under it. At landing
   * the crown is already falling out of the light (its first beat skipped), crowning ~320 ms later.
   */
  intro(env) {
    let glow;
    let pool;
    let last = null;
    let acc = 0;
    let n = 0;
    return runIntro(env, {
      setup(c) {
        glow = c.glow(GOLD, { core: HOT, width: 0.5 });
        pool = c.glow(AMBER, { core: '#ffe9a8', width: 0.55 });
      },
      frame(t, c, p) {
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = easeOut(span(t, 0, 900));
        const r = c.r;
        glow.set(k * (0.6 + 0.12 * Math.sin(t / 90)), r * lerp(2.6, 1.7, k), 0, p.y + r * 1.4, 0);
        // ends where the full form's pool picks up at its introSkip
        pool.set(0.3 * k, r * lerp(3.4, 2.8, k), 0, 0.02, 0);
        // glitter drawn in from a ring around the die, spiralling
        acc += dt * 40 * (0.3 + 0.7 * k);
        while (acc >= 1) {
          acc -= 1;
          n += 1;
          const a = n * 2.399; // golden angle: spread evenly, deterministic
          const d = r * (2.2 + 0.4 * Math.sin(n * 1.7));
          const o = { x: p.x + Math.cos(a) * d, y: p.y + r * (0.6 + 0.5 * ((n * 0.37) % 1)), z: p.z + Math.sin(a) * d };
          const sw = a + 0.5; // a little sideways: a swirl
          c.emit({ count: 1, origin: o, dir: { x: -Math.cos(sw), y: 0.1, z: -Math.sin(sw) }, speed: d / 0.5, spread: 0.05, life: 0.5, size: r * 0.16, kind: KIND.GLINT, color: HOT, colorEnd: GOLD });
        }
        if (dt > 0 && Math.round(t / 16) % 5 === 0) c.emit({ count: 1, origin: { x: p.x, y: p.y + r * 1.4, z: p.z }, speed: 0.4, spread: 1, life: 0.6, size: r * 0.1, kind: KIND.SPARK, color: HOT, colorEnd: AMBER, gravity: -1 });
      },
    });
  },
  play(ctx) {
    let crown; // the crown group (radius 1, scaled to the die)
    let mats; // its materials, faded together
    let tips; // a marker on each point's pearl
    let pool; // the warm light gathering on the table
    let halo; // the glow riding on the crown
    let rim; // the gold ring running out at the coronation
    let trail; // the ribbon of light behind it
    let lastEmit = null;
    let shedAcc = 0;
    let crowned = false;
    let glinted = false;
    let dissolved = false;
    let lifting = false;
    let gleamSlot = -1;
    const p = new THREE.Vector3();
    const hop = new THREE.Vector3();
    const w = new THREE.Vector3();
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.lead, // its gathering light seen mid-roll: it lands with the crown already falling
      setup(s) {
        const gold = s.mat(GOLD, { emissive: '#4a2a00', side: THREE.DoubleSide });
        gold.metalness = 1;
        gold.roughness = 0.24;
        gold.emissiveIntensity = 0.45;
        const ruby = s.mat('#d0103a', { emissive: '#3a0010' });
        ruby.metalness = 0.1;
        ruby.roughness = 0.08;
        const sapphire = s.mat('#2a5cff', { emissive: '#06144a' });
        sapphire.metalness = 0.1;
        sapphire.roughness = 0.08;
        const pearl = s.mat('#fff4e6');
        pearl.metalness = 0;
        pearl.roughness = 0.3;
        mats = [gold, ruby, sapphire, pearl];
        crown = new THREE.Group();
        // the band: a lathe with a slight flare, rolled rims top and bottom
        const profile = [
          [1.0, 0],
          [1.03, 0.08],
          [0.98, 0.26],
          [1.02, 0.42],
          [1.05, 0.48],
        ].map(([x, y]) => new THREE.Vector2(x, y));
        crown.add(new THREE.Mesh(s.geo(new THREE.LatheGeometry(profile, 40)), gold));
        const rimGeo = s.geo(new THREE.TorusGeometry(1.03, 0.055, 10, 48));
        for (const y of [0.03, 0.47]) {
          const m = new THREE.Mesh(rimGeo, gold);
          m.rotation.x = Math.PI / 2;
          m.position.y = y;
          crown.add(m);
        }
        const point = s.geo(new THREE.ConeGeometry(0.2, 0.62, 16));
        const ball = s.geo(new THREE.SphereGeometry(0.09, 14, 10));
        const gem = s.geo(new THREE.OctahedronGeometry(0.13));
        const small = s.geo(new THREE.SphereGeometry(0.055, 10, 8));
        tips = [];
        for (let i = 0; i < POINTS; i++) {
          const a = (i / POINTS) * TAU;
          const pt = new THREE.Mesh(point, gold);
          pt.position.set(Math.sin(a) * 0.98, 0.78, Math.cos(a) * 0.98);
          const pr = new THREE.Mesh(ball, pearl);
          pr.position.set(Math.sin(a) * 0.98, 1.14, Math.cos(a) * 0.98);
          const j = new THREE.Mesh(gem, i % 2 ? sapphire : ruby);
          j.position.set(Math.sin(a) * 1.06, 0.25, Math.cos(a) * 1.06);
          j.scale.set(1, 1.3, 0.6);
          j.rotation.y = a;
          const b = a + Math.PI / POINTS; // a seed pearl between the jewels
          const sp = new THREE.Mesh(small, pearl);
          sp.position.set(Math.sin(b) * 1.07, 0.25, Math.cos(b) * 1.07);
          crown.add(pt, pr, j, sp);
          tips.push(pr);
        }
        crown.visible = false;
        s.add(crown);
        pool = s.glow(AMBER, { core: '#ffe9a8', width: 0.55 });
        halo = s.glow(GOLD, { core: HOT, width: 0.5 });
        rim = s.glow(GOLD, { core: HOT, ring: 0.66, width: 0.14 });
        trail = s.ribbon({ head: HOT, tail: AMBER, width: s.r * 1.1, length: 16 });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        const size = r * 0.62;
        const topY = s.rest.y + r * 0.72;
        // --- the crown: falls, sits in state, lifts away ---
        const fall = easeIn(span(t, ...T.fall));
        const lk = easeIn(span(t, ...T.lift));
        crown.position.set(s.rest.x, lerp(topY + r * 8, topY, fall) + lk * r * 6, s.rest.z);
        crown.rotation.y = t / 700 + lk * 3;
        const squash = 1 + 0.14 * bump(span(t, 700, 880)) * (1 - span(t, 880, 980));
        crown.scale.set(size * squash, size / squash, size * squash);
        const o = (s.introduced ? span(t, T.lead, T.lead + 100) : Math.min(1, t / 150)) * (1 - span(t, ...T.fade));
        for (const m of mats) m.opacity = o;
        crown.visible = o > 0.01;
        p.copy(crown.position);
        // the ribbon of light behind it, falling and lifting
        const flying = t < T.impact || t >= T.lift[0];
        if (t >= T.lift[0] && !lifting) ((lifting = true), trail.reset());
        if (flying) trail.push(p);
        trail.opacity(t < T.impact ? 0.8 : t >= T.lift[0] ? 0.8 * o : Math.max(0, 0.8 - span(t, T.impact, T.impact + 150)));
        // glitter shed along the way
        if (flying && dt > 0 && o > 0.05) {
          shedAcc += dt * 50;
          while (shedAcc >= 1) {
            shedAcc -= 1;
            s.emit({ count: 1, origin: p, dir: { x: 0, y: t < T.impact ? 1 : -1, z: 0 }, speed: 1.2, spread: 0.8, life: 0.6, size: r * 0.18, kind: KIND.GLINT, color: HOT, colorEnd: AMBER, gravity: -1 });
          }
        }
        // --- light: the pool gathering under the die, the halo on the crown ---
        const come = easeIn(span(t, ...T.fall));
        const reign = t < T.impact ? 0.2 + 0.6 * come : lerp(0.9, 0.4, span(t, T.impact, T.gleam[1])) * (1 - span(t, ...T.lift));
        pool.set(reign, r * (t < T.impact ? lerp(3, 1.7, come) : 1.9), s.rest.x, 0.02, s.rest.z);
        const pulse = 0.5 + 0.15 * Math.sin(t / 140);
        halo.set(o * (flying ? 0.9 : pulse), r * (flying ? 2 : 1.6), p.x, p.y + r * 0.3, p.z);
        // --- the coronation ---
        if (t >= T.impact && !crowned) {
          crowned = true;
          s.shake(0.22, 180);
          s.card(CARD);
          s.effect('light-burst', { color: '#ffe39a', intensity: 1.1, duration: 900 });
          s.effect('shockwave', { color: GOLD, intensity: 1, duration: 900 });
          const g = { x: s.rest.x, y: 0.12, z: s.rest.z };
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU + (i % 2) * 0.12;
            s.emit({ count: 1, origin: g, dir: { x: Math.cos(a), y: 0.3, z: Math.sin(a) }, speed: 6 + (i % 4), spread: 0.08, life: 0.5, size: r * 0.18, kind: KIND.STREAK, color: HOT, colorEnd: AMBER, gravity: -9, floor: 0.04 });
          }
          s.emit({ count: 16, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 0.9, life: 0.8, size: r * 0.35, kind: KIND.GLINT, color: HOT, colorEnd: GOLD, gravity: -3 });
          // gold leaf, fluttering down
          s.emit({ count: 22, origin: { x: s.rest.x, y: s.rest.y + r * 1.5, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 2.6, spread: 1, life: 2, size: r * 0.14, kind: KIND.FLAKE, shape: SHAPE.FLAKE, blend: 'normal', color: '#f2c14e', colorEnd: DEEP, gravity: -1.4, floor: 0.04 });
        }
        const rk = span(t, ...T.ring);
        rim.set(rk > 0 && rk < 1 ? 1.1 * (1 - rk) ** 1.3 : 0, r * lerp(1.1, 2.8, easeOut(rk)), s.rest.x, 0.021, s.rest.z);
        // --- the die: a hop under the crown's weight ---
        const k = span(t, ...T.hop);
        hop.copy(s.rest);
        hop.y += r * 0.45 * bump(k);
        s.die.pose(hop, 0.25 * easeOut(k));
        // --- in state: glints winking from the pearls in turn ---
        if (t >= T.gleam[0] && t < T.gleam[1]) {
          const slot = Math.floor((t - T.gleam[0]) / 170);
          if (slot !== gleamSlot) {
            gleamSlot = slot;
            crown.updateMatrixWorld(true);
            tips[(slot * 2) % POINTS].getWorldPosition(w);
            s.emit({ count: 1, origin: w, speed: 0.1, spread: 1, life: 0.45, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: GOLD });
          }
        }
        if (t >= T.shine && !glinted) ((glinted = true), s.glint());
        // --- it dissolves into golden sparkles as it lifts away ---
        if (t >= T.dissolve && !dissolved) {
          dissolved = true;
          s.emit({ count: 30, origin: p, speed: 1.6, spread: 1, life: 1, size: r * 0.28, kind: KIND.GLINT, color: HOT, colorEnd: AMBER, gravity: -1.5 });
          s.emit({ count: 24, origin: p, speed: 2.4, spread: 1, life: 0.8, size: r * 0.1, kind: KIND.SPARK, color: HOT, colorEnd: GOLD, gravity: -2 });
        }
      },
      calm(t, s) {
        // reduced: the crown fades in on the die, shines in a halo and fades; the die stays put
        const r = s.r;
        const o = bump(t / 1600);
        crown.visible = o > 0.01;
        crown.position.set(s.rest.x, s.rest.y + r * 0.72, s.rest.z);
        crown.scale.setScalar(r * 0.62);
        for (const m of mats) m.opacity = o;
        halo.set(o * 0.6, r * 1.6, s.rest.x, s.rest.y + r, s.rest.z);
        pool.set(o * 0.5, r * 1.8, s.rest.x, 0.02, s.rest.z);
        if (t >= 600 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 8, origin: { x: s.rest.x, y: s.rest.y + r, z: s.rest.z }, speed: 0.5, spread: 1, life: 0.8, size: r * 0.3, kind: KIND.GLINT, color: HOT, colorEnd: GOLD });
        }
      },
    });
  },
});
