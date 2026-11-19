import * as THREE from 'three';
import { runScene, runSwallow, span, smooth, easeOut, easeIn, outBack, bump, lerp, TAU, KIND, SHAPE } from './kit.js';
import { makeGlow, makeRibbon } from './vfx.js';

/**
 * Shadow Thief (a natural 20). A thief made of shadow and violet light, no solid body: a column of
 * dark smoke over a pool of shadow, two glowing eyes, a coiling tendril of violet light for a hand.
 *
 * 0-380     a pool of shadow opens beside the die, a violet rim of light round it; the thief shoots
 *           up out of it as curling dark smoke shot through with violet motes; its eyes open
 * 300-560   a tendril of violet light snaps onto the die in a violet grip and drags it down into the
 *           pool, the thief ducking with it; a void implosion swallows it (hidden at 560)
 * 600-800   the thief springs back up and the pool spits the die straight out in a violet arc,
 *           two turns, onto its rest
 * 800       landing: a violet light burst and shockwave, sparks raking out; the card whips in
 * 850-1900  under the card: a bow (its eyes dip toward the die), and it sinks away, the pool closing
 *
 * The dark smoke body is backed by a strong violet back-glow and edged with violet light (rising
 * lilac embers and two coils of violet light wound round the column), so it reads on any table.
 *
 * The mid-roll catch (swallow): a pool of shadow opens under the tumbling die, tendrils of violet
 * light coil up round it and pull it under. At landing (the spit form) the pool where it vanished
 * closes, the thief rises beside the die and spits it back out in a violet arc onto its rest.
 */
export const DURATION = 1900;
export const REDUCED_DURATION = 1800;
/** The landing form after a mid-roll catch (swallow): the thief rises and spits the die back out. */
export const SPIT_DURATION = 1900;
const T = {
  pool: [0, 200],
  rise: [80, 380],
  eyes: [250, 350],
  reach: [300, 430],
  sink: [430, 560],
  duck: [430, 580],
  hide: 560,
  ripple: [560, 900],
  spit: 600,
  pop: [600, 780],
  fly: [600, 800],
  land: 800,
  bow: [850, 1250],
  leave: [1350, 1850],
};
const S = { close: [0, 300], pool: [0, 200], rise: [80, 380], inhale: [380, 500], spit: 500, fly: [500, 800], land: 800, cheer: [800, 1150], leave: [1350, 1850] };
// the mid-roll catch, in ms from the moment it starts
const C = { open: [0, 250], reach: [60, 260], grab: 260, pull: [260, 520], flash: [230, 560] };

const VOID = '#05030a';
const SHADE = '#1c1030';
const DEEP = '#4a1c9a';
const VIOLET = '#8a4cff';
const LILAC = '#c9a8ff';
const PALE = '#f2ebff';

/** Its title card, when the die lands back on its 20. */
const CARD = Object.freeze({
  seed: 4601,
  glow: '#7a3cff',
  lines: [
    { text: 'Nat', size: 0.12, at: 0.32, fill: ['#f2ebff', '#b48cff'], edge: '#1a0838', enter: 'whip', tilt: -5 },
    { text: '20!', size: 0.3, at: 0.62, fill: ['#ffffff', '#a46bff'], edge: '#24084a', enter: 'whip', delay: 200, tilt: 4 },
  ],
  vignette: 'rgba(12,0,30,0.85)',
  flash: '#cbb4ff',
  sparks: { colors: ['#f2ebff', '#b48cff', '#6a2cff'], count: 60 },
  shake: 0.6,
  hold: 900,
  exit: 'shatter',
});

/** Points along a quadratic curve from `a` over `ctrl` to `b`, at u (0..1), into `out`. */
function curve(a, ctrl, b, u, out) {
  const w = 1 - u;
  out.set(w * w * a.x + 2 * w * u * ctrl.x + u * u * b.x, w * w * a.y + 2 * w * u * ctrl.y + u * u * b.y, w * w * a.z + 2 * w * u * ctrl.z + u * u * b.z);
  return out;
}

export const shadowThief = Object.freeze({
  id: 'scene-shadow-thief',
  name: 'Shadow Thief',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * The mid-roll catch (effects/library/scene-flight.js): a pool of shadow opens under the
   * still-tumbling die and follows it; tendrils of violet light coil up round it and pull it under
   * (swallowed() turns true: the die is hidden) in a violet flash; the pool stays open under the
   * unseen die until it lands, when play() takes over with ctx.swallowed (the spit form).
   */
  swallow(env) {
    let pool;
    let rim;
    let flash;
    let tendrils;
    let reachY = 0;
    const q = new THREE.Vector3();
    return runSwallow(env, {
      grab: C.grab,
      setup(c) {
        pool = c.disc(VOID, 0);
        pool.renderOrder = 1;
        rim = makeGlow(c.kit, c.root, VIOLET, { core: LILAC, ring: 0.72, width: 0.16 });
        flash = makeGlow(c.kit, c.root, VIOLET, { core: PALE, width: 0.5 });
        tendrils = [0, 1, 2].map(() => makeRibbon(c.kit, c.root, { head: '#6a2cff', tail: PALE, width: c.r * 0.32, length: 16 }));
        reachY = c.r;
      },
      frame(t, c, p) {
        const r = c.r;
        const open = easeOut(span(t, ...C.open)) * lerp(1, 0.7, span(t, ...C.pull));
        const size = Math.max(1e-3, open * r * 1.15 * (1 + 0.05 * Math.sin(t / 150)));
        pool.scale.setScalar(size);
        pool.material.opacity = 0.8 * Math.min(1, open * 1.4);
        rim.set(open * (0.75 + 0.2 * Math.sin(t / 90)), size * 1.1, 0, 0.014, 0);
        if (t < C.grab) reachY = Math.max(r * 0.5, p.y); // the tendrils reach the die's height
        const up = smooth(span(t, ...C.reach)) * (1 - easeIn(span(t, ...C.pull)));
        tendrils.forEach((rib, j) => {
          rib.reset();
          if (up > 0.01) {
            // a helix coiling up round the die, its tip first (the ribbon's faint tail)
            for (let i = 0; i < 16; i++) {
              const u = 1 - i / 15;
              const a = (j * TAU) / 3 + u * 2.6 + t / 140;
              const rad = r * (0.8 - 0.4 * u);
              rib.push(q.set(Math.cos(a) * rad, 0.02 + u * reachY * up, Math.sin(a) * rad));
            }
          }
          rib.opacity(up > 0.01 ? 1 : 0);
        });
        flash.set(bump(span(t, ...C.flash)) * 1.1, r * 1.7, 0, 0.03, 0);
      },
    });
  },
  play(ctx) {
    const spitting = !ctx.reduced && !!ctx.borrow?.moving && !!ctx.swallowed;
    let pool; // the thief's pool of shadow
    let rim; // its violet rim of light
    let restPool; // the pool that swallowed the die mid-roll (spit form)
    let restRim;
    let aura; // the violet haze round the smoke body
    let backGlow; // a large soft violet light behind the whole figure
    let coils; // two ribbons of violet light wound round the smoke column
    let eyes; // two glowing eyes
    let clutch; // the violet grip round the die
    let ripple; // a ripple of light where the die was / will be
    let tendril; // the reaching hand: a ribbon of violet light
    let wake; // the die's violet wake when spat out
    let spot; // where the thief stands (ground), beside the die toward the table's centre
    let toDie; // unit vector from the thief to the die
    let size;
    let lastEmit = null;
    let smokeAcc = 0;
    let moteAcc = 0;
    let rimAcc = 0;
    let n = 0; // smoke puffs emitted (their spot round the column turns with it)
    let puffed = false;
    let landed = false;
    let spat = false;
    let cheered = 0;
    let glinted = false;
    const p = new THREE.Vector3();
    const head = new THREE.Vector3();
    const shoulder = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const v = new THREE.Vector3();
    const cv = new THREE.Vector3(); // a point on the coils

    /** The thief at `up` (0..1 risen), eyes `eye` open, leaning `lean` toward the die. */
    function thief(s, t, dt, open, up, eye, lean = 0, flare = 0) {
      const r = s.r;
      const ps = Math.max(1e-3, open * size);
      pool.scale.setScalar(ps);
      pool.material.opacity = 0.8 * Math.min(1, open * 1.4);
      rim.set(open * (0.8 + 0.15 * Math.sin(t / 110)), ps * 1.12, spot.x, 0.014, spot.z);
      const u = Math.max(0, up);
      head.copy(spot).addScaledVector(toDie, r * (0.15 + 0.45 * lean)).setY(r * 1.9 * u);
      shoulder.copy(spot).addScaledVector(toDie, r * 0.3).setY(r * 1.35 * u);
      const uk = Math.min(1, u);
      aura.set(uk * (0.7 + 0.4 * flare), r * (1.4 + 0.6 * u), spot.x, r * 0.6 * u, spot.z);
      backGlow.set(uk * (0.6 + 0.3 * flare) * (0.9 + 0.1 * Math.sin(t / 140)), r * (2.2 + 0.6 * u), (spot.x + head.x) / 2, 0.03, (spot.z + head.z) / 2);
      // the column's lit edge: two coils of violet light winding up round the smoke to the head
      coils.forEach((rib, j) => {
        rib.reset();
        if (uk > 0.05) {
          for (let i = 0; i < 16; i++) {
            const k = 1 - i / 15; // the top first (the ribbon's faint tail), the base last
            const a = j * Math.PI + k * 4.2 - t / 160;
            const rad = r * (0.55 - 0.25 * k);
            cv.lerpVectors(spot, head, k);
            rib.push(cv.set(cv.x + Math.cos(a) * rad, 0.05 + (head.y - 0.05) * k, cv.z + Math.sin(a) * rad));
          }
        }
        rib.opacity(uk > 0.05 ? 0.8 * uk : 0);
      });
      // the eyes: side by side, looking at the die; a blink now and then
      const blink = 1 - bump(span((t % 1700) / 1700, 0.9, 1));
      const ek = Math.min(1, u) * eye * blink;
      eyes.forEach((g, i) => {
        const o = (i ? 1 : -1) * r * 0.14;
        g.set(ek * (1 + flare), r * (0.16 + 0.06 * flare), head.x + toDie.z * o, head.y, head.z - toDie.x * o);
      });
      if (dt <= 0 || u < 0.05) return;
      // the body: dark smoke curling up off the pool, shot through with violet motes
      smokeAcc += dt * 34 * Math.min(1, u);
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        const a = n++ * 2.39996;
        const o = { x: spot.x + Math.cos(a) * r * 0.35, y: 0.05, z: spot.z + Math.sin(a) * r * 0.35 };
        s.emit({ count: 1, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 2.4 * Math.min(1, u), spread: 0.25, life: 0.8, size: r * 0.65, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: SHADE, colorEnd: VOID, alpha: 0.75, gravity: 0.4 });
      }
      // the lit rim: violet embers rising round the column's edge, leaving glowing trails
      rimAcc += dt * 36 * Math.min(1, u);
      while (rimAcc >= 1) {
        rimAcc -= 1;
        const a = n++ * 2.39996;
        const h = (n % 7) / 6;
        const o = { x: spot.x + Math.cos(a) * r * 0.6, y: 0.1 + head.y * 0.8 * h, z: spot.z + Math.sin(a) * r * 0.6 };
        s.emit({ count: 1, origin: o, dir: { x: Math.cos(a) * 0.3, y: 1, z: Math.sin(a) * 0.3 }, speed: 1.4, spread: 0.3, life: 0.6, size: r * 0.12, kind: KIND.EMBER, color: LILAC, colorEnd: VIOLET, gravity: 1, halo: 1 });
      }
      moteAcc += dt * 20 * Math.min(1, u);
      while (moteAcc >= 1) {
        moteAcc -= 1;
        const a = n++ * 2.39996;
        const o = { x: spot.x + Math.cos(a) * r * 0.5, y: 0.1, z: spot.z + Math.sin(a) * r * 0.5 };
        s.emit({ count: 1, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 1.8, spread: 0.5, life: 0.9, size: r * 0.08, kind: KIND.EMBER, color: LILAC, colorEnd: DEEP, gravity: 1.2, halo: 0.9 });
      }
    }

    /** The tendril from the shoulder to `to`, extended `ext` (0..1) of the way. */
    function reach(t, ext, to) {
      tendril.reset();
      if (ext > 0.01) {
        ctrl.addVectors(shoulder, to).multiplyScalar(0.5);
        ctrl.y = Math.max(shoulder.y, to.y) + shoulder.distanceTo(to) * 0.45;
        // the tip first (the ribbon's faint tail), the shoulder last (its wide head)
        for (let i = 0; i < 18; i++) {
          const u = ext * (1 - i / 17);
          curve(shoulder, ctrl, to, u, tip);
          const w = Math.sin(u * 7 - t / 90) * u * (1 - u) * 0.6;
          tip.x += toDie.z * w;
          tip.z -= toDie.x * w;
          tendril.push(tip);
        }
      }
      tendril.opacity(ext > 0.01 ? 0.95 : 0);
    }

    /** The landing: light, sparks, the card. */
    function land(s, at) {
      const r = s.r;
      s.die.pose(s.rest, 0);
      s.shake(0.3, 220);
      s.card(CARD);
      if (!glinted) ((glinted = true), s.glint());
      s.effect('light-burst', { color: '#cfb4ff', intensity: 1, duration: 800 });
      s.effect('shockwave', { color: VIOLET, intensity: 0.9, duration: 900 });
      const o = { x: at.x, y: 0.12, z: at.z };
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU + (i % 2) * 0.13;
        s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.3, z: Math.sin(a) }, speed: 5.5 + (i % 4), spread: 0.08, life: 0.5, size: r * 0.18, kind: KIND.STREAK, color: PALE, colorEnd: VIOLET, gravity: -8, floor: 0.04 });
      }
      s.emit({ count: 10, origin: s.rest, speed: 0.6, spread: 1, life: 0.7, size: r * 0.4, kind: KIND.GLINT, color: PALE, colorEnd: LILAC });
      s.emit({ count: 8, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.8, size: r * 0.9, sizeEnd: 2.6, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: SHADE, colorEnd: VOID, alpha: 0.6, gravity: 0.5 });
      s.emit({ count: 10, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 1.2, spread: 1, life: 1, size: r * 0.12, kind: KIND.EMBER, color: LILAC, colorEnd: VIOLET, gravity: 0.8, halo: 1 });
    }

    return runScene(ctx, {
      duration: spitting ? SPIT_DURATION : DURATION,
      reducedDuration: REDUCED_DURATION,
      setup(s) {
        const r = s.r;
        size = r * 1.1;
        spot = s.beside(r * 1.6);
        toDie = new THREE.Vector3().subVectors(s.ground, spot).normalize();
        pool = s.disc(VOID, 0);
        pool.position.set(spot.x, 0.012, spot.z);
        pool.renderOrder = 1;
        restPool = s.disc(VOID, 0);
        restPool.position.set(s.rest.x, 0.011, s.rest.z);
        restPool.renderOrder = 1;
        rim = s.glow(VIOLET, { core: LILAC, ring: 0.72, width: 0.16 });
        restRim = s.glow(VIOLET, { core: LILAC, ring: 0.72, width: 0.16 });
        backGlow = s.glow(DEEP, { core: VIOLET, width: 0.55 });
        aura = s.glow(VIOLET, { core: LILAC, width: 0.5 });
        coils = [0, 1].map(() => s.ribbon({ head: LILAC, tail: DEEP, width: r * 0.24, length: 16 }));
        eyes = [0, 1].map(() => s.glow('#b48cff', { core: '#ffffff', width: 0.4 }));
        clutch = s.glow(VIOLET, { core: PALE, width: 0.45 });
        ripple = s.glow(LILAC, { core: PALE, ring: 0.7, width: 0.12 });
        tendril = s.ribbon({ head: '#6a2cff', tail: PALE, width: r * 0.5, length: 18 });
        wake = s.ribbon({ head: PALE, tail: DEEP, width: r * 0.8, length: 20 });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        if (spitting) {
          // --- the pool that swallowed it closes where the die stopped; the thief's opens beside it ---
          const shut = 1 - easeIn(span(t, ...S.close));
          restPool.scale.setScalar(Math.max(1e-3, shut * r * 1.15));
          restPool.material.opacity = 0.8 * shut;
          restRim.set(shut * 0.9, r * 1.25 * shut + 1e-3, s.rest.x, 0.014, s.rest.z);
          const rk = span(t, 0, 520);
          ripple.set(0.8 * (1 - rk), r * lerp(0.6, 1.8, easeOut(rk)), s.rest.x, 0.016, s.rest.z);
          // --- the thief: rises, draws breath (leans back, eyes flaring), spits, cheers, sinks ---
          const open = easeOut(span(t, ...S.pool)) * (1 - easeIn(span(t, ...S.leave)));
          const hop = 1 + 0.2 * bump(span(t, S.cheer[0], S.cheer[0] + 250)) + 0.12 * bump(span(t, S.cheer[0] + 250, S.cheer[1]));
          const up = outBack(span(t, ...S.rise)) * (1 - easeIn(span(t, ...S.leave))) * hop;
          const breath = bump(span(t, ...S.inhale));
          const lean = -0.6 * breath + 0.5 * easeOut(span(t, S.spit, S.spit + 120)) * (1 - smooth(span(t, S.spit + 120, S.cheer[0])));
          thief(s, t, dt, open, up, smooth(span(t, 200, 320)) * (1 - span(t, 1600, 1800)), lean, breath * 1.2);
          tendril.opacity(0);
          if (t < S.spit) return;
          // --- the die: out of the mouth in a violet arc, two turns, onto its own face at rest ---
          s.die.hide(false);
          if (!spat) {
            spat = true;
            s.emit({ count: 14, origin: head, dir: { x: toDie.x, y: 0.4, z: toDie.z }, speed: 3.5, spread: 0.6, life: 0.5, size: r * 0.12, kind: KIND.SPARK, color: PALE, colorEnd: VIOLET, gravity: -4 });
          }
          const k = span(t, ...S.fly);
          if (k < 1) {
            p.lerpVectors(head, s.rest, easeOut(k));
            p.y = lerp(head.y, s.rest.y, k) + r * 1.4 * bump(k);
            s.die.pose(p, 2 * (1 - easeOut(k)));
            wake.push(p);
            wake.opacity(1);
            clutch.set(0.6 * (1 - k), r * 1.6, p.x, p.y, p.z);
          } else {
            if (!landed) ((landed = true), land(s, s.rest));
            wake.opacity(Math.max(0, 1 - span(t, S.land, S.land + 200)));
            clutch.set(0);
          }
          // the cheer: violet sparks thrown up off the thief, twice
          const beat = t >= S.cheer[0] + 250 ? 2 : t >= S.cheer[0] ? 1 : 0;
          if (beat > cheered) {
            cheered = beat;
            s.emit({ count: 12, origin: head, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 0.7, life: 0.6, size: r * 0.25, kind: KIND.GLINT, color: PALE, colorEnd: VIOLET, gravity: -3 });
          }
          return;
        }

        // --- the thief: shoots up, ducks into its pool with the die, springs back, bows and sinks ---
        const open = easeOut(span(t, ...T.pool)) * (1 - easeIn(span(t, ...T.leave)));
        const dip = 0.6 * smooth(span(t, ...T.duck)) * (1 - outBack(span(t, ...T.pop)));
        const up = (outBack(span(t, ...T.rise)) - dip) * (1 - easeIn(span(t, ...T.leave)));
        const eye = smooth(span(t, ...T.eyes)) * (1 - span(t, 1550, 1750));
        const spitLean = bump(span(t, T.spit, T.spit + 160));
        const lean = bump(span(t, ...T.bow)) + 0.5 * spitLean;
        thief(s, t, dt, open, up, eye, lean, 0.6 * lean);

        // --- the die: dragged into the pool, spat straight back out onto its rest ---
        let ext = 0;
        let to = p;
        let grip = 0;
        if (t < T.sink[0]) {
          s.die.pose(s.rest, 0);
          ext = smooth(span(t, ...T.reach));
          to = v.copy(s.rest).setY(s.rest.y + r * 0.7);
          p.copy(s.rest);
          grip = smooth(span(t, T.reach[1] - 80, T.sink[0]));
        } else if (t < T.hide) {
          const k = easeIn(span(t, ...T.sink));
          p.lerpVectors(s.rest, spot, k);
          p.y = lerp(s.rest.y, r * 0.15, k) + r * 0.5 * bump(k);
          s.die.pose(p, 0.5 * k);
          ext = 1;
          grip = 1;
        } else if (t < T.spit) {
          s.die.hide(true);
          ext = 1 - span(t, T.hide, T.spit);
          p.copy(spot).setY(0.1);
        } else if (t < T.land) {
          s.die.hide(false);
          if (!spat) {
            spat = true;
            s.emit({ count: 14, origin: { x: spot.x, y: 0.15, z: spot.z }, dir: { x: toDie.x, y: 1, z: toDie.z }, speed: 3.5, spread: 0.6, life: 0.5, size: r * 0.12, kind: KIND.SPARK, color: PALE, colorEnd: VIOLET, gravity: -4 });
          }
          const k = span(t, ...T.fly);
          p.lerpVectors(spot, s.rest, easeOut(k));
          p.y = lerp(r * 0.15, s.rest.y, k) + r * 1.6 * bump(k);
          s.die.pose(p, 2 * (1 - easeOut(k)));
          wake.push(p);
          wake.opacity(1);
          grip = 0.8 * (1 - k);
        } else {
          if (!landed) ((landed = true), land(s, s.rest));
          p.copy(s.rest);
          wake.opacity(Math.max(0, 1 - span(t, T.land, T.land + 200)));
        }
        reach(t, ext, to);
        clutch.set(grip * 0.75, r * 1.5, p.x, p.y, p.z);

        // --- the swallowing: a void implosion and dark smoke where it went under ---
        if (t >= T.hide && !puffed) {
          puffed = true;
          s.effect('burst-void', { at: spot.clone().setY(r * 0.3), intensity: 0.9 });
          s.emit({ count: 12, origin: { x: spot.x, y: 0.1, z: spot.z }, dir: { x: 0, y: 1, z: 0 }, speed: 1.2, spread: 1, life: 1.6, size: r * 0.8, sizeEnd: 2.6, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: SHADE, colorEnd: VOID, alpha: 0.7, gravity: 0.5 });
          s.emit({ count: 12, origin: { x: spot.x, y: 0.15, z: spot.z }, dir: { x: 0, y: 1, z: 0 }, speed: 1.6, spread: 1, life: 0.9, size: r * 0.12, kind: KIND.EMBER, color: LILAC, colorEnd: VIOLET, gravity: 0.8, halo: 1 });
        }
        // a ripple of light where the die was, calling it back
        const rk = span(t, ...T.ripple);
        ripple.set(rk > 0 && rk < 1 ? 0.85 * (1 - rk) : 0, r * lerp(0.5, 1.9, easeOut(rk)), s.rest.x, 0.016, s.rest.z);
      },
      calm(t, s) {
        // reduced: the thief's pool and eyes fade in beside the die, a violet grip on it, a glint
        const r = s.r;
        const open = smooth(span(t, 0, 250)) * (1 - smooth(span(t, 1300, 1800)));
        const up = smooth(span(t, 100, 450)) * (1 - smooth(span(t, 1200, 1700)));
        thief(s, t, 0, open, up, smooth(span(t, 250, 500)));
        clutch.set(bump(span(t, 400, 1200)) * 0.7, r * 1.5, s.rest.x, s.rest.y, s.rest.z);
        if (t >= 600 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({ count: 8, origin: s.rest, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.2, size: r * 0.1, kind: KIND.EMBER, color: LILAC, colorEnd: DEEP, gravity: 0.6 });
        }
      },
    });
  },
});
