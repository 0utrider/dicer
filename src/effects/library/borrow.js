import * as THREE from 'three';

/**
 * A crit scene borrows its landed die: the roll's hide timer waits, the scene may move the die's
 * drawn transform (its outer group) and hide it (die and blob shadow), and restore() puts every
 * bit back exactly, then lets the roll linger again from now. The result is final at landing and
 * physics is done, so nothing but the drawing changes; the die's inner group keeps its face.
 *
 * Grab and toss skips borrowed dice and never restarts the timer of a roll a scene still holds
 * (roll.scenes counts them).
 */

// Where a hidden die's shadow goes: far off the table, so the blob is drawn nowhere.
const AWAY = new THREE.Vector3(0, -1000, 0);
const NOOP_BORROW = Object.freeze({ moving: false, pose() {}, hide() {}, restore() {} });

/**
 * @param {object|null} box the DiceBox (_rolls, _linger, _renderer)
 * @param {object} die a die of one of its rolls (outer, shadow)
 * @returns {{moving: boolean, rest: {position: THREE.Vector3, quaternion: THREE.Quaternion},
 *   pose(p?: THREE.Vector3, q?: THREE.Quaternion): void, hide(on: boolean): void, restore(): void}}
 *   moving false: the die cannot be borrowed (no box, not lingering): the scene must not move it.
 */
export function borrowDie(box, die) {
  const roll = box?._rolls?.find?.((r) => r?.dice?.includes?.(die));
  if (!roll || roll.removed || roll.phase !== 'lingering' || !die?.outer || die.borrowed) return NOOP_BORROW;
  clearTimeout(roll.timer);
  roll.scenes = (roll.scenes ?? 0) + 1;
  die.borrowed = true;
  const outer = die.outer;
  const rest = { position: outer.position.clone(), quaternion: outer.quaternion.clone() };
  const visible = outer.visible;
  const shadow = die.shadow ?? null;
  const follow = shadow?.follow;
  const poolFollow = shadow?.pool?.follow;
  const stub = { position: AWAY, geometry: die.geometry };
  let done = false;
  return {
    moving: true,
    rest,
    pose(p, q) {
      if (done) return;
      if (p) outer.position.copy(p);
      if (q) outer.quaternion.copy(q);
    },
    hide(on) {
      if (done) return;
      outer.visible = on ? false : visible;
      if (shadow) shadow.follow = on ? stub : follow;
      if (shadow?.pool) shadow.pool.follow = on ? stub : poolFollow;
    },
    restore() {
      if (done) return;
      done = true;
      outer.position.copy(rest.position);
      outer.quaternion.copy(rest.quaternion);
      outer.visible = visible;
      if (shadow) shadow.follow = follow;
      if (shadow?.pool) shadow.pool.follow = poolFollow;
      die.borrowed = false;
      roll.scenes = Math.max(0, (roll.scenes ?? 1) - 1);
      // the hide timer starts again once the last scene of the roll is done
      if (!roll.scenes && !roll.removed && roll.phase === 'lingering') box._linger?.(roll);
      box._renderer?.requestFrame?.();
    },
  };
}
