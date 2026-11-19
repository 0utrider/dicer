import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Crack and Tape (a natural 1): the table splits under the die, and someone patches it with duct
 * tape. A patch job.
 *
 * 0-250     the die trembles; an ember glow gathers under it, grit lifts off the table
 * 250       crack: the floor cracks open under the die (the library crack, ember-lit fissures), the
 *           die jolts, dark chips and sparks fly, a dust ring rolls out; the screen shakes
 * 320       the title card stamps in
 * 800-1140  two strips of silver duct tape slap down across the die in an X (falling from above,
 *           so they shrink as they come), each with a dust puff, a soft thwap ring and a glint
 * 1150-1670 mended: a cold silver light sweeps along each strip, the ember glow cools to silver
 *           and goes out, a glint on the die
 * 1800-2300 the tape fades, shedding silver motes
 *
 * Mid-roll (intro): the tumbling die glows ember-hot, lighting the table under it, and sheds grit,
 * dark chips and sparks as it goes. Played after it, the brace is cut short (its glow and grit
 * seen): the floor cracks ~190 ms after landing and the card stamps in ~260 ms after.
 */
export const DURATION = 2400;
// tape: each strip's start; slap: its fall (ms)
const T = { brace: [0, 250], crack: 250, card: 320, tape: [800, 980], slap: 160, seal: [1150, 1550], cool: [1150, 1700], fade: [1800, 2300] };

const EMBER = '#ff7a2a';
const HOT = '#ffd2a0';
const SILVER = '#cfd6de';
const STEEL = '#a7adb4';
const TAPE_Y = 1.05; // the tape's height over the die's centre, in radii (just above its top)
const TAPE_L = 2.6; // its length and width, in radii
const TAPE_W = 0.55;

/** Its title card, as the floor cracks. */
const CARD = Object.freeze({
  seed: 1313,
  font: 'display',
  glow: '#c9d0d8',
  lines: [
    { text: 'Broken', size: 0.12, at: 0.3, fill: ['#ffffff', '#a3aab3'], edge: '#30343a', enter: 'stamp', tilt: 4 },
    { text: 'Fumble', size: 0.28, at: 0.6, fill: ['#e4e8ec', '#7b838c'], edge: '#22262b', enter: 'stamp', delay: 300, tilt: -3 },
  ],
  crack: '#1b1d20',
  flash: '#eef2f6',
  sparks: { colors: ['#ffffff', '#c4cad1', '#ff9a4a'], count: 40 },
  shake: 0.9,
  hold: 900,
  exit: 'crumble',
});

/** A strip of tape, 1 x 1 (scale it), draping a little at its ends. */
function tapeGeometry(s) {
  const g = new THREE.BoxGeometry(1, 0.02, 1, 16, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - 1.4 * pos.getX(i) ** 2);
  g.computeVertexNormals();
  return s.geo(g);
}

export const crackAndTape = Object.freeze({
  id: 'scene-crack-and-tape',
  name: 'Crack and Tape',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: the die is about to break something. It glows ember-hot, a short hot trail behind it,
   * heat lighting the table under it, and it sheds gritty dust, dark chips and the odd spark as it
   * tumbles, more the longer it rolls.
   */
  intro(env) {
    let halo;
    let heat;
    let trail;
    let last = null;
    let bits = 0;
    return runIntro(env, {
      setup(c) {
        halo = c.glow(EMBER, { core: HOT, width: 0.55 });
        heat = c.glow(EMBER, { core: HOT, width: 0.55 });
        trail = c.ribbon({ head: HOT, tail: EMBER, width: c.r * 0.5, length: 14 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = easeIn(span(t, 0, 600));
        const lift = Math.max(0, p.y);
        // c.root follows the die on the table: (0, 0) is under it
        halo.set(0.75 * k * (0.85 + 0.15 * Math.sin(t / 45)), r * 1.5, 0, p.y, 0);
        heat.set((0.6 * k) / (1 + lift * 0.35), r * (1.6 + lift * 0.2), 0, 0.02, 0);
        trail.push(p);
        trail.opacity(0.6 * k);
        if (dt > 0) {
          const n = Math.max(1, Math.round(dt * 36 * k));
          for (let i = 0; i < n; i++, bits++) {
            const chip = bits % 5 === 0;
            c.emit({ count: 1, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: chip ? 2 : 1.4, spread: 1.2, life: chip ? 0.9 : 0.55, size: r * (chip ? 0.14 : 0.07), kind: KIND.SHARD, shape: SHAPE.SHARD, blend: 'normal', color: chip ? '#2e2a27' : '#4a4540', colorEnd: '#1c1a18', gravity: -9, floor: 0.03 });
            if (bits % 4 === 1) c.emit({ count: 1, origin: p, dir: { x: 0, y: 1, z: 0 }, speed: 2.4, spread: 1, life: 0.3, size: r * 0.1, kind: KIND.STREAK, color: HOT, colorEnd: EMBER, gravity: -8, floor: 0.04 });
          }
        }
      },
    });
  },
  play(ctx) {
    let pool; // the ember light under the die
    let tapes; // the two strips: { mesh, dir, sweep (its glow), slapped }
    let tapeMat;
    let lastEmit = null;
    let cracked = false;
    let carded = false;
    let shed = false;
    let glinted = false;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const c = new THREE.Color();
    const cold = new THREE.Color(SILVER);
    return runScene(ctx, {
      duration: DURATION,
      introSkip: 60, // it glowed and shed grit mid-roll: a short tremble on landing, then the crack
      setup(s) {
        const r = s.r;
        pool = s.glow(EMBER, { core: HOT, width: 0.55 });
        tapeMat = s.mat(STEEL, { opacity: 0 });
        tapeMat.roughness = 0.48;
        tapeMat.metalness = 0.7;
        const strip = tapeGeometry(s);
        tapes = [0, 1].map((i) => {
          const mesh = new THREE.Mesh(strip, tapeMat);
          const ry = (i ? -1 : 1) * (Math.PI / 4) + 0.08 * i;
          mesh.rotation.y = ry;
          mesh.scale.set(r * TAPE_L, 1, r * TAPE_W);
          mesh.visible = false;
          s.add(mesh);
          const sweep = s.glow(SILVER, { core: '#ffffff', width: 0.4 });
          return { mesh, dir: new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry)), sweep, slapped: false };
        });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the die: trembling, the jolt, a squash at each slap ---
        const jolt = bump(span(t, T.crack, T.crack + 220));
        const slap = tapes.reduce((n, _, i) => n + bump(span(t, T.tape[i] + T.slap, T.tape[i] + T.slap + 110)), 0);
        const tremble = t < T.crack ? 0.03 * Math.sin(t / 18) * span(t, 60, T.crack) : 0;
        p.copy(s.rest);
        p.y += r * (tremble + 0.35 * jolt - 0.06 * slap);
        s.die.pose(p, 0.05 * jolt * Math.sin(t / 25));
        // --- the ember light under the die, cooling to silver once mended ---
        const gather = easeIn(span(t, ...T.brace));
        const flare = t >= T.crack ? 0.6 * (1 - easeOut(span(t, T.crack, T.crack + 500))) : 0;
        const cool = span(t, ...T.cool);
        c.set(EMBER).lerp(cold, easeOut(span(t, ...T.seal)));
        pool.tint(c).set((0.45 * gather + flare) * (1 - cool), r * lerp(1.5, 2.4, easeOut(span(t, T.crack, T.crack + 300))), s.rest.x, 0.02, s.rest.z);
        if (dt > 0 && t > 80 && t < T.crack && Math.round(t / 16) % 3 === 0) {
          s.emit({ count: 1, origin: { x: s.rest.x, y: 0.05, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 1.4, spread: 1.2, life: 0.5, size: r * 0.07, kind: KIND.SHARD, shape: SHAPE.SHARD, blend: 'normal', color: '#4a4540', gravity: -6, floor: 0.03 });
        }
        // --- the crack ---
        if (t >= T.crack && !cracked) {
          cracked = true;
          s.shake(0.35, 260);
          s.effect('crack', { color: EMBER, intensity: 1, duration: 1500 });
          const o = { x: s.rest.x, y: 0.08, z: s.rest.z };
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TAU + 0.2 * Math.sin(i * 2.3);
            s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.05, z: Math.sin(a) }, speed: 3, spread: 0.15, life: 1.2, size: r * 0.6, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#a89e8c', colorEnd: '#5e5850', alpha: 0.5 });
          }
          s.emit({ count: 16, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 4.5, spread: 1, life: 1, size: r * 0.13, kind: KIND.SHARD, shape: SHAPE.SHARD, blend: 'normal', color: '#2e2a27', colorEnd: '#1c1a18', gravity: -12, floor: 0.04 });
          s.emit({ count: 14, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 5.5, spread: 1.2, life: 0.45, size: r * 0.14, kind: KIND.STREAK, color: HOT, colorEnd: EMBER, gravity: -10, floor: 0.04 });
        }
        if (t >= T.card && !carded) ((carded = true), s.card(CARD));
        // --- the tape: two strips slapping down from above ---
        tapeMat.opacity = span(t, T.tape[0], T.tape[0] + 60) * (1 - span(t, ...T.fade));
        tapes.forEach((tp, i) => {
          const t0 = T.tape[i];
          const k = easeIn(span(t, t0, t0 + T.slap));
          tp.mesh.visible = t >= t0 && tapeMat.opacity > 0.01;
          const y = s.rest.y + r * (lerp(TAPE_Y + 3.5, TAPE_Y, k) + 0.08 * bump(span(t, t0 + T.slap, t0 + T.slap + 160))) + i * 0.02;
          tp.mesh.position.set(s.rest.x, y, s.rest.z);
          if (k >= 1 && !tp.slapped) {
            tp.slapped = true;
            s.shake(0.12, 110);
            s.effect('shockwave', { color: SILVER, intensity: 0.45, duration: 500 });
            for (let j = 0; j < 8; j++) {
              const a = (j / 8) * TAU + i * 0.4;
              s.emit({ count: 1, origin: { x: s.rest.x, y: 0.08, z: s.rest.z }, dir: { x: Math.cos(a), y: 0.05, z: Math.sin(a) }, speed: 2.2, spread: 0.2, life: 0.9, size: r * 0.45, sizeEnd: 2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#b9b2a4', colorEnd: '#6c675e', alpha: 0.4 });
            }
            for (const e of [-0.45, 0.45]) {
              q.copy(tp.mesh.position).addScaledVector(tp.dir, e * r * TAPE_L);
              s.emit({ count: 2, origin: q, speed: 0.4, spread: 1, life: 0.45, size: r * 0.35, kind: KIND.GLINT, color: '#ffffff', colorEnd: SILVER });
            }
          }
          // mended: a cold light sweeps along the strip
          const sk = span(t, T.seal[0] + i * 120, T.seal[1] + i * 120);
          q.copy(tp.mesh.position).addScaledVector(tp.dir, lerp(-0.5, 0.5, easeOut(sk)) * r * TAPE_L);
          tp.sweep.set(bump(sk) * 0.8, r * 0.75, q.x, y + 0.03, q.z);
        });
        if (t >= T.fade[0] && !shed) {
          shed = true; // the tape dissolves into silver motes
          for (const tp of tapes) {
            for (let j = 0; j < 6; j++) {
              q.copy(tp.mesh.position).addScaledVector(tp.dir, (j / 5 - 0.5) * r * TAPE_L);
              s.emit({ count: 2, origin: q, dir: { x: 0, y: 1, z: 0 }, speed: 0.5, spread: 1, life: 1.1, size: r * 0.1, kind: KIND.EMBER, color: '#ffffff', colorEnd: STEEL, gravity: 0.5 });
            }
          }
        }
        if (t >= 1300 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: an ember glow under the die cools to silver, the tape fades in over it; the die stays put
        c.set(EMBER).lerp(cold, span(t, 600, 1200));
        pool.tint(c).set(0.5 * bump(t / 1600), s.r * 2, s.rest.x, 0.02, s.rest.z);
        tapes.forEach((tp, i) => {
          tp.mesh.visible = true;
          tp.mesh.position.set(s.rest.x, s.rest.y + s.r * TAPE_Y + i * 0.02, s.rest.z);
        });
        tapeMat.opacity = bump(span(t, 400, 1600));
        if (t >= 300 && !carded) ((carded = true), s.card(CARD));
        if (t >= 800 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
