import * as THREE from 'three';
import { createTrailFx as createTrails } from './trails.js';
import { loadScenes, sceneLoaded, sceneOf } from './scene-stubs.js';

/**
 * Crit scenes start mid-roll. While a die whose effects hold a scene tumbles, it is followed; once
 * it has been thrown and starts to slow (before anyone can read it), the scene's mid-roll visual
 * starts on it:
 * - swallow(env) (e.g. the Shadow Thief) catches the die: from its swallowed() on the die is hidden.
 *   Physics carries on unseen and the result never changes; at landing the scene spits it back out.
 * - intro(env) (every other scene) is its lead-in, riding along with the still-visible die; at
 *   landing the scene plays on from its climax (ctx.introduced, kit.js runScene introSkip).
 * Either way the scene's stand-in finds die.swallow at landing and takes over (scene-stubs.js).
 * env = { scene, die, radius, particles, path }: the three scene, the tumbling die, its radius, the
 * pool, and its path (pathOf below; null when unknown): the throw is simulated before it is shown,
 * so a scene can put something where the die WILL be (a banana peel in its way).
 *
 * Rides on the trail emitter's per-frame flight hook (the effect layer calls it for every playing
 * roll), so no world-start code knows about it. Nothing here throws into the render loop.
 */

// Speeds in die units per second, times in ms (as the trails track them).
export const CATCH = Object.freeze({ minFlight: 700, fast: 9, slow: 4.5 });
/**
 * An intro hides nothing, so it starts early: once the die has been thrown (it flew fast) and has
 * flown this long. Not by speed: a thrown die stays fast (falling, bouncing) until its last hop.
 */
export const INTRO = Object.freeze({ minFlight: 250 });
/** A swallowed die nobody claimed (its scene was dropped) comes back this long after its last flight frame. */
export const UNCLAIMED_MS = 1500;

const AWAY = new THREE.Vector3(0, -1000, 0);
/** The scene the die's effects play (its effect, or a scene beside it), or null. */
const sceneFx = (die) => die?.fx?.map?.(sceneOf).find(Boolean) ?? null;
const tracks = new WeakMap(); // die -> { t0, x, y, z, t, peak }
const live = new Set(); // swallowed dice

/** Shows a swallowed die again exactly as it was and frees its swallow visual. */
export function unswallow(die) {
  const s = die?.swallow;
  if (!s) return;
  die.swallow = null;
  live.delete(die);
  clearTimeout(s.timer);
  die.outer.visible = s.visible;
  if (die.shadow) die.shadow.follow = s.follow;
  if (die.shadow?.pool) die.shadow.pool.follow = s.poolFollow;
  try {
    s.visual?.dispose?.();
  } catch {
    /* a visual that cannot free itself: nothing more to do */
  }
}

/**
 * A die's simulated path in its roll's playback (throw/playback.js), or null before it is known:
 * - now(): the frame being drawn (fractional); last: the settled frame
 * - at(f, out): the die centre at frame f (Vector3)
 * - msTo(f): playback ms from now until frame f (at the normal speed)
 */
export function pathOf(playback, die) {
  const d = playback?.dice?.indexOf?.(die) ?? -1;
  if (d < 0 || !playback.resultsApplied || !(playback.frames > 0)) return null;
  const last = playback.frames - 1;
  return {
    last,
    now: () => playback._playhead ?? 0,
    at(f, out = new THREE.Vector3()) {
      const i = Math.max(0, Math.min(last, Math.round(f)));
      const [data, offset] = playback._locate(i);
      const o = offset + d * 7;
      return out.set(data[o], data[o + 1], data[o + 2]);
    },
    msTo: (f) => (Math.max(0, f - (playback._playhead ?? 0)) * 1000) / 60 / (playback.speed || 1),
  };
}

function swallow(die, sceneId, scene, now, deps, playback) {
  const ride = typeof scene.swallow !== 'function'; // an intro: the die stays in sight
  let path = null;
  try {
    path = pathOf(playback, die);
  } catch {
    /* no path: the scene does without */
  }
  const env = { scene: die.outer.parent, die, radius: die.geometry?.boundingSphere?.radius ?? 0.9, particles: deps?.getPool?.() ?? null, path };
  const visual = (ride ? scene.intro : scene.swallow)(env);
  const shadow = die.shadow ?? null;
  const s = { visual, visible: die.outer.visible, follow: shadow?.follow, poolFollow: shadow?.pool?.follow, timer: 0, hidden: false, at: now, sceneId, ride };
  die.swallow = s;
  live.add(die);
  return s;
}

function hide(die) {
  const s = die.swallow;
  if (s.hidden) return;
  s.hidden = true;
  die.outer.visible = false;
  const stub = { position: AWAY, geometry: die.geometry };
  if (die.shadow) die.shadow.follow = stub;
  if (die.shadow?.pool) die.shadow.pool.follow = stub;
}

/**
 * Per flight frame: follows the scene dice, catches them, drives their swallow visuals.
 * @param {object[]} dice the playing roll's dice
 * @param {number} now ms
 * @param {{getTier?: () => object, reducedMotion?: () => boolean}} deps
 */
export function sceneFlight(dice, now, deps = {}, playback = null) {
  const { getTier, reducedMotion } = deps;
  if (!dice?.length) return;
  for (const die of dice) {
    const fx = sceneFx(die);
    if (!fx || die.ghost || !die.outer) continue;
    if (die.swallow) {
      const s = die.swallow;
      // still flying: re-arm the safety net, keep the visual on the (unseen) die
      clearTimeout(s.timer);
      s.timer = setTimeout(() => unswallow(die), UNCLAIMED_MS);
      let more = true;
      try {
        more = s.visual.update(now);
      } catch {
        more = false;
      }
      if (s.ride) continue; // an intro never hides its die
      if (s.visual.swallowed?.()) hide(die);
      if (!more) hide(die);
      continue;
    }
    const mod = sceneLoaded();
    if (!mod) {
      loadScenes(); // the next throw catches; this one plays the landing form
      continue;
    }
    const scene = mod.SCENES?.[fx];
    if (typeof scene?.swallow !== 'function' && typeof scene?.intro !== 'function') continue;
    if (reducedMotion?.() === true || Number(getTier?.()?.effectBudget) <= 2) continue;
    if (die.outer.visible === false) continue; // not revealed yet
    const p = die.outer.position;
    let tr = tracks.get(die);
    if (!tr) {
      tracks.set(die, (tr = { t0: now, x: p.x, y: p.y, z: p.z, t: now, peak: 0, done: false }));
      continue;
    }
    if (tr.done) continue;
    const dt = (now - tr.t) / 1000;
    if (!(dt > 0)) continue;
    const speed = Math.hypot(p.x - tr.x, p.y - tr.y, p.z - tr.z) / dt;
    tr.x = p.x;
    tr.y = p.y;
    tr.z = p.z;
    tr.t = now;
    tr.peak = Math.max(tr.peak, speed);
    const ride = typeof scene.swallow !== 'function';
    const ready = ride
      ? now - tr.t0 >= INTRO.minFlight && tr.peak >= CATCH.fast
      : now - tr.t0 >= CATCH.minFlight && tr.peak >= CATCH.fast && speed < CATCH.slow;
    if (ready) {
      tr.done = true;
      try {
        swallow(die, fx, scene, now, deps, playback);
      } catch {
        /* the scene could not catch it: it plays at landing */
      }
    }
  }
}

/** Every swallowed die comes back (the effects were cleared). */
export function clearSwallows() {
  for (const die of [...live]) unswallow(die);
}

/**
 * Off: nothing shows while a die rolls. Anything that did (a catch, a lead-in) would tell everyone
 * a 1 or a 20 is coming before the die is read; crit scenes play once it has landed (owner's call,
 * 2026-11-19). The swallow/intro machinery above stays, tested, should that change.
 */
export const MID_ROLL = false;

/** The trail emitter, with the scene catch on its flight hook when MID_ROLL (the layer's createTrailFx). */
export function createTrailFx(deps) {
  const trails = createTrails(deps);
  return {
    flight(dice, now, playback) {
      trails.flight(dice, now);
      if (!MID_ROLL) return;
      try {
        sceneFlight(dice, now, deps, playback);
      } catch (err) {
        deps?.warnOnce?.('scene-flight', 'the crit scene catch failed', err);
      }
    },
    clear() {
      trails.clear();
      clearSwallows();
    },
  };
}
