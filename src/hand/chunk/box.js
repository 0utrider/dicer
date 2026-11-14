/**
 * The hand chunk's half of DiceBox (lazy: free dice only happen in hand throws and replays, which
 * load this chunk first). handFor(box) sets box.hand and sends the face readers to that box's
 * physics worker; DiceBox then calls these hooks from world-start code, and they build on its
 * internal steps (_newRoll, _throw, _finish, _reveal, _fireResults, _fireFx, _systemOf).
 */
import * as THREE from 'three';
import { faceNormals } from '../../core/face-reader.js';
import { readFace, readResult, combineD100 } from '../../core/physical-read.js';
import { resultOf } from '../../core/dice-shapes.js';
import { computeReaders } from '../../physics/readers.js';
import { FLOATS_PER_DIE } from '../../physics/protocol.js';

/** R3: a hand-read d16 lights the face that counts (two numbers are up) this long after landing. */
export const RESULT_GLOW_MS = 600;

let readers = null; // computeReaders(), once per page

/**
 * Playback's reader for free dice (its `read` option), on the final frame at `offset` of `data`:
 * physics decides, so the face that landed counts (after the worker's nudges it stands). Sets
 * die.readFace, die.readValue and die.value (its Foundry result; a d100's ones die carries the
 * combined d100, a ghost no value), and the inner rotation to identity.
 */
export function readFree(dice, data, offset) {
  dice.forEach((die, d) => {
    if (!die.free) return;
    const o = offset + d * FLOATS_PER_DIE;
    const q = { x: data[o + 3], y: data[o + 4], z: data[o + 5], w: data[o + 6] };
    die.readFace = readFace(die.shape, q);
    die.readValue = readResult(die.shape, q, die.variant);
    die.inner.quaternion.identity();
  });
  dice.forEach((die, d) => {
    const t = dice[d - 1]; // a d100's ones die follows its tens die
    if (die.free && !die.ghost) {
      die.value =
        t?.free && t.variant === 'd100tens'
          ? combineD100(t.readValue, die.readValue)
          : die.readValue;
    }
  });
}

/**
 * Attaches the hand hooks to `box` (once) and sends computeReaders() to its physics worker, ahead
 * of any free throw (the worker handles messages in order). Returns box.hand.
 */
export function handFor(box) {
  if (!box.hand) {
    box.hand = boxHand(box);
    box._physics.setReaders?.((readers ??= computeReaders()));
  }
  return box.hand;
}

/**
 * A roll's values in spec order: a free die's read result (a ghost's too: only this screen draws
 * it as one), a forced die's own; a d100 in its ones-die slot, its tens slot null.
 */
function valuesOf(roll) {
  const v = (d) => (d.free ? d.readValue : d.value);
  return roll.dice.map((d, i) => {
    const t = roll.dice[i - 1];
    if (d.variant === 'd100tens') return null;
    return t?.variant === 'd100tens' ? combineD100(v(t), v(d)) : v(d);
  });
}

/** The hooks DiceBox calls: read (Playback's free-dice reader), land, values, record, decorate, hold. */
function boxHand(box) {
  return {
    read: readFree,

    /**
     * At landing: the values in spec order (a free die's read result, a forced die's own; a d100
     * in its ones-die slot, its tens slot null), and the d16 result glow (roll.glows).
     */
    land(roll, now) {
      const meshes = roll.dice
        .filter((d) => d.free && !d.ghost && d.shapeType === 'd16')
        .map(glowMesh);
      if (meshes.length) roll.glows = (t) => glowAt(meshes, (t - now) / RESULT_GLOW_MS);
      return valuesOf(roll);
    },

    /** The values land() returns, without its glow: DiceBox's early `read` at physics done. */
    values: valuesOf,

    /** Builds a free throw's recording at physics done and hands it to `record` (DiceBox.roll). */
    record(record, roll, req, res) {
      if (!roll.playback) return;
      try {
        record({
          chunks: roll.playback.release(),
          events: Float32Array.from(roll.playback.events().flat()),
          settledStep: res?.settledStep,
          nudges: res?.nudges,
          dice: roll.dice.map((d) => ({ shapeType: d.shapeType, key: d.key })),
          area: { ...roll.record.area },
          obstacles: (req.obstacles ?? []).map((o, i) => ({ id: roll.ids[i], ...o })),
          splatSpeed: req.splatSpeed ?? null,
          edge: roll.edge, // the replay's pet edge (R10)
          hand: roll.free,
        });
      } catch (err) {
        console.warn('dicer: a throw recorder threw', err);
      }
    },

    /** DiceBox.decorateLanded's body (H-9): by key, else by index; never a ghost; once. */
    decorate(roll, specs) {
      if (roll?.phase !== 'lingering' || roll.removed || roll.decorated) return false;
      roll.decorated = true;
      const byKey = new Map((specs ?? []).map((s) => [s?.key, s]));
      roll.dice.forEach((die, i) => {
        const s = die.key ? byKey.get(die.key) : specs?.[i];
        if (!s || die.ghost) return;
        // As DiceBox #makeDie: a d100 plays its fx once, on its ones die.
        if (s.variant !== 'd100tens' && s.fx?.length) die.fx = s.fx;
        die.damageType = s.damageType ?? die.damageType;
        die.dsnType = s.dsnType ?? die.dsnType;
        if (s.value != null) die.value = resultOf(s.value, s.variant);
        if (!die.system && typeof s.system === 'string') {
          die.systemInstance = box._systemOf((die.system = s.system));
        }
      });
      box._reveal(roll); // spawns the dice that just got a system
      box._fireResults(roll);
      box._fireFx(roll);
      return true;
    },

    /** DiceBox.hold's body. Release and drop act once: a second call does nothing more. */
    hold(specs, { area } = {}) {
      if (box._hold) box._finish(box._hold);
      const roll = box._newRoll(specs ?? []);
      if (!roll.removed) box._hold = roll;
      let out = false; // released or dropped
      return {
        ready: roll.assets.then(() => {
          if (box._hold !== roll) return;
          box._reveal(roll);
          box.wake();
        }),
        setPose: (i, p, q) => {
          const o = roll.dice[i]?.outer;
          o?.position.copy(p);
          o?.quaternion.copy(q);
        },
        release: (options) => {
          if (out) return roll.result;
          out = true;
          return box._throw(roll, { area, ...options });
        },
        drop: () => {
          if (!out) box._finish(roll);
          out = true;
        },
      };
    },
  };
}

/** R3: a glow on the face a hand-read d16 counts (its paired top kite), just above it. */
function glowMesh(die) {
  const { shape, readFace: i } = die;
  const f = shape.faces[i];
  const n = faceNormals(shape)[i];
  const c = [0, 1, 2].map((k) => f.reduce((s, v) => s + shape.vertices[v][k], 0) / f.length);
  // The face shrunk towards its centre (clear of the rounded edges), just above it.
  const pos = f.flatMap((v) =>
    shape.vertices[v].map((p, k) => c[k] + (p - c[k]) * 0.8 + [n.x, n.y, n.z][k] * 0.01),
  );
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(f.slice(2).flatMap((_, k) => [0, k + 1, k + 2]));
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff0b0,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  die.outer.add(mesh); // the hull's frame: a model's own rotation does not apply
  return mesh;
}

/** Fades the glows at `t` (0..1 of RESULT_GLOW_MS); at 1 or past, removes them: true. */
function glowAt(meshes, t) {
  if (t < 1) {
    for (const m of meshes) m.material.opacity = 0.8 * (1 - t);
    return false;
  }
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
    m.material.dispose();
  }
  return true;
}
