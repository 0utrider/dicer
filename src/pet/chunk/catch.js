// A pet catches its owner's natural 20 (dicer.pet flag `catch`): it dashes to the d20 while it
// still tumbles, gulps it before anyone can read it (the die is hidden; physics goes on unseen),
// stays with it while it rolls out, and at landing spits it back onto its rest showing the 20,
// then celebrates. Pure helpers here; pets.js drives them (begin, landed, the routine step).
import * as THREE from 'three';

/** When the d20 counts as thrown and slowing (die units per s, ms): the pet dashes in. */
export const CATCH = Object.freeze({ minFlight: 600, fast: 9, slow: 6 });
export const DASH_SPEED = 30; // die units per s
export const DASH_MS = Object.freeze([180, 420]);
export const GULP_MS = 160;
/** The spit after landing: a lean back, the die out of the mouth in an arc, settled. */
export const SPIT_MS = 600;
const SPIT_OUT = 0.25; // the die shows again at this fraction of the spit
const SPIT_LAND = 0.92; // and rests at this one
export const MOUTH_SCALE = 0.3; // the die shrinks to this as it goes in
/** Shorter dice linger (timeBeforeHide) leaves no time to spit: no catch. */
export const MIN_LINGER = 900;

const AWAY = new THREE.Vector3(0, -1000, 0);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const bump = (t) => Math.sin(Math.PI * clamp01(t));

/**
 * The die a pet may catch: its owner's d20 that lands on 20 (die.value, known from the throw),
 * not a ghost (a blind viewer never learns it), not one a crit scene (scene-*) already plays
 * with, not borrowed by anything else, and on screen.
 */
export function eligible(die) {
  return (
    !!die?.outer &&
    die.type === 'd20' &&
    die.value === 20 &&
    !die.ghost &&
    !die.borrowed &&
    die.outer.visible !== false &&
    !die.fx?.some?.((f) => String(f?.effect?.id).startsWith('scene-') || String(f?.effect?.scene).startsWith('scene-'))
  );
}

/**
 * Follows a die's speed frame by frame; true once (and every frame after) it has flown CATCH.minFlight,
 * gone CATCH.fast and now goes slower than CATCH.slow. `tracks`: a Map the caller keeps.
 */
export function slowing(tracks, die, now) {
  const p = die.outer.position;
  let tr = tracks.get(die);
  if (!tr) {
    tracks.set(die, { t0: now, x: p.x, y: p.y, z: p.z, t: now, peak: 0 });
    return false;
  }
  const dt = (now - tr.t) / 1000;
  if (!(dt > 0)) return false;
  const speed = Math.hypot(p.x - tr.x, p.y - tr.y, p.z - tr.z) / dt;
  tr.x = p.x;
  tr.y = p.y;
  tr.z = p.z;
  tr.t = now;
  tr.peak = Math.max(tr.peak, speed);
  return now - tr.t0 >= CATCH.minFlight && tr.peak >= CATCH.fast && speed < CATCH.slow;
}

/** The dash time for `dist` die units. */
export const dashMs = (dist) => Math.min(DASH_MS[1], Math.max(DASH_MS[0], (dist / DASH_SPEED) * 1000));

/** Hides the die (and its blob shadow); returns what restoreDie puts back. */
export function hideDie(die) {
  const shadow = die.shadow ?? null;
  const saved = { visible: die.outer.visible, follow: shadow?.follow, poolFollow: shadow?.pool?.follow };
  die.outer.visible = false;
  const stub = { position: AWAY, geometry: die.geometry };
  if (shadow) shadow.follow = stub;
  if (shadow?.pool) shadow.pool.follow = stub;
  return saved;
}

/** Undoes hideDie (saved may be null: nothing was hidden) and the gulp's shrink. */
export function restoreDie(die, saved) {
  die.outer.scale.setScalar(1);
  if (!saved) return;
  die.outer.visible = saved.visible;
  if (die.shadow) die.shadow.follow = saved.follow;
  if (die.shadow?.pool) die.shadow.pool.follow = saved.poolFollow;
}

/**
 * The die on its way out of the mouth at spit fraction `k`: null before it shows (still in the
 * mouth), else {position, turns} (turns about the vertical, 2 -> 0, settling on its rest face).
 */
export function spitPath(k, mouth, rest, radius, out = new THREE.Vector3()) {
  if (k < SPIT_OUT) return null;
  const f = clamp01((k - SPIT_OUT) / (SPIT_LAND - SPIT_OUT));
  out.lerpVectors(mouth, rest, easeOut(f));
  out.y = mouth.y + (rest.y - mouth.y) * f + radius * 1.4 * bump(f);
  return { position: out, turns: 2 * (1 - easeOut(f)), done: f >= 1 };
}
