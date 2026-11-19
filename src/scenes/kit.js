// The crit scenes' shared kit: the staging every scene needs (where the die rests, which way the
// table's centre is, a root group, materials and simple shapes freed together), moving the
// borrowed die (pose, hide, home), and the standard update/stop handle (full form, reduced form,
// the die always home and everything freed at the end). A scene is then its art and its timing.
//
// Conventions (src/scenes/*.js):
// - The camera looks straight down: height reads as size. Units are die units (a d20's radius ~0.9).
// - Deterministic: no Math.random (every player sees the same show); vary by the die's rest, if at all.
// - The die is only ever drawn elsewhere (ctx.borrow): its result never changes. It must end home.
// - A scene module: { id, name, outcome, duration, play(ctx) -> handle, swallow?(env) -> catcher }.
import * as THREE from 'three';
import { createKit, clamp01, span, smooth, easeOut, easeIn, outBack, bump, lerp } from './ease.js';
import { makeGlow, makeRibbon } from './vfx.js';
import { showCard, withText } from './card.js';

export { createKit, clamp01, span, smooth, easeOut, easeIn, outBack, bump, lerp };
export const TAU = Math.PI * 2;
/**
 * The particle pool's kinds and shapes (effects/library/particles.js KIND, shapes.js SHAPE), as
 * numbers: importing them would share a module with the effects chunk (a chunk of its own, counted
 * at world start). tests/unit/scenes-vfx.test.js keeps these equal to the library's.
 */
export const KIND = Object.freeze({ SPARK: 0, EMBER: 1, SMOKE: 2, SHARD: 3, SPIRAL: 4, GLINT: 5, STREAK: 6, FLAKE: 7 });
export const SHAPE = Object.freeze({ DOT: 0, STREAK: 1, SMOKE: 2, GLINT: 3, SHARD: 4, FLAME: 5, FLAKE: 6, RING: 7 });
const UP = new THREE.Vector3(0, 1, 0);
const GROUND_Y = 0.012; // flat shapes just above the table (the blob shadows are at 0.01)

/** A point `k` (0..1) of the way from `from` to `to`, `height` higher at the middle (a hop). */
export function arc(from, to, k, height, out = new THREE.Vector3()) {
  out.lerpVectors(from, to, k);
  out.y += height * Math.sin(Math.PI * clamp01(k));
  return out;
}

/** The materials, meshes and shapes of one scene (or one catch), all freed by dispose(). */
function shapes(kit, root) {
  const mat = (color, { basic = false, opacity = 1, emissive = null, side = THREE.FrontSide, depthWrite = true, additive = false } = {}) =>
    kit.add(
      basic
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side, depthWrite, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
        : new THREE.MeshStandardMaterial({ color, transparent: true, opacity, side, depthWrite, roughness: 0.8, metalness: 0.1, ...(emissive ? { emissive, emissiveIntensity: 1 } : {}) }),
    );
  const add = (mesh, parent = root) => (parent.add(mesh), mesh);
  const geo = (g) => kit.add(g);
  const flat = (mesh) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = GROUND_Y;
    return mesh;
  };
  return {
    mat,
    add,
    geo,
    /** A flat disc of radius 1 on the table (scale it), e.g. a pool, a crater, a shadow. */
    disc: (color, opacity = 0.8) => add(flat(new THREE.Mesh(geo(new THREE.CircleGeometry(1, 40)), mat(color, { basic: true, opacity, depthWrite: false })))),
    /** A flat ring of outer radius 1 on the table. */
    ring: (color, inner = 0.82, opacity = 0.8) =>
      add(flat(new THREE.Mesh(geo(new THREE.RingGeometry(inner, 1, 48)), mat(color, { basic: true, opacity, depthWrite: false, side: THREE.DoubleSide })))),
    /** A sphere of radius 1 (puffs, glows, heads). */
    ball: (color, opacity = 1, basic = false) => add(new THREE.Mesh(geo(new THREE.SphereGeometry(1, 18, 14)), mat(color, { basic, opacity, depthWrite: !basic }))),
  };
}

/**
 * The shared setup of a scene's play(ctx) (scenes import three themselves: handing the namespace
 * around would keep all of it in the chunk). Returns the stage `s`:
 * - s.r (die radius), s.rest (its rest centre, Vector3), s.restQ, s.ground (rest at y 0)
 * - s.toward: unit vector on the table from the die toward the table's centre (stay on the table)
 * - s.side: unit vector on the table at right angles to toward
 * - s.beside(dist, dir = s.toward): a ground point `dist` from the die
 * - s.root: a Group in the scene; s.kit; s.mat / s.add / s.geo / s.disc / s.ring / s.ball (shapes)
 * - s.die: pose(pos, turns = 0) draws the die at pos, its rest turned `turns` times about the vertical;
 *   hide(on); home() puts it back exactly at rest and shown; s.die.shown
 * - s.glint() (a die glint), s.shake(amount, ms)
 * - s.card(spec): the title card (ctx.cardText, a rule's own two lines, replaces its lines' text)
 * - s.reduced: the calm form must play (reduced motion, low tier, or the die cannot be moved)
 * - s.swallowed: the die arrives hidden (caught mid-roll by this scene's swallow): show it when it returns
 * - s.introduced: the scene's intro already played mid-roll (runScene then starts at def.introSkip)
 * - s.handoff: what that intro handed over (its def.handoff(c) result), else null
 * - s.dispose(): removes the root and frees everything (runScene does it)
 */
export function stage(ctx) {
  const kit = createKit();
  const root = new THREE.Group();
  ctx.scene.add(root);
  const r = ctx.radius || 0.9;
  const rest = ctx.anchor.clone();
  const restQ = (ctx.restQuat ?? new THREE.Quaternion()).clone();
  const toward = new THREE.Vector3(-rest.x, 0, -rest.z);
  if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
  toward.normalize();
  const side = new THREE.Vector3(toward.z, 0, -toward.x);
  const borrow = ctx.borrow ?? { moving: false, pose() {}, hide() {} };
  const reduced = !!ctx.reduced || !borrow.moving;
  const swallowed = !reduced && !!ctx.swallowed;
  const introduced = !reduced && !swallowed && !!ctx.introduced;
  const handoff = introduced ? (ctx.handoff ?? null) : null;
  const q = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  const die = {
    shown: !swallowed,
    pose(pos, turns = 0) {
      if (reduced) return;
      yaw.setFromAxisAngle(UP, turns * TAU);
      q.copy(restQ).premultiply(yaw);
      borrow.pose(pos, q);
    },
    hide(on) {
      if (reduced || die.shown === !on) return;
      die.shown = !on;
      borrow.hide(on);
    },
    home() {
      if (reduced) return;
      borrow.pose(rest, restQ);
      die.hide(false);
    },
  };
  let gone = false;
  let cardShown = null; // the title card, once shown
  return {
    r,
    rest,
    restQ,
    ground: rest.clone().setY(0),
    toward,
    side,
    beside: (dist, dir = toward) => rest.clone().addScaledVector(dir, dist).setY(0),
    root,
    kit,
    ...shapes(kit, root),
    die,
    glint: () => ctx.glint?.(),
    shake: (a, ms) => ctx.shake?.(a, ms),
    // --- light and particles (vfx.js; the dice effects' own pool and library) ---
    /** A flat soft light (radius 1; .set(opacity, radius, x, y, z)); opts {core, ring, width}. */
    glow: (color, opts) => makeGlow(kit, root, color, opts),
    /** A tapering ribbon of light following a point (.push(p) per frame, .opacity(v)). */
    ribbon: (opts) => makeRibbon(kit, root, opts),
    /** Particles from the shared GPU pool (effects/library/particles.js emit spec); none in tests. */
    emit: (spec) => ctx.particles?.emit?.(spec),
    /** A library effect (light-burst, shockwave, embers...) at `at`; it runs on with the scene. */
    effect: (id, opts) => ctx.effect?.(id, opts) ?? null,
    /**
     * The scene's title card (card.js): shown once, at the scene's climax; it plays on by itself
     * past the scene's end, and goes with it only when the scene is stopped early.
     */
    card(spec) {
      if (cardShown) return cardShown;
      cardShown = showCard(withText(spec, ctx.cardText), { reduced, host: ctx.cardHost, who: ctx.who });
      return cardShown;
    },
    reduced,
    swallowed,
    introduced,
    handoff,
    dispose(early = false) {
      if (gone) return;
      gone = true;
      if (early) cardShown?.stop();
      ctx.scene.remove(root);
      kit.dispose();
    },
  };
}

/** The default calm form: a soft ring under the die and a glint; the die never moves. */
function defaultCalm(t, s, total) {
  if (!s.calmRing) {
    s.calmRing = s.ring('#ffffff', 0.86, 0);
    s.calmRing.position.set(s.rest.x, 0.013, s.rest.z);
  }
  const k = clamp01(t / total);
  s.calmRing.scale.setScalar(s.r * lerp(0.6, 1.6, easeOut(k)));
  s.calmRing.material.opacity = 0.6 * bump(k);
  if (t >= total * 0.35 && !s.calmGlint) ((s.calmGlint = true), s.glint());
}

/**
 * The standard scene handle. `def`:
 * - duration (ms, the full form), reducedDuration (ms, default 1600)
 * - setup(s): builds the art once (optional)
 * - full(t, s): one frame of the full form at t ms (move the die with s.die)
 * - calm(t, s): one frame of the reduced form (the die must not move); default: a ring and a glint
 * - introSkip (ms): after its mid-roll intro (s.introduced) the full form starts this far in (its
 *   lead-in already shown while the die rolled), so the climax lands soon after the die does
 * At the end the die is home and everything is freed; a throwing frame ends the scene the same way.
 */
export function runScene(ctx, def) {
  const s = stage(ctx);
  const total = s.reduced ? (def.reducedDuration ?? 1600) : def.duration;
  const skip = s.introduced ? Math.max(0, Math.min(def.introSkip ?? 0, total - 1)) : 0;
  let t0 = null;
  let done = false;
  const finish = (early = false) => {
    if (done) return;
    done = true;
    try {
      s.die.home();
    } finally {
      s.dispose(early);
    }
  };
  try {
    def.setup?.(s);
  } catch (err) {
    finish();
    throw err;
  }
  return {
    update(now) {
      if (done) return false;
      t0 ??= now;
      const t = now - t0 + skip;
      if (t >= total) {
        finish();
        return false;
      }
      try {
        if (s.reduced) (def.calm ?? ((tt, ss) => defaultCalm(tt, ss, total)))(t, s);
        else def.full(t, s);
      } catch (err) {
        finish();
        throw err;
      }
      return true;
    },
    stop: () => finish(true),
  };
}

/**
 * The standard mid-roll catch (a scene's swallow(env), effects/library/scene-flight.js). `def`:
 * - grab (ms): when the die vanishes (swallowed() turns true), default 260
 * - setup(c): builds the art once; c.root follows the die on the table (x, z) every frame
 * - frame(t, c, diePos): one frame at t ms since the catch began (diePos: the live die centre)
 * c has the shape helpers (c.mat / c.disc / c.ring / c.ball / c.add / c.geo, in c.root), c.r,
 * c.root, and light: c.glow (in c.root, relative to the die), c.ribbon (world space, push diePos)
 * and c.emit (pool particles, world space).
 */
export function runSwallow({ scene, die, radius, particles, path = null }, def) {
  const kit = createKit();
  const root = new THREE.Group();
  const world = new THREE.Group(); // stays put: ribbons push world points
  scene?.add(root, world);
  const c = {
    r: radius || 0.9,
    root,
    world,
    /** The die's simulated path (scene-flight.js pathOf: now(), last, at(f), msTo(f)), or null. */
    path,
    kit,
    ...shapes(kit, root),
    /** A soft light in c.root, which follows the die on the table: place it relative to the die (x, z). */
    glow: (color, opts) => makeGlow(kit, root, color, opts),
    /** A ribbon in world space (push the die's world position, the frame's diePos). */
    ribbon: (opts) => makeRibbon(kit, world, opts),
    /** Particles from the shared pool, in world space (none in tests). */
    emit: (spec) => particles?.emit?.(spec),
  };
  const grab = def.grab ?? 260;
  let t0 = null;
  let caught = false;
  let gone = false;
  def.setup?.(c);
  return {
    update(now) {
      if (gone) return false;
      t0 ??= now;
      const t = now - t0;
      const p = die.outer.position;
      root.position.set(p.x, 0, p.z);
      if (t >= grab) caught = true;
      def.frame?.(t, c, p);
      return true;
    },
    /** True from `grab` ms on: the die is gone from sight (scene-flight.js hides it). */
    swallowed: () => caught,
    /** What the scene's play gets as s.handoff at landing (def.handoff(c)), or null. */
    handoff: () => def.handoff?.(c) ?? null,
    dispose() {
      if (gone) return;
      gone = true;
      scene?.remove(root, world);
      kit.dispose();
    },
  };
}

/**
 * The standard mid-roll intro (a scene's intro(env), effects/library/scene-flight.js): its lead-in
 * while the die still tumbles, riding along with it (never hidden). Same def and helpers as
 * runSwallow but without a grab; frame(t, c, diePos) runs until the die lands and the scene takes
 * over (play then starts at its introSkip).
 */
export function runIntro(env, def) {
  return runSwallow(env, { ...def, grab: Infinity });
}
