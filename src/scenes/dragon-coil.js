import * as THREE from 'three';
import { runScene, runIntro, span, smooth, easeOut, easeIn, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Dragon Coil (a natural 20): a serpent of living fire, no solid shapes. Its body is a long
 * ribbon of flame with a white-hot core, ember scales flaking off it, a blazing head with two gold
 * eyes.
 *
 * 0-500     it whips in from far off around the table, shedding embers, closing on the die
 * 250-550   it coils fast: the body winds into a helix round the die (head high, tail low), a ring
 *           of firelight gathering on the table under the coil
 * 400-750   a quick lift: the die rises in the coil, turning
 * 800       the climax: the scales flare gold (a light burst, a golden shockwave, glints all along
 *           the body) and the title card stamps in
 * 1300-2200 under the card it uncoils and spirals away up and out, fading; the die sets down
 *           home (2000)
 * Mid-roll intro: the ember serpent is already circling the tumbling die, closing in; played
 * after it, the show starts with the coil wound round the landed die, just before it rises.
 */
export const DURATION = 2400;
const T = { arrive: [0, 500], coil: [250, 550], lift: [400, 750], flash: 800, gold: [750, 1450], uncoil: [1300, 1700], down: [1600, 2000], leave: [1350, 2100], fade: [1700, 2200] };

const N = 36; // body samples (the ribbons' points)
const LAG = 12; // ms of path between samples
const SPEED = 0.016; // radians of circling per ms

const HOT = '#fff3d0';
const GOLD = '#ffc94a';
const FIRE = '#ff8a2a';
const EMBER = '#ff4a1a';
const DEEP = '#8a1206';

const CARD = Object.freeze({
  seed: 3801,
  glow: '#ff5a1a',
  font: 'display',
  lines: [
    { text: 'Legendary', size: 0.12, at: 0.3, fill: ['#fff2c8', '#ffb53a'], edge: '#6a1404', enter: 'stamp', tilt: -3 },
    { text: '20!', size: 0.3, at: 0.62, fill: ['#ffe9a8', '#e8401a'], edge: '#5a0a04', enter: 'stamp', delay: 260, tilt: 2 },
  ],
  rays: { colors: ['#ff9a2a', '#b81a0a'], spin: -0.08 },
  sparks: { colors: ['#fff3d0', '#ffc94a', '#ff4a1a'], count: 90 },
  shake: 0.6,
  hold: 900,
  exit: 'sink',
});

export const dragonCoil = Object.freeze({
  id: 'scene-dragon-coil',
  name: 'Dragon Coil',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the fire serpent is already here, circling the tumbling die and closing in, its
   * flame body rippling, embers flaking off, its head and gold eyes leading; firelight under the
   * die. At landing the show starts with it coiled round the die, which then rises in the coil.
   */
  intro(env) {
    let body;
    let core;
    let head;
    let eyes;
    let light;
    let last = null;
    const pts = Array.from({ length: N }, () => new THREE.Vector3());
    // offsets from the die (the serpent circles wherever the die tumbles)
    const ring = (tau, r, y, out) => {
      const a = tau * SPEED;
      const rho = lerp(r * 4.2, r * 1.3, easeOut(span(tau, 0, 900)));
      return out.set(Math.sin(a) * rho, y, Math.cos(a) * rho);
    };
    const off = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        body = c.ribbon({ head: FIRE, tail: DEEP, width: c.r * 0.8, length: N });
        core = c.ribbon({ head: HOT, tail: GOLD, width: c.r * 0.32, length: N });
        head = c.glow(FIRE, { core: HOT, width: 0.5 });
        eyes = [0, 1].map(() => c.glow(GOLD, { core: '#ffffff', width: 0.4 }));
        light = c.glow(EMBER, { core: FIRE, ring: 0.72, width: 0.25 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const y = Math.max(r * 0.35, p.y - r * 0.1);
        body.reset();
        core.reset();
        for (let i = N - 1; i >= 0; i--) {
          ring(t - i * LAG, r, y + r * 0.25 * Math.sin(t / 110 - i * 0.45), off);
          pts[i].set(p.x + off.x, off.y, p.z + off.z);
          body.push(pts[i]);
          core.push(pts[i]);
        }
        const o = span(t, 0, 300);
        body.opacity(o * 0.85);
        core.opacity(o * 0.9);
        // the head, facing along its circle
        ring(t, r, 0, off);
        ring(t + 16, r, 0, ahead);
        ahead.sub(off);
        if (ahead.lengthSq() < 1e-8) ahead.set(0, 0, 1);
        ahead.normalize();
        const hy = pts[0].y;
        head.set(o, r * (1.1 + 0.1 * Math.sin(t / 60)), off.x, hy + 0.01, off.z);
        eyes.forEach((e, i) => {
          const sd = i ? 1 : -1;
          e.set(o * 0.95, r * 0.2, off.x + ahead.x * r * 0.2 - ahead.z * r * 0.15 * sd, hy + 0.02, off.z + ahead.z * r * 0.2 + ahead.x * r * 0.15 * sd);
        });
        light.set(o * 0.45 * easeOut(span(t, 200, 900)), r * 1.8, 0, 0.02, 0);
        // embers flaking off the body, sparks off the head
        if (dt > 0 && o > 0.05) {
          const f = Math.floor(t / 16);
          const n = Math.max(1, Math.round(dt * 55));
          for (let j = 0; j < n; j++) {
            c.emit({ count: 1, origin: pts[(f * 7 + j * 11) % N], dir: { x: 0, y: 1, z: 0 }, speed: 0.7, spread: 1, life: 0.6, size: r * 0.12, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: 1.2, halo: 0.8 });
          }
          if (f % 3 === 0) c.emit({ count: 1, origin: pts[0], dir: { x: -ahead.x, y: 0.2, z: -ahead.z }, speed: 2, spread: 0.5, life: 0.35, size: r * 0.09, kind: KIND.SPARK, color: HOT, colorEnd: FIRE, gravity: -2 });
        }
      },
    });
  },
  play(ctx) {
    let body; // the wide flame ribbon
    let core; // its white-hot core
    let head; // the blazing head
    let eyes; // two gold eye glints
    let floor; // the firelight ring on the table under the coil
    let pool; // the warm light under the die
    let lastEmit = null;
    let flashed = false;
    let setDown = false;
    let glinted = false;
    let coiled = false; // the calm form's static coil is drawn
    const pts = Array.from({ length: N }, () => new THREE.Vector3());
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    const c = new THREE.Color();
    const cHot = new THREE.Color(HOT);
    const cGold = new THREE.Color(GOLD);
    const cFire = new THREE.Color(FIRE);
    const cDeep = new THREE.Color(DEEP);

    /** The dragon's path at path-time `tau` ms: spirals in, coils (rising), then spirals out and up. */
    const path = (tau, s, out) => {
      const r = s.r;
      const a = tau * SPEED;
      const rho = lerp(r * 6.5, r * 1.25, easeOut(span(tau, ...T.arrive))) + r * 6 * easeIn(span(tau, ...T.leave));
      const h = s.rest.y - r * 0.2 + r * 0.5 * smooth(span(tau, ...T.lift)) + r * 3 * easeIn(span(tau, ...T.leave));
      return out.set(s.rest.x + Math.sin(a) * rho, h, s.rest.z + Math.cos(a) * rho);
    };
    /** Rebuilds both ribbons from the body samples (tail first: the head is the newest point). */
    const draw = () => {
      body.reset();
      core.reset();
      for (let i = N - 1; i >= 0; i--) {
        body.push(pts[i]);
        core.push(pts[i]);
      }
    };
    const tint = (k) => {
      // 0: fire, 1: the gold flare
      c.copy(cHot).lerp(cGold, 0.15 + 0.5 * k);
      core.mesh.material.uniforms.uHead.value.copy(cHot);
      core.mesh.material.uniforms.uTail.value.copy(c);
      body.mesh.material.uniforms.uHead.value.copy(cFire).lerp(cGold, k);
      body.mesh.material.uniforms.uTail.value.copy(cDeep).lerp(cFire, k * 0.6);
    };

    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.lift[0], // it circled in mid-roll: coiled round the landed die, which rises from home
      setup(s) {
        const r = s.r;
        floor = s.glow(EMBER, { core: FIRE, ring: 0.72, width: 0.2 });
        pool = s.glow(FIRE, { core: GOLD, width: 0.5 });
        body = s.ribbon({ head: FIRE, tail: DEEP, width: r * 0.95, length: N });
        core = s.ribbon({ head: HOT, tail: GOLD, width: r * 0.38, length: N });
        head = s.glow(FIRE, { core: HOT, width: 0.5 });
        eyes = [0, 1].map(() => s.glow(GOLD, { core: '#ffffff', width: 0.4 }));
        tint(0);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the serpent: body samples along its path, wound into a helix while it coils ---
        const coil = smooth(span(t, ...T.coil)) * (1 - smooth(span(t, ...T.uncoil)));
        for (let i = 0; i < N; i++) {
          path(t - i * LAG, s, pts[i]);
          pts[i].y += coil * r * (0.45 - (i / N) * 0.9);
          pts[i].y += r * 0.06 * Math.sin(t / 90 - i * 0.5); // a ripple down its length
        }
        draw();
        const o = span(t, 0, 300) * (1 - span(t, ...T.fade));
        const g = span(t, ...T.gold);
        const flare = bump(g);
        tint(flare);
        body.opacity(o * (0.85 + 0.35 * flare));
        core.opacity(o * (0.9 + 0.4 * flare));
        // the head and its eyes, facing along the path
        const hp = pts[0];
        path(t + 16, s, ahead);
        ahead.y = hp.y;
        ahead.sub(hp);
        if (ahead.lengthSq() < 1e-8) ahead.set(0, 0, 1);
        ahead.normalize();
        head.set(o * (1 + 0.5 * flare), r * (1.25 + 0.1 * Math.sin(t / 60)), hp.x, hp.y + 0.01, hp.z);
        eyes.forEach((e, i) => {
          const sd = i ? 1 : -1;
          e.set(o * 0.95, r * 0.22, hp.x + ahead.x * r * 0.2 - ahead.z * r * 0.16 * sd, hp.y + 0.02, hp.z + ahead.z * r * 0.2 + ahead.x * r * 0.16 * sd);
        });
        // ember scales flaking off the body, sparks off the head
        if (dt > 0 && o > 0.05) {
          const n = Math.max(1, Math.round(dt * 80));
          const f = Math.floor(t / 16);
          for (let j = 0; j < n; j++) {
            const q = pts[(f * 7 + j * 11) % N];
            s.emit({ count: 1, origin: q, dir: { x: 0, y: 1, z: 0 }, speed: 0.7, spread: 1, life: 0.7, size: r * 0.14, kind: KIND.EMBER, color: flare > 0.3 ? GOLD : FIRE, colorEnd: DEEP, gravity: 1.2, halo: 0.8 });
          }
          if (f % 3 === 0) {
            s.emit({ count: 1, origin: hp, dir: { x: -ahead.x, y: 0.2, z: -ahead.z }, speed: 2, spread: 0.5, life: 0.4, size: r * 0.1, kind: KIND.SPARK, color: HOT, colorEnd: FIRE, gravity: -2 });
          }
        }
        // --- firelight on the table: a ring under the coil, a pool under the die ---
        floor.tint(c.copy(cFire).lerp(cGold, flare)).set(coil * (0.55 + 0.6 * flare), r * 1.8, s.rest.x, 0.02, s.rest.z);
        // --- the die: rises in the coil, turning, then sets down home ---
        const lift = smooth(span(t, ...T.lift)) * (1 - smooth(span(t, ...T.down)));
        p.copy(s.rest);
        p.y += r * 0.5 * lift;
        s.die.pose(p, smooth(span(t, T.lift[0], T.down[1])));
        pool.set(lift * 0.6 + flare * 0.5, r * (1.6 + 0.5 * flare), s.rest.x, 0.021, s.rest.z);
        // --- the gold flare ---
        if (t >= T.flash && !flashed) {
          flashed = true;
          s.glint();
          s.shake(0.12, 160);
          s.card(CARD);
          s.effect('light-burst', { color: GOLD, intensity: 1, duration: 800 });
          s.effect('shockwave', { color: GOLD, intensity: 0.9, duration: 900 });
          for (let i = 0; i < N; i += 3) {
            s.emit({ count: 1, origin: pts[i], speed: 0.3, spread: 1, life: 0.6, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: GOLD });
          }
          s.emit({ count: 30, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 3.5, spread: 1, life: 0.9, size: r * 0.15, kind: KIND.EMBER, color: GOLD, colorEnd: EMBER, gravity: -3, halo: 0.9 });
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU + (i % 2) * 0.17;
            s.emit({ count: 1, origin: { x: s.rest.x, y: 0.12, z: s.rest.z }, dir: { x: Math.cos(a), y: 0.2, z: Math.sin(a) }, speed: 5 + (i % 4), spread: 0.08, life: 0.5, size: r * 0.18, kind: KIND.STREAK, color: HOT, colorEnd: GOLD, gravity: -6, floor: 0.04 });
          }
        }
        if (t >= T.down[1] && !setDown) {
          setDown = true;
          s.shake(0.08, 100);
          s.emit({ count: 6, origin: { x: s.rest.x, y: 0.1, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 1.6, size: r * 0.7, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a3028', colorEnd: '#1e1614', alpha: 0.4, gravity: 0.5 });
        }
      },
      calm(t, s) {
        // reduced: the fire serpent glows in curled around the die, flares gold and fades; a card
        const r = s.r;
        if (!coiled) {
          coiled = true;
          for (let i = 0; i < N; i++) {
            const a = 1.2 - (i / N) * TAU * 1.05;
            pts[i].set(s.rest.x + Math.sin(a) * r * 1.25, s.rest.y + r * (0.3 - (i / N) * 0.6), s.rest.z + Math.cos(a) * r * 1.25);
          }
          draw();
        }
        const k = bump(t / 1600);
        const g = bump(span(t, 400, 1300));
        tint(g);
        body.opacity(k * 0.9);
        core.opacity(k);
        head.set(k, r * 1.2, pts[0].x, pts[0].y + 0.01, pts[0].z);
        floor.set(k * (0.5 + 0.5 * g), r * 1.8, s.rest.x, 0.02, s.rest.z);
        if (t >= 500 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 10, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.2, size: r * 0.12, kind: KIND.EMBER, color: GOLD, colorEnd: DEEP, gravity: 0.6 });
        }
      },
    });
  },
});
