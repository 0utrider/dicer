import * as THREE from 'three';
import { runScene, runIntro, span, easeOut, easeIn, smooth, bump, lerp, TAU, KIND, SHAPE } from './kit.js';

/**
 * Ghost Out (a natural 1): the die gives up the ghost.
 *
 * 0-400     the die shudders; a cold green-white light seeps up around its foot
 * 80-650    a spirit of light and mist pours up out of it: a glowing head with two soft dark eyes,
 *           a wispy tail of light curling behind, mist streaming off it; the die sags, drained
 * 700       BOO: it lunges up at the table (nearer, bigger), mouth wide; a spectral shockwave and a
 *           burst of glints; the title card pops in
 * 950-2200  it sways off toward the table's centre, shrinking, thinning into mist
 * 1500-2100 the die perks back up and settles home
 *
 * Mid-roll (intro): a cold green-white seep glows round the tumbling die, a wisp of spirit light
 * trails off it and mist streams away behind. Played after it, the show starts with the spirit
 * already pouring up (the seep seen): the boo comes ~450 ms after landing.
 */
export const DURATION = 2400;
const T = { seep: [0, 400], rise: [80, 650], boo: 700, lunge: [680, 1100], drift: [950, 2200], fade: [1500, 2200], sag: [150, 600], perk: [1500, 2100] };

const SPIRIT = '#9dffd0';
const PALE = '#effff6';
const DEEP = '#2fa878';
const GOLDEN = 2.399963;
const TAIL = 16; // points along each tail ribbon

/** Its title card, at the boo. */
const CARD = Object.freeze({
  seed: 403,
  glow: '#7dffc0',
  font: 'display',
  lines: [
    { text: 'Boo!', size: 0.3, at: 0.4, fill: ['#ffffff', '#b8ffd8'], edge: '#0c3a2a', enter: 'pop', tilt: -5 },
    { text: 'Critical Miss', size: 0.12, at: 0.64, fill: ['#f2fff8', '#8fe0b8'], edge: '#0a2a1e', enter: 'pop', delay: 300, tilt: 2 },
  ],
  flash: '#dcfff0',
  vignette: 'rgba(4,26,20,0.86)',
  shake: 0.35,
  hold: 900,
  exit: 'fade',
});

// A soft dark spot (the ghost's eyes and mouth): normal blend, gaussian edge, flat facing up.
const SPOT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SPOT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.45, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}`;

function makeSpot(s, color) {
  const mat = s.kit.add(
    new THREE.ShaderMaterial({
      vertexShader: SPOT_VERTEX,
      fragmentShader: SPOT_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
    }),
  );
  const mesh = new THREE.Mesh(s.geo(new THREE.PlaneGeometry(2, 2)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  s.add(mesh);
  mesh.set = (opacity, w, h, x, y, z) => {
    mat.uniforms.uOpacity.value = Math.max(0, opacity);
    mesh.visible = opacity > 0.002;
    mesh.scale.set(Math.max(1e-3, w), Math.max(1e-3, h), 1);
    mesh.position.set(x, y, z);
  };
  mesh.set(0, 1, 1, 0, 0, 0);
  return mesh;
}

export const ghostOut = Object.freeze({
  id: 'scene-ghost-out',
  name: 'Ghost Out',
  outcome: 'critical-failure',
  duration: DURATION,
  /**
   * Mid-roll: the die is haunted. A cold green-white light seeps round it and lights the table
   * under it, a pale wisp trails off it like a tail, and mist streams off it as it tumbles, with
   * the odd cold glint: something wants out.
   */
  intro(env) {
    let seep;
    let pool;
    let halo;
    let tail;
    let last = null;
    let wisps = 0;
    const q = new THREE.Vector3();
    return runIntro(env, {
      setup(c) {
        seep = c.glow(SPIRIT, { core: PALE, ring: 0.5, width: 0.3 });
        pool = c.glow('#3fdc9a', { core: PALE, width: 0.55 });
        halo = c.glow(SPIRIT, { core: '#ffffff', width: 0.5 });
        tail = c.ribbon({ head: '#d8ffec', tail: DEEP, width: c.r * 0.9, length: 20 });
      },
      frame(t, c, p) {
        const r = c.r;
        const dt = last === null ? 0 : Math.min(0.05, (t - last) / 1000);
        last = t;
        const k = easeIn(span(t, 0, 600));
        const flick = 0.85 + 0.15 * Math.sin(t / 90) * Math.sin(t / 143);
        const lift = Math.max(0, p.y);
        // c.root follows the die on the table: (0, 0) is under it
        seep.set(0.6 * k * flick, r * (1.15 + 0.15 * Math.sin(t / 210)), 0, 0.021, 0);
        pool.set((0.45 * k) / (1 + lift * 0.3), r * (1.6 + lift * 0.2), 0, 0.02, 0);
        halo.set(0.4 * k * flick, r * 1.45, 0, p.y, 0);
        tail.push(p);
        tail.opacity(0.7 * k);
        if (dt > 0) {
          const n = Math.max(1, Math.round(dt * 30 * k));
          for (let i = 0; i < n; i++, wisps++) {
            const a = wisps * GOLDEN;
            q.set(p.x + Math.cos(a) * r * 0.5, p.y + r * 0.2, p.z + Math.sin(a) * r * 0.5);
            c.emit({ count: 1, origin: q, dir: { x: 0, y: 1, z: 0.3 }, speed: 0.5, spread: 0.7, life: 0.9, size: r * 0.45, sizeEnd: 2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, color: '#c8ffe4', colorEnd: '#1a6a4a', alpha: 0.3 * k, halo: 0.3, gravity: 0.3 });
            if (wisps % 7 === 0) c.emit({ count: 1, origin: q, speed: 0.4, spread: 1, life: 0.45, size: r * 0.22, kind: KIND.GLINT, color: '#ffffff', colorEnd: SPIRIT });
          }
        }
      },
    });
  },
  play(ctx) {
    let head; // the glowing head
    let aura; // the wide faint light around it
    let pool; // its cold light on the table
    let seep; // the light seeping up round the die's foot
    let ring; // the spectral shockwave ring at the boo
    let tails; // two wispy tail ribbons
    let eyes; // two soft dark eyes
    let shines; // a tiny light in each eye
    let mouth; // a soft dark mouth that gapes at the boo
    let wisps = 0; // mist puffs emitted
    let booed = false;
    let glinted = false;
    let lastEmit = null;
    const pos = new THREE.Vector3();
    const away = new THREE.Vector3();
    const q = new THREE.Vector3();
    /**
     * Draws the spirit: head at `p` with radius `R`, opacity `o`, mouth gape `gape` (0..1), at
     * time t. The tail trails down-screen (+z: the camera's screen-up is -z), waving.
     */
    const draw = (s, p, R, o, gape, t) => {
      const flick = 0.9 + 0.1 * Math.sin(t / 70) * Math.sin(t / 113);
      head.set(o * 0.95 * flick, R * 1.25, p.x, p.y, p.z);
      aura.set(o * 0.4, R * 2.6, p.x, p.y - 0.01, p.z);
      tails.forEach((rb, j) => {
        rb.reset();
        for (let i = TAIL - 1; i >= 0; i--) {
          const k = i / (TAIL - 1);
          const wave = Math.sin(t / (150 + j * 40) + k * 5 + j * 1.3) * k * R * (0.45 + j * 0.15);
          q.set(p.x + wave, p.y - k * R * 0.8, p.z + k * R * (2.4 - j * 0.5));
          rb.push(q);
        }
        rb.opacity(o * (j === 0 ? 0.75 : 0.9));
      });
      // the face: eyes up-screen of centre, the mouth below them
      const ey = p.y + 0.02;
      const wide = 1 + gape * 0.3;
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? -1 : 1;
        eyes[i].set(o * 0.92, R * 0.17 * wide, R * 0.24 * wide, p.x + sx * R * 0.3, ey, p.z - R * 0.12);
        shines[i].set(o * 0.8, R * 0.09, p.x + sx * R * 0.3 - R * 0.05, ey + 0.01, p.z - R * 0.2);
      }
      mouth.set(o * (0.55 + 0.4 * gape), R * lerp(0.14, 0.26, gape), R * lerp(0.07, 0.34, gape), p.x, ey, p.z + R * 0.32);
    };
    return runScene(ctx, {
      duration: DURATION,
      introSkip: 250, // the seep was seen mid-roll: the spirit is already pouring up as it lands
      setup(s) {
        head = s.glow(SPIRIT, { core: '#ffffff', width: 0.5 });
        aura = s.glow(DEEP, { core: SPIRIT, width: 0.6 });
        pool = s.glow('#3fdc9a', { core: PALE, width: 0.55 });
        seep = s.glow(SPIRIT, { core: PALE, ring: 0.5, width: 0.3 });
        ring = s.glow(SPIRIT, { core: PALE, ring: 0.7, width: 0.12 });
        tails = [s.ribbon({ head: '#d8ffec', tail: DEEP, width: s.r * 1.3, length: TAIL }), s.ribbon({ head: '#ffffff', tail: SPIRIT, width: s.r * 0.55, length: TAIL })];
        eyes = [makeSpot(s, '#06140f'), makeSpot(s, '#06140f')];
        mouth = makeSpot(s, '#06140f');
        shines = [0, 1].map(() => s.glow('#ffffff', { core: '#ffffff', width: 0.4, renderOrder: 6 }));
        // it drifts off toward the table's centre, slightly sideways
        away.copy(s.rest).addScaledVector(s.toward, s.r * 3.4).addScaledVector(s.side, s.r * 0.8);
      },
      full(t, s) {
        const r = s.r;
        const dt = lastEmit === null ? 0 : Math.min(0.05, (t - lastEmit) / 1000);
        lastEmit = t;
        // --- the spirit's path: pours up, lunges at the boo, sways away ---
        const rise = easeOut(span(t, ...T.rise));
        const lunge = bump(span(t, ...T.lunge));
        const go = span(t, ...T.drift);
        const sway = Math.sin(t / 230) * r * 0.35 * span(t, 850, 1250);
        pos.lerpVectors(s.rest, away, smooth(go)).addScaledVector(s.side, sway);
        pos.y = s.rest.y + r * lerp(0.2, 2, rise) + r * 1.4 * lunge + r * 0.8 * easeIn(go) + Math.sin(t / 180) * r * 0.08;
        const R = r * lerp(0.3, 0.72, rise) * (1 + 0.3 * lunge) * lerp(1, 0.4, easeIn(go));
        const o = span(t, 80, 350) * (1 - span(t, ...T.fade));
        draw(s, pos, R, o, lunge, t);
        // its cold light on the table, weaker the higher it is
        const lift = Math.max(0, pos.y - s.rest.y);
        pool.set((o * 0.55) / (1 + lift * 0.3), r * (1.6 + lift * 0.25), pos.x, 0.02, pos.z);
        // the seep round the die's foot as it starts
        const sk = span(t, ...T.seep);
        seep.set(0.7 * bump(sk), r * lerp(0.9, 1.6, sk), s.rest.x, 0.021, s.rest.z);
        // mist streaming off the spirit (and out of the die while it pours up)
        if (dt > 0 && o > 0.05) {
          const n = Math.max(1, Math.round(dt * 34));
          for (let i = 0; i < n; i++, wisps++) {
            const a = wisps * GOLDEN;
            const k = (wisps % 5) / 5; // along the tail
            const fromDie = t < T.rise[1] && wisps % 3 === 0;
            q.set(pos.x + Math.cos(a) * R * 0.5, pos.y - k * R * 0.6, pos.z + k * R * 1.8 + Math.sin(a) * R * 0.3);
            if (fromDie) q.set(s.rest.x + Math.cos(a) * r * 0.5, s.rest.y + r * 0.3, s.rest.z + Math.sin(a) * r * 0.5);
            s.emit({ count: 1, origin: q, dir: { x: 0, y: 1, z: 0.3 }, speed: fromDie ? 1.6 : 0.35, spread: 0.7, life: 1.1, size: R * 0.9, sizeEnd: 2, kind: KIND.SMOKE, shape: SHAPE.SMOKE, color: '#c8ffe4', colorEnd: '#1a6a4a', alpha: 0.32 * o, halo: 0.3, gravity: 0.3 });
          }
        }
        // --- BOO ---
        if (t >= T.boo && !booed) {
          booed = true;
          s.shake(0.14, 180);
          s.card(CARD);
          s.effect('shockwave', { color: SPIRIT, intensity: 0.8, duration: 800 });
          s.emit({ count: 14, origin: pos, speed: 2.4, spread: 1, life: 0.7, size: r * 0.35, kind: KIND.GLINT, color: '#ffffff', colorEnd: SPIRIT, gravity: 0.5 });
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * TAU;
            s.emit({ count: 1, origin: pos, dir: { x: Math.cos(a), y: 0.15, z: Math.sin(a) }, speed: 3.2, spread: 0.2, life: 1, size: R * 0.8, sizeEnd: 2.4, kind: KIND.SMOKE, shape: SHAPE.SMOKE, color: '#d8fff0', colorEnd: '#1a5a40', alpha: 0.3, halo: 0.3, drag: 2.5 });
          }
        }
        const bk = span(t, T.boo, T.boo + 700);
        ring.set(bk > 0 ? 0.85 * (1 - bk) ** 1.5 : 0, r * lerp(1, 3.4, easeOut(bk)), s.rest.x, 0.022, s.rest.z);
        // --- the die sags (sinks a little, a weary droop), then perks back up home ---
        const sag = smooth(span(t, ...T.sag)) * (1 - smooth(span(t, ...T.perk)));
        const shudder = Math.sin(t / 18) * r * 0.025 * bump(span(t, 0, 360));
        pos.copy(s.rest).addScaledVector(s.side, shudder);
        pos.y -= r * 0.16 * sag;
        s.die.pose(pos, -0.02 * sag);
        if (t >= 2150 && !glinted) ((glinted = true), s.glint());
      },
      calm(t, s) {
        // reduced: a faint spirit hovers over the die, glowing, and fades; the die stays put
        const r = s.r;
        const o = bump(t / 1600) * 0.8;
        pos.set(s.rest.x, s.rest.y + r * 1.6, s.rest.z);
        draw(s, pos, r * 0.55, o, 0.3 * bump(span(t, 300, 900)), t);
        pool.set(o * 0.4, r * 1.8, s.rest.x, 0.02, s.rest.z);
        if (t >= 300 && !glinted) ((glinted = true), s.card(CARD));
      },
    });
  },
});
