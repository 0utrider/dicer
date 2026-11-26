/**
 * What a pet wears (api.registerPetAccessory): one model per slot, hung on the pet's own `head`
 * bone so it follows the animation (a code-built pet has none: it goes on the body). Placed from the
 * pet's standing box: over the head, its base just under the top, sized by the pet's height.
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

/** Hangs a copy of `template` on `creature` (kind `kind`); returns what undress() frees. */
export function wear(creature, template, accessory, kind) {
  const own = accessory.kinds?.[kind] ?? {};
  const scale = num(own.scale, accessory.scale);
  const offset = own.offset ?? accessory.offset;
  const root = creature.root;
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const head = root.getObjectByName('head');
  const at = head ? head.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());

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

  const h = creature.height;
  const width = Math.max(size.x, size.z) || 1;
  holder.scale.setScalar((WIDTH * h * scale) / width);
  root.getWorldQuaternion(holder.quaternion);
  const shift = new THREE.Vector3(num(offset?.x, 0), num(offset?.y, 0), num(offset?.z, 0))
    .multiplyScalar(h)
    .applyQuaternion(holder.quaternion);
  holder.position.set(at.x, box.max.y - SINK * h, at.z).add(shift);
  holder.updateMatrixWorld(true);
  (head ?? root).attach(holder); // keeps that place, and follows the bone from now on
  return { holder, materials };
}

/** Takes off what wear() put on. The geometry and textures belong to the template and stay. */
export function undress(worn) {
  for (const { holder, materials } of worn ?? []) {
    holder.removeFromParent();
    for (const m of materials) m.dispose();
  }
}
