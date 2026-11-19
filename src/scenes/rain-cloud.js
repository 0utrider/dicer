import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, smooth, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Rain Cloud (a natural 1): a personal storm.
 *
 * 0-350     a dark billowing cloud of smoke rolls in fast over the die and parks, a cold gloom
 *           spreading on the table under it
 * 250-1700  it rains on the die at once: streaks of rain falling from its belly, tiny splashes of
 *           light on the table, a wet sheen spreading under the die; the die shivers
 * 700       lightning: the cloud flickers from inside, a jagged bolt cracks down onto the die, a
 *           cold flash and sparks; the title card drops in
 * 880       a second, smaller flicker (an afterthought)
 * 1700-2250 the cloud drifts off and thins away; the wet sheen dries
 *
 * Mid-roll (intro): the cloud gathers over the tumbling die and chases it, lagging a little, a cold
 * gloom under it, the first drops falling and a faint flicker inside. Played after it, the show
 * starts with the rain (the roll-in already seen): the lightning comes ~450 ms after landing.
 */
export const DURATION = 2400;
const T = { roll: [0, 350], rain: [250, 1700], strike: 700, again: 880, shiver: [500, 1650], drift: [1700, 2250], thin: [1850, 2150], dry: [1850, 2350] };

const GOLDEN = 2.399963; // radians: spreads points evenly over a disc
const SMOKE = '#3d434d';
const SMOKE_DEEP = '#1c2027';
const SMOKE_TOP = '#6a717d';
const RAIN = '#a9c8ff';
const BOLT = '#e8f0ff';
const BOLT_BLUE = '#7aa6ff';

/** Its title card, at the lightning. */
const CARD = Object.freeze({
  seed: 402,
  glow: '#6f8fc8',
  font: 'display',
  lines: [
    { text: 'Gloomy', size: 0.12, at: 0.32, fill: ['#e4ecf6', '#8c9bb0'], edge: '#1c2430', enter: 'drop', tilt: -3 },
    { text: 'Fail', size: 0.29, at: 0.6, fill: ['#b9cdea', '#4d6a94'], edge: '#141c2a', enter: 'drop', delay: 260, tilt: 2 },
  ],
  vignette: 'rgba(12,20,36,0.88)',
  rain: { color: '#a9c8ff', count: 90 },
  shake: 0.4,
  hold: 900,
  exit: 'sink',
});

/** A point i of n spread evenly over a disc of radius 1 (golden-angle spiral): [x, z]. */
function disc(i, n) {
  const a = i * GOLDEN;
  const d = Math.sqrt(((i % n) + 0.5) / n);
  return [Math.cos(a) * d, Math.sin(a) * d];
}

export const rainCloud = Object.freeze({
  id: 'scene-rain-cloud',
  name: 'Rain Cloud',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: the storm finds the die. Smoke billows into a cloud over the tumbling die and chases
   * it (lagging, catching up as it slows), a gloom spreads on the table under it, the first drops
   * start to fall and splash, and now and then it flickers faintly from inside.
   */
  intro(env) {
    let gloom;
    let flicker;
    let last = null;
    let placed = false;
    let puffs = 0;
    let drops = 0;
    const cloud = new THREE.Vector3();
    const q = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        gloom = c.glow('#1a2a4a', { core: '#22324e', width: 0.6 });
        flicker = c.glow('#9cb8ff', { core: '#ffffff', width: 0.45 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        // the cloud chases the die, a little behind it, and hangs over it
        if (!placed) ((placed = true), cloud.set(p.x, p.y + r * 2.4, p.z));
        else {
          const f = 1 - Math.exp(-dt * 3.2);
          cloud.x += (p.x - cloud.x) * f;
          cloud.z += (p.z - cloud.z) * f;
          cloud.y += (p.y + r * 2.4 - cloud.y) * f;
        }
        const body = smooth(span(t, 0, 700)); // gathering
        if (dt > 0) {
          const n = Math.max(1, Math.round(dt * 40 * body));
          for (let i = 0; i < n; i++, puffs++) {
            const [x, z] = disc(puffs, 23);
            const k = puffs % 3;
            q.set(cloud.x + x * r * 1.15, cloud.y - r * 0.15 + (k === 2 ? r * 0.35 : 0), cloud.z + z * r);
            c.emit({
              count: 1,
              origin: q,
              dir: { x: x * 0.6, y: 0.3, z: z * 0.6 },
              speed: 0.25,
              spread: 0.6,
              life: 1.5,
              size: r * (k === 2 ? 0.7 : 1) * lerp(0.5, 1, body),
              sizeEnd: 1.7,
              kind: KIND.SMOKE,
              shape: SHAPE.SMOKE,
              blend: 'normal',
              color: k === 2 ? SMOKE_TOP : SMOKE,
              colorEnd: SMOKE_DEEP,
              alpha: 0.6 * body,
              gravity: 0,
              drag: 1.5,
            });
          }
        }
        // the gloom under the cloud (c.root follows the die: relative x, z)
        gloom.set(0.4 * body, r * 2.6, cloud.x - p.x, 0.02, cloud.z - p.z);
        // the first drops, thickening
        const wet = span(t, 350, 1100);
        if (dt > 0 && wet > 0) {
          const n = Math.round(dt * 30 * wet + (drops % 2) * 0.5);
          for (let i = 0; i < n; i++, drops++) {
            const [x, z] = disc(drops, 17);
            q.set(cloud.x + x * r, cloud.y - r * 0.4, cloud.z + z * r * 0.9);
            c.emit({ count: 1, origin: q, dir: { x: 0, y: -1, z: 0 }, speed: 9, spread: 0.02, life: 0.32, size: r * 0.07, stretch: 3, kind: KIND.STREAK, color: '#e2ecff', colorEnd: RAIN, alpha: 0.85, halo: 0.2, gravity: -6, floor: 0.03 });
            if (drops % 3 === 0) c.emit({ count: 1, origin: { x: q.x, y: 0.03, z: q.z }, speed: 0, life: 0.28, size: r * 0.12, sizeEnd: 3, kind: KIND.SPARK, shape: SHAPE.RING, color: '#d8e6ff', colorEnd: RAIN, alpha: 0.6, halo: 0 });
          }
        }
        // a faint flicker inside now and then: the lightning to come
        const ph = (t % 940) / 940;
        const lit = t > 500 && ph < 0.09 ? (1 - ph / 0.09) * (0.55 + 0.45 * Math.sign(Math.sin(ph * 300))) * 0.4 : 0;
        flicker.set(lit, r * 1.7, cloud.x - p.x, cloud.y - r * 0.1, cloud.z - p.z);
      },
    });
  },
  play(ctx) {
    let gloom; // the cold shade on the table under the cloud
    let sheen; // the wet sheen spreading under the die
    let flicker; // the lightning inside the cloud
    let flash; // the cold flash on the table
    let bolt; // the jagged bolt
    let puffs = 0; // smoke puffs emitted (the next one's place in the cloud)
    let drops = 0; // raindrops emitted
    let struck = false;
    let again = false;
    let glinted = false;
    let lastEmit = null;
    const cloud = new THREE.Vector3();
    const from = new THREE.Vector3();
    const away = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const q = new THREE.Vector3();
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.rain[0], // the cloud gathered mid-roll: it lands under the parked cloud, raining
      setup(s) {
        const r = s.r;
        gloom = s.glow('#1a2a4a', { core: '#22324e', width: 0.6 });
        sheen = s.glow('#5a86c8', { core: '#a8c8ff', ring: 0.55, width: 0.3 });
        flicker = s.glow('#9cb8ff', { core: '#ffffff', width: 0.45 });
        flash = s.glow('#b8d0ff', { core: '#ffffff', width: 0.55 });
        bolt = s.ribbon({ head: '#ffffff', tail: BOLT_BLUE, width: r * 0.28, length: 12 });
        from.copy(s.rest).addScaledVector(s.side, r * 5).addScaledVector(s.toward, r * 0.6);
        away.copy(s.rest).addScaledVector(s.side, -r * 6).addScaledVector(s.toward, r * 1.2);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- where the cloud is: rolls in, parks bobbing over the die, drifts off ---
        const inK = easeOut(span(t, ...T.roll));
        const outK = easeIn(span(t, ...T.drift));
        cloud.lerpVectors(from, s.rest, inK).lerp(away, outK);
        cloud.y = s.rest.y + r * 2.4 + Math.sin(t / 260) * r * 0.06;
        const body = span(t, 0, 300) * (1 - span(t, ...T.thin)); // how much cloud there is
        // --- the cloud itself: billowing smoke, dark below, paler crowns on top ---
        if (dt > 0 && body > 0.02) {
          const n = Math.max(1, Math.round(dt * 46 * body));
          for (let i = 0; i < n; i++, puffs++) {
            const [x, z] = disc(puffs, 23);
            const k = puffs % 3;
            q.set(cloud.x + x * r * 1.15, cloud.y - r * 0.15 + (k === 2 ? r * 0.35 : 0), cloud.z + z * r * 1.0);
            s.emit({
              count: 1,
              origin: q,
              dir: { x: x * 0.6, y: 0.3, z: z * 0.6 },
              speed: 0.25,
              spread: 0.6,
              life: 1.5,
              size: r * (k === 2 ? 0.7 : 1),
              sizeEnd: 1.7,
              kind: KIND.SMOKE,
              shape: SHAPE.SMOKE,
              blend: 'normal',
              color: k === 2 ? SMOKE_TOP : SMOKE,
              colorEnd: SMOKE_DEEP,
              alpha: 0.6,
              gravity: 0,
              drag: 1.5,
            });
          }
        }
        // --- the gloom under it ---
        gloom.set(0.45 * body, r * 2.6, cloud.x, 0.02, cloud.z);
        // --- the rain ---
        const raining = t >= T.rain[0] && t < T.rain[1];
        if (raining && dt > 0) {
          const n = Math.max(1, Math.round(dt * 70));
          for (let i = 0; i < n; i++, drops++) {
            const [x, z] = disc(drops, 17);
            q.set(cloud.x + x * r * 1.0, cloud.y - r * 0.4, cloud.z + z * r * 0.9);
            s.emit({ count: 1, origin: q, dir: { x: 0, y: -1, z: 0 }, speed: 9, spread: 0.02, life: 0.32, size: r * 0.07, stretch: 3, kind: KIND.STREAK, color: '#e2ecff', colorEnd: RAIN, alpha: 0.85, halo: 0.2, gravity: -6, floor: 0.03 });
            // a splash on the table (the drops near the middle land on the die and splash there)
            if (drops % 2 === 0) {
              const onDie = x * x + z * z < 0.2;
              const [sx, sz] = disc(drops + 7, 13);
              s.emit({ count: 1, origin: { x: s.rest.x + sx * r * 1.3, y: onDie ? s.rest.y + r * 0.6 : 0.03, z: s.rest.z + sz * r * 1.3 }, speed: 0, life: 0.28, size: r * 0.12, sizeEnd: 3, kind: KIND.SPARK, shape: SHAPE.RING, color: '#d8e6ff', colorEnd: RAIN, alpha: 0.7, halo: 0 });
            }
          }
        }
        // --- the wet sheen spreading under the die, then drying ---
        const pk = smooth(span(t, 300, 1600));
        const dry = 1 - span(t, ...T.dry);
        sheen.set(0.35 * pk * dry * (0.85 + 0.15 * Math.sin(t / 140)), r * lerp(0.8, 2, pk), s.rest.x, 0.022, s.rest.z);
        // --- lightning ---
        const f1 = span(t, T.strike, T.strike + 320);
        const f2 = span(t, T.again, T.again + 220);
        // a stutter of flickers rather than one smooth pulse
        const stutter = (k) => (k > 0 && k < 1 ? (1 - k) * (0.55 + 0.45 * Math.sign(Math.sin(k * 38))) : 0);
        const lit = Math.max(stutter(f1), 0.6 * stutter(f2));
        flicker.set(1.1 * lit, r * lerp(1.6, 2.2, lit), cloud.x + s.side.x * r * 0.3 * (f2 > 0 ? -1 : 1), cloud.y - r * 0.1, cloud.z + s.side.z * r * 0.3);
        flash.set(0.9 * stutter(f1) + 0.3 * stutter(f2), r * 2.6, s.rest.x, 0.03, s.rest.z);
        if (t >= T.strike && !struck) {
          struck = true;
          s.shake(0.2, 160);
          s.card(CARD);
          // the bolt: a jagged line from the cloud's belly down to the die's top (fixed zigzag)
          bolt.reset();
          const top = { x: cloud.x + s.side.x * r * 0.5, y: cloud.y - r * 0.3, z: cloud.z + s.side.z * r * 0.5 };
          const end = { x: s.rest.x, y: s.rest.y + r * 0.5, z: s.rest.z };
          const zig = [0, 0.32, -0.28, 0.4, -0.18, 0.3, -0.35, 0.22, -0.12, 0.1, 0, 0];
          for (let i = 0; i < zig.length; i++) {
            const k = i / (zig.length - 1);
            pos.set(lerp(top.x, end.x, k), lerp(top.y, end.y, k), lerp(top.z, end.z, k));
            pos.addScaledVector(s.toward, zig[i] * r * 0.45);
            bolt.push(pos);
          }
          const o = { x: s.rest.x, y: s.rest.y + r * 0.5, z: s.rest.z };
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TAU + 0.2;
            s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.4, z: Math.sin(a) }, speed: 4 + (i % 3), spread: 0.15, life: 0.4, size: r * 0.14, kind: KIND.STREAK, color: BOLT, colorEnd: BOLT_BLUE, gravity: -8, floor: 0.04 });
          }
          s.emit({ count: 4, origin: o, speed: 0.5, spread: 1, life: 0.35, size: r * 0.7, kind: KIND.GLINT, color: '#ffffff', colorEnd: BOLT_BLUE });
          s.emit({ count: 5, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.8, spread: 1, life: 1.2, size: r * 0.5, sizeEnd: 2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a4e58', colorEnd: '#22252c', alpha: 0.45, gravity: 0.5 });
        }
        if (t >= T.again && !again) {
          again = true;
          s.glint();
          s.emit({ count: 2, origin: { x: cloud.x, y: cloud.y, z: cloud.z }, speed: 0.4, spread: 1, life: 0.3, size: r * 0.6, kind: KIND.GLINT, color: '#ffffff', colorEnd: BOLT_BLUE });
        }
        bolt.opacity(f1 > 0 ? 1.2 * stutter(Math.min(1, f1 * 1.6)) : 0);
        // --- the die shivers while the storm sits on it (an envelope that ends exactly at rest) ---
        const env = bump(span(t, ...T.shiver));
        const jolt = f1 > 0 && f1 < 0.4 ? (1 - f1 / 0.4) * 0.6 : 0;
        pos.copy(s.rest).addScaledVector(s.side, Math.sin(t / 22) * r * (0.035 * env + 0.05 * jolt));
        s.die.pose(pos, Math.sin(t / 31) * 0.006 * env);
        if (t >= 2000 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: a cold gloom and a wet sheen gather round the die; one soft flicker; the die stays put
        const r = s.r;
        const o = bump(t / 1600);
        gloom.set(0.4 * o, r * 2.4, s.rest.x, 0.02, s.rest.z);
        sheen.set(0.3 * o, r * 1.6, s.rest.x, 0.022, s.rest.z);
        flicker.set(0.6 * bump(span(t, 500, 800)), r * 1.8, s.rest.x, s.rest.y + r * 2, s.rest.z);
        if (t >= 500 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
        }
      },
    });
  },
});
