/**
 * Grab and toss (lazy: emitted as grab-[hash].js; the world-start seam is ./grab-loader.js). A die
 * that has landed on this screen can be picked up with the mouse, dragged and flung. Cosmetic and
 * local only: the roll's values, chat card, results, effects and pet reactions are never fired
 * again, and each die keeps showing the face it showed (its inner rotation is re-aimed in flight).
 *
 * One window pointerdown listener (capture phase) hit-tests the lingering dice and takes the event
 * only over one, never over Foundry's UI. A toss is one physics-worker throw of every lingering die
 * (the others start where they lie: launch `rest`), played back by a Playback like any roll.
 */
import * as THREE from 'three';
import { Playback } from '../throw/playback.js';
import { readTopFace, rotationToShow } from '../core/face-reader.js';
import { cameraHeightFor } from '../render/scene.js';
import { FLOATS_PER_DIE, MAX_OBSTACLES, maySplat } from '../physics/protocol.js';
import { loadHand } from '../hand/hand-loader.js';
import { seedFrom } from '../core/rng.js';

export const CHUNK = 'dicer-grab-chunk';
/** A held die's height above the table (die units), as the throw overlay holds dice. */
export const HOLD_Y = 2.2;
/** The pointer grabs a die within this many die units of its centre (its circumradius). */
export const HIT_RADIUS = 1;
/** Horizontal toss speed cap (die units/s); prefers-reduced-motion caps it lower. */
export const MAX_TOSS_SPEED = 30;
export const REDUCED_TOSS_SPEED = 10;
/** The most dice one toss simulates (the held die always among them). */
export const MAX_TOSS_DICE = 40;
/** A toss whose physics has not finished by then is dropped (the held die is put back). */
export const TOSS_TIMEOUT_MS = 5000;
const LIFT_MS = 120; // the die rises to HOLD_Y this fast once grabbed
const BLEND_STEPS = 12; // a flying die's face is re-aimed over this many physics steps
const SAMPLE_MS = 120; // the release velocity window, as the throw overlay's (its own is used once loaded)
// The pointer over these is not over the table (pets.js UI_IDS and OFF_TABLE, plus any window).
const UI =
  '#sidebar, #chat, #chat-notifications, #ui-left, #players, #hotbar, #navigation, #ui-top, .app, .application, dialog, a, button, input, select, textarea';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A roll whose dice may be grabbed: landed and lingering (not fading, not gone). */
const grabbable = (roll) => roll?.phase === 'lingering' && !roll.removed && !roll.assetsPending;

/** Client px as die units on the table plane from the stage centre; `inside` the stage rect. Null with no stage. */
export function groundAt(box, x, y) {
  const r = box._stageRect;
  const px = box._diePx;
  if (!r || !(px > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: (x - r.left - r.width / 2) / px,
    z: (y - r.top - r.height / 2) / px,
    inside: x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height,
  };
}

/** The camera's height in die units (it looks straight down at the stage centre). */
const camHeight = (box) =>
  box._renderer?.camera?.position?.y || cameraHeightFor(box._area?.halfDepth || 5);

/**
 * The lingering die drawn under client px (x, y), nearest centre first: {roll, die, index}, or
 * null. A sphere of HIT_RADIUS around each die centre, projected through the straight-down
 * perspective camera (a raised die draws farther from the centre), so no GPU raycast is needed.
 */
export function hitDie(box, x, y) {
  const g = groundAt(box, x, y);
  if (!g?.inside) return null;
  const h = camHeight(box);
  let best = null;
  let bestD = HIT_RADIUS;
  for (const roll of box._rolls ?? []) {
    if (!grabbable(roll)) continue;
    roll.dice.forEach((die, index) => {
      const p = die.outer?.position;
      if (!p || !die.outer.visible) return;
      const s = h > p.y + 0.1 ? h / (h - p.y) : 1;
      const d = Math.hypot(g.x - p.x * s, g.z - p.z * s) / s;
      if (d <= bestD) [best, bestD] = [{ roll, die, index }, d];
    });
  }
  return best;
}

/** True when `target` is Foundry's UI (sidebar, chat, a window, a control), not the table. */
export function overUi(target) {
  try {
    return !!target?.closest?.(UI);
  } catch {
    return true;
  }
}

let current = null;

/**
 * Grab and toss on `box`: installs the window pointerdown listener and sets box.grab (DiceBox calls
 * its frame(now) every frame). The same box again returns the same controller; another box
 * replaces it. `deps` are test seams.
 */
export function grabFor(box, deps) {
  if (current?.box === box) return current;
  current?.dispose();
  return (current = createGrab(box, deps));
}

/** Removes the listener and lets go of any held or flying die (grabDice turned off). */
export function releaseGrab() {
  current?.dispose();
  current = null;
}

function createGrab(
  box,
  {
    win = globalThis.window,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    random = Math.random,
    reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    hand = () => loadHand(box), // the throw overlay's velocity, lift and spin helpers
  } = {},
) {
  const CAPTURE = { capture: true };
  let held = null; // {die, roll, id, t0, from, q, off, at, samples}
  let toss = null; // {ready, entries, player, chunks, ids, hook, h, timer}
  const paused = new Set(); // rolls whose hide timer waits for the toss
  let disposed = false;
  let warned = false;
  const warn = (err) => warned || ((warned = true), console.warn('dicer: grab and toss', err));
  const body = () => win?.document?.body;

  /** Stops every lingering roll's hide timer (a toss may knock any of them about). */
  function pause() {
    for (const r of box._rolls)
      if (grabbable(r) && !paused.has(r)) (clearTimeout(r.timer), paused.add(r));
  }
  /** Each paused roll still lingering lingers again from now (timeBeforeHide). */
  function resume() {
    for (const r of paused) if (grabbable(r)) box._linger(r);
    paused.clear();
  }

  /** The held die's ground offset scale: a die at HOLD_Y under the pointer is drawn k times as far out. */
  const holdScale = () => {
    const h = camHeight(box);
    return h > HOLD_Y ? (h - HOLD_Y) / h : 1;
  };
  function aim(x, y) {
    const g = groundAt(box, x, y);
    if (!g) return;
    const k = holdScale();
    const a = box._area;
    held.at = {
      x: clamp(g.x * k + held.off.x, 1 - a.halfWidth, a.halfWidth - 1),
      z: clamp(g.z * k + held.off.z, 1 - a.halfDepth, a.halfDepth - 1),
    };
  }

  function listen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    try {
      win?.[f]?.('pointermove', move, CAPTURE);
      win?.[f]?.('pointerup', up, CAPTURE);
      win?.[f]?.('pointercancel', cancel, CAPTURE);
      win?.[f]?.('blur', cancel);
      const b = body();
      if (b?.style) b.style.cursor = on ? 'grabbing' : '';
    } catch (err) {
      warn(err);
    }
  }

  function down(e) {
    if (disposed || held || toss || (e.button ?? 0) !== 0 || overUi(e.target)) return;
    const hit = hitDie(box, e.clientX, e.clientY);
    if (!hit) return;
    // Over a die only: Foundry's canvas never sees this press (no drag-select under the die).
    e.preventDefault?.();
    e.stopPropagation?.();
    const { die, roll } = hit;
    const p = die.outer.position;
    const g = groundAt(box, e.clientX, e.clientY);
    const k = holdScale();
    const t = now();
    held = {
      die,
      roll,
      id: e.pointerId,
      t0: t,
      from: p.clone(),
      q: die.outer.quaternion.clone(),
      off: { x: p.x - g.x * k, z: p.z - g.z * k }, // the die stays where it was under the pointer
      at: { x: p.x, z: p.z },
      samples: [{ t, x: e.clientX, y: e.clientY }],
    };
    pause();
    Promise.resolve(hand?.()).catch(() => {}); // the helpers are in by the release, usually
    listen(true);
    box.wake();
  }
  function move(e) {
    if (!held || e.pointerId !== held.id) return;
    e.stopPropagation?.();
    // No button down any more (released while the window had no focus): that was the release.
    if (e.buttons === 0 && e.pointerType !== 'touch') return up(e);
    held.samples.push({ t: now(), x: e.clientX, y: e.clientY });
    if (held.samples.length > 64) held.samples.splice(0, 32);
    aim(e.clientX, e.clientY);
  }
  function up(e) {
    if (!held || e.pointerId !== held.id) return;
    e.stopPropagation?.();
    held.samples.push({ t: now(), x: e.clientX, y: e.clientY });
    aim(e.clientX, e.clientY);
    letGo(false);
  }
  /** A cancelled pointer or a lost window: the die is let go without a flick (it drops). */
  function cancel(e) {
    if (held && (e?.type === 'blur' || e?.pointerId === held.id)) letGo(true);
  }
  function letGo(still) {
    const h = held;
    held = null;
    listen(false);
    release(h, still).catch((err) => (warn(err), abort()));
  }

  /** Throws every lingering die from where it is drawn, `h.die` flying at the pointer's flick. */
  async function release(h, still) {
    toss = { ready: false, entries: [], h }; // blocks a new grab while the helpers load
    const me = toss;
    const mod = await Promise.resolve(hand?.()).catch(() => null);
    if (disposed || toss !== me) return;
    if (!grabbable(h.roll)) return abort();
    const end = h.samples[h.samples.length - 1].t;
    const recent = h.samples.filter((s) => s.t >= end - (mod?.SAMPLE_WINDOW_MS ?? SAMPLE_MS));
    // A still hand (no recent moves) drops the die: no gentle throw as the overlay's click makes.
    const drop = still || !mod || !(recent.length > 1 && end - recent[0].t >= 1);
    let [vx, vz] = drop ? [0, 0] : mod.velocityFromSamples(recent, box._diePx);
    const reduced = reducedMotion();
    const max = reduced ? REDUCED_TOSS_SPEED : MAX_TOSS_SPEED;
    const sp = Math.hypot(vx, vz);
    if (sp > max) [vx, vz] = [(vx * max) / sp, (vz * max) / sp];
    const speed = Math.min(sp, max);
    const vy = drop ? 0 : mod.liftFromSpeed(speed);
    const spin = drop ? [0, 0, 0] : mod.spinFromShake(reduced ? 0 : speed / max, random);

    const all = [];
    for (const r of box._rolls)
      if (grabbable(r)) r.dice.forEach((die, index) => die.outer.visible && all.push({ die, roll: r, index }));
    const mine = all.find((e) => e.die === h.die);
    const entries = [mine, ...all.filter((e) => e !== mine)].slice(0, MAX_TOSS_DICE);
    const launch = entries.map(({ die }) => {
      const p = die.outer.position;
      const q = die.outer.quaternion;
      const pose = { pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w] };
      return die === h.die
        ? { ...pose, linvel: [vx, vy, vz], angvel: spin }
        : { ...pose, linvel: [0, 0, 0], angvel: [0, 0, 0], rest: true };
    });
    for (const e of entries) {
      // The logical rotation: the inner one without a model's own (Playback premultiplies it).
      e.L0 = e.die.inner.quaternion.clone();
      if (e.die.modelQuat) e.L0.multiply(e.die.modelQuat.clone().invert());
    }
    const req = {
      dice: entries.map(({ die }) => ({ type: die.shapeType, ...(!maySplat(die.shapeType, die.damageType) && { splat: false }) })),
      seed: seedFrom(random), // nudges only: every die is launched
      launch,
    };
    // Resting pets stand in the way as in any throw; a hard hit may splat one (petSplat).
    let ids = [];
    let hook = null;
    try {
      hook = typeof box._pet === 'function' ? box._pet() : box._pet;
      const o = hook?.obstaclesFor?.({
        spec: null,
        edge: 0,
        hand: true,
        area: { cx: 0, cz: 0, ...box._area },
        stage: box._stage,
      });
      const list = Array.isArray(o)
        ? o.filter((x) => x && typeof x === 'object').slice(0, MAX_OBSTACLES)
        : [];
      if (list.length) {
        ids = list.map((x) => x.id);
        req.obstacles = list.map(({ x, z, r, h: ht }) => ({ x, z, r, h: ht }));
        if (hook.splatSpeed > 0) req.splatSpeed = hook.splatSpeed;
      }
    } catch (err) {
      warn(err);
      hook = null;
    }
    // Stand-ins for Playback: free (never forced to a face) and an inner it may not touch.
    const spare = new THREE.Object3D();
    const player = new Playback({
      dice: entries.map(({ die }) => ({ outer: die.outer, inner: spare, shape: die.shape, free: true })),
      area: { cx: 0, cz: 0, ...box._area },
    });
    Object.assign(me, { entries, player, chunks: [], ids, hook });
    const stream = box._physics.throw(req);
    me.timer = setTimeout(() => toss === me && abort(), TOSS_TIMEOUT_MS);
    stream.onChunk((c) => {
      if (toss !== me) return box._physics.recycle(c.data);
      me.chunks.push(c);
      player.push(c);
    });
    stream.done.then(
      () => {
        if (toss !== me) return;
        clearTimeout(me.timer);
        aimFaces(me);
        me.ready = true; // plays from the release pose only now: every face is known
        box.wake();
      },
      () => toss === me && abort(),
    );
  }

  /** Per die whose face down changes: the inner rotation that shows the same face up after (e.to), from the step it moves. */
  function aimFaces(t) {
    const n = t.entries.length;
    const stride = n * FLOATS_PER_DIE;
    const frames = [];
    for (const c of t.chunks) for (let s = 0; s < c.steps; s++) frames.push([c.data, s * stride]);
    if (!frames.length) return;
    const quat = ([data, off], o) =>
      new THREE.Quaternion(data[off + o + 3], data[off + o + 4], data[off + o + 5], data[off + o + 6]);
    t.entries.forEach((e, d) => {
      const o = d * FLOATS_PER_DIE;
      const q0 = quat(frames[0], o);
      const after = readTopFace(e.die.shape, quat(frames[frames.length - 1], o));
      if (after === readTopFace(e.die.shape, q0)) return; // lies as it lay: nothing to re-aim
      const up = readTopFace(e.die.shape, q0.clone().multiply(e.L0)); // the face it shows now
      const r = rotationToShow(e.die.shape, after, up);
      e.to = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      let f = 0;
      while (f < frames.length - 1 && !movedAt(frames[f], frames[0], o)) f++;
      e.from = f;
    });
  }
  const movedAt = ([a, ao], [b, bo], o) =>
    Math.hypot(a[ao + o] - b[bo + o], a[ao + o + 1] - b[bo + o + 1], a[ao + o + 2] - b[bo + o + 2]) >
      0.02 ||
    Math.abs(
      a[ao + o + 3] * b[bo + o + 3] +
        a[ao + o + 4] * b[bo + o + 4] +
        a[ao + o + 5] * b[bo + o + 5] +
        a[ao + o + 6] * b[bo + o + 6],
    ) < 0.9999;

  /** Sets a die's inner rotation to `L0` slerped towards `to` by u (a model's own rotation after). */
  function turn(e, u) {
    e.die.inner.quaternion.slerpQuaternions(e.L0, e.to, u);
    if (e.die.modelQuat) e.die.inner.quaternion.multiply(e.die.modelQuat);
  }

  /** Impact sounds and dust for the steps just played, and pet hits; never a result or an effect. */
  function impacts(t) {
    const events = t.player.takeEvents();
    if (!events.length) return;
    const surface = box._getSurface?.();
    for (const { die: i, other, speed } of events) {
      const e = t.entries[i];
      if (!e) continue;
      const p = e.die.outer.position;
      const position = { x: p.x, y: p.y, z: p.z };
      const dieKey = `${e.roll.id}:${e.index}`;
      try {
        if (other <= -3) {
          const id = t.ids[-3 - other];
          const die = { appearance: e.die.appearance, damageType: e.die.damageType, ghost: e.die.ghost, type: e.die.shapeType };
          if (id !== undefined) t.hook?.hit?.(id, { speed, position, dieKey, die });
          continue;
        }
        box._effects?.impact?.({ position, speed, surface, dieKey });
        box._onImpact?.({ material: e.die.soundMaterial, surface, speed, other, dieKey, dieType: e.die.type });
      } catch (err) {
        warn(err);
      }
    }
  }

  /** Ends the toss: every die at its final pose and face, the hide timers running again. */
  function settle(t) {
    for (const e of t.entries) if (e.to) turn(e, 1);
    end(t);
  }
  function end(t) {
    clearTimeout(t.timer);
    if (toss === t) toss = null;
    for (const c of t.chunks ?? []) box._physics.recycle(c.data);
    t.chunks = null;
    resume();
    box._renderer?.requestFrame?.();
  }
  /** Stops a toss at once: a flying one lands (its last frame), one not flying yet puts the die back. */
  function abort() {
    const t = toss;
    if (!t) return resume();
    if (t.ready) {
      t.player.update(0); // a first update only starts the clock
      t.player.update(Number.MAX_SAFE_INTEGER);
      return settle(t);
    }
    t.h.die.outer.position.copy(t.h.from);
    t.h.die.outer.quaternion.copy(t.h.q);
    end(t);
  }

  function step(t) {
    if (held) {
      if (!grabbable(held.roll)) {
        // Its roll went away (cleared): nothing to hold.
        held = null;
        listen(false);
        resume();
        return false;
      }
      const u = Math.min(1, (t - held.t0) / LIFT_MS);
      held.die.outer.position.set(held.at.x, held.from.y + (HOLD_Y - held.from.y) * u, held.at.z);
      return true;
    }
    const k = toss;
    if (!k) return false;
    if (k.entries.some((e) => !grabbable(e.roll))) {
      abort();
      return false;
    }
    if (!k.ready) return true;
    const state = k.player.update(t);
    const ph = k.player._playhead; // Playback's playhead, in physics steps
    for (const e of k.entries) if (e.to) turn(e, clamp((ph - e.from) / BLEND_STEPS, 0, 1));
    if (state === 'playing') impacts(k);
    if (state === 'landed') settle(k);
    return true;
  }

  const api = {
    box,
    /** DiceBox's per-frame hook: true while a die is held or flying (the loop keeps running). */
    frame(t) {
      try {
        return step(t);
      } catch (err) {
        warn(err);
        held = null;
        listen(false);
        abort();
        return false;
      }
    },
    get holding() {
      return !!held;
    },
    get tossing() {
      return !!toss;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        win?.removeEventListener?.('pointerdown', down, CAPTURE);
      } catch {
        /* gone */
      }
      if (held) {
        held.die.outer.position.copy(held.from);
        held.die.outer.quaternion.copy(held.q);
        held = null;
        listen(false);
      }
      abort();
      if (box.grab === api) box.grab = null;
      box._renderer?.requestFrame?.();
    },
  };
  win?.addEventListener?.('pointerdown', down, CAPTURE);
  box.grab = api;
  return api;
}
