import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, outBack, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Anvil (a natural 1): the natural 1s' reference for the crit scenes' look.
 *
 * 0-620     a soft shadow grows on the table under the die; the anvil drops from high above
 *           (seen from above it shrinks as it falls), a pale streak behind it
 * 620       impact: a clang of sparks, a dust shockwave and rolling dust, iron chips; the die is
 *           crushed down; the screen shakes; the title card drops in
 * 620-1100  the anvil settles with a wobble
 * 1100-1750 it tips off sideways, thuds onto the table and dissolves into smoke
 * 1250-2200 the die springs back up home, dazed: little stars of light circling over it
 */
export const DURATION = 2600;
const T = { lead: 300, drop: [180, 620], impact: 620, settle: [620, 1100], tip: [1100, 1750], fade: [1550, 2000], spring: [1250, 1750], dazed: [1500, 2450] };

const CARD = Object.freeze({
  seed: 1,
  glow: '#ff3b3b',
  font: 'display',
  lines: [
    { text: 'Critical', size: 0.12, at: 0.3, fill: ['#f0f0f0', '#9aa0a8'], edge: '#2a2d33', enter: 'drop', tilt: -2 },
    { text: 'Fail', size: 0.27, at: 0.62, fill: ['#ff7a6b', '#c81e1e'], edge: '#4a0606', enter: 'thud', delay: 330 },
  ],
  vignette: 'rgba(60,0,6,0.9)',
  crack: '#140808',
  shake: 1,
  hold: 900,
  exit: 'crumble',
});

export const anvil = Object.freeze({
  id: 'scene-anvil',
  name: 'Anvil',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: something is coming. A dark shadow grows under the tumbling die, darkening and
   * tightening the longer it rolls, and a cold glint twinkles high above it. At landing the anvil
   * is already falling out of that glint (its first beat skipped), so it hits ~320 ms later.
   */
  intro(env) {
    let shadow;
    let penumbra;
    let glint;
    let star;
    return runIntro(env, {
      setup(c) {
        penumbra = c.disc('#000000', 0);
        shadow = c.disc('#000000', 0);
        shadow.position.y = 0.013;
        glint = c.glow('#cfe0ff', { core: '#ffffff', width: 0.4 });
        star = c.glow('#e8eef8', { core: '#ffffff', ring: 0.5, width: 0.2 });
      },
      frame(t, c, p) {
        // ends where the full form's shadow picks up (come = 0.5 at its introSkip)
        const k = easeOut(span(t, 0, 900));
        const come = 0.5 * k;
        shadow.material.opacity = 0.55 * come;
        shadow.scale.setScalar(c.r * lerp(3.4, 1.5, come));
        penumbra.material.opacity = 0.18 * k;
        penumbra.scale.setScalar(c.r * lerp(4.4, 2.6, come));
        const hi = p.y + c.r * 11;
        const tw = 0.6 + 0.4 * Math.sin(t / 45) * Math.sin(t / 110);
        glint.set(k * tw, c.r * (0.35 + 0.15 * tw), 0, hi, 0);
        star.set(k * 0.6 * tw, c.r * (0.6 + 0.2 * Math.sin(t / 70)), 0, hi, 0);
        if (Math.round(t / 16) % 14 === 0 && t > 200) {
          c.emit({ count: 1, origin: { x: p.x, y: hi, z: p.z }, speed: 0.1, spread: 1, life: 0.35, size: c.r * 0.45, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#9fb4d8' });
        }
      },
    });
  },
  play(ctx) {
    let block; // the anvil (its tilt group pivots at the bottom edge)
    let tilt;
    let mats;
    let shadow; // the dark soft shadow growing on the table
    let streak; // the pale fall streak
    let stars; // the dazed little stars
    let hit = false;
    let thudded = false;
    let puffed = false;
    let glinted = false;
    const p = new THREE.Vector3();
    const prev = new THREE.Vector3();
    return runScene(ctx, {
      duration: DURATION,
      introSkip: T.lead, // its shadow and glint seen mid-roll: it lands with the anvil already falling
      setup(s) {
        const iron = s.mat('#2b2f36');
        iron.roughness = 0.38;
        iron.metalness = 0.85;
        const face = s.mat('#9aa3ad');
        face.roughness = 0.18;
        face.metalness = 1;
        mats = [iron, face];
        block = new THREE.Group();
        tilt = new THREE.Group();
        const box = (w, h, d, y, m) => {
          const mesh = new THREE.Mesh(s.geo(new THREE.BoxGeometry(w, h, d)), m);
          mesh.position.y = y;
          tilt.add(mesh);
        };
        box(1.3, 0.28, 0.9, 0.14, iron); // base
        box(0.62, 0.4, 0.52, 0.48, iron); // waist
        box(1.5, 0.32, 0.76, 0.84, iron); // top
        box(1.4, 0.02, 0.64, 1.01, face); // the polished striking face
        const horn = new THREE.Mesh(s.geo(new THREE.ConeGeometry(0.3, 0.85, 20)), iron);
        horn.rotation.z = -Math.PI / 2;
        horn.position.set(1.17, 0.86, 0);
        tilt.add(horn);
        block.add(tilt);
        block.rotation.y = Math.atan2(s.side.x, s.side.z) - Math.PI / 2;
        block.visible = false;
        s.add(block);
        // a soft dark shadow: normal-blend dark disc fading at its edge
        shadow = new THREE.Mesh(s.geo(new THREE.CircleGeometry(1, 48)), s.mat('#000000', { basic: true, opacity: 0, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(s.rest.x, 0.013, s.rest.z);
        s.add(shadow);
        streak = s.ribbon({ head: '#e8eef8', tail: '#5a6270', width: s.r * 1.4, length: 14 });
        stars = [0, 1, 2].map(() => s.glow('#ffe066', { core: '#ffffff', width: 0.45 }));
      },
      full(t, s) {
        const r = s.r;
        const size = r * 0.95;
        prev.copy(p);
        // --- the shadow, darkening and tightening as the anvil comes ---
        // introduced: the shadow picks up where the intro left it (half come)
        const come = s.introduced ? lerp(0.5, 1, easeIn(span(t, T.lead, T.impact))) : easeIn(span(t, 0, T.impact));
        const shadowK = t < T.tip[1] ? come : 1 - span(t, T.tip[0], T.tip[1]);
        shadow.material.opacity = 0.55 * shadowK;
        shadow.scale.setScalar(r * lerp(3.4, 1.5, come));
        // --- the anvil ---
        const topY = s.rest.y + r * 0.35; // resting on the crushed die
        if (t >= T.drop[0]) block.visible = true;
        if (t < T.impact) {
          const k = easeIn(span(t, ...T.drop));
          block.position.set(s.rest.x, lerp(topY + r * 11, topY, k), s.rest.z);
          block.scale.setScalar(size);
          if (s.introduced) for (const m of mats) m.opacity = span(t, T.lead, T.lead + 80); // out of the glint
          p.copy(block.position);
          streak.push(p);
          streak.opacity(0.7 * span(t, T.drop[0], T.drop[0] + 80));
        } else {
          streak.opacity(Math.max(0, 0.7 - span(t, T.impact, T.impact + 120)));
          const wob = Math.sin((t - T.impact) / 30) * 0.05 * (1 - span(t, ...T.settle));
          const tk = easeIn(span(t, ...T.tip));
          // tips over its edge toward the table's side, sliding off the die
          tilt.rotation.z = -tk * 1.5 + wob;
          block.position.set(s.rest.x + s.side.x * r * 1.4 * tk, lerp(topY, 0.02, tk), s.rest.z + s.side.z * r * 1.4 * tk);
          const o = 1 - span(t, ...T.fade);
          for (const m of mats) m.opacity = o;
          block.visible = o > 0.01;
          if (tk >= 1 && !thudded) {
            thudded = true;
            s.shake(0.18, 140);
            s.emit({ count: 8, origin: { x: block.position.x, y: 0.1, z: block.position.z }, dir: { x: 0, y: 0.2, z: 0 }, speed: 1.6, spread: 1, life: 1.1, size: r * 0.7, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#b9ad97', colorEnd: '#6c665c', alpha: 0.5 });
          }
          if (t >= T.fade[0] && !puffed) {
            puffed = true; // it dissolves into smoke
            s.emit({ count: 14, origin: { x: block.position.x, y: r * 0.5, z: block.position.z }, dir: { x: 0, y: 1, z: 0 }, speed: 0.9, spread: 1, life: 1.6, size: r * 0.8, sizeEnd: 2.6, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#4a4e55', colorEnd: '#22252a', alpha: 0.6, gravity: 0.5 });
          }
        }
        // --- the impact ---
        if (t >= T.impact && !hit) {
          hit = true;
          s.shake(0.45, 300);
          s.card(CARD);
          s.effect('shockwave', { color: '#cbb89a', intensity: 0.9, duration: 800 });
          const o = { x: s.rest.x, y: 0.1, z: s.rest.z };
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * TAU;
            s.emit({ count: 1, origin: o, dir: { x: Math.cos(a), y: 0.05, z: Math.sin(a) }, speed: 3.4, spread: 0.15, life: 1.3, size: r * 0.75, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#cdbf9f', colorEnd: '#7c7464', alpha: 0.55 });
          }
          s.emit({ count: 18, origin: { x: s.rest.x, y: topY, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 6, spread: 1.2, life: 0.45, size: r * 0.16, kind: KIND.STREAK, color: '#fff4cc', colorEnd: '#ff9a3c', gravity: -10, floor: 0.04 });
          s.emit({ count: 12, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 4, spread: 1, life: 1, size: r * 0.14, kind: KIND.SHARD, shape: SHAPE.SHARD, blend: 'normal', color: '#3b3f46', colorEnd: '#2a2d33', gravity: -12, floor: 0.04 });
        }
        // --- the die: crushed down, then springing back up dazed ---
        p.copy(s.rest);
        if (t >= T.impact) {
          const crush = 1 - easeOut(span(t, ...T.spring));
          const spring = outBack(span(t, ...T.spring)) - easeOut(span(t, ...T.spring));
          p.y = lerp(s.rest.y, s.rest.y * 0.45, crush) + r * 0.3 * Math.max(0, spring);
          s.die.pose(p, 0.04 * Math.sin((t - T.impact) / 40) * (1 - span(t, T.impact, 2100)));
        } else s.die.pose(p, 0);
        const dz = span(t, ...T.dazed);
        stars.forEach((g, i) => {
          const a = t / 260 + (i * TAU) / 3;
          g.set(bump(dz) * 0.9, r * 0.32, s.rest.x + Math.cos(a) * r * 0.8, s.rest.y + r * 1.15, s.rest.z + Math.sin(a) * r * 0.8);
          if (dz > 0 && dz < 1 && Math.round(t / 16) % 9 === i * 3) {
            s.emit({ count: 1, origin: g.position, speed: 0.2, spread: 1, life: 0.4, size: r * 0.25, kind: KIND.GLINT, color: '#fff6c8', colorEnd: '#ffcf4a' });
          }
        });
      },
      calm(t, s) {
        // reduced: a shadow passes over the die, the stars circle, the card fades in and out
        const k = bump(t / 1600);
        shadow.material.opacity = 0.35 * k;
        shadow.scale.setScalar(s.r * 1.8);
        stars.forEach((g, i) => {
          const a = t / 300 + (i * TAU) / 3;
          g.set(k * 0.8, s.r * 0.3, s.rest.x + Math.cos(a) * s.r * 0.8, s.rest.y + s.r * 1.1, s.rest.z + Math.sin(a) * s.r * 0.8);
        });
        if (t >= 300 && !glinted) ((glinted = true), s.card(CARD));
      },
    });
  },
});
