import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, smooth, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Tumbleweed (a natural 1): silence. Light, dust and dry-grass streaks from the dice effects' own
 * particle pool, no solid shapes.
 *
 * 0-250     the wind picks up: pale wind streaks sweep across the table, dust motes drift
 * 80-1320   a tumbleweed rolls in fast and past the die: a dusty swirl of dry-grass streaks spinning
 *           about its roll, a sun-bleached glow in its heart, a soft shadow and a dust trail under
 *           it; it hops five times, each landing kicking up a puff of dust and grit
 * 700       it passes right in front of the die: the die wobbles in its wake; the title card whips in
 * 850-1850  the crickets: little green-gold chirps of light blink in pairs off to the side
 * 1100-1450 it rolls off, unravelling into dust; the wind dies down
 *
 * Mid-roll (intro): the wind rises with the tumbling die: pale streaks gust along with it, dust
 * kicks up off the table under it and a dusty ribbon trails it, while far off to the side the
 * tumbleweed's swirl appears and comes hopping in along the lane in front of the die. At landing the
 * show picks up with the weed already rolling in, a few hundred ms from passing the die.
 */
export const DURATION = 2000;
const T = {
  wind: [0, 250],
  travel: [80, 1320],
  pass: 700,
  wobble: [500, 1100],
  crickets: [850, 1850],
  fade: [1100, 1450],
  glint: 1100,
};
const HOPS = 5;

const STRAW = '#d9bb7c';
const DRY = '#8a6a3c';
const DUST = '#c9b48f';
const DUSK = '#6e5e48';
const PALE = '#fff3dc';
const CRICKET = '#d6f08a';

/** Its title card, as the tumbleweed passes the die: dusty, sepia, whipped in on the wind. */
const CARD = Object.freeze({
  seed: 31,
  glow: '#b8935a',
  font: 'display',
  lines: [
    {
      text: 'Crickets...',
      size: 0.12,
      at: 0.32,
      fill: ['#f6ead0', '#c2a372'],
      edge: '#4a3418',
      enter: 'whip',
      tilt: -3,
    },
    {
      text: 'Nat 1',
      size: 0.28,
      at: 0.6,
      fill: ['#ecd7a8', '#8f6c3a'],
      edge: '#3a2810',
      enter: 'whip',
      delay: 360,
      tilt: 2,
    },
  ],
  sparks: { colors: ['#e6d3a8', '#b89868', '#fff0d0'], count: 36 },
  hold: 900,
  exit: 'fade',
});

/** A deterministic 0..1 hash of an integer (the same on every screen). */
const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const tumbleweed = Object.freeze({
  id: 'scene-tumbleweed',
  name: 'Tumbleweed',
  outcome: 'critical-failure',
  duration: DURATION,
  intro(env) {
    let heart; // the swirl's sun-bleached glow
    let shadow; // its soft shadow
    let gust; // a dusty ribbon trailing the die
    let last = null;
    let prev = null;
    let seq = 0;
    const travel = new THREE.Vector3(1, 0, 0); // the die's way across the table (smoothed)
    const toward = new THREE.Vector3();
    const side = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const rel = new THREE.Vector3(); // the swirl's centre relative to the die (x, z)
    const cw = new THREE.Vector3(); // the swirl's centre in the world
    const pt = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    return runIntro(env, {
      setup(c) {
        heart = c.glow('#e8c88a', { core: '#fff2d0', width: 0.5 });
        shadow = c.disc('#000000', 0);
        gust = c.ribbon({ head: '#e6d6b0', tail: DUSK, width: c.r * 0.5, length: 16 });
      },
      frame(t, c, p) {
        const r = c.r;
        const size = r * 0.75;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        if (prev && dt > 0) {
          d.subVectors(p, prev).setY(0);
          if (d.lengthSq() > 1e-8) travel.lerp(d.normalize(), 0.2);
          if (travel.lengthSq() < 1e-6) travel.set(1, 0, 0);
          travel.normalize();
        }
        prev = (prev ?? new THREE.Vector3()).copy(p);
        const k = smooth(span(t, 0, 400));
        // --- the wind: pale streaks gusting past from behind the die, along its way ---
        if (dt > 0) {
          const n = Math.round(dt * 22 * k + (t % 64 < 16 ? 0.5 : 0));
          for (let j = 0; j < n; j++) {
            const i = seq++;
            o.copy(p)
              .addScaledVector(travel, -r * (2.5 + 2 * hash(i)))
              .addScaledVector(d.set(travel.z, 0, -travel.x), r * (hash(i + 3) * 4 - 2))
              .setY(r * (0.2 + 1.2 * hash(i + 5)));
            c.emit({
              count: 1,
              origin: o,
              dir: travel,
              speed: 7 + 3 * hash(i + 9),
              spread: 0.05,
              life: 0.6,
              size: r * 0.06,
              kind: KIND.STREAK,
              color: PALE,
              colorEnd: DUST,
              alpha: 0.3 * k,
              halo: 0.15,
              stretch: 4,
              drag: 0.2,
            });
          }
          // dust kicked up off the table under it
          if (Math.round(t / 16) % 3 === 0) {
            c.emit({
              count: 1,
              origin: { x: p.x, y: 0.08, z: p.z },
              dir: { x: -travel.x, y: 0.3, z: -travel.z },
              speed: 0.7,
              spread: 0.8,
              life: 0.9,
              size: r * 0.35,
              sizeEnd: 2.2,
              kind: KIND.SMOKE,
              shape: SHAPE.SMOKE,
              blend: 'normal',
              color: DUST,
              colorEnd: DUSK,
              alpha: 0.24 * k,
            });
          }
        }
        gust.push(o.set(p.x, r * 0.25, p.z));
        gust.opacity(0.25 * k);
        // --- the tumbleweed coming: from far off to the side, along the lane in front of the die ---
        toward.set(-p.x, 0, -p.z);
        if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
        toward.normalize();
        side.set(toward.z, 0, -toward.x);
        axis.crossVectors(UP, side).normalize();
        const on = smooth(span(t, 150, 600));
        const near = lerp(9, 3, easeOut(span(t, 150, 1500)));
        const hop = Math.abs(Math.sin(t / 260));
        rel.copy(side).multiplyScalar(-near * r).addScaledVector(toward, r * 1.7);
        cw.set(p.x + rel.x, size + r * 0.6 * hop, p.z + rel.z);
        const roll = t * 0.006;
        if (dt > 0 && on > 0) {
          const n = Math.max(1, Math.round(dt * 90 * on));
          for (let j = 0; j < n; j++) {
            const i = seq++;
            const z = 1 - 2 * hash(i);
            const a = i * 2.39996;
            const rr = Math.sqrt(Math.max(0, 1 - z * z));
            pt.set(Math.cos(a) * rr, z, Math.sin(a) * rr).applyQuaternion(q.setFromAxisAngle(axis, roll));
            tan.crossVectors(axis, pt).normalize();
            o.copy(cw).addScaledVector(pt, size * (0.75 + 0.3 * hash(i + 7)));
            c.emit(
              j % 3
                ? { count: 1, origin: o, dir: tan, speed: 2.4, spread: 0.25, life: 0.28, size: r * 0.09, kind: KIND.STREAK, blend: 'normal', color: DRY, colorEnd: '#4a3820', alpha: 0.7 * on, stretch: 3 }
                : { count: 1, origin: o, dir: tan, speed: 2.8, spread: 0.2, life: 0.22, size: r * 0.07, kind: KIND.STREAK, color: STRAW, colorEnd: DRY, halo: 0.3, alpha: 0.65 * on },
            );
          }
        }
        heart.set(0.3 * on, size * 1.5, rel.x, cw.y, rel.z);
        const lift = cw.y - size;
        shadow.material.opacity = (0.25 * on) / (1 + lift * 1.2);
        shadow.scale.setScalar(size * (1 + lift * 0.4));
        shadow.position.set(rel.x, 0.012, rel.z);
      },
    });
  },
  play(ctx) {
    let from;
    let to;
    let axis; // the roll axis (horizontal, across its path)
    let size; // the tumbleweed's radius
    let heart; // the sun-bleached glow in its middle
    let shadow; // the soft dark shadow under it
    let trail; // a faint dusty ribbon behind it
    let lastEmit = null;
    let seq = 0; // strand counter: picks points on the swirl
    let lastHop = 0;
    let carded = false;
    let lastChirp = -1;
    let unravelled = false;
    let glinted = false;
    const c = new THREE.Vector3(); // the tumbleweed's centre
    const pt = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const o = new THREE.Vector3();
    /** One dry-grass strand on the spinning swirl: a short streak along the roll. */
    const strand = (s, roll, normal) => {
      const i = seq++;
      const z = 1 - 2 * hash(i);
      const a = i * 2.39996;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      pt.set(Math.cos(a) * rr, z, Math.sin(a) * rr).applyQuaternion(q.setFromAxisAngle(axis, roll));
      tan.crossVectors(axis, pt).normalize(); // the way the swirl's surface moves there
      const shell = size * (0.75 + 0.3 * hash(i + 7));
      o.copy(c).addScaledVector(pt, shell);
      if (normal) {
        s.emit({
          count: 1,
          origin: o,
          dir: tan,
          speed: 2.4,
          spread: 0.25,
          life: 0.28,
          size: s.r * 0.09,
          kind: KIND.STREAK,
          blend: 'normal',
          color: DRY,
          colorEnd: '#4a3820',
          alpha: 0.75,
          stretch: 3,
        });
      } else {
        s.emit({
          count: 1,
          origin: o,
          dir: tan,
          speed: 2.8,
          spread: 0.2,
          life: 0.22,
          size: s.r * 0.07,
          kind: KIND.STREAK,
          color: STRAW,
          colorEnd: DRY,
          halo: 0.3,
          alpha: 0.7,
        });
      }
    };
    /** A puff of dust and grit where the tumbleweed lands. */
    const puff = (s, at, big) => {
      const r = s.r;
      const n = big ? 10 : 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + seq * 0.3;
        s.emit({
          count: 1,
          origin: { x: at.x, y: 0.1, z: at.z },
          dir: { x: Math.cos(a), y: 0.15, z: Math.sin(a) },
          speed: big ? 2.2 : 1.6,
          spread: 0.2,
          life: 1.1,
          size: r * 0.5,
          sizeEnd: 2.4,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          color: DUST,
          colorEnd: DUSK,
          alpha: 0.42,
        });
      }
      s.emit({
        count: big ? 10 : 6,
        origin: { x: at.x, y: 0.12, z: at.z },
        dir: { x: 0, y: 1, z: 0 },
        speed: 2.6,
        spread: 1,
        life: 0.6,
        size: r * 0.06,
        kind: KIND.SHARD,
        shape: SHAPE.SHARD,
        blend: 'normal',
        color: '#7a6448',
        colorEnd: '#5a4a36',
        gravity: -9,
        floor: 0.04,
      });
    };
    /** Wind streaks blowing across the table along `dir`, `n` of them. */
    const wind = (s, n, alpha) => {
      const r = s.r;
      for (let j = 0; j < n; j++) {
        const i = seq++;
        o.copy(s.rest)
          .addScaledVector(s.side, -r * (5 + 2 * hash(i)))
          .addScaledVector(s.toward, r * (hash(i + 3) * 6 - 3))
          .setY(r * (0.3 + 1.4 * hash(i + 5)));
        s.emit({
          count: 1,
          origin: o,
          dir: s.side,
          speed: 9 + 4 * hash(i + 9),
          spread: 0.04,
          life: 0.7,
          size: r * 0.06,
          kind: KIND.STREAK,
          color: PALE,
          colorEnd: DUST,
          alpha,
          halo: 0.15,
          stretch: 4,
          drag: 0.2,
        });
      }
    };
    return runScene(ctx, {
      duration: DURATION,
      introSkip: 350, // the wind and the weed's approach rode the tumbling die: it rolls in, passes soon
      setup(s) {
        const r = s.r;
        size = r * 0.75;
        // the path: across, along s.side, passing just in front of the die (on the table side)
        const lane = s.toward.clone().multiplyScalar(r * 1.7);
        from = s.ground
          .clone()
          .addScaledVector(s.side, -r * 6)
          .add(lane);
        to = s.ground
          .clone()
          .addScaledVector(s.side, r * 6)
          .add(lane);
        axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), s.side).normalize();
        heart = s.glow('#e8c88a', { core: '#fff2d0', width: 0.5 });
        shadow = s.disc('#000000', 0);
        trail = s.ribbon({ head: '#d8c49a', tail: '#5a4630', width: r * 0.9, length: 22 });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the wind: strong as it starts, steady while the weed rolls, dying at the end ---
        const gust = span(t, ...T.wind) * (1 - 0.6 * span(t, ...T.fade));
        if (dt > 0) wind(s, Math.round(dt * 26 * gust + (t % 64 < 16 ? 0.5 : 0)), 0.3 * gust);
        // --- the tumbleweed: rolling along, hopping lower each time ---
        const k = span(t, ...T.travel);
        const fade = 1 - span(t, ...T.fade);
        const on = t >= T.travel[0] && fade > 0;
        c.lerpVectors(from, to, k);
        const hop = Math.abs(Math.sin(k * HOPS * Math.PI));
        c.y = size + r * lerp(0.9, 0.5, k) * hop;
        const roll = (from.distanceTo(to) * k) / size;
        if (on && dt > 0) {
          const grow = span(t, T.travel[0], T.travel[0] + 250);
          const n = Math.max(1, Math.round(dt * 160 * grow * fade));
          for (let i = 0; i < n; i++) strand(s, roll, i % 3 !== 0);
          // dust shed from it as it goes
          if (Math.round(t / 16) % 3 === 0) {
            s.emit({
              count: 1,
              origin: c,
              dir: { x: -s.side.x, y: 0.2, z: -s.side.z },
              speed: 0.8,
              spread: 0.8,
              life: 0.9,
              size: r * 0.35,
              sizeEnd: 2.2,
              kind: KIND.SMOKE,
              shape: SHAPE.SMOKE,
              blend: 'normal',
              color: DUST,
              colorEnd: DUSK,
              alpha: 0.28 * fade,
            });
          }
        }
        heart.set(
          on ? 0.35 * fade * span(t, T.travel[0], T.travel[0] + 250) : 0,
          size * 1.5,
          c.x,
          c.y,
          c.z,
        );
        // a soft shadow, darker and tighter when it is down on the table
        const lift = c.y - size;
        shadow.material.opacity = on ? (0.3 * fade) / (1 + lift * 1.2) : 0;
        shadow.scale.setScalar(size * (1 + lift * 0.4));
        shadow.position.set(c.x, 0.012, c.z);
        if (on) {
          trail.push(pos.copy(c).setY(r * 0.25));
          trail.opacity(0.28 * fade);
        } else trail.opacity(0);
        // a puff at each landing (where k * HOPS crosses a whole number)
        const landed = Math.floor(k * HOPS + 1e-6);
        if (landed > lastHop && landed < HOPS) {
          lastHop = landed;
          puff(s, c, landed === 1);
        }
        // as it passes, the die wobbles in its wake
        const w = span(t, ...T.wobble);
        pos.copy(s.rest).addScaledVector(s.side, r * 0.04 * Math.sin(w * TAU * 2) * bump(w));
        s.die.pose(pos, 0.03 * Math.sin(w * TAU * 3) * bump(w));
        if (t >= T.pass && !carded) {
          carded = true;
          s.card(CARD);
          s.effect('smoke', {
            color: DUST,
            intensity: 0.5,
            duration: 1200,
            at: c.clone().setY(0.05),
          });
        }
        // --- the crickets: pairs of chirps blinking off to the side, in rhythm ---
        if (t >= T.crickets[0] && t < T.crickets[1]) {
          const beat = Math.floor((t - T.crickets[0]) / 200);
          if (beat > lastChirp && beat % 2 === 0) {
            lastChirp = beat;
            const side = beat % 4 === 0 ? 1 : -1;
            o.copy(s.rest)
              .addScaledVector(s.side, side * r * 2.6)
              .addScaledVector(s.toward, -r * (1.2 + 0.4 * (beat % 3)))
              .setY(0.08);
            s.emit({
              count: 2,
              origin: o,
              speed: 0.15,
              spread: 1,
              life: 0.32,
              size: r * 0.22,
              kind: KIND.GLINT,
              color: '#ffffff',
              colorEnd: CRICKET,
            });
          }
        }
        // the weed unravels as it goes: a last puff of strands scattering
        if (t >= T.fade[0] && !unravelled) {
          unravelled = true;
          s.emit({
            count: 18,
            origin: c,
            speed: 2,
            spread: 1,
            life: 0.8,
            size: r * 0.08,
            kind: KIND.STREAK,
            blend: 'normal',
            color: DRY,
            colorEnd: '#4a3820',
            alpha: 0.6,
            gravity: -2,
            floor: 0.04,
          });
        }
        if (t >= T.glint && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: a dusty haze drifts past in front of the die, the crickets chirp; the die stays put
        const r = s.r;
        const k = bump(t / 1600);
        c.copy(s.rest)
          .addScaledVector(s.toward, r * 1.7)
          .setY(size);
        heart.set(0.3 * k, size * 1.6, c.x, c.y, c.z);
        shadow.material.opacity = 0.2 * k;
        shadow.scale.setScalar(size * smooth(0.6 + 0.4 * k));
        shadow.position.set(c.x, 0.012, c.z);
        if (t >= 400 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
          s.emit({
            count: 6,
            origin: c,
            dir: s.side,
            speed: 0.6,
            spread: 0.8,
            life: 1.2,
            size: r * 0.4,
            sizeEnd: 2,
            kind: KIND.SMOKE,
            shape: SHAPE.SMOKE,
            blend: 'normal',
            color: DUST,
            colorEnd: DUSK,
            alpha: 0.3,
          });
          o.copy(s.rest)
            .addScaledVector(s.side, r * 2.4)
            .setY(0.08);
          s.emit({
            count: 2,
            origin: o,
            speed: 0.1,
            spread: 1,
            life: 0.4,
            size: r * 0.2,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: CRICKET,
          });
        }
      },
    });
  },
});
