import * as THREE from 'three';
import { CREATURES } from './creatures/index.js';
import { phaseAt, ENTER_MS, REACT_MS } from './timeline.js';
import { summarize, merge, reactionSound } from './reaction.js';

/** At most this many pets on screen at once. */
export const MAX_PETS = 3;
const INSET = 0.6; // of the creature's height, in from the area edge
const OUT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]; // the outward direction of each edge: +x, -x, +z, -z
const HOP = 0.45; // of the height
const SLIDE = 1.5; // of the height, how far outside the edge the pet hops in from
const LOOK_MAX = 0.6;
const MOVED = 1e-3; // a re-used pet farther than this from its new spot hops there

// The crit's sparkle burst: a few additive star points thrown out around the pet.
const SPARKS = 12;
const BURST_MS = 900; // from the start of the crit reaction
const SPARK_SIZE = 1.7; // PointsMaterial size: about 0.3 die units under Dicer's FOV-20 camera
const GOLD = [1, 0.78, 0.3];
const WHITE = [1, 0.96, 0.86];
// Fixed per spark (every burst alike, nothing random per frame): direction, reach, rise, twinkle phase.
const SPARK = Array.from({ length: SPARKS }, (_, i) => {
  const j = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const r = j - Math.floor(j);
  return {
    a: (i / SPARKS) * Math.PI * 2 + r * 0.5,
    reach: 0.7 + 0.5 * r,
    rise: 0.25 + 0.6 * ((r * 7) % 1),
    ph: r * Math.PI * 2,
    c: i % 3 === 0 ? WHITE : GOLD,
  };
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => t * t * (3 - 2 * t);

function texture(n, alphaAt, rgb) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = rgb;
      data[i + 3] = Math.round(255 * alphaAt(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1));
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** A soft black disc: the contact shadow. */
const discTexture = () =>
  texture(32, (u, v) => Math.max(0, 1 - Math.hypot(u, v)) ** 2, 0);

/** A white four-pointed twinkle: a small round core and two thin arms. */
const starTexture = () =>
  texture(
    32,
    (u, v) => {
      const core = Math.max(0, 1 - Math.hypot(u, v) * 2.2) ** 2;
      const arm = (a, b) => Math.max(0, 1 - Math.abs(a) * 10) * Math.max(0, 1 - Math.abs(b)) ** 2;
      return Math.min(1, core + 0.9 * (arm(u, v) + arm(v, u)));
    },
    255,
  );

/**
 * The pet layer (lazy chunk): one pet per roller, driven by DiceBox's PetHook. A pet's whole life
 * is a timeline (timeline.js); update() poses and places it each frame and removes it when gone.
 * A pet re-used by overlapping rolls keeps each roll's ghost flag and landed summary by key: it
 * reacts once every live roll has landed, to their merged summaries (reaction.js).
 */
export function createPetLayer(deps) {
  const { scene, getSetting, playSound, warm } = deps;
  const clock = deps.now || (() => performance.now()); // test seam; DiceBox's update() is on this clock
  const pets = new Map(); // userId -> pet
  const keyOwner = new Map(); // roll key -> userId
  let shadowTex = null;
  let shadowGeo = null;
  let sparkTex = null;
  let sparkMat = null;
  let disposed = false;

  const makeShadow = () => {
    shadowTex ??= discTexture();
    shadowGeo ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    shadow.name = 'petShadow';
    shadow.position.y = 0.01;
    return shadow;
  };

  /** The burst's points: one shared material, a small geometry per pet rewritten in place. */
  const makeSparkle = () => {
    sparkTex ??= starTexture();
    sparkMat ??= new THREE.PointsMaterial({
      size: SPARK_SIZE,
      map: sparkTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'color'])
      geo.setAttribute(
        name,
        new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage),
      );
    const pts = new THREE.Points(geo, sparkMat);
    pts.name = 'petSparkle';
    pts.visible = false;
    pts.frustumCulled = false; // its bounds change every frame
    return pts;
  };

  /** Writes the burst at s (0..1) in the pet's own space, anchored to the ground while it jumps. */
  function burst(pts, s, h, hop) {
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    const P = pos.array;
    const C = col.array;
    const grow = 1 - (1 - s) ** 3;
    const fade = 1 - s * s;
    for (let i = 0; i < SPARKS; i++) {
      const sp = SPARK[i];
      const k = i * 3;
      const r = sp.reach * h * grow;
      P[k] = Math.sin(sp.a) * r;
      P[k + 1] = h * (0.55 + sp.rise * grow) - 0.5 * h * s * s;
      P[k + 2] = Math.cos(sp.a) * r;
      const b = Math.min(1, fade * (0.6 + 0.4 * Math.sin(s * 22 + sp.ph))); // twinkle, clamped
      C[k] = sp.c[0] * b;
      C[k + 1] = sp.c[1] * b;
      C[k + 2] = sp.c[2] * b;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pts.position.y = -hop;
  }

  function removePet(pet) {
    pets.delete(pet.userId);
    for (const k of pet.rolls.keys()) keyOwner.delete(k);
    pet.rolls.clear();
    scene.remove(pet.group);
    try {
      pet.creature.dispose();
    } catch {
      /* already torn down */
    }
    pet.shadow.material.dispose();
    pet.sparkle.geometry.dispose();
  }

  /** Puts a new creature in the pet (the first, or a new kind or colour); the old one is freed. */
  function setCreature(pet, creature, spec) {
    if (pet.creature) {
      pet.group.remove(pet.creature.root);
      try {
        pet.creature.dispose();
      } catch {
        /* already torn down */
      }
    }
    pet.creature = creature;
    pet.kind = spec.kind;
    pet.color = spec.color;
    pet.group.add(creature.root);
    pet.group.children.unshift(pet.group.children.pop()); // the creature stays the first child
    pet.shadow.scale.setScalar(creature.height * 0.7);
  }

  function place(pet, edge, area) {
    const out = OUT[edge] || OUT[0];
    const half = edge < 2 ? area.halfWidth : area.halfDepth;
    const d = half - INSET * pet.creature.height;
    pet.out = out;
    pet.base = { x: area.cx + out[0] * d, z: area.cz + out[1] * d };
    pet.inward = Math.atan2(-out[0], -out[1]);
  }

  function begin(key, { spec, edge, area, centre }) {
    if (disposed) return;
    const make = CREATURES[spec.kind];
    let pet = pets.get(spec.userId);
    const fresh = !pet;
    if (fresh) {
      if (pets.size >= MAX_PETS || !make) return;
      const creature = make(spec.color);
      const group = new THREE.Group();
      group.userData.dicerPet = { phase: 'enter' };
      const shadow = makeShadow();
      const sparkle = makeSparkle();
      group.add(shadow, sparkle);
      pet = { userId: spec.userId, group, shadow, sparkle, creature: null, rolls: new Map() };
      setCreature(pet, creature, spec);
      scene.add(group);
      pets.set(spec.userId, pet);
    } else if (make && (pet.kind !== spec.kind || pet.color !== spec.color)) {
      setCreature(pet, make(spec.color), spec); // the editor's Throw shows the new pick at once
    }
    pet.rolls.set(key, { ghost: !!spec.ghost, summary: null });
    keyOwner.set(key, spec.userId);
    // The newest roll (pet.current) owns the throw, the place and the leave; each roll keeps its
    // own ghost flag and summary for the merged reaction.
    pet.current = key;
    pet.centre = centre;
    const was = fresh ? null : { x: pet.px, z: pet.pz, y: pet.hop };
    place(pet, edge, area);
    pet.yaw = pet.inward;
    pet.reaction = 'plain';
    pet.soundDone = false;
    pet.exitFrom = null;
    const now = clock();
    pet.lastNow = now;
    // A re-used pet standing at its new spot restarts from the throw, with no re-enter; one that
    // is elsewhere (mid-exit, another edge or area) hops there from where it is.
    const moved =
      !!was && (Math.hypot(was.x - pet.base.x, was.z - pet.base.z) > MOVED || was.y > MOVED);
    pet.from = moved ? was : null;
    pet.track = { beganAt: fresh || moved ? now : now - ENTER_MS };
  }

  const petOf = (key) => {
    const u = keyOwner.get(key);
    return u === undefined ? null : pets.get(u) || null;
  };

  /** Starts the reaction once every live roll of the pet has landed, to their merged summaries. */
  function settle(pet) {
    if (pet.track.landedAt != null) return;
    const summaries = [];
    for (const r of pet.rolls.values()) {
      if (!r.summary) return;
      summaries.push(r.summary);
    }
    pet.reaction = merge(summaries);
    pet.soundDone = false;
    pet.track.landedAt = clock();
  }

  function landed(key, dice) {
    const pet = petOf(key);
    const roll = pet?.rolls.get(key);
    if (!roll || roll.summary) return;
    roll.summary = summarize(dice, roll.ghost); // a ghost roll only ever says 'plain'
    settle(pet);
  }

  function leave(key, msLeft) {
    const pet = petOf(key);
    if (!pet || pet.current !== key) return;
    pet.track.leaveAt = clock();
    pet.track.leaveMs = msLeft;
  }

  function end(key) {
    const pet = petOf(key);
    keyOwner.delete(key);
    if (!pet) return;
    pet.rolls.delete(key);
    if (pet.rolls.size === 0) removePet(pet);
    else settle(pet); // the rolls still on screen may all have landed now
  }

  function step(pet, now, shadows) {
    const { phase, t } = phaseAt(pet.track, now);
    if (phase === 'gone') return false;
    const h = pet.creature.height;
    const { base, out } = pet;
    let px = base.x;
    let pz = base.z;
    let hop = 0;
    if (phase === 'enter') {
      const e = smooth(t);
      const from = pet.from;
      if (from) {
        // a re-used pet hops from where it was to its new spot
        px = from.x + (base.x - from.x) * e;
        pz = from.z + (base.z - from.z) * e;
        hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
      } else {
        const slide = (1 - e) * SLIDE * h;
        px += out[0] * slide;
        pz += out[1] * slide;
        hop = Math.sin(e * Math.PI) * HOP * h;
      }
    } else if (phase === 'exit') {
      // Leave from wherever the pet is now (a leave can land mid-hop), not from its base.
      const from = (pet.exitFrom ??= { x: pet.px ?? base.x, z: pet.pz ?? base.z, y: pet.hop ?? 0 });
      const e = smooth(t);
      px = from.x + (base.x + out[0] * SLIDE * h - from.x) * e;
      pz = from.z + (base.z + out[1] * SLIDE * h - from.z) * e;
      hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
    }
    pet.px = px;
    pet.pz = pz;
    pet.hop = hop;
    const dt = Math.max(0, now - (pet.lastNow ?? now));
    pet.lastNow = now;
    let look = 0;
    if (phase === 'watch' || phase === 'react') {
      const c = pet.centre();
      const toDice = Math.atan2(c.x - px, c.z - pz);
      pet.yaw = wrap(pet.yaw + wrap(toDice - pet.yaw) * (1 - Math.exp(-dt / 90)));
      look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, wrap(toDice - pet.yaw)));
    }
    pet.group.position.set(px, hop, pz);
    pet.group.rotation.y = pet.yaw;
    pet.group.userData.dicerPet.phase = phase;
    pet.shadow.position.y = 0.01 - hop;
    pet.shadow.visible = shadows;
    pet.creature.pose(phase, t, pet.reaction, { yaw: look });
    // A ghost roll is never 'crit', so it never bursts.
    const s = phase === 'react' && pet.reaction === 'crit' ? (t * REACT_MS) / BURST_MS : 1;
    pet.sparkle.visible = s < 1;
    if (s < 1) burst(pet.sparkle, s, h, hop);
    if (phase === 'react' && !pet.soundDone) {
      pet.soundDone = true;
      const name = reactionSound(pet.reaction);
      if (name && getSetting('petSounds') !== false && getSetting('sounds') !== false)
        playSound({ builtin: name });
    }
    return true;
  }

  function update(now) {
    if (!pets.size) return false;
    let shadows = true;
    try {
      shadows = getSetting('shadows') !== false; // once per frame, not per pet
    } catch {
      /* unreadable: keep the default */
    }
    for (const pet of [...pets.values()]) {
      let alive = false;
      try {
        alive = step(pet, now, shadows);
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
      if (!alive) removePet(pet);
    }
    return pets.size > 0;
  }

  // One of each creature, plus a shadow and a sparkle, compiled up front so the first pet costs no
  // programs mid-roll. They stay alive (never in the scene) until dispose(): freeing their
  // materials would release, and so delete, the programs just compiled.
  const samples = [];
  let sampleShadow = null;
  let sampleSparkle = null;
  if (warm) {
    try {
      const objs = [];
      for (const make of Object.values(CREATURES)) {
        const c = make('#ffffff');
        samples.push(c);
        c.root.traverse((o) => {
          if (o.isMesh || o.isPoints) objs.push(o);
        });
      }
      sampleShadow = makeShadow();
      sampleSparkle = makeSparkle();
      objs.push(sampleShadow, sampleSparkle);
      Promise.resolve(warm(objs)).catch(() => {}); // a context loss or timeout: compiled on use
    } catch (err) {
      console.warn('Dicer | pet', err);
    }
  }

  function dispose() {
    disposed = true;
    for (const pet of [...pets.values()]) removePet(pet);
    for (const c of samples) {
      try {
        c.dispose();
      } catch {
        /* already torn down */
      }
    }
    samples.length = 0;
    sampleShadow?.material.dispose();
    sampleSparkle?.geometry.dispose();
    sampleShadow = sampleSparkle = null;
    shadowTex?.dispose();
    shadowGeo?.dispose();
    sparkTex?.dispose();
    sparkMat?.dispose();
    shadowTex = shadowGeo = sparkTex = sparkMat = null;
  }

  return { begin, landed, leave, end, update, dispose };
}
