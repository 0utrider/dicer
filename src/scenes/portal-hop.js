import * as THREE from 'three';
import { runScene, runSwallow, arc, span, smooth, easeOut, easeIn, bump, lerp, TAU, KIND } from './kit.js';
import { makeGlow, makeRibbon } from './vfx.js';

/**
 * Portal Hop (a natural 20): portals of light. Each is a soft dark void ringed by a hot rim of light
 * and a wide haze, three luminous swirl arms circling inside it and motes of light spiralling in.
 *
 * Caught mid-roll (swallow): a blue portal opens under the tumbling die, follows it and swallows it
 * in a flare. Then, where the die stopped:
 * 0-300     the blue portal closes, motes of light streaming into it
 * 150-450   an orange portal opens beside it, light spilling out
 * 500       the die bursts out of the orange portal: a flare, a light burst, sparks raking out in
 *           orange and blue; the title card zooms in
 * 500-1050  it arcs home trailing a white-hot ribbon, shedding embers and blue glints
 * 1050      it lands: a soft light ring, a small shake; the glint at 1250
 * 1200-1550 the orange portal collapses to a pinpoint and winks out
 * Not caught: both portals open fast (0-260); the die hops into the blue one (200-520, a blue
 * implosion), is gone a beat, and bursts out of the orange one at 680 (the card), arcing home by
 * 1180; the orange portal winks out by 1650.
 * Reduced: a blue portal shimmers under the die and closes, the card fades in; the die stays put.
 */
export const DURATION = 2000;
const T_SPIT = { blueClose: [0, 300], orangeOpen: [150, 450], out: 500, fly: [500, 1050], land: 1050, orangeClose: [1200, 1550], glint: 1250 };
const T_HOP = { blueOpen: [0, 200], orangeOpen: [60, 260], hop: [200, 440], sink: [440, 520], gone: 520, out: 680, fly: [680, 1180], land: 1180, blueClose: [520, 820], orangeClose: [1300, 1650], glint: 1350 };
// The catch, in ms since it began.
const GRAB = 250;

const BLUE = { rim: '#3fb6ff', hot: '#d8f6ff', deep: '#123c9a', void: '#01040e' };
const ORANGE = { rim: '#ff8f2a', hot: '#fff0c8', deep: '#8a2a05', void: '#0e0401' };
const MOTES = 6;
const ARMS = 3;

/** Its title card, as the die bursts out of the far portal. */
const CARD = Object.freeze({
  seed: 2207,
  glow: '#3fb6ff',
  font: 'tech',
  lines: [
    { text: 'Warp', size: 0.12, at: 0.3, fill: ['#effcff', '#5cc8ff'], edge: '#0b2a6a', enter: 'zoom', tilt: -3 },
    { text: 'Strike!', size: 0.28, at: 0.6, fill: ['#fff6e0', '#ff9a2e'], edge: '#6a2306', enter: 'zoom', delay: 200, tilt: 2 },
  ],
  flash: '#dff4ff',
  sparks: { colors: ['#d8f6ff', '#3fb6ff', '#fff0c8', '#ff8f2a'], count: 60 },
  vignette: 'rgba(2,10,40,0.7)',
  hold: 900,
  exit: 'fade',
});

const SHADE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A soft dark disc (premultiplied "over"): the portal's void, darkening the table under the light.
const SHADE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.25, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** A flat soft dark disc of radius 1 (local: the kit has no darkening glow). set(opacity, radius, x, y, z). */
function makeShade(kit, root, color) {
  const mat = kit.add(
    new THREE.ShaderMaterial({
      vertexShader: SHADE_VERTEX,
      fragmentShader: SHADE_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
    }),
  );
  const mesh = new THREE.Mesh(kit.add(new THREE.PlaneGeometry(2, 2)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.set = (opacity, radius, x, y, z) => {
    mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity));
    mesh.visible = opacity > 0.002;
    if (radius !== undefined) mesh.scale.setScalar(Math.max(1e-3, radius));
    if (x !== undefined) mesh.position.set(x, y, z);
    return mesh;
  };
  mesh.set(0);
  return mesh;
}

/** A portal of light (works on the stage and in the catch: both have a kit and a root). */
function buildPortal(kit, root, pal, r) {
  return {
    shade: makeShade(kit, root, pal.void),
    haze: makeGlow(kit, root, pal.rim, { ring: 0.7, width: 0.3 }),
    rim: makeGlow(kit, root, pal.rim, { ring: 0.74, width: 0.09 }),
    hot: makeGlow(kit, root, pal.hot, { ring: 0.74, width: 0.035 }),
    flare: makeGlow(kit, root, pal.rim, { core: pal.hot, width: 0.45 }),
    arms: Array.from({ length: ARMS }, () => makeRibbon(kit, root, { head: pal.hot, tail: pal.rim, width: r * 0.2, length: 14 })),
    motes: Array.from({ length: MOTES }, () => makeGlow(kit, root, pal.rim, { core: pal.hot, width: 0.4 })),
    spot: new THREE.Vector3(),
  };
}

/** Draws a portal at (x, z), `open` 0..1 (0 hides it), swirling with time `t` (dir: the spin). */
function placePortal(P, x, z, open, t, r, dir = 1) {
  if (open <= 1e-3) {
    P.shade.set(0);
    P.haze.set(0);
    P.rim.set(0);
    P.hot.set(0);
    for (const a of P.arms) (a.reset(), a.opacity(0));
    for (const m of P.motes) m.set(0);
    return;
  }
  const o = Math.min(1, open * 1.5);
  const size = r * 1.3 * open;
  const breathe = 1 + 0.04 * Math.sin(t / 110);
  P.shade.set(0.82 * o, size * 1.05, x, 0.011, z);
  P.haze.set(0.55 * o, size * 1.35 * breathe, x, 0.015, z);
  P.rim.set(0.95 * o, size * breathe, x, 0.016, z);
  P.hot.set(o * (0.75 + 0.25 * Math.sin(t / 37 + x)), size * breathe, x, 0.017, z);
  P.arms.forEach((ribbon, i) => {
    const a = dir * (t / 150) + (i * TAU) / ARMS;
    const d = size * 0.56 * (1 + 0.14 * Math.sin(t / 230 + i * 2));
    P.spot.set(x + Math.sin(a) * d, 0.02 + i * 0.001, z + Math.cos(a) * d);
    ribbon.push(P.spot);
    ribbon.opacity(0.85 * o);
  });
  P.motes.forEach((m, i) => {
    const f = (t / 650 + i / MOTES) % 1; // each mote spirals from the rim to the centre
    const a = dir * (t / 240) + (i / MOTES) * TAU + f * 2.5;
    const d = size * 0.92 * (1 - f);
    m.set(0.9 * o * bump(f), r * 0.22 * open, x + Math.sin(a) * d, 0.03, z + Math.cos(a) * d);
  });
}

export const portalHop = Object.freeze({
  id: 'scene-portal-hop',
  name: 'Portal Hop',
  outcome: 'critical-success',
  duration: DURATION,
  /** The mid-roll catch: a blue portal opens under the tumbling die, follows it and swallows it. */
  swallow(env) {
    let portal;
    let gulp; // the flare at the die as it is swallowed
    return runSwallow(env, {
      grab: GRAB,
      setup(c) {
        portal = buildPortal(c.kit, c.root, BLUE, c.r);
        gulp = makeGlow(c.kit, c.root, BLUE.rim, { core: '#ffffff', width: 0.5 });
      },
      frame(t, c, p) {
        const open = easeOut(span(t, 0, 220)) * (1 - 0.3 * smooth(span(t, 500, 1000)));
        placePortal(portal, 0, 0, open, t, c.r, 1);
        const f = span(t, GRAB - 60, GRAB + 260);
        gulp.set(1.1 * bump(f) * (1 - f * 0.4), c.r * lerp(1.2, 2.6, easeOut(f)), 0, p.y, 0);
        portal.flare.set(0.8 * bump(span(t, GRAB - 20, GRAB + 400)), c.r * 2.2, 0, 0.02, 0);
      },
    });
  },
  play(ctx) {
    let blue;
    let orange;
    let halo; // the light riding on the die in flight
    let trailIn; // its blue ribbon as it hops into the blue portal
    let trailOut; // its white-hot ribbon out of the orange one
    let landRing; // the soft ring of light where it lands
    let aPos;
    let bPos;
    let aAt;
    let bAt;
    let from;
    let lastEmit = null;
    let acc = 0;
    let entered = false;
    let emerged = false;
    let landed = false;
    let winked = false;
    let glinted = false;
    let carded = false;
    const pos = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const v = new THREE.Vector3();
    const o = new THREE.Vector3();

    // motes of light drawn into the blue portal, flung out of the orange one (SPIRAL: they curl)
    const streams = (t, s, dt, aOpen, bOpen) => {
      const r = s.r;
      acc += dt * 26;
      const n = Math.floor(acc);
      acc -= n;
      for (let i = 0; i < n; i++) {
        const a = t / 90 + i * 2.1;
        if (aOpen > 0.2) {
          const d = r * 1.25 * aOpen;
          o.set(aPos.x + Math.sin(a) * d, 0.05, aPos.z + Math.cos(a) * d);
          s.emit({ count: 1, origin: o, dir: { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, speed: r * 1.9 * aOpen, spread: 0.1, life: 0.8, size: r * 0.1, kind: KIND.SPIRAL, color: BLUE.hot, colorEnd: BLUE.rim, halo: 0.8 });
        }
        if (bOpen > 0.2) {
          o.set(bPos.x, 0.06, bPos.z);
          s.emit({ count: 1, origin: o, dir: { x: Math.sin(-a), y: 0.15, z: Math.cos(-a) }, speed: r * 2 * bOpen, spread: 0.12, life: 0.8, size: r * 0.1, kind: KIND.SPIRAL, color: ORANGE.hot, colorEnd: ORANGE.rim, halo: 0.8 });
        }
      }
    };

    // the die bursting out of the orange portal: the climax
    const emerge = (s) => {
      const r = s.r;
      emerged = true;
      s.card(CARD);
      carded = true;
      s.shake(0.25, 220);
      s.effect('light-burst', { color: ORANGE.hot, intensity: 1.1, duration: 800, at: bAt });
      s.effect('shockwave', { color: ORANGE.rim, intensity: 0.8, duration: 750, at: bAt });
      const c = { x: bPos.x, y: 0.15, z: bPos.z };
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + (i % 2) * 0.13;
        const hot = i % 2 === 0;
        s.emit({ count: 1, origin: c, dir: { x: Math.cos(a), y: 0.3, z: Math.sin(a) }, speed: 6 + (i % 4), spread: 0.08, life: 0.5, size: r * 0.17, kind: KIND.STREAK, color: hot ? ORANGE.hot : BLUE.hot, colorEnd: hot ? ORANGE.rim : BLUE.rim, gravity: -8, floor: 0.04 });
      }
      s.emit({ count: 22, origin: c, dir: { x: 0, y: 1, z: 0 }, speed: 3.5, spread: 1, life: 0.9, size: r * 0.2, kind: KIND.GLINT, color: '#ffffff', colorEnd: ORANGE.rim, gravity: -3 });
    };

    // the die flying: a halo on it, its ribbon, embers and glints shed behind it
    const flight = (s, dt, ribbon, tint) => {
      const r = s.r;
      ribbon.push(pos);
      ribbon.opacity(1);
      halo.tint(tint).set(0.9, r * 2.2, pos.x, pos.y, pos.z);
      if (dt <= 0) return;
      v.subVectors(pos, prev).divideScalar(Math.max(dt, 1e-3));
      const n = Math.max(1, Math.round(dt * 70));
      s.emit({ count: n, origin: pos, dir: { x: -v.x, y: -v.y, z: -v.z }, speed: 1, spread: 0.6, life: 0.6, size: r * 0.18, kind: KIND.EMBER, color: ORANGE.hot, colorEnd: ORANGE.deep, gravity: -3, halo: 0.8 });
      if (Math.round(lastEmit / 16) % 2 === 0) {
        s.emit({ count: 1, origin: pos, speed: 0.5, spread: 1, life: 0.5, size: r * 0.22, kind: KIND.GLINT, color: BLUE.hot, colorEnd: BLUE.rim });
      }
    };

    const land = (s) => {
      landed = true;
      s.shake(0.18, 150);
      s.effect('shockwave', { color: BLUE.rim, intensity: 0.6, duration: 650 });
      s.emit({ count: 14, origin: { x: s.rest.x, y: 0.1, z: s.rest.z }, dir: { x: 0, y: 1, z: 0 }, speed: 2.5, spread: 1, life: 0.6, size: s.r * 0.12, kind: KIND.SPARK, color: '#ffffff', colorEnd: BLUE.rim, gravity: -6, floor: 0.04 });
    };

    // a portal collapsing to a pinpoint: a last wink of light
    const wink = (s, at, pal) => {
      s.emit({ count: 6, origin: { x: at.x, y: 0.1, z: at.z }, speed: 0.6, spread: 1, life: 0.5, size: s.r * 0.35, kind: KIND.GLINT, color: pal.hot, colorEnd: pal.rim });
    };

    const ringAt = (t, s, at) => {
      const k = span(t, at, at + 700);
      landRing.set(k > 0 && k < 1 ? 0.9 * (1 - k) ** 1.5 : 0, s.r * lerp(0.9, 2.4, easeOut(k)), s.rest.x, 0.018, s.rest.z);
    };

    // Swallowed: the die comes out of the orange portal.
    const spit = (t, s, dt) => {
      const r = s.r;
      const aOpen = 1 - easeIn(span(t, ...T_SPIT.blueClose));
      const bOpen = easeOut(span(t, ...T_SPIT.orangeOpen)) * (1 - easeIn(span(t, ...T_SPIT.orangeClose)));
      placePortal(blue, aPos.x, aPos.z, aOpen, t, r, 1);
      placePortal(orange, bPos.x, bPos.z, bOpen, t, r, -1);
      streams(t, s, dt, aOpen, t < T_SPIT.orangeClose[0] ? bOpen : 0);
      orange.flare.set(1.2 * bump(span(t, T_SPIT.out - 120, T_SPIT.out + 380)), r * 2.6, bPos.x, 0.02, bPos.z);
      ringAt(t, s, T_SPIT.land);
      if (t >= T_SPIT.orangeClose[1] && !winked) ((winked = true), wink(s, bPos, ORANGE));
      trailIn.opacity(0);
      if (t < T_SPIT.out) {
        halo.set(0);
        return;
      }
      if (!emerged) emerge(s);
      s.die.hide(false);
      if (t < T_SPIT.land) {
        const k = span(t, ...T_SPIT.fly);
        arc(from, s.rest, k, r * 3, pos);
        s.die.pose(pos, 2 * easeOut(k));
        flight(s, dt, trailOut, ORANGE.hot);
      } else {
        if (!landed) land(s);
        pos.copy(s.rest);
        pos.y += r * 0.3 * bump(span(t, T_SPIT.land, T_SPIT.land + 250));
        s.die.pose(pos, 0);
        trailOut.opacity(Math.max(0, 1 - span(t, T_SPIT.land, T_SPIT.land + 200)));
        halo.set(0.9 * (1 - span(t, T_SPIT.land, T_SPIT.land + 400)), r * 2, s.rest.x, s.rest.y, s.rest.z);
      }
      if (t >= T_SPIT.glint && !glinted) ((glinted = true), s.glint());
    };

    // Not swallowed: the die hops into the blue portal and out of the orange one.
    const hop = (t, s, dt) => {
      const r = s.r;
      const aOpen = easeOut(span(t, ...T_HOP.blueOpen)) * (1 - easeIn(span(t, ...T_HOP.blueClose)));
      const bOpen = easeOut(span(t, ...T_HOP.orangeOpen)) * (1 - easeIn(span(t, ...T_HOP.orangeClose)));
      placePortal(blue, aPos.x, aPos.z, aOpen, t, r, 1);
      placePortal(orange, bPos.x, bPos.z, bOpen, t, r, -1);
      streams(t, s, dt, t < T_HOP.blueClose[0] ? aOpen : 0, t < T_HOP.orangeClose[0] ? bOpen : 0);
      blue.flare.set(1.1 * bump(span(t, T_HOP.gone - 150, T_HOP.gone + 300)), r * 2.4, aPos.x, 0.02, aPos.z);
      orange.flare.set(1.2 * bump(span(t, T_HOP.out - 120, T_HOP.out + 380)), r * 2.6, bPos.x, 0.02, bPos.z);
      ringAt(t, s, T_HOP.land);
      if (t >= T_HOP.blueClose[1] && !winked) ((winked = true), wink(s, aPos, BLUE));
      if (t < T_HOP.hop[0]) {
        halo.set(0);
        return;
      }
      if (t < T_HOP.sink[0]) {
        from.copy(aPos).setY(s.rest.y);
        const k = span(t, ...T_HOP.hop);
        arc(s.rest, from, k, r * 1.6, pos);
        s.die.pose(pos, 0.5 * easeOut(k));
        flight(s, dt, trailIn, BLUE.hot);
      } else if (t < T_HOP.gone) {
        pos.copy(aPos).setY(s.rest.y - r * 1.6 * easeIn(span(t, ...T_HOP.sink)));
        s.die.pose(pos, 0.5);
        trailIn.push(pos);
        halo.tint(BLUE.hot).set(0.9 * (1 - span(t, ...T_HOP.sink)), r * 2, pos.x, 0.05, pos.z);
      } else if (t < T_HOP.out) {
        if (!entered) {
          entered = true; // swallowed by the blue portal: an implosion of light
          s.effect('light-burst', { color: BLUE.hot, intensity: 0.7, duration: 500, at: aAt });
          s.emit({ count: 14, origin: { x: aPos.x, y: 0.1, z: aPos.z }, dir: { x: 0, y: 1, z: 0 }, speed: 2, spread: 1, life: 0.5, size: r * 0.25, kind: KIND.GLINT, color: '#ffffff', colorEnd: BLUE.rim });
        }
        s.die.hide(true);
        halo.set(0);
        trailIn.opacity(Math.max(0, 1 - span(t, T_HOP.gone, T_HOP.gone + 200)));
      } else if (t < T_HOP.land) {
        if (!emerged) emerge(s);
        trailIn.opacity(0);
        s.die.hide(false);
        from.copy(bPos).setY(s.rest.y - r * 1.2);
        const k = span(t, ...T_HOP.fly);
        arc(from, s.rest, k, r * 2.8, pos);
        s.die.pose(pos, 0.5 + 1.5 * easeOut(k));
        flight(s, dt, trailOut, ORANGE.hot);
      } else {
        if (!landed) land(s);
        pos.copy(s.rest);
        pos.y += r * 0.25 * bump(span(t, T_HOP.land, T_HOP.land + 220));
        s.die.pose(pos, 0);
        trailOut.opacity(Math.max(0, 1 - span(t, T_HOP.land, T_HOP.land + 200)));
        halo.set(0.9 * (1 - span(t, T_HOP.land, T_HOP.land + 400)), r * 2, s.rest.x, s.rest.y, s.rest.z);
      }
      if (t >= T_HOP.glint && !glinted) ((glinted = true), s.glint());
    };

    return runScene(ctx, {
      duration: DURATION,
      setup(s) {
        const r = s.r;
        blue = buildPortal(s.kit, s.root, BLUE, r);
        orange = buildPortal(s.kit, s.root, ORANGE, r);
        halo = s.glow(ORANGE.hot, { core: '#ffffff', width: 0.5 });
        trailIn = s.ribbon({ head: '#ffffff', tail: BLUE.rim, width: r * 0.9, length: 20 });
        trailOut = s.ribbon({ head: '#fffaf0', tail: ORANGE.rim, width: r * 1, length: 24 });
        landRing = s.glow(BLUE.rim, { ring: 0.6, width: 0.15 });
        if (s.swallowed) {
          aPos = s.ground.clone();
          bPos = s.beside(r * 2.6);
          from = bPos.clone().setY(s.rest.y * 0.3);
        } else {
          aPos = s.beside(r * 1.9, s.side);
          bPos = s.beside(r * 2.2);
          from = new THREE.Vector3();
        }
        aAt = aPos.clone().setY(s.rest.y);
        bAt = bPos.clone().setY(s.rest.y);
        pos.copy(s.rest);
      },
      full(t, s) {
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        prev.copy(pos);
        if (s.swallowed) spit(t, s, dt);
        else hop(t, s, dt);
      },
      calm(t, s) {
        // reduced: the blue portal shimmers under the die and closes; the die stays put
        placePortal(blue, s.rest.x, s.rest.z, 0.85 * bump(t / 1600), t, s.r, 1);
        if (t >= 450 && !carded) ((carded = true), s.card(CARD));
        if (t >= 600 && !glinted) ((glinted = true), s.glint());
      },
    });
  },
});
