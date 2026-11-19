import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, smooth, bump, lerp, KIND, SHAPE } from './kit.js';

/**
 * Meteor (a natural 20). The reference for the crit scenes' look: light, embers and smoke from
 * the dice effects' own particle pool and library, no solid cartoon shapes.
 *
 * 0-150     ignition: the die glows white-hot, sparks crackle off it, heat lights the table
 * 150-450   launch: it streaks up and away in an arc, a comet ribbon behind it shedding embers
 * 450-560   gone: a twinkle where it vanished; a red glow gathers on the table where it will land
 * 560-800   descent: it plunges back from the far side in a blazing streak, the target glow
 *           brightening as it comes
 * 800       impact (the title card): a light burst, a shockwave, sparks raking out across the
 *           table, embers bouncing, a molten crater rim; the screen shakes; the die hops and settles
 * 800-2400  aftermath, under the card: smoke curling up, embers dying, the crater cooling from gold
 *           to ember red; the glint at 1120
 */
export const DURATION = 2400;
const T = { ignite: [0, 150], launch: [150, 450], gone: 450, back: 560, impact: 800, settle: [800, 1120], cool: [800, 2250], embers: 2000 };

const HOT = '#fff4d6';
const FIRE = '#ffb347';
const EMBER = '#ff5a1e';
const DEEP = '#a8200a';

/** Its title card, at the impact: the bowling-alley moment. */
const CARD = Object.freeze({
  seed: 20,
  glow: '#ff9a3c',
  lines: [
    { text: 'Natural', size: 0.13, at: 0.3, fill: ['#fff6d8', '#ffc061'], edge: '#7a2d06', enter: 'slam', tilt: -4 },
    { text: '20!', size: 0.3, at: 0.62, fill: ['#ffffff', '#ffd27a'], edge: '#a8350a', enter: 'pop', delay: 230, tilt: 3 },
  ],
  rays: { colors: ['#ffbe3c', '#ff6a1e'], spin: 0.1 },
  flash: '#fff2d0',
  sparks: { colors: ['#fff4d6', '#ffb347', '#ff6a1e'], count: 80 },
  confetti: { colors: ['#ffd23f', '#ff8a3c', '#ffffff', '#ff5e5b'], count: 90 },
  shake: 0.8,
  hold: 900,
  exit: 'rise',
});

export const meteor = Object.freeze({
  id: 'scene-meteor',
  name: 'Meteor',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the tumbling die catches fire. A white-hot halo rides it, a short comet ribbon and
   * embers trail it, sparks crackle off, heat lights the table under it, swelling the longer it
   * rolls. At landing the show goes straight to the launch (its ignition already seen).
   */
  intro(env) {
    let halo;
    let heat;
    let trail;
    let last = null;
    return runIntro(env, {
      setup(c) {
        halo = c.glow(FIRE, { core: HOT, width: 0.55 });
        heat = c.glow(EMBER, { core: FIRE, width: 0.6 });
        trail = c.ribbon({ head: HOT, tail: EMBER, width: c.r * 0.8, length: 18 });
      },
      frame(t, c, p) {
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = easeIn(span(t, 0, 500));
        // root follows the die on the table (x, z): glows are drawn relative to it
        halo.set(k, c.r * (1.6 + 0.3 * Math.sin(t / 60)), 0, p.y, 0);
        heat.set(k * 0.8, c.r * 1.8, 0, 0.02, 0);
        trail.push(p);
        trail.opacity(k);
        if (dt > 0) {
          c.emit({ count: Math.max(1, Math.round(dt * 70 * k)), origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 1.4, spread: 1, life: 0.55, size: c.r * 0.18, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: -2, halo: 0.8 });
          if (Math.round(t / 16) % 4 === 0) c.emit({ count: 1, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 2.4, spread: 1, life: 0.3, size: c.r * 0.1, kind: KIND.SPARK, color: HOT, colorEnd: FIRE, gravity: -6 });
        }
      },
    });
  },
  play(ctx) {
    let halo; // the glow riding on the die
    let heat; // the heat light on the table under the die
    let target; // the red glow where it will land
    let rim; // the molten crater rim
    let core; // the crater's hot centre
    let trail; // the comet ribbon
    let apex;
    let entry;
    let lastEmit = null;
    let impacted = false;
    let glinted = false;
    let twinkled = false;
    const p = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.launch[0], // ignited mid-roll: it lands and launches
      setup(s) {
        halo = s.glow(FIRE, { core: HOT, width: 0.55 });
        heat = s.glow(EMBER, { core: FIRE, width: 0.6 });
        target = s.glow(EMBER, { core: '#ffd28a', width: 0.5 });
        rim = s.glow(FIRE, { core: HOT, ring: 0.62, width: 0.16 });
        core = s.glow(EMBER, { core: FIRE, width: 0.35 });
        trail = s.ribbon({ head: HOT, tail: EMBER, width: s.r * 1.1, length: 30 });
        // up and away on one side, back in from the other: the streaks read across the table
        apex = s.rest.clone().addScaledVector(s.side, s.r * 4).addScaledVector(s.toward, -s.r * 1.5).setY(s.rest.y + s.r * 8);
        entry = s.rest.clone().addScaledVector(s.side, -s.r * 6).addScaledVector(s.toward, s.r * 1.5).setY(s.rest.y + s.r * 10);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        prev.copy(p);
        // --- the die's path ---
        let flying = false;
        if (t < T.launch[0]) {
          p.copy(s.rest);
          p.y += r * 0.08 * Math.sin(t / 22) * span(t, 40, 150); // trembling with heat
          s.die.pose(p, 0);
        } else if (t < T.gone) {
          const k = span(t, ...T.launch);
          const e = easeIn(k) * 0.35 + easeOut(k) * 0.65;
          p.lerpVectors(s.rest, apex, e);
          p.y = lerp(s.rest.y, apex.y, easeOut(k)) + r * 1.2 * bump(k);
          s.die.pose(p, 2.5 * k);
          flying = true;
        } else if (t < T.back) {
          s.die.hide(true);
          if (!twinkled) {
            twinkled = true;
            s.emit({ count: 3, origin: apex, speed: 0.4, spread: 1, life: 0.5, size: r * 0.5, kind: KIND.GLINT, color: HOT, colorEnd: FIRE });
          }
        } else if (t < T.impact) {
          s.die.hide(false);
          const k = easeIn(span(t, T.back, T.impact));
          p.lerpVectors(entry, s.rest, k);
          s.die.pose(p, 3 + 3 * k);
          flying = true;
        } else {
          // the impact hop, then home
          const k = span(t, ...T.settle);
          p.copy(s.rest);
          p.y += r * 0.5 * bump(k) * (1 - k * 0.4);
          s.die.pose(p, 6 + 0.25 * easeOut(k));
        }
        // --- the comet: ribbon, halo, embers shed along the way ---
        if (flying) {
          trail.push(p);
          trail.opacity(1);
        } else trail.opacity(t < T.back ? Math.max(0, 1 - span(t, T.gone, T.gone + 100)) : 0);
        if (t === 0 || (!flying && t >= T.gone && t < T.back)) trail.reset?.();
        const glowK = t < T.launch[0] ? easeIn(span(t, ...T.ignite)) : flying ? 1 : 0;
        halo.set(glowK, r * (flying ? 2.6 : 1.9), p.x, p.y, p.z);
        if (flying && dt > 0) {
          v.subVectors(p, prev).divideScalar(Math.max(dt, 1e-3));
          const n = Math.max(1, Math.round(dt * 90));
          s.emit({ count: n, origin: p, dir: { x: -v.x, y: -v.y, z: -v.z }, speed: 1.2, spread: 0.6, life: 0.7, size: r * 0.22, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: -3, halo: 0.8 });
        }
        if (t < T.launch[0] && dt > 0 && t > 40) {
          s.emit({ count: 1, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 2.2, spread: 0.9, life: 0.35, size: r * 0.12, kind: KIND.SPARK, color: HOT, colorEnd: FIRE, gravity: -6 });
        }
        // --- light on the table: heat under the die, the target glow where it will land ---
        const lift = Math.max(0, p.y - s.rest.y);
        heat.set(glowK * 0.9 / (1 + lift * 0.35), r * (1.6 + lift * 0.25), p.x, 0.02, p.z);
        const coming = t >= T.gone && t < T.impact ? easeIn(span(t, T.gone, T.impact)) : 0;
        target.set(0.25 + 0.75 * coming, r * lerp(3.2, 1.8, coming), s.rest.x, 0.02, s.rest.z);
        if (t < T.gone) target.set(0);
        // --- impact ---
        if (t >= T.impact && !impacted) {
          impacted = true;
          s.shake(0.4, 320);
          s.card(CARD);
          s.effect('light-burst', { color: '#ffd27a', intensity: 1.2, duration: 900 });
          s.effect('shockwave', { color: FIRE, intensity: 1.1, duration: 950 });
          const o = { x: s.rest.x, y: 0.12, z: s.rest.z };
          for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2 + (i % 2) * 0.11;
            s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.35, z: Math.sin(a) }, speed: 7 + (i % 5), spread: 0.08, life: 0.55, size: r * 0.2, kind: KIND.STREAK, color: HOT, colorEnd: EMBER, gravity: -9, floor: 0.04 });
          }
          s.emit({ count: 26, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 4.5, spread: 0.9, life: 1.6, size: r * 0.18, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: -7, floor: 0.04, halo: 0.9 });
          s.emit({ count: 10, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.9, spread: 1, life: 2.4, size: r * 1.1, sizeEnd: 3.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a3a30', colorEnd: '#1e1a18', alpha: 0.55, gravity: 0.6 });
        }
        // the crater: a molten rim and core cooling from gold to ember red
        if (impacted) {
          const k = span(t, ...T.cool);
          c.set(FIRE).lerp(c.clone().set(DEEP), smooth(k));
          rim.tint(c).set((1 - k) ** 1.4 * 1.1, r * lerp(1.4, 2.1, easeOut(span(t, T.impact, T.impact + 260))), s.rest.x, 0.021, s.rest.z);
          core.tint(c).set((1 - k) ** 2, r * 1.2, s.rest.x, 0.022, s.rest.z);
          if (t > T.impact + 200 && dt > 0 && t < T.embers && Math.round(t / 16) % 3 === 0) {
            s.emit({ count: 1, origin: { x: s.rest.x, y: 0.1, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 1.4, size: r * 0.12, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: 0.8 });
          }
        }
        if (t >= T.settle[1] && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the die glows hot in place, a soft heat pool, a few embers rise; a glint
        const k = bump(t / 1600);
        halo.set(k * 0.8, s.r * 1.9, s.rest.x, s.rest.y, s.rest.z);
        heat.set(k * 0.7, s.r * 1.8, s.rest.x, 0.02, s.rest.z);
        if (t >= 500 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 8, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.2, size: s.r * 0.12, kind: KIND.EMBER, color: FIRE, colorEnd: DEEP, gravity: 0.6 });
        }
      },
    });
  },
});
