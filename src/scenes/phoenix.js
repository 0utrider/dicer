import * as THREE from 'three';
import { runScene, runSwallow, span, smooth, easeOut, easeIn, bump, lerp, TAU, KIND, SHAPE } from './kit.js';
import { makeGlow, makeRibbon } from './vfx.js';

/**
 * Phoenix (a natural 20): a firebird made of flame, no solid shapes. Two sweeping wings of flame
 * ribbon beating either side of a blazing body, a long streaming tail, embers shed behind it.
 *
 *   0-650     it swoops in fast from high off the table in a curling dive, shedding embers
 *   650       it bursts into a fireball on the die: a light burst, a shockwave, flame bursting out
 *             and up, the title card rises in; the die is tossed up by the blast and drops home
 *   650-2200  under the card: flames and embers rise off the spot, a ring of fire cooling
 * Caught mid-roll (swallow): the firebird swoops onto the tumbling die, snatches it in a flash and
 * climbs away. Then, over the spot where it stopped, it circles in (0-350), dives (350-650) and
 * bursts the same way at 650, the die dropping out of the flames home with a hop.
 */
export const DURATION = 2200;
const T = { burst: 650, circle: [0, 350], dive: [350, 650], toss: [650, 1100] };
const GRAB = 300; // the catch: ms until the die is snatched

const HOT = '#fff6e0';
const GOLD = '#ffd04a';
const FLAME = '#ff8a1e';
const EMBER = '#ff4a12';
const DEEP = '#a01a06';

const TAIL = 22; // ribbon points
const WING = 12;
const LAG = 22; // ms of path between points

const CARD = Object.freeze({
  seed: 3602,
  glow: '#ff7a1a',
  font: 'display',
  lines: [
    { text: 'Reborn', size: 0.12, at: 0.3, fill: ['#ffffff', '#ffd27a'], edge: '#8a2a04', enter: 'rise', tilt: -2 },
    { text: 'Critical!', size: 0.27, at: 0.62, fill: ['#fff8e8', '#ff8a1e'], edge: '#7a1a04', enter: 'rise', delay: 240, tilt: 1 },
  ],
  flash: '#fff4dc',
  sparks: { colors: ['#fff6e0', '#ffd04a', '#ff8a1e', '#ff4a12'], count: 100, up: true },
  hold: 900,
  exit: 'rise',
});

/**
 * The firebird, from glow(color, opts) and ribbon(opts) makers (a stage's or a catch's): a body
 * glow, two wing ribbons traced by the beating wing tips, a long tail ribbon.
 */
function buildBird(glow, ribbon, r) {
  return {
    tail: ribbon({ head: HOT, tail: EMBER, width: r * 0.75, length: TAIL }),
    wings: [0, 1].map(() => ribbon({ head: '#fff0c0', tail: '#ff5a14', width: r * 0.55, length: WING })),
    body: glow(FLAME, { core: HOT, width: 0.5 }),
    crown: glow(GOLD, { core: '#ffffff', width: 0.4 }),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    q: new THREE.Vector3(),
    head: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
  };
}

/** The direction of travel at path-time tau (horizontal, unit) into bird.dir. */
function heading(bird, path, tau) {
  path(tau, bird.a);
  path(tau + 16, bird.b);
  bird.b.sub(bird.a).setY(0);
  if (bird.b.lengthSq() > 1e-8) bird.dir.copy(bird.b).normalize();
  return bird.dir;
}

/** Draws the bird at path(t): o its opacity, grow extra size. Returns its head (body centre). */
function drawBird(bird, path, t, o, r, grow = 1) {
  bird.tail.reset();
  for (let i = TAIL - 1; i >= 0; i--) {
    path(t - i * LAG, bird.q);
    bird.tail.push(bird.q);
  }
  bird.wings.forEach((w, side) => {
    const sd = side ? 1 : -1;
    w.reset();
    for (let i = WING - 1; i >= 0; i--) {
      const tau = t - i * LAG;
      const d = heading(bird, path, tau);
      const flap = Math.sin(tau / 70);
      const reach = r * (0.75 + 0.55 * flap) * grow;
      path(tau, bird.q);
      bird.q.x += d.z * reach * sd - d.x * r * 0.25 * (1 - flap);
      bird.q.z += -d.x * reach * sd - d.z * r * 0.25 * (1 - flap);
      bird.q.y += r * 0.2 * flap;
      w.push(bird.q);
    }
    w.opacity(o);
  });
  bird.tail.opacity(o);
  path(t, bird.head);
  const d = heading(bird, path, t);
  bird.body.set(o, r * 1.2 * grow * (1 + 0.08 * Math.sin(t / 45)), bird.head.x, bird.head.y + 0.01, bird.head.z);
  bird.crown.set(o * 0.9, r * 0.45 * grow, bird.head.x + d.x * r * 0.35, bird.head.y + 0.02, bird.head.z + d.z * r * 0.35);
  return bird.head;
}

export const phoenix = Object.freeze({
  id: 'scene-phoenix',
  name: 'Phoenix',
  outcome: 'critical-success',
  duration: DURATION,
  /** The mid-roll catch: the firebird swoops onto the tumbling die, snatches it and climbs away. */
  swallow(env) {
    let bird;
    let flash;
    let py = 0;
    let r = 0.9;
    // in the catch's frame (c.root follows the die on the table)
    const path = (t, out) => {
      if (t <= GRAB) {
        const k = span(t, 0, GRAB) ** 2;
        return out.set(lerp(r * 5, 0, k), lerp(py + r * 3.5, py + r * 0.6, k), lerp(r * 3, 0, k));
      }
      const k = span(t, GRAB, GRAB + 600) ** 2;
      return out.set(lerp(0, -r * 5, k), lerp(py + r * 0.6, py + r * 3, k), lerp(0, -r * 3.5, k));
    };
    return runSwallow(env, {
      grab: GRAB,
      setup(c) {
        r = c.r;
        bird = buildBird(
          (color, opts) => makeGlow(c.kit, c.root, color, opts),
          (opts) => makeRibbon(c.kit, c.root, opts),
          r,
        );
        flash = makeGlow(c.kit, c.root, GOLD, { core: HOT, width: 0.5 });
      },
      frame(t, c, p) {
        py = p.y;
        const o = span(t, 0, 100) * (1 - span(t, GRAB + 200, GRAB + 600));
        drawBird(bird, path, t, o, c.r);
        const f = span(t, GRAB - 40, GRAB + 300);
        flash.set(1.2 * bump(f), c.r * (1 + 2 * f), 0, py, 0);
      },
    });
  },
  play(ctx) {
    let bird;
    let fireball; // the burst's expanding light
    let fireRing; // the ring of fire on the table
    let pool; // the warm light under the bird and die
    let burstAt;
    let s0;
    let lastEmit = null;
    let burst = false;
    let landed = false;
    let glinted = false;
    let burstT = Infinity;
    const p = new THREE.Vector3();

    // Swallowed: circles in over the stop spot, dives a little and bursts.
    const circlePath = (t, out) => {
      const s = s0;
      const r = s.r;
      const a = t * 0.009;
      const k = easeOut(span(t, ...T.circle));
      const dive = smooth(span(t, ...T.dive));
      const rho = lerp(r * 7, r * 1.8, k) * (1 - dive);
      const h = s.rest.y + lerp(r * 4, r * 2.4, k) - r * 0.6 * dive;
      return out.set(s.rest.x + Math.sin(a) * rho, h, s.rest.z + Math.cos(a) * rho);
    };
    // Not swallowed: swoops in fast, curling down from high off the table onto the die (T.burst).
    const swoopPath = (t, out) => {
      const s = s0;
      const r = s.r;
      const w = 1 - span(t, 0, T.burst);
      const a = 0.7 + 1.6 * w;
      const rho = r * 6 * w ** 1.4;
      const h = s.rest.y + r * 0.8 + r * 3.8 * w * w;
      return out.set(s.rest.x + Math.sin(a) * rho, h, s.rest.z + Math.cos(a) * rho);
    };

    /** The fireball: one-shot light, shockwave, flames bursting out and up, smoke; the card. */
    const explode = (s) => {
      const r = s.r;
      burst = true;
      s.shake(0.3, 220);
      s.card(CARD);
      s.effect('light-burst', { color: '#ffc061', intensity: 1.2, duration: 900 });
      s.effect('shockwave', { color: FLAME, intensity: 1, duration: 900 });
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + (i % 2) * 0.13;
        s.emit({ count: 1, origin: burstAt, dir: { x: Math.cos(a), y: 0.15 - (i % 3) * 0.15, z: Math.sin(a) }, speed: 5 + (i % 4), spread: 0.1, life: 0.55, size: r * 0.2, kind: KIND.STREAK, color: HOT, colorEnd: EMBER, gravity: -4, floor: 0.04 });
      }
      s.emit({ count: 36, origin: burstAt, dir: { x: 0, y: 1, z: 0 }, speed: 2.4, spread: 1, life: 1.1, size: r * 0.45, sizeEnd: 0.2, kind: KIND.EMBER, shape: SHAPE.FLAME, color: GOLD, colorEnd: DEEP, gravity: 1.5, halo: 0.9 });
      s.emit({ count: 24, origin: burstAt, dir: { x: 0, y: 1, z: 0 }, speed: 3.5, spread: 1.1, life: 1.5, size: r * 0.15, kind: KIND.EMBER, color: FLAME, colorEnd: DEEP, gravity: -2, floor: 0.04, halo: 0.8 });
      s.emit({ count: 8, origin: burstAt, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 2.2, size: r * 1, sizeEnd: 3, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a3226', colorEnd: '#1c1614', alpha: 0.45, gravity: 0.6 });
    };

    /** Per frame: the fireball's light fading, the ring of fire cooling, flames rising off it. */
    const afterglow = (t, s, dt) => {
      if (!burst) return;
      const r = s.r;
      const k = span(t, burstT, burstT + 700);
      fireball.set(1.4 * (1 - k) ** 1.5, r * lerp(1.5, 4, easeOut(k)), burstAt.x, burstAt.y, burstAt.z);
      const rk = span(t, burstT, burstT + 1500);
      fireRing.set((1 - rk) ** 1.3 * 1.1, r * lerp(1.2, 2.6, easeOut(span(t, burstT, burstT + 400))), s.rest.x, 0.02, s.rest.z);
      if (dt > 0 && t < burstT + 1300 && Math.round(t / 16) % 2 === 0) {
        const f = Math.floor(t / 16);
        const a = (f * 2.39996) % TAU; // a golden-angle walk round the ring
        const rho = r * 1.2;
        s.emit({ count: 1, origin: { x: s.rest.x + Math.cos(a) * rho, y: 0.1, z: s.rest.z + Math.sin(a) * rho }, dir: { x: 0, y: 1, z: 0 }, speed: 1.4, spread: 0.3, life: 0.7, size: r * 0.35, sizeEnd: 0.2, kind: KIND.EMBER, shape: SHAPE.FLAME, color: GOLD, colorEnd: EMBER, gravity: 1.2 });
      }
    };

    /** The embers the bird sheds behind it as it flies. */
    const shed = (s, head, dt) => {
      if (dt <= 0) return;
      const r = s.r;
      const n = Math.max(1, Math.round(dt * 70));
      s.emit({ count: n, origin: head, dir: { x: -bird.dir.x, y: 0.4, z: -bird.dir.z }, speed: 1, spread: 0.7, life: 0.8, size: r * 0.16, kind: KIND.EMBER, color: GOLD, colorEnd: DEEP, gravity: -1.5, halo: 0.8 });
    };

    const fromFlames = (t, s, dt) => {
      const r = s.r;
      const o = span(t, 0, 200) * (1 - span(t, T.burst, T.burst + 150));
      const head = drawBird(bird, circlePath, Math.min(t, T.burst), o, r, 1 + 0.5 * span(t, T.burst, T.burst + 150));
      if (t < T.burst) {
        shed(s, head, dt);
        pool.set(0.35 * o, r * 2.2, head.x, 0.02, head.z);
        return;
      }
      pool.set(0);
      if (!burst) ((burstT = t), explode(s));
      afterglow(t, s, dt);
      s.die.hide(false);
      const k = span(t, T.burst, T.burst + 400);
      p.copy(s.rest);
      p.y += r * 1.8 * (1 - easeIn(k)) + r * 0.3 * bump(span(t, T.burst + 400, T.burst + 650));
      s.die.pose(p, easeOut(k));
      if (k >= 1 && !landed) ((landed = true), s.shake(0.12, 120));
      if (t >= T.burst + 500 && !glinted) ((glinted = true), s.glint());
    };

    const swoop = (t, s, dt) => {
      const r = s.r;
      const o = span(t, 0, 120) * (1 - span(t, T.burst, T.burst + 150));
      const head = drawBird(bird, swoopPath, Math.min(t, T.burst), o, r, 1 + 0.5 * span(t, T.burst, T.burst + 150));
      if (t < T.burst) {
        shed(s, head, dt);
        pool.set(0.4 * o, r * 2.2, head.x, 0.02, head.z);
        s.die.pose(s.rest, 0);
        return;
      }
      pool.set(0);
      if (!burst) ((burstT = t), explode(s));
      afterglow(t, s, dt);
      // the blast tosses the die up; it turns once and drops home
      const k = span(t, ...T.toss);
      p.copy(s.rest);
      p.y += r * 1.2 * 4 * k * (1 - k);
      s.die.pose(p, smooth(k));
      if (k >= 1 && !landed) ((landed = true), s.shake(0.12, 120));
      if (t >= T.burst + 100 && !glinted) ((glinted = true), s.glint());
    };

    return runScene(ctx, {
      duration: DURATION,
      setup(s) {
        s0 = s;
        pool = s.glow(EMBER, { core: FLAME, width: 0.55 });
        fireRing = s.glow(FLAME, { core: HOT, ring: 0.68, width: 0.16 });
        bird = buildBird(s.glow, s.ribbon, s.r);
        fireball = s.glow(FLAME, { core: HOT, width: 0.45 });
        burstAt = s.rest.clone();
        burstAt.y += s.swallowed ? s.r * 1.8 : s.r * 0.8;
      },
      full(t, s) {
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        if (s.swallowed) fromFlames(t, s, dt);
        else swoop(t, s, dt);
      },
      calm(t, s) {
        // reduced: a ring of fire flares around the die, flames rise; the card; the die stays put
        const r = s.r;
        const k = bump(span(t, 0, 1500));
        fireRing.set(k, r * lerp(1.4, 1.9, easeOut(span(t, 0, 1500))), s.rest.x, 0.02, s.rest.z);
        pool.set(k * 0.6, r * 1.8, s.rest.x, 0.021, s.rest.z);
        if (t >= 400 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 12, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 1, spread: 1, life: 1, size: r * 0.3, sizeEnd: 0.2, kind: KIND.EMBER, shape: SHAPE.FLAME, color: GOLD, colorEnd: EMBER, gravity: 0.8 });
        }
      },
    });
  },
});
