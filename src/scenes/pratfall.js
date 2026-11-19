import * as THREE from 'three';
import { runScene, runIntro, arc, span, easeOut, smooth, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Pratfall (a natural 1): the die tries a proud hop and face-plants into an invisible wall. Light,
 * dust and sparks from the dice effects' own particle pool, no solid shapes.
 *
 * 0-250     a proud crouch: a warm gold glow swells under the die, a few sparkles of self-regard
 * 250-700   the hop, up to the top of its arc, a gold ribbon behind it...
 * 700       BONK: the invisible wall flares into sight, a line of pale light with a crackle running
 *           along it and a ripple from the hit; a starburst of streaks fans back; the screen shakes;
 *           the title card stamps in
 * 700-1150  it bounces back and drops, spinning, trailing a dizzy purple ribbon; a puff of dust
 * 1150-1650 it tumbles over itself home in a low hop
 * 1650      it flops down flat: a ring of dust rolls out, grit skitters; a bruise of purple and
 *           orange light throbs on it and a sad wisp of smoke curls up
 *
 * Mid-roll (intro): the tumbling die is already full of itself: a gold glow rides under it and on
 * it, a faint gold ribbon trails it, sparkles of self-regard twinkle off it, and ahead of it (toward
 * the table's middle, where the wall will be) a faint pale shimmer flickers in and out. At landing
 * the show skips the crouch and goes straight into the proud hop.
 */
export const DURATION = 2600;
const T = {
  crouch: [0, 250],
  hop: [250, 700],
  bonk: 700,
  back: [700, 1150],
  tumble: [1150, 1650],
  flop: 1650,
  wall: [680, 1100],
  bruise: [1700, 2500],
};
const WALL_GLOWS = 7;

const GOLD = '#ffd27a';
const PANE = '#bfe6ff';
const ICE = '#e8f6ff';
const BRUISE = '#8a3cff';
const SORE = '#ff8a3c';
const DUST = '#d8ccb0';
const DUSK = '#7c705c';

/** Its title card, at the bonk: a stamped splat in bruised purple and orange, dust flying. */
const CARD = Object.freeze({
  seed: 47,
  glow: '#ff7a2a',
  font: 'display',
  lines: [
    {
      text: 'Splat!',
      size: 0.29,
      at: 0.42,
      fill: ['#ffc07a', '#e0561e'],
      edge: '#3a1050',
      enter: 'stamp',
      tilt: -6,
    },
    {
      text: 'Fumble',
      size: 0.12,
      at: 0.68,
      fill: ['#ecd2ff', '#8a4cc8'],
      edge: '#2a0a3a',
      enter: 'pop',
      delay: 320,
      tilt: 3,
    },
  ],
  sparks: { colors: ['#efe4c8', '#c9b48f', '#ffb46b'], count: 44 },
  shake: 0.9,
  hold: 900,
  exit: 'sink',
});

export const pratfall = Object.freeze({
  id: 'scene-pratfall',
  name: 'Pratfall',
  outcome: 'critical-failure',
  duration: DURATION,
  intro(env) {
    let pride; // the gold glow under the rolling die
    let halo; // the gold glow on it
    let trail; // a faint gold ribbon behind it
    let shimmer; // the faint glows along the wall ahead
    let last = null;
    let n = 0;
    const ahead = new THREE.Vector3();
    const across = new THREE.Vector3();
    const o = new THREE.Vector3();
    const at = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        pride = c.glow(GOLD, { core: '#fff4d0', width: 0.5 });
        halo = c.glow(GOLD, { core: '#fffbe8', width: 0.4 });
        trail = c.ribbon({ head: '#fff2c0', tail: '#ff9a3c', width: c.r * 0.55, length: 16 });
        shimmer = Array.from({ length: WALL_GLOWS }, () =>
          c.glow(PANE, { core: '#ffffff', width: 0.45 }),
        );
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = smooth(span(t, 0, 450));
        // c.root follows the die on the table: glows sit relative to it (x, z)
        pride.set(0.6 * k, r * (1.7 + 0.15 * Math.sin(t / 110)), 0, 0.02, 0);
        halo.set(0.35 * k * (0.8 + 0.2 * Math.sin(t / 70)), r * 1.3, 0, p.y, 0);
        trail.push(p);
        trail.opacity(0.45 * k);
        // sparkles of self-regard twinkling off it
        if (dt > 0 && Math.round(t / 16) % 5 === 0) {
          const i = n++;
          at.set(
            p.x + Math.cos(i * 2.4) * r * 0.7,
            p.y + r * (0.3 + 0.4 * Math.sin(i * 1.3)),
            p.z + Math.sin(i * 2.4) * r * 0.7,
          );
          c.emit({
            count: 1,
            origin: at,
            speed: 0.4,
            spread: 1,
            life: 0.5,
            size: r * 0.24 * k,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: GOLD,
          });
        }
        // the invisible wall ahead (toward the table's middle): a faint flickering shimmer
        ahead.set(-p.x, 0, -p.z);
        if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, 1);
        ahead.normalize();
        across.set(ahead.z, 0, -ahead.x);
        const shim = 0.22 * smooth(span(t, 250, 900));
        shimmer.forEach((g, i) => {
          const u = (i / (WALL_GLOWS - 1)) * 2 - 1;
          const flick = 0.5 + 0.5 * Math.sin(t / 140 + i * 1.9);
          o.copy(ahead)
            .multiplyScalar(r * 2.3)
            .addScaledVector(across, u * r * 1.7);
          g.set(shim * flick * (1 - 0.6 * Math.abs(u)), r * (0.6 - 0.15 * Math.abs(u)), o.x, r * 2.1, o.z);
        });
        if (shim > 0.1 && dt > 0 && Math.round(t / 16) % 9 === 0) {
          o.copy(ahead)
            .multiplyScalar(r * 2.3)
            .addScaledVector(across, Math.sin(t * 0.37) * r * 1.5);
          at.set(p.x + o.x, r * 2.1, p.z + o.z);
          c.emit({
            count: 1,
            origin: at,
            speed: 0.15,
            spread: 1,
            life: 0.3,
            size: r * 0.14,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: PANE,
          });
        }
      },
    });
  },
  play(ctx) {
    let pride; // the gold glow under the proud die
    let wall; // the glows along the wall's line of light
    let ripple; // the ripple ring from the hit
    let flare; // the bright spot of the hit
    let bruise; // the throbbing bruise light on the die
    let hopTrail; // the gold ribbon of the hop
    let dizzy; // the purple ribbon of the bounce back
    let wallAt;
    let across; // along the wall (across the hop)
    let lastEmit = null;
    let bonked = false;
    let landed = false;
    let flopped = false;
    let glinted = false;
    let sparkled = false;
    const pos = new THREE.Vector3();
    const far = new THREE.Vector3();
    const bonk = new THREE.Vector3();
    const land = new THREE.Vector3();
    const o = new THREE.Vector3();
    /** A puff of dust rolling out from `at` (a ring of n), with grit skittering. */
    const dust = (s, at, n, speed) => {
      const r = s.r;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.4;
        s.emit({
          count: 1,
          origin: { x: at.x, y: 0.1, z: at.z },
          dir: { x: Math.cos(a), y: 0.08, z: Math.sin(a) },
          speed,
          spread: 0.15,
          life: 1.2,
          size: r * 0.55,
          sizeEnd: 2.3,
          kind: KIND.SMOKE,
          shape: SHAPE.SMOKE,
          blend: 'normal',
          color: DUST,
          colorEnd: DUSK,
          alpha: 0.5,
        });
      }
      s.emit({
        count: n,
        origin: { x: at.x, y: 0.12, z: at.z },
        dir: { x: 0, y: 1, z: 0 },
        speed: 2.8,
        spread: 1.1,
        life: 0.7,
        size: r * 0.06,
        kind: KIND.SHARD,
        shape: SHAPE.SHARD,
        blend: 'normal',
        color: '#8a7c64',
        colorEnd: '#5c5244',
        gravity: -10,
        floor: 0.04,
      });
    };
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.hop[0], // already proud mid-roll: it lands and hops
      setup(s) {
        const r = s.r;
        const peakY = s.rest.y + r * 1.1;
        // the hop aims past the wall; it is stopped halfway, at the top of its arc
        far.copy(s.rest).addScaledVector(s.toward, r * 3);
        bonk
          .copy(s.rest)
          .addScaledVector(s.toward, r * 1.5)
          .setY(peakY);
        land.copy(s.rest).addScaledVector(s.toward, -r * 0.7);
        wallAt = s.rest
          .clone()
          .addScaledVector(s.toward, r * 2.3)
          .setY(peakY);
        across = s.side.clone();
        pride = s.glow(GOLD, { core: '#fff4d0', width: 0.5 });
        wall = Array.from({ length: WALL_GLOWS }, () =>
          s.glow(PANE, { core: '#ffffff', width: 0.45 }),
        );
        ripple = s.glow(ICE, { core: '#ffffff', ring: 0.6, width: 0.14 });
        flare = s.glow('#fff0d0', { core: '#ffffff', width: 0.4 });
        bruise = s.glow(BRUISE, { core: SORE, width: 0.45 });
        hopTrail = s.ribbon({ head: '#fff2c0', tail: '#ff9a3c', width: r * 0.8, length: 18 });
        dizzy = s.ribbon({ head: '#e0c0ff', tail: BRUISE, width: r * 0.7, length: 22 });
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the die's path ---
        let turns;
        const dip = s.introduced ? 0 : r * 0.1; // no crouch when it hops straight from the landing
        if (t < T.hop[0]) {
          pos.copy(s.rest);
          pos.y -= dip * smooth(span(t, ...T.crouch));
          turns = 0;
        } else if (t < T.bonk) {
          const k = span(t, ...T.hop);
          arc(s.rest, far, 0.5 * k, r * 1.1, pos);
          pos.y = lerp(s.rest.y - dip, pos.y, smooth(Math.min(1, k * 4)));
          turns = 0.08 * easeOut(k);
        } else if (t < T.tumble[0]) {
          const k = span(t, ...T.back);
          pos.lerpVectors(bonk, land, easeOut(k));
          pos.y = lerp(bonk.y, s.rest.y, k * k) + r * 0.3 * bump(k);
          turns = lerp(0.08, -0.8, easeOut(k));
        } else if (t < T.flop) {
          const k = span(t, ...T.tumble);
          arc(land, s.rest, k, r * 0.45, pos);
          turns = lerp(-0.8, -2, easeOut(k));
        } else {
          pos.copy(s.rest);
          pos.y -= r * 0.12 * bump(span(t, T.flop, T.flop + 300));
          turns = -2;
        }
        s.die.pose(pos, turns);
        // --- pride: a gold glow and sparkles, then the gold hop ribbon ---
        const proud = smooth(span(t, ...T.crouch)) * (1 - span(t, T.bonk, T.bonk + 200));
        pride.set(0.7 * proud, r * lerp(1.6, 2.2, proud), pos.x, 0.02, pos.z);
        if (t >= 120 && !sparkled) {
          sparkled = true;
          s.emit({
            count: 5,
            origin: s.rest,
            speed: 0.6,
            spread: 1,
            life: 0.6,
            size: r * 0.28,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: GOLD,
          });
        }
        if (t >= T.hop[0] && t < T.bonk) {
          hopTrail.push(pos);
          hopTrail.opacity(0.8);
        } else hopTrail.opacity(Math.max(0, 0.8 - span(t, T.bonk, T.bonk + 160)));
        // --- the bonk ---
        if (t >= T.bonk && !bonked) {
          bonked = true;
          s.shake(0.3, 220);
          s.card(CARD);
          s.effect('light-burst', { color: ICE, intensity: 0.8, duration: 500, at: bonk.clone() });
          // a starburst of streaks fanning back from the hit
          for (let i = 0; i < 14; i++) {
            const a = Math.atan2(-s.toward.z, -s.toward.x) + ((i - 6.5) / 6.5) * 1.5;
            s.emit({
              count: 1,
              origin: bonk,
              dir: { x: Math.cos(a), y: 0.25, z: Math.sin(a) },
              speed: 5 + (i % 4),
              spread: 0.06,
              life: 0.4,
              size: r * 0.14,
              kind: KIND.STREAK,
              color: '#fffbe8',
              colorEnd: SORE,
              gravity: -6,
            });
          }
          s.emit({
            count: 6,
            origin: bonk,
            speed: 1.2,
            spread: 1,
            life: 0.6,
            size: r * 0.32,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: '#c8a0ff',
          });
          // a crackle of light running both ways along the wall
          for (const dir of [1, -1]) {
            s.emit({
              count: 8,
              origin: wallAt,
              dir: { x: across.x * dir, y: 0, z: across.z * dir },
              speed: 6,
              spread: 0.12,
              life: 0.45,
              size: r * 0.1,
              kind: KIND.SPARK,
              color: '#ffffff',
              colorEnd: PANE,
            });
          }
        }
        // the wall: a flickering line of pale light, brightest where it was hit
        const wk = span(t, ...T.wall);
        const lit = t >= T.wall[0] ? bump(Math.min(1, wk * 1.6 + 0.2)) * (1 - wk) * 1.4 : 0;
        wall.forEach((g, i) => {
          const u = (i / (WALL_GLOWS - 1)) * 2 - 1;
          const flick = 0.75 + 0.25 * Math.sin(t / 18 + i * 1.7);
          o.copy(wallAt).addScaledVector(across, u * r * 1.7);
          g.set(
            lit * flick * (1 - 0.55 * Math.abs(u)),
            r * (0.75 - 0.2 * Math.abs(u)),
            o.x,
            o.y,
            o.z,
          );
        });
        if (lit > 0.1 && dt > 0) {
          const u = Math.sin(t * 0.37) * 1.7;
          o.copy(wallAt).addScaledVector(across, u * r);
          s.emit({
            count: 1,
            origin: o,
            speed: 0.2,
            spread: 1,
            life: 0.25,
            size: r * 0.18,
            kind: KIND.GLINT,
            color: '#ffffff',
            colorEnd: PANE,
          });
        }
        const hk = span(t, T.bonk, T.bonk + 420);
        ripple.set(
          t >= T.bonk ? 0.9 * (1 - hk) : 0,
          r * lerp(0.3, 1.5, easeOut(hk)),
          bonk.x,
          bonk.y,
          bonk.z,
        );
        flare.set(
          t >= T.bonk ? 1.2 * (1 - span(t, T.bonk, T.bonk + 220)) : 0,
          r * 1.1,
          bonk.x,
          bonk.y,
          bonk.z,
        );
        // --- the dizzy ribbon while it bounces back and tumbles ---
        if (t >= T.bonk && t < T.flop) {
          dizzy.push(pos);
          dizzy.opacity(0.6);
        } else dizzy.opacity(Math.max(0, 0.6 - span(t, T.flop, T.flop + 220)));
        // --- dust where it lands, then where it flops ---
        if (t >= T.tumble[0] && !landed) ((landed = true), dust(s, land, 6, 1.6));
        if (t >= T.flop && !flopped) {
          flopped = true;
          dust(s, s.rest, 12, 2.6);
          s.shake(0.12, 120);
          s.effect('shockwave', { color: DUST, intensity: 0.5, duration: 700 });
        }
        // --- the bruise: throbbing purple-orange light, a sad wisp of smoke ---
        const bz = span(t, ...T.bruise);
        const throb = bz > 0 ? bump(bz) * (0.65 + 0.35 * Math.sin((t - T.bruise[0]) / 70)) : 0;
        bruise.set(0.75 * throb, r * 1.15, s.rest.x, s.rest.y + r * 0.6, s.rest.z);
        if (bz > 0.1 && bz < 0.8 && dt > 0 && Math.round(t / 16) % 4 === 0) {
          s.emit({
            count: 1,
            origin: { x: s.rest.x, y: s.rest.y + r * 0.7, z: s.rest.z },
            dir: { x: 0, y: 1, z: 0 },
            speed: 0.5,
            spread: 0.3,
            life: 1.1,
            size: r * 0.25,
            sizeEnd: 2.4,
            kind: KIND.SMOKE,
            shape: SHAPE.SMOKE,
            blend: 'normal',
            color: '#9a90a4',
            colorEnd: '#4a4450',
            alpha: 0.35,
            gravity: 0.4,
          });
        }
        if (t >= 2000 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the wall shimmers in front of the die, a bruise throbs on it; the die stays put
        const r = s.r;
        const k = bump(t / 1600);
        wall.forEach((g, i) => {
          const u = (i / (WALL_GLOWS - 1)) * 2 - 1;
          o.copy(wallAt).addScaledVector(across, u * r * 1.7);
          g.set(0.5 * k * (1 - 0.55 * Math.abs(u)), r * 0.6, o.x, o.y, o.z);
        });
        bruise.set(
          0.6 * k * (0.75 + 0.25 * Math.sin(t / 90)),
          r * 1.1,
          s.rest.x,
          s.rest.y + r * 0.6,
          s.rest.z,
        );
        if (t >= 400 && !glinted) ((glinted = true), s.glint(), s.card(CARD));
      },
    });
  },
});
