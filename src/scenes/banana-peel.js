import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, outBack, bump, lerp, TAU, KIND, SHAPE } from './kit.js';
import { makeGlow } from './vfx.js';

/**
 * Banana Peel (a natural 1): slapstick, told in light.
 *
 * 0-550     a glossy banana peel skates in beside the die on a streak of yellow light, and lands
 *           with a little glint ("ting")
 * 550-700   the die leans onto it
 * 700       the slip: a white flash and a slick ring of light, droplets of light squirt out from
 *           under it, a puff of dust; the title card whips in
 * 700-1300  the die skids sideways, spinning out, burning a glowing skid mark on the table and
 *           throwing glints; the peel is kicked away spinning on its own light trail
 * 1500      the peel pops into a puff of golden glitter and is gone
 * 1300-2350 the die wobbles back home; a sad little fizzle of sparks at its foot
 * Mid-roll (the usual way): the peel is lying on the table, in the die's way. The throw is
 * simulated before it is shown, so the peel appears (with a ting) on a spot the die will roll
 * over near the end of its path, and stays put; the die runs into it by accident: a flash, a
 * slick ring, droplets of light, the peel kicked away spinning, a glowing skid mark behind the
 * die. It rolls on to its 1; at landing the card whips in and the peel, wherever it ended up,
 * pops into golden glitter.
 */
export const DURATION = 2600;
/** Played after its intro, the show is its last 1900 ms: the aftermath (AFTER, from landing). */
const SKIP = DURATION - 1900;
const AFTER = { kick: [0, 600], pop: 700, fizzle: 1250, glint: 1450 };
/** Mid-roll: the peel pops into view over this long, and lies where the die is this far along what is left of its path (or later, once it rolls on the table). */
const MID = { appear: 250, hitShare: 0.6 };
const T = { slide: [0, 550], lean: [550, 700], slip: 700, skid: [700, 1300], kick: [700, 1500], pop: 1500, wobble: [1300, 2350], fizzle: 2250 };

const YELLOW = '#f6cf2a';
const CREAM = '#fff4c4';
const BROWN = '#5e3d16';
const SHINE = '#fffbe0';

/** Its title card, at the slip. */
const CARD = Object.freeze({
  seed: 401,
  glow: '#ffd23a',
  font: 'display',
  lines: [
    { text: 'Whoops!', size: 0.27, at: 0.4, fill: ['#fff7b8', '#f2c21a'], edge: BROWN, enter: 'whip', tilt: -8 },
    { text: 'Nat 1', size: 0.12, at: 0.63, fill: ['#fff1c8', '#d9a441'], edge: '#3e2408', enter: 'whip', delay: 220, tilt: 5 },
  ],
  sparks: { colors: ['#fff6c0', '#f6cf2a', '#a8741e'], count: 40 },
  shake: 0.55,
  hold: 900,
  exit: 'fade',
});

/**
 * One peel petal: a slice of a sphere's shell (an orange-peel wedge), long and shallow, lying
 * along +z from the stem, its outside up. Yellow outside, cream inside (the same shell, back side).
 */
function petalGeometry() {
  const g = new THREE.SphereGeometry(1, 10, 16, Math.PI / 2 - 0.65, 1.3, 0, Math.PI);
  g.rotateX(-Math.PI / 2); // the long axis along z, the outside of the shell up
  g.scale(0.42, 0.2, 0.5);
  g.translate(0, -0.15, 0.5);
  return g;
}

/**
 * The peel (a group of four petals round a hub and stalk, scaled to the die), built with a
 * scene's or an intro's shape helpers `h` (mat, geo). Returns { peel, arms, mats }.
 */
function buildPeel(h, r) {
  const skin = h.mat(YELLOW, { emissive: '#3a2a00' });
  skin.roughness = 0.32; // waxy, glossy peel
  skin.metalness = 0;
  skin.emissiveIntensity = 0.35;
  const flesh = h.mat(CREAM, { side: THREE.BackSide });
  flesh.roughness = 0.75;
  flesh.metalness = 0;
  const stem = h.mat(BROWN);
  stem.roughness = 0.6;
  stem.metalness = 0;
  const mats = [skin, flesh, stem];
  const shell = h.geo(petalGeometry());
  const peel = new THREE.Group();
  const arms = [];
  const angles = [0.3, 1.9, 3.3, 4.8];
  const lengths = [1, 0.85, 1.05, 0.8];
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = angles[i];
    arm.position.y = 0.06;
    const outside = new THREE.Mesh(shell, skin);
    const inside = new THREE.Mesh(shell, flesh);
    outside.scale.set(1, 1, lengths[i]);
    inside.scale.set(1, 1, lengths[i]);
    arm.add(outside, inside);
    arms.push(arm);
    peel.add(arm);
  }
  // the stub of banana top in the middle, its brown stalk sticking up
  const hub = new THREE.Mesh(h.geo(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 16)), skin);
  hub.position.y = 0.11;
  const stalk = new THREE.Mesh(h.geo(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 10)), stem);
  stalk.position.y = 0.3;
  peel.add(hub, stalk);
  peel.scale.setScalar(r * 0.75);
  peel.visible = false;
  return { peel, arms, mats };
}

export const bananaPeel = Object.freeze({
  id: 'scene-banana-peel',
  name: 'Banana Peel',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: the peel lies in the die's way (see the header); handoff() tells the landing show
   * where it ended up and whether it was hit.
   */
  intro(env) {
    let peel;
    let arms;
    let sheen;
    let flash;
    let slick;
    let skid;
    let kickTrail;
    let hitF = Infinity; // the frame the die reaches the peel (from its path)
    let restY = 0.9;
    let hitAt = null; // ms (intro time) of the hit
    let lastT = null;
    let rot0 = 0;
    const at = new THREE.Vector3(); // where the peel lies (world, on the table)
    const from = new THREE.Vector3(); // where it was hit
    const dir = new THREE.Vector3(1, 0, 0); // the die's way at the hit (the peel is kicked along it)
    const prev = new THREE.Vector3();
    const q = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        const r = c.r;
        ({ peel, arms } = buildPeel(c, r));
        c.world.add(peel);
        sheen = makeGlow(c.kit, c.world, '#ffd84a', { core: SHINE, width: 0.55 });
        flash = makeGlow(c.kit, c.world, '#ffffff', { core: '#ffffff', width: 0.45 });
        slick = makeGlow(c.kit, c.world, '#ffe680', { core: SHINE, ring: 0.66, width: 0.14 });
        skid = c.ribbon({ head: '#fff0b0', tail: '#c87a10', width: r * 0.6, length: 26 });
        kickTrail = c.ribbon({ head: SHINE, tail: '#e0a412', width: r * 0.7, length: 18 });
        const p = env.die.outer.position;
        const path = c.path;
        if (path) {
          // a spot on its path near the end, once it rolls along the table
          const ph = path.now();
          restY = path.at(path.last, q).y;
          const first = Math.min(path.last - 6, Math.round(ph + Math.max(18, (path.last - ph) * MID.hitShare)));
          hitF = path.last - 6;
          for (let f = first; f <= path.last - 6; f++) {
            if (path.at(f, q).y <= restY * 1.35) {
              hitF = f;
              break;
            }
          }
          path.at(hitF, at).setY(0);
        } else {
          // no path: a little ahead of it toward the table's centre
          q.set(-p.x, 0, -p.z);
          if (q.lengthSq() < 1e-6) q.set(0, 0, 1);
          at.copy(p).setY(0).addScaledVector(q.normalize(), r * 2.5);
        }
        peel.position.copy(at);
        rot0 = (((at.x * 3.1 + at.z * 1.7) % TAU) + TAU) % TAU; // varies with the spot, the same on every screen
        peel.rotation.y = rot0;
        prev.copy(p);
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = lastT === null ? 0 : Math.min(0.05, (t - lastT) / 1000);
        lastT = t;
        if (hitAt === null) {
          // --- it appears where it lies, with a ting, and waits ---
          const inK = span(t, 0, MID.appear);
          peel.visible = true;
          peel.scale.setScalar(r * 0.75 * Math.max(0.001, outBack(inK)));
          for (let i = 0; i < arms.length; i++) arms[i].rotation.x = -0.12 - 0.04 * Math.sin(t / 110 + i * 1.7);
          sheen.set(0.5 * inK, r * 1.15, at.x, 0.02, at.z);
          if (dt > 0 && t - dt * 1000 < MID.appear * 0.6 && t >= MID.appear * 0.6) {
            c.emit({ count: 2, origin: { x: at.x, y: r * 0.35, z: at.z }, speed: 0.3, spread: 1, life: 0.45, size: r * 0.55, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffe066' });
          }
          // --- the die runs into it ---
          const near = Math.hypot(p.x - at.x, p.z - at.z) < r * 0.95 && p.y < restY * 1.8;
          if (near || (c.path && c.path.now() >= hitF)) {
            hitAt = t;
            from.copy(at);
            dir.set(p.x - prev.x, 0, p.z - prev.z);
            if (dir.lengthSq() < 1e-8) dir.set(at.x - p.x + 1e-3, 0, at.z - p.z);
            dir.normalize();
            const o = { x: at.x, y: 0.12, z: at.z };
            for (let i = 0; i < 16; i++) {
              const a = (i / 16) * TAU;
              c.emit({ count: 1, origin: o, dir: { x: Math.cos(a) + dir.x * 0.8, y: 0.5, z: Math.sin(a) + dir.z * 0.8 }, speed: 4 + (i % 4), spread: 0.1, life: 0.5, size: r * 0.15, kind: KIND.STREAK, color: SHINE, colorEnd: '#f0b020', gravity: -9, floor: 0.04 });
            }
            c.emit({ count: 8, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 2.6, spread: 1, life: 0.55, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffe066', gravity: -4 });
            c.emit({ count: 6, origin: o, dir: { x: 0, y: 0.3, z: 0 }, speed: 1.4, spread: 1, life: 1.1, size: r * 0.55, sizeEnd: 2.2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#d8cba8', colorEnd: '#8a8070', alpha: 0.4 });
          }
        }
        if (hitAt !== null) {
          // --- kicked away spinning along the die's way; the slip's light; a skid mark behind the die ---
          const h = t - hitAt;
          const k = span(h, 0, 800);
          at.copy(from).addScaledVector(dir, r * 3.4 * easeOut(k));
          peel.position.set(at.x, r * 0.8 * bump(k) * (1 - k * 0.5), at.z);
          peel.rotation.set(0, rot0 + easeOut(k) * TAU * 2.2, 0.45 * bump(k));
          for (let i = 0; i < arms.length; i++) arms[i].rotation.x = -0.12 - 0.12 * Math.sin(t / 70 + i * 1.7) * bump(k);
          if (k < 1) kickTrail.push(q.set(at.x, peel.position.y + 0.04, at.z));
          kickTrail.opacity(0.85 * (1 - span(h, 600, 1000)));
          sheen.set(0.45 / (1 + peel.position.y * 2), r * 1.15, at.x, 0.02, at.z);
          const fk = span(h, 0, 260);
          flash.set(1.1 * (1 - fk) ** 2, r * 2.2, from.x, 0.03, from.z);
          const rk = span(h, 0, 650);
          slick.set(0.9 * (1 - rk), r * lerp(0.9, 2.6, easeOut(rk)), from.x, 0.021, from.z);
          if (h < 650) skid.push(q.set(p.x, 0.025, p.z));
          skid.opacity(0.9 * (1 - span(h, 650, 1600)));
          if (dt > 0 && h < 600) c.emit({ count: Math.max(1, Math.round(dt * 60)), origin: { x: p.x, y: 0.08, z: p.z }, dir: { x: -dir.x, y: 0.6, z: -dir.z }, speed: 2.2, spread: 0.7, life: 0.4, size: r * 0.12, kind: KIND.SPARK, color: SHINE, colorEnd: '#e09018', gravity: -7, floor: 0.04 });
        }
        prev.copy(p);
      },
      handoff: () => ({ x: at.x, z: at.z, rot: peel?.rotation.y ?? 0, hit: hitAt !== null }),
    });
  },
  play(ctx) {
    let peel; // the peel group
    let arms; // its four petals (each a group pivoting at the stem)
    let mats;
    let trail; // the yellow light streak the peel skates on
    let skid; // the glowing skid mark under the die
    let sheen; // the light pool under the peel (its gloss on the table)
    let slick; // the slick ring of light at the slip
    let flash; // the white flash at the slip
    let foot; // the warm glow under the die while it skids
    let landed = false;
    let slipped = false;
    let popped = false;
    let fizzled = false;
    let glinted = false;
    let lastEmit = null;
    const pos = new THREE.Vector3();
    const peelStart = new THREE.Vector3();
    const peelIn = new THREE.Vector3();
    const peelOut = new THREE.Vector3();
    const lean = new THREE.Vector3();
    const skidEnd = new THREE.Vector3();
    const mark = new THREE.Vector3();
    let kickFrom = null; // the introduced show: where the peel lies at landing
    /**
     * The introduced show (a = ms since landing): the die hit the peel mid-roll and rolled on to its
     * 1. The card whips in; a peel the die stopped short of is kicked now; it pops into golden
     * glitter; a sad fizzle; the die only wobbles a little where it lies.
     */
    function after(a, s) {
      const r = s.r;
      if (!kickFrom) {
        const h = s.handoff;
        kickFrom = h ? new THREE.Vector3(h.x, 0, h.z) : peelIn.clone();
        peel.rotation.y = h?.rot ?? 0.4;
        peelOut.copy(kickFrom);
        if (!h?.hit) {
          peelOut.addScaledVector(s.side, -r * 2.6); // kicked now, off to the side
          s.shake(0.12, 140);
          s.emit({ count: 10, origin: { x: kickFrom.x, y: 0.12, z: kickFrom.z }, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 1, life: 0.6, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffe066', gravity: -4 });
        }
        s.card(CARD);
      }
      const k = span(a, ...AFTER.kick);
      pos.lerpVectors(kickFrom, peelOut, easeOut(k));
      peel.visible = a < AFTER.pop;
      peel.position.set(pos.x, kickFrom.distanceTo(peelOut) > 1e-6 ? r * 0.6 * bump(k) : 0, pos.z);
      const fade = 1 - span(a, AFTER.pop - 220, AFTER.pop);
      for (const m of mats) m.opacity = fade;
      for (let i = 0; i < arms.length; i++) arms[i].rotation.x = -0.12 - 0.05 * Math.sin(a / 100 + i * 1.7);
      sheen.set(0.45 * fade, r * 1.15, pos.x, 0.02, pos.z);
      trail.opacity(0);
      skid.opacity(0);
      // the die, dazed where it lies
      s.die.pose(s.rest, 0.03 * Math.sin(a / 45) * (1 - span(a, 0, 700)));
      if (a >= AFTER.pop && !popped) {
        popped = true;
        const o = { x: pos.x, y: r * 0.3, z: pos.z };
        s.emit({ count: 24, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 2.2, spread: 1, life: 0.9, size: r * 0.14, kind: KIND.FLAKE, color: '#fff3a0', colorEnd: '#d89a10', gravity: -2, spin: 6 });
        s.emit({ count: 4, origin: o, speed: 0.6, spread: 1, life: 0.5, size: r * 0.5, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffd23a' });
      }
      if (a >= AFTER.fizzle && !fizzled) {
        fizzled = true;
        s.effect('fizzle', { color: '#f0b030', intensity: 0.8, duration: 600 });
      }
      if (a >= AFTER.glint && !glinted) ((glinted = true), s.glint());
    }
    return runScene(ctx, {
      duration: DURATION,
      introSkip: SKIP, // it was hit mid-roll: only the aftermath plays (after(), below)
      setup(s) {
        const r = s.r;
        ({ peel, arms, mats } = buildPeel(s, r));
        landed = s.introduced; // its ting was heard mid-roll
        s.add(peel);
        // where it skates from and to, where the die skids, where the peel flies
        peelStart.copy(s.beside(r * 4, s.side)).addScaledVector(s.toward, r * 0.9);
        peelIn.copy(s.beside(r * 0.85));
        peelOut.copy(peelIn).addScaledVector(s.side, -r * 3.6).addScaledVector(s.toward, r * 0.8);
        lean.copy(s.rest).addScaledVector(s.toward, r * 0.18);
        skidEnd.copy(s.rest).addScaledVector(s.side, r * 1.8).addScaledVector(s.toward, r * 0.3);
        trail = s.ribbon({ head: SHINE, tail: '#e0a412', width: r * 0.9, length: 22 });
        skid = s.ribbon({ head: '#fff0b0', tail: '#c87a10', width: r * 0.7, length: 30 });
        sheen = s.glow('#ffd84a', { core: SHINE, width: 0.55 });
        slick = s.glow('#ffe680', { core: SHINE, ring: 0.66, width: 0.14 });
        flash = s.glow('#ffffff', { core: '#ffffff', width: 0.45 });
        foot = s.glow('#ffb84a', { core: SHINE, width: 0.5 });
      },
      full(t, s) {
        if (s.introduced) return after(t - SKIP, s);
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the peel: skates in, sits, is kicked away spinning, pops ---
        const inK = easeOut(span(t, ...T.slide));
        const outK = span(t, ...T.kick);
        pos.lerpVectors(peelStart, peelIn, inK).lerp(peelOut, easeOut(outK));
        const hop = r * 0.9 * bump(outK) * (1 - outK * 0.5);
        peel.position.set(pos.x, hop, pos.z);
        peel.rotation.y = 1.4 * (1 - inK) + easeOut(outK) * TAU * 2.5;
        peel.rotation.z = 0.5 * bump(outK);
        peel.visible = t < T.pop;
        for (let i = 0; i < arms.length; i++) arms[i].rotation.x = -0.12 - 0.1 * Math.sin(t / 90 + i * 1.7) * (0.3 + bump(outK));
        const fade = 1 - span(t, T.pop - 260, T.pop);
        for (const m of mats) m.opacity = fade;
        // its light trail while it moves; the gloss under it
        const moving = t < T.slide[1] || (t >= T.kick[0] && t < T.pop);
        if (moving) trail.push(pos.set(pos.x, hop + 0.04, pos.z));
        trail.opacity(moving ? 0.85 * (t < T.slide[1] ? 1 - inK * 0.6 : 1) : Math.max(0, 0.85 - span(t, T.slide[1], T.slide[1] + 200)));
        if (t >= T.slide[1] && t < T.kick[0]) trail.opacity(0);
        if (t >= T.kick[0] && t < T.kick[0] + 20) trail.reset();
        sheen.set(0.5 * fade * span(t, 0, 200) / (1 + hop * 2), r * 1.15, pos.x, 0.02, pos.z);
        if (t >= T.slide[1] && !landed) {
          landed = true; // ting
          s.emit({ count: 2, origin: { x: peelIn.x, y: r * 0.35, z: peelIn.z }, speed: 0.3, spread: 1, life: 0.45, size: r * 0.55, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffe066' });
        }
        // --- the die ---
        let skidding = false;
        if (t < T.slip) {
          pos.lerpVectors(s.rest, lean, easeIn(span(t, ...T.lean)));
          s.die.pose(pos, 0);
        } else if (t < T.skid[1]) {
          const k = span(t, ...T.skid);
          pos.lerpVectors(lean, skidEnd, easeOut(k));
          pos.y += r * 0.35 * bump(k);
          s.die.pose(pos, 2.25 * easeOut(k));
          skidding = true;
        } else {
          // wobbles home, settling to a whole number of turns (its rest pose)
          const k = span(t, ...T.wobble);
          const e = easeOut(k);
          pos.lerpVectors(skidEnd, s.rest, e);
          pos.addScaledVector(s.toward, Math.sin(k * TAU * 2.5) * r * 0.16 * (1 - k));
          s.die.pose(pos, lerp(2.25, 3, e) + 0.05 * Math.sin(k * TAU * 3) * (1 - k));
        }
        // --- the slip ---
        if (t >= T.slip && !slipped) {
          slipped = true;
          s.shake(0.16, 160);
          s.card(CARD);
          s.effect('shockwave', { color: '#ffe27a', intensity: 0.55, duration: 600, at: lean });
          const o = { x: lean.x, y: 0.12, z: lean.z };
          // droplets of light squirting out from under the die, mostly ahead of the skid
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU;
            const ahead = Math.max(0, Math.cos(a)) * 0.6;
            s.emit({
              count: 1,
              origin: o,
              dir: { x: Math.cos(a) * s.side.x - Math.sin(a) * s.toward.x, y: 0.5, z: Math.cos(a) * s.side.z - Math.sin(a) * s.toward.z },
              speed: 4.5 + (i % 4) + ahead * 3,
              spread: 0.1,
              life: 0.5,
              size: r * 0.16,
              kind: KIND.STREAK,
              color: SHINE,
              colorEnd: '#f0b020',
              gravity: -9,
              floor: 0.04,
            });
          }
          s.emit({ count: 10, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 1, life: 0.6, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffe066', gravity: -4 });
          s.emit({ count: 8, origin: o, dir: { x: 0, y: 0.3, z: 0 }, speed: 1.6, spread: 1, life: 1.2, size: r * 0.6, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, blend: 'normal', color: '#d8cba8', colorEnd: '#8a8070', alpha: 0.45 });
        }
        const fk = span(t, T.slip, T.slip + 260);
        flash.set(1.1 * (fk > 0 ? (1 - fk) ** 2 : 0), r * 2.2, lean.x, 0.03, lean.z);
        const rk = span(t, T.slip, T.slip + 650);
        slick.set(rk > 0 ? 0.9 * (1 - rk) : 0, r * lerp(0.9, 2.6, easeOut(rk)), lean.x, 0.021, lean.z);
        // the skid: a glowing mark burned along the table, glints spun off the die
        if (skidding) {
          skid.push(mark.set(pos.x, 0.025, pos.z));
          skid.opacity(0.9);
          if (dt > 0) {
            const n = Math.max(1, Math.round(dt * 70));
            s.emit({ count: n, origin: { x: pos.x, y: 0.08, z: pos.z }, dir: { x: -s.side.x, y: 0.6, z: -s.side.z }, speed: 2.4, spread: 0.7, life: 0.4, size: r * 0.12, kind: KIND.SPARK, color: SHINE, colorEnd: '#e09018', gravity: -7, floor: 0.04 });
            if (Math.round(t / 16) % 4 === 0) s.emit({ count: 1, origin: pos, speed: 1.2, spread: 1, life: 0.35, size: r * 0.4, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffd84a' });
          }
        } else if (t >= T.skid[1]) skid.opacity(Math.max(0, 0.9 * (1 - span(t, T.skid[1], 2300))));
        else skid.opacity(0);
        foot.set(skidding ? 0.55 : 0.55 * Math.max(0, 1 - span(t, T.skid[1], T.skid[1] + 300)), r * 1.5, pos.x, 0.02, pos.z);
        if (t < T.slip) foot.set(0);
        // --- the peel pops into golden glitter ---
        if (t >= T.pop && !popped) {
          popped = true;
          const o = { x: peelOut.x, y: r * 0.3, z: peelOut.z };
          s.emit({ count: 24, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 2.2, spread: 1, life: 0.9, size: r * 0.14, kind: KIND.FLAKE, color: '#fff3a0', colorEnd: '#d89a10', gravity: -2, spin: 6 });
          s.emit({ count: 4, origin: o, speed: 0.6, spread: 1, life: 0.5, size: r * 0.5, kind: KIND.GLINT, color: '#ffffff', colorEnd: '#ffd23a' });
          s.emit({ count: 5, origin: o, dir: { x: 0, y: 1, z: 0 }, speed: 0.6, spread: 1, life: 1, size: r * 0.5, sizeEnd: 2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, color: '#ffe68a', colorEnd: '#7a5a10', alpha: 0.35 });
        }
        // --- a sad little fizzle at its foot, home again ---
        if (t >= T.fizzle && !fizzled) {
          fizzled = true;
          s.effect('fizzle', { color: '#f0b030', intensity: 0.8, duration: 600 });
        }
        if (t >= 2400 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: the peel fades in beside the die with its gloss, wiggles and fades; the die stays put
        const r = s.r;
        peel.visible = true;
        peel.position.set(peelIn.x, 0, peelIn.z);
        peel.rotation.y = 0.4;
        const o = bump(t / 1600);
        for (const m of mats) m.opacity = o;
        for (let i = 0; i < arms.length; i++) arms[i].rotation.x = -0.12 - 0.06 * Math.sin(t / 120 + i * 1.7);
        sheen.set(0.45 * o, r * 1.15, peelIn.x, 0.02, peelIn.z);
        trail.opacity(0);
        skid.opacity(0);
        if (t >= 400 && !glinted) {
          glinted = true;
          s.glint();
          s.card(CARD);
        }
      },
    });
  },
});
