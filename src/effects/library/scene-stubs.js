import * as THREE from 'three';
import { borrowDie } from './borrow.js';
import { glint } from './die-effects.js';
import { unswallow } from './scene-flight.js';
import { SCENE_CATALOG, sceneText } from './scene-catalog.js';

/**
 * Crit scenes as library effects: each id here is a small stand-in that borrows its landed die
 * (borrow.js: the hide timer waits) and plays the scene from the lazy `scenes` chunk
 * (src/scenes/scenes.js), loaded the first time any scene plays. Being plain effect ids, scenes
 * are picked like any effect: a theme's natural 20 / natural 1 rule, a trigger rule, an actor's
 * theme, and they reach other players as effects do (showOthersEffects).
 *
 * A scene module: { id, duration, play(ctx) -> { update(nowMs) -> boolean, stop() } }, ctx below.
 */

/** How long a die waits for the scenes chunk before the scene is skipped (the die is restored). */
export const LOAD_WAIT_MS = 1500;

let load = () => import('../../scenes/scenes.js');
let loading = null;
let loaded = null; // the chunk once in (the mid-roll catch needs it at once, scene-flight.js)
let warned = false;
const warnOnce = (msg, err) => {
  if (warned) return;
  warned = true;
  console.warn(`dicer: ${msg}`, err);
};

/** The scenes chunk, imported once; null (warned once) when it cannot load. */
export function loadScenes() {
  loading ??= load().then(
    (mod) => (loaded = mod),
    (err) => {
      warnOnce('cannot load the crit scenes', err);
      return null;
    },
  );
  return loading;
}

/** The scenes chunk if it is already in, else null (never loads it). */
export const sceneLoaded = () => loaded;

/** Tests: replace the chunk import (and forget a cached one). */
export function _setSceneImport(fn) {
  load = fn;
  loading = null;
  loaded = null;
  warned = false;
}

/** The reduced form: reduced motion or the lowest effect budget (bursts.js reducedOf). */
const reducedOf = (ctx) => !!ctx.reducedMotion || (ctx.tier?.effectBudget ?? Infinity) <= 2;

/** What a scene's play() gets: the effect ctx plus the borrowed die and where it rests. */
function sceneCtx(ctx, borrow) {
  const die = ctx.die;
  return {
    scene: ctx.scene,
    camera: ctx.camera,
    die,
    anchor: (borrow.rest?.position ?? ctx.position).clone(),
    restQuat: borrow.rest?.quaternion?.clone() ?? die?.outer?.quaternion?.clone(),
    radius: die?.geometry?.boundingSphere?.radius ?? 0.9,
    color: ctx.color,
    intensity: ctx.intensity,
    reduced: reducedOf(ctx),
    tier: ctx.tier,
    get particles() {
      return ctx.particles;
    },
    shake: ctx.shake,
    borrow,
    // the rule's own title card text (its effect's sceneText), else the scene's own
    cardText: sceneText(ctx.options?.sceneText),
    // a glint on the die (the die effects' own, no import across chunks)
    glint: () => {
      try {
        return glint.start({ ...ctx, duration: glint.defaults.duration, intensity: 1 });
      } catch {
        return null;
      }
    },
    /**
     * Starts a library effect (light-burst, shockwave, embers, lightning...) at `at` (a Vector3;
     * default the die's rest), the same polished pieces the dice effects use. null for an unknown
     * id or a library not yet in. The stand-in advances and stops it with the scene.
     */
    effect: (id, { at, color, intensity = 1, duration } = {}) => {
      const mod = library?.[id];
      if (!mod || isSceneId(id)) return null;
      try {
        const d = mod.defaults ?? {};
        return mod.start({
          ...ctx,
          position: (at ?? borrow.rest?.position ?? ctx.position).clone(),
          color: new THREE.Color(color ?? d.color ?? '#ffffff'),
          intensity,
          duration: duration ?? d.duration ?? 800,
          options: {},
          isolate: () => null, // never the die's own material: the scene owns the die
        });
      } catch {
        return null;
      }
    },
  };
}

let library = null; // the effects library (index.js sets it once EFFECTS is built: no import cycle)
/** index.js: the library effects a scene may start (sceneCtx.effect). */
export const setSceneLibrary = (lib) => {
  library = lib;
};

function stub(id, duration) {
  return Object.freeze({
    id,
    cost: 2,
    bindsDie: true, // releaseDie (the roll cleared or finished) stops it: the die is restored
    defaults: Object.freeze({ color: '#8a5cff', intensity: 1, duration }),
    start(ctx) {
      // Caught mid-roll (scene-flight.js): shown again as it was for the borrow, then hidden by
      // the borrow at once: the scene spits it back out. Not borrowable: it simply shows again.
      // Started mid-roll as an intro (the die stayed in sight): it plays on from its climax.
      const caught = ctx.die?.swallow ?? null;
      const swallowed = !!caught && !caught.ride;
      const introduced = !!caught?.ride;
      // what the intro leaves the scene (e.g. where its banana peel ended up), read before it goes
      let handoff = null;
      try {
        handoff = caught?.visual?.handoff?.() ?? null;
      } catch {
        /* nothing handed over */
      }
      if (caught) unswallow(ctx.die);
      const borrow = borrowDie(ctx.box, ctx.die);
      if (swallowed && borrow.moving) borrow.hide(true);
      let run = null;
      let gone = false;
      let t0 = null;
      const extra = []; // handles the scene started for itself (a glint)
      const finish = () => {
        if (gone) return;
        gone = true;
        try {
          run?.stop();
        } catch (err) {
          warnOnce(`the crit scene ${id} failed to stop`, err);
        }
        for (const h of extra) h?.stop?.();
        borrow.restore();
      };
      loadScenes().then((mod) => {
        if (gone) return;
        const scene = mod?.SCENES?.[id];
        if (!scene) return finish();
        try {
          const c = sceneCtx(ctx, borrow);
          c.swallowed = swallowed && borrow.moving;
          c.introduced = introduced && borrow.moving;
          c.handoff = c.introduced ? handoff : null;
          // what the scene starts for itself (a glint, library effects) runs and stops with it
          const track = (fn) => (...a) => {
            const h = fn(...a);
            if (h) extra.push(h);
            return h;
          };
          c.glint = track(c.glint);
          c.effect = track(c.effect);
          run = scene.play(c);
        } catch (err) {
          warnOnce(`the crit scene ${id} failed to start`, err);
          finish();
        }
      });
      return {
        update(now) {
          if (gone) return false;
          t0 ??= now;
          if (!run) {
            if (now - t0 <= LOAD_WAIT_MS) return true;
            finish();
            return false;
          }
          let more = false;
          try {
            more = run.update(now);
          } catch (err) {
            warnOnce(`the crit scene ${id} failed`, err);
          }
          for (let i = extra.length - 1; i >= 0; i--) if (!extra[i].update(now)) extra.splice(i, 1);
          if (!more && !extra.length) finish();
          return !gone;
        },
        stop: finish,
      };
    },
  });
}

/** One stand-in effect per catalogued scene (scene-catalog.js). */
export const SCENE_STUBS = Object.freeze(Object.fromEntries(SCENE_CATALOG.map((s) => [s.id, stub(s.id, s.duration)])));

/** A crit scene effect id (withBursts leaves the automatic burst out: the scene is the show). */
export const isSceneId = (id) => typeof id === 'string' && id.startsWith('scene-');

/**
 * The scene an Fx plays, or null: its effect is the scene (`{id: 'scene-meteor'}`), or carries one
 * beside an effect (`{id: 'sparkles', scene: 'scene-meteor'}`: a rule with both, the trigger and
 * theme editors' separate Scene picker; normalizeEffect keeps the extra key as it is).
 */
export function sceneOf(f) {
  const e = f?.effect;
  if (isSceneId(e?.id)) return e.id;
  return isSceneId(e?.scene) ? e.scene : null;
}

/**
 * A die's Fx list with each rule's scene played as its own effect next to the rule's effect (once:
 * one scene per die, the first rule's). The list itself when no rule carries a scene beside an effect.
 */
export function expandScenes(list) {
  if (!Array.isArray(list) || !list.some((f) => !isSceneId(f?.effect?.id) && isSceneId(f?.effect?.scene))) return list;
  const out = [];
  let scene = list.some((f) => isSceneId(f?.effect?.id));
  for (const f of list) {
    out.push(f);
    const id = f?.effect?.scene;
    if (!scene && !isSceneId(f?.effect?.id) && isSceneId(id)) {
      scene = true;
      const text = f.effect.sceneText;
      out.push({ ruleId: f.ruleId, effect: text ? { id, sceneText: text } : { id }, sound: null, macro: null, value: f.value, type: f.type });
    }
  }
  return out;
}
