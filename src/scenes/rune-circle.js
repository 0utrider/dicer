import * as THREE from 'three';
import { runScene, runIntro, span, smooth, easeOut, easeIn, bump, lerp, TAU, KIND } from './kit.js';

/**
 * Rune Circle (a natural 20): an arcane circle of pure light, no solid shapes.
 *
 * 0-400     two pens of light race round the table under the die in opposite directions, comet
 *           ribbons behind them, and the outer rings light up behind them as they go
 * 100-450   the inner ring fades in; 150-560 the eight glyphs ignite in a quick run, each a spark
 * 300-600   the die levitates over the circle and spins; arcane motes curl up off the rings
 * 450-750   the circle whirls faster; 600 it flares: every glyph flashes
 * 700-800   the die slams down home: a light burst, a shockwave, sparks raking out, the rings
 *           blown wide; the title card zooms in
 * 800-2000  under the card the circle keeps turning, expanding, and fades out (1300-1900)
 * Mid-roll intro: the two pens are already tracing the circle round the tumbling die, the rings
 * lighting behind them; played after it, the show starts with the circle drawn and its glyphs
 * igniting at once as the die lands, rises from home (230 ms), flares and slams.
 */
export const DURATION = 2000;
/** Played after its intro, the show starts here; the die then rises from home over RISE ms. */
const SKIP = 420;
const RISE = 230;
const GLYPH_STEP = 30; // ms between glyphs igniting
const T = { draw: [0, 400], inner: [100, 450], glyphs: 150, up: [300, 600], whirl: [450, 750], flare: 600, slam: [700, 800], land: 800, fade: [1300, 1900] };

const GLYPHS = 8;
const NODES = 4; // bright nodes on the inner ring, turning the other way
const PEN = 16; // pen ribbon points
const LAG = 22; // ms between them

const WHITE = '#effcff';
const CYAN = '#4fe3ff';
const VIOLET = '#9a6bff';
const DEEP = '#3a1a9a';

const CARD = Object.freeze({
  seed: 3403,
  glow: '#7a5cff',
  font: 'tech',
  lines: [
    { text: 'Arcane', size: 0.12, at: 0.31, fill: ['#e8fdff', '#7fe9ff'], edge: '#0e2a5a', enter: 'zoom' },
    { text: 'Mastery', size: 0.27, at: 0.62, fill: ['#f2eaff', '#9a6bff'], edge: '#1c0a4a', enter: 'zoom', delay: 260 },
  ],
  rays: { colors: ['#4fe3ff', '#9a6bff'], spin: 0.16 },
  vignette: 'rgba(12,4,40,0.75)',
  sparks: { colors: ['#effcff', '#4fe3ff', '#b89aff'], count: 60 },
  hold: 900,
  exit: 'fade',
});

export const runeCircle = Object.freeze({
  id: 'scene-rune-circle',
  name: 'Rune Circle',
  outcome: 'critical-success',
  duration: DURATION,
  /**
   * Mid-roll: pens of light are already tracing the circle round the tumbling die, comet ribbons
   * behind them, the outer rings lighting up and the inner ring glimmering in, a pool of light
   * under the die; the circle follows the die. At landing its glyphs ignite and the die rises.
   */
  intro(env) {
    let outer;
    let outer2;
    let inner;
    let pool;
    let pens;
    let last = null;
    const q = new THREE.Vector3();
    const angle = (i, t) => (i ? Math.PI : 0) + (i ? -1 : 1) * TAU * (t / 1100 + 0.4 * easeOut(span(t, 0, 600)));
    return runIntro(env, {
      setup(c) {
        outer = c.glow(VIOLET, { ring: 0.93, width: 0.035 });
        outer2 = c.glow(CYAN, { ring: 0.85, width: 0.022 });
        inner = c.glow(CYAN, { ring: 0.58, width: 0.03 });
        pool = c.glow(VIOLET, { core: CYAN, width: 0.45 });
        pens = [0, 1].map((i) => ({
          glow: c.glow(i ? VIOLET : CYAN, { core: '#ffffff', width: 0.4 }),
          ribbon: c.ribbon({ head: WHITE, tail: i ? VIOLET : CYAN, width: c.r * 0.35, length: PEN }),
        }));
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const f = Math.floor(t / 16);
        const R = r * 1.9;
        const o = span(t, 0, 200);
        pens.forEach((pen, i) => {
          pen.ribbon.reset();
          for (let k = PEN - 1; k >= 0; k--) {
            const a = angle(i, Math.max(0, t - k * LAG));
            q.set(p.x + Math.cos(a) * R * 0.93, 0.03, p.z + Math.sin(a) * R * 0.93);
            pen.ribbon.push(q);
          }
          pen.ribbon.opacity(o);
          const a = angle(i, t);
          pen.glow.set(o * 1.1, r * 0.5, Math.cos(a) * R * 0.93, 0.03, Math.sin(a) * R * 0.93);
          if (dt > 0 && f % 2 === i) {
            q.set(p.x + Math.cos(a) * R * 0.93, 0.03, p.z + Math.sin(a) * R * 0.93);
            c.emit({ count: 1, origin: q, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 0.6, size: r * 0.1, kind: KIND.SPARK, color: WHITE, colorEnd: i ? VIOLET : CYAN, gravity: -1 });
          }
        });
        const shimmer = 0.9 + 0.1 * Math.sin(t / 70);
        outer.set(0.85 * smooth(span(t, 0, 900)) * shimmer, R, 0, 0.02, 0);
        outer2.set(0.65 * smooth(span(t, 150, 1000)) * shimmer, R, 0, 0.021, 0);
        inner.set(0.45 * smooth(span(t, 400, 1300)) * shimmer, R, 0, 0.022, 0);
        pool.set(0.35 * smooth(span(t, 200, 900)), r * 1.4, 0, 0.019, 0);
      },
    });
  },
  play(ctx) {
    let outer; // the outer double ring
    let outer2;
    let inner;
    let pool; // the light under the die
    let shock; // the slam's ring of light
    let glyphs;
    let nodes;
    let pens; // [{ glow, ribbon }]
    let lastEmit = null;
    let flared = false;
    let landed = false;
    let glinted = false;
    const lit = new Array(GLYPHS).fill(false);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();

    /** The angle of pen `i` (0 or 1) at time t: they race round in opposite directions. */
    const penAngle = (i, t) => (i ? Math.PI : 0) + (i ? -1 : 1) * TAU * easeOut(span(t, ...T.draw));
    /** The circle's turn at t. */
    const turn = (t) => t / 1400 + 2.2 * easeIn(span(t, ...T.whirl));

    return runScene(ctx, {
      duration: DURATION,
      introSkip: SKIP, // the circle was traced mid-roll: it starts drawn, the die about to rise
      setup(s) {
        outer = s.glow(VIOLET, { ring: 0.93, width: 0.035 });
        outer2 = s.glow(CYAN, { ring: 0.85, width: 0.022 });
        inner = s.glow(CYAN, { ring: 0.58, width: 0.03 });
        pool = s.glow(VIOLET, { core: CYAN, width: 0.45 });
        shock = s.glow(CYAN, { ring: 0.8, width: 0.08 });
        glyphs = Array.from({ length: GLYPHS }, () => s.glow(CYAN, { core: '#ffffff', width: 0.35 }));
        nodes = Array.from({ length: NODES }, () => s.glow(VIOLET, { core: WHITE, width: 0.35 }));
        pens = [0, 1].map((i) => ({
          glow: s.glow(i ? VIOLET : CYAN, { core: '#ffffff', width: 0.4 }),
          ribbon: s.ribbon({ head: WHITE, tail: i ? VIOLET : CYAN, width: s.r * 0.35, length: PEN }),
        }));
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        const f = Math.floor(t / 16);
        const { x, z } = s.rest;
        const flare = bump(span(t, T.flare, T.land + 150));
        const fade = 1 - span(t, ...T.fade);
        const R = r * 1.9 * (1 + 0.15 * flare + 0.35 * easeOut(span(t, T.land, DURATION)));
        const ang = turn(t);
        // --- the pens drawing the outer ring ---
        const drawK = span(t, ...T.draw);
        pens.forEach((pen, i) => {
          pen.ribbon.reset();
          for (let k = PEN - 1; k >= 0; k--) {
            const a = penAngle(i, t - k * LAG);
            q.set(x + Math.cos(a) * R * 0.93, 0.03, z + Math.sin(a) * R * 0.93);
            pen.ribbon.push(q);
          }
          const o = t < T.draw[1] ? 1 : 1 - span(t, T.draw[1], T.draw[1] + 250);
          pen.ribbon.opacity(o);
          const a = penAngle(i, t);
          q.set(x + Math.cos(a) * R * 0.93, 0.03, z + Math.sin(a) * R * 0.93);
          pen.glow.set(o * 1.1, r * 0.5, q.x, q.y, q.z);
          if (dt > 0 && o > 0.5 && f % 2 === i) {
            s.emit({ count: 1, origin: q, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 0.6, size: r * 0.1, kind: KIND.SPARK, color: WHITE, colorEnd: i ? VIOLET : CYAN, gravity: -1 });
          }
        });
        // --- the rings ---
        const shimmer = 0.9 + 0.1 * Math.sin(t / 70);
        outer.set(smooth(drawK) * shimmer * fade * (1 + 0.8 * flare), R, x, 0.02, z);
        outer2.set(smooth(span(t, 150, 900)) * 0.8 * shimmer * fade * (1 + 0.8 * flare), R, x, 0.021, z);
        inner.set(smooth(span(t, ...T.inner)) * 0.85 * fade * (1 + flare), R, x, 0.022, z);
        // --- the glyphs, igniting one by one, turning with the circle; the nodes the other way ---
        glyphs.forEach((g, i) => {
          const on = s.introduced ? SKIP + i * GLYPH_STEP : T.glyphs + i * GLYPH_STEP; // introduced: they ignite in a quick run on landing
          const a = ang + (i / GLYPHS) * TAU;
          q.set(x + Math.cos(a) * R * 0.715, 0.03, z + Math.sin(a) * R * 0.715);
          const ign = span(t, on, on + 200);
          const flicker = 0.85 + 0.15 * Math.sin(t / 55 + i * 1.7);
          g.set(ign * flicker * fade * (1 + 1.2 * flare) + 1.2 * bump(ign) * fade, r * (0.36 + 0.25 * bump(ign) + 0.2 * flare), q.x, q.y, q.z);
          if (t >= on && !lit[i]) {
            lit[i] = true;
            s.emit({ count: 6, origin: q, dir: { x: 0, y: 1, z: 0 }, speed: 1.2, spread: 1, life: 0.5, size: r * 0.1, kind: KIND.SPARK, color: WHITE, colorEnd: CYAN, gravity: -2 });
            s.emit({ count: 1, origin: q, speed: 0, life: 0.45, size: r * 0.5, kind: KIND.GLINT, color: '#ffffff', colorEnd: CYAN });
          }
        });
        nodes.forEach((g, i) => {
          const a = -ang * 1.6 + (i / NODES) * TAU;
          g.set(smooth(span(t, ...T.inner)) * 0.9 * fade * (1 + flare), r * 0.3, x + Math.cos(a) * R * 0.58, 0.031, z + Math.sin(a) * R * 0.58);
        });
        // --- arcane motes curling up off the rings while the die hangs over them ---
        if (dt > 0 && t > T.up[0] && t < T.slam[0] && f % 2 === 0) {
          const a = f * 2.39996; // a golden-angle walk round the circle
          q.set(x + Math.cos(a) * R * 0.9, 0.05, z + Math.sin(a) * R * 0.9);
          s.emit({ count: 1, origin: q, dir: { x: -Math.sin(a), y: 1.2, z: Math.cos(a) }, speed: 1.2, spread: 0.3, life: 1, size: r * 0.12, kind: KIND.SPIRAL, color: f % 4 ? CYAN : VIOLET, colorEnd: DEEP, gravity: 0.6, drag: 1 });
        }
        // --- the die: levitates, spins over the circle, slams down home ---
        // (played introduced it rises from home at SKIP instead, its turns starting there too)
        const from = s.introduced ? SKIP : T.up[0];
        const up = smooth(s.introduced ? span(t, SKIP, SKIP + RISE) : span(t, ...T.up));
        const bob = r * 0.08 * Math.sin((t - from) / 220) * up;
        const slam = easeIn(span(t, ...T.slam));
        p.set(x, s.rest.y + (r * 0.9 + bob) * up * (1 - slam), z);
        s.die.pose(p, 2 * smooth(span(t, from, T.land)));
        pool.set((0.25 + 0.55 * up * (1 - slam)) * smooth(span(t, ...T.inner)) * fade + 0.8 * flare, r * (1.4 + 0.4 * up), x, 0.019, z);
        // --- the flare, then the slam ---
        if (t >= T.flare && !flared) {
          flared = true;
          s.effect('glow-pulse', { color: VIOLET, intensity: 0.8, duration: 600 });
        }
        if (t >= T.land && !landed) {
          landed = true;
          s.shake(0.3, 220);
          s.card(CARD);
          s.effect('light-burst', { color: '#bfefff', intensity: 1.1, duration: 800 });
          s.effect('shockwave', { color: CYAN, intensity: 1, duration: 900 });
          const o = { x, y: 0.1, z };
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TAU + (i % 2) * 0.13;
            s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.25, z: Math.sin(a) }, speed: 6 + (i % 4), spread: 0.08, life: 0.5, size: r * 0.18, kind: KIND.STREAK, color: WHITE, colorEnd: i % 2 ? CYAN : VIOLET, gravity: -6, floor: 0.04 });
          }
          s.emit({ count: 20, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 1, life: 1.1, size: r * 0.12, kind: KIND.SPIRAL, color: CYAN, colorEnd: VIOLET, gravity: 0.5, drag: 1 });
        }
        const k = span(t, T.land, T.land + 650);
        shock.set(t >= T.land ? 1.2 * (1 - k) ** 1.4 : 0, r * lerp(1.2, 4.2, easeOut(k)), x, 0.023, z);
        if (t >= T.land + 80 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the whole circle glows in under the die, its glyphs lit, and fades; the card
        const r = s.r;
        const k = bump(t / 1600);
        const R = r * 1.9;
        const { x, z } = s.rest;
        outer.set(k, R, x, 0.02, z);
        outer2.set(k * 0.8, R, x, 0.021, z);
        inner.set(k * 0.85, R, x, 0.022, z);
        pool.set(k * 0.5, r * 1.4, x, 0.019, z);
        const ang = t / 1400;
        glyphs.forEach((g, i) => {
          const a = ang + (i / GLYPHS) * TAU;
          g.set(k * 0.9, r * 0.36, x + Math.cos(a) * R * 0.715, 0.03, z + Math.sin(a) * R * 0.715);
        });
        if (t >= 500 && !glinted) ((glinted = true), s.glint(), s.card(CARD));
      },
    });
  },
});
