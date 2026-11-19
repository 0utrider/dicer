import * as THREE from 'three';
import { runScene, runIntro, span, smooth, easeOut, bump, lerp, TAU, KIND } from './kit.js';

/**
 * Golden Ascension (a natural 20). All light: a shaft of pale gold falls on the die and lifts it.
 *
 * 0-250     the light opens: a soft pool and a bright rim on the table round the die, motes of
 *           light streaming down into it from above, golden motes rising off the table
 * 150-820   the die rises quickly in the light, turning, two ribbons of light spiralling up round
 *           it, rings of light pulsing out over the table under it
 * 800       the climax, ascended: a radiant bloom at the top (god-rays, shafts of light, a gold
 *           ring), a ring of twinkles; the card rises in
 * 800-1150  a short hang in a halo, bobbing gently
 * 1150-1750 it descends home under the card, the ribbons unwinding, the motes slowing
 * 1750      it touches down: a soft ring of light runs out, a glint
 * 1750-2250 the light fades
 */
export const DURATION = 2400;
const T = { lead: 400, open: [0, 250], rise: [150, 820], apex: 800, bob: [700, 1200], down: [1150, 1750], land: 1750, ring: [1750, 2250], fade: [1750, 2250] };
const RINGS = 4; // pulses of light on the table
const RING_GAP = 300;
const RING_LIFE = 800;

const WHITE = '#fffbe8';
const PALE = '#fff0b8';
const GOLD = '#ffd56a';
const AMBER = '#e8a830';

/** Its title card, at the top of the rise. */
const CARD = Object.freeze({
  seed: 3601,
  glow: '#ffe9a8',
  lines: [
    { text: 'Ascended', size: 0.12, at: 0.3, fill: ['#ffffff', '#fff0c2'], edge: '#8a6a1e', enter: 'rise' },
    { text: '20!', size: 0.3, at: 0.62, fill: ['#ffffff', '#ffd86a'], edge: '#9a6a10', enter: 'rise', delay: 260 },
  ],
  rays: { colors: ['#fff4c8', '#ffd56a'], spin: 0.05 },
  flash: '#fffbe8',
  sparks: { colors: ['#ffffff', '#fff0b0', '#ffd56a'], count: 70, up: true },
  hold: 900,
  exit: 'rise',
});

export const goldenAscension = Object.freeze({
  id: 'scene-golden-ascension',
  name: 'Golden Ascension',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the light finds the tumbling die. Motes of light gather in toward it, drifting down
   * from above and drawn in from around it, a soft glow wraps it, and a halo pool with a bright
   * rim opens on the table under it. At landing the die starts rising at once (the opening beats
   * skipped), reaching the top and its card ~400 ms later.
   */
  intro(env) {
    let pool;
    let edge;
    let halo;
    let last = null;
    let acc = 0;
    let n = 0;
    return runIntro(env, {
      setup(c) {
        pool = c.glow(GOLD, { core: WHITE, width: 0.6 });
        edge = c.glow(PALE, { core: WHITE, ring: 0.8, width: 0.1 });
        halo = c.glow(GOLD, { core: WHITE, width: 0.5 });
      },
      frame(t, c, p) {
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const r = c.r;
        const k = easeOut(span(t, 0, 900));
        const shimmer = 1 + 0.06 * Math.sin(t / 90);
        // grows into the full form's pool and rim (its light already open at the introSkip)
        pool.set(0.7 * k * shimmer, r * lerp(2.6, 1.7, k), 0, 0.02, 0);
        edge.set(0.55 * k, r * lerp(2.2, 1.45, k) * shimmer, 0, 0.021, 0);
        halo.set(0.4 * k, r * 1.7, 0, p.y, 0);
        if (dt <= 0) return;
        acc += dt * 34 * (0.3 + 0.7 * k);
        while (acc >= 1) {
          acc -= 1;
          const a = n * 2.39996;
          const f = (n * 0.618034) % 1;
          n++;
          if (n % 2) {
            // streaming down onto it from above
            const d = r * 1.1 * Math.sqrt(f + 0.02);
            c.emit({ count: 1, origin: { x: p.x + Math.cos(a) * d, y: p.y + r * 6, z: p.z + Math.sin(a) * d }, dir: { x: 0, y: -1, z: 0 }, speed: 9, spread: 0.02, life: 0.6, size: r * 0.1, kind: KIND.STREAK, color: WHITE, colorEnd: GOLD });
          } else {
            // drawn in toward it from around
            const d = r * (2 + 0.6 * f);
            c.emit({ count: 1, origin: { x: p.x + Math.cos(a) * d, y: p.y + r * 0.3, z: p.z + Math.sin(a) * d }, dir: { x: -Math.cos(a), y: 0.15, z: -Math.sin(a) }, speed: d / 0.7, spread: 0.05, life: 0.7, size: r * 0.09, kind: KIND.EMBER, color: PALE, colorEnd: GOLD, halo: 0.9 });
          }
        }
      },
    });
  },
  play(ctx) {
    let pool; // the shaft's light on the table
    let edge; // its bright rim
    let halo; // the glow round the die
    let rings; // pulses of light on the table
    let touch; // the soft ring at touchdown
    let ribbons; // two ribbons of light spiralling round the die
    let lastEmit = null;
    let fallAcc = 0;
    let riseAcc = 0;
    let n = 0;
    let ascended = false;
    let landed = false;
    let glinted = false;
    const pos = new THREE.Vector3();
    const q = new THREE.Vector3();
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.lead, // its light opened mid-roll: it lands and starts rising at once
      setup(s) {
        pool = s.glow(GOLD, { core: WHITE, width: 0.6 });
        edge = s.glow(PALE, { core: WHITE, ring: 0.8, width: 0.1 });
        halo = s.glow(GOLD, { core: WHITE, width: 0.5 });
        rings = [];
        for (let i = 0; i < RINGS; i++) rings.push(s.glow(i % 2 ? PALE : GOLD, { core: WHITE, ring: 0.85, width: 0.07 }));
        touch = s.glow(PALE, { core: WHITE, ring: 0.7, width: 0.12 });
        ribbons = [0, 1].map(() => s.ribbon({ head: '#ffffff', tail: AMBER, width: s.r * 0.32, length: 26 }));
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the light: opens, holds, fades ---
        const open = easeOut(span(t, ...T.open));
        const fade = 1 - span(t, ...T.fade);
        const light = open * fade;
        const shimmer = 1 + 0.06 * Math.sin(t / 90);
        pool.set(0.7 * light * shimmer, r * 1.7, s.rest.x, 0.02, s.rest.z);
        edge.set(0.55 * light, r * 1.45 * shimmer, s.rest.x, 0.021, s.rest.z);

        // --- the die: rises, hangs bobbing, descends gently home ---
        // introduced: the rise starts from home at the introSkip, still topping out at the apex
        const from = s.introduced ? T.lead : T.rise[0];
        const up = smooth(span(t, from, T.rise[1]));
        const down = smooth(span(t, ...T.down));
        const lift = up * (1 - down);
        const bob = r * 0.12 * Math.sin(span(t, ...T.bob) * TAU) * (1 - down);
        pos.set(s.rest.x, s.rest.y + r * 2.6 * lift + bob * up, s.rest.z);
        s.die.pose(pos, smooth(span(t, from, T.down[1])));
        halo.set(light * (0.35 + 0.5 * lift), r * (1.7 + 0.6 * lift), pos.x, pos.y, pos.z);

        // --- two ribbons of light spiralling round it while it is up ---
        const wind = span(t, T.rise[0], T.rise[0] + 300) * (1 - span(t, T.down[1] - 300, T.down[1]));
        ribbons.forEach((rib, j) => {
          if (wind <= 0) {
            rib.reset();
            rib.opacity(0);
            return;
          }
          const a = t / 210 + j * Math.PI;
          const rad = r * (1.15 + 0.15 * Math.sin(t / 300 + j));
          rib.push(q.set(pos.x + Math.cos(a) * rad, pos.y + r * 0.5 * Math.sin(t / 260 + j * 2), pos.z + Math.sin(a) * rad));
          rib.opacity(0.9 * wind);
        });

        // --- motes of light: streaming down into the shaft, rising off the table ---
        if (dt > 0 && light > 0.05) {
          fallAcc += dt * 26 * light;
          while (fallAcc >= 1) {
            fallAcc -= 1;
            const a = n * 2.39996;
            const d = r * 1.3 * Math.sqrt(((n * 0.618034) % 1) + 0.02);
            n++;
            s.emit({ count: 1, origin: { x: s.rest.x + Math.cos(a) * d, y: s.rest.y + r * 7, z: s.rest.z + Math.sin(a) * d }, dir: { x: 0, y: -1, z: 0 }, speed: 9, spread: 0.02, life: 0.65, size: r * 0.1, kind: KIND.STREAK, color: WHITE, colorEnd: GOLD });
          }
          riseAcc += dt * 30 * light;
          while (riseAcc >= 1) {
            riseAcc -= 1;
            const a = n * 2.39996;
            const d = r * 1.4 * Math.sqrt(((n * 0.618034) % 1) + 0.02);
            n++;
            s.emit({ count: 1, origin: { x: s.rest.x + Math.cos(a) * d, y: 0.06, z: s.rest.z + Math.sin(a) * d }, dir: { x: 0, y: 1, z: 0 }, speed: 1.2 + lift, spread: 0.3, life: 1.1, size: r * 0.09, kind: KIND.EMBER, color: PALE, colorEnd: AMBER, gravity: 1.2, halo: 0.9 });
          }
        }

        // --- rings of light pulse outward on the table while the die is up ---
        for (let i = 0; i < RINGS; i++) {
          const k = span(t, 300 + i * RING_GAP, 300 + i * RING_GAP + RING_LIFE);
          rings[i].set(k > 0 && k < 1 ? 0.9 * (1 - k) ** 1.2 : 0, r * lerp(1, 3.6, easeOut(k)), s.rest.x, 0.022 + 0.001 * i, s.rest.z);
        }

        // --- ascended: the bloom at the top ---
        if (t >= T.apex && !ascended) {
          ascended = true;
          s.card(CARD);
          s.effect('burst-vitality', { at: pos.clone(), intensity: 1 });
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * TAU;
            s.emit({ count: 1, origin: pos, dir: { x: Math.cos(a), y: 0.15, z: Math.sin(a) }, speed: 2.6, spread: 0.1, life: 0.9, size: r * 0.32, kind: KIND.GLINT, color: '#ffffff', colorEnd: GOLD });
          }
          s.emit({ count: 20, origin: pos, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 1, life: 0.7, size: r * 0.1, kind: KIND.SPARK, color: WHITE, colorEnd: GOLD, gravity: -1 });
        }
        // --- touchdown: a soft ring of light, a glint ---
        if (t >= T.land && !landed) {
          landed = true;
          const g = { x: s.rest.x, y: 0.08, z: s.rest.z };
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TAU + 0.2;
            s.emit({ count: 1, origin: g, dir: { x: Math.cos(a), y: 0.1, z: Math.sin(a) }, speed: 2.2, spread: 0.1, life: 0.8, size: r * 0.1, kind: KIND.SPARK, color: WHITE, colorEnd: GOLD, floor: 0.04 });
          }
        }
        const tk = span(t, ...T.ring);
        touch.set(tk > 0 && tk < 1 ? 0.9 * (1 - tk) : 0, r * lerp(0.9, 2.4, easeOut(tk)), s.rest.x, 0.026, s.rest.z);
        if (t >= T.land && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the light swells on the die, which stays put; motes rise, a glint and the card
        const r = s.r;
        const k = bump(t / 1600);
        pool.set(0.6 * k, r * 1.7, s.rest.x, 0.02, s.rest.z);
        edge.set(0.45 * k, r * 1.45, s.rest.x, 0.021, s.rest.z);
        halo.set(0.6 * k, r * 1.8, s.rest.x, s.rest.y, s.rest.z);
        if (t >= 600 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 10, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.2, size: r * 0.1, kind: KIND.EMBER, color: PALE, colorEnd: AMBER, gravity: 0.6 });
        }
      },
    });
  },
});
