import * as THREE from 'three';
import { runScene, runSwallow, span, easeOut, easeIn, outBack, bump, lerp, arc, smooth, TAU, KIND, SHAPE } from './kit.js';
import { makeGlow, makeRibbon } from './vfx.js';

/**
 * Black Hole (a natural 1): an accretion-disc vortex of violet light opens on the table, ribbons of
 * light and motes spiralling into a dead-black core, and it eats the die.
 *
 * Caught mid-roll (swallow): the vortex blooms under the still-tumbling die and gulps it.
 * Then, played swallowed:
 * 0-200     the vortex is there at rest, spinning; light streams spiral in
 * 80-600    indigestion: the disc wobbles and squashes, the photon ring flickers; it clenches
 * 620       burp: a violet flash, a shockwave, sparks and purple-grey smoke; the die is spat out
 *           in an arc with a light trail; the title card
 * 1150      it lands home a bit sheepishly (a small, slowing shuffle), a puff of dust
 * 1500-2000 the vortex spins down and collapses to a pinpoint that pops with a twinkle
 * Not caught: the vortex opens fast beside the die (0-300), drags it partway over while stripping
 * light off it (300-800), spits it home with a flash (800, the card), then collapses (1950).
 */
export const DURATION = 2300;
const T = { open: [0, 200], wobble: [80, 600], clench: [450, 600], burp: 620, out: [620, 1150], land: 1150, close: [1500, 2000], pop: 2000 };
const U = { open: [0, 300], tug: [300, 800], spit: 800, hop: [800, 1200], close: [1500, 2000], pop: 1950 };

const WHITE = '#f4ecff';
const LILAC = '#c9a0ff';
const VIOLET = '#8a4cff';
const DEEP = '#3a0f7a';
const NIGHT = '#14002e';
const ARMS = 4;
const CORE = [
  [0.95, 0.22],
  [0.8, 0.32],
  [0.68, 0.5],
  [0.58, 0.97],
]; // the dark core: stacked black discs (radius, opacity), a soft edge without a shader

/** Its title card, at the burp (or the spit). */
const CARD = Object.freeze({
  seed: 404,
  font: 'tech',
  glow: '#9b5cff',
  lines: [
    { text: 'Void', size: 0.12, at: 0.32, fill: ['#efe4ff', '#9a74d8'], edge: '#1a0833', enter: 'zoom', tilt: -3 },
    { text: 'Fail', size: 0.28, at: 0.6, fill: ['#c9a6ff', '#4a1a8a'], edge: '#0a0214', enter: 'zoom', delay: 260, tilt: 2 },
  ],
  rays: { colors: ['#5a22c8', NIGHT], spin: -0.22 },
  vignette: 'rgba(10,0,24,0.92)',
  flash: '#b98cff',
  sparks: { colors: ['#f4ecff', '#a66bff', '#5a22c8'], count: 50 },
  hold: 900,
  exit: 'shatter',
});

/**
 * The vortex, on the stage `s` or a catch `c` (kit + root + disc): a broad violet haze, the
 * accretion disc's band of light, a hot photon ring, the stacked black core over them, and light
 * ribbons spiralling inward. set(t, open, size, cx, cz, wob, period) draws one frame.
 */
function makeVortex(h, r) {
  const glow = (color, opts) => makeGlow(h.kit, h.root, color, opts);
  const haze = glow(DEEP, { core: VIOLET, width: 0.6 });
  const band = glow(VIOLET, { core: LILAC, ring: 0.45, width: 0.24 });
  const photon = glow(WHITE, { ring: 0.64, width: 0.07, renderOrder: 5 });
  const core = CORE.map(([, o]) => {
    const d = h.disc('#000000', o);
    d.renderOrder = 4;
    d.visible = false;
    return d;
  });
  const arms = [];
  for (let i = 0; i < ARMS; i++) arms.push({ rib: makeRibbon(h.kit, h.root, { head: WHITE, tail: DEEP, width: r * 0.34, length: 20 }), u: -1 });
  const pt = new THREE.Vector3();
  const squash = (m, wob) => ((m.scale.x *= 1 + wob), (m.scale.y *= 1 - wob)); // plane: local y is world z
  return {
    set(t, open, size, cx, cz, wob = 0, period = 950) {
      const a = Math.max(0, open);
      haze.set(a * 0.8, size * 3.4, cx, 0.018, cz);
      band.set(a * (0.85 + 0.15 * Math.sin(t / 70)), size * 2.3, cx, 0.019, cz);
      photon.set(a * (0.75 + 0.25 * Math.sin(t / 37)), size, cx, 0.024, cz);
      squash(haze, wob);
      squash(band, wob);
      squash(photon, wob);
      core.forEach((d, i) => {
        d.visible = a > 0.001;
        d.material.opacity = CORE[i][1] * Math.min(1, a * 1.4);
        d.scale.setScalar(Math.max(1e-3, size * CORE[i][0]));
        squash(d, wob);
        d.position.set(cx, 0.02, cz);
      });
      arms.forEach((arm, i) => {
        const u = (((t / period + i / ARMS) % 1) + 1) % 1;
        if (u < arm.u) arm.rib.reset();
        arm.u = u;
        const rad = size * lerp(2.1, 0.5, u ** 0.85);
        const ang = (i / ARMS) * TAU + u * TAU * 1.3 + t / 700;
        pt.set(cx + Math.cos(ang) * rad * (1 + wob), 0.03, cz + Math.sin(ang) * rad * (1 - wob));
        arm.rib.push(pt);
        arm.rib.opacity(a * smooth(Math.min(1, u * 4)) * (1 - u ** 3));
      });
    },
  };
}

/** A light streak pulled in from the disc's rim toward the core (deterministic angle `a`). */
function inflow(s, a, size, cx, cz) {
  const R = size * 2.1;
  const dir = { x: -Math.cos(a) * 0.75 - Math.sin(a) * 0.65, y: 0, z: -Math.sin(a) * 0.75 + Math.cos(a) * 0.65 };
  s.emit({ count: 1, origin: { x: cx + Math.cos(a) * R, y: 0.05, z: cz + Math.sin(a) * R }, dir, speed: R * 2.6, spread: 0.05, drag: 3, life: 0.6, size: s.r * 0.12, kind: KIND.STREAK, color: WHITE, colorEnd: VIOLET, halo: 0.7 });
}

export const blackHole = Object.freeze({
  id: 'scene-black-hole',
  name: 'Black Hole',
  outcome: 'critical-failure',
  duration: DURATION,
  /** The mid-roll catch: the vortex blooms under the tumbling die, gulps it, and closes. */
  swallow(env) {
    let vortex;
    let flash;
    return runSwallow(env, {
      grab: 250,
      setup(c) {
        vortex = makeVortex(c, c.r);
        flash = makeGlow(c.kit, c.root, LILAC, { core: '#ffffff', width: 0.4, renderOrder: 6 });
      },
      frame(t, c) {
        const open = easeOut(span(t, 0, 200)) * (1 - easeIn(span(t, 320, 650)));
        const gulp = 0.18 * bump(span(t, 220, 380)); // a little gulp as it slurps
        vortex.set(t * 1.6, open, c.r * (1.1 + gulp), 0, 0, 0.06 * Math.sin(t / 40), 700);
        flash.set(bump(span(t, 230, 420)) * 0.9, c.r * 1.2, 0, 0.026, 0);
      },
    });
  },
  play(ctx) {
    let vortex;
    let trail; // the light trail behind the spat-out die
    let pop; // the pinpoint flash as the vortex closes
    let at; // the vortex centre (on the table)
    let from; // where the burp starts: in the core
    let near; // the vortex, at the die's height
    let lastEmit = null;
    let spat = false;
    let landed = false;
    let popped = false;
    let glinted = false;
    let emitted = 0; // streaks emitted so far (their angles walk the golden angle)
    let acc = 0; // streaks owed (dt-based)
    const p = new THREE.Vector3();
    return runScene(ctx, {
      duration: DURATION,
      setup(s) {
        vortex = makeVortex(s, s.r);
        trail = s.ribbon({ head: WHITE, tail: DEEP, width: s.r * 0.9, length: 18 });
        pop = s.glow(LILAC, { core: '#ffffff', width: 0.35, renderOrder: 6 });
        at = s.swallowed ? s.ground.clone() : s.beside(s.r * 2.1);
        from = s.ground.clone().setY(s.rest.y * 0.3);
        near = at.clone().setY(s.rest.y);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        const sw = s.swallowed;
        const P = sw ? T : U;
        // --- the vortex ---
        let open;
        let size;
        let wob = 0;
        if (sw) {
          open = outBack(span(t, ...T.open)) * (1 - easeIn(span(t, ...T.close)));
          wob = 0.16 * Math.sin(t / 55) * span(t, T.wobble[0], T.wobble[0] + 200) * (1 - span(t, T.clench[0], T.burp));
          const clench = easeIn(span(t, ...T.clench)) * (1 - span(t, T.burp, T.burp + 60));
          size = r * (1.1 - 0.3 * clench + 0.45 * bump(span(t, T.burp, T.burp + 220)));
        } else {
          open = outBack(span(t, ...U.open)) * (1 - easeIn(span(t, ...U.close)));
          wob = 0.07 * Math.sin(t / 60);
          size = r * (1 + 0.15 * easeIn(span(t, ...U.tug)) * (1 - span(t, U.spit, U.spit + 80)) + 0.35 * bump(span(t, U.spit, U.spit + 220)));
        }
        const spinning = 950 - 350 * span(t, sw ? T.wobble[0] : U.tug[0], sw ? T.burp : U.spit);
        vortex.set(t, open, size, at.x, at.z, wob, spinning);
        // light pulled in from the rim, while it is open
        if (dt > 0 && open > 0.3 && t < P.close[0]) {
          acc += dt * 45;
          for (; acc >= 1; acc--) inflow(s, emitted++ * 2.39996, size, at.x, at.z);
        }
        // --- the die ---
        let flying = false;
        if (sw) {
          if (t >= T.burp) {
            s.die.hide(false);
            const k = span(t, ...T.out);
            arc(from, s.rest, easeOut(k), r * 2.2, p);
            const shy = 0.025 * Math.sin((t - T.land) / 70) * span(t, T.land, T.land + 100) * (1 - span(t, T.land + 100, T.land + 700));
            s.die.pose(p, 1 - easeOut(k) + shy);
            flying = k < 1;
          }
        } else {
          const pull = easeIn(span(t, ...U.tug)) * 0.45;
          const back = easeOut(span(t, ...U.hop));
          p.lerpVectors(s.rest, near, pull * (1 - back));
          p.y += r * 0.9 * bump(span(t, ...U.hop)); // the spit is a hop
          const quiver = 0.05 * Math.sin(t / 30) * span(t, 450, 700) * (1 - span(t, 720, 800));
          s.die.pose(p, quiver + 0.6 * pull - 0.5 * bump(span(t, ...U.hop)));
          flying = t >= U.hop[0] && t < U.hop[1];
          // the hole strips light off the die as it drags it
          if (dt > 0 && t > U.tug[0] && t < U.spit && Math.round(t / 16) % 2 === 0) {
            s.emit({ count: 1, origin: p, dir: { x: at.x - p.x, y: -0.3, z: at.z - p.z }, speed: 3, spread: 0.35, drag: 2.5, life: 0.5, size: r * 0.14, kind: KIND.SPIRAL, color: WHITE, colorEnd: VIOLET });
          }
        }
        if (flying) {
          trail.push(p);
          trail.opacity(0.85);
        } else trail.opacity(0);
        // --- the burp (or spit) ---
        const spitAt = sw ? T.burp : U.spit;
        if (t >= spitAt && !spat) {
          spat = true;
          s.shake(0.28, 240);
          s.card(CARD);
          const c = at.clone().setY(0.1);
          s.effect('light-burst', { color: '#b07cff', intensity: 1, duration: 700, at: c });
          s.effect('shockwave', { color: VIOLET, intensity: 0.9, duration: 800, at: c });
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * TAU + (i % 2) * 0.13;
            s.emit({ count: 1, origin: c, dir: { x: Math.cos(a), y: 0.5, z: Math.sin(a) }, speed: 6 + (i % 4), spread: 0.1, life: 0.5, size: r * 0.16, kind: KIND.STREAK, color: WHITE, colorEnd: VIOLET, gravity: -8, floor: 0.04 });
          }
          s.emit({ count: 10, origin: c, dir: { x: 0, y: 1, z: 0 }, speed: 1.2, spread: 1, life: 1.8, size: r * 0.9, sizeEnd: 2.8, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#5a4a6e', colorEnd: '#26202e', alpha: 0.55, gravity: 0.5 });
          s.emit({ count: 6, origin: c, speed: 1.5, spread: 1, life: 0.7, size: r * 0.4, kind: KIND.GLINT, color: WHITE, colorEnd: LILAC });
        }
        const landAt = sw ? T.land : U.hop[1];
        if (t >= landAt && !landed) {
          landed = true;
          s.shake(0.1, 120);
          s.emit({ count: 6, origin: { x: s.rest.x, y: 0.1, z: s.rest.z }, dir: { x: 0, y: 0.2, z: 0 }, speed: 1.4, spread: 1, life: 1, size: r * 0.6, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#8a8294', colorEnd: '#4a4552', alpha: 0.45 });
        }
        // --- it closes to a pinpoint and pops ---
        pop.set(bump(span(t, P.pop - 60, P.pop + 260)) * 1.1, r * lerp(0.4, 1.3, easeOut(span(t, P.pop - 60, P.pop + 260))), at.x, 0.028, at.z);
        if (t >= P.pop && !popped) {
          popped = true;
          s.emit({ count: 8, origin: at.clone().setY(0.15), speed: 1.8, spread: 1, life: 0.6, size: r * 0.3, kind: KIND.GLINT, color: '#ffffff', colorEnd: LILAC });
        }
        if (t >= (sw ? 1300 : 1350) && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the vortex fades in beside the die, swirls and closes; the die stays put
        const k = bump(t / 1600);
        vortex.set(t, k, s.r * 0.9, at.x, at.z, 0, 1100);
        if (t >= 300 && !spat) ((spat = true), s.card(CARD));
        if (t >= 700 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
