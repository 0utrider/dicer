import * as THREE from 'three';
import {
  runScene,
  runIntro,
  span,
  easeOut,
  easeIn,
  smooth,
  bump,
  lerp,
  arc,
  TAU,
  KIND,
  SHAPE,
} from './kit.js';

/**
 * Crows (a natural 1): an ill omen. The crows are swarms of dark feather flakes and shadowy wisps
 * from the dice effects' own particle pool, each with a crimson glint of an eye; no solid shapes.
 * Each bird is backed by a soft blood-red aura and its wings shed crimson embers and trail crimson
 * wing strokes (ribbons), so the dark silhouettes have a lit edge on dark tables too.
 *
 * 0-450     three crows swoop straight in from far out over the die like it's already dead; a
 *           faint crimson omen ring gathers on the table under them; a caw (a ripple of dark red)
 * 200-550   one swoops down beside the die in a flurry of feathers
 * 610-1330  it pecks at the die four times: each peck a jolt of the die, a nick of light, chips
 *           flying; the first (~700) is the climax, bringing the title card thudding in
 * 1350-2000 under the card they all burst off in different directions, shedding feathers,
 *           dissolving into wisps
 *
 * Mid-roll (intro): the crows have found the die before it stops. Three of them (the same dark
 * feather swarms with crimson-lit wing edges, auras, wing strokes and eyes) spiral in and circle
 * over the tumbling die, following it across the table, while a crimson omen ring tightens around
 * it and a blood-red glow chases along the table behind it. At landing the show picks up with them
 * circling and one already gliding down to peck.
 */
export const DURATION = 2200;
const T = {
  gather: [0, 450],
  appear: [0, 200],
  land: [200, 550],
  leave: [1350, 2000],
  vanish: [1600, 2000],
};
const COUNT = 3;
const PECKS = [610, 790, 970, 1150]; // each lands at p + PECK_MS / 2: the first, with the card, at 700
const PECK_MS = 180;
const CAWS = [
  [150, 1],
  [450, 2],
  [1250, 1],
]; // [ms, crow]

const INK = '#120e16';
const PLUM = '#2a1424';
const SHADE = '#0a080c';
const EYE = '#ff2a3a';
const OMEN = '#6a0a1a';
// the lit rim and back-glow that make the dark birds read on any table (a dark body, a red edge)
const BLOOD = '#a00c1e';
const RIM = '#ff3a4a';
const RIM_END = '#6a0a1a';

/** Its title card, at the first peck: heavy letters thudding down in black and crimson. */
const CARD = Object.freeze({
  seed: 13,
  glow: '#b0101e',
  font: 'tech',
  lines: [
    {
      text: 'Botched',
      size: 0.12,
      at: 0.3,
      fill: ['#d6d4da', '#5e5a66'],
      edge: '#08070a',
      enter: 'thud',
      tilt: -3,
    },
    {
      text: 'Nat 1',
      size: 0.28,
      at: 0.6,
      fill: ['#ff5a5a', '#7a0610'],
      edge: '#120204',
      enter: 'thud',
      delay: 560,
      tilt: 2,
    },
  ],
  rays: { colors: ['#a01020', '#4a0610'], spin: -0.04 },
  vignette: 'rgba(8,0,4,0.92)',
  sparks: { colors: ['#ff3b3b', '#a01020', '#ff8a6a'], count: 30 },
  shake: 0.6,
  hold: 900,
  exit: 'crumble',
});

/** The shortest-way blend of two angles (radians). */
function lerpAngle(a, b, k) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

/** A deterministic 0..1 hash of an integer (the same on every screen). */
const hash = (i) => {
  const x = Math.sin(i * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
};

export const crows = Object.freeze({
  id: 'scene-crows',
  name: 'Crows',
  outcome: 'critical-failure',
  duration: DURATION,
  intro(env) {
    let auras;
    let eyes;
    let wings;
    let omen; // the omen ring tightening round the die
    let chase; // the blood-red glow chasing along behind it
    let last = null;
    let seq = 0;
    let lag = null; // the chasing glow's point, lagging the die
    const rimAcc = [0, 0, 0];
    const bp = [0, 1, 2].map(() => new THREE.Vector3());
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const back = new THREE.Vector3();
    const o = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        const r = c.r;
        auras = bp.map(() => c.glow(BLOOD, { core: '#ff4a5a', width: 0.5 }));
        wings = bp.map(() => [0, 1].map(() => c.ribbon({ head: RIM, tail: RIM_END, width: r * 0.3, length: 12 })));
        eyes = bp.map(() => c.glow(EYE, { core: '#ffd6d6', width: 0.35 }));
        omen = c.glow(OMEN, { core: '#ff6a6a', ring: 0.7, width: 0.12 });
        chase = c.glow(BLOOD, { core: '#ff4a5a', width: 0.55 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const vis = smooth(span(t, 0, 400));
        const rad = r * lerp(7, 2.8, easeOut(span(t, 0, 1100)));
        // c.root follows the die on the table: glows are placed relative to it (x, z)
        bp.forEach((b, i) => {
          const a = (i / COUNT) * TAU + t / 650;
          b.set(p.x + Math.cos(a) * rad, p.y + r * (2.2 + 0.2 * Math.sin(t / 200 + i)), p.z + Math.sin(a) * rad);
          const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
          fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
          right.set(fwd.z, 0, -fwd.x);
          back.copy(fwd).negate();
          const beat = Math.sin(t / 45 + i * 2);
          const reach = r * lerp(0.35, 0.95, 0.55 + 0.45 * Math.abs(beat));
          if (dt > 0) {
            // the dark body: feather flakes off the beating wings
            const n = Math.round(dt * 40 * vis);
            for (let j = 0; j < n; j++) {
              const h = seq++;
              const along = hash(h);
              o.copy(b)
                .addScaledVector(right, (h % 2 ? 1 : -1) * reach * (0.25 + 0.75 * along))
                .addScaledVector(fwd, r * 0.12 * (1 - along) - r * 0.2 * along * along);
              c.emit({ count: 1, origin: o, dir: back, speed: 0.6 + 0.6 * along, spread: 0.6, life: 0.45, size: r * (0.22 - 0.07 * along), sizeEnd: 0.6, kind: KIND.FLAKE, shape: SHAPE.FLAKE, blend: 'normal', color: INK, colorEnd: PLUM, alpha: 1, gravity: -0.6 });
            }
            // the lit rim: crimson embers off the wingtips
            rimAcc[i] += dt * 18 * vis;
            while (rimAcc[i] >= 1) {
              rimAcc[i] -= 1;
              const h = seq++;
              const along = 0.55 + 0.45 * hash(h);
              o.copy(b)
                .addScaledVector(right, (h % 2 ? 1 : -1) * reach * along)
                .addScaledVector(fwd, -r * 0.2 * along * along);
              c.emit({ count: 1, origin: o, dir: back, speed: 0.5 + 0.5 * along, spread: 0.5, life: 0.5, size: r * 0.1, kind: KIND.EMBER, color: RIM, colorEnd: RIM_END, gravity: -0.4, halo: 0.9 });
            }
            if (Math.round(t / 16 + i) % 4 === 0) {
              o.copy(b).addScaledVector(back, r * 0.25);
              c.emit({ count: 1, origin: o, dir: back, speed: 0.5, spread: 0.5, life: 0.6, size: r * 0.4, sizeEnd: 1.8, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: PLUM, colorEnd: SHADE, alpha: 0.5 * vis });
            }
          }
          auras[i].set(0.7 * vis * (0.85 + 0.15 * Math.sin(t / 90 + i)), r * 1.8, b.x - p.x, b.y - r * 0.3, b.z - p.z);
          wings[i].forEach((rib, j) => {
            o.copy(b)
              .addScaledVector(right, (j ? 1 : -1) * reach)
              .addScaledVector(fwd, -r * 0.15);
            rib.push(o);
            rib.opacity(0.8 * vis);
          });
          eyes[i].set(0.9 * vis, r * 0.22, b.x - p.x + fwd.x * r * 0.38, b.y + 0.02, b.z - p.z + fwd.z * r * 0.38);
        });
        // the omen ring tightening round the die, and a blood-red glow chasing along behind it
        omen.set(0.45 * vis * (0.8 + 0.2 * Math.sin(t / 120)), r * lerp(5, 3.6, easeOut(span(t, 0, 1200))), 0, 0.02, 0);
        lag ??= p.clone();
        lag.lerp(p, 1 - Math.exp(-dt * 5));
        chase.set(0.55 * vis * (0.85 + 0.15 * Math.sin(t / 90)), r * 1.7, lag.x - p.x, 0.02, lag.z - p.z);
      },
    });
  },
  play(ctx) {
    let eyes; // a crimson glint per crow
    let auras; // a blood-red back-glow under each crow
    let wings; // two crimson wing-stroke ribbons per crow
    let omen; // the omen ring on the table
    let caw; // the caw ripple (one glow, reused)
    let perch;
    let away;
    let faceDie;
    let glide;
    let leaveFrom;
    let dirs;
    let lastEmit = null;
    let seq = 0;
    let landed = false;
    let burst = false;
    let carded = false;
    let glinted = false;
    let cawAt = null;
    let nextCaw = 0;
    const pecked = PECKS.map(() => false);
    const rimAcc = [0, 0, 0];
    const birds = [0, 1, 2].map(() => ({ p: new THREE.Vector3(), yaw: 0 }));
    const pos = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const o = new THREE.Vector3();
    const back = new THREE.Vector3();
    /** Where crow i circles at t ms (into `out`); returns its heading. */
    const circle = (s, i, t, out) => {
      const rad = s.r * lerp(7, 2.6, easeOut(span(t, ...T.gather)));
      const a = (i / COUNT) * TAU + t / 650;
      out.set(
        s.rest.x + Math.cos(a) * rad,
        s.rest.y + s.r * (2.4 + 0.2 * Math.sin(t / 200 + i)),
        s.rest.z + Math.sin(a) * rad,
      );
      return Math.atan2(-Math.sin(a), Math.cos(a)); // the tangent (x = -sin a, z = cos a) as a yaw
    };
    /**
     * One frame of a crow's swarm: feather flakes off its beating wings, a wisp off its body.
     * `flap` 0..1 (0: wings folded), `rate` scales the emission (fading in and out).
     */
    const swarm = (s, b, i, t, dt, flap, rate) => {
      const r = s.r;
      fwd.set(Math.sin(b.yaw), 0, Math.cos(b.yaw));
      right.set(fwd.z, 0, -fwd.x);
      back.copy(fwd).negate();
      const beat = Math.sin(t / 45 + i * 2);
      const reach = r * lerp(0.35, 0.95, flap * (0.55 + 0.45 * Math.abs(beat)));
      const n = Math.round(dt * 70 * rate);
      for (let j = 0; j < n; j++) {
        const h = seq++;
        const along = hash(h); // where along the wing
        const sideSign = h % 2 ? 1 : -1;
        o.copy(b.p)
          .addScaledVector(right, sideSign * reach * (0.25 + 0.75 * along))
          .addScaledVector(fwd, r * 0.12 * (1 - along) - r * 0.2 * along * along);
        s.emit({
          count: 1,
          origin: o,
          dir: back,
          speed: 0.6 + 0.6 * along,
          spread: 0.6,
          life: 0.45,
          size: r * (0.22 - 0.07 * along),
          sizeEnd: 0.6,
          kind: KIND.FLAKE,
          shape: SHAPE.FLAKE,
          blend: 'normal',
          color: INK,
          colorEnd: PLUM,
          alpha: 1,
          gravity: -0.6,
        });
      }
      // the lit rim: crimson embers off the wing edges, leaving glowing trails
      rimAcc[i] += dt * 26 * rate;
      while (rimAcc[i] >= 1) {
        rimAcc[i] -= 1;
        const h = seq++;
        const along = 0.55 + 0.45 * hash(h); // toward the wingtips
        const sideSign = h % 2 ? 1 : -1;
        o.copy(b.p)
          .addScaledVector(right, sideSign * reach * along)
          .addScaledVector(fwd, -r * 0.2 * along * along);
        s.emit({
          count: 1,
          origin: o,
          dir: back,
          speed: 0.5 + 0.5 * along,
          spread: 0.5,
          life: 0.5,
          size: r * 0.1,
          kind: KIND.EMBER,
          color: RIM,
          colorEnd: RIM_END,
          gravity: -0.4,
          halo: 0.9,
        });
      }
      if (Math.round(t / 16 + i) % 3 === 0) {
        o.copy(b.p).addScaledVector(back, r * 0.25);
        s.emit({
          count: 1,
          origin: o,
          dir: back,
          speed: 0.5,
          spread: 0.5,
          life: 0.6,
          size: r * 0.5 * (0.6 + 0.4 * rate),
          sizeEnd: 1.8,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          color: PLUM,
          colorEnd: SHADE,
          alpha: 0.6 * rate,
        });
      }
      // the back-glow: a soft blood-red aura just under the bird, so its dark body stands out
      auras[i].set(
        0.75 * rate * (0.85 + 0.15 * Math.sin(t / 90 + i)),
        r * (1.5 + 0.5 * flap),
        b.p.x,
        b.p.y - r * 0.3,
        b.p.z,
      );
      // the wing strokes: crimson ribbons trailing off each wingtip
      wings[i].forEach((rib, j) => {
        o.copy(b.p)
          .addScaledVector(right, (j ? 1 : -1) * reach)
          .addScaledVector(fwd, -r * 0.15);
        rib.push(o);
        rib.opacity(0.85 * rate * (0.4 + 0.6 * flap));
      });
      eyes[i].set(
        0.9 * rate,
        r * 0.22,
        b.p.x + fwd.x * r * 0.38,
        b.p.y + 0.02,
        b.p.z + fwd.z * r * 0.38,
      );
    };
    /** A flurry of feathers bursting off crow b. */
    const flurry = (s, b, count, speed) => {
      s.emit({
        count,
        origin: b.p,
        speed,
        spread: 1,
        life: 1.1,
        size: s.r * 0.18,
        sizeEnd: 0.5,
        kind: KIND.FLAKE,
        shape: SHAPE.FLAKE,
        blend: 'normal',
        color: INK,
        colorEnd: PLUM,
        alpha: 1,
        gravity: -1.2,
        floor: 0.04,
      });
      // their lit edges: crimson embers thrown with the feathers
      s.emit({
        count: Math.ceil(count / 2),
        origin: b.p,
        speed: speed * 0.9,
        spread: 1,
        life: 0.8,
        size: s.r * 0.1,
        kind: KIND.EMBER,
        color: RIM,
        colorEnd: RIM_END,
        gravity: -0.8,
        halo: 0.9,
      });
    };
    return runScene(ctx, {
      duration: DURATION,
      introSkip: 250, // they circled the tumbling die: one is already swooping down to peck
      setup(s) {
        const r = s.r;
        auras = birds.map(() => s.glow(BLOOD, { core: '#ff4a5a', width: 0.5 }));
        wings = birds.map(() => [0, 1].map(() => s.ribbon({ head: RIM, tail: RIM_END, width: r * 0.3, length: 14 })));
        eyes = birds.map(() => s.glow(EYE, { core: '#ffd6d6', width: 0.35 }));
        omen = s.glow(OMEN, { core: '#ff6a6a', ring: 0.7, width: 0.12 });
        caw = s.glow('#a0142a', { core: '#ff8a8a', ring: 0.6, width: 0.18 });
        perch = s.beside(r * 1.35).setY(r * 0.25);
        faceDie = Math.atan2(s.rest.x - perch.x, s.rest.z - perch.z);
        away = s.toward.clone().negate(); // the peck pushes the die away from the crow
        glide = new THREE.Vector3();
        leaveFrom = birds.map(() => new THREE.Vector3());
        dirs = birds.map((_, i) => {
          const a = (i / COUNT) * TAU + 0.6;
          return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        });
        for (let i = 1; i < COUNT; i++) circle(s, i, T.leave[0], leaveFrom[i]);
        leaveFrom[0].copy(perch);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        const vis = span(t, ...T.appear) * (1 - span(t, ...T.vanish));
        const lk = easeIn(span(t, ...T.leave));
        birds.forEach((b, i) => {
          let flap = 1;
          if (t >= T.leave[0]) {
            // flying off: out and up, each its own way
            b.p.copy(leaveFrom[i]).addScaledVector(dirs[i], r * 8 * lk);
            b.p.y += r * 2.5 * lk;
            const yaw = Math.atan2(dirs[i].x, dirs[i].z);
            b.yaw = i === 0 ? lerpAngle(faceDie, yaw, span(t, T.leave[0], T.leave[0] + 200)) : yaw;
          } else if (i === 0 && t >= T.land[0]) {
            // the lander glides down beside the die, folding its wings, then pecks
            const k = smooth(span(t, ...T.land));
            const fly = circle(s, 0, T.land[0], glide);
            arc(glide, perch, k, r * 0.4, b.p);
            b.yaw = lerpAngle(fly, faceDie, k);
            flap = 1 - 0.8 * span(t, T.land[1] - 150, T.land[1]);
            let peck = 0;
            for (const p of PECKS) peck += bump(span(t, p, p + PECK_MS));
            b.p.addScaledVector(fwd.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)), r * 0.35 * peck);
          } else b.yaw = circle(s, i, t, b.p);
          if (dt > 0) swarm(s, b, i, t, dt, flap, vis);
          else (eyes[i].set(0), auras[i].set(0));
        });
        // --- the omen ring under the circling crows ---
        const ring = span(t, 100, 500) * (1 - span(t, ...T.leave));
        omen.set(
          0.55 * ring * (0.8 + 0.2 * Math.sin(t / 120)),
          r * lerp(4.2, 3.6, easeOut(ring)),
          s.rest.x,
          0.02,
          s.rest.z,
        );
        // --- caws: a dark crimson ripple from the cawing crow ---
        while (nextCaw < CAWS.length && t >= CAWS[nextCaw][0]) {
          const [at, i] = CAWS[nextCaw++];
          cawAt = { t: at, p: birds[i].p.clone() };
        }
        if (cawAt) {
          const ck = span(t, cawAt.t, cawAt.t + 520);
          caw.set(0.8 * (1 - ck), r * lerp(0.4, 1.6, easeOut(ck)), cawAt.p.x, cawAt.p.y, cawAt.p.z);
          if (ck >= 1) cawAt = null;
        } else caw.set(0);
        // --- landing and the pecks ---
        if (t >= T.land[1] - 60 && !landed) {
          landed = true;
          flurry(s, birds[0], 14, 1.6);
          s.emit({
            count: 6,
            origin: { x: perch.x, y: 0.1, z: perch.z },
            dir: { x: 0, y: 0.2, z: 0 },
            speed: 1.2,
            spread: 1,
            life: 0.9,
            size: r * 0.45,
            sizeEnd: 2,
            kind: KIND.SMOKE,
            shape: SHAPE.SMOKE,
            blend: 'normal',
            color: '#3a3038',
            colorEnd: SHADE,
            alpha: 0.4,
          });
        }
        PECKS.forEach((p, j) => {
          if (t < p + PECK_MS * 0.5 || pecked[j]) return;
          pecked[j] = true;
          o.copy(s.rest).addScaledVector(s.toward, r * 0.8);
          s.emit({
            count: 3,
            origin: o,
            speed: 0.3,
            spread: 1,
            life: 0.3,
            size: r * 0.3,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: '#ffb0a0',
          });
          s.emit({
            count: 6,
            origin: o,
            dir: s.toward,
            speed: 3,
            spread: 0.7,
            life: 0.5,
            size: r * 0.06,
            kind: KIND.SHARD,
            shape: SHAPE.SHARD,
            blend: 'normal',
            color: '#4a4048',
            colorEnd: '#2a2228',
            gravity: -9,
            floor: 0.04,
          });
          s.emit({
            count: 4,
            origin: birds[0].p,
            speed: 0.8,
            spread: 1,
            life: 0.7,
            size: r * 0.12,
            kind: KIND.FLAKE,
            shape: SHAPE.FLAKE,
            blend: 'normal',
            color: INK,
            colorEnd: PLUM,
            alpha: 1,
            gravity: -1,
            floor: 0.04,
          });
          s.emit({
            count: 3,
            origin: birds[0].p,
            speed: 0.8,
            spread: 1,
            life: 0.6,
            size: r * 0.09,
            kind: KIND.EMBER,
            color: RIM,
            colorEnd: RIM_END,
            gravity: -0.6,
            halo: 0.9,
          });
          if (j === 0) {
            s.shake(0.08, 110);
            if (!carded) ((carded = true), s.card(CARD));
          }
        });
        // --- they burst off: feathers everywhere, the swarms dissolving into wisps ---
        if (t >= T.leave[0] && !burst) {
          burst = true;
          birds.forEach((b) => flurry(s, b, 12, 2.2));
          s.effect('smoke', {
            color: '#2a2030',
            intensity: 0.5,
            duration: 1200,
            at: perch.clone().setY(0.05),
          });
        }
        // the die jolts with each peck (a nudge away and a twitch)
        let jolt = 0;
        for (const p of PECKS) jolt += bump(span(t, p + PECK_MS * 0.4, p + PECK_MS));
        pos.copy(s.rest).addScaledVector(away, r * 0.07 * jolt);
        pos.y += r * 0.05 * jolt;
        s.die.pose(pos, 0.015 * jolt);
        if (t >= 1250 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: crimson eyes and a few feathers circle slowly over the die; the omen ring glows
        const r = s.r;
        const k = bump(t / 1600);
        birds.forEach((b, i) => {
          const a = (i / COUNT) * TAU + t / 2000;
          eyes[i].set(
            0.8 * k,
            r * 0.22,
            s.rest.x + Math.cos(a) * r * 2.6,
            s.rest.y + r * 2.4,
            s.rest.z + Math.sin(a) * r * 2.6,
          );
          b.p.set(
            s.rest.x + Math.cos(a) * r * 2.6,
            s.rest.y + r * 2.4,
            s.rest.z + Math.sin(a) * r * 2.6,
          );
        });
        birds.forEach((b, i) => auras[i].set(0.6 * k, r * 1.5, b.p.x, b.p.y - r * 0.3, b.p.z));
        omen.set(0.45 * k, r * 3.6, s.rest.x, 0.02, s.rest.z);
        if (t >= 300 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          birds.forEach((b) => flurry(s, b, 5, 0.5));
        }
      },
    });
  },
});
