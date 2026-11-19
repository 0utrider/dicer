import * as THREE from 'three';
import { runScene, runIntro, span, easeIn, outBack, smooth, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Wilted Flower (a natural 1): a flower of light blooms beside the die, glowing pink and gold,
 * and withers: its petals drop away one by one and its colour drains to dead brown.
 *
 * 0-300     a quick bloom: six petals of pink light pop open around a gold heart, a soft pool of
 *           light under them, a sprinkle of sparkles and a puff of pollen
 * 350-950   it wilts fast: the colour drains from pink to dusty brown, the head sags away from the
 *           die, and one by one (400-800) each petal lets go, fluttering down to the table
 * 800       the climax: the last petal falls, a sad fizzle and a grey wisp; the title card drops in
 * 780-1400  under the card the die sighs: a tiny sink and settle
 * 1000-1900 the dead flower's brown heart dims out, a few dry motes drifting
 *
 * Mid-roll (intro): six petals of pink light swirl round the tumbling die, drawing in and swelling
 * as they bloom, pollen and the odd shed petal trailing. Played after it, the show starts on the
 * open flower just as it begins to wilt (the bloom seen): the first petal drops on landing, the
 * last one and the card ~400 ms after.
 */
export const DURATION = 2300;
const T = { bloom: [0, 300], wilt: [350, 950], fall: 400, gap: 80, card: 800, sigh: [780, 1400], dead: [1000, 1900] };

const PINK = '#ff7aa8';
const BLUSH = '#ffd6e6';
const GOLD = '#ffd25a';
const DUSTY = '#8a5a4a';
const BROWN = '#5a3a22';
const PETALS = 6;
const ORDER = [0, 3, 1, 4, 2, 5]; // the order the petals drop in (by place in the ring)

/** Its title card, as the last petal falls. */
const CARD = Object.freeze({
  seed: 777,
  font: 'display',
  glow: '#c98a8a',
  lines: [
    { text: 'Wilted', size: 0.12, at: 0.3, fill: ['#f6d2da', '#c98f9c'], edge: '#4a2a22', enter: 'drop', tilt: -3 },
    { text: 'Nat 1', size: 0.29, at: 0.6, fill: ['#e7b3a8', '#7a4a2c'], edge: '#2e1a10', enter: 'drop', delay: 320, tilt: 2 },
  ],
  vignette: 'rgba(40,22,12,0.85)',
  confetti: { colors: ['#e9a6b4', '#c98f7a', '#8a5a3a'], count: 36 },
  hold: 900,
  exit: 'sink',
});

export const wiltedFlower = Object.freeze({
  id: 'scene-wilted-flower',
  name: 'Wilted Flower',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: a flower of light opens round the die. Six pink petals swirl round the tumbling die,
   * drawing in and swelling as they bloom, a soft pink pool on the table under it, gold pollen and
   * twinkles drifting up and the odd petal flake shed behind.
   */
  intro(env) {
    let aura;
    let petals;
    let trail;
    let last = null;
    let acc = 0;
    let motes = 0;
    return runIntro(env, {
      setup(c) {
        aura = c.glow(PINK, { core: BLUSH, width: 0.6 });
        petals = [];
        for (let i = 0; i < PETALS; i++) petals.push(c.glow(PINK, { core: BLUSH, width: 0.5 }));
        trail = c.ribbon({ head: BLUSH, tail: PINK, width: c.r * 0.35, length: 16 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = smooth(span(t, 0, 400));
        const open = Math.max(0, outBack(span(t, 0, 1000)));
        const spin = t / 420;
        const d = r * lerp(1.8, 1.1, open);
        // c.root follows the die on the table: petals swirl round it (relative x, z) at its height
        aura.set(0.4 * k * (0.85 + 0.15 * Math.sin(t / 130)), r * 2.2, 0, 0.018, 0);
        petals.forEach((g, i) => {
          const a = (i / PETALS) * TAU + spin;
          g.set(0.8 * k, r * lerp(0.2, 0.42, open), Math.cos(a) * d, Math.max(0.02, p.y), Math.sin(a) * d);
        });
        trail.push(p);
        trail.opacity(0.45 * k);
        if (dt > 0) {
          acc += dt * 16 * k;
          for (; acc >= 1; acc--) {
            const a = ((motes % PETALS) / PETALS) * TAU + spin;
            const o = { x: p.x + Math.cos(a) * d, y: Math.max(0.05, p.y), z: p.z + Math.sin(a) * d };
            if (motes % 6 === 5) c.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.5, z: Math.sin(a) }, speed: 0.7, spread: 0.4, life: 1.2, size: r * 0.2, kind: KIND.FLAKE, blend: 'normal', color: PINK, colorEnd: BLUSH, alpha: 0.85, gravity: -1.4, floor: 0.02 });
            else c.emit({ count: 1, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.7, spread: 0.6, life: 1.1, size: r * (motes % 3 ? 0.08 : 0.2), kind: motes % 3 ? KIND.EMBER : KIND.GLINT, color: motes % 2 ? GOLD : BLUSH, colorEnd: PINK, gravity: 0.6 });
            motes++;
          }
        }
      },
    });
  },
  play(ctx) {
    let spot; // the flower's centre, beside the die
    let away; // the way it sags: away from the die
    let aura; // the soft pool of light under it
    let halo; // a faint ring of light around the bloom
    let heart; // the gold heart
    let petals; // the petal glows: { glow, a, fell }
    let lastEmit = null;
    let sprinkled = false;
    let fizzled = false;
    let carded = false;
    let glinted = false;
    let acc = 0; // motes owed (dt-based)
    let motes = 0;
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const pink = new THREE.Color(PINK);
    const dusty = new THREE.Color(DUSTY);
    const gold = new THREE.Color(GOLD);
    const brown = new THREE.Color(BROWN);
    const fallAt = (i) => T.fall + ORDER[i] * T.gap; // not in ring order
    /** Draws the bloom: open 0..1, drain 0..1 (pink to brown), sag 0..1, its spin, brightness. */
    const draw = (s, t, open, drain, sag, spin, bright) => {
      const r = s.r;
      const cx = spot.x + away.x * r * 0.35 * sag;
      const cz = spot.z + away.z * r * 0.35 * sag;
      const breathe = 1 + 0.06 * Math.sin(t / 160) * (1 - drain);
      c.copy(pink).lerp(dusty, drain);
      aura.tint(c).set(open * bright * 0.55 * (1 - drain * 0.8), r * 2.4 * breathe, cx, 0.018, cz);
      halo.tint(c).set(open * bright * 0.35 * (0.8 + 0.2 * Math.sin(t / 120)) * (1 - drain), r * 1.5 * breathe, cx, 0.019, cz);
      petals.forEach((pt, i) => {
        const fall = span(t, fallAt(i), fallAt(i) + 260);
        const a = pt.a + spin;
        const d = r * 0.44 * open * breathe * (1 - 0.25 * sag);
        pt.glow.tint(c).set(open * bright * 0.85 * (1 - fall), r * 0.46 * (1 - 0.2 * sag), cx + Math.cos(a) * d, 0.02, cz + Math.sin(a) * d);
      });
      c.copy(gold).lerp(brown, drain);
      heart.tint(c).set(open * bright * (1 - 0.5 * drain), r * 0.42 * breathe, cx, 0.022, cz);
      return { x: cx, z: cz };
    };
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.fall, // it bloomed mid-roll: it lands beside the open flower as the first petal lets go
      setup(s) {
        const r = s.r;
        spot = s.beside(r * 1.7, s.side);
        away = s.side.clone();
        aura = s.glow(PINK, { core: BLUSH, width: 0.6 });
        halo = s.glow(PINK, { core: BLUSH, ring: 0.72, width: 0.12 });
        petals = [];
        for (let i = 0; i < PETALS; i++) petals.push({ glow: s.glow(PINK, { core: BLUSH, width: 0.5 }), a: (i / PETALS) * TAU, fell: false });
        heart = s.glow(GOLD, { core: '#fff6d0', width: 0.4, renderOrder: 3 });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        const open = Math.max(0, outBack(span(t, ...T.bloom)));
        const drain = smooth(span(t, ...T.wilt));
        const sag = easeIn(span(t, T.wilt[0] + 100, T.wilt[1]));
        const spin = (t / 2200) * (1 - drain * 0.8);
        const bright = 1 - easeIn(span(t, ...T.dead));
        const at = draw(s, t, open, drain, sag, spin, bright);
        // the bloom's sparkle as it opens
        if (t >= 100 && !sprinkled) {
          sprinkled = true;
          s.effect('sparkles', { color: '#ffb3cf', intensity: 0.8, duration: 900, at: new THREE.Vector3(at.x, 0.1, at.z) });
          s.emit({ count: 10, origin: { x: at.x, y: 0.1, z: at.z }, speed: 1.2, spread: 1, life: 0.7, size: r * 0.25, kind: KIND.GLINT, color: '#ffffff', colorEnd: PINK });
        }
        // pollen and twinkles while it is happy; dry motes once it is dead
        if (dt > 0 && t > 100 && t < T.dead[1]) {
          acc += dt * (t < T.wilt[0] ? 40 : 5);
          for (; acc >= 1; acc--) {
            const a = motes++ * 2.39996;
            const o = { x: at.x + Math.cos(a) * r * 0.5, y: 0.08, z: at.z + Math.sin(a) * r * 0.5 };
            if (t < T.wilt[0]) s.emit({ count: 1, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.7, spread: 0.6, life: 1.3, size: r * (motes % 3 ? 0.08 : 0.2), kind: motes % 3 ? KIND.EMBER : KIND.GLINT, color: motes % 2 ? GOLD : BLUSH, colorEnd: PINK, gravity: 0.6 });
            else s.emit({ count: 1, origin: o, dir: { x: away.x, y: 1, z: away.z }, speed: 0.4, spread: 0.8, life: 1.2, size: r * 0.07, kind: KIND.EMBER, color: '#b08070', colorEnd: BROWN, gravity: 0.3, halo: 0.2 });
          }
        }
        // the petals let go, one by one
        petals.forEach((pt, i) => {
          if (pt.fell || t < fallAt(i)) return;
          pt.fell = true;
          const a = pt.a + spin;
          const o = { x: at.x + Math.cos(a) * r * 0.45, y: r * 0.5, z: at.z + Math.sin(a) * r * 0.45 };
          c.copy(pink).lerp(dusty, drain * 0.7);
          const out = { x: Math.cos(a) + away.x * 0.6, y: 0.5, z: Math.sin(a) + away.z * 0.6 };
          s.emit({ count: 3, origin: o, dir: out, speed: 0.9, spread: 0.35, life: 1.8, size: r * 0.24, kind: KIND.FLAKE, blend: 'normal', color: `#${c.getHexString()}`, colorEnd: DUSTY, alpha: 0.9, gravity: -1.4, floor: 0.02 });
          s.emit({ count: 4, origin: o, dir: out, speed: 0.6, spread: 0.8, life: 0.8, size: r * 0.1, kind: KIND.SPARK, color: BLUSH, colorEnd: DUSTY, gravity: -0.6 });
        });
        // the last petal: a sad fizzle, a grey wisp, the card
        if (t >= T.card && !fizzled) {
          fizzled = true;
          const o = new THREE.Vector3(at.x, 0.1, at.z);
          s.effect('fizzle', { color: '#a07060', intensity: 0.7, duration: 900, at: o });
          s.emit({ count: 6, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 0.7, life: 2, size: r * 0.5, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#7a6e66', colorEnd: '#3a3430', alpha: 0.4, gravity: 0.4 });
        }
        if (t >= T.card && !carded) ((carded = true), s.card(CARD));
        // the die sighs: a tiny sink and settle
        p.copy(s.rest);
        p.y -= r * 0.07 * bump(span(t, ...T.sigh));
        s.die.pose(p, 0);
        if (t >= 500 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the bloom fades in beside the die, its colour drains and it fades; the die stays put
        const k = t / 1600;
        draw(s, 0, 1, smooth(span(t, 400, 1200)), 0, 0, bump(k));
        if (t >= 300 && !carded) ((carded = true), s.card(CARD));
        if (t >= 600 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
