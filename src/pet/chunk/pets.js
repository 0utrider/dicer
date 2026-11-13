import * as THREE from 'three';
import { CREATURES } from './creatures/index.js';
import { phaseAt, ENTER_MS } from './timeline.js';
import { summarize, reactionSound } from './reaction.js';

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

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => t * t * (3 - 2 * t);

function discTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const a = Math.max(0, 1 - r);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = Math.round(255 * a * a);
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * The pet layer (lazy chunk): one pet per roller, driven by DiceBox's PetHook. A pet's whole life
 * is a timeline (timeline.js); update() poses and places it each frame and removes it when gone.
 */
export function createPetLayer(deps) {
  const { scene, getSetting, playSound, warm } = deps;
  const clock = deps.now || (() => performance.now()); // test seam; DiceBox's update() is on this clock
  const pets = new Map(); // userId -> pet
  const keyOwner = new Map(); // roll key -> userId
  let shadowTex = null;
  let shadowGeo = null;
  let disposed = false;

  const sharedShadow = () => {
    shadowTex ??= discTexture();
    shadowGeo ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  };

  function removePet(pet) {
    pets.delete(pet.userId);
    for (const k of pet.keys) keyOwner.delete(k);
    pet.keys.clear();
    scene.remove(pet.group);
    try {
      pet.creature.dispose();
    } catch {
      /* already torn down */
    }
    pet.shadow.material.dispose();
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
    let pet = pets.get(spec.userId);
    const fresh = !pet;
    if (fresh) {
      if (pets.size >= MAX_PETS) return;
      const make = CREATURES[spec.kind];
      if (!make) return;
      const creature = make(spec.color);
      const group = new THREE.Group();
      group.userData.dicerPet = { phase: 'enter' };
      group.add(creature.root);
      sharedShadow();
      const shadow = new THREE.Mesh(
        shadowGeo,
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      shadow.name = 'petShadow';
      shadow.position.y = 0.01;
      shadow.scale.setScalar(creature.height * 0.7);
      group.add(shadow);
      scene.add(group);
      pet = { userId: spec.userId, creature, group, shadow, keys: new Set() };
      pets.set(spec.userId, pet);
    }
    pet.keys.add(key);
    keyOwner.set(key, spec.userId);
    // ghost, reaction, soundDone and current belong to the pet, not to a roll: the newest roll
    // (pet.current) owns them, and a stale key's landed/leave is ignored.
    pet.current = key;
    pet.ghost = !!spec.ghost;
    pet.centre = centre;
    place(pet, edge, area);
    pet.yaw = pet.inward;
    pet.reaction = 'plain';
    pet.soundDone = false;
    pet.slide = pet.hop = 0;
    pet.exitFrom = null;
    const now = clock();
    pet.lastNow = now;
    // A re-used pet restarts from the throw, with no re-enter.
    pet.track = { beganAt: fresh ? now : now - ENTER_MS };
  }

  const petOf = (key) => {
    const u = keyOwner.get(key);
    return u === undefined ? null : pets.get(u) || null;
  };

  function landed(key, dice) {
    const pet = petOf(key);
    if (!pet || pet.current !== key) return;
    pet.reaction = summarize(dice, pet.ghost);
    pet.soundDone = false;
    pet.track.landedAt = clock();
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
    pet.keys.delete(key);
    if (pet.keys.size === 0) removePet(pet);
  }

  function step(pet, now) {
    const { phase, t } = phaseAt(pet.track, now);
    if (phase === 'gone') return false;
    const h = pet.creature.height;
    const { base, out } = pet;
    let slide = 0;
    let hop = 0;
    if (phase === 'enter') {
      const e = smooth(t);
      slide = (1 - e) * SLIDE * h;
      hop = Math.sin(e * Math.PI) * HOP * h;
    } else if (phase === 'exit') {
      // Leave from wherever the pet is now (a leave can land mid-hop), not from its base.
      pet.exitFrom ??= { slide: pet.slide, hop: pet.hop };
      const e = smooth(t);
      slide = pet.exitFrom.slide + (SLIDE * h - pet.exitFrom.slide) * e;
      hop = pet.exitFrom.hop * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
    }
    pet.slide = slide;
    pet.hop = hop;
    const px = base.x + out[0] * slide;
    const pz = base.z + out[1] * slide;
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
    pet.shadow.visible = getSetting('shadows') !== false;
    pet.creature.pose(phase, t, pet.reaction, { yaw: look });
    if (phase === 'react' && !pet.soundDone) {
      pet.soundDone = true;
      const name = reactionSound(pet.reaction);
      if (name && getSetting('petSounds') !== false && getSetting('sounds') !== false)
        playSound({ builtin: name });
    }
    return true;
  }

  function update(now) {
    for (const pet of [...pets.values()]) {
      let alive = false;
      try {
        alive = step(pet, now);
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
      if (!alive) removePet(pet);
    }
    return pets.size > 0;
  }

  function dispose() {
    disposed = true;
    for (const pet of [...pets.values()]) removePet(pet);
    shadowTex?.dispose();
    shadowGeo?.dispose();
    shadowTex = shadowGeo = null;
  }

  // One of each creature, compiled up front so the first pet costs no programs mid-roll.
  try {
    const sample = Object.values(CREATURES).map((make) => make('#ffffff'));
    try {
      warm?.(sample.map((c) => c.root));
    } finally {
      for (const c of sample) c.dispose();
    }
  } catch (err) {
    console.warn('Dicer | pet', err);
  }

  return { begin, landed, leave, end, update, dispose };
}
