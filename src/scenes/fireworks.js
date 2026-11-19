import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, bump, lerp, KIND, SHAPE } from './kit.js';

/**
 * Fireworks (a natural 20): a little fireworks show over the die, all light and sparks.
 *
 * 100-700   the finale rocket shoots straight up off the die: a big hot head of light on a gold
 *           ribbon, shedding a crackling spark trail
 * 700       the finale: a white-hot chrysanthemum of streaks and multicolour stars, a light burst,
 *           a second crackling wave of glitter 350 ms later; the die hops; the title card pops in
 * 680-1130  under the card, a gold willow rocket climbs off to the side and bursts, drooping in long
 *           embers. Each burst flashes, throws its colour onto the table and leaves a wisp of smoke
 * 700-2400  the stars drift down and fade, smoke hangs, glitter twinkles round the die; glint 1300
 * Reduced: soft coloured lights bloom over the die in turn, a few glints, the card fades in.
 * Mid-roll intro: the die is a lit fuse, sparks fizzing off it as it tumbles, and little warm-up
 * rockets climb off it and pop; played after it, the show starts at the finale rocket's launch.
 */
export const DURATION = 2400;
const T = { finale: 700, hop: [700, 1100], glint: 1300, crackle: 350, twinkle: 2100 };

const GOLD = '#ffd36a';
const HOT = '#fff4dc';
const TRAIL = '#ff9a40';
/** The rockets: launch (ms), flight (ms), burst type, colours, where around the die, how high. */
const ROCKETS = [
  { launch: 100, flight: 600, type: 'finale', color: '#ffffff', end: '#9b5cff', angle: 5.6, dist: 0.6, height: 6.4 },
  { launch: 680, flight: 450, type: 'willow', color: GOLD, end: '#a8400a', angle: 2.4, dist: 2.2, height: 5.4 },
];
const STARS = ['#ff5fa8', '#4fe0ff', '#9cff5a', GOLD, '#b07bff'];
/** Fixed directions on a sphere (a golden spiral): a burst's stars, the same on every screen. */
const sphere = (n) =>
  Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    return { x: Math.cos(a) * rr, y, z: Math.sin(a) * rr };
  });
const WILLOW = sphere(36);
const FINALE = sphere(56);
const POP = sphere(14);
/** The intro's warm-up rockets: one every PACE ms from FIRST, each climbing for CLIMB ms. */
const INTRO_ROCKET = Object.freeze({ first: 160, pace: 640, climb: 520, colors: ['#ff5fa8', '#4fe0ff', GOLD] });

/** Its title card, at the finale. */
const CARD = Object.freeze({
  seed: 3141,
  glow: '#c27bff',
  lines: [
    { text: 'Spectacular!', size: 0.12, at: 0.28, fill: ['#ffffff', '#ffd23f'], edge: '#6a1a5a', enter: 'pop' },
    { text: 'Natural 20', size: 0.27, at: 0.6, fill: ['#fff0fb', '#ff5fa8'], edge: '#34106a', enter: 'pop', delay: 260, tilt: -2 },
  ],
  rays: { colors: ['#ff5fa8', '#4fe0ff'], spin: 0.16 },
  confetti: { colors: ['#ff5fa8', '#4fe0ff', '#9cff5a', '#ffd23f', '#b07bff', '#ffffff'], count: 220 },
  hold: 900,
  exit: 'rise',
});

export const fireworks = Object.freeze({
  id: 'scene-fireworks',
  name: 'Fireworks',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: the tumbling die is a lit fuse. A flickering gold spark rides it, fizzing sparks
   * off as it rolls, warm light under it; little rockets keep climbing off it on gold ribbons and
   * popping in small coloured bursts, the warm-up. At landing the show goes straight to the finale
   * rocket.
   */
  intro(env) {
    let fuse;
    let warm;
    let head;
    let flash;
    let trail;
    let last = null;
    let shot = -1; // the warm-up rocket in the air
    let popped = -1;
    const from = new THREE.Vector3();
    const top = new THREE.Vector3();
    const rp = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        fuse = c.glow(GOLD, { core: HOT, width: 0.45 });
        warm = c.glow(TRAIL, { core: GOLD, width: 0.6 });
        head = c.glow(GOLD, { core: HOT, width: 0.45 });
        flash = c.glow('#ffffff', { core: '#ffffff', width: 0.5 });
        trail = c.ribbon({ head: HOT, tail: TRAIL, width: c.r * 0.22, length: 14 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = span(t, 0, 250);
        // the fuse: a fizzing spark on the die, light flickering under it
        const flick = 0.8 + 0.2 * Math.sin(t / 23) * Math.sin(t / 37);
        fuse.set(k * flick, r * (0.9 + 0.25 * Math.sin(t / 31)), 0, p.y + r * 0.4, 0);
        warm.set(k * 0.55 * flick, r * 1.7, 0, 0.02, 0);
        if (dt > 0) {
          c.emit({ count: Math.max(1, Math.round(dt * 60 * k)), origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 2.2, spread: 1, life: 0.4, size: r * 0.08, kind: KIND.SPARK, color: HOT, colorEnd: TRAIL, gravity: -6 });
        }
        // the warm-up rockets: off the die, up, pop
        const i = Math.floor((t - INTRO_ROCKET.first) / INTRO_ROCKET.pace);
        if (i >= 0 && i !== shot) {
          shot = i;
          const a = i * 2.39996;
          from.set(p.x + Math.cos(a) * r * 0.6, Math.max(0.1, p.y), p.z + Math.sin(a) * r * 0.6);
          top.set(p.x + Math.cos(a) * r * 1.6, r * (3.6 + (i % 3) * 0.5), p.z + Math.sin(a) * r * 1.6);
          trail.reset();
        }
        const lt = i >= 0 ? t - INTRO_ROCKET.first - i * INTRO_ROCKET.pace : -1;
        const color = INTRO_ROCKET.colors[Math.max(0, i) % INTRO_ROCKET.colors.length];
        if (lt >= 0 && lt < INTRO_ROCKET.climb) {
          const e = easeOut(lt / INTRO_ROCKET.climb);
          rp.lerpVectors(from, top, e);
          trail.push(rp);
          trail.opacity(1);
          head.set(0.9, r * 0.45 * (1 + 0.15 * Math.sin(t / 25)), rp.x - p.x, rp.y, rp.z - p.z);
          if (dt > 0) c.emit({ count: 1, origin: rp, dir: { x: 0, y: -1, z: 0 }, speed: 0.8, spread: 0.5, life: 0.35, size: r * 0.07, kind: KIND.SPARK, color: HOT, colorEnd: TRAIL, gravity: -5 });
        } else {
          head.set(0);
          trail.opacity(lt >= 0 ? Math.max(0, 1 - span(lt, INTRO_ROCKET.climb, INTRO_ROCKET.climb + 160)) : 0);
        }
        if (lt >= INTRO_ROCKET.climb && popped !== i) {
          popped = i;
          for (const d of POP) c.emit({ count: 1, origin: top, dir: d, speed: 3, spread: 0.05, life: 0.8, size: r * 0.1, kind: KIND.SPARK, color, colorEnd: '#2a1050', gravity: -2, halo: 0.9 });
          c.emit({ count: 2, origin: top, speed: 0.6, spread: 1, life: 0.4, size: r * 0.25, kind: KIND.GLINT, color: '#ffffff', colorEnd: color });
        }
        const fk = lt >= INTRO_ROCKET.climb ? span(lt, INTRO_ROCKET.climb, INTRO_ROCKET.climb + 260) : 1;
        flash.tint(color).set(0.8 * (1 - fk) ** 2, r * lerp(1, 2.4, easeOut(fk)), top.x - p.x, top.y, top.z - p.z);
      },
    });
  },
  play(ctx) {
    let rockets; // per rocket: path, head, trail, flash, table light, flags
    let sparkle; // glitter twinkling round the die afterwards
    let lastEmit = null;
    let crackled = false;
    let glinted = false;
    let carded = false;
    let glittered = false;
    const pos = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const v = new THREE.Vector3();

    const burst = (s, R) => {
      const r = s.r;
      const o = R.top;
      const star = (d, speed, life, size, kind, color, end, gravity, extra = {}) =>
        s.emit({ count: 1, origin: o, dir: d, speed, spread: 0.04, life, size: r * size, kind, color, colorEnd: end, gravity, halo: 0.9, ...extra });
      if (R.type === 'willow') {
        for (const d of WILLOW) star(d, 4, 2.2, 0.15, KIND.EMBER, R.color, R.end, -3.2, { drag: 1.3, sizeEnd: 0.4 });
      } else {
        // the finale: white-hot streaks, multicolour stars, a light burst
        for (let i = 0; i < FINALE.length; i++) {
          const d = FINALE[i];
          if (i % 2) star(d, 8.5, 0.9, 0.16, KIND.STREAK, HOT, '#b07bff', -3);
          else star(d, 5.8, 1.6, 0.15, KIND.SPARK, STARS[(i / 2) % STARS.length], '#2a1050', -2);
        }
        s.emit({ count: 16, origin: o, speed: 1.6, spread: 1, life: 0.7, size: r * 0.3, kind: KIND.GLINT, color: '#ffffff', colorEnd: GOLD });
        s.effect('light-burst', { color: '#fff0fb', intensity: 1.2, duration: 900 });
        s.effect('sparkles', { color: GOLD, intensity: 1, duration: 1400 });
      }
      // a wisp of smoke where it burst
      s.emit({ count: 4, origin: o, speed: 0.4, spread: 1, life: 2.4, size: r * 1.1, sizeEnd: 3, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#55505e', colorEnd: '#26232c', alpha: 0.22, gravity: -0.15 });
    };

    return runScene(ctx, {
      duration: DURATION,
      introSkip: ROCKETS[0].launch, // the intro's warm-up rockets stand in for the fuse's lead-in
      setup(s) {
        const r = s.r;
        rockets = ROCKETS.map((spec) => {
          const dir = s.toward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.angle);
          const big = spec.type === 'finale';
          return {
            ...spec,
            from: s.beside(r * (big ? 1.1 : 1.5), dir),
            top: s.rest.clone().addScaledVector(dir, r * spec.dist).setY(r * spec.height),
            head: s.glow(GOLD, { core: HOT, width: 0.45 }),
            trail: s.ribbon({ head: HOT, tail: TRAIL, width: r * (big ? 0.4 : 0.28), length: 16 }),
            flash: s.glow(spec.color, { core: '#ffffff', width: 0.5 }),
            light: s.glow(spec.type === 'finale' ? '#c27bff' : spec.color, { core: spec.type === 'finale' ? '#ffffff' : spec.color, width: 0.55 }),
            p: new THREE.Vector3(),
            done: false,
          };
        });
        sparkle = s.glow(GOLD, { core: HOT, width: 0.5 });
      },
      full(t, s) {
        const r = s.r;
        const first = lastEmit === null;
        const dt = first ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        for (const R of rockets) {
          if (first && t > R.launch) R.skipped = true; // played introduced: its turn went by mid-roll
          if (R.skipped) continue;
          const t1 = R.launch + R.flight;
          const big = R.type === 'finale';
          // the climb: fast off the ground, slowing to the top, with a slight drift
          const flying = t >= R.launch && t < t1;
          if (flying) {
            const k = span(t, R.launch, t1);
            prev.copy(R.p);
            R.p.lerpVectors(R.from, R.top, easeOut(k));
            R.p.y = lerp(R.from.y + 0.1, R.top.y, easeOut(k));
            R.trail.push(R.p);
            R.trail.opacity(1);
            R.head.set(1, r * (big ? 0.9 : 0.6) * (1 + 0.15 * Math.sin(t / 25)), R.p.x, R.p.y, R.p.z);
            if (dt > 0 && k > 0) {
              v.subVectors(R.p, prev).divideScalar(Math.max(dt, 1e-3));
              s.emit({ count: Math.max(1, Math.round(dt * (big ? 110 : 70))), origin: R.p, dir: { x: -v.x, y: -v.y, z: -v.z }, speed: 0.8, spread: 0.5, life: 0.45, size: r * 0.08, kind: KIND.SPARK, color: HOT, colorEnd: TRAIL, gravity: -5 });
            }
          } else {
            R.head.set(0);
            R.trail.opacity(t >= t1 ? Math.max(0, 1 - span(t, t1, t1 + 180)) : 0);
          }
          // the burst
          if (t >= t1 && !R.done) {
            R.done = true;
            burst(s, R);
          }
          const k = span(t, t1, t1 + (big ? 450 : 350));
          R.flash.set(t >= t1 ? (1 - k) ** 2 * (big ? 1.5 : 1.1) : 0, r * lerp(1.4, big ? 4.5 : 3.2, easeOut(k)), R.top.x, R.top.y, R.top.z);
          const lk = span(t, t1, t1 + (big ? 1400 : 900));
          R.light.set(t >= t1 ? (1 - lk) ** 1.5 * (big ? 0.9 : 0.6) : 0, r * (big ? 5.5 : 4), R.top.x, 0.02, R.top.z);
        }
        // --- the finale: the card, a second crackling wave of glitter ---
        const fin = rockets[0];
        if (t >= T.finale && !carded) ((carded = true), s.card(CARD));
        if (t >= T.finale + T.crackle && !crackled) {
          crackled = true;
          for (let i = 0; i < 28; i++) {
            const d = FINALE[i * 2];
            const o = { x: fin.top.x + d.x * r * 2.6, y: fin.top.y + d.y * r * 1.5, z: fin.top.z + d.z * r * 2.6 };
            s.emit({ count: 1, origin: o, speed: 0.6, spread: 1, life: 0.5, size: r * 0.3, kind: KIND.GLINT, color: '#ffffff', colorEnd: STARS[i % STARS.length], gravity: -1.5 });
          }
        }
        // --- the die hops at the finale ---
        const h = span(t, ...T.hop);
        pos.copy(s.rest);
        pos.y += r * 0.7 * bump(h);
        s.die.pose(pos, h);
        // glitter twinkling round the die as the show fades
        if (t >= T.hop[1] && !glittered) {
          glittered = true;
          s.effect('glitter', { color: GOLD, intensity: 0.9, duration: 1200 });
        }
        const gk = span(t, T.finale, DURATION);
        sparkle.set(0.5 * bump(gk), r * 2.2, s.rest.x, 0.02, s.rest.z);
        if (t > T.finale + 400 && t < T.twinkle && dt > 0 && Math.round(t / 16) % 5 === 0) {
          const a = t / 120;
          s.emit({ count: 1, origin: { x: s.rest.x + Math.cos(a) * r * 1.3, y: s.rest.y + r * 0.6, z: s.rest.z + Math.sin(a) * r * 1.3 }, speed: 0.2, spread: 1, life: 0.6, size: r * 0.25, kind: KIND.GLINT, color: '#ffffff', colorEnd: STARS[Math.round(t / 80) % STARS.length] });
        }
        if (t >= T.glint && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: soft coloured lights bloom over the die in turn; the die stays put
        const r = s.r;
        rockets.forEach((R, i) => {
          const k = span(t, 150 + i * 280, 750 + i * 280);
          R.flash.set(0.7 * bump(k), r * 2.4, R.top.x, R.top.y, R.top.z);
          R.light.set(0.4 * bump(k), r * 3, R.top.x, 0.02, R.top.z);
        });
        if (t >= 500 && !carded) {
          carded = true;
          s.card(CARD);
          s.emit({ count: 8, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 0.9, size: r * 0.2, kind: KIND.GLINT, color: '#ffffff', colorEnd: GOLD });
        }
        if (t >= 650 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
