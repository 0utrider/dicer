/**
 * What a pet wears (api.registerPetAccessory): one model per slot, hung on the pet's own `head`
 * bone so it follows the animation (a code-built pet has none: it goes on the body). Placed in the
 * creature's rest frame: over the head, its base just under the top, sized by the pet's height. How
 * the pet stands when it is dressed (tilted, mid-hop, shrunk) does not matter.
 */
import * as THREE from 'three';
import { PET_ACCESSORIES } from '../../api/pet-accessories.js';

/** A hat's width as a share of the pet's height, and how far its base sinks below the top. */
const WIDTH = 0.55;
const SINK = 0.08;

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** The accessory per slot for a pet of `kind`: the last registered whose `when(kind)` is not false. */
export function accessoriesFor(kind, list = PET_ACCESSORIES.values()) {
  const slots = new Map();
  for (const a of list) {
    let on = true;
    try {
      if (a.when) on = a.when(kind) !== false;
    } catch (err) {
      on = false;
      console.warn(`Dicer | pet accessory "${a.id}": its when() failed`, err);
    }
    if (on) slots.set(a.slot, a);
  }
  return [...slots.values()];
}

/**
 * The standing pet in its root's own space: the top of its box, its middle, and the head bone with
 * its transform. Measured once, so call it before the creature is first posed.
 */
export function restFrame(creature) {
  if (creature.rest) return creature.rest;
  const root = creature.root;
  root.updateMatrixWorld(true); // not updateWorldMatrix: a skinned mesh refreshes its bind matrix only here
  const toRoot = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.geometry) return;
    // a skinned mesh's box follows its bones
    const of = o.isSkinnedMesh ? o : o.geometry;
    if (o.isSkinnedMesh || !of.boundingBox) of.computeBoundingBox();
    box.union(part.copy(of.boundingBox).applyMatrix4(m.multiplyMatrices(toRoot, o.matrixWorld)));
  });
  const head = root.getObjectByName('head');
  const matrix = head ? new THREE.Matrix4().multiplyMatrices(toRoot, head.matrixWorld) : new THREE.Matrix4();
  const at = head ? new THREE.Vector3().setFromMatrixPosition(matrix) : box.getCenter(new THREE.Vector3());
  // every named bone as it stands at rest, for an accessory hung on another bone (`bone`)
  const bones = new Map();
  root.traverse((o) => {
    if (o.isBone && o.name && !bones.has(o.name)) bones.set(o.name, { o, matrix: new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld) });
  });
  return (creature.rest = { top: box.max.y, at, head, matrix, bones });
}

/** Hangs a copy of `template` on `creature` (kind `kind`); returns what undress() frees. */
export function wear(creature, template, accessory, kind) {
  const own = accessory.kinds?.[kind] ?? {};
  const scale = own.scale > 0 ? num(own.scale, accessory.scale) : accessory.scale;
  const offset = own.offset ?? accessory.offset;
  const tilt = own.tilt ?? accessory.tilt;
  const rest = restFrame(creature);
  // `bone`: hung on that bone instead of the head (the spider's abdomen), placed over it
  const other = rest.bones?.get(own.bone ?? accessory.bone ?? 'head');
  const { top } = rest;
  const head = other?.o ?? rest.head;
  const matrix = other?.matrix ?? rest.matrix;
  const at = other ? new THREE.Vector3().setFromMatrixPosition(other.matrix) : rest.at;

  const model = template.clone(true);
  const materials = [];
  // its own materials: an elemental tint on one pet must not colour the next pet's hat
  const copy = (m) => (materials.push(m.clone()), materials.at(-1));
  model.traverse((o) => {
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
  });
  const holder = new THREE.Group();
  holder.name = 'dicerAccessory';
  holder.add(model);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const middle = bounds.getCenter(new THREE.Vector3());
  model.position.x -= middle.x;
  model.position.y -= bounds.min.y; // its base on the holder's origin
  model.position.z -= middle.z;

  const h = creature.height / creature.root.scale.y; // the root carries the pet size setting
  const width = Math.max(size.x, size.z) || 1;
  holder.scale.setScalar((WIDTH * h * scale) / width);
  holder.position
    .set(num(offset?.x, 0), num(offset?.y, 0) - SINK, num(offset?.z, 0))
    .multiplyScalar(h)
    .add(new THREE.Vector3(at.x, top, at.z));
  // tilt (degrees) turns it about its base: x leans it forward (back below 0), z to the pet's right, y turns it
  const deg = (v) => THREE.MathUtils.degToRad(num(v, 0));
  holder.rotation.set(deg(tilt?.x), deg(tilt?.y), deg(tilt?.z), 'YXZ');
  // from the root's space into the head bone's, as it stands at rest
  holder.applyMatrix4(matrix.clone().invert());
  (head ?? creature.root).add(holder);
  return { holder, materials };
}

/** Takes off what wear() put on. The geometry and textures belong to the template and stay. */
export function undress(worn) {
  for (const { holder, materials } of worn ?? []) {
    holder.removeFromParent();
    for (const m of materials) m.dispose();
  }
}
